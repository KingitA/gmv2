import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllRows, fetchByIds } from "@/lib/supabase/fetch-all"
import { getPrecioNeto } from "@/lib/comisiones/calcular"
import { fechaISO } from "@/lib/formato"
import { ESTADOS_SIN_COMISION } from "@/lib/comisiones/pedidos-sin-comision"
import { comisionGanadaPorComprobante, cuentaPersonalDe, resumenCuentaPersonal } from "@/lib/cuenta-corriente/cuenta-personal"

/**
 * Comisiones del vendedor (GET /api/vendedor/comisiones y la sync vendedor_billetera).
 * Las reglas están en el encabezado de la ruta. Devuelve las DOS listas (cobrada y
 * vendida) de una sola lectura: la sync pedía la ruta dos veces y cada vez leía toda
 * la historia del kardex (lentitud del 24/11).
 */
const COLS_KARDEX =
  "id, pedido_id, numero_pedido, cliente_id, fecha, fecha_comprobante_cobrado, articulo_id, comprobante_venta_id, subtotal_neto, metodo_facturacion, articulo_iva_ventas, comision_viajante_monto, descuento_financiero_pct, comprobante_cobrado"

/** Kardex con comisión del vendedor, sin pedidos eliminados ni del sistema viejo; páginas por id (keyset). */
export async function kardexComisionVendedor(supabase: SupabaseClient, vendedorIds: string[]): Promise<any[]> {
  const out: any[] = []
  if (!vendedorIds.length) return out
  let desde: string | null = null
  for (;;) {
    let q = supabase
      .from("kardex")
      .select(`${COLS_KARDEX}, pedidos!inner(estado)`)
      .eq("tipo_movimiento", "venta")
      .not("comision_viajante_monto", "is", null)
      .neq("comision_viajante_monto", 0)
      .eq("pedido_eliminado", false)
      .in("vendedor_id", vendedorIds)
      .not("pedidos.estado", "in", `(${ESTADOS_SIN_COMISION.join(",")})`)
      .order("id", { ascending: true })
      .limit(1000)
    if (desde) q = q.gt("id", desde)
    const { data, error } = await q
    if (error) throw error
    const pagina = data || []
    for (const r of pagina) {
      const { pedidos: _p, ...fila } = r as any
      out.push(fila)
    }
    if (pagina.length < 1000) break
    desde = (pagina[pagina.length - 1] as any).id
  }
  return out
}

