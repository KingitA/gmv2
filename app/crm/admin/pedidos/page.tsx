import { getAllOrders } from "@/lib/actions/admin"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { Search, Filter } from "lucide-react"
import { OrderStatusBadge } from "@/components/admin/order-status-badge"
import { UpdateOrderStatusButton } from "@/components/admin/update-order-status-button"

// Force dynamic rendering to avoid build-time prerendering
export const dynamic = "force-dynamic"

export default async function AdminPedidosPage() {
  const orders = await getAllOrders()

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Gestión de Pedidos</h1>
              <p className="text-muted-foreground mt-1">Ver y gestionar todos los pedidos del sistema</p>
            </div>
            <Button asChild>
              <Link href="/admin">Volver al Panel</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Filters */}
        <Card className="p-4 mb-6">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por cliente, viajante o número de pedido..." className="pl-10" />
            </div>
            <Button variant="outline">
              <Filter className="h-4 w-4 mr-2" />
              Filtros
            </Button>
          </div>
        </Card>

        {/* Orders Table */}
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="text-left p-4 font-semibold">Nº Pedido</th>
                  <th className="text-left p-4 font-semibold">Cliente</th>
                  <th className="text-left p-4 font-semibold">Viajante</th>
                  <th className="text-left p-4 font-semibold">Zona</th>
                  <th className="text-left p-4 font-semibold">Fecha</th>
                  <th className="text-right p-4 font-semibold">Total</th>
                  <th className="text-center p-4 font-semibold">Estado</th>
                  <th className="text-center p-4 font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order: any) => (
                  <tr key={order.id} className="border-b hover:bg-accent/50">
                    <td className="p-4 font-mono text-sm">{order.numero_pedido}</td>
                    <td className="p-4">{order.clientes?.razon_social}</td>
                    <td className="p-4">{order.usuarios?.nombre}</td>
                    <td className="p-4">{order.clientes?.zona}</td>
                    <td className="p-4 text-sm text-muted-foreground">
                      {new Date(order.created_at).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                    </td>
                    <td className="p-4 text-right font-semibold">
                      ${order.total?.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4 text-center">
                      <OrderStatusBadge status={order.estado} />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/admin/pedidos/${order.id}`}>Ver</Link>
                        </Button>
                        {order.estado === "pendiente" && (
                          <UpdateOrderStatusButton pedidoId={order.id} currentStatus={order.estado} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
