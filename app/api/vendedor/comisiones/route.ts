import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { fetchAllRows, fetchByIds } from "@/lib/supabase/fetch-all"
import { getPrecioNeto } from "@/lib/comisiones/calcular"
import { fechaISO } from "@/lib/formato"
import { sinPedidosExcluidos } from "@/lib/comisiones/pedidos-sin-comision"
import { comisionGanadaPorComprobante, cuentaPersonalDe, resumenCuentaPersonal } from "@/lib/cuenta-corriente/cuenta-personal"

// GET /api/vendedor/comisiones?tipo=cobrada|vendida
// Comisiones del vendedor. REGLA DE ORO: el vendedor solo ve plata que
// efectivamente va a cobrar (netos). El monto pactado vive en el kardex
// (comision_viajante_monto, al % con el que se vendió — la config actual del
// vendedor NO pisa ventas viejas) y cuando el comprobante se cobró con
// bonificación contado, la fila trae descuento_financiero_pct: la comisión
// neta es monto × (1 − pct/100).
// - totales:
//   · disponible ("para retirar") = Σ comisiones tipo='cobrada' pagado=false
//     (la tabla ya incluye los débitos negativos del 10% → da neto solo)
//   · retirado = Σ tipo='cobrada' pagado=true
//   · sin_cobrar = devengado desde kardex sin cobrar — ESTIMADO máximo (el
//     10% contado recién se conoce cuando el cliente paga); la UI lo rotula.
// - pedidos: agregado por pedido con comisión NETA por línea.
// - V3 (21/10): con la cuenta personal vinculada, "cobrada" sale de los renglones de
//   comisión de esa cuenta (lo GANADO, ya sin devoluciones ni contado): la suma de la
//   lista es exactamente "Comisiones ganadas". total_pactada = lo del kardex, para explicar.
export async function GET(req: NextRequest) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(req.url)
    const tipo = searchParams.get("tipo") === "vendida" ? "vendida" : "cobrada"

    // Todas las filas de venta con comisión del vendedor (paginado), sin los
    // pedidos eliminados ni los pasados al sistema viejo (#10: "sin cobrar"
    // daba $2,4 M por esos; el flag del kardex no alcanza)
    const rows = await sinPedidosExcluidos(supabase, await fetchAllRows(() =>
      supabase
        .from("kardex")
        .select(
          "id, pedido_id, numero_pedido, cliente_id, fecha, fecha_comprobante_cobrado, articulo_id, comprobante_venta_id, subtotal_neto, metodo_facturacion, articulo_iva_ventas, comision_viajante_monto, descuento_financiero_pct, comprobante_cobrado"
        )
        .eq("tipo_movimiento", "venta")
        .not("comision_viajante_monto", "is", null)
        .neq("comision_viajante_monto", 0)
        .eq("pedido_eliminado", false)
        .in("vendedor_id", session.vendedorIds)
    ))

    // Comisión neta de una línea: pactada menos el débito por pago contado
    const netoLinea = (k: any) => {
      const bruto = Number(k.comision_viajante_monto || 0)
      const pct = Number(k.descuento_financiero_pct || 0)
      return pct > 0 ? bruto * (1 - pct / 100) : bruto
    }

    // Totales "para retirar" y "retirado" desde la tabla comisiones: es lo que
    // la empresa efectivamente liquida (incluye los débitos negativos del 10%).
    const comisionesRows = await fetchAllRows(() =>
      supabase
        .from("comisiones")
        .select("monto, pagado")
        .eq("tipo", "cobrada")
        .in("viajante_id", session.vendedorIds)
    )
    let disponible = 0
    let retirado = 0
    for (const c of comisionesRows) {
      if (c.pagado) retirado += Number(c.monto || 0)
      else disponible += Number(c.monto || 0)
    }
    // Regla del dueño (19/10): con la cuenta personal vinculada, "para retirar" es
    // lo que tiene a favor en su cuenta y "retirado" la suma de sus retiros.
    const cuentaId = await cuentaPersonalDe(supabase, { usuarioId: session.user.id, vendedorIds: session.vendedorIds })
    const cuenta = cuentaId ? await resumenCuentaPersonal(supabase, cuentaId) : null
    if (cuenta) {
      disponible = cuenta.a_favor
      retirado = cuenta.retiros
    }

    // Devengado sin cobrar: estimado máximo desde kardex (el débito contado
    // todavía no se conoce — depende de cómo pague el cliente)
    let sinCobrar = 0
    for (const k of rows) {
      if (!k.comprobante_cobrado) sinCobrar += Number(k.comision_viajante_monto || 0)
    }

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
    if (fuente === "cuenta") {
      const ganada = await comisionGanadaPorComprobante(supabase, cuentaId!)
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

    return NextResponse.json({
      tipo,
      totales: { disponible, sin_cobrar: sinCobrar, retirado, ...(cuenta ? { comisiones_ganadas: cuenta.comisiones_ganadas } : {}) },
      fuente,
      pedidos,
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/comisiones:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
