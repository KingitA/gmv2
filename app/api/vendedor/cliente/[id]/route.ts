import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor, listaDelViajante } from "@/lib/vendedor/session"
import { cargarFichaCliente } from "@/lib/vendedor/ficha-cliente"
import { patchListasMetodos, validarListasMetodos } from "@/lib/vendedor/ficha-listas"

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
  "localidad_id",
] as const
// Lista y método (general y por segmento) van aparte: lib/vendedor/ficha-listas.ts


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

    // Lista y método, general o POR SEGMENTO (como la ficha del ERP). La lista solo la
    // cambian los viajantes habilitados y solo a las listas del vendedor (Neco + las de
    // sus viajantes; la Especial nunca): lib/vendedor/ficha-listas.ts
    const errListas = validarListasMetodos(body, session)
    if (errListas) return NextResponse.json({ error: errListas }, { status: 403 })
    Object.assign(patch, patchListasMetodos(body))

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

    // Los pedidos ya tomados NO se re-precian: su precio y sus condiciones se
    // cerraron al tomarlos (lib/pedidos/condiciones-pedido.ts). La ficha nueva
    // rige desde el próximo pedido; el ERP tiene el botón "Repreciar".
    return NextResponse.json({
      success: true,
      pedidos_repreciados: 0,
      ...(vendedorDestino ? { vendedor: vendedorDestino } : {}),
    })
  } catch (error: any) {
    console.error("[vendedor] Error en PATCH /api/vendedor/cliente/[id]:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
