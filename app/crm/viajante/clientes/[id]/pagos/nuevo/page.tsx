import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getClienteById } from "@/lib/actions/clientes"
import { PagoForm } from "@/components/viajante/pago-form"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default async function NuevoPagoPage({
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

  // Get current balance
  const { data: cuentaCorriente } = await supabase
    .from("cuenta_corriente")
    .select("saldo")
    .eq("cliente_id", id)
    .single()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto flex h-16 items-center gap-3 px-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/crm/viajante/clientes/${id}/pagos`}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Registrar Pago</h1>
            <p className="text-sm text-muted-foreground">{cliente.razon_social}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-2xl">
          <PagoForm clienteId={id} saldoActual={cuentaCorriente?.saldo || 0} />
        </div>
      </main>
    </div>
  )
}
