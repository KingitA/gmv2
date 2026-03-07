import { type NextRequest, NextResponse } from "next/server"
import { ERP_CONFIG } from "@/lib/config/erp"
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const searchParams = request.nextUrl.searchParams
    const clienteId = searchParams.get("cliente_id")
    const formaFacturacion = searchParams.get("forma_facturacion") || "factura"

    if (!clienteId) {
      return NextResponse.json({ error: "cliente_id es requerido" }, { status: 400 })
    }

    console.log("[v0] Fetching catalogo for cliente:", clienteId, "forma:", formaFacturacion)

    const erpUrl = `${ERP_CONFIG.baseUrl}/api/precios/catalogo?cliente_id=${clienteId}&forma_facturacion=${formaFacturacion}`
    const response = await fetch(erpUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    })

    if (!response.ok) {
      console.error("[v0] ERP error:", response.status)
      return NextResponse.json(
        {
          error: "Error al obtener el catálogo desde el ERP",
          details: `ERP returned ${response.status}`,
        },
        { status: response.status },
      )
    }

    const data = await response.json()
    console.log("[v0] Catalogo loaded:", data.articulos?.length || 0, "articulos")

    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error fetching catalogo:", error)
    return NextResponse.json(
      {
        error: "Error de conexión con el ERP",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
