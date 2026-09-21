import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireOficina, errorJson, sincronizarParadas } from "@/lib/viajes/servidor"
import { esViajePorTransporte, pedidoListoParaDespacho } from "@/lib/viajes/estados"

// POST /api/viajes/[id]/despachar — oficina cierra papeles y el viaje sale.
//  - pedidos → en_viaje, la hoja de ruta queda fija.
//  - chofer propio: exige titular; el chofer lo ve en su app y lo inicia.
//  - por transporte: constancia de despacho (no hay app ni rendición).
// Si hay pedidos sin facturar devuelve 409 con la lista: reintentar con
//  { sin_facturar: "quitar" }   → esos pedidos se bajan del viaje
//  { sin_facturar: "despachar" } → salen igual (quedan en su estado actual)
// { accion: "reabrir" }: vuelve a 'programado' si el chofer todavía no lo inició.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOficina()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id } = await params
    let body: any = {}
    try { body = await request.json() } catch { /* sin body */ }

    const { data: viaje } = await supabase
      .from("viajes")
      .select("id, estado, tipo, tipo_transporte, chofer_id, vehiculo_id, transporte_id")
      .eq("id", id)
      .single()
    if (!viaje) return errorJson("Viaje no encontrado", 404)
    if (viaje.tipo !== "reparto") return errorJson("Este viaje no es de reparto")

    if (body.accion === "reabrir") {
      if (viaje.estado !== "despachado") return errorJson("Solo se reabre un viaje despachado que todavía no se inició")
      const { error: pErr } = await supabase
        .from("pedidos")
        .update({ estado: "listo_para_enviar" })
        .eq("viaje_id", id)
        .eq("estado", "en_viaje")
      if (pErr) throw pErr
      const { error } = await supabase
        .from("viajes")
        .update({ estado: "programado", despachado_at: null, despachado_por: null })
        .eq("id", id)
      if (error) throw error
      return NextResponse.json({ success: true, estado: "programado" })
    }

    // Por transporte no hay chofer ni rendición: oficina lo cierra a mano una
    // vez entregada la mercadería al transporte.
    if (body.accion === "completar") {
      if (viaje.estado !== "despachado" || !esViajePorTransporte(viaje.tipo_transporte)) {
        return errorJson("Solo se completa a mano un viaje por transporte ya despachado")
      }
      const { error: pErr } = await supabase
        .from("pedidos")
        .update({ estado: "entregado" })
        .eq("viaje_id", id)
        .eq("estado", "en_viaje")
      if (pErr) throw pErr
      const { error } = await supabase
        .from("viajes")
        .update({ estado: "completado", finalizado_at: new Date().toISOString() })
        .eq("id", id)
      if (error) throw error
      return NextResponse.json({ success: true, estado: "completado" })
    }

    // Viaje sin nada que rendir (no hubo cobros): no pasa por /caja, lo cierra
    // oficina. Con cobros pendientes lo completa rendicion_confirmar.
    if (body.accion === "cerrar") {
      if (viaje.estado !== "en_rendicion") return errorJson("Solo se cierra a mano un viaje en rendición")
      const { count } = await supabase
        .from("pagos_clientes")
        .select("id", { count: "exact", head: true })
        .eq("viaje_id", id)
        .eq("estado", "pendiente_rendicion")
      if (count) return errorJson(`Hay ${count} cobro(s) sin rendir: confirmá la rendición desde Caja`)
      const { error } = await supabase.from("viajes").update({ estado: "completado" }).eq("id", id)
      if (error) throw error
      return NextResponse.json({ success: true, estado: "completado" })
    }

    if (viaje.estado !== "programado") return errorJson(`El viaje ya está ${viaje.estado}`)

    const porTransporte = esViajePorTransporte(viaje.tipo_transporte)
    if (porTransporte && !viaje.transporte_id) return errorJson("Elegí el transporte antes de despachar")
    if (!porTransporte && !viaje.chofer_id) return errorJson("Asigná el chofer titular antes de despachar")

    const { data: pedidos, error: pErr } = await supabase
      .from("pedidos")
      .select("id, numero_pedido, estado, clientes(nombre_razon_social, razon_social, nombre)")
      .eq("viaje_id", id)
      .neq("estado", "eliminado")
    if (pErr) throw pErr
    if (!pedidos?.length) return errorJson("El viaje no tiene pedidos")

    const sinFacturar = pedidos.filter((p: any) => !pedidoListoParaDespacho(p.estado))
    if (sinFacturar.length && !["quitar", "despachar"].includes(body.sin_facturar)) {
      return NextResponse.json(
        {
          error: `Hay ${sinFacturar.length} pedido(s) sin facturar`,
          requiere_decision: true,
          sin_facturar: sinFacturar.map((p: any) => ({
            id: p.id,
            numero: p.numero_pedido,
            estado: p.estado,
            cliente: p.clientes?.nombre_razon_social || p.clientes?.razon_social || p.clientes?.nombre || "",
          })),
        },
        { status: 409 },
      )
    }

    if (sinFacturar.length && body.sin_facturar === "quitar") {
      if (sinFacturar.length === pedidos.length) return errorJson("Ningún pedido está facturado: no hay nada para despachar")
      const { error } = await supabase
        .from("pedidos")
        .update({ viaje_id: null })
        .in("id", sinFacturar.map((p: any) => p.id))
      if (error) throw error
      await sincronizarParadas(supabase, id)
    }

    // Solo los que tienen papeles pasan a en_viaje; el resto (si se eligió
    // despachar igual) conserva su estado hasta facturarse.
    const listos = pedidos.filter((p: any) => pedidoListoParaDespacho(p.estado)).map((p: any) => p.id)
    if (listos.length) {
      const { error } = await supabase.from("pedidos").update({ estado: "en_viaje" }).in("id", listos)
      if (error) throw error
    }

    const { error } = await supabase
      .from("viajes")
      .update({ estado: "despachado", despachado_at: new Date().toISOString(), despachado_por: auth.user.id })
      .eq("id", id)
    if (error) throw error

    return NextResponse.json({ success: true, estado: "despachado", pedidos_en_viaje: listos.length })
  } catch (error: any) {
    console.error("[viajes] Error en POST despachar:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
