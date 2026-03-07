import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { PedidoBuilder } from "@/components/vendedor/pedido-builder"

// Force dynamic rendering to avoid build-time prerendering
export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ clienteId: string }>
}

export default async function NuevoPedidoClientePage({ params }: PageProps) {
  const { clienteId } = await params
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
    redirect("/vendedor/pedidos/nuevo")
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/50 bg-card">
        <div className="container mx-auto flex h-16 items-center gap-4 px-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/vendedor/pedidos/nuevo">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Cambiar Cliente
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">Nuevo Pedido</h1>
            <p className="text-sm text-muted-foreground">{cliente.razon_social || cliente.nombre}</p>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <PedidoBuilder cliente={cliente} vendedorId={usuarioCrm.vendedor_id || ""} />
      </main>
    </div>
  )
}
