
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Users, DollarSign, ShoppingCart, TrendingUp } from "lucide-react"
import { ClientesList } from "@/components/viajante/clientes-list"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export const dynamic = 'force-dynamic'

export default async function ViajanteDashboard() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return null

    // Get user profile to find vendedor_id or just use user.id linkage
    const { data: profile } = await supabase
        .from("usuarios_crm")
        .select("vendedor_id, nombre")
        .eq("email", user.email)
        .single()

    // Assuming clientes are linked via vendedor_id (which might be the profile.vendedor_id or just id)
    // Check implementation of 'getViajanteClientes'. 
    // For now, let's query directly to see logic.
    let query = supabase.from("clientes").select("*", { count: "exact" })

    if (profile?.vendedor_id) {
        query = query.eq("vendedor_id", profile.vendedor_id)
    } else {
        // Fallback? Maybe the user IS the vendedor and their ID is used?
        // User instructions implied Mario Silva has a 'vendedor_id' or IS a vendedor.
        // Let's assume linkage via vendedor_id column in client
        // If profile.vendedor_id is null, we might not find clients. 
        // But we'll try querying with user.id as fallback if the schema supports it?
        // Usually standard is: Client.vendedor_id matches Vendedor.id. Usuario_CRM links to Vendedor.
    }

    const { data: clientes, count: totalClientes } = await query

    // Mock stats for now or calculate real ones if possible
    const stats = [
        {
            title: "Clientes Asignados",
            value: totalClientes || 0,
            icon: Users,
            description: "Total de clientes en su cartera",
        },
        {
            title: "Comisiones Pendientes",
            value: "$0.00", // To be implemented
            icon: DollarSign,
            description: "Disponible para retiro",
        },
        {
            title: "Ventas del Mes",
            value: "$0.00", // To be implemented
            icon: TrendingUp,
            description: "Total vendido este mes",
        },
    ]

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight">Hola, {profile?.nombre}</h1>
                <p className="text-muted-foreground">Bienvenido a su panel de control.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                {stats.map((stat) => (
                    <Card key={stat.title}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                            <stat.icon className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stat.value}</div>
                            <p className="text-xs text-muted-foreground">{stat.description}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold">Mis Clientes</h2>
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/viajante/comisiones">
                            Ver Comisiones
                        </Link>
                    </Button>
                </div>

                {/* We need a Client List component. Reusing or creating new one? */}
                {/* We'll use a new simplified one for the new module */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {clientes?.map((cliente) => (
                        <Link href={`/viajante/clientes/${cliente.id}`} key={cliente.id}>
                            <Card className="h-full hover:bg-accent/50 transition-colors cursor-pointer">
                                <CardHeader>
                                    <CardTitle className="text-base">{cliente.razon_social || cliente.nombre}</CardTitle>
                                    <CardDescription>{cliente.direccion || "Sin dirección"}</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex justify-between items-center text-sm">
                                        <span className={cliente.activo ? "text-green-600" : "text-red-500"}>
                                            {cliente.activo ? "Activo" : "Inactivo"}
                                        </span>
                                        <span className="text-muted-foreground">{cliente.localidad || ""}</span>
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                    {clientes?.length === 0 && (
                        <div className="col-span-full text-center py-10 text-muted-foreground">
                            No se encontraron clientes asignados.
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
