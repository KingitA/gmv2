import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { cargarPagosSemana } from "@/lib/finanzas/pagos-semana-datos"

/**
 * GET /api/finanzas/pagos-semana?desde=aaaa-mm-dd&dias=30
 *
 * "Pagos de la semana" (E-71) + proyección de caja (E-69). Solo lectura, solo admin
 * (mismo permiso que las órdenes de pago).
 *
 *  - desde: cualquier día de la semana a mirar (se toma de lunes a domingo). Sin fecha, la
 *    semana de hoy. En la semana de hoy entra también todo lo atrasado.
 *  - dias: cuántos días proyectar la caja desde hoy (30 por defecto, de 7 a 90).
 */

export async function GET(request: Request) {
  const auth = await requirePermiso("ordenes_pago")
  if (auth.error) return auth.error
  try {
    const { searchParams } = new URL(request.url)
    // La lectura y las cuentas están en lib/finanzas/pagos-semana-datos.ts (las comparte Jarvis)
    const datos = await cargarPagosSemana(createAdminClient(), {
      desde: searchParams.get("desde"), dias: Number(searchParams.get("dias")) || null,
    })
    return NextResponse.json(datos)
  } catch (error: any) {
    console.error("[finanzas/pagos-semana] error:", error)
    return NextResponse.json({ error: error?.message ?? "No se pudo armar la vista" }, { status: 500 })
  }
}
