export const dynamic = 'force-dynamic'
import { getClienteCuentaCorriente, getClienteInfo } from "@/lib/actions/cliente"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowDownCircle, ArrowUpCircle, Calendar } from "lucide-react"

export default async function ClienteCuentaCorrientePage() {
  const movimientos = await getClienteCuentaCorriente()
  const { cliente } = await getClienteInfo()

  const saldoActual = movimientos[0]?.saldo_resultante || 0

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-foreground">Cuenta Corriente</h1>
          <p className="text-muted-foreground">Estado de cuenta y movimientos</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Saldo Actual</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-primary">${saldoActual.toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Límite de Crédito</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">${(cliente.limite_credito || 0).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Crédito Disponible</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-green-600">
                ${((cliente.limite_credito || 0) - saldoActual).toFixed(2)}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Movimientos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {movimientos.map((mov) => (
                <div key={mov.id} className="flex items-center justify-between border-b pb-4 last:border-0">
                  <div className="flex items-center gap-4">
                    {mov.tipo === "debe" ? (
                      <ArrowUpCircle className="h-8 w-8 text-red-500" />
                    ) : (
                      <ArrowDownCircle className="h-8 w-8 text-green-500" />
                    )}
                    <div>
                      <p className="font-medium">{mov.concepto}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {new Date(mov.fecha).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                      </div>
                      {mov.referencia && <p className="text-xs text-muted-foreground">Ref: {mov.referencia}</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold ${mov.tipo === "debe" ? "text-red-600" : "text-green-600"}`}>
                      {mov.tipo === "debe" ? "+" : "-"}${mov.importe.toFixed(2)}
                    </p>
                    <p className="text-sm text-muted-foreground">Saldo: ${mov.saldo_resultante.toFixed(2)}</p>
                  </div>
                </div>
              ))}

              {movimientos.length === 0 && (
                <div className="py-12 text-center">
                  <p className="text-muted-foreground">No hay movimientos registrados</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

