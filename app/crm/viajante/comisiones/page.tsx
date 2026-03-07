export const dynamic = 'force-dynamic'
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { ArrowLeft, DollarSign, TrendingUp, Calendar, CheckCircle, Clock } from "lucide-react"

export default async function ComisionesPage() {
  const supabase = await createClient()

  // DESARROLLO: Autenticación deshabilitada
  // const {
  //   data: { user },
  // } = await supabase.auth.getUser()
  // if (!user) {
  //   redirect("/auth/login")
  // }

  // const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single()

  // if (profile?.role !== "viajante") {
  //   redirect("/dashboard")
  // }

  // Mock user for development
  const user = { id: "dev-user" }

  // Get all commissions
  const { data: comisiones } = await supabase
    .from("comisiones")
    .select(`
      *,
      pedidos:pedido_id (
        numero_pedido,
        total,
        clientes:cliente_id (
          razon_social
        )
      )
    `)
    .eq("viajante_id", user.id)
    .order("created_at", { ascending: false })

  // Calculate totals
  const pendientes = comisiones?.filter((c) => !c.pagado) || []
  const pagadas = comisiones?.filter((c) => c.pagado) || []
  const totalPendiente = pendientes.reduce((sum, c) => sum + Number(c.monto), 0)
  const totalPagado = pagadas.reduce((sum, c) => sum + Number(c.monto), 0)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto flex h-16 items-center gap-3 px-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/crm/viajante">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Mis Comisiones</h1>
            <p className="text-sm text-muted-foreground">Historial de comisiones</p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-6xl space-y-6">
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Pendiente</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${totalPendiente.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">{pendientes.length} comisiones</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Pagado</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${totalPagado.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">{pagadas.length} comisiones</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total General</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
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
                  <Clock className="h-5 w-5" />
                  Comisiones Pendientes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pendientes.map((comision) => (
                    <div
                      key={comision.id}
                      className="flex items-center justify-between rounded-lg border border-border p-4"
                    >
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">
                            {comision.pedidos?.clientes?.razon_social || "Cliente desconocido"}
                          </p>
                          <Badge variant="secondary">Pedido #{comision.pedidos?.numero_pedido}</Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(comision.created_at).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                          </span>
                          <span>{comision.porcentaje}% de comisión</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-primary">${Number(comision.monto).toFixed(2)}</p>
                        <Badge variant="outline" className="mt-1">
                          Pendiente
                        </Badge>
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
                  <CheckCircle className="h-5 w-5" />
                  Comisiones Pagadas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pagadas.map((comision) => (
                    <div
                      key={comision.id}
                      className="flex items-center justify-between rounded-lg border border-border p-4 opacity-75"
                    >
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">
                            {comision.pedidos?.clientes?.razon_social || "Cliente desconocido"}
                          </p>
                          <Badge variant="secondary">Pedido #{comision.pedidos?.numero_pedido}</Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Pagado:{" "}
                            {comision.fecha_pago ? new Date(comision.fecha_pago).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' }) : "N/A"}
                          </span>
                          <span>{comision.porcentaje}% de comisión</span>
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

          {comisiones?.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <DollarSign className="mx-auto mb-4 h-12 w-12 opacity-50" />
                <p>No hay comisiones registradas aún</p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}

