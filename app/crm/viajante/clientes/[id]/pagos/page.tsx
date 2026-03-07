import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getClienteById } from "@/lib/actions/clientes"
import { getPagosByCliente } from "@/lib/actions/pagos"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { ArrowLeft, Plus, DollarSign, Calendar, CreditCard } from "lucide-react"

export default async function PagosPage({
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
  const pagos = await getPagosByCliente(id)

  // Calculate totals
  const totalPagos = pagos.reduce((sum, p) => sum + Number(p.monto), 0)
  const pagosPendientes = pagos.filter((p) => p.status === "pendiente").length
  const pagosAprobados = pagos.filter((p) => p.status === "aprobado").length

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      pendiente: "secondary",
      aprobado: "default",
      rechazado: "destructive",
    }
    return <Badge variant={variants[status] || "default"}>{status.toUpperCase()}</Badge>
  }

  const getMetodoIcon = (metodo: string) => {
    switch (metodo) {
      case "efectivo":
        return <DollarSign className="h-4 w-4" />
      case "transferencia":
      case "cheque":
      case "tarjeta":
        return <CreditCard className="h-4 w-4" />
      default:
        return <DollarSign className="h-4 w-4" />
    }
  }

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
              <h1 className="text-xl font-semibold">Pagos</h1>
              <p className="text-sm text-muted-foreground">{cliente.razon_social}</p>
            </div>
          </div>
          <Button asChild>
            <Link href={`/crm/viajante/clientes/${id}/pagos/nuevo`}>
              <Plus className="mr-2 h-4 w-4" />
              Registrar Pago
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
                <CardTitle className="text-sm font-medium">Total Pagos</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${totalPagos.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">{pagos.length} pagos registrados</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{pagosPendientes}</div>
                <p className="text-xs text-muted-foreground">Por aprobar</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Aprobados</CardTitle>
                <CreditCard className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{pagosAprobados}</div>
                <p className="text-xs text-muted-foreground">Confirmados</p>
              </CardContent>
            </Card>
          </div>

          {/* Payments List */}
          <Card>
            <CardHeader>
              <CardTitle>Historial de Pagos</CardTitle>
            </CardHeader>
            <CardContent>
              {pagos.length > 0 ? (
                <div className="space-y-3">
                  {pagos.map((pago) => (
                    <div
                      key={pago.id}
                      className="flex items-center justify-between rounded-lg border border-border p-4"
                    >
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          {getMetodoIcon(pago.metodo)}
                          <p className="font-medium capitalize">{pago.metodo}</p>
                          {pago.referencia && <Badge variant="outline">Ref: {pago.referencia}</Badge>}
                          {getStatusBadge(pago.status)}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(pago.fecha_pago).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                          </span>
                          {pago.viajante && <span>Registrado por: {pago.viajante.nombre_completo}</span>}
                        </div>
                        {pago.observaciones && <p className="text-sm text-muted-foreground">{pago.observaciones}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-green-600">${Number(pago.monto).toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-muted-foreground">
                  <DollarSign className="mx-auto mb-4 h-12 w-12" />
                  <p className="mb-2 text-lg font-medium">No hay pagos registrados</p>
                  <p className="text-sm">Registra el primer pago de este cliente</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
