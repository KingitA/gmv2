import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Users, ShoppingCart, LogOut, FileText } from "lucide-react"
import { ClientesTable } from "@/components/vendedor/clientes-table"

// Force dynamic rendering to avoid build-time prerendering
export const dynamic = "force-dynamic"

export default async function VendedorDashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  const { data: usuarioCrm, error: crmError } = await supabase
    .from("usuarios_crm")
    .select("*")
    .eq("email", user.email)
    .maybeSingle()

  if (crmError || !usuarioCrm) {
    redirect("/auth/pendiente")
  }

  if (usuarioCrm.estado !== "activo") {
    redirect("/auth/pendiente")
  }

  if (usuarioCrm.rol !== "vendedor") {
    redirect("/dashboard")
  }

  const { data: clientes } = await supabase
    .from("clientes")
    .select("*")
    .eq("vendedor_id", usuarioCrm.vendedor_id)
    .eq("activo", true)
    .order("razon_social")

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div>
            <h1 className="text-xl font-semibold">Panel de Vendedor</h1>
            <p className="text-sm text-muted-foreground">{usuarioCrm.nombre || user.email}</p>
          </div>
          <form action="/api/auth/signout" method="post">
            <Button variant="outline" size="sm">
              <LogOut className="mr-2 h-4 w-4" />
              Salir
            </Button>
          </form>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-7xl space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Button asChild size="lg" className="h-20 text-lg">
              <Link href="/vendedor/pedidos/nuevo">
                <ShoppingCart className="mr-3 h-6 w-6" />
                Realizar Pedido
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-20 text-lg bg-transparent">
              <Link href="/vendedor/mis-ventas">
                <FileText className="mr-3 h-6 w-6" />
                Mis Ventas
              </Link>
            </Button>
          </div>

          {/* Stats */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Mis Clientes</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{clientes?.length || 0}</div>
              <p className="text-xs text-muted-foreground">Clientes activos</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mis Clientes</CardTitle>
            </CardHeader>
            <CardContent>
              <ClientesTable clientes={clientes || []} vendedorId={usuarioCrm.vendedor_id || ""} />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
