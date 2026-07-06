import type { Metadata, Viewport } from "next"

export const metadata: Metadata = {
  title: "GM — Módulo Vendedor",
  description: "Pedidos, cuentas corrientes y cobranzas para vendedores",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
}

export default function VendedorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {children}
    </div>
  )
}
