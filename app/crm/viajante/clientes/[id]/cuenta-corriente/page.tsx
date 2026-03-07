import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getClienteById } from "@/lib/actions/clientes"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { ArrowLeft, TrendingUp, TrendingDown, Calendar } from "lucide-react"

export default async function CuentaCorrientePage({
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

  // Get cuenta corriente movements
  const { data: movimientos } = await supabase
    .from("cuenta_corriente")
    .select(`
      *,
      pedidos:pedido_id (
        numero_pedido
      )
    `)
    .eq("cliente_id", id)
    .order("fecha", { ascending: false })

  // Calculate current balance
  const saldoActual = movimientos?.[0]?.saldo || 0

  // Calculate totals
  const totalDebe = movimientos?.filter((m) => m.tipo === "debe").reduce((sum, m) => sum + Number(m.monto), 0) || 0
  const totalHaber = movimientos?.filter((m) => m.tipo === "haber").reduce((sum, m) => sum + Number(m.monto), 0) || 0

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto flex h-16 items-center gap-3 px-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/crm/viajante/clientes/${id}`}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Cuenta Corriente</h1>
            <p className="text-sm text-muted-foreground">{cliente.razon_social}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-5xl space-y-6">
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Saldo Actual</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${saldoActual < 0 ? "text-destructive" : "text-green-600"}`}>
                  ${Math.abs(saldoActual).toFixed(2)}
                </div>
                <p className="text-xs text-muted-foreground">{saldoActual < 0 ? "A favor del cliente" : "Debe"}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Debe</CardTitle>
                <TrendingUp className="h-4 w-4 text-destructive" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${totalDebe.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">Ventas realizadas</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Haber</CardTitle>
                <TrendingDown className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${totalHaber.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">Pagos recibidos</p>
              </CardContent>
            </Card>
          </div>

          {/* Credit Info */}
          <Card>
            <CardHeader>
              <CardTitle>Información de Crédito</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Límite de Crédito</p>
                <p className="text-2xl font-bold">${(cliente.limite_credito ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Crédito Disponible</p>
                <p className="text-2xl font-bold text-green-600">
                  ${Math.max(0, (cliente.limite_credito ?? 0) - saldoActual).toFixed(2)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Movements */}
          <Card>
            <CardHeader>
              <CardTitle>Movimientos</CardTitle>
            </CardHeader>
            <CardContent>
              {movimientos && movimientos.length > 0 ? (
                <div className="space-y-2">
                  {movimientos.map((mov) => (
                    <div key={mov.id} className="flex items-center justify-between rounded-lg border border-border p-4">
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{mov.concepto}</p>
                          {mov.pedidos && <Badge variant="secondary">Pedido #{mov.pedidos.numero_pedido}</Badge>}
                        </div>
                        <p className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {new Date(mov.fecha).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-xl font-bold ${mov.tipo === "debe" ? "text-destructive" : "text-green-600"}`}
                        >
                          {mov.tipo === "debe" ? "+" : "-"}${Number(mov.monto).toFixed(2)}
                        </p>
                        <p className="text-sm text-muted-foreground">Saldo: ${Number(mov.saldo).toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-muted-foreground">
                  <p>No hay movimientos registrados</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
