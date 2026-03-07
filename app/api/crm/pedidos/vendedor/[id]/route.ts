import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'

const ERP_BASE_URL = process.env.NEXT_PUBLIC_ERP_URL || "http://localhost:3001"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const { id: vendedorId } = await params

    console.log("[v0] Fetching pedidos for vendedor:", vendedorId)

    const response = await fetch(`${ERP_BASE_URL}/api/pedidos?vendedor_id=${vendedorId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      console.error("[v0] ERP error:", response.status, response.statusText)
      return NextResponse.json({ error: "Error fetching from ERP" }, { status: response.status })
    }

    const data = await response.json()
    console.log("[v0] ERP response:", JSON.stringify(data).substring(0, 500))

    let pedidos = []
    if (Array.isArray(data)) {
      pedidos = data
    } else if (data.pedidos && Array.isArray(data.pedidos)) {
      pedidos = data.pedidos
    } else if (data.data && Array.isArray(data.data)) {
      pedidos = data.data
    }

    console.log("[v0] Pedidos count:", pedidos.length)

    return NextResponse.json(pedidos)
  } catch (error) {
    console.error("[v0] Error in proxy:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
