import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { headers } from "next/headers"
import "./globals.css"
import { Sidebar } from "@/components/layout/sidebar"
import { MainContent } from "@/components/layout/main-content"
import { AiChatWidget } from "@/components/ai/ai-chat-widget"
import { NavbarWrapper } from "@/components/auth/navbar-wrapper"
import { Toaster } from "@/components/ui/sonner"

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  title: "GM Distribuidora — Sistema ERP",
  description: "Sistema de gestión de compras, ventas y stock",
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
        <NavbarWrapper>
          <AiChatWidget />
        </NavbarWrapper>
        <Analytics />
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
