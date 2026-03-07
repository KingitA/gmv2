import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCatalogoForCliente } from "@/lib/actions/catalogo"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { CatalogoGrid } from "@/components/catalogo/catalogo-grid"

export const dynamic = "force-dynamic"

export default async function VendedorClienteCatalogoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: clienteId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  // Get cliente info
  const { data: cliente } = await supabase.from("clientes").select("*").eq("id", clienteId).single()

  if (!cliente) {
    redirect("/vendedor/clientes")
  }

  // Get catalogo from ERP
  const catalogoResult = await getCatalogoForCliente(clienteId)

  if (!catalogoResult.success || !catalogoResult.data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-4">{catalogoResult.error || "Error cargando catálogo"}</p>
          <Button asChild>
            <Link href="/vendedor/clientes">Volver a Clientes</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto flex h-16 items-center gap-4 px-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/vendedor/clientes">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">Catálogo para {cliente.razon_social || cliente.nombre}</h1>
            <p className="text-sm text-muted-foreground">
              {catalogoResult.data.metadata.total_articulos} productos disponibles
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-7xl">
          <CatalogoGrid articulos={catalogoResult.data.articulos} clienteId={clienteId} isVendedor={true} />
        </div>
      </main>
    </div>
  )
}
