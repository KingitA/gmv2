import { getAdminStats } from "@/lib/actions/admin"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Package, Clock, Users, UserCheck } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function AdminDashboard() {
  const stats = await getAdminStats()

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold">Panel de Administración</h1>
          <p className="text-muted-foreground mt-1">Gestión completa del sistema CRM</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Stats Grid */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Pedidos</p>
                <p className="text-3xl font-bold mt-2">{stats.totalOrders}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Package className="h-6 w-6 text-primary" />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pendientes</p>
                <p className="text-3xl font-bold mt-2">{stats.pendingOrders}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Clock className="h-6 w-6 text-amber-500" />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Clientes</p>
                <p className="text-3xl font-bold mt-2">{stats.totalClients}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Users className="h-6 w-6 text-blue-500" />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Viajantes</p>
                <p className="text-3xl font-bold mt-2">{stats.totalViajantes}</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                <UserCheck className="h-6 w-6 text-green-500" />
              </div>
            </div>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-8">
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">Gestión de Pedidos</h3>
            <p className="text-sm text-muted-foreground mb-4">Ver, aprobar y gestionar todos los pedidos del sistema</p>
            <Button asChild className="w-full">
              <Link href="/admin/pedidos">Ver Pedidos</Link>
            </Button>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">Gestión de Viajes</h3>
            <p className="text-sm text-muted-foreground mb-4">Crear y asignar viajes a los viajantes</p>
            <Button asChild className="w-full">
              <Link href="/admin/viajes">Gestionar Viajes</Link>
            </Button>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">Usuarios</h3>
            <p className="text-sm text-muted-foreground mb-4">Administrar usuarios, roles y permisos</p>
            <Button asChild className="w-full">
              <Link href="/admin/usuarios">Ver Usuarios</Link>
            </Button>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">Solicitudes de Cambio</h3>
            <p className="text-sm text-muted-foreground mb-4">Aprobar o rechazar cambios propuestos</p>
            <Button asChild className="w-full">
              <Link href="/admin/cambios">Ver Solicitudes</Link>
            </Button>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">Pagos</h3>
            <p className="text-sm text-muted-foreground mb-4">Gestionar pagos y cuenta corriente</p>
            <Button asChild className="w-full">
              <Link href="/admin/pagos">Ver Pagos</Link>
            </Button>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">Comisiones</h3>
            <p className="text-sm text-muted-foreground mb-4">Gestionar comisiones de viajantes</p>
            <Button asChild className="w-full">
              <Link href="/admin/comisiones">Ver Comisiones</Link>
            </Button>
          </Card>
        </div>

        {/* Recent Orders */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-lg">Pedidos Recientes</h3>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/pedidos">Ver Todos</Link>
            </Button>
          </div>

          <div className="space-y-4">
            {stats.recentOrders.map((order: any) => (
              <div
                key={order.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
              >
                <div className="flex-1">
                  <p className="font-medium">{order.clientes?.razon_social}</p>
                  <p className="text-sm text-muted-foreground">
                    Viajante: {order.viajantes?.profiles?.full_name || "Sin asignar"}
                  </p>
                </div>
                <div className="text-right mr-4">
                  <p className="font-semibold">${order.total?.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(order.created_at).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                  </p>
                </div>
                <div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${order.status === "pendiente"
                        ? "bg-amber-100 text-amber-700"
                        : order.status === "en_preparacion"
                          ? "bg-blue-100 text-blue-700"
                          : order.status === "entregado"
                            ? "bg-green-100 text-green-700"
                            : order.status === "cancelado"
                              ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-700"
                      }`}
                  >
                    {order.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
