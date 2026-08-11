import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'
import { fetchAllRows } from "@/lib/supabase/fetch-all"

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado") || "pendiente"

    const pagos = await fetchAllRows(() => supabase
      .from("pagos_clientes")
      .select(
        `
        *,
        clientes(nombre, razon_social),
        vendedor:vendedores!pagos_clientes_vendedor_id_fkey(nombre)
      `
      )
      .eq("estado", estado)
      .order("created_at", { ascending: false }))

    // Obtener detalle de cada pago (formas de pago)
    const pagosConDetalle = await Promise.all(
      pagos.map(async (pago) => {
        const { data: detalles } = await supabase.from("pagos_detalle").select("*").eq("pago_id", pago.id)

        return {
          ...pago,
          detalles: detalles || [],
        }
      })
    )

    return NextResponse.json(pagosConDetalle)
  } catch (error: any) {
    console.error("[v0] Error obteniendo pagos:", error)
    return NextResponse.json({ error: error.message || "Error obteniendo pagos" }, { status: 500 })
  }
}


// El POST (alta "legacy" de pagos desde la pantalla de cuenta corriente) se
// eliminó en la auditoría 11/08/2026: los pagos se cargan únicamente desde
// /caja (POST /api/pagos-clientes), /choferes (POST /api/chofer/viaje/[id]/cobro)
// y /viajantes (POST /api/viajante/cobro) — todos vía RPC cobranza_crear
// (transaccional + idempotente). Este archivo conserva solo el GET (listado
// para Revisión de Pagos).
