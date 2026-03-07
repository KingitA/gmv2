import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getPagosPendientes } from "@/lib/actions/pagos"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ApprovePaymentButton } from "@/components/admin/approve-payment-button"
import { DollarSign, Calendar, CreditCard, AlertCircle } from "lucide-react"

// Force dynamic rendering to avoid build-time prerendering
export const dynamic = "force-dynamic"

export default async function AdminPagosPage() {
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

  const pagosPendientes = await getPagosPendientes()

  const totalPendiente = pagosPendientes.reduce((sum, p) => sum + Number(p.monto), 0)

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
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold">Gestión de Pagos</h1>
          <p className="text-muted-foreground">Aprobar y gestionar pagos pendientes</p>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-6xl space-y-6">
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-orange-500" />
                Pagos Pendientes de Aprobación
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total pendiente:</span>
                <span className="text-3xl font-bold text-orange-600">${totalPendiente.toFixed(2)}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{pagosPendientes.length} pagos por revisar</p>
            </CardContent>
          </Card>

          {/* Payments List */}
          {pagosPendientes.length > 0 ? (
            <div className="space-y-4">
              {pagosPendientes.map((pago) => (
                <Card key={pago.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-3">
                        <div>
                          <h3 className="text-lg font-semibold">{pago.clientes?.razon_social}</h3>
                          <p className="text-sm text-muted-foreground">Zona: {pago.clientes?.zona}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-sm">
                          <div className="flex items-center gap-2">
                            {getMetodoIcon(pago.metodo)}
                            <span className="capitalize">{pago.metodo}</span>
                          </div>
                          {pago.referencia && <Badge variant="outline">Ref: {pago.referencia}</Badge>}
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {new Date(pago.fecha_pago).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                          </div>
                        </div>

                        {pago.viajante && (
                          <p className="text-sm text-muted-foreground">
                            Registrado por: {pago.viajante.nombre_completo}
                          </p>
                        )}

                        {pago.observaciones && (
                          <div className="rounded-md bg-muted p-3">
                            <p className="text-sm">{pago.observaciones}</p>
                          </div>
                        )}
                      </div>

                      <div className="ml-6 text-right">
                        <p className="mb-4 text-3xl font-bold text-green-600">${Number(pago.monto).toFixed(2)}</p>
                        <ApprovePaymentButton pagoId={pago.id} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <DollarSign className="mx-auto mb-4 h-12 w-12 opacity-50" />
                <p className="text-lg font-medium">No hay pagos pendientes</p>
                <p className="text-sm">Todos los pagos han sido procesados</p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
