export const dynamic = 'force-dynamic'
import { getClienteInfo, getClienteStats } from "@/lib/actions/cliente"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Package, ShoppingCart, CreditCard, FileText } from "lucide-react"
import Link from "next/link"

export default async function ClienteDashboardPage() {
  const { cliente } = await getClienteInfo()
  const stats = await getClienteStats()

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-foreground">Bienvenido, {cliente.razon_social}</h1>
          <p className="text-muted-foreground">Gestiona tus pedidos y cuenta corriente</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Pedidos</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalPedidos}</div>
              <p className="text-xs text-muted-foreground">Pedidos realizados</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.pedidosPendientes}</div>
              <p className="text-xs text-muted-foreground">En proceso</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Saldo</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${stats.saldo.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">Cuenta corriente</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Crédito Disponible</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${stats.creditoDisponible.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">Límite: ${cliente.limite_credito?.toFixed(2) || "0.00"}</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Acciones Rápidas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button asChild className="w-full justify-start" size="lg">
                <Link href="/cliente/productos">
                  <ShoppingCart className="mr-2 h-5 w-5" />
                  Ver Catálogo de Productos
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full justify-start bg-transparent" size="lg">
                <Link href="/cliente/pedidos">
                  <Package className="mr-2 h-5 w-5" />
                  Mis Pedidos
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full justify-start bg-transparent" size="lg">
                <Link href="/cliente/cuenta-corriente">
                  <CreditCard className="mr-2 h-5 w-5" />
                  Cuenta Corriente
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Información de Cuenta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">CUIT</p>
                <p className="text-lg font-semibold">{cliente.cuit}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Condición de Pago</p>
                <p className="text-lg font-semibold">{cliente.condicion_pago || "Contado"}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Zona</p>
                <p className="text-lg font-semibold">{cliente.zona}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

