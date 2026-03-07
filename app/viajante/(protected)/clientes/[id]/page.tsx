
import { createClient } from "@/lib/supabase/server"
import { notFound, redirect } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft, ShoppingCart, FileText, RefreshCcw, History, Wallet } from "lucide-react"

export default async function DetalleClientePage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const supabase = await createClient()

    // Verify User
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/viajante/login")

    const { data: profile } = await supabase
        .from("usuarios_crm")
        .select("vendedor_id")
        .eq("email", user.email)
        .single()

    // Verify Client belongs to Viajante
    const { data: cliente } = await supabase
        .from("clientes")
        .select("*")
        .eq("id", id)
        .single()

    if (!cliente) return notFound()

    // Security Check: If viajnate has VendedorID, must match
    if (profile?.vendedor_id && cliente.vendedor_id !== profile.vendedor_id) {
        // Optional: Return unauthorized UI or redirect
        return (
            <div className="container mx-auto p-4 flex flex-col items-center justify-center gap-4">
                <h1 className="text-2xl font-bold text-destructive">No autorizado</h1>
                <p>Este cliente no está asignado a su cuenta.</p>
                <Button asChild>
                    <Link href="/viajante">Volver al Inicio</Link>
                </Button>
            </div>
        )
    }

    // Get Client Balance (Mock or real query)
    // Need to implement 'getSaldoCliente' logic
    // For now placeholder
    const saldo = 0 // To replace with real calculation

    const actions = [
        {
            title: "Nuevo Pedido",
            href: `/viajante/clientes/${id}/pedidos/nuevo`,
            icon: ShoppingCart,
            color: "bg-blue-100 text-blue-700",
            desc: "Crear un nuevo pedido"
        },
        {
            title: "Cuenta Corriente",
            href: `/viajante/clientes/${id}/cuenta-corriente`,
            icon: Wallet,
            color: "bg-green-100 text-green-700",
            desc: "Ver saldo e imputar pagos"
        },
        {
            title: "Devoluciones",
            href: `/viajante/clientes/${id}/devoluciones`,
            icon: RefreshCcw,
            color: "bg-orange-100 text-orange-700",
            desc: "Gestionar devoluciones de mercadería"
        },
        {
            title: "Historial",
            href: `/viajante/clientes/${id}/historial`,
            icon: History,
            color: "bg-gray-100 text-gray-700",
            desc: "Ver pedidos y movimientos anteriores"
        }
    ]

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" asChild>
                    <Link href="/viajante">
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                </Button>
                <div>
                    <h1 className="text-2xl font-bold">{cliente.razon_social || cliente.nombre}</h1>
                    <p className="text-muted-foreground text-sm flex gap-2">
                        <span>{cliente.localidad}</span>
                        <span>•</span>
                        <span className={cliente.activo ? "text-green-600" : "text-destructive"}>
                            {cliente.activo ? "Activo" : "Inactivo"}
                        </span>
                    </p>
                </div>
            </div>

            {/* Info Card */}
            <Card>
                <CardContent className="pt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">Saldo Actual</p>
                        <p className={`text-2xl font-bold ${saldo > 0 ? "text-destructive" : "text-green-600"}`}>
                            ${saldo.toFixed(2)}
                        </p>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">Límite de Crédito</p>
                        <p className="text-lg font-semibold">${cliente.limite_credito?.toFixed(2) || "Sin límite"}</p>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">CUIT</p>
                        <p className="text-lg font-semibold">{cliente.cuit || "-"}</p>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">Condición IVA</p>
                        <p className="text-lg font-semibold capitalize">{(cliente.condicion_iva || "").replace("_", " ")}</p>
                    </div>
                </CardContent>
            </Card>

            {/* Actions Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {actions.map((action) => (
                    <Link href={action.href} key={action.title}>
                        <Card className="h-full hover:shadow-md transition-shadow cursor-pointer border-l-4" style={{ borderLeftColor: action.color.includes("blue") ? "blue" : action.color.includes("green") ? "green" : action.color.includes("orange") ? "orange" : "gray" }}>
                            <CardHeader className="space-y-1">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-2 ${action.color}`}>
                                    <action.icon className="h-6 w-6" />
                                </div>
                                <CardTitle className="text-xl">{action.title}</CardTitle>
                                <CardDescription>{action.desc}</CardDescription>
                            </CardHeader>
                        </Card>
                    </Link>
                ))}
            </div>
        </div>
    )
}
