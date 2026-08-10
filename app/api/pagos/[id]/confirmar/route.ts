import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"
import { nowArgentina } from "@/lib/utils"
import { requireAuth } from "@/lib/auth"
import { confirmarCobranza } from "@/lib/actions/cobranzas"
import { procesarPostConfirmacion } from "@/lib/cobranzas/post-confirmacion"

/**
 * Confirmación / rechazo de un pago pendiente (revisión de pagos).
 *
 * Desde Fase A1 la parte financiera (imputaciones → saldos, libro mayor,
 * recibo, kardex, estado del pago) es atómica en el RPC `cobranza_confirmar`.
 * Lo accesorio (comisiones 'cobrada' + billetera + bonificación 10% diferida)
 * vive en lib/cobranzas/post-confirmacion.ts, compartido con TODOS los caminos
 * de confirmación (alta en el acto, rendiciones) para que ninguno lo saltee.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { id } = await params
    // accion: 'confirmar' | 'rechazar'. color_cheques (BLANCO|NEGRO): asignación
    // de la oficina para cheques que quedaron PENDIENTE (pago a cuenta).
    const { usuario_confirmador, accion, motivo_rechazo, imputaciones, color_cheques } = body

    if (!usuario_confirmador || !accion) {
      return NextResponse.json({ error: "usuario_confirmador y accion son requeridos" }, { status: 400 })
    }

    if (accion === "confirmar") {
      // Imputaciones enviadas desde la UI que aún no existen en DB → crearlas
      // como 'pendiente'; el RPC las aplica todas juntas en una transacción.
      for (const imp of imputaciones || []) {
        if (imp.id || !imp.comprobante_id) continue
        const { error: insErr } = await supabase.from("imputaciones").insert({
          pago_id: id,
          comprobante_id: imp.comprobante_id,
          tipo_comprobante: "venta",
          monto_imputado: imp.monto_imputado,
          estado: "pendiente",
        })
        if (insErr) throw new Error(`imputación ${imp.comprobante_id}: ${insErr.message}`)
      }

      const admin = createAdminClient()
      const result = await confirmarCobranza(supabase, admin, {
        pagoId: id,
        usuarioId: auth.user.id,
        colorCheques: color_cheques,
      })

      // Comisiones 'cobrada' + billetera + bonificación 10% diferida (MARCA_CONTADO)
      const post = await procesarPostConfirmacion(supabase, admin, {
        pagoId: id,
        usuarioId: auth.user.id,
        paidComprobanteIds: result.paidComprobanteIds,
      })

      return NextResponse.json({
        success: true,
        numero_recibo: result.numero_recibo,
        bonificacion: post.bonificacion,
        bonificacion_error: post.bonificacion_error,
        mensaje: "Pago confirmado e imputado exitosamente",
      })
    } else if (accion === "rechazar") {
      // Solo se puede rechazar un pago que todavía no impactó saldos. Un pago
      // confirmado tiene libro mayor, recibo y kardex: eso se ANULA (circuito
      // cobranza_anular), no se rechaza.
      const { data: pagoActual } = await supabase
        .from("pagos_clientes")
        .select("estado")
        .eq("id", id)
        .single()
      if (!pagoActual) {
        return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 })
      }
      if (!["pendiente", "pendiente_rendicion"].includes(pagoActual.estado)) {
        return NextResponse.json(
          { error: `No se puede rechazar un pago en estado '${pagoActual.estado}'. Si está confirmado, anulalo (⊘) — el rechazo es solo para pagos pendientes.` },
          { status: 422 },
        )
      }

      const { error: updateError } = await supabase
        .from("pagos_clientes")
        .update({
          estado: "rechazado",
          confirmado_por: usuario_confirmador,
          fecha_confirmacion: nowArgentina(),
          motivo_rechazo,
        })
        .eq("id", id)
        .in("estado", ["pendiente", "pendiente_rendicion"])

      if (updateError) throw updateError

      // Eliminar imputaciones pendientes
      await supabase.from("imputaciones").delete().eq("pago_id", id).eq("estado", "pendiente")

      return NextResponse.json({
        success: true,
        mensaje: "Pago rechazado",
      })
    } else {
      return NextResponse.json({ error: 'Acción inválida. Use "confirmar" o "rechazar"' }, { status: 400 })
    }
  } catch (error: any) {
    console.error("[pagos/confirmar] error:", error)
    return NextResponse.json({ error: error.message || "Error procesando pago" }, { status: 500 })
  }
}
