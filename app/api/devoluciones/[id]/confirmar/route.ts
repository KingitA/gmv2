import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
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

      // Devolver stock solo a artículos vendibles
      for (const item of items) {
        if (item.es_vendible === false) continue
        const { error: stockError } = await supabase.rpc("incrementar_stock", {
          p_articulo_id: item.articulo_id,
          p_cantidad: item.cantidad,
        })
        if (stockError) {
          console.error("[v0] Error devolviendo stock:", stockError)
        }
      }

      // NC administrativa al libro mayor del cliente: la devolución confirmada
      // acredita su monto en la CC (guard: una sola vez por devolución).
      let ncPosteada = false
      if (devolucion?.cliente_id && Number(devolucion.monto_total) > 0) {
        const admin = createAdminClient()
        const { data: yaExiste } = await admin
          .from("cuenta_corriente_clientes")
          .select("id")
          .eq("referencia_tipo", "devolucion")
          .eq("referencia_id", id)
          .limit(1)
        if (!yaExiste?.length) {
          const { error: ccError } = await admin.rpc("cc_postear", {
            p_cliente_id: devolucion.cliente_id,
            p_tipo_movimiento: "devolucion",
            p_debe: 0,
            p_haber: Number(devolucion.monto_total),
            p_referencia_tipo: "devolucion",
            p_referencia_id: id,
            p_numero_comprobante: devolucion.numero_devolucion ?? null,
            p_observaciones: `Devolución confirmada${devolucion.numero_devolucion ? ` ${devolucion.numero_devolucion}` : ""}`,
            p_usuario_id: auth.user?.id ?? null,
          })
          if (ccError) {
            console.error("[devoluciones/confirmar] error posteando CC:", ccError)
          } else {
            ncPosteada = true
          }
        }
      }

      return NextResponse.json({
        success: true,
        devolucion,
        cc_acreditada: ncPosteada,
        mensaje: `Devolución confirmada y stock actualizado${ncPosteada ? " · crédito acreditado en cuenta corriente" : ""}`,
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
