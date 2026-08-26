import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { sincronizarKardexPedido } from "@/lib/kardex/sincronizar-pedido"

/**
 * Mantenimiento: re-alinea el kardex de un pedido con sus renglones.
 *
 *   POST /api/pedidos/<id>/sincronizar-kardex            → solo líneas no facturadas
 *   POST /api/pedidos/<id>/sincronizar-kardex?forzar=1   → también las vinculadas a un
 *                                                           comprobante vivo (conserva el
 *                                                           vínculo, corrige valores)
 *
 * El circuito normal ya sincroniza solo (al editar el pedido y al facturar);
 * esto es para reparar pedidos facturados ANTES de ese cambio, cuyo kardex
 * quedó con los precios de cuando se cargó el carrito. Se acepta GET para
 * poder dispararlo desde la barra del navegador con la sesión del ERP.
 */
async function handler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const { id } = await params
    const forzar = ["1", "true", "si"].includes((request.nextUrl.searchParams.get("forzar") || "").toLowerCase())
    const admin = createAdminClient()
    const resultado = await sincronizarKardexPedido(admin, id, { operadorId: auth.user.id, forzarVinculadas: forzar })
    const { data: resumen } = await admin
      .from("kardex")
      .select("subtotal_total, comision_viajante_monto")
      .eq("pedido_id", id)
      .eq("tipo_movimiento", "venta")
    const total = (resumen || []).reduce((s: number, k: any) => s + Number(k.subtotal_total || 0), 0)
    const comision = (resumen || []).reduce((s: number, k: any) => s + Number(k.comision_viajante_monto || 0), 0)
    return NextResponse.json({
      success: true,
      forzar,
      ...resultado,
      kardex_total: Math.round(total * 100) / 100,
      kardex_comision_viajante: Math.round(comision * 100) / 100,
    })
  } catch (error: any) {
    console.error("[pedidos/sincronizar-kardex]", error)
    return NextResponse.json({ error: error.message || "Error sincronizando kardex" }, { status: 500 })
  }
}

export { handler as POST, handler as GET }
