export const dynamic = 'force-dynamic'
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getViajanteClientes } from "@/lib/actions/clientes"
import { ClientesList } from "@/components/viajante/clientes-list"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Plus, ArrowLeft } from "lucide-react"

export default async function ClientesPage() {
  const supabase = await createClient()

  // Check authentication and roles
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect("/auth/login")
  }

  const { data: userRoles } = await supabase
    .from("usuarios_roles")
    .select("roles(nombre)")
    .eq("usuario_id", user.id)

  const roles = userRoles?.map((ur: any) => ur.roles?.nombre) || []

  // Allow access if user is viajante, vendedor, or admin context
  if (!roles.includes("viajante") && !roles.includes("vendedor") && !roles.includes("admin")) {
    redirect("/dashboard")
  }

  const clientes = await getViajanteClientes()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/crm/viajante">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-semibold">Mis Clientes</h1>
              <p className="text-sm text-muted-foreground">{clientes.length} clientes activos</p>
            </div>
          </div>
          <Button asChild>
            <Link href="/crm/viajante/clientes/nuevo">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Cliente
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-7xl">
          <ClientesList initialClientes={clientes} />
        </div>
      </main>
    </div>
  )
}

