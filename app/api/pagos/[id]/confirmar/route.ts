import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { requireAuth } from '@/lib/auth'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { id } = await params
    const { usuario_confirmador, accion, motivo_rechazo, imputaciones } = body // accion: 'confirmar' | 'rechazar'

    if (!usuario_confirmador || !accion) {
      return NextResponse.json({ error: "usuario_confirmador y accion son requeridos" }, { status: 400 })
    }

    if (accion === "confirmar") {
      // Obtener el pago
      const { data: pago, error: pagoError } = await supabase
        .from("pagos_clientes")
        .select("*")
        .eq("id", id)
        .single()

      if (pagoError) throw pagoError

      // Confirmar pago
      const { error: updateError } = await supabase
        .from("pagos_clientes")
        .update({
          estado: "confirmado",
          confirmado_por: usuario_confirmador,
          fecha_confirmacion: nowArgentina(),
        })
        .eq("id", id)

      if (updateError) throw updateError

      let imputacionesFinales = imputaciones

      if (!imputacionesFinales || imputacionesFinales.length === 0) {
        // Buscar imputaciones previamente guardadas
        const { data: impGuardadas } = await supabase
          .from("imputaciones")
          .select("*")
          .eq("pago_id", id)
          .eq("estado", "pendiente")

        imputacionesFinales = impGuardadas || []
      }

      // Aplicar imputaciones a los comprobantes
      for (const imp of imputacionesFinales) {
        // Obtener comprobante actual
        const { data: comprobante } = await supabase
          .from("comprobantes_venta")
          .select("*")
          .eq("id", imp.comprobante_id)
          .single()

        if (!comprobante) continue

        const nuevoSaldo = Number(comprobante.saldo_pendiente) - Number(imp.monto_imputado)
        const nuevoEstado = nuevoSaldo <= 0 ? "pagado" : "parcial"

        // Actualizar saldo del comprobante
        await supabase
          .from("comprobantes_venta")
          .update({
            saldo_pendiente: Math.max(0, nuevoSaldo),
            estado_pago: nuevoEstado,
          })
          .eq("id", imp.comprobante_id)

        // Si el comprobante quedó saldado → marcar comisiones como cobrables
        if (nuevoEstado === "pagado") {
          await supabase
            .from("comisiones")
            .update({
              comprobante_cobrado: true,
              fecha_comprobante_cobrado: nowArgentina(),
            })
            .eq("comprobante_venta_id", imp.comprobante_id)
            .eq("comprobante_cobrado", false)
        }

        // Confirmar o crear la imputación
        if (imp.id) {
          await supabase.from("imputaciones").update({ estado: "confirmado" }).eq("id", imp.id)
        } else {
          await supabase.from("imputaciones").insert({
            pago_id: id,
            comprobante_id: imp.comprobante_id,
            tipo_comprobante: "venta",
            monto_imputado: imp.monto_imputado,
            estado: "confirmado",
          })
        }
      }

      return NextResponse.json({
        success: true,
        mensaje: "Pago confirmado e imputado exitosamente",
      })
    } else if (accion === "rechazar") {
      const { error: updateError } = await supabase
        .from("pagos_clientes")
        .update({
          estado: "rechazado",
          confirmado_por: usuario_confirmador,
          fecha_confirmacion: nowArgentina(),
          motivo_rechazo,
        })
        .eq("id", id)

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
    console.error("[v0] Error confirmando/rechazando pago:", error)
    return NextResponse.json({ error: error.message || "Error procesando pago" }, { status: 500 })
  }
}