export async function calcularComisiones(supabase: SupabaseClient, session: { vendedorIds: string[]; user: { id: string } }) {
  // Las filas de venta con comisión del vendedor, sin los pedidos eliminados ni los
  // del sistema viejo (#10). Lentitud 24/11: antes se traía TODA la historia (81 % era
  // sistema viejo) en páginas con OFFSET que reordenaban todo cada vez, y se descartaba
  // en TS; ahora la base filtra por el estado del pedido y se pagina por id.
  const rows = await kardexComisionVendedor(supabase, session.vendedorIds)

  // Comisión neta de una línea: pactada menos el débito por pago contado
  const netoLinea = (k: any) => {
    const bruto = Number(k.comision_viajante_monto || 0)
    const pct = Number(k.descuento_financiero_pct || 0)
    return pct > 0 ? bruto * (1 - pct / 100) : bruto
  }

  // Regla del dueño (19/10): con la cuenta personal vinculada, "para retirar" es
  // lo que tiene a favor en su cuenta y "retirado" la suma de sus retiros. Sin ella,
  // la tabla vieja de comisiones (solo entonces se lee: tiene 71 mil filas).
  const cuentaId = await cuentaPersonalDe(supabase, { usuarioId: session.user.id, vendedorIds: session.vendedorIds })
  const cuenta = cuentaId ? await resumenCuentaPersonal(supabase, cuentaId) : null
  let disponible = 0
  let retirado = 0
  if (cuenta) {
    disponible = cuenta.a_favor
    retirado = cuenta.retiros
  } else {
    const comisionesRows = await fetchAllRows(() =>
      supabase
        .from("comisiones")
        .select("monto, pagado")
        .eq("tipo", "cobrada")
        .in("viajante_id", session.vendedorIds)
    )
    for (const c of comisionesRows) {
      if (c.pagado) retirado += Number(c.monto || 0)
      else disponible += Number(c.monto || 0)
    }
  }

  // Devengado sin cobrar: estimado máximo desde kardex (el débito contado
  // todavía no se conoce — depende de cómo pague el cliente)
  let sinCobrar = 0
  for (const k of rows) {
    if (!k.comprobante_cobrado) sinCobrar += Number(k.comision_viajante_monto || 0)
  }

  // Las dos listas (cobrada y vendida) salen de la MISMA lectura: la sync las pide juntas
  const ganada = cuenta && cuentaId ? await comisionGanadaPorComprobante(supabase, cuentaId) : null
  const lista = async (tipo: "cobrada" | "vendida") => {
    // Lista de pedidos según el toggle (formato playroom)
    const visibles = tipo === "cobrada" ? rows.filter((k) => k.comprobante_cobrado) : rows
    type Agg = {
      pedido_id: string
      numero_pedido: string
      cliente_id: string | null
      fecha: string
      fecha_cobro: string | null
      total_monto: number
      total_comision: number
      total_debito_contado: number
      total_pactada: number
      skus: Set<string>
    }
    const aggMap = new Map<string, Agg>()
    const fuente: "cuenta" | "kardex" = cuenta && cuentaId && tipo === "cobrada" ? "cuenta" : "kardex"
    if (fuente === "cuenta" && ganada) {
      const compIds = [...ganada.keys()]
      const comps = await fetchByIds<any>(
        (ch) => supabase.from("comprobantes_venta").select("id, pedido_id, cliente_id, fecha").in("id", ch),
        compIds,
      )
      const lineasDe = new Map<string, any[]>()
      for (const k of rows) {
        if (!k.comprobante_venta_id) continue
        const l = lineasDe.get(k.comprobante_venta_id) || []
        l.push(k)
        lineasDe.set(k.comprobante_venta_id, l)
      }
      for (const comp of comps) {
        const g = ganada.get(comp.id)!
        if (Math.abs(g.monto) < 0.005) continue // revertida del todo (cobro anulado)
        const lineas = lineasDe.get(comp.id) || []
        const pid = comp.pedido_id ?? "sin_pedido"
        if (!aggMap.has(pid)) {
          aggMap.set(pid, {
            pedido_id: pid,
            numero_pedido: lineas[0]?.numero_pedido ?? "—",
            cliente_id: comp.cliente_id,
            fecha: fechaISO(comp.fecha),
            fecha_cobro: fechaISO(g.fecha) || null,
            total_monto: 0,
            total_comision: 0,
            total_debito_contado: 0,
            total_pactada: 0,
            skus: new Set(),
          })
        }
        const agg = aggMap.get(pid)!
        const fc = fechaISO(g.fecha) || null
        if (fc && (!agg.fecha_cobro || fc > agg.fecha_cobro)) agg.fecha_cobro = fc
        agg.total_comision += g.monto
        for (const k of lineas) {
          agg.total_monto += getPrecioNeto(Number(k.subtotal_neto ?? 0), k.metodo_facturacion, k.articulo_iva_ventas)
          agg.total_pactada += Number(k.comision_viajante_monto ?? 0)
          if (k.articulo_id) agg.skus.add(k.articulo_id)
        }
      }
      for (const agg of aggMap.values()) agg.total_debito_contado = Math.max(0, agg.total_pactada - agg.total_comision)
    }
    for (const k of fuente === "cuenta" ? [] : visibles) {
      const pid = k.pedido_id ?? "sin_pedido"
      if (!aggMap.has(pid)) {
        aggMap.set(pid, {
          pedido_id: pid,
          numero_pedido: k.numero_pedido ?? "—",
          cliente_id: k.cliente_id,
          fecha: fechaISO(k.fecha), // timestamptz → día argentino
          fecha_cobro: fechaISO(k.fecha_comprobante_cobrado) || null,
          total_monto: 0,
          total_comision: 0,
          total_debito_contado: 0,
          total_pactada: 0,
          skus: new Set(),
        })
      }
      const agg = aggMap.get(pid)!
      agg.total_pactada += Number(k.comision_viajante_monto ?? 0)
      const bruto = Number(k.comision_viajante_monto ?? 0)
      const neto = netoLinea(k)
      // Monto SIN IVA: la misma base sobre la que se calcula la comisión
      // (subtotal_neto; en presupuesto de artículo blanco se quita además el
      // IVA implícito ÷1,21 — regla getPrecioNeto del motor). Así el % del
      // vendedor cierra a ojo contra lo que muestra la pantalla.
      agg.total_monto += getPrecioNeto(Number(k.subtotal_neto ?? 0), k.metodo_facturacion, k.articulo_iva_ventas)
      // El número que ve el vendedor es SIEMPRE el neto; el débito va aparte
      // para poder mostrar el porqué ("pactada X − débito 10% = neto").
      agg.total_comision += neto
      agg.total_debito_contado += bruto - neto
      if (k.articulo_id) agg.skus.add(k.articulo_id)
    }

    const clienteIds = [...new Set([...aggMap.values()].map((a) => a.cliente_id).filter(Boolean))] as string[]
    const clienteMap = new Map<string, string>()
    if (clienteIds.length) {
      const { data: clientes } = await supabase
        .from("clientes")
        .select("id, nombre_razon_social, nombre")
        .in("id", clienteIds)
      for (const c of clientes || []) clienteMap.set(c.id, c.nombre_razon_social ?? c.nombre ?? c.id)
    }

    const pedidos = [...aggMap.values()]
      .map((agg) => ({
        pedido_id: agg.pedido_id,
        numero_pedido: agg.numero_pedido,
        cliente_id: agg.cliente_id,
        cliente_nombre: clienteMap.get(agg.cliente_id ?? "") ?? "—",
        fecha: agg.fecha,
        fecha_cobro: agg.fecha_cobro,
        total_monto: Math.round(agg.total_monto * 100) / 100,
        total_comision: Math.round(agg.total_comision * 100) / 100,
        total_debito_contado: Math.round(agg.total_debito_contado * 100) / 100,
        total_pactada: Math.round(agg.total_pactada * 100) / 100,
        cantidad_skus: agg.skus.size,
      }))
      .sort((a, b) => (b.fecha_cobro || b.fecha).localeCompare(a.fecha_cobro || a.fecha))
    return { fuente, pedidos }
  }
  const [cobrada, vendida] = await Promise.all([lista("cobrada"), lista("vendida")])
  const totales = { disponible, sin_cobrar: sinCobrar, retirado, ...(cuenta ? { comisiones_ganadas: cuenta.comisiones_ganadas } : {}) }
  return {
    cobrada: { tipo: "cobrada" as const, totales, ...cobrada },
    vendida: { tipo: "vendida" as const, totales, ...vendida },
  }
}
