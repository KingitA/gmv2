import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { procesarPostConfirmacion } from "@/lib/cobranzas/post-confirmacion"

/**
 * GET|POST /api/pagos/[id]/reprocesar — re-dispara la post-confirmación de un
 * pago YA CONFIRMADO (mantenimiento). Todo el módulo es idempotente: lo que ya
 * se hizo no se repite; lo que quedó prometido y sin ejecutar (marcas
 * [CREDITOS:], [AJUSTE:], MARCA_CONTADO en observaciones) se ejecuta ahora.
 * Caso que lo motivó (21/09): el parser de [CREDITOS:] estaba roto y los
 * créditos tildados en un cobro nunca se aplicaban.
 */
async function reprocesar(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const { id } = await params

    const { data: pago } = await supabase
      .from("pagos_clientes")
      .select("id, estado, observaciones, clientes(nombre)")
      .eq("id", id)
      .maybeSingle()
    if (!pago) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 })
    if (pago.estado !== "confirmado") {
      return NextResponse.json(
        { error: `El pago está '${pago.estado}': solo se reprocesan pagos confirmados.` },
        { status: 422 },
      )
    }

    const marcasAntes = pago.observaciones || null
    const result = await procesarPostConfirmacion(supabase, admin, {
      pagoId: id,
      usuarioId: auth.user.id,
    })
    const { data: despues } = await supabase.from("pagos_clientes").select("observaciones").eq("id", id).single()

    return NextResponse.json({
      success: true,
      cliente: (pago as any).clientes?.nombre ?? null,
      observaciones_antes: marcasAntes,
      observaciones_despues: despues?.observaciones ?? null,
      bonificacion: result.bonificacion,
      advertencias: result.bonificacion_error || null,
    })
  } catch (error: any) {
    console.error("[pagos/reprocesar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export { reprocesar as GET, reprocesar as POST }
