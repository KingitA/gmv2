export const dynamic = 'force-dynamic'

import { createClient } from "@/lib/supabase/server"
import { redirect } from 'next/navigation'
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Package, Truck, LogOut } from "lucide-react"

export default async function DepositoLandingPage() {
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
          <p className="text-sm mb-4">Tu rol actual: {profile?.rol || "Sin rol"}</p>
          <form action="/api/auth/signout" method="POST">
            <Button type="submit">Cerrar sesión</Button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="border-b bg-background sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div>
            <h1 className="text-xl font-bold">Depósito Central</h1>
            <p className="text-sm text-muted-foreground">Bienvenido, {profile.nombre || profile.email}</p>
          </div>
          <form action="/api/auth/signout" method="POST">
            <Button variant="outline" size="sm" className="gap-2">
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </Button>
          </form>
        </div>
      </header>

      <main className="flex-1 container mx-auto p-4 flex items-center justify-center">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl w-full">
          {/* Botón para Preparar Pedidos */}
          <Link href="/deposito/pedidos" className="group">
            <div className="bg-card hover:bg-accent/50 border rounded-xl p-8 h-64 flex flex-col items-center justify-center text-center transition-all shadow-sm hover:shadow-md cursor-pointer group-hover:scale-105">
              <div className="bg-primary/10 p-4 rounded-full mb-6 group-hover:bg-primary/20 transition-colors">
                <Package className="h-12 w-12 text-primary" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Preparar Pedidos</h2>
              <p className="text-muted-foreground">
                Ver lista de pedidos pendientes, realizar picking y preparar envíos.
              </p>
            </div>
          </Link>

          {/* Botón para Recibir Mercadería */}
          <Link href="/deposito/recepcion" className="group">
            <div className="bg-card hover:bg-accent/50 border rounded-xl p-8 h-64 flex flex-col items-center justify-center text-center transition-all shadow-sm hover:shadow-md cursor-pointer group-hover:scale-105">
              <div className="bg-green-100 p-4 rounded-full mb-6 group-hover:bg-green-200 transition-colors">
                <Truck className="h-12 w-12 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold mb-2 text-green-700">Recibir Mercadería</h2>
              <p className="text-muted-foreground">
                Ingresar mercadería de proveedores, escanear remitos y actualizar stock.
              </p>
            </div>
          </Link>
        </div>
      </main>
    </div>
  )
}

