import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { ClienteSelector } from "@/components/vendedor/cliente-selector"

// Force dynamic rendering to avoid build-time prerendering
export const dynamic = "force-dynamic"

export default async function NuevoPedidoPage() {
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

  // Get vendedor's clientes
  const { data: clientes } = await supabase
    .from("clientes")
    .select("*")
    .eq("vendedor_id", usuarioCrm.vendedor_id)
    .eq("activo", true)
    .order("razon_social")

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
            <h1 className="text-xl font-semibold">Realizar Pedido</h1>
            <p className="text-sm text-muted-foreground">Selecciona un cliente para comenzar</p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <div className="container mx-auto max-w-4xl">
          <Card>
            <CardHeader>
              <CardTitle>Seleccionar Cliente</CardTitle>
            </CardHeader>
            <CardContent>
              <ClienteSelector clientes={clientes || []} vendedorId={usuarioCrm.vendedor_id || ""} />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
