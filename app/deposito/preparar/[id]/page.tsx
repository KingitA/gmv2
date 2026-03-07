import { redirect } from 'next/navigation'
import { createClient } from "@/lib/supabase/server"
import { PreparacionPedido } from "@/components/deposito-picking/preparacion-pedido"
import { Button } from "@/components/ui/button"

export default async function PreparacionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect("/deposito/login")
  }

  // Get user profile with role
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle()

  // Check if user has deposito role
  if (!profile || profile.rol !== "deposito") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Acceso Denegado</h2>
          <p className="text-muted-foreground mb-4">No tienes permisos para acceder al módulo de depósito.</p>
          <form action="/api/auth/signout" method="POST">
            <Button type="submit">Cerrar sesión</Button>
          </form>
        </div>
      </div>
    )
  }

  const { data: pedido } = await supabase
    .from("pedidos")
    .select(`
      *,
      cliente:clientes(nombre, localidad)
    `)
    .eq("id", id)
    .single()

  if (!pedido || !["pendiente", "en_preparacion"].includes(pedido.estado)) {
    redirect("/deposito")
  }

  const { data: items } = await supabase
    .from("pedidos_detalle")
    .select(`
      *,
      articulo:articulos(id, sku, descripcion, ean13)
    `)
    .eq("pedido_id", id)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PreparacionPedido 
        pedidoId={id} 
        initialPedido={pedido} 
        initialItems={items || []}
        userId={user.id}
        userEmail={user.email || ""}
      />
    </div>
  )
}
