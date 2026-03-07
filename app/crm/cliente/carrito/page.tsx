export const dynamic = 'force-dynamic'
import { getClienteInfo } from "@/lib/actions/cliente"
import { CarritoContent } from "@/components/cliente/carrito-content"

export default async function CarritoPage() {
  const { cliente } = await getClienteInfo()

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-foreground">Carrito de Compras</h1>
          <p className="text-muted-foreground">Revisa y confirma tu pedido</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <CarritoContent cliente={cliente} />
      </div>
    </div>
  )
}

