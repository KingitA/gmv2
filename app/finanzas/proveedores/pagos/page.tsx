export const dynamic = 'force-dynamic'
"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ArrowLeft, Plus, Sparkles, X } from "lucide-react"
import Link from "next/link"
import { crearPagoProveedor, obtenerSugerenciaPagoProveedor, getChequesEnCartera } from "@/lib/actions/finanzas"
import { ChequeSelectorModal } from "@/components/finanzas/ChequeSelectorModal"
import { MoneyColorBadge } from "@/components/finanzas/MoneyColorBadge"
import { useToast } from "@/hooks/use-toast"

export default function PagosProveedoresPage() {
    const [proveedorId, setProveedorId] = useState("")
    const [color, setColor] = useState<"BLANCO" | "NEGRO">("NEGRO")
    const [items, setItems] = useState<any[]>([])
    const [modalCheque, setModalCheque] = useState(false)
    const [modalPropio, setModalPropio] = useState(false)
    const [cheques, setCheques] = useState<any[]>([])
    const [sugerenciaModal, setSugerenciaModal] = useState(false)
    const [sugerencia, setSugerencia] = useState<any>(null)
    const { toast } = useToast()

    // Form for Own Cheque
    const [chequePropio, setChequePropio] = useState({
        banco: "",
        numero: "",
        fecha_vencimiento: "",
        monto: 0
    })

    useEffect(() => {
        loadCheques()
    }, [])

    async function loadCheques() {
        const data = await getChequesEnCartera()
        setCheques(data || [])
    }

    function agregarItem(tipo: "EFECTIVO" | "BANCO" | "CHEQUE" | "CHEQUE_PROPIO", data: any) {
        setItems([...items, { tipo, ...data }])
    }

    function eliminarItem(index: number) {
        setItems(items.filter((_, i) => i !== index))
    }

    function handleSelectCheques(selected: any[]) {
        selected.forEach(c => {
            agregarItem("CHEQUE", { id: c.id, monto: c.monto, detalle: `Ch. ${c.banco} #${c.numero}` })
        })
    }

    function handleAgregarChequePropio() {
        if (!chequePropio.banco || !chequePropio.numero || chequePropio.monto <= 0) {
            toast({ title: "Error", description: "Complete todos los campos", variant: "destructive" })
            return
        }

        agregarItem("CHEQUE_PROPIO", chequePropio)
        setModalPropio(false)
        setChequePropio({ banco: "", numero: "", fecha_vencimiento: "", monto: 0 })
    }

    async function handleSugerir() {
        if (!proveedorId) {
            toast({ title: "Error", description: "Seleccione un proveedor", variant: "destructive" })
            return
        }

        const total = items.reduce((sum, i) => sum + Number(i.monto || 0), 0)
        const sug = await obtenerSugerenciaPagoProveedor(proveedorId, total || 1000, color)
        setSugerencia(sug)
        setSugerenciaModal(true)
    }

    async function handlePagar() {
        if (items.length === 0) {
            toast({ title: "Error", description: "Agregue al menos un medio de pago", variant: "destructive" })
            return
        }

        const total = items.reduce((sum, i) => sum + Number(i.monto || 0), 0)

        try {
            await crearPagoProveedor({
                proveedorId,
                color,
                items,
                total
            })

            toast({ title: "Éxito", description: "Pago registrado correctamente" })
            setItems([])
            setProveedorId("")
        } catch (error: any) {
            toast({ title: "Error", description: error.message, variant: "destructive" })
        }
    }

    const totalPago = items.reduce((sum, i) => sum + Number(i.monto || 0), 0)

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
                            <h1 className="text-2xl font-bold">Pagos a Proveedores</h1>
                            <p className="text-sm text-muted-foreground">Gestión inteligente con IA</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-6 py-8 max-w-4xl">
                <Card>
                    <CardHeader>
                        <CardTitle>Registro de Pago</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Proveedor</Label>
                                <Input
                                    placeholder="ID del proveedor"
                                    value={proveedorId}
                                    onChange={e => setProveedorId(e.target.value)}
                                />
                            </div>
                            <div>
                                <Label>Color</Label>
                                <Select value={color} onValueChange={(v: any) => setColor(v)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="BLANCO">BLANCO</SelectItem>
                                        <SelectItem value="NEGRO">NEGRO</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <Label className="text-lg font-semibold">Medios de Pago</Label>
                                <Button size="sm" variant="outline" onClick={handleSugerir}>
                                    <Sparkles className="h-4 w-4 mr-2" />
                                    Sugerir con IA
                                </Button>
                            </div>

                            <div className="grid grid-cols-2 gap-2 mb-4">
                                <Button variant="outline" onClick={() => setModalCheque(true)}>
                                    <Plus className="h-4 w-4 mr-2" />
                                    Cheque Tercero
                                </Button>
                                <Button variant="outline" onClick={() => setModalPropio(true)}>
                                    <Plus className="h-4 w-4 mr-2" />
                                    Cheque Propio
                                </Button>
                            </div>

                            <div className="border rounded-lg p-4 min-h-[200px]">
                                {items.length === 0 ? (
                                    <p className="text-center text-muted-foreground py-8">No hay medios de pago agregados</p>
                                ) : (
                                    <div className="space-y-2">
                                        {items.map((item, idx) => (
                                            <div key={idx} className="flex items-center justify-between p-3 bg-muted rounded">
                                                <div>
                                                    <span className="font-semibold">{item.tipo}</span>
                                                    {item.detalle && <span className="text-sm text-muted-foreground ml-2">{item.detalle}</span>}
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="font-bold">${Number(item.monto).toFixed(2)}</span>
                                                    <Button size="icon" variant="ghost" onClick={() => eliminarItem(idx)}>
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t mt-4">
                                <span className="text-lg font-semibold">Total:</span>
                                <div className="flex items-center gap-3">
                                    <MoneyColorBadge color={color} />
                                    <span className="text-2xl font-bold">${totalPago.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-2 justify-end">
                            <Button variant="outline" onClick={() => setItems([])}>
                                Limpiar
                            </Button>
                            <Button onClick={handlePagar} disabled={items.length === 0}>
                                Registrar Pago
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <ChequeSelectorModal
                    open={modalCheque}
                    onClose={() => setModalCheque(false)}
                    cheques={cheques.filter(c => c.color === color)}
                    onSelect={handleSelectCheques}
                />

                <Dialog open={modalPropio} onOpenChange={setModalPropio}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Emitir Cheque Propio</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div>
                                <Label>Banco</Label>
                                <Input
                                    value={chequePropio.banco}
                                    onChange={e => setChequePropio({ ...chequePropio, banco: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label>Número</Label>
                                <Input
                                    value={chequePropio.numero}
                                    onChange={e => setChequePropio({ ...chequePropio, numero: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label>Fecha Vencimiento</Label>
                                <Input
                                    type="date"
                                    value={chequePropio.fecha_vencimiento}
                                    onChange={e => setChequePropio({ ...chequePropio, fecha_vencimiento: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label>Monto</Label>
                                <Input
                                    type="number"
                                    value={chequePropio.monto || ""}
                                    onChange={e => setChequePropio({ ...chequePropio, monto: parseFloat(e.target.value) || 0 })}
                                />
                            </div>
                            <div className="flex gap-2 justify-end">
                                <Button variant="outline" onClick={() => setModalPropio(false)}>
                                    Cancelar
                                </Button>
                                <Button onClick={handleAgregarChequePropio}>Agregar</Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>

                <Dialog open={sugerenciaModal} onOpenChange={setSugerenciaModal}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Sugerencia de Pago (IA)</DialogTitle>
                        </DialogHeader>
                        {sugerencia && (
                            <div className="space-y-4">
                                <p className="text-sm text-muted-foreground">{sugerencia.razonamiento}</p>
                                <div className="space-y-2">
                                    {sugerencia.items_json?.map((item: any, idx: number) => (
                                        <div key={idx} className="p-2 bg-muted rounded flex justify-between">
                                            <span>{item.detalle || item.tipo}</span>
                                            <span className="font-bold">${item.monto}</span>
                                        </div>
                                    ))}
                                </div>
                                <Button onClick={() => {
                                    setItems(sugerencia.items_json || [])
                                    setSugerenciaModal(false)
                                }}>
                                    Aplicar Sugerencia
                                </Button>
                            </div>
                        )}
                    </DialogContent>
                </Dialog>
            </main>
        </div>
    )
}

