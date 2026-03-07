
"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Search, ShoppingCart, Plus, Trash2, Check, Loader2 } from "lucide-react"
import { searchProductosViajante, saveDraftPedido, confirmPedidoViajante, getDraftPedido, type ProductoViajante } from "@/lib/actions/viajante"
import { useToast } from "@/components/ui/use-toast"
import { useRouter } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"

// Tipos
interface CartItem {
    producto: ProductoViajante
    cantidad: number
    subtotal: number
}

// Helpers
const formatMoney = (amount: number) => {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(amount)
}

function ProductCard({ product, onAdd }: { product: ProductoViajante, onAdd: (p: ProductoViajante, qty: number) => void }) {
    const [quantity, setQuantity] = useState(1)
    const [unit, setUnit] = useState<"unidad" | "docena" | "bulto">("unidad")

    const handleAdd = () => {
        let multiplier = 1
        if (unit === "docena") multiplier = 12
        if (unit === "bulto") multiplier = product.unidades_por_bulto || 1

        onAdd(product, quantity * multiplier)
        setQuantity(1)
        setUnit("unidad")
    }

    return (
        <Card className="flex flex-col md:flex-row items-start md:items-center p-3 gap-3 hover:bg-slate-50 transition-colors">
            <div className="flex-1 min-w-0 w-full">
                <h4 className="font-semibold truncate">{product.nombre}</h4>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 mt-1">
                    <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-medium">{product.sku}</span>
                    {product.categoria && <span>{product.categoria}</span>}
                    {product.proveedor && <span className="hidden sm:inline text-slate-400">| {product.proveedor}</span>}
                    <span className={product.stock_disponible <= 0 ? "text-red-500 font-bold" : ""}>
                        Stock: {product.stock_disponible}
                    </span>
                    {product.unidades_por_bulto > 1 && (
                        <span className="text-blue-600 bg-blue-50 px-1 rounded">Bulto: {product.unidades_por_bulto}u</span>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end mt-2 md:mt-0">
                <div className="text-right mr-2 shrink-0">
                    <div className="text-lg font-bold text-primary">{formatMoney(product.precio_final)}</div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <Input
                        type="number"
                        min={1}
                        className="w-14 h-8 text-center px-1"
                        value={quantity}
                        onChange={(e) => setQuantity(Number(e.target.value))}
                    />

                    <Select value={unit} onValueChange={(v: any) => setUnit(v)}>
                        <SelectTrigger className="w-[90px] h-8 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="unidad">Unid.</SelectItem>
                            <SelectItem value="docena">Doc.</SelectItem>
                            <SelectItem value="bulto">Bulto</SelectItem>
                        </SelectContent>
                    </Select>

                    <Button size="icon" className="h-8 w-8" onClick={handleAdd}>
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </Card>
    )
}

export function PedidoWizard({ cliente, userId }: { cliente: any, userId: string }) {
    const { toast } = useToast()
    const router = useRouter()

    // Status
    const [isLoading, setIsLoading] = useState(true)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isSaving, setIsSaving] = useState(false)

    // Config Modal
    const [showConfigModal, setShowConfigModal] = useState(false)

    // Data State - EXACT MATCH with app/clientes/page.tsx options
    // Assuming DB values match the "value" props from that page
    const [config, setConfig] = useState({
        condicion_venta: cliente.condicion_pago || "",
        observaciones: "",
        direccion_entrega: cliente.direccion || "",
        condicion_iva: cliente.condicion_iva || "Responsable Inscripto",
        metodo_facturacion: cliente.metodo_facturacion || "Factura",
        exento_iibb: cliente.exento_iibb || false,
        exento_iva: cliente.exento_iva || false,
        condicion_entrega: cliente.condicion_entrega || "entregamos_nosotros"
    })

    const [updateClientProfile, setUpdateClientProfile] = useState(false)

    const [draftId, setDraftId] = useState<string | null>(null)
    const [cart, setCart] = useState<CartItem[]>([])

    // Search
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<ProductoViajante[]>([])
    const [searching, setSearching] = useState(false)
    const [showCartSummary, setShowCartSummary] = useState(false)


    // 1. Initial Load
    useEffect(() => {
        const init = async () => {
            try {
                const draft = await getDraftPedido(cliente.id, userId)
                if (draft) {
                    setDraftId(draft.id)
                    setCart(draft.items as any)

                    setConfig(prev => ({
                        ...prev,
                        observaciones: draft.observaciones || "",
                        direccion_entrega: draft.direccion_entrega || prev.direccion_entrega,
                        // Could check snapshot to force strict values, but staying with defaults/current mostly safe
                    }))
                    toast({ title: "Pedido Recuperado", description: "Continuando con el pedido pendiente." })
                    handleSearch(true)
                } else {
                    setShowConfigModal(true)
                }
            } catch (e) {
                console.error(e)
                toast({ title: "Error", description: "No se pudo cargar el estado del pedido", variant: "destructive" })
            } finally {
                setIsLoading(false)
            }
        }
        init()
    }, [cliente.id, userId])

    // 2. Start Draft
    const handleStartDraft = async () => {
        setIsSubmitting(true)
        try {
            const id = await saveDraftPedido({
                cliente_id: cliente.id,
                vendedor_id: userId,
                items: [],
                ...config,
                updateClientProfile
            })
            setDraftId(id || null)
            setShowConfigModal(false)
            handleSearch(true)

            if (updateClientProfile) {
                toast({ title: "Cliente Actualizado", description: "Los datos se guardaron en la ficha." })
            }
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
        } finally {
            setIsSubmitting(false)
        }
    }

    // 3. Auto-Save
    useEffect(() => {
        if (!draftId || isLoading) return

        const timer = setTimeout(async () => {
            setIsSaving(true)
            try {
                await saveDraftPedido({
                    pedido_id: draftId,
                    cliente_id: cliente.id,
                    vendedor_id: userId,
                    items: cart.map(i => ({
                        producto_id: i.producto.id,
                        cantidad: i.cantidad,
                        precio_final: i.producto.precio_final
                    })),
                    ...config,
                    updateClientProfile: false
                })
            } catch (e) {
                console.error("Auto-save failed", e)
            } finally {
                setIsSaving(false)
            }
        }, 1500)

        return () => clearTimeout(timer)
    }, [cart, config, draftId])


    // 4. Search & Ops
    const handleSearch = async (force = false) => {
        if (!force && query.length > 0 && query.length < 3) return
        setSearching(true)
        try {
            const data = await searchProductosViajante(query, cliente.id)
            setResults(data)
        } catch (e) { console.error(e) }
        finally { setSearching(false) }
    }

    useEffect(() => {
        const timer = setTimeout(() => {
            if (query.length === 0 || query.length >= 3) handleSearch()
        }, 400)
        return () => clearTimeout(timer)
    }, [query])

    const addToCart = (product: ProductoViajante, qtyToAdd: number) => {
        setCart(prev => {
            const existing = prev.find(item => item.producto.id === product.id)
            if (existing) {
                return prev.map(item => item.producto.id === product.id ? {
                    ...item,
                    cantidad: item.cantidad + qtyToAdd,
                    subtotal: (item.cantidad + qtyToAdd) * product.precio_final
                } : item)
            }
            return [...prev, { producto: product, cantidad: qtyToAdd, subtotal: product.precio_final * qtyToAdd }]
        })
        toast({ title: "Agregado", description: `${product.nombre}` })
    }

    const removeFromCart = (pid: string) => {
        setCart(prev => prev.filter(p => p.producto.id !== pid))
    }

    const handleConfirm = async () => {
        if (!draftId) return
        if (cart.length === 0) {
            toast({ title: "Pedido Vacío", description: "Agrega al menos un producto.", variant: "destructive" })
            return
        }

        setIsSubmitting(true)
        try {
            await saveDraftPedido({
                pedido_id: draftId,
                cliente_id: cliente.id,
                vendedor_id: userId,
                items: cart.map(i => ({
                    producto_id: i.producto.id,
                    cantidad: i.cantidad,
                    precio_final: i.producto.precio_final
                })),
                ...config,
                updateClientProfile: false
            })

            await confirmPedidoViajante(draftId)

            toast({ title: "¡Pedido Enviado!", className: "bg-green-600 text-white" })
            router.push(`/viajante/clientes/${cliente.id}`)
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" })
            setIsSubmitting(false)
        }
    }

    const total = cart.reduce((acc, i) => acc + i.subtotal, 0)

    if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div>

    return (
        <div className="h-full flex flex-col relative">
            {/* Header */}
            <div className="bg-white border-b p-3 flex items-center justify-between shrink-0">
                <div className="flex flex-col">
                    <h2 className="font-bold text-lg">Pedidos</h2>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                        {isSaving ? <span className="text-blue-500 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Guardando...</span> : <span className="text-green-600 flex items-center gap-1"><Check className="h-3 w-3" /> Guardado</span>}
                        <span>| Total: {formatMoney(total)}</span>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowConfigModal(true)}>
                        Config
                    </Button>
                    <Button size="sm" onClick={() => setShowCartSummary(true)}>
                        <ShoppingCart className="h-4 w-4 mr-2" />
                        ({cart.length}) ver
                    </Button>
                </div>
            </div>

            {/* Config Modal */}
            <Dialog open={showConfigModal} onOpenChange={setShowConfigModal}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-auto">
                    <DialogHeader>
                        <DialogTitle>{draftId ? "Datos del Pedido" : "Iniciar Nuevo Pedido"}</DialogTitle>
                        <DialogDescription>
                            Confirma los datos para este pedido.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-2">
                        {/* Fila 1: Dirección y Entrega */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Dirección de Entrega</Label>
                                <Input
                                    value={config.direccion_entrega}
                                    onChange={e => setConfig(c => ({ ...c, direccion_entrega: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Condición Entrega</Label>
                                <Select
                                    value={config.condicion_entrega}
                                    onValueChange={v => setConfig(c => ({ ...c, condicion_entrega: v }))}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="retira_mostrador">Retira en Mostrador</SelectItem>
                                        <SelectItem value="transporte">Envío por Transporte</SelectItem>
                                        <SelectItem value="entregamos_nosotros">Entregamos Nosotros</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Fila 2: Pago y Facturación */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Condición de Pago</Label>
                                <Select
                                    value={config.condicion_venta}
                                    onValueChange={v => setConfig(c => ({ ...c, condicion_venta: v }))}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Efectivo">Efectivo</SelectItem>
                                        <SelectItem value="Transferencia">Transferencia</SelectItem>
                                        <SelectItem value="Cheque al día">Cheque al día</SelectItem>
                                        <SelectItem value="Cheque 30 días">Cheque 30 días</SelectItem>
                                        <SelectItem value="Cheque 30/60/90">Cheque 30/60/90</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Método Facturación</Label>
                                <Select
                                    value={config.metodo_facturacion}
                                    onValueChange={v => setConfig(c => ({ ...c, metodo_facturacion: v }))}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Factura">Factura (21% IVA)</SelectItem>
                                        <SelectItem value="Final">Final (Mixto)</SelectItem>
                                        <SelectItem value="Presupuesto">Presupuesto</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Fila 3: IVA */}
                        <div className="space-y-2">
                            <Label>Condición IVA</Label>
                            <Select
                                value={config.condicion_iva}
                                onValueChange={v => setConfig(c => ({ ...c, condicion_iva: v }))}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Responsable Inscripto">Responsable Inscripto</SelectItem>
                                    <SelectItem value="Monotributo">Monotributo</SelectItem>
                                    <SelectItem value="Consumidor Final">Consumidor Final</SelectItem>
                                    <SelectItem value="Sujeto Exento">Sujeto Exento</SelectItem>
                                    <SelectItem value="No Categorizado">No Categorizado</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Fila 4: Exenciones */}
                        <div className="flex items-center gap-6 pt-2">
                            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-gray-300"
                                    checked={config.exento_iibb}
                                    onChange={e => setConfig(c => ({ ...c, exento_iibb: e.target.checked }))}
                                />
                                Exento IIBB
                            </label>
                            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-gray-300"
                                    checked={config.exento_iva}
                                    onChange={e => setConfig(c => ({ ...c, exento_iva: e.target.checked }))}
                                />
                                Exento IVA
                            </label>
                        </div>

                        {/* Update Profile Checkbox */}
                        {!draftId && (
                            <div className="bg-blue-50 p-3 rounded-md mt-2 flex items-start gap-2 border border-blue-100">
                                <input
                                    type="checkbox"
                                    id="updateProfile"
                                    className="h-4 w-4 mt-0.5 rounded border-blue-300 text-blue-600"
                                    checked={updateClientProfile}
                                    onChange={e => setUpdateClientProfile(e.target.checked)}
                                />
                                <label htmlFor="updateProfile" className="text-sm text-blue-800 cursor-pointer">
                                    <span className="font-semibold block">¿Actualizar ficha del cliente?</span>
                                    Guardar cambios permanentemente en el perfil del cliente.
                                </label>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>Observaciones</Label>
                            <Textarea
                                value={config.observaciones}
                                onChange={e => setConfig(c => ({ ...c, observaciones: e.target.value }))}
                                placeholder="Notas internas..."
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        {!draftId && (
                            <Button className="w-full" onClick={handleStartDraft} disabled={isSubmitting}>
                                {isSubmitting ? "Creando..." : "Comenzar Pedido"}
                            </Button>
                        )}
                        {draftId && (
                            <Button className="w-full" onClick={() => setShowConfigModal(false)}>
                                Guardar y Volver
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Cart Summary Sheet / Fullscreen Mobile Overlay */}
            {showCartSummary && (
                <div className="absolute inset-0 bg-white z-50 flex flex-col animate-in slide-in-from-right">
                    <div className="p-4 border-b flex items-center justify-between bg-slate-50">
                        <h3 className="font-bold flex items-center gap-2"><ShoppingCart className="h-5 w-5" /> Revisar Pedido</h3>
                        <Button variant="ghost" size="sm" onClick={() => setShowCartSummary(false)}>Cerrar</Button>
                    </div>
                    <div className="flex-1 overflow-auto p-4 space-y-4">
                        {cart.length === 0 && <p className="text-center text-muted-foreground my-10">El carrito está vacío.</p>}
                        {cart.map(item => (
                            <div key={item.producto.id} className="flex justify-between items-start border-b pb-4">
                                <div>
                                    <div className="font-medium">{item.producto.nombre}</div>
                                    <div className="text-sm text-muted-foreground">
                                        {item.cantidad} x {formatMoney(item.producto.precio_final)}
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    <div className="font-bold">{formatMoney(item.subtotal)}</div>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => removeFromCart(item.producto.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="p-4 border-t bg-slate-50">
                        <div className="flex justify-between text-lg font-bold mb-4">
                            <span>Total</span>
                            <span>{formatMoney(total)}</span>
                        </div>
                        <Button className="w-full" size="lg" onClick={handleConfirm} disabled={isSubmitting || cart.length === 0}>
                            {isSubmitting ? "Enviando..." : "Confirmar y Enviar Pedido"}
                        </Button>
                    </div>
                </div>
            )}

            {/* Main Content: Search & List */}
            <div className="p-4 space-y-4 flex-1 overflow-hidden flex flex-col">
                <div className="relative shrink-0">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar producto..."
                        className="pl-9"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                    />
                </div>

                <div className="flex-1 overflow-auto space-y-2 pb-20">
                    {results.map(prod => (
                        <ProductCard key={prod.id} product={prod} onAdd={addToCart} />
                    ))}
                    {!searching && results.length === 0 && (
                        <div className="text-center py-12 text-slate-400">
                            {query ? "No se encontraron productos." : "Empieza a escribir para buscar..."}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
