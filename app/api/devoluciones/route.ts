import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'
import { valorarDevoluciones } from "@/lib/cobranzas/valorar-devoluciones"
import { prepararRenglonesDevolucion } from "@/lib/cobranzas/origen-devolucion"
import { CODIGO_TOPE_DEVOLUCION, excedeTopeDevolucion, esErrorTopeDevolucion, mensajeErrorTopeDevolucion } from "@/lib/cobranzas/tope-devolucion"
import { fechaISO, redondear } from "@/lib/formato"
import { NUMERO_RESPALDO_DEVOLUCION, textoAvisoRespaldo, type CompraDelArticulo } from "@/lib/cobranzas/respaldo-devolucion"

/**
 * Juan (27/10): los renglones asociados al PRES de respaldo (#28) no tienen tope
 * (no hay venta en ese comprobante): la oficina controla la cantidad. Cada uno
 * lleva `aviso_respaldo` con lo que el cliente compró de ese artículo en gmv2.
 */
async function marcarRenglonesRespaldo(supabase: any, devoluciones: any[]): Promise<void> {
  const items = devoluciones.flatMap((d) => (d.items || []).map((it: any) => ({ it, cliente_id: d.cliente_id })))
  const compIds = [...new Set(items.map((x) => x.it.comprobante_venta_id).filter(Boolean))] as string[]
  if (!compIds.length) return
  const { data: comps } = await supabase.from("comprobantes_venta").select("id, numero_comprobante, tipo_comprobante").in("id", compIds)
  const respaldos = new Set((comps || []).filter((c: any) => c.tipo_comprobante === "PRES" && c.numero_comprobante === NUMERO_RESPALDO_DEVOLUCION).map((c: any) => c.id))
  const aMarcar = items.filter((x) => respaldos.has(x.it.comprobante_venta_id) && x.cliente_id && x.it.articulo_id)
  if (!aMarcar.length) return

  const compras = new Map<string, CompraDelArticulo[]>() // cliente|artículo
  for (const clienteId of [...new Set(aMarcar.map((x) => x.cliente_id))]) {
    const arts = [...new Set(aMarcar.filter((x) => x.cliente_id === clienteId).map((x) => x.it.articulo_id))]
    const { data: filas } = await supabase
      .from("comprobantes_venta_detalle")
      .select("articulo_id, cantidad, comprobante:comprobantes_venta!inner(cliente_id, tipo_comprobante, numero_comprobante, fecha, anulado_en)")
      .in("articulo_id", arts)
      .eq("comprobante.cliente_id", clienteId)
      .in("comprobante.tipo_comprobante", ["FA", "FB", "FC", "PRES"])
      .is("comprobante.anulado_en", null)
    for (const f of filas || []) {
      const c = Array.isArray(f.comprobante) ? f.comprobante[0] : f.comprobante
      if (!c || !(Number(f.cantidad) > 0)) continue
      const k = `${clienteId}|${f.articulo_id}`
      compras.set(k, [...(compras.get(k) || []), { fecha: fechaISO(c.fecha), cantidad: Number(f.cantidad), comprobante: `${c.tipo_comprobante} ${c.numero_comprobante}` }])
    }
  }
  for (const { it, cliente_id } of aMarcar) {
    it.sin_venta_registrada = true
    it.aviso_respaldo = textoAvisoRespaldo(Number(it.cantidad_original ?? it.cantidad) || 0, compras.get(`${cliente_id}|${it.articulo_id}`) || [])
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado") || "pendiente"

    let query = supabase
      .from("devoluciones")
      .select(
        `
        *,
        clientes(nombre, razon_social)
      `
      )
      .order("created_at", { ascending: false })
    // 'revision' = bandeja de /revision-devoluciones: pendientes de depósito + pendientes de NC
    if (estado === "revision") query = query.in("estado", ["pendiente", "confirmado"])
    else if (estado !== "todos") query = query.eq("estado", estado)

    const { data: devoluciones, error } = await query

    if (error) throw error

    // Obtener detalle de cada devolución y el vendedor por separado
    const devolucionesConDetalle = await Promise.all(
      (devoluciones || []).map(async (dev) => {
        // Obtener items
        const { data: items } = await supabase
          .from("devoluciones_detalle")
          .select(
            `
            *,
            articulos(descripcion, sku)
          `
          )
          .eq("devolucion_id", dev.id)

        // Obtener vendedor por separado
        let vendedor = null
        if (dev.vendedor_id) {
          const { data: vendedorData } = await supabase
            .from("usuarios")
            .select("nombre, email")
            .eq("id", dev.vendedor_id)
            .single()
          vendedor = vendedorData
        }

        return {
          ...dev,
          items: items || [],
          vendedor,
        }
      })
    )

    try {
      await marcarRenglonesRespaldo(supabase, devolucionesConDetalle)
    } catch (e) {
      console.error("[devoluciones] aviso de renglones sin venta registrada:", e)
    }

    // Lo ya descontado dentro de cobros (devoluciones_descuentos) contra lo que
    // vale hoy la devolución (solo lo aceptado, misma regla que el cobro y la
    // NC). Si se aceptó menos de lo que ya se descontó, NO se tocan los pagos:
    // se avisa con `descontado_de_mas` para que la oficina lo resuelva.
    const ids = devolucionesConDetalle.map((d: any) => d.id)
    const descontadoPor = new Map<string, number>()
    if (ids.length) {
      const { data: descs } = await supabase
        .from("devoluciones_descuentos")
        .select("devolucion_id, monto")
        .in("devolucion_id", ids)
      for (const x of descs || []) {
        descontadoPor.set(x.devolucion_id, (descontadoPor.get(x.devolucion_id) || 0) + (Number(x.monto) || 0))
      }
    }
    const valorPor = new Map<string, number>()
    const porCliente = new Map<string, string[]>()
    for (const d of devolucionesConDetalle as any[]) {
      if (!descontadoPor.get(d.id) || !d.cliente_id || !["pendiente", "confirmado"].includes(d.estado)) continue
      porCliente.set(d.cliente_id, [...(porCliente.get(d.cliente_id) || []), d.id])
    }
    for (const [clienteId, devIds] of porCliente) {
      try {
        const val = await valorarDevoluciones(supabase as any, { clienteId, devolucionIds: devIds })
        for (const [devId, v] of val) valorPor.set(devId, v.total)
      } catch (e) {
        console.error("[devoluciones] valorando para descontado_de_mas:", e)
      }
    }
    const conDescuentos = (devolucionesConDetalle as any[]).map((d) => {
      const descontado = redondear(descontadoPor.get(d.id) || 0)
      const valor = valorPor.get(d.id)
      const deMas = valor != null ? redondear(Math.max(0, descontado - valor)) : 0
      return { ...d, descontado, valor_actual: valor ?? null, descontado_de_mas: deMas }
    })

    return NextResponse.json(conDescuentos)
  } catch (error: any) {
    console.error("[v0] Error obteniendo devoluciones:", error)
    return NextResponse.json({ error: error.message || "Error obteniendo devoluciones" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()

    let {
      cliente_id,
      vendedor_id,
      pedido_id,
      viaje_id,
      retira_viajante,
      observaciones,
      items, // [{ articulo_id, cantidad, precio_venta_original, motivo, es_vendible, fecha_venta_original?, comprobante_venta_id? }]
    } = body

    // Validaciones
    if (!cliente_id || !items || items.length === 0) {
      return NextResponse.json({ error: "cliente_id e items son requeridos" }, { status: 400 })
    }

    // Cada renglón contra su comprobante de origen y, si está facturado en el
    // sistema, al precio facturado (regla del dueño 21/10/2026)
    items = await prepararRenglonesDevolucion(supabase, cliente_id, items, { pedidoId: pedido_id })


    // Tope en el servidor: no devolver más de lo vendido en el comprobante de origen (#25)

    const tope = await excedeTopeDevolucion(supabase, items)

    if (tope) return NextResponse.json({ error: tope, codigo: CODIGO_TOPE_DEVOLUCION }, { status: 409 })

    // Calcular monto total
    const montoTotal = items.reduce((sum: number, item: any) => sum + item.cantidad * item.precio_venta_original, 0)

    // Generar número de devolución
    const { count } = await supabase
      .from("devoluciones")
      .select("*", { count: "exact", head: true })

    const numeroDevolucion = `DEV-${String((count || 0) + 1).padStart(5, "0")}`

    // Crear devolución en estado pendiente
    const { data: devolucion, error: devolucionError } = await supabase
      .from("devoluciones")
      .insert({
        numero_devolucion: numeroDevolucion,
        cliente_id,
        vendedor_id,
        pedido_id,
        viaje_id,
        retira_viajante: retira_viajante || false,
        observaciones,
        estado: "pendiente",
        monto_total: montoTotal,
      })
      .select()
      .single()

    if (devolucionError) throw devolucionError

    // Crear items de devolución
    const itemsConDevolucionId = items.map((item: any) => ({
      devolucion_id: devolucion.id,
      articulo_id: item.articulo_id,
      cantidad: item.cantidad,
      precio_venta_original: item.precio_venta_original,
      motivo: item.motivo || "",
      es_vendible: item.es_vendible !== undefined ? item.es_vendible : true,
      fecha_venta_original: item.fecha_venta_original,
      comprobante_venta_id: item.comprobante_venta_id,
      // subtotal es generado automáticamente en la DB
    }))

    const { error: itemsError } = await supabase.from("devoluciones_detalle").insert(itemsConDevolucionId)

    if (itemsError) {
      // R8: el disparador de la base frenó (otra devolución del mismo artículo se grabó a la vez)
      if (esErrorTopeDevolucion(itemsError)) {
        await supabase.from("devoluciones").delete().eq("id", devolucion.id)
        return NextResponse.json({ error: mensajeErrorTopeDevolucion(itemsError), codigo: CODIGO_TOPE_DEVOLUCION }, { status: 409 })
      }
      throw itemsError
    }

    return NextResponse.json({
      success: true,
      devolucion,
      numero_devolucion: numeroDevolucion,
      mensaje: "Devolución registrada. Pendiente de aprobación desde ERP.",
      monto_total: montoTotal,
    })
  } catch (error: any) {
    console.error("[v0] Error registrando devolución:", error)
    return NextResponse.json({ error: error.message || "Error registrando devolución" }, { status: 500 })
  }
}

