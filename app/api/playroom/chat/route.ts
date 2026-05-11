import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth } from '@/lib/auth'

const anthropic = new Anthropic()

const SYSTEM_PROMPT = `Sos el asistente BI de Compañia de higiene total s.r.l (Megasur), distribuidora de artículos de perfumería, bazar y limpieza con base en Bahía Blanca, Argentina.

Tenés acceso completo a la base de datos operativa: comprobantes de venta, clientes, proveedores, artículos, vendedores y comisiones.

Respondés en español rioplatense, de forma directa y práctica. Usás el tuteo.
Cuando te pidan datos, los mostrás en tablas claras con totales.
Cuando detectás oportunidades o problemas (clientes sin comprar, deuda alta, márgenes bajos) los mencionás proactivamente.
Los montos los mostrás en pesos argentinos con formato $1.234.567.
Si los datos son de un período sin actividad, lo aclarás y sugerís ajustar el rango de fechas.`

const tools: Anthropic.Tool[] = [
  {
    name: 'consultar_ventas',
    description: 'Consulta facturación y ventas por período. Puede agrupar por cliente, artículo, vendedor o tipo de comprobante.',
    input_schema: {
      type: 'object' as const,
      properties: {
        desde: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (default: primer día del mes actual)' },
        hasta: { type: 'string', description: 'Fecha fin YYYY-MM-DD (default: hoy)' },
        agrupar_por: { type: 'string', enum: ['cliente', 'articulo', 'vendedor', 'tipo_comprobante', 'dia'], description: 'Dimensión de agrupación' },
        solo_arca: { type: 'boolean', description: 'Solo incluir FA/FB/FC/NCA/NCB/NCC (excluye PRES/REV)' },
        limit: { type: 'number', description: 'Máximo de filas (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'consultar_stock',
    description: 'Consulta stock actual, artículos sin movimiento y capital inmovilizado.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sin_movimiento_dias: { type: 'number', description: 'Filtrar artículos sin venta en los últimos N días' },
        stock_min: { type: 'number', description: 'Stock mínimo para incluir' },
        rubro: { type: 'string', description: 'Filtrar por rubro/categoría' },
        limit: { type: 'number', description: 'Máximo de filas (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'consultar_clientes',
    description: 'Consulta estado de clientes: deuda, última compra, saldo pendiente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        con_deuda: { type: 'boolean', description: 'Solo clientes con saldo pendiente > 0' },
        desde: { type: 'string', description: 'Fecha inicio para filtrar compras YYYY-MM-DD' },
        hasta: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
        sin_compra_dias: { type: 'number', description: 'Clientes sin comprar en los últimos N días' },
        limit: { type: 'number', description: 'Máximo de filas (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'consultar_comisiones',
    description: 'Consulta comisiones devengadas, cobrables y pagadas por vendedor.',
    input_schema: {
      type: 'object' as const,
      properties: {
        desde: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
        hasta: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
        solo_pendientes: { type: 'boolean', description: 'Solo comisiones cobrables no pagadas' },
      },
      required: [],
    },
  },
]

type ToolInput = {
  consultar_ventas: { desde?: string; hasta?: string; agrupar_por?: string; solo_arca?: boolean; limit?: number }
  consultar_stock: { sin_movimiento_dias?: number; stock_min?: number; rubro?: string; limit?: number }
  consultar_clientes: { con_deuda?: boolean; desde?: string; hasta?: string; sin_compra_dias?: number; limit?: number }
  consultar_comisiones: { desde?: string; hasta?: string; solo_pendientes?: boolean }
}

async function ejecutarTool(name: string, input: any, supabase: any): Promise<any> {
  const hoy = new Date().toISOString().slice(0, 10)
  const primerDiaMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)

  if (name === 'consultar_ventas') {
    const { desde = primerDiaMes, hasta = hoy, agrupar_por = 'cliente', solo_arca = true, limit = 20 } = input as ToolInput['consultar_ventas']
    const tipos = solo_arca ? ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC'] : ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'PRES', 'REV']

    const { data: comprobantes } = await supabase
      .from('comprobantes_venta')
      .select('cliente_id, tipo_comprobante, fecha, total_factura, total_neto')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .in('tipo_comprobante', tipos)

    if (!comprobantes?.length) return { resultado: [], meta: { desde, hasta, total: 0 } }

    if (agrupar_por === 'cliente') {
      const clienteIds = [...new Set(comprobantes.map((c: any) => c.cliente_id).filter(Boolean))]
      const { data: clientes } = await supabase.from('clientes').select('id, nombre_razon_social, nombre').in('id', clienteIds)
      const cMap = new Map((clientes ?? []).map((c: any) => [c.id, c.nombre_razon_social ?? c.nombre]))

      const agg = new Map<string, { total: number; neto: number; count: number }>()
      for (const c of comprobantes) {
        const key = c.cliente_id ?? 'sin_cliente'
        const signo = ['NCA', 'NCB', 'NCC'].includes(c.tipo_comprobante) ? -1 : 1
        if (!agg.has(key)) agg.set(key, { total: 0, neto: 0, count: 0 })
        const a = agg.get(key)!
        a.total += Number(c.total_factura ?? 0) * signo
        a.neto += Number(c.total_neto ?? 0) * signo
        a.count++
      }
      const rows = [...agg.entries()]
        .map(([id, a]) => ({ cliente: cMap.get(id) ?? id, total: Math.round(a.total), neto: Math.round(a.neto), comprobantes: a.count }))
        .sort((a, b) => b.total - a.total)
        .slice(0, limit)
      const totalGeneral = [...agg.values()].reduce((s, a) => s + a.total, 0)
      return { resultado: rows, meta: { desde, hasta, total: Math.round(totalGeneral), filas: rows.length } }
    }

    if (agrupar_por === 'tipo_comprobante') {
      const agg = new Map<string, { total: number; count: number }>()
      for (const c of comprobantes) {
        const k = c.tipo_comprobante
        if (!agg.has(k)) agg.set(k, { total: 0, count: 0 })
        agg.get(k)!.total += Number(c.total_factura ?? 0)
        agg.get(k)!.count++
      }
      return { resultado: [...agg.entries()].map(([tipo, a]) => ({ tipo, total: Math.round(a.total), count: a.count })), meta: { desde, hasta } }
    }

    if (agrupar_por === 'dia') {
      const agg = new Map<string, number>()
      for (const c of comprobantes) {
        const k = c.fecha.slice(0, 10)
        agg.set(k, (agg.get(k) ?? 0) + Number(c.total_factura ?? 0))
      }
      return { resultado: [...agg.entries()].sort().map(([fecha, total]) => ({ fecha, total: Math.round(total) })), meta: { desde, hasta } }
    }

    return { resultado: comprobantes.slice(0, limit), meta: { desde, hasta } }
  }

  if (name === 'consultar_stock') {
    const { sin_movimiento_dias, stock_min = 1, rubro, limit = 20 } = input as ToolInput['consultar_stock']

    let q = supabase.from('articulos').select('id, sku, descripcion, rubro, stock_actual, ultimo_costo, ultima_venta').gte('stock_actual', stock_min)
    if (rubro) q = q.ilike('rubro', `%${rubro}%`)

    const { data: articulos } = await q.limit(500)
    if (!articulos?.length) return { resultado: [], meta: {} }

    let filtered = articulos
    if (sin_movimiento_dias) {
      const cutoff = new Date(Date.now() - sin_movimiento_dias * 86400000).toISOString().slice(0, 10)
      filtered = articulos.filter((a: any) => !a.ultima_venta || a.ultima_venta < cutoff)
    }

    const rows = filtered
      .map((a: any) => ({
        sku: a.sku,
        descripcion: a.descripcion,
        rubro: a.rubro,
        stock: a.stock_actual,
        costo_unitario: a.ultimo_costo ?? 0,
        capital: Math.round((a.stock_actual ?? 0) * (a.ultimo_costo ?? 0)),
        ultima_venta: a.ultima_venta ?? 'nunca',
      }))
      .sort((a: any, b: any) => b.capital - a.capital)
      .slice(0, limit)

    const totalCapital = filtered.reduce((s: number, a: any) => s + (a.stock_actual ?? 0) * (a.ultimo_costo ?? 0), 0)
    return { resultado: rows, meta: { total_articulos: filtered.length, capital_total: Math.round(totalCapital) } }
  }

  if (name === 'consultar_clientes') {
    const { con_deuda, desde, hasta, sin_compra_dias, limit = 20 } = input as ToolInput['consultar_clientes']

    let q = supabase.from('clientes').select('id, nombre_razon_social, nombre, localidad, saldo_cuenta_corriente, ultima_compra')
    if (con_deuda) q = q.gt('saldo_cuenta_corriente', 0)

    const { data: clientes } = await q.limit(500)
    if (!clientes?.length) return { resultado: [], meta: {} }

    let filtered = clientes
    if (sin_compra_dias) {
      const cutoff = new Date(Date.now() - sin_compra_dias * 86400000).toISOString().slice(0, 10)
      filtered = clientes.filter((c: any) => !c.ultima_compra || c.ultima_compra < cutoff)
    }

    const rows = filtered
      .map((c: any) => ({
        cliente: c.nombre_razon_social ?? c.nombre,
        localidad: c.localidad ?? '—',
        saldo: Math.round(c.saldo_cuenta_corriente ?? 0),
        ultima_compra: c.ultima_compra ?? 'nunca',
      }))
      .sort((a: any, b: any) => b.saldo - a.saldo)
      .slice(0, limit)

    return { resultado: rows, meta: { total_clientes: filtered.length } }
  }

  if (name === 'consultar_comisiones') {
    const { desde = primerDiaMes, hasta = hoy, solo_pendientes = false } = input as ToolInput['consultar_comisiones']

    let q = supabase.from('comisiones').select('viajante_id, monto, porcentaje, pagado, comprobante_cobrado, pedidos(fecha)')
    if (solo_pendientes) q = q.eq('comprobante_cobrado', true).eq('pagado', false)

    const { data: comisiones } = await q
    if (!comisiones?.length) return { resultado: [], meta: { desde, hasta } }

    const filtered = comisiones.filter((c: any) => {
      const f = (c.pedidos as any)?.fecha?.slice(0, 10)
      return f && f >= desde && f <= hasta
    })

    const agg = new Map<string, { devengado: number; cobrable: number; pagado: number; pendiente: number }>()
    for (const c of filtered) {
      const vid = c.viajante_id ?? 'sin_vendedor'
      if (!agg.has(vid)) agg.set(vid, { devengado: 0, cobrable: 0, pagado: 0, pendiente: 0 })
      const a = agg.get(vid)!
      a.devengado += Number(c.monto ?? 0)
      if (c.comprobante_cobrado) a.cobrable += Number(c.monto ?? 0)
      if (c.pagado) a.pagado += Number(c.monto ?? 0)
      if (c.comprobante_cobrado && !c.pagado) a.pendiente += Number(c.monto ?? 0)
    }

    const { data: vendedores } = await supabase.from('vendedores').select('id, nombre')
    const vMap = new Map((vendedores ?? []).map((v: any) => [v.id, v.nombre]))

    const rows = [...agg.entries()].map(([vid, a]) => ({
      vendedor: vMap.get(vid) ?? vid,
      devengado: Math.round(a.devengado),
      cobrable: Math.round(a.cobrable),
      pagado: Math.round(a.pagado),
      pendiente: Math.round(a.pendiente),
    })).sort((a, b) => b.devengado - a.devengado)

    return { resultado: rows, meta: { desde, hasta } }
  }

  return { error: 'Tool no reconocida' }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminClient()
    const { mensaje, historial = [] } = await req.json()

    if (!mensaje?.trim()) return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 })

    const messages: Anthropic.MessageParam[] = [
      ...historial,
      { role: 'user', content: mensaje },
    ]

    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    })

    // Agentic loop: ejecutar tools hasta respuesta final
    while (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const tu of toolUses) {
        const resultado = await ejecutarTool(tu.name, tu.input, supabase)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(resultado),
        })
      }

      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: toolResults })

      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      })
    }

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    const texto = textBlock?.text ?? ''

    // Detectar si la respuesta incluye datos tabulares (para renderizar tabla)
    const toolUseBlocks = messages
      .flatMap(m => Array.isArray(m.content) ? m.content : [])
      .filter((b): b is Anthropic.ToolResultBlockParam => b.type === 'tool_result')

    let data: any[] | null = null
    if (toolUseBlocks.length > 0) {
      try {
        const lastResult = JSON.parse(toolUseBlocks[toolUseBlocks.length - 1].content as string)
        if (Array.isArray(lastResult.resultado) && lastResult.resultado.length > 0) {
          data = lastResult.resultado
        }
      } catch {}
    }

    return NextResponse.json({
      respuesta: texto,
      data,
      historial_actualizado: messages,
    })
  } catch (err: any) {
    console.error('[Playroom Chat] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
