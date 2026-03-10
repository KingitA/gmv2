import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import Link from "next/link"
import { Package, Users, ShoppingBag } from "lucide-react"
import { LogoutButton } from "@/components/auth/logout-button"
import { AiChatWidget } from "@/components/ai/ai-chat-widget"
import { NavbarWrapper } from "@/components/auth/navbar-wrapper"

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  title: "Sistema de Inventario y Ventas",
  description: "Sistema de gestión de compras, ventas y stock",
  generator: "v0.app",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${geist.variable} ${geistMono.variable} font-sans antialiased`}>
        <NavbarWrapper>
          <nav className="sticky top-0 z-50 border-b bg-white shadow-sm">
            <div className="container mx-auto px-6">
              <div className="flex items-center justify-between h-16">
                {/* Logo y título */}
                <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                  <div className="bg-primary text-primary-foreground p-2 rounded-lg">
                    <Package className="h-5 w-5" />
                  </div>
                  <span className="text-lg font-bold text-neutral-900">SISTEMA ERP</span>
                </Link>

                <div className="flex items-center gap-1">
                  <Link
                    href="/proveedores"
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-neutral-700 hover:bg-neutral-100 hover:text-primary transition-colors"
                  >
                    <ShoppingBag className="h-4 w-4" />
                    PROVEEDORES
                  </Link>
                  <Link
                    href="/clientes"
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-neutral-700 hover:bg-neutral-100 hover:text-primary transition-colors"
                  >
                    <Users className="h-4 w-4" />
                    CLIENTES
                  </Link>
                  <Link
                    href="/articulos"
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-neutral-700 hover:bg-neutral-100 hover:text-primary transition-colors"
                  >
                    <Package className="h-4 w-4" />
                    ARTÍCULOS
                  </Link>
                  <div className="w-px h-6 bg-neutral-200 mx-1" />
                  <LogoutButton />
                </div>
              </div>
            </div>
          </nav>
        </NavbarWrapper>

        {/* Contenido principal */}
        <main className="min-h-[calc(100vh-4rem)]">{children}</main>

        <NavbarWrapper>
          <AiChatWidget />
        </NavbarWrapper>
        <Analytics />
      </body>
    </html>
  )
}
