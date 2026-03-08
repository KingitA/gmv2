"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Wallet, Building2, CreditCard, Users, TrendingUp } from "lucide-react"
import Link from "next/link"
import { getSaldos } from "@/lib/actions/finanzas"
import { BalanceCards } from "@/components/finanzas/BalanceCards"

export default function FinanzasPage() {
    const [saldos, setSaldos] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function load() {
            const data = await getSaldos()
            setSaldos(data || [])
            setLoading(false)
        }
        load()
    }, [])

    // Mock accounts - ideally load from DB
    const cuentas = [
        { id: "caja-chica", nombre: "Caja Chica", tipo: "CAJA" as const },
        { id: "caja-principal", nombre: "Caja Principal", tipo: "CAJA" as const },
    ]

    return (
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
                <div className="container mx-auto px-6 py-4">
                    <div className="flex items-center gap-4">
                        <Link href="/">
                            <Button variant="ghost" size="icon">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold">Módulo Financiero</h1>
                            <p className="text-sm text-muted-foreground">Gestión de dinero real, cajas, bancos y cheques</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-6 py-8 space-y-8">
                <section>
                    <h2 className="text-xl font-semibold mb-4">Saldos Actuales</h2>
                    {loading ? (
                        <p className="text-muted-foreground">Cargando saldos...</p>
                    ) : (
                        <BalanceCards saldos={saldos} cuentas={cuentas} />
                    )}
                </section>

                <section>
                    <h2 className="text-xl font-semibold mb-4">Accesos Rápidos</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <Link href="/finanzas/cobros">
                            <Card className="hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-l-green-500">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Wallet className="h-5 w-5 text-green-600" />
                                        Cobros Pendientes
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground">Revisar y confirmar pagos de clientes</p>
                                </CardContent>
                            </Card>
                        </Link>

                        <Link href="/finanzas/cajas">
                            <Card className="hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-l-blue-500">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Wallet className="h-5 w-5 text-blue-600" />
                                        Cajas
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground">Movimientos de cajas chica y principal</p>
                                </CardContent>
                            </Card>
                        </Link>

                        <Link href="/finanzas/bancos">
                            <Card className="hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-l-purple-500">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Building2 className="h-5 w-5 text-purple-600" />
                                        Bancos
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground">Cuentas bancarias y transferencias</p>
                                </CardContent>
                            </Card>
                        </Link>

                        <Link href="/finanzas/cheques">
                            <Card className="hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-l-orange-500">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <CreditCard className="h-5 w-5 text-orange-600" />
                                        Cheques
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground">Cartera de cheques y gestión</p>
                                </CardContent>
                            </Card>
                        </Link>

                        <Link href="/finanzas/proveedores/pagos">
                            <Card className="hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-l-red-500">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Users className="h-5 w-5 text-red-600" />
                                        Pagos a Proveedores
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground">Gestionar pagos con IA</p>
                                </CardContent>
                            </Card>
                        </Link>

                        <Link href="/finanzas/egresos">
                            <Card className="hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-l-yellow-500">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <TrendingUp className="h-5 w-5 text-yellow-600" />
                                        Egresos
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground">Gastos, sueldos e inversiones</p>
                                </CardContent>
                            </Card>
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    )
}


