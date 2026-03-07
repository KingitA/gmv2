import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MarkCommissionPaidButton } from "@/components/admin/mark-commission-paid-button"
import { DollarSign, Calendar, Clock, CheckCircle } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function AdminComisionesPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect("/auth/login")
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

  if (profile?.role !== "admin") {
    redirect("/dashboard")
  }

  // Get all commissions
  const { data: comisiones } = await supabase
    .from("comisiones")
    .select(`
      *,
      viajante:viajante_id(nombre_completo, codigo_viajante),
      pedidos:pedido_id(
        numero_pedido,
        total,
        clientes:cliente_id(razon_social)
      )
    `)
    .order("created_at", { ascending: false })

  const pendientes = comisiones?.filter((c) => !c.pagado) || []
  const pagadas = comisiones?.filter((c) => c.pagado) || []
  const totalPendiente = pendientes.reduce((sum, c) => sum + Number(c.monto), 0)
  const totalPagado = pagadas.reduce((sum, c) => sum + Number(c.monto), 0)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold">Gestión de Comisiones</h1>
          <p className="text-muted-foreground">Administrar comisiones de viajantes</p>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-6xl space-y-6">
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">${totalPendiente.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">{pendientes.length} comisiones</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pagadas</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">${totalPagado.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">{pagadas.length} comisiones</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${(totalPendiente + totalPagado).toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">{comisiones?.length || 0} comisiones</p>
              </CardContent>
            </Card>
          </div>

          {/* Pending Commissions */}
          {pendientes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-orange-500" />
                  Comisiones Pendientes de Pago
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pendientes.map((comision) => (
                    <div
                      key={comision.id}
                      className="flex items-center justify-between rounded-lg border border-border p-4"
                    >
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{comision.viajante?.nombre_completo}</p>
                          <Badge variant="secondary">{comision.viajante?.codigo_viajante}</Badge>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">Cliente:</span>
                          <span>{comision.pedidos?.clientes?.razon_social}</span>
                          <Badge variant="outline">Pedido #{comision.pedidos?.numero_pedido}</Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(comision.created_at).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                          </span>
                          <span>
                            {comision.porcentaje}% sobre ${Number(comision.pedidos?.total || 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <div className="ml-6 flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-2xl font-bold text-primary">${Number(comision.monto).toFixed(2)}</p>
                        </div>
                        <MarkCommissionPaidButton comisionId={comision.id} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Paid Commissions */}
          {pagadas.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  Comisiones Pagadas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pagadas.slice(0, 10).map((comision) => (
                    <div
                      key={comision.id}
                      className="flex items-center justify-between rounded-lg border border-border p-4 opacity-75"
                    >
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{comision.viajante?.nombre_completo}</p>
                          <Badge variant="secondary">{comision.viajante?.codigo_viajante}</Badge>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">Cliente:</span>
                          <span>{comision.pedidos?.clientes?.razon_social}</span>
                          <Badge variant="outline">Pedido #{comision.pedidos?.numero_pedido}</Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Pagado:{" "}
                            {comision.fecha_pago ? new Date(comision.fecha_pago).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' }) : "N/A"}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold">${Number(comision.monto).toFixed(2)}</p>
                        <Badge className="mt-1 bg-green-500/10 text-green-700 hover:bg-green-500/20">Pagado</Badge>
                      </div>
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
