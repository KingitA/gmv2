export const dynamic = 'force-dynamic'
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getViajanteDashboardData } from "@/lib/actions/viajante"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Users, DollarSign, TrendingUp, MapPin, Calendar } from "lucide-react"

export default async function ViajanteDashboardPage() {
  const supabase = await createClient()

  // Check authentication and roles
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect("/auth/login")
  }

  const { data: userRoles } = await supabase
    .from("usuarios_roles")
    .select("roles(nombre)")
    .eq("usuario_id", user.id)

  const roles = userRoles?.map((ur: any) => ur.roles?.nombre) || []

  // Allow access if user is viajante, vendedor, or admin context
  if (!roles.includes("viajante") && !roles.includes("vendedor") && !roles.includes("admin")) {
    redirect("/dashboard")
  }

  const dashboardData = await getViajanteDashboardData()

  // Mock profile for development
  const profile = { full_name: "Usuario Desarrollo", email: "dev@test.com", role: "viajante" }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div>
            <h1 className="text-xl font-semibold">Panel de Viajante</h1>
            <p className="text-sm text-muted-foreground">{profile.full_name || profile.email}</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/auth/login">Salir</Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-7xl space-y-6">
          {/* Stats Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Mis Clientes</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{dashboardData.clienteCount}</div>
                <p className="text-xs text-muted-foreground">Clientes activos</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Comisiones Pendientes</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${dashboardData.totalComisionesPendientes.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">Por cobrar</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Cobrado Este Mes</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${dashboardData.totalComisionesPagadas.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">Comisiones pagadas</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Próximos Viajes</CardTitle>
                <MapPin className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{dashboardData.viajes.length}</div>
                <p className="text-xs text-muted-foreground">Viajes programados</p>
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Acciones Rápidas</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Button asChild className="h-auto flex-col gap-2 py-4">
                <Link href="/crm/viajante/clientes">
                  <Users className="h-6 w-6" />
                  <span>Mis Clientes</span>
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-auto flex-col gap-2 py-4 bg-transparent">
                <Link href="/crm/viajante/clientes/nuevo">
                  <Users className="h-6 w-6" />
                  <span>Nuevo Cliente</span>
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-auto flex-col gap-2 py-4 bg-transparent">
                <Link href="/crm/viajante/pedidos/nuevo">
                  <DollarSign className="h-6 w-6" />
                  <span>Levantar Pedido</span>
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-auto flex-col gap-2 py-4 bg-transparent">
                <Link href="/crm/viajante/comisiones">
                  <TrendingUp className="h-6 w-6" />
                  <span>Mis Comisiones</span>
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Upcoming Trips */}
          {dashboardData.viajes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Próximos Viajes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {dashboardData.viajes.map((viaje) => (
                    <div
                      key={viaje.id}
                      className="flex items-center justify-between rounded-lg border border-border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <Calendar className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{viaje.zona}</p>
                          <p className="text-sm text-muted-foreground">
                            {new Date(viaje.fecha_salida).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                          </p>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm">
                        Ver Detalles
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}

