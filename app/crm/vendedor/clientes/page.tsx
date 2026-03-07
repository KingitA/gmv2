import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getVendedorClientes } from "@/lib/actions/catalogo"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft, AlertCircle } from "lucide-react"
import { ClientesListVendedor } from "@/components/vendedor/clientes-list-vendedor"

// Force dynamic rendering to avoid build-time prerendering
export const dynamic = "force-dynamic"

export default async function VendedorClientesPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  const clientesResult = await getVendedorClientes()
  const clientes = clientesResult.data || []
  const hasError = !clientesResult.success

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto flex h-16 items-center gap-4 px-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/vendedor">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Mis Clientes</h1>
            <p className="text-sm text-muted-foreground">{clientes.length} clientes activos</p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-7xl">
          {hasError && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive mb-4">
              <AlertCircle className="h-5 w-5" />
              <p className="text-sm">Error al cargar clientes: {clientesResult.error}</p>
            </div>
          )}
          <ClientesListVendedor clientes={clientes} />
        </div>
      </main>
    </div>
  )
}
