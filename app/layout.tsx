import type React from "react"
import type { Metadata, Viewport } from "next"
import { Archivo, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { headers } from "next/headers"
import "./globals.css"
import { MainContent } from "@/components/layout/main-content"
import { esRutaSinNav } from "@/lib/navegacion"
import { Toaster } from "@/components/ui/sonner"
import { Toaster as ToasterRadix } from "@/components/ui/toaster"
import { DocumentTitle } from "@/components/layout/document-title"

// Archivo: grotesca industrial con ancho variable (permite tablas densas con
// la versión angosta) y números del mismo ancho para columnas de importes.
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", axes: ["wdth"], display: "swap" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  title: "GM Distribuidora — Sistema ERP",
  description: "Sistema de gestión de compras, ventas y stock",
}

// Apps de calle/depósito (colectora de datos, pantalla táctil ~360-393px CSS):
// se bloquea el zoom para que el escaneo/operación no desacomode el layout.
// En el ERP el zoom queda libre (se usa desde el celular y con distintos zoom).
// La ruta llega en x-pathname (lib/supabase/middleware.ts).
export async function generateViewport(): Promise<Viewport> {
  const h = await headers()
  const pathname = h.get("x-pathname") ?? ""
  const base: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" }
  if (esRutaSinNav(pathname) && !pathname.startsWith("/auth")) {
    return { ...base, maximumScale: 1, userScalable: false }
  }
  return base
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
      <body className={`${archivo.variable} ${geistMono.variable} font-sans antialiased`}>
        <DocumentTitle />
        <MainContent roles={roles}>{children}</MainContent>
        <Analytics />
        <Toaster richColors position="top-right" />
        {/* Mensajes de useToast (caja, rendiciones, cta cte, imputar…): sin este
            componente montado, TODOS esos avisos —errores incluidos— eran invisibles. */}
        <ToasterRadix />
      </body>
    </html>
  )
}
