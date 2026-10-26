import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'
import { valorarDevoluciones } from "@/lib/cobranzas/valorar-devoluciones"
import { prepararRenglonesDevolucion } from "@/lib/cobranzas/origen-devolucion"
import { CODIGO_TOPE_DEVOLUCION, excedeTopeDevolucion } from "@/lib/cobranzas/tope-devolucion"
import { redondear } from "@/lib/formato"

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

    if (itemsError) throw itemsError

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

