export const dynamic = 'force-dynamic'
import { getClientePedidos } from "@/lib/actions/cliente"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Package, Calendar, DollarSign } from "lucide-react"
import Link from "next/link"

export default async function ClientePedidosPage() {
  const pedidos = await getClientePedidos()

  const getEstadoBadge = (estado: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pendiente: "secondary",
      aprobado: "default",
      rechazado: "destructive",
      entregado: "outline",
    }
    return <Badge variant={variants[estado] || "default"}>{estado.toUpperCase()}</Badge>
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-foreground">Mis Pedidos</h1>
          <p className="text-muted-foreground">Historial de pedidos realizados</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="space-y-4">
          {pedidos.map((pedido) => (
            <Card key={pedido.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Package className="h-5 w-5" />
                      Pedido #{pedido.numero_pedido}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Atendido por: {pedido.viajante?.nombre_completo || "N/A"}
                    </p>
                  </div>
                  {getEstadoBadge(pedido.estado)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Fecha</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(pedido.fecha_pedido).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Total</p>
                      <p className="text-sm font-semibold text-primary">${pedido.total.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Entrega</p>
                      <p className="text-sm text-muted-foreground">
                        {pedido.fecha_entrega
                          ? new Date(pedido.fecha_entrega).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })
                          : "Por definir"}
                      </p>
                    </div>
                  </div>
                </div>
                {pedido.observaciones && (
                  <div className="mt-4 rounded-md bg-muted p-3">
                    <p className="text-sm font-medium">Observaciones:</p>
                    <p className="text-sm text-muted-foreground">{pedido.observaciones}</p>
                  </div>
                )}
                <div className="mt-4">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/cliente/pedidos/${pedido.id}`}>Ver Detalle</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {pedidos.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Package className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-lg font-medium text-muted-foreground">No tienes pedidos aún</p>
                <p className="mb-4 text-sm text-muted-foreground">Comienza explorando nuestro catálogo</p>
                <Button asChild>
                  <Link href="/cliente/productos">Ver Productos</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

