export const dynamic = 'force-dynamic'

import { createClient } from "@/lib/supabase/server"
import { redirect } from 'next/navigation'
import { PedidosLista } from "@/components/deposito-picking/pedidos-lista"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default async function DepositoPedidosPage() {
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

    // Fetch pedidos
    const { data: pedidos } = await supabase
        .from("pedidos")
        .select(`
      *,
      cliente:clientes(nombre, localidad),
      pedidos_detalle(id)
    `)
        .in("estado", ["pendiente", "en_preparacion"])
        .order("prioridad", { ascending: true })
        .order("fecha", { ascending: true })

    return (
        <div className="flex min-h-screen flex-col bg-muted/30">
            <header className="border-b bg-background sticky top-0 z-10 shadow-sm">
                <div className="container mx-auto flex h-16 items-center justify-between px-4">
                    <div className="flex items-center gap-4">
                        <Link href="/deposito">
                            <Button variant="ghost" size="icon">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-xl font-bold">Preparación de Pedidos</h1>
                            <p className="text-sm text-muted-foreground">{profile.nombre || profile.email}</p>
                        </div>
                    </div>
                    <form action="/api/auth/signout" method="POST">
                        <Button variant="outline" size="sm">Cerrar sesión</Button>
                    </form>
                </div>
            </header>
            <main className="flex-1 container mx-auto p-4 max-w-4xl">
                <PedidosLista initialPedidos={pedidos || []} userId={user.id} userEmail={user.email || ""} />
            </main>
        </div>
    )
}

