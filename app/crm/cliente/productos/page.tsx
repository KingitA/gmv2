export const dynamic = 'force-dynamic'

import { getProductos } from "@/lib/actions/productos"
import { getClienteInfo } from "@/lib/actions/cliente"
import { ProductosGrid } from "@/components/cliente/productos-grid"
import { Button } from "@/components/ui/button"
import { ShoppingCart } from "lucide-react"
import Link from "next/link"

export default async function ClienteProductosPage() {
  const productos = await getProductos()
  const { cliente } = await getClienteInfo()

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto flex items-center justify-between px-4 py-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Catálogo de Productos</h1>
            <p className="text-muted-foreground">Explora nuestros productos y agrega al carrito</p>
          </div>
          <Button asChild size="lg">
            <Link href="/cliente/carrito">
              <ShoppingCart className="mr-2 h-5 w-5" />
              Ver Carrito
            </Link>
          </Button>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <ProductosGrid productos={productos} cliente={cliente} />
      </div>
    </div>
  )
}
