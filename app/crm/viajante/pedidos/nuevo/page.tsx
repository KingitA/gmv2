export const dynamic = 'force-dynamic'
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getViajanteClientes } from "@/lib/actions/clientes"
import { PedidoForm } from "@/components/viajante/pedido-form"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default async function NuevoPedidoPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>
}) {
  const params = await searchParams
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

  const clientes = await getViajanteClientes()

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
            <h1 className="text-xl font-semibold">Nuevo Pedido</h1>
            <p className="text-sm text-muted-foreground">Levantar pedido de cliente</p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-5xl">
          <PedidoForm clientes={clientes} clienteIdInicial={params.cliente} />
        </div>
      </main>
    </div>
  )
}

