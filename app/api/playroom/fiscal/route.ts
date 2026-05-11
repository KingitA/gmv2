import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const TIPO_LABELS: Record<string, string> = {
  FA: 'Fact. A', FB: 'Fact. B', FC: 'Fact. C',
  NCA: 'NC A', NCB: 'NC B', NCC: 'NC C',
  PRES: 'Presupuesto', REV: 'Reversa',
}

const TIPOS_ARCA = ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC']

function toTI(condicion: string): string {
  const c = (condicion || '').toLowerCase()
  if (c.includes('responsable inscripto')) return 'RI'
  if (c.includes('monotributo') || c.includes('monotributista')) return 'RM'
  if (c.includes('exento')) return 'EX'
  if (c.includes('consumidor final')) return 'CF'
  if (c.includes('no responsable')) return 'NR'
  return 'CF'
}

function toTM(tipo: string): string {
  if (['FA', 'FB', 'FC'].includes(tipo)) return '01'
  if (['NCA', 'NCB', 'NCC', 'REV'].includes(tipo)) return '03'
  return '01'
}

function provinciaToCol(provincia: string): 'percba' | 'percrn' | 'perclp' | null {
  const p = (provincia || '').toLowerCase().trim()
  if (p.includes('buenos aires') || p === 'ba' || p === 'bsas') return 'percba'
  if (p.includes('rio negro') || p.includes('río negro') || p === 'rn') return 'percrn'
  if (p.includes('la pampa') || p === 'lp') return 'perclp'
  return null
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(req.url)

    const dateFrom = searchParams.get('from') ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
    const dateTo = searchParams.get('to') ?? new Date().toISOString().slice(0, 10)
    const soloARCA = searchParams.get('solo_arca') === 'true'
    const provincia = searchParams.get('provincia') // 'BA' | 'RN' | 'LP' | null

    const tiposFiltro = soloARCA ? TIPOS_ARCA : Object.keys(TIPO_LABELS)

    const { data: comprobantes, error } = await supabase
      .from('comprobantes_venta')
      .select('id, cliente_id, pedido_id, tipo_comprobante, numero_comprobante, punto_venta, fecha, total_factura, total_neto, total_iva, saldo_pendiente, estado_pago, percepcion_iva, percepcion_iibb')
      .gte('fecha', dateFrom)
      .lte('fecha', dateTo)
      .in('tipo_comprobante', tiposFiltro)
      .order('fecha', { ascending: true })
      .order('numero_comprobante', { ascending: true })

    if (error) throw error
    if (!comprobantes?.length) return NextResponse.json({ rows: [], summary: [] })

    // Clientes
    const clienteIds = [...new Set(comprobantes.map(c => c.cliente_id).filter(Boolean))]
    const { data: clientes } = clienteIds.length
      ? await supabase.from('clientes').select('id, nombre, nombre_razon_social, cuit, condicion_iva, provincia').in('id', clienteIds)
      : { data: [] }
    const clienteMap = new Map((clientes ?? []).map(c => [c.id, c]))

    const rows = comprobantes.map(c => {
      const cl = clienteMap.get(c.cliente_id)
      const percIva = Number(c.percepcion_iva ?? 0)
      const percIibb = Number(c.percepcion_iibb ?? 0)
      const percCol = provinciaToCol(cl?.provincia ?? '')

      const percba = percCol === 'percba' ? percIibb : 0
      const percrn = percCol === 'percrn' ? percIibb : 0
      const perclp = percCol === 'perclp' ? percIibb : 0

      return {
        id: c.id,
        fecha: c.fecha,
        tipo_comprobante: c.tipo_comprobante,
        tipo_label: TIPO_LABELS[c.tipo_comprobante] ?? c.tipo_comprobante,
        tm: toTM(c.tipo_comprobante),
        punto_venta: c.punto_venta ?? '',
        numero_comprobante: c.numero_comprobante ?? '',
        cliente_nombre: cl?.nombre_razon_social ?? cl?.nombre ?? '—',
        cuit: cl?.cuit ?? '—',
        condicion_iva: cl?.condicion_iva ?? '—',
        ti: toTI(cl?.condicion_iva ?? ''),
        provincia: cl?.provincia ?? '',
        total: Number(c.total_factura ?? 0),
        total_neto: Number(c.total_neto ?? 0),
        total_iva: Number(c.total_iva ?? 0),
        saldo_pendiente: Number(c.saldo_pendiente ?? 0),
        estado_pago: c.estado_pago ?? '—',
        // ARCA fields
        neto1: Number(c.total_neto ?? 0),
        neto2: 0,
        iva1: Number(c.total_iva ?? 0),
        iva2: 0,
        exento: 0,
        perciva: percIva,
        percba,
        percrn,
        perclp,
      }
    })

    // Provincia filter (after building rows)
    const filteredRows = provincia
      ? rows.filter(r => provinciaToCol(r.provincia) === provincia.toLowerCase() as any)
      : rows

    // Resumen por tipo
    const tipoMap = new Map<string, { count: number; total: number }>()
    for (const r of filteredRows) {
      if (!tipoMap.has(r.tipo_comprobante)) tipoMap.set(r.tipo_comprobante, { count: 0, total: 0 })
      const t = tipoMap.get(r.tipo_comprobante)!
      t.count++
      t.total += r.total
    }
    const summary = [...tipoMap.entries()].map(([tipo, s]) => ({
      tipo,
      label: TIPO_LABELS[tipo] ?? tipo,
      count: s.count,
      total: s.total,
    }))

    return NextResponse.json({ rows: filteredRows, summary })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
