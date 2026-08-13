import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

/**
 * POST /api/viajante/devolucion — devolución registrada en la calle (Fase E).
 * Contrato: docs/CONTRATO-API-VIAJANTES.md §6. Queda `pendiente` hasta la
 * confirmación física de depósito; la NC se genera desde revisión y se
 * imputa automáticamente contra la FA de origen (Fase A3).
 */
export async function POST(request: NextRequest) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const body = await request.json()
    const { cliente_id, pedido_id, items, observaciones } = body

    if (!cliente_id || !Array.isArray(items) || !items.length) {
      return NextResponse.json({ error: "cliente_id e items son requeridos" }, { status: 400 })
    }

    const { data: cliente } = await supabase
      .from("clientes")
      .select("id, vendedor_id")
      .eq("id", cliente_id)
      .single()
    if (!cliente) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })

    const vendedorId = session.vendedorIds.includes(cliente.vendedor_id)
      ? cliente.vendedor_id
      : session.vendedorIds[0]

    // Condiciones válidas: solo "vendible" repone stock al confirmar
    const CONDICIONES = new Set(["vendible", "dañado", "vencido"])
    for (const i of items) {
      if (!i.articulo_id || Number(i.cantidad) <= 0 || Number(i.precio_venta_original) <= 0) {
        return NextResponse.json({ error: "Cada ítem requiere artículo, cantidad y precio." }, { status: 400 })
      }
      if (i.condicion && !CONDICIONES.has(i.condicion)) {
        return NextResponse.json({ error: `Condición inválida: ${i.condicion}` }, { status: 400 })
      }
    }

    const montoTotal = items.reduce(
      (s: number, i: any) => s + Number(i.precio_venta_original || 0) * Number(i.cantidad || 0),
      0
    )

    // Numeración DEV-#####: max actual + 1, con reintentos ante colisión
    // concurrente (el count(*)+1 anterior chocaba contra el UNIQUE).
    let devolucion: { id: string } | null = null
    let numeroDevolucion = ""
    const { data: ultimo } = await supabase
      .from("devoluciones")
      .select("numero_devolucion")
      .like("numero_devolucion", "DEV-%")
      .order("numero_devolucion", { ascending: false })
      .limit(1)
      .maybeSingle()
    let proximo = (parseInt(String(ultimo?.numero_devolucion || "DEV-0").replace(/\D/g, ""), 10) || 0) + 1

    for (let intento = 0; intento < 5 && !devolucion; intento++, proximo++) {
      numeroDevolucion = `DEV-${String(proximo).padStart(5, "0")}`
      const { data, error: devErr } = await supabase
        .from("devoluciones")
        .insert({
          numero_devolucion: numeroDevolucion,
          cliente_id,
          vendedor_id: vendedorId,
          creado_por: session.user.id,
          pedido_id: pedido_id || null,
          viaje_id: null,
          retira_viajante: true,
          observaciones: observaciones || null,
          estado: "pendiente",
          monto_total: montoTotal,
        })
        .select("id")
        .single()
      if (data) devolucion = data
      else if (devErr && devErr.code !== "23505") throw devErr // 23505 = unique violation → reintenta
    }
    if (!devolucion) {
      return NextResponse.json({ error: "No se pudo numerar la devolución. Reintentá." }, { status: 500 })
    }

    const { error: itemsErr } = await supabase.from("devoluciones_detalle").insert(
      items.map((i: any) => ({
        devolucion_id: devolucion!.id,
        articulo_id: i.articulo_id,
        cantidad: Number(i.cantidad),
        precio_venta_original: Number(i.precio_venta_original || 0),
        motivo: null, // eliminado del flujo — el detalle libre va en observaciones
        condicion: i.condicion || "vendible",
        es_vendible: i.condicion ? i.condicion === "vendible" : true,
        comprobante_venta_id: i.comprobante_venta_id || null,
        fecha_venta_original: i.fecha_venta_original || null,
      }))
    )
    if (itemsErr) throw itemsErr

    return NextResponse.json(
      {
        success: true,
        devolucion_id: devolucion.id,
        numero_devolucion: numeroDevolucion,
        monto_total: montoTotal,
        estado: "pendiente",
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("[viajante/devolucion] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
