import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { PedidoBuilder } from "@/components/vendedor/pedido-builder"
import { Button } from "@/components/ui/button"
import { ChevronLeft } from "lucide-react"
import Link from "next/link"
import { erpClient } from "@/lib/api/erp-client"

export default async function EditarPedidoPage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: usuarioCRM } = await supabase
    .from("usuarios_crm")
    .select("id, email, rol, vendedor_id")
    .eq("email", user.email)
    .single()

  if (!usuarioCRM || usuarioCRM.rol !== "vendedor") {
    redirect("/")
  }

  console.log("[v0] Fetching pedido from ERP for editing")
  const pedidos = await erpClient.get(`/api/pedidos?vendedor_id=${usuarioCRM.vendedor_id}`)
  console.log("[v0] Pedidos fetched:", pedidos?.length || 0)

  const pedido = pedidos?.find((p: any) => p.id === params.id)

  if (!pedido) {
    return (
      <div className="container py-6">
        <Link href="/vendedor/mis-ventas">
          <Button variant="ghost" className="mb-4">
            <ChevronLeft className="mr-2 h-4 w-4" />
            Volver a Mis Ventas
          </Button>
        </Link>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Pedido no encontrado</p>
        </div>
      </div>
    )
  }

  if (pedido.estado !== "pendiente") {
    redirect(`/vendedor/mis-ventas/pedido/${params.id}`)
  }

  const cliente = {
    id: pedido.cliente_id,
    nombre: pedido.cliente_nombre,
    razon_social: pedido.razon_social_factura || pedido.cliente_nombre,
    direccion: pedido.direccion_entrega || "",
    localidad: pedido.cliente_localidad || "",
    metodo_facturacion: pedido.forma_facturacion || "factura",
  }

  console.log("[v0] Rendering PedidoBuilder with pedido:", pedido.numero)

  return (
    <div className="container py-6">
      <Link href="/vendedor/mis-ventas">
        <Button variant="ghost" className="mb-4">
          <ChevronLeft className="mr-2 h-4 w-4" />
          Volver a Mis Ventas
        </Button>
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Editar Pedido #{pedido.numero}</h1>
        <p className="text-muted-foreground">{pedido.cliente_nombre}</p>
      </div>

      <PedidoBuilder cliente={cliente as any} vendedorId={usuarioCRM.vendedor_id} pedidoExistente={pedido} />
    </div>
  )
}
