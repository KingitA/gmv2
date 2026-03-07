import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getClienteById } from "@/lib/actions/clientes"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { ArrowLeft, Package, Calendar, DollarSign, Plus } from "lucide-react"

const STATUS_LABELS = {
  borrador: "Borrador",
  pendiente: "Pendiente",
  en_preparacion: "En Preparación",
  en_viaje: "En Viaje",
  entregado: "Entregado",
  cancelado: "Cancelado",
}

const STATUS_COLORS = {
  borrador: "bg-gray-500/10 text-gray-700",
  pendiente: "bg-yellow-500/10 text-yellow-700",
  en_preparacion: "bg-blue-500/10 text-blue-700",
  en_viaje: "bg-purple-500/10 text-purple-700",
  entregado: "bg-green-500/10 text-green-700",
  cancelado: "bg-red-500/10 text-red-700",
}

export default async function ClientePedidosPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // DESARROLLO: Autenticación deshabilitada
  // const {
  //   data: { user },
  // } = await supabase.auth.getUser()
  // if (!user) {
  //   redirect("/auth/login")
  // }

  const cliente = await getClienteById(id)

  // Get all orders for this client
  const { data: pedidos } = await supabase
    .from("pedidos")
    .select("*")
    .eq("cliente_id", id)
    .order("created_at", { ascending: false })

  // Calculate totals
  const totalPedidos = pedidos?.length || 0
  const totalVentas = pedidos?.reduce((sum, p) => sum + Number(p.total), 0) || 0
  const pedidosPendientes =
    pedidos?.filter((p) => p.status === "pendiente" || p.status === "en_preparacion").length || 0

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href={`/crm/viajante/clientes/${id}`}>
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-semibold">Pedidos</h1>
              <p className="text-sm text-muted-foreground">{cliente.razon_social}</p>
            </div>
          </div>
          <Button asChild>
            <Link href={`/crm/viajante/pedidos/nuevo?cliente=${id}`}>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Pedido
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-5xl space-y-6">
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Pedidos</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalPedidos}</div>
                <p className="text-xs text-muted-foreground">Pedidos realizados</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Ventas</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${totalVentas.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">Monto total</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{pedidosPendientes}</div>
                <p className="text-xs text-muted-foreground">En proceso</p>
              </CardContent>
            </Card>
          </div>

          {/* Orders List */}
          <Card>
            <CardHeader>
              <CardTitle>Historial de Pedidos</CardTitle>
            </CardHeader>
            <CardContent>
              {pedidos && pedidos.length > 0 ? (
                <div className="space-y-3">
                  {pedidos.map((pedido) => (
                    <div
                      key={pedido.id}
                      className="flex items-center justify-between rounded-lg border border-border p-4 transition-shadow hover:shadow-md"
                    >
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">Pedido #{pedido.numero_pedido}</p>
                          <Badge className={STATUS_COLORS[pedido.status as keyof typeof STATUS_COLORS]}>
                            {STATUS_LABELS[pedido.status as keyof typeof STATUS_LABELS]}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(pedido.created_at).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                          </span>
                          {pedido.fecha_entrega_estimada && (
                            <span>Entrega: {new Date(pedido.fecha_entrega_estimada).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}</span>
                          )}
                        </div>
                        {pedido.observaciones && (
                          <p className="text-sm text-muted-foreground">{pedido.observaciones}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold">${Number(pedido.total).toFixed(2)}</p>
                        <Button variant="ghost" size="sm" className="mt-2" asChild>
                          <Link href={`/crm/viajante/pedidos/${pedido.id}`}>Ver Detalles</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-muted-foreground">
                  <Package className="mx-auto mb-4 h-12 w-12 opacity-50" />
                  <p>No hay pedidos registrados para este cliente</p>
                  <Button asChild className="mt-4">
                    <Link href={`/crm/viajante/pedidos/nuevo?cliente=${id}`}>
                      <Plus className="mr-2 h-4 w-4" />
                      Crear Primer Pedido
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
