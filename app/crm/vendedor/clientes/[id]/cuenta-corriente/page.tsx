import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { ArrowLeft, Package } from "lucide-react"
import { CuentaCorrienteTable } from "@/components/vendedor/cuenta-corriente-table"
import { RegistrarPagoDialog } from "@/components/vendedor/registrar-pago-dialog"
import { MercaderiaVendidaDialog } from "@/components/vendedor/mercaderia-vendida-dialog"

export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CuentaCorrientePage({ params }: PageProps) {
  const { id: clienteId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  const { data: usuarioCrm } = await supabase.from("usuarios_crm").select("*").eq("email", user.email).maybeSingle()

  if (!usuarioCrm || usuarioCrm.estado !== "activo" || usuarioCrm.rol !== "vendedor") {
    redirect("/dashboard")
  }

  // Get cliente data
  const { data: cliente } = await supabase
    .from("clientes")
    .select("*")
    .eq("id", clienteId)
    .eq("vendedor_id", usuarioCrm.vendedor_id)
    .single()

  if (!cliente) {
    redirect("/vendedor")
  }

  // Fetch cuenta corriente from ERP
  const erpUrl = process.env.NEXT_PUBLIC_ERP_URL
  const cuentaCorrienteResponse = await fetch(`${erpUrl}/api/cuenta-corriente?cliente_id=${clienteId}`, {
    cache: "no-store",
  })

  let cuentaCorriente = null
  if (cuentaCorrienteResponse.ok) {
    cuentaCorriente = await cuentaCorrienteResponse.json()
  }

  const saldo = cuentaCorriente?.cliente?.saldo_actual || 0
  const estadoCuenta = saldo === 0 ? "libre" : saldo < 0 ? "debe" : "a_favor"

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto flex h-16 items-center gap-4 px-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/vendedor">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">Cuenta Corriente</h1>
            <p className="text-sm text-muted-foreground">{cliente.razon_social || cliente.nombre}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-7xl space-y-6">
          {/* Resumen */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Saldo Actual</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ${Math.abs(saldo).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                </div>
                <div className="mt-2">
                  {estadoCuenta === "libre" && (
                    <Badge variant="default" className="bg-green-500">
                      Libre de Deuda
                    </Badge>
                  )}
                  {estadoCuenta === "debe" && <Badge variant="destructive">Cliente Debe</Badge>}
                  {estadoCuenta === "a_favor" && <Badge variant="secondary">Saldo a Favor</Badge>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Debe</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ${(cuentaCorriente?.resumen?.total_debe || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                </div>
                <p className="text-xs text-muted-foreground">Compras realizadas</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Haber</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ${(cuentaCorriente?.resumen?.total_haber || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                </div>
                <p className="text-xs text-muted-foreground">Pagos realizados</p>
              </CardContent>
            </Card>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <RegistrarPagoDialog clienteId={clienteId} vendedorId={usuarioCrm.vendedor_id || ""} />
            <MercaderiaVendidaDialog clienteId={clienteId} />
            <Button variant="outline" asChild>
              <Link href={`/vendedor/clientes/${clienteId}/devoluciones/nueva`}>
                <Package className="mr-2 h-4 w-4" />
                Crear Devolución
              </Link>
            </Button>
          </div>

          {/* Movimientos */}
          <Card>
            <CardHeader>
              <CardTitle>Movimientos</CardTitle>
            </CardHeader>
            <CardContent>
              {cuentaCorriente?.movimientos ? (
                <CuentaCorrienteTable movimientos={cuentaCorriente.movimientos} />
              ) : (
                <p className="text-center text-muted-foreground py-8">No se pudieron cargar los movimientos</p>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
