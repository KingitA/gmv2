
import { createClient } from "@/lib/supabase/server"
import { notFound, redirect } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft, FileText, Calendar, DollarSign, Package } from "lucide-react"

export default async function HistorialPedidosPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const supabase = await createClient()

    // 1. Verify Auth
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/viajante/login")

    // 2. Verify Client exists and belongs to Viajante (optional stricter check)
    const { data: cliente } = await supabase
        .from("clientes")
        .select("id, razon_social, nombre")
        .eq("id", id)
        .single()

    if (!cliente) return notFound()

    // 3. Fetch Orders
    const { data: pedidos } = await supabase
        .from("pedidos")
        .select(`
            id, 
            numero_pedido, 
            fecha, 
            estado, 
            total,
            items: pedidos_detalle(count)
        `)
        .eq("cliente_id", id)
        .order("fecha", { ascending: false })

    const getEstadoBadge = (estado: string) => {
        switch (estado?.toLowerCase()) {
            case "pendiente": return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Pendiente</Badge>
            case "confirmado": return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Confirmado</Badge>
            case "facturado": return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Facturado</Badge>
            case "entregado": return <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">Entregado</Badge>
            case "cancelado": return <Badge variant="destructive">Cancelado</Badge>
            default: return <Badge variant="outline">{estado}</Badge>
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" asChild>
                    <Link href={`/viajante/clientes/${id}`}>
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                </Button>
                <div>
                    <h1 className="text-2xl font-bold">Historial de Pedidos</h1>
                    <p className="text-muted-foreground">{cliente.razon_social || cliente.nombre}</p>
                </div>
            </div>

            <div className="grid gap-4">
                {pedidos?.length === 0 ? (
                    <Card>
                        <CardContent className="py-10 text-center text-muted-foreground">
                            No hay pedidos registrados para este cliente.
                        </CardContent>
                    </Card>
                ) : (
                    pedidos?.map((pedido: any) => (
                        <Card key={pedido.id} className="hover:bg-slate-50 transition-colors">
                            <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-lg">{pedido.numero_pedido || "Sin Número"}</span>
                                        {getEstadoBadge(pedido.estado)}
                                    </div>
                                    <div className="text-sm text-muted-foreground flex items-center gap-4">
                                        <span className="flex items-center gap-1">
                                            <Calendar className="h-3 w-3" />
                                            {new Date(pedido.fecha).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Package className="h-3 w-3" />
                                            {pedido.items[0]?.count || 0} ítems
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
                                    <div className="text-right">
                                        <div className="text-xs text-muted-foreground">Total</div>
                                        <div className="font-bold text-lg text-primary">
                                            ${pedido.total?.toLocaleString('es-AR')}
                                        </div>
                                    </div>
                                    {/* Action Link - Could go to detail if it exists */}
                                    {/* For now just placeholder or maybe detail page */}
                                    {/* <Button size="sm" variant="outline" asChild>
                                        <Link href={`/viajante/pedidos/${pedido.id}`}>Ver Detalle</Link>
                                    </Button> */}
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    )
}
