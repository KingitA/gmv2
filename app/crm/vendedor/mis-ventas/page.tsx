import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Users } from "lucide-react"
import Link from "next/link"
import { MisVentasLista } from "@/components/vendedor/mis-ventas-lista"

export const dynamic = "force-dynamic"

export default async function MisVentasPage() {
  try {
    console.log("[v0] MisVentasPage: Starting to load")

    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    console.log("[v0] MisVentasPage: User loaded:", user?.email)

    if (!user) {
      console.log("[v0] MisVentasPage: No user, redirecting to login")
      redirect("/auth/login")
    }

    const { data: usuario, error } = await supabase
      .from("usuarios_crm")
      .select("id, email, rol, vendedor_id")
      .eq("email", user.email)
      .single()

    console.log("[v0] MisVentasPage: Usuario CRM loaded:", usuario)

    if (error) {
      console.error("[v0] MisVentasPage: Error loading usuario:", error)
      redirect("/dashboard")
    }

    if (!usuario || usuario.rol !== "vendedor") {
      console.log("[v0] MisVentasPage: User is not vendedor, redirecting to dashboard")
      redirect("/dashboard")
    }

    if (!usuario.vendedor_id) {
      console.error("[v0] MisVentasPage: Usuario has no vendedor_id assigned")
      throw new Error("Usuario no tiene vendedor_id asignado. Contacte al administrador.")
    }

    console.log("[v0] MisVentasPage: Rendering page for vendedor:", usuario.vendedor_id)

    return (
      <div className="container mx-auto py-8 px-4">
        <div className="mb-6">
          <Link href="/vendedor">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver al Dashboard
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Users className="h-8 w-8 text-primary" />
                <div>
                  <CardTitle>Mis Ventas</CardTitle>
                  <CardDescription>Todos tus pedidos ordenados del más reciente al más antiguo</CardDescription>
                </div>
              </div>
              <Link href="/vendedor/pedidos/nuevo">
                <Button>Nuevo Pedido</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <MisVentasLista vendedorId={usuario.vendedor_id} />
          </CardContent>
        </Card>
      </div>
    )
  } catch (error) {
    console.error("[v0] MisVentasPage: Critical error:", error)
    // Re-throw to let Next.js error boundary handle it
    throw error
  }
}
