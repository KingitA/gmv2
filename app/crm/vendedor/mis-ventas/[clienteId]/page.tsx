import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { PedidosCliente } from "@/components/vendedor/pedidos-cliente"

export const dynamic = "force-dynamic"

export default async function PedidosClientePage({ params }: { params: { clienteId: string } }) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  const { data: usuario } = await supabase.from("usuarios_crm").select("*").eq("email", user.email).maybeSingle()

  if (!usuario || usuario.rol !== "vendedor") {
    redirect("/dashboard")
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <Link href="/vendedor/mis-ventas">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a Mis Ventas
          </Button>
        </Link>
      </div>

      <Suspense fallback={<div>Cargando pedidos...</div>}>
        <PedidosCliente clienteId={params.clienteId} vendedorId={usuario.vendedor_id} />
      </Suspense>
    </div>
  )
}
