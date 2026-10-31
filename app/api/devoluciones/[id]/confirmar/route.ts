import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { ErrorDeposito } from "@/lib/deposito/picking"
import { revisarDevolucion, type RenglonRevision } from "@/lib/deposito/devoluciones"
import { getUsuarioActual } from "@/lib/deposito/preparadores"

/**
 * PATCH /api/devoluciones/[id]/confirmar — revisión desde la oficina.
 * Misma lógica que depósito (lib/deposito/devoluciones.ts → revisarDevolucion):
 * solo desde "pendiente", stock solo de lo aceptado y vendible, montos con lo
 * aceptado, quién y cuándo con el usuario real.
 *
 * Body:
 *   { accion: "confirmar", renglones?: [{ id, aceptar, cantidad_aceptada?, es_vendible?, condicion?, motivo? }], motivo? }
 *     (renglones que no vienen se aceptan tal cual)
 *   { accion: "rechazar", motivo_rechazo }   → rechaza todos los renglones
 *
 * El crédito en cuenta corriente NO se postea acá: nace con la NC/REV que
 * emite una persona (generar-nc-reversa), solo sobre una devolución aceptada.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso("revisar_devoluciones")
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { id } = await params
    const { accion } = body // 'confirmar' | 'rechazar'
    const usuario = await getUsuarioActual(supabase)
    const usuarioId = usuario.id || auth.user.id

    if (accion === "confirmar") {
      const resultado = await revisarDevolucion(supabase, {
        devolucionId: id,
        usuarioId,
        usuarioNombre: usuario.nombre,
        renglones: Array.isArray(body.renglones) ? (body.renglones as RenglonRevision[]) : [],
        motivoGeneral: typeof body.motivo === "string" ? body.motivo : null,
      })
      return NextResponse.json({
        success: true,
        ...resultado,
        mensaje:
          resultado.estado === "rechazado"
            ? "Se rechazaron todos los renglones: la devolución quedó rechazada."
            : resultado.estado === "facturado"
              ? "Devolución revisada y stock actualizado. Ya estaba aplicada en la refacturación del pedido: no se emite NC/Reversa."
              : "Devolución aceptada y stock actualizado. Emití la NC/Reversa para acreditar el crédito en la cuenta corriente.",
      })
    }

    if (accion === "rechazar") {
      const motivo = String(body.motivo_rechazo ?? body.motivo ?? "").trim()
      if (!motivo) return NextResponse.json({ error: "El motivo del rechazo es obligatorio." }, { status: 400 })
      const { data: detalle, error: detErr } = await supabase
        .from("devoluciones_detalle")
        .select("id")
        .eq("devolucion_id", id)
      if (detErr) throw detErr
      const resultado = await revisarDevolucion(supabase, {
        devolucionId: id,
        usuarioId,
        usuarioNombre: usuario.nombre,
        renglones: (detalle || []).map((d: any) => ({ id: d.id, aceptar: false })),
        motivoGeneral: motivo,
      })
      return NextResponse.json({ success: true, ...resultado, mensaje: "Devolución rechazada" })
    }

    return NextResponse.json({ error: 'Acción inválida. Usá "confirmar" o "rechazar".' }, { status: 400 })
  } catch (error: any) {
    if (error instanceof ErrorDeposito) {
      return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status })
    }
    console.error("[devoluciones] Error revisando devolución:", error)
    return NextResponse.json({ error: error.message || "Error procesando devolución" }, { status: 500 })
  }
}
