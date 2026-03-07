// ERP API Configuration
export const ERP_BASE_URL = process.env.NEXT_PUBLIC_ERP_URL || "https://v0-inventory-and-sales-system-five.vercel.app"

export const ERP_ENDPOINTS = {
  CATALOGO: "/api/precios/catalogo",
  PEDIDOS: "/api/pedidos",
  CLIENTES: "/api/clientes",
  CUENTA_CORRIENTE: "/api/clientes/:id/cuenta-corriente",
  PAGOS: "/api/pagos",
  DEVOLUCIONES: "/api/devoluciones",
} as const

export const ERP_CONFIG = {
  baseUrl: ERP_BASE_URL,
  endpoints: ERP_ENDPOINTS,
} as const
