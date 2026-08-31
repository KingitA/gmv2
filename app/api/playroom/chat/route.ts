import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth } from '@/lib/auth'
import { todayArgentina, startOfDayArgentina, endOfDayArgentina } from '@/lib/utils'
import { fetchAllRows } from '@/lib/playroom/queries'

function diasAtrasArgentina(dias: number): string {
  return new Date(Date.now() - dias * 86400000)
    .toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

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
  const hoy = todayArgentina()
  const primerDiaMes = hoy.slice(0, 7) + '-01'

  if (name === 'consultar_ventas') {
    const { desde = primerDiaMes, hasta = hoy, agrupar_por = 'cliente', solo_arca = true, limit = 20 } = input as ToolInput['consultar_ventas']

    // Por artículo o vendedor: ventas reales desde el kardex (RPC agregada)
    if (agrupar_por === 'articulo') {
      const rows = await fetchAllRows(() => supabase.rpc('playroom_articulos_vendidos', {
        p_from: desde, p_to: hasta, p_prev_from: desde, p_prev_to: hasta,
      }), 'articulo_id')
      const out = rows
        .filter((r: any) => Number(r.neto) > 0)
        .sort((a: any, b: any) => Number(b.neto) - Number(a.neto))
        .slice(0, limit)
        .map((r: any) => ({
          sku: r.sku, descripcion: r.descripcion,
          unidades: Math.round(Number(r.unidades)),
          neto: Math.round(Number(r.neto)),
          total: Math.round(Number(r.total)),
        }))
      const totalNeto = rows.reduce((s: number, r: any) => s + Number(r.neto ?? 0), 0)
      return { resultado: out, meta: { desde, hasta, total_neto: Math.round(totalNeto), filas: out.length, fuente: 'kardex (todas las ventas)' } }
    }

    if (agrupar_por === 'vendedor') {
      const movs = await fetchAllRows(() => supabase
        .from('kardex')
        .select('vendedor_id, tipo_movimiento, subtotal_neto, subtotal_total')
        .in('tipo_movimiento', ['venta', 'nota_credito_venta'])
        .eq('pedido_eliminado', false)
        .gte('fecha', startOfDayArgentina(desde))
        .lte('fecha', endOfDayArgentina(hasta)))
      if (!movs.length) return { resultado: [], meta: { desde, hasta, total: 0 } }
      const vendedores = await fetchAllRows(() => supabase.from('vendedores').select('id, nombre'))
      const vMap = new Map(vendedores.map((v: any) => [v.id, v.nombre]))
      const agg = new Map<string, { neto: number; total: number }>()
      for (const m of movs) {
        const key = m.vendedor_id ?? 'sin_vendedor'
        const signo = m.tipo_movimiento === 'nota_credito_venta' ? -1 : 1
        if (!agg.has(key)) agg.set(key, { neto: 0, total: 0 })
        const a = agg.get(key)!
        a.neto += Number(m.subtotal_neto ?? m.subtotal_total ?? 0) * signo
        a.total += Number(m.subtotal_total ?? 0) * signo
      }
      const rows = [...agg.entries()]
        .map(([id, a]) => ({ vendedor: vMap.get(id) ?? id, neto: Math.round(a.neto), total: Math.round(a.total) }))
        .sort((a, b) => b.neto - a.neto)
        .slice(0, limit)
      return { resultado: rows, meta: { desde, hasta, fuente: 'kardex (todas las ventas)' } }
    }

    // Cliente / tipo_comprobante / día: comprobantes agregados en Postgres (RPC)
    const agrupar = agrupar_por === 'tipo_comprobante' ? 'tipo_comprobante' : agrupar_por === 'dia' ? 'dia' : 'cliente'
    const rows = await fetchAllRows(() => supabase.rpc('playroom_chat_ventas', {
      p_from: desde, p_to: hasta, p_solo_arca: solo_arca, p_agrupar: agrupar,
    }), 'clave')

    if (!rows.length) return { resultado: [], meta: { desde, hasta, total: 0 } }

    if (agrupar === 'tipo_comprobante') {
      return {
        resultado: rows.map((r: any) => ({ tipo: r.clave, total: Math.round(Number(r.total)), neto: Math.round(Number(r.neto)), count: Number(r.comprobantes) })),
        meta: { desde, hasta },
      }
    }

    if (agrupar === 'dia') {
      return {
        resultado: [...rows]
          .sort((a: any, b: any) => a.clave.localeCompare(b.clave))
          .map((r: any) => ({ fecha: r.clave, total: Math.round(Number(r.total)) })),
        meta: { desde, hasta },
      }
    }

    const totalGeneral = rows.reduce((s: number, r: any) => s + Number(r.total ?? 0), 0)
    const out = [...rows]
      .sort((a: any, b: any) => Number(b.total) - Number(a.total))
      .slice(0, limit)
      .map((r: any) => ({ cliente: r.clave, total: Math.round(Number(r.total)), neto: Math.round(Number(r.neto)), comprobantes: Number(r.comprobantes) }))
    return { resultado: out, meta: { desde, hasta, total: Math.round(totalGeneral), filas: out.length } }
  }

  if (name === 'consultar_stock') {
    const { sin_movimiento_dias, stock_min = 1, rubro, limit = 20 } = input as ToolInput['consultar_stock']

    // Agregación en Postgres (RPC): stock + última venta calculada desde kardex
    const all = await fetchAllRows(() => supabase.rpc('playroom_chat_stock', {
      p_stock_min: stock_min,
      p_rubro: rubro || null,
      p_sin_movimiento_dias: sin_movimiento_dias ?? null,
    }), 'sku')
    if (!all.length) return { resultado: [], meta: {} }

    const rows = [...all]
      .sort((a: any, b: any) => Number(b.capital) - Number(a.capital))
      .slice(0, limit)
      .map((a: any) => ({
        sku: a.sku,
        descripcion: a.descripcion,
        rubro: a.rubro,
        stock: Number(a.stock),
        costo_unitario: Number(a.costo_unitario ?? 0),
        capital: Math.round(Number(a.capital ?? 0)),
        ultima_venta: a.ultima_venta ?? 'nunca',
      }))

    const totalCapital = all.reduce((s: number, a: any) => s + Number(a.capital ?? 0), 0)
    return { resultado: rows, meta: { total_articulos: all.length, capital_total: Math.round(totalCapital) } }
  }

  if (name === 'consultar_clientes') {
    const { con_deuda, desde, hasta, sin_compra_dias, limit = 20 } = input as ToolInput['consultar_clientes']

    // Deuda desde el LIBRO MAYOR (v_saldo_clientes) — la columna
    // clientes.saldo_cuenta_corriente no existe (esta consulta estaba rota).
    // Última compra derivada del comprobante de venta más reciente.
    const [clientes, saldosLibro, comps] = await Promise.all([
      fetchAllRows(() => supabase.from('clientes').select('id, nombre_razon_social, nombre, localidad')),
      fetchAllRows(() => supabase.from('v_saldo_clientes').select('cliente_id, saldo_actual'), 'cliente_id'),
      fetchAllRows(() =>
        supabase
          .from('comprobantes_venta')
          .select('cliente_id, fecha')
          .in('tipo_comprobante', ['FA', 'FB', 'FC', 'PRES'])
          .is('anulado_en', null)
      ),
    ])
    if (!clientes.length) return { resultado: [], meta: {} }

    const libroMap = new Map(saldosLibro.map((s: any) => [s.cliente_id, Number(s.saldo_actual) || 0]))
    const ultimaCompra = new Map<string, string>()
    for (const c of comps) {
      const prev = ultimaCompra.get(c.cliente_id)
      if (!prev || (c.fecha && c.fecha > prev)) ultimaCompra.set(c.cliente_id, c.fecha)
    }

    let filtered = clientes as any[]
    if (con_deuda) filtered = filtered.filter((c: any) => (libroMap.get(c.id) ?? 0) > 0)
    if (sin_compra_dias) {
      const cutoff = diasAtrasArgentina(sin_compra_dias)
      filtered = filtered.filter((c: any) => {
        const uc = ultimaCompra.get(c.id)
        return !uc || uc < cutoff
      })
    }

    const rows = filtered
      .map((c: any) => ({
        cliente: c.nombre_razon_social ?? c.nombre,
        localidad: c.localidad ?? '—',
        saldo: Math.round(libroMap.get(c.id) ?? 0),
        ultima_compra: ultimaCompra.get(c.id) ?? 'nunca',
      }))
      .sort((a: any, b: any) => b.saldo - a.saldo)
      .slice(0, limit)

    return { resultado: rows, meta: { total_clientes: filtered.length } }
  }

  if (name === 'consultar_comisiones') {
    const { desde = primerDiaMes, hasta = hoy, solo_pendientes = false } = input as ToolInput['consultar_comisiones']

    // RPC sobre kardex: la fuente viva de comisiones (la tabla `comisiones`
    // está congelada desde 2026-05-18 y daba datos viejos)
    const [rpcRows, vendedores] = await Promise.all([
      fetchAllRows(() => supabase.rpc('playroom_comisiones_viajantes', {
        p_from: desde, p_to: hasta, p_prev_from: desde, p_prev_to: hasta, p_tipo: 'vendida',
      }), 'vendedor_id'),
      fetchAllRows(() => supabase.from('vendedores').select('id, nombre')),
    ])
    if (!rpcRows.length) return { resultado: [], meta: { desde, hasta } }

    const vMap = new Map(vendedores.map((v: any) => [v.id, v.nombre]))

    let rows = rpcRows.map((r: any) => ({
      vendedor: vMap.get(r.vendedor_id) ?? r.vendedor_id ?? 'sin_vendedor',
      devengado: Math.round(Number(r.devengado ?? 0)),
      cobrable: Math.round(Number(r.cobrable ?? 0)),
      pagado: Math.round(Number(r.pagado ?? 0)),
      pendiente: Math.round(Number(r.pendiente ?? 0)),
    })).sort((a, b) => b.devengado - a.devengado)

    if (solo_pendientes) rows = rows.filter(r => r.pendiente > 0)

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
