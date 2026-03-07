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
    const { usuario_confirmador, accion } = body // accion: 'confirmar' | 'rechazar'

    if (!usuario_confirmador || !accion) {
      return NextResponse.json({ error: "usuario_confirmador y accion son requeridos" }, { status: 400 })
    }

    if (accion === "confirmar") {
      // Obtener detalle de la devolución
      const { data: items, error: itemsError } = await supabase
        .from("devoluciones_detalle")
        .select("*")
        .eq("devolucion_id", id)

      if (itemsError) throw itemsError

      // Confirmar devolución
      const { data: devolucion, error: devolucionError } = await supabase
        .from("devoluciones")
        .update({
          estado: "confirmado",
          confirmado_por: usuario_confirmador,
          fecha_confirmacion: nowArgentina(),
        })
        .eq("id", id)
        .select()
        .single()

      if (devolucionError) throw devolucionError

      // Devolver stock a los artículos
      for (const item of items) {
        const { error: stockError } = await supabase.rpc("incrementar_stock", {
          p_articulo_id: item.articulo_id,
          p_cantidad: item.cantidad,
        })

        if (stockError) {
          console.error("[v0] Error devolviendo stock:", stockError)
        }
      }

      // TODO: Generar nota de crédito o ajustar cuenta corriente

      return NextResponse.json({
        success: true,
        devolucion,
        mensaje: "Devolución confirmada y stock actualizado",
      })
    } else if (accion === "rechazar") {
      const { motivo_rechazo } = body

      const { data: devolucion, error: devolucionError } = await supabase
        .from("devoluciones")
        .update({
          estado: "rechazado",
          confirmado_por: usuario_confirmador,
          fecha_confirmacion: nowArgentina(),
          motivo_rechazo,
        })
        .eq("id", id)
        .select()
        .single()

      if (devolucionError) throw devolucionError

      return NextResponse.json({
        success: true,
        devolucion,
        mensaje: "Devolución rechazada",
      })
    } else {
      return NextResponse.json({ error: 'Acción inválida. Use "confirmar" o "rechazar"' }, { status: 400 })
    }
  } catch (error: any) {
    console.error("[v0] Error confirmando/rechazando devolución:", error)
    return NextResponse.json({ error: error.message || "Error procesando devolución" }, { status: 500 })
  }
}
