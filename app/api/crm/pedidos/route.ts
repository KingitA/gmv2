import { type NextRequest, NextResponse } from "next/server"
import { ERP_BASE_URL } from "@/lib/config/erp"
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const body = await request.json()

    console.log("[v0] CRM API: Creating pedido via ERP proxy")
    console.log("[v0] CRM API: Pedido data:", body)

    const erpUrl = `${ERP_BASE_URL}/api/pedidos`
    console.log("[v0] CRM API: Calling ERP at:", erpUrl)

    const response = await fetch(erpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    console.log("[v0] CRM API: ERP response status:", response.status)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: `ERP error: ${response.statusText}`,
      }))
      console.error("[v0] CRM API: ERP error response:", errorData)
      return NextResponse.json(errorData, { status: response.status })
    }

    const data = await response.json()
    console.log("[v0] CRM API: Pedido created successfully:", data)

    return NextResponse.json(data, { status: 200 })
  } catch (error) {
    console.error("[v0] CRM API: Error creating pedido:", error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error al crear el pedido",
      },
      { status: 500 },
    )
  }
}
