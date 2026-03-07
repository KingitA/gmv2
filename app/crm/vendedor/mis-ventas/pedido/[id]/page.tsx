import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { DetallePedido } from "@/components/vendedor/detalle-pedido"

export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function DetallePedidoPage({ params }: PageProps) {
  const { id } = await params

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  const { data: usuario } = await supabase
    .from("usuarios_crm")
    .select("rol, vendedor_id")
    .eq("email", user.email)
    .single()

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

      <Card>
        <CardHeader>
          <CardTitle>Detalle del Pedido</CardTitle>
        </CardHeader>
        <CardContent>
          <DetallePedido pedidoId={id} vendedorId={usuario.vendedor_id} />
        </CardContent>
      </Card>
    </div>
  )
}
