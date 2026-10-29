import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth, requirePermiso } from "@/lib/auth"
import { updateClienteEmbedding } from "@/lib/actions/embeddings"
import { errorCuit, moneda, normalizarCuit } from "@/lib/formato"

// DELETE /api/clientes/[id] — eliminar un cliente (P2-02, reglas de Juan 27/10).
// Lo decide la base (cliente_eliminar, 20261029c_cliente_eliminar.sql):
//  - con saldo o con pedidos en curso → no se elimina (409, con el motivo);
//  - sin ningún movimiento → se borra;
//  - con historial (comprobantes con o sin CAE, pedidos, cobros…) → se conserva
//    el historial y el cliente queda escondido de listas y búsquedas, con el
//    código libre.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso("eliminar_clientes")
  if (auth.error) return auth.error
  const { id } = await params

  const { data, error } = await createAdminClient().rpc("cliente_eliminar", { p_cliente_id: id, p_usuario_id: auth.user.id })
  if (error) {
    console.error("[clientes] eliminar:", error)
    return NextResponse.json({ error: `No se pudo eliminar el cliente: ${error.message}` }, { status: 500 })
  }

  const r = data as { resultado: string; saldo?: number; cantidad?: number; codigo?: string | null; con_cae?: boolean }
  switch (r?.resultado) {
    case "borrado":
      return NextResponse.json({ success: true, resultado: "borrado", mensaje: "Cliente eliminado." })
    case "escondido":
      return NextResponse.json({
        success: true,
        resultado: "escondido",
        mensaje: r.con_cae
          ? "Cliente eliminado. Sus facturas con CAE y su historial se conservan; ya no aparece en listas ni búsquedas y su código quedó libre."
          : "Cliente eliminado. Sus pedidos y comprobantes se conservan como historial; ya no aparece en listas ni búsquedas y su código quedó libre.",
      })
    case "con_saldo": {
      const saldo = Number(r.saldo ?? 0)
      return NextResponse.json({
        error: saldo > 0
          ? `Tiene deuda de ${moneda(saldo)}: primero hay que saldarla.`
          : `Tiene saldo a favor de ${moneda(-saldo)}: primero hay que devolverlo o aplicarlo.`,
        error_code: "CLIENTE_CON_SALDO",
        saldo,
      }, { status: 409 })
    }
    case "pedidos_en_curso":
      return NextResponse.json({
        error: `Tiene ${r.cantidad} pedido(s) en curso: entregalos o eliminalos antes de eliminar el cliente.`,
        error_code: "CLIENTE_CON_PEDIDOS",
      }, { status: 409 })
    case "ya_eliminado":
      return NextResponse.json({ success: true, resultado: "escondido", mensaje: "El cliente ya estaba eliminado." })
    case "no_existe":
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })
    default:
      return NextResponse.json({ error: "Respuesta inesperada al eliminar el cliente" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { id } = await params

    // Campos permitidos para actualizar
    const camposPermitidos = [
      "nombre",
      "razon_social",
      "cuit",
      "direccion",
      "localidad_id",
      "telefono",
      "mail",
      "condicion_iva",
      "metodo_facturacion",
      "condicion_pago",
      "tipo_canal",
      "retira_en_deposito",
      // P2-09 / P2-07: la base mantiene sincronizados retira_en_deposito y
      // condicion_entrega; flete_pago solo vale con "transporte"
      "condicion_entrega",
      "flete_pago",
    ]

    const datosActualizar: any = {}
    camposPermitidos.forEach((campo) => {
      if (body[campo] !== undefined) {
        datosActualizar[campo] = body[campo]
      }
    })

    if (datosActualizar.flete_pago !== undefined && ![null, "origen", "destino"].includes(datosActualizar.flete_pago)) {
      return NextResponse.json({ error: "Flete: tiene que ser en origen o en destino" }, { status: 400 })
    }

    if (datosActualizar.cuit !== undefined) {
      const errCuit = errorCuit(datosActualizar.cuit)
      if (errCuit) return NextResponse.json({ error: errCuit }, { status: 400 })
      datosActualizar.cuit = normalizarCuit(datosActualizar.cuit)
    }

    // Actualizar nombre_razon_social si se actualiza razon_social o nombre
    if (datosActualizar.razon_social || datosActualizar.nombre) {
      datosActualizar.nombre_razon_social = datosActualizar.razon_social || datosActualizar.nombre
    }

    const { data: cliente, error: clienteError } = await supabase
      .from("clientes")
      .update(datosActualizar)
      .eq("id", id)
      .select()
      .single()

    if (clienteError) throw clienteError

    // Auto-vectorizar en background (no bloqueante)
    void updateClienteEmbedding(id)

    return NextResponse.json({
      success: true,
      cliente,
    })
  } catch (error: any) {
    console.error("[v0] Error actualizando cliente:", error)
    return NextResponse.json({ error: error.message || "Error actualizando cliente" }, { status: 500 })
  }
}
