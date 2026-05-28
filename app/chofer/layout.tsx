import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "GM — Módulo Chofer",
  description: "Gestión de viajes y cobranzas para choferes",
}

export default function ChoferLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {children}
    </div>
  )
}
