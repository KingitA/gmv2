import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getClienteById } from "@/lib/actions/clientes"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { ArrowLeft, MapPin, Phone, Mail, FileText, DollarSign, Package, Edit } from "lucide-react"

export default async function ClienteDetailPage({
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

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/crm/viajante/clientes">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-semibold">{cliente.razon_social}</h1>
              <p className="text-sm text-muted-foreground">Detalles del cliente</p>
            </div>
          </div>
          <Button variant="outline" asChild>
            <Link href={`/crm/viajante/clientes/${id}/editar`}>
              <Edit className="mr-2 h-4 w-4" />
              Editar
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-4xl space-y-6">
          {/* Client Info */}
          <Card>
            <CardHeader>
              <CardTitle>Información del Cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Razón Social</p>
                  <p className="text-base">{cliente.razon_social}</p>
                </div>
                {cliente.cuit && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">CUIT</p>
                    <p className="text-base">{cliente.cuit}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Dirección</p>
                  <p className="flex items-center gap-2 text-base">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    {cliente.direccion}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Zona</p>
                  <Badge>{cliente.zona}</Badge>
                </div>
                {cliente.telefono && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Teléfono</p>
                    <p className="flex items-center gap-2 text-base">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      {cliente.telefono}
                    </p>
                  </div>
                )}
                {cliente.email && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Email</p>
                    <p className="flex items-center gap-2 text-base">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      {cliente.email}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Commercial Conditions */}
          <Card>
            <CardHeader>
              <CardTitle>Condiciones Comerciales</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Días de Crédito</p>
                  <p className="text-2xl font-bold">{cliente.dias_credito ?? 0}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Límite de Crédito</p>
                  <p className="text-2xl font-bold">${(cliente.limite_credito ?? 0).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Descuento Especial</p>
                  <p className="text-2xl font-bold">{cliente.descuento_especial ?? 0}%</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Condición IVA</p>
                  <Badge variant="outline" className="capitalize">
                    {(cliente.condicion_iva ?? 'consumidor_final').replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Button asChild className="h-auto flex-col gap-2 py-4">
              <Link href={`/crm/viajante/pedidos/nuevo?cliente=${id}`}>
                <Package className="h-6 w-6" />
                <span>Levantar Pedido</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto flex-col gap-2 py-4 bg-transparent">
              <Link href={`/crm/viajante/clientes/${id}/cuenta-corriente`}>
                <DollarSign className="h-6 w-6" />
                <span>Cuenta Corriente</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto flex-col gap-2 py-4 bg-transparent">
              <Link href={`/crm/viajante/clientes/${id}/pedidos`}>
                <FileText className="h-6 w-6" />
                <span>Ver Pedidos</span>
              </Link>
            </Button>
          </div>

          {/* Observations */}
          {cliente.observaciones && (
            <Card>
              <CardHeader>
                <CardTitle>Observaciones</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{cliente.observaciones}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
