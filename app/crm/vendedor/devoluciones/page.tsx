import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Package } from "lucide-react"
import Link from "next/link"
import { DevolucionesManager } from "@/components/vendedor/devoluciones-manager"

export const dynamic = "force-dynamic"

export default async function DevolucionesPage() {
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
        <Link href="/vendedor">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver al Dashboard
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Package className="h-8 w-8 text-primary" />
            <div>
              <CardTitle>Gestión de Devoluciones</CardTitle>
              <CardDescription>Busca artículos facturados previamente y genera órdenes de devolución</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<div>Cargando...</div>}>
            <DevolucionesManager vendedorId={usuario.id} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  )
}
