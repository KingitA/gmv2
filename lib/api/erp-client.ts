import { ERP_BASE_URL, ERP_ENDPOINTS } from "@/lib/config/erp"

// Types for ERP API responses
export interface PrecioArticulo {
  id?: string // Alias for compatibility
  articulo_id: string
  sku: string
  descripcion: string
  categoria: string | null
  precio_base: number
  precio_final: number
  descuento_aplicado: number
  flete: number
  impuestos: number
  comision: number
  stock_disponible: number
  unidades_por_bulto: number | null
}

export interface CatalogoResponse {
  cliente_id: string
  cliente_nombre: string
  articulos: PrecioArticulo[]
  metadata: {
    total_articulos: number
    fecha_calculo: string
  }
}

export interface CrearPedidoRequest {
  cliente_id: string
  vendedor_id?: string
  items: {
    articulo_id: string
    cantidad: number
  }[]
  observaciones?: string
}

export interface CrearPedidoResponse {
  success: boolean
  pedido_id: string
  numero_pedido: string
  total: number
  message: string
}

// Fetch catalog with prices for a specific client
export async function obtenerCatalogo(clienteId: string): Promise<CatalogoResponse> {
  const url = `${ERP_BASE_URL}${ERP_ENDPOINTS.CATALOGO}?cliente_id=${clienteId}`

  console.log("[v0] Fetching catalogo from:", url)

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store", // Always get fresh prices
    })

    if (!response.ok) {
      console.error("[v0] Catalogo fetch failed:", response.status, response.statusText)
      throw new Error(`Error al obtener catálogo: ${response.status} ${response.statusText}`)
    }

    // Check if response is JSON
    const contentType = response.headers.get("content-type")
    if (!contentType || !contentType.includes("application/json")) {
      console.error("[v0] Response is not JSON, content-type:", contentType)
      throw new Error(
        "El endpoint del ERP no está disponible o no está devolviendo datos correctos. Verifica que el endpoint /api/precios/catalogo esté implementado en el ERP.",
      )
    }

    const data = await response.json()
    console.log("[v0] Catalogo response:", data)
    return data
  } catch (error) {
    if (error instanceof SyntaxError) {
      // JSON parse error - likely HTML response
      console.error("[v0] JSON parse error - ERP returned HTML instead of JSON")
      throw new Error(
        "El endpoint del ERP no está disponible. Asegúrate de que el endpoint /api/precios/catalogo esté implementado y deployado en el ERP.",
      )
    }
    throw error
  }
}

// Create a new order
export async function crearPedido(data: CrearPedidoRequest): Promise<CrearPedidoResponse> {
  const url = `${ERP_BASE_URL}${ERP_ENDPOINTS.PEDIDOS}`

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }))
    throw new Error(error.message || "Error al crear pedido")
  }

  return response.json()
}

// Cache helper for localStorage
export function getCachedCatalogo(clienteId: string): CatalogoResponse | null {
  if (typeof window === "undefined") return null

  const cached = localStorage.getItem(`catalogo_${clienteId}`)
  if (!cached) return null

  const { data, timestamp } = JSON.parse(cached)
  const now = Date.now()
  const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

  if (now - timestamp > CACHE_DURATION) {
    localStorage.removeItem(`catalogo_${clienteId}`)
    return null
  }

  return data
}

export function setCachedCatalogo(clienteId: string, data: CatalogoResponse): void {
  if (typeof window === "undefined") return

  localStorage.setItem(
    `catalogo_${clienteId}`,
    JSON.stringify({
      data,
      timestamp: Date.now(),
    }),
  )
}

export const erpClient = {
  async get(endpoint: string) {
    const url = `${ERP_BASE_URL}${endpoint}`
    console.log("[v0] erpClient.get:", url)

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    })

    if (!response.ok) {
      console.error("[v0] erpClient.get failed:", response.status)
      throw new Error(`ERP request failed: ${response.status}`)
    }

    return response.json()
  },
}
