import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/proveedores/[id]/imputar-pago — RETIRADO (E-64, 16/11/2026).
 *
 * Escribía un pago directo en la cuenta corriente del proveedor, sin orden de
 * pago: no bajaba caja ni banco, no pasaba por el kardex y no calculaba la
 * retención. No tenía pantalla. Los pagos a proveedores se hacen únicamente
 * con Órdenes de pago (/ordenes-pago → op_crear / op_confirmar).
 */
export async function POST() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  return NextResponse.json(
    {
      error: "Esta forma de registrar pagos a proveedores se retiró. Los pagos se hacen desde Proveedores → Órdenes de pago.",
      error_code: "RETIRADO",
    },
    { status: 410 },
  )
}
