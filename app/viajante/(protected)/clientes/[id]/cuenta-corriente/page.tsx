
import { createClient } from "@/lib/supabase/server"
import { notFound, redirect } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft, CheckCircle2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface UnifiedMovement {
    id: string
    fecha: string
    tipo: string
    numero: string
    debe: number
    haber: number
    saldo: number
    estado: string
    es_credito: boolean
}

export default async function CtaCtePage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/viajante/login")

    // Check client existence
    const { data: cliente } = await supabase.from("clientes").select("razon_social, saldo_total").eq("id", id).single()
    if (!cliente) notFound()

    // --- FETCHING DATA (Matching Admin Logic) ---

    // 1. Comprobantes (Facturas, ND, NC)
    const { data: comprobantes } = await supabase
        .from("comprobantes_venta")
        .select("*")
        .eq("cliente_id", id)

    // 2. Pagos
    const { data: pagos } = await supabase
        .from("pagos_clientes")
        .select("id, fecha_pago, monto, estado, forma_pago, detalles:pagos_detalle(tipo_pago)")
        .eq("cliente_id", id)

    // 3. Devoluciones
    const { data: devoluciones } = await supabase
        .from("devoluciones")
        .select("id, created_at, numero_devolucion, monto_total, estado")
        .eq("cliente_id", id)

    // 4. Pedidos Pendientes (Cuenta Corriente Table)
    const { data: pedidos } = await supabase
        .from("cuenta_corriente")
        .select("*")
        .eq("cliente_id", id)
        .eq("tipo_comprobante", "PEDIDO")

    // --- UNIFYING ---
    const movimientos: UnifiedMovement[] = []

    // A. Add Comprobantes
    comprobantes?.forEach(c => {
        const esCredito = c.tipo_comprobante.toLowerCase().includes("nota de crédito")
        movimientos.push({
            id: c.id,
            fecha: c.fecha,
            tipo: c.tipo_comprobante,
            numero: c.numero_comprobante,
            debe: esCredito ? 0 : c.total_factura,
            haber: esCredito ? c.total_factura : 0,
            saldo: c.saldo_pendiente,
            estado: c.estado_pago || "pendiente",
            es_credito: esCredito
        })
    })

    // B. Add Pagos
    pagos?.forEach(p => {
        const formas = p.detalles?.map((d: any) => d.tipo_pago).join("+") || "Pago"
        movimientos.push({
            id: p.id,
            fecha: p.fecha_pago,
            tipo: "Pago",
            numero: formas,
            debe: 0,
            haber: p.monto,
            saldo: 0, // Pagos no tienen saldo propio pendiente usualmente
            estado: p.estado,
            es_credito: true
        })
    })

    // C. Add Devoluciones
    devoluciones?.forEach(d => {
        movimientos.push({
            id: d.id,
            fecha: d.created_at,
            tipo: "Devolución",
            numero: d.numero_devolucion,
            debe: 0,
            haber: d.monto_total,
            saldo: d.monto_total, // A favor
            estado: d.estado,
            es_credito: true
        })
    })

    // D. Add Pedidos
    pedidos?.forEach(p => {
        movimientos.push({
            id: p.id,
            fecha: p.fecha,
            tipo: "Pedido (Pend. Fact)",
            numero: p.numero_comprobante,
            debe: p.debe,
            haber: 0,
            saldo: p.saldo,
            estado: "pendiente",
            es_credito: false
        })
    })

    // Sort Descending
    movimientos.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

    // Calculate Totals for Display
    // Note: The database 'saldo_total' on client is usually the source of truth, but we can sum 'saldo_pendiente' of debts - creditors.
    // For specific "Deuda Vencida", we'd filter by date.
    // For now, let's use the movements to display the list.

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" asChild>
                    <Link href={`/viajante/clientes/${id}`}>
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                </Button>
                <div>
                    <h1 className="text-2xl font-bold">Cuenta Corriente</h1>
                    <p className="text-muted-foreground text-sm">
                        {cliente.razon_social}
                    </p>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <Card className="bg-destructive/10 border-destructive/20">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg text-destructive">Saldo Total</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-destructive">
                            ${cliente.saldo_total?.toLocaleString("es-AR") || "0.00"}
                        </div>
                    </CardContent>
                </Card>

                <Card className="flex flex-col justify-center items-start p-6">
                    <div className="w-full space-y-2">
                        <Button className="w-full" size="lg" asChild>
                            <Link href={`/viajante/clientes/${id}/cuenta-corriente/pago`}>
                                Imputar Pago
                            </Link>
                        </Button>
                        <Button variant="outline" className="w-full" disabled>
                            Descargar Resumen (Próximamente)
                        </Button>
                    </div>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Movimientos</CardTitle>
                    <CardDescription>Ultimos movimientos de la cuenta</CardDescription>
                </CardHeader>
                <CardContent>
                    {movimientos.length > 0 ? (
                        <div className="space-y-2">
                            {movimientos.map((mov) => (
                                <div key={`${mov.tipo}-${mov.id}`} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <Badge variant={mov.tipo.includes("Pago") || mov.tipo.includes("Devol") ? "default" : "outline"}
                                                className={mov.tipo.includes("Pago") ? "bg-green-600 hover:bg-green-700" : ""}>
                                                {mov.tipo}
                                            </Badge>
                                            <span className="font-semibold">{mov.numero}</span>
                                        </div>
                                        <div className="text-sm text-muted-foreground flex gap-3">
                                            <span>{new Date(mov.fecha).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</span>
                                            <span className="capitalize text-xs bg-slate-100 px-1 rounded">{mov.estado}</span>
                                        </div>
                                    </div>
                                    <div className="mt-2 sm:mt-0 text-right">
                                        {mov.es_credito ? (
                                            <p className="text-lg font-bold text-green-600">- ${mov.haber.toLocaleString("es-AR")}</p>
                                        ) : (
                                            <p className="text-lg font-bold text-destructive">+ ${mov.debe.toLocaleString("es-AR")}</p>
                                        )}
                                        {mov.saldo > 0 && !mov.es_credito && (
                                            <p className="text-xs text-muted-foreground">Debe: ${mov.saldo.toLocaleString("es-AR")}</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                            <CheckCircle2 className="h-10 w-10 text-green-500 mb-2" />
                            <p>Sin movimientos recientes.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
