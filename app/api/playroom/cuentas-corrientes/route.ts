import { requirePermiso } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { fetchAllRows } from '@/lib/playroom/queries'

// Deuda por antigüedad de Playroom = la MISMA vista que el tablero de Finanzas
// y Jarvis (v_aging_clientes → cc_deuda_antiguedad_base, migración
// 20261016_cc_fuente_unica.sql). Antes este reporte tenía su propia cuenta por
// comprobante, con otros tramos, y no coincidía con la cuenta corriente.
// Tramos: 0–29 / 30–59 / 60–89 / 90+ DÍAS DE ATRASO, desde el vencimiento de cada
// comprobante (20261119r_aging_por_vencimiento.sql); lo que no venció cuenta 0.
// Las claves t0_30/t31_60/… se mantienen por compatibilidad con la pantalla.
export async function GET() {
  // E-65: reportes de Playroom, solo admin y administrativo (lib/auth.ts → PERMISOS)
  const auth = await requirePermiso('reportes_playroom')
  if (auth.error) return auth.error
  try {
    const supabase = createAdminClient()
    const aging = await fetchAllRows(() => supabase
      .from('v_aging_clientes')
      .select('cliente_id, cliente_nombre, localidad_nombre, vendedor_nombre, corriente, dias_30_59, dias_60_89, mas_90, saldo_total, dias_cobro_promedio, fecha_mas_vieja, debitos_pendientes'), 'cliente_id')

    const n = (v: unknown) => Number(v) || 0
    const rows = aging
      .map((a: any) => ({
        cliente_id: a.cliente_id,
        nombre: a.cliente_nombre ?? a.cliente_id,
        localidad: a.localidad_nombre ?? '—',
        vendedor_nombre: a.vendedor_nombre ?? '—',
        saldo_libro: n(a.saldo_total),
        pagos_a_cuenta: 0,
        total_deuda: n(a.saldo_total),
        t0_30: n(a.corriente),
        t31_60: n(a.dias_30_59),
        t61_90: n(a.dias_60_89),
        t90_mas: n(a.mas_90),
        comprobante_mas_viejo: a.fecha_mas_vieja ?? null,
        dias_promedio_mora: Math.round(n(a.dias_cobro_promedio)),
        cantidad_comprobantes: n(a.debitos_pendientes),
      }))
      .sort((a, b) => b.total_deuda - a.total_deuda)

    const total = rows.reduce((s, r) => s + r.total_deuda, 0)
    const summary = {
      total,
      total_por_comprobante: total,
      pagos_a_cuenta: 0,
      t0_30: rows.reduce((s, r) => s + r.t0_30, 0),
      t31_60: rows.reduce((s, r) => s + r.t31_60, 0),
      t61_90: rows.reduce((s, r) => s + r.t61_90, 0),
      t90_mas: rows.reduce((s, r) => s + r.t90_mas, 0),
    }

    return NextResponse.json({ rows, summary })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
