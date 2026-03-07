import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getPedidoById } from "@/lib/actions/pedidos"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { ArrowLeft, Package, MapPin, FileText } from "lucide-react"

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

export default async function PedidoDetailPage({
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

  const pedido = await getPedidoById(id)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto flex h-16 items-center gap-3 px-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/crm/viajante">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">Pedido #{pedido.numero_pedido}</h1>
            <p className="text-sm text-muted-foreground">{pedido.clientes.razon_social}</p>
          </div>
          <Badge className={STATUS_COLORS[pedido.status as keyof typeof STATUS_COLORS]}>
            {STATUS_LABELS[pedido.status as keyof typeof STATUS_LABELS]}
          </Badge>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-5xl space-y-6">
          {/* Order Info */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4" />
                  Información del Pedido
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Número:</span>
                  <span className="font-medium">{pedido.numero_pedido}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fecha:</span>
                  <span className="font-medium">{new Date(pedido.created_at).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}</span>
                </div>
                {pedido.fecha_entrega_estimada && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Entrega Estimada:</span>
                    <span className="font-medium">
                      {new Date(pedido.fecha_entrega_estimada).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estado:</span>
                  <Badge className={STATUS_COLORS[pedido.status as keyof typeof STATUS_COLORS]}>
                    {STATUS_LABELS[pedido.status as keyof typeof STATUS_LABELS]}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4" />
                  Información de Entrega
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  <p className="text-muted-foreground">Cliente:</p>
                  <p className="font-medium">{pedido.clientes.razon_social}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Dirección:</p>
                  <p className="font-medium">{pedido.clientes.direccion}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Zona:</p>
                  <Badge>{pedido.zona_entrega || pedido.clientes.zona}</Badge>
                </div>
                {pedido.clientes.telefono && (
                  <div>
                    <p className="text-muted-foreground">Teléfono:</p>
                    <p className="font-medium">{pedido.clientes.telefono}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Order Items */}
          <Card>
            <CardHeader>
              <CardTitle>Productos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {pedido.pedido_items.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg border border-border p-4">
                    <div className="flex-1">
                      <p className="font-medium">{item.productos.nombre}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>SKU: {item.productos.sku}</span>
                        <span>•</span>
                        <span>{item.productos.proveedores.nombre}</span>
                        <span>•</span>
                        <span>Cantidad: {item.cantidad}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">${Number(item.subtotal).toFixed(2)}</p>
                      <p className="text-sm text-muted-foreground">
                        ${Number(item.precio_unitario).toFixed(2)} c/u
                        {item.descuento > 0 && ` (-${item.descuento}%)`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Totals */}
          <Card>
            <CardHeader>
              <CardTitle>Resumen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal:</span>
                <span className="font-medium">${Number(pedido.subtotal).toFixed(2)}</span>
              </div>
              {pedido.descuento > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Descuento:</span>
                  <span className="font-medium text-green-600">-${Number(pedido.descuento).toFixed(2)}</span>
                </div>
              )}
              {pedido.iva > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">IVA:</span>
                  <span className="font-medium">${Number(pedido.iva).toFixed(2)}</span>
                </div>
              )}
              {pedido.percepciones > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Percepciones:</span>
                  <span className="font-medium">${Number(pedido.percepciones).toFixed(2)}</span>
                </div>
              )}
              {pedido.flete > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Flete:</span>
                  <span className="font-medium">${Number(pedido.flete).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-2 text-lg font-bold">
                <span>Total:</span>
                <span className="text-primary">${Number(pedido.total).toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Observations */}
          {pedido.observaciones && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" />
                  Observaciones
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{pedido.observaciones}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
