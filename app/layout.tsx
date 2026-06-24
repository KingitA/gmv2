import type React from "react"
import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { headers } from "next/headers"
import "./globals.css"
import { Sidebar } from "@/components/layout/sidebar"
import { MainContent } from "@/components/layout/main-content"
import { NavbarWrapper } from "@/components/auth/navbar-wrapper"
import { Toaster } from "@/components/ui/sonner"

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  title: "GM Distribuidora — Sistema ERP",
  description: "Sistema de gestión de compras, ventas y stock",
}

// Optimizado para la colectora de datos (pantalla táctil ~360-393px CSS).
// Se bloquea el zoom para que el escaneo/operación no desacomode el layout.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#ffffff",
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const h = await headers()
  const roles = h.get("x-user-roles")?.split(",").filter(Boolean) ?? []

  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${geist.variable} ${geistMono.variable} font-sans antialiased`}>
        <Sidebar roles={roles} />
        <MainContent>{children}</MainContent>
        <NavbarWrapper />
        <Analytics />
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
