import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor, listaDelViajante } from "@/lib/vendedor/session"
import { cargarFichaCliente } from "@/lib/vendedor/ficha-cliente"
import { repreciarPedidosAbiertosCliente } from "@/lib/actions/pedidos"

// GET /api/vendedor/cliente/[id]
// Ficha del cliente + cuenta corriente: comprobantes con saldo pendiente
// (FIFO) y pagos recientes con su estado de doble firma.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { id } = await params

    const ficha = await cargarFichaCliente(supabase, session, id)
    if (!ficha) {
      return NextResponse.json({ error: "Cliente inexistente o no asignado a vos." }, { status: 404 })
    }
    return NextResponse.json(ficha)
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/cliente/[id]:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Campos de la ficha que el vendedor puede editar directamente. Todo update
// queda asentado con actualizado_por + actualizado_at (auditoría).
const CAMPOS_EDITABLES = [
  "nombre",
  "razon_social",
  "cuit",
  "direccion",
  "localidad",
  "provincia",
  "telefono",
  "mail",
  "condicion_pago",
  "condicion_entrega",
  "condicion_iva",
  "metodo_facturacion",
  "localidad_id",
  "lista_precio_id",
] as const

// Campos cuyo cambio altera los precios de los pedidos abiertos del cliente
const CAMPOS_PRECIO = ["lista_precio_id", "metodo_facturacion", "condicion_iva"] as const

// PATCH /api/vendedor/cliente/[id]
// Edita datos de la ficha (whitelist) y/o reasigna el vendedor. Deja
// registrado quién y cuándo modificó (clientes.actualizado_por/_at).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const body = await request.json()

    const { data: cliente } = await supabase
      .from("clientes")
      .select("id")
      .eq("id", id)
      .in("vendedor_id", session.vendedorIds)
      .maybeSingle()

    if (!cliente) {
      return NextResponse.json({ error: "Cliente inexistente o no asignado a vos." }, { status: 404 })
    }

    const patch: Record<string, any> = {}

    // La lista de precios solo la cambian los viajantes habilitados
    // (vendedores.puede_cambiar_lista) — el resto ni la ve en la UI
    if (body.lista_precio_id !== undefined && !session.puedeCambiarLista) {
      return NextResponse.json({ error: "No tenés permiso para cambiar la lista de precios." }, { status: 403 })
    }

    // La lista "Especial" es de proveedores puntuales: como lista general del
    // cliente dejaría el resto del catálogo sin precio coherente. Solo ERP.
    if (body.lista_precio_id) {
      const { data: listaSel } = await supabase
        .from("listas_precio")
        .select("codigo")
        .eq("id", body.lista_precio_id)
        .maybeSingle()
      if (listaSel?.codigo === "especial") {
        return NextResponse.json({ error: "La lista Especial se administra solo desde el ERP." }, { status: 403 })
      }
    }

    // Datos de la ficha (solo whitelist)
    for (const campo of CAMPOS_EDITABLES) {
      if (body[campo] !== undefined) {
        const v = typeof body[campo] === "string" ? body[campo].trim() : body[campo]
        patch[campo] = v === "" ? null : v
      }
    }
    if (patch.nombre === null) {
      return NextResponse.json({ error: "El nombre no puede quedar vacío." }, { status: 400 })
    }

    // Reasignación de vendedor (opcional) — SOLO entre los viajantes del
    // propio usuario (ej. FREIJE DANIEL ↔ FREIJE DANIEL LISTA NECO)
    let vendedorDestino: { id: string; nombre: string } | null = null
    if (body.vendedor_id !== undefined) {
      if (!body.vendedor_id || typeof body.vendedor_id !== "string") {
        return NextResponse.json({ error: "vendedor_id inválido." }, { status: 400 })
      }
      if (!session.vendedorIds.includes(body.vendedor_id)) {
        return NextResponse.json({ error: "Solo podés asignar el cliente a un viajante de tu usuario." }, { status: 403 })
      }
      const { data: vd } = await supabase
        .from("vendedores")
        .select("id, nombre")
        .eq("id", body.vendedor_id)
        .eq("activo", true)
        .maybeSingle()
      if (!vd) {
        return NextResponse.json({ error: "Vendedor destino inexistente o inactivo." }, { status: 400 })
      }
      vendedorDestino = vd
      patch.vendedor_id = vd.id
      // El viajante impone su lista (ej. "LISTA NECO" → Neco, "FREIJE DANIEL" → Viajante)
      const listaImpuesta = listaDelViajante(session, vd.id)
      if (listaImpuesta) patch.lista_precio_id = listaImpuesta
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "Nada para actualizar." }, { status: 400 })
    }

    const { error } = await supabase.from("clientes").update(patch).eq("id", id)
    if (error) throw error

    // Sello de auditoría best-effort (requiere migración 20260707_clientes_auditoria;
    // va aparte para no voltear el guardado si la columna todavía no existe)
    await supabase
      .from("clientes")
      .update({ actualizado_por: session.user.id, actualizado_at: new Date().toISOString() })
      .eq("id", id)

    // Si cambió algo que define el precio (lista, método, viajante que impone
    // lista), los pedidos abiertos del cliente se re-precian para que lo que
    // llega a facturar coincida con la ficha — no solo la visual
    let repreciados = 0
    if (CAMPOS_PRECIO.some((c) => patch[c] !== undefined)) {
      const r = await repreciarPedidosAbiertosCliente(id)
      repreciados = r.repreciados
    }

    return NextResponse.json({
      success: true,
      pedidos_repreciados: repreciados,
      ...(vendedorDestino ? { vendedor: vendedorDestino } : {}),
    })
  } catch (error: any) {
    console.error("[vendedor] Error en PATCH /api/vendedor/cliente/[id]:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
