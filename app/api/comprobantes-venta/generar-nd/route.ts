import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { nowArgentina, todayArgentina } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { determinarTipoNDA, mensajeErrorCondicionIva } from '@/lib/comprobantes/tipo-comprobante'
import { TIPO_CBTE_ARCA, DOC_TIPO, CONCEPTO, IVA_ID, type AmbienteARCA } from "@/lib/arca/tipos"
import { obtenerTAConCache } from "@/lib/arca/cache"
import { ultimoAutorizado, solicitarCAE } from "@/lib/arca/wsfev1"

/**
 * Genera Notas de Débito (NDA/NDB/NDC) para ventas.
 * No afectan stock. Incrementan lo que el cliente debe (CC-debe).
 * Usos: cheque rechazado, diferencia de precio, recargo por mora.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { cookies: { get(name: string) { return cookieStore.get(name)?.value } } },
    )

    const body = await request.json()
    const {
      cliente_id,
      tipo_comprobante, // 'NDA'|'NDB'|'NDC'|'auto'
      concepto,         // descripción del cargo
      items,            // [{ descripcion, cantidad?, precio_unitario_neto, iva_pct? }]
      pedido_id,
    } = body

    if (!cliente_id || !concepto || !items?.length) {
      return NextResponse.json({ error: 'cliente_id, concepto e items son requeridos' }, { status: 400 })
    }

    const { data: cliente, error: clError } = await supabase
      .from('clientes')
      .select('id, nombre_razon_social, nombre, condicion_iva, exento_iva, vendedor_id, provincia')
      .eq('id', cliente_id)
      .single()

    if (clError || !cliente) {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
    }

    let tipoFinal = tipo_comprobante
    if (!tipoFinal || tipoFinal === 'auto') {
      const tipoND = determinarTipoNDA(cliente.condicion_iva)
      if (!tipoND) {
        return NextResponse.json({
          error: mensajeErrorCondicionIva(cliente.nombre_razon_social ?? cliente.nombre ?? ''),
          error_code: 'CLIENTE_SIN_CONDICION_IVA',
          cliente_id,
          cliente_nombre: cliente.nombre_razon_social ?? cliente.nombre,
        }, { status: 422 })
      }
      tipoFinal = tipoND
    }

    // ─── Configuración ARCA ───
    const { data: empresaConfig } = await supabase
      .from('configuracion_empresa')
      .select('cuit, arca_ambiente, arca_punto_venta')
      .single()

    const puntoVenta = String(empresaConfig?.arca_punto_venta ?? 7).padStart(4, '0')

    const { data: numeracion, error: numError } = await supabase
      .from('numeracion_comprobantes')
      .select('*')
      .eq('tipo_comprobante', tipoFinal)
      .eq('punto_venta', puntoVenta)
      .single()

    if (numError || !numeracion) {
      return NextResponse.json(
        { error: `No hay numeración configurada para ${tipoFinal} PV ${puntoVenta}.` },
        { status: 500 },
      )
    }

    // Calcular totales
    let totalNeto = 0
    let totalIva = 0

    const itemsCalculados = items.map((item: any) => {
      const qty = Number(item.cantidad ?? 1)
      const precioNeto = Number(item.precio_unitario_neto ?? 0)
      const ivaPct = Number(item.iva_pct ?? (cliente.exento_iva ? 0 : 21))
      const subtotalNeto = qty * precioNeto
      const subtotalIva = subtotalNeto * (ivaPct / 100)
      totalNeto += subtotalNeto
      totalIva += subtotalIva
      return { qty, precioNeto, ivaPct, subtotalNeto, subtotalIva, descripcion: item.descripcion ?? concepto, articulo_id: item.articulo_id ?? null }
    })
    totalNeto = Math.round(totalNeto * 100) / 100
    totalIva  = Math.round(totalIva  * 100) / 100
    const totalComprobante = Math.round((totalNeto + totalIva) * 100) / 100

    // ─── Obtener TA y sincronizar numeración ───
    const ambiente = (empresaConfig?.arca_ambiente ?? 'produccion') as AmbienteARCA
    const ta = await obtenerTAConCache(supabase, ambiente)
    const cuitEmpresa = (empresaConfig?.cuit ?? '').replace(/-/g, '')
    const cbteTipo = TIPO_CBTE_ARCA[tipoFinal]

    let nuevoNumero = numeracion.ultimo_numero + 1
    if (cbteTipo) {
      const ultimoEnArca = await ultimoAutorizado(
        ambiente, ta.token, ta.sign, cuitEmpresa, parseInt(puntoVenta, 10), cbteTipo,
      )
      if (ultimoEnArca !== numeracion.ultimo_numero) {
        await supabase.from('numeracion_comprobantes')
          .update({ ultimo_numero: ultimoEnArca })
          .eq('tipo_comprobante', tipoFinal)
          .eq('punto_venta', puntoVenta)
        nuevoNumero = ultimoEnArca + 1
      }
    }

    const numeroComprobante = `${puntoVenta}-${nuevoNumero.toString().padStart(8, '0')}`

    // ─── Solicitar CAE ───
    const clienteCuit = (cliente.cuit ?? '').replace(/-/g, '') || '0'
    const fecha = todayArgentina().replace(/-/g, '')
    const respCAE = await solicitarCAE({
      ambiente,
      token:    ta.token,
      sign:     ta.sign,
      cuit:     cuitEmpresa,
      ptoVta:   parseInt(puntoVenta, 10),
      cbteTipo,
      cbteDesde: nuevoNumero,
      cbteHasta: nuevoNumero,
      concepto:  CONCEPTO.PRODUCTOS,
      docTipo:   DOC_TIPO.CUIT,
      docNro:    clienteCuit,
      fecha,
      impTotal:   totalComprobante,
      impTotConc: 0,
      impNeto:    totalNeto,
      impOpEx:    0,
      impIva:     totalIva,
      impTrib:    0,
      iva: totalIva > 0
        ? [{ id: IVA_ID.IVA_21, baseImp: totalNeto, importe: totalIva }]
        : [{ id: IVA_ID.EXENTO,  baseImp: totalNeto, importe: 0 }],
    })

    const { data: comprobante, error: compError } = await supabase
      .from('comprobantes_venta')
      .insert({
        tipo_comprobante:   tipoFinal,
        numero_comprobante: numeroComprobante,
        punto_venta:        puntoVenta,
        fecha:              todayArgentina(),
        cliente_id,
        pedido_id:          pedido_id ?? null,
        total_neto:         totalNeto,
        total_iva:          totalIva,
        total_factura:      totalComprobante,
        saldo_pendiente:    totalComprobante,
        estado_pago:        'pendiente',
        observaciones:      concepto,
        cae:                respCAE.cae,
        vencimiento_cae:    respCAE.vencimientoCae,
      })
      .select()
      .single()

    if (compError) {
      return NextResponse.json({ error: 'Error creando comprobante: ' + compError.message }, { status: 500 })
    }

    const detalleInserts = itemsCalculados.map((item: any) => ({
      comprobante_id: comprobante.id,
      articulo_id: item.articulo_id,
      descripcion: item.descripcion,
      cantidad: item.qty,
      precio_unitario: item.precioNeto,
      precio_total: item.subtotalNeto + item.subtotalIva,
    }))

    const { error: detError } = await supabase.from('comprobantes_venta_detalle').insert(detalleInserts)
    if (detError) {
      return NextResponse.json({ error: 'Error creando detalle: ' + detError.message }, { status: 500 })
    }

    await supabase
      .from('numeracion_comprobantes')
      .update({ ultimo_numero: nuevoNumero })
      .eq('tipo_comprobante', tipoFinal)
      .eq('punto_venta', puntoVenta)

    // CC: el cliente debe más
    await supabase.from('cuenta_corriente_ajustes').insert({
      cliente_id,
      tipo_movimiento: 'debe',
      tipo_comprobante: tipoFinal,
      numero_comprobante: numeroComprobante,
      monto: totalComprobante,
      fecha: todayArgentina(),
      concepto: 'Nota de Débito',
      descripcion: concepto,
    })

    return NextResponse.json({
      success: true,
      comprobante: {
        id:           comprobante.id,
        tipo:         tipoFinal,
        numero:       numeroComprobante,
        total:        totalComprobante,
        total_neto:   totalNeto,
        total_iva:    totalIva,
        cae:          respCAE.cae,
        vencimiento_cae: respCAE.vencimientoCae,
      },
    })
  } catch (err: any) {
    console.error('[ND] Error generando nota de débito:', err)
    return NextResponse.json({ error: err.message || 'Error generando nota de débito' }, { status: 500 })
  }
}
