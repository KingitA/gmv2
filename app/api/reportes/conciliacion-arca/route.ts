/**
 * GET /api/reportes/conciliacion-arca
 *
 * Concilia la numeración fiscal local contra ARCA. Diseño O(1) respecto al
 * volumen: la numeración de ARCA es secuencial y sin huecos, así que con
 * FECompUltimoAutorizado (1 llamada por tipo = 6 llamadas) se conoce el set
 * completo autorizado [1..N] y se compara contra los números de la DB.
 * FECompConsultar solo se llama para los faltantes (normalmente cero).
 *
 * Detecta:
 *  - Huérfanos: autorizados en ARCA, ausentes en la DB (con fecha/importe de ARCA)
 *  - Locales no autorizados: en DB con número > último de ARCA, o fiscales sin CAE
 *  - Huérfanos registrados en arca_solicitudes_cae (recuperables con un clic)
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { TIPO_CBTE_ARCA, type AmbienteARCA } from '@/lib/arca/tipos'
import { obtenerTAConCache } from '@/lib/arca/cache'
import { ultimoAutorizado, consultarComprobante } from '@/lib/arca/wsfev1'

const TIPOS_FISCALES = ['FA', 'FB', 'NCA', 'NCB', 'NDA', 'NDB']
const MAX_CONSULTAS_DETALLE = 50  // tope de FECompConsultar por corrida

interface Inconsistencia {
  tipo: string
  numero: string
  fecha: string | null
  importe: number | null
  motivo: 'en_arca_no_en_sistema' | 'en_sistema_no_en_arca' | 'sin_cae'
  recuperable_log_id: string | null
}

function fmtFechaArca(f: string | null): string | null {
  // YYYYMMDD → YYYY-MM-DD
  if (!f || f.length !== 8) return f
  return `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`
}

export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminClient()

    if (!process.env.ARCA_CERTIFICADO || !process.env.ARCA_CLAVE_PRIVADA) {
      return NextResponse.json({ error: 'Certificado ARCA no configurado — no se puede conciliar.' }, { status: 500 })
    }

    const { data: empresaConfig } = await supabase
      .from('configuracion_empresa')
      .select('cuit, arca_ambiente, arca_punto_venta')
      .single()

    if (!empresaConfig?.arca_punto_venta) {
      return NextResponse.json({ error: 'configuracion_empresa.arca_punto_venta no configurado.' }, { status: 500 })
    }

    const ambiente    = (empresaConfig.arca_ambiente ?? 'produccion') as AmbienteARCA
    const ta          = await obtenerTAConCache(supabase, ambiente)
    const cuitEmpresa = (empresaConfig.cuit ?? '').replace(/-/g, '')
    const puntoVenta  = String(empresaConfig.arca_punto_venta).padStart(4, '0')
    const pvNum       = parseInt(puntoVenta, 10)

    const inconsistencias: Inconsistencia[] = []
    const resumen: Record<string, { ultimo_arca: number; en_sistema: number }> = {}
    let consultasDetalle = 0

    // Huérfanos ya registrados (recuperables con un clic) — para vincular con faltantes
    const { data: huerfanosLog } = await supabase
      .from('arca_solicitudes_cae')
      .select('id, tipo_comprobante, numero')
      .eq('estado', 'huerfano')
    const logPorClave = new Map((huerfanosLog ?? []).map((h: any) => [`${h.tipo_comprobante}|${h.numero}`, h.id]))

    for (const tipo of TIPOS_FISCALES) {
      const cbteTipo = TIPO_CBTE_ARCA[tipo]

      // 1 llamada por tipo: hasta qué número autorizó ARCA
      const ultimoArca = await ultimoAutorizado(ambiente, ta.token, ta.sign, cuitEmpresa, pvNum, cbteTipo)

      // Números existentes en la DB para este tipo + PV fiscal
      // (fetchAllRows pagina de a 1000: con >1000 facturas el corte de PostgREST
      //  generaba falsos "huérfanos")
      const rows = await fetchAllRows(() => supabase
        .from('comprobantes_venta')
        .select('numero_comprobante, fecha, cae, total_factura')
        .eq('tipo_comprobante', tipo)
        .eq('punto_venta', puntoVenta))

      const numerosDB = new Map<number, { fecha: string; cae: string | null; total: number }>()
      for (const r of rows) {
        const nro = parseInt((r.numero_comprobante ?? '').split('-')[1] ?? '', 10)
        if (!isNaN(nro)) numerosDB.set(nro, { fecha: r.fecha, cae: r.cae, total: Number(r.total_factura ?? 0) })
      }

      resumen[tipo] = { ultimo_arca: ultimoArca, en_sistema: numerosDB.size }

      // Faltantes: autorizados por ARCA (1..ultimoArca) sin registro local
      for (let nro = 1; nro <= ultimoArca; nro++) {
        if (numerosDB.has(nro)) continue
        const numeroFmt = `${puntoVenta}-${String(nro).padStart(8, '0')}`

        let fecha: string | null = null
        let importe: number | null = null
        if (consultasDetalle < MAX_CONSULTAS_DETALLE) {
          consultasDetalle++
          const det = await consultarComprobante(ambiente, ta.token, ta.sign, cuitEmpresa, pvNum, cbteTipo, nro)
          fecha   = fmtFechaArca(det?.fecha ?? null)
          importe = det?.impTotal ?? null
        }

        inconsistencias.push({
          tipo,
          numero: numeroFmt,
          fecha,
          importe,
          motivo: 'en_arca_no_en_sistema',
          recuperable_log_id: logPorClave.get(`${tipo}|${numeroFmt}`) ?? null,
        })
      }

      // Sobrantes/sin CAE: existen localmente pero ARCA no los autorizó
      for (const [nro, datos] of numerosDB) {
        if (nro > ultimoArca) {
          inconsistencias.push({
            tipo, numero: `${puntoVenta}-${String(nro).padStart(8, '0')}`,
            fecha: datos.fecha, importe: datos.total,
            motivo: 'en_sistema_no_en_arca', recuperable_log_id: null,
          })
        } else if (!datos.cae) {
          inconsistencias.push({
            tipo, numero: `${puntoVenta}-${String(nro).padStart(8, '0')}`,
            fecha: datos.fecha, importe: datos.total,
            motivo: 'sin_cae', recuperable_log_id: null,
          })
        }
      }
    }

    return NextResponse.json({
      ok: inconsistencias.length === 0,
      punto_venta: puntoVenta,
      resumen,
      inconsistencias,
      conciliado_en: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('[conciliacion-arca] Error:', err)
    return NextResponse.json({ error: err.message || 'Error conciliando contra ARCA' }, { status: 500 })
  }
}
