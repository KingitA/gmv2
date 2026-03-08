"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, CreditCard } from "lucide-react"
import Link from "next/link"
import { getChequesEnCartera, depositarCheque } from "@/lib/actions/finanzas"
import { MoneyColorBadge } from "@/components/finanzas/MoneyColorBadge"
import { useToast } from "@/hooks/use-toast"

export default function ChequesPage() {
    const [cheques, setCheques] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [modalOpen, setModalOpen] = useState(false)
    const [selectedCheque, setSelectedCheque] = useState<any>(null)
    const [cuentaBanco, setCuentaBanco] = useState("")
    const { toast } = useToast()

    useEffect(() => {
        loadCheques()
    }, [])

    async function loadCheques() {
        const data = await getChequesEnCartera()
        setCheques(data || [])
        setLoading(false)
    }

    async function handleDepositar() {
        if (!selectedCheque || !cuentaBanco) {
            toast({ title: "Error", description: "Seleccione cuenta bancaria", variant: "destructive" })
            return
        }

        try {
            await depositarCheque(selectedCheque.id, cuentaBanco)
            toast({ title: "Éxito", description: "Cheque depositado" })
            setModalOpen(false)
            loadCheques()
        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" })
        }
    }

    const chequesCartera = cheques.filter(c => c.estado === "EN_CARTERA")
    const chequesDepositados = cheques.filter(c => c.estado === "DEPOSITADO")

    return (
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
                <div className="container mx-auto px-6 py-4">
                    <div className="flex items-center gap-4">
                        <Link href="/finanzas">
                            <Button variant="ghost" size="icon">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold">Cartera de Cheques</h1>
                            <p className="text-sm text-muted-foreground">Gestión completa de cheques</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-6 py-8">
                <Tabs defaultValue="cartera">
                    <TabsList>
                        <TabsTrigger value="cartera">
                            <CreditCard className="h-4 w-4 mr-2" />
                            En Cartera ({chequesCartera.length})
                        </TabsTrigger>
                        <TabsTrigger value="depositados">Depositados ({chequesDepositados.length})</TabsTrigger>
                    </TabsList>

                    <TabsContent value="cartera" className="mt-4">
                        {chequesCartera.length === 0 ? (
                            <Card>
                                <CardContent className="py-12 text-center">
                                    <p className="text-muted-foreground">No hay cheques en cartera</p>
                                </CardContent>
                            </Card>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Banco</TableHead>
                                        <TableHead>Número</TableHead>
                                        <TableHead>Vencimiento</TableHead>
                                        <TableHead>Monto</TableHead>
                                        <TableHead>Color</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {chequesCartera.map(cheque => (
                                        <TableRow key={cheque.id}>
                                            <TableCell className="font-medium">{cheque.banco}</TableCell>
                                            <TableCell>{cheque.numero}</TableCell>
                                            <TableCell>{new Date(cheque.fecha_vencimiento).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>
                                            <TableCell className="font-bold">${Number(cheque.monto).toFixed(2)}</TableCell>
                                            <TableCell>
                                                <MoneyColorBadge color={cheque.color} />
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => {
                                                        setSelectedCheque(cheque)
                                                        setModalOpen(true)
                                                    }}
                                                >
                                                    Depositar
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </TabsContent>

                    <TabsContent value="depositados" className="mt-4">
                        {chequesDepositados.length === 0 ? (
                            <Card>
                                <CardContent className="py-12 text-center">
                                    <p className="text-muted-foreground">No hay cheques depositados</p>
                                </CardContent>
                            </Card>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Banco</TableHead>
                                        <TableHead>Número</TableHead>
                                        <TableHead>Vencimiento</TableHead>
                                        <TableHead>Monto</TableHead>
                                        <TableHead>Color</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {chequesDepositados.map(cheque => (
                                        <TableRow key={cheque.id}>
                                            <TableCell className="font-medium">{cheque.banco}</TableCell>
                                            <TableCell>{cheque.numero}</TableCell>
                                            <TableCell>{new Date(cheque.fecha_vencimiento).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>
                                            <TableCell className="font-bold">${Number(cheque.monto).toFixed(2)}</TableCell>
                                            <TableCell>
                                                <MoneyColorBadge color={cheque.color} />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </TabsContent>
                </Tabs>

                <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Depositar Cheque</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div>
                                <Label>Cuenta Bancaria</Label>
                                <Select value={cuentaBanco} onValueChange={setCuentaBanco}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccione cuenta" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="banco-nacion">Banco Nación</SelectItem>
                                        <SelectItem value="banco-provincia">Banco Provincia</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex gap-2 justify-end">
                                <Button variant="outline" onClick={() => setModalOpen(false)}>
                                    Cancelar
                                </Button>
                                <Button onClick={handleDepositar}>Confirmar Depósito</Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </main>
        </div>
    )
}


