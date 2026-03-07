"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Upload, Loader2, CheckCircle, AlertTriangle, Search, AlertCircle, X, Check, ChevronsUpDown } from "lucide-react"
import { parseOrderFile, type ParseResult, type ParsedItem } from "@/lib/actions/ai-order-import"
import { createPedido } from "@/lib/actions/pedidos"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { searchClientes } from "@/lib/actions/clientes"

// Helper for confidence color
const getConfidenceColor = (conf: string) => {
    switch (conf) {
        case "HIGH": return "bg-green-500"
        case "MEDIUM": return "bg-yellow-500"
        case "LOW": return "bg-red-500"
        default: return "bg-gray-500"
    }
}

export function ImportOrderDialog({ onOrderCreated }: { onOrderCreated?: () => void }) {
    const [open, setOpen] = useState(false)
    const [analyzing, setAnalyzing] = useState(false)
    const [result, setResult] = useState<ParseResult | null>(null)
    const [items, setItems] = useState<ParsedItem[]>([])

    // Client search state
    const [clienteId, setClienteId] = useState<string>("")
    const [clienteSearchOpen, setClienteSearchOpen] = useState(false)
    const [clientesEncontrados, setClientesEncontrados] = useState<any[]>([])
    const [selectedClienteName, setSelectedClienteName] = useState("")

    const handleSearchClientes = async (term: string) => {
        if (term.length < 2) return
        try {
            const res = await searchClientes(term)
            setClientesEncontrados(res || [])
        } catch (error) {
            console.error(error)
        }
    }

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files || files.length === 0) return

        setAnalyzing(true)
        try {
            const formData = new FormData()
            Array.from(files).forEach(file => {
                formData.append("file", file)
            })

            const res = await parseOrderFile(formData)
            setResult(res)
            setItems(res.items)

            let foundClienteId = ""

            if (res.candidateCustomerData) {
                setClienteId(res.candidateCustomerData.id)
                setSelectedClienteName(res.candidateCustomerData.razon_social)
                foundClienteId = res.candidateCustomerData.id
                toast.success(`Cliente vinculado exitosamente: ${res.candidateCustomerData.razon_social}`)
            } else if (res.candidateCustomer) {
                toast.info(`Cliente detectado por IA: ${res.candidateCustomer}`)
                // Try to auto-search if candidate found
                handleSearchClientes(res.candidateCustomer)
            }

            const allMatched = res.items.length > 0 && res.items.every((i: any) => i.confidence === "HIGH" && i.matchedProduct)
            if (allMatched && foundClienteId) {
                toast.success("Orden perfecta. Creando pedido automáticamente...")
                setCreating(true)
                try {
                    await createPedido({
                        cliente_id: foundClienteId,
                        items: res.items.map((i: any) => ({
                            producto_id: i.matchedProduct.id,
                            cantidad: i.quantity,
                            precio_unitario: i.matchedProduct.precio_base || 0,
                            descuento: 0
                        })),
                        observaciones: "Importado automáticamente vía IA"
                    })
                    toast.success("Pedido creado automáticamente con éxito")
                    setOpen(false)
                    onOrderCreated?.()
                } catch (err: any) {
                    console.error(err)
                    toast.error("Error al crear pedido automático: " + (err.message || ""))
                } finally {
                    setCreating(false)
                }
                return;
            }
        } catch (err) {
            console.error(err)
            toast.error("Error al analizar los archivos")
        } finally {
            setAnalyzing(false)
        }
    }

    const [creating, setCreating] = useState(false)

    // Manual Product Linking States
    const [searchingIdx, setSearchingIdx] = useState<number | null>(null)
    const [productSearchQuery, setProductSearchQuery] = useState("")
    const [productsFound, setProductsFound] = useState<any[]>([])

    const handleSearchProducts = async (term: string) => {
        const { searchProductos } = await import("@/lib/actions/productos")
        const results = await searchProductos(term)
        setProductsFound(results || [])
    }

    const updateItemProduct = (idx: number, product: any) => {
        const newItems = [...items]
        newItems[idx] = {
            ...newItems[idx],
            matchedProduct: product,
            confidence: "HIGH" // Setting to HIGH once manually linked
        }
        setItems(newItems)
        setSearchingIdx(null)
        setProductSearchQuery("")
        setProductsFound([])
    }

    const handleCreateOrder = async () => {
        console.log("handleCreateOrder started", { clienteId, itemsCount: items.length })

        if (!clienteId) {
            toast.error("Por favor selecciona un cliente")
            return
        }

        const validItems = items.filter(i => i.matchedProduct)
        console.log("Valid items:", validItems.length)

        if (validItems.length === 0) {
            toast.error("No hay artículos válidos vinculados a productos del sistema.")
            return
        }

        setCreating(true)
        try {
            console.log("Calling createPedido action...")
            const payload = {
                cliente_id: clienteId,
                items: validItems.map(i => ({
                    producto_id: i.matchedProduct.id,
                    cantidad: i.quantity,
                    precio_unitario: i.matchedProduct.precio_base || 0,
                    descuento: 0
                })),
                observaciones: "Importado vía IA"
            }
            console.log("Payload:", payload)

            await createPedido(payload)

            toast.success("Pedido creado exitosamente")
            setOpen(false)
            onOrderCreated?.()
        } catch (err: any) {
            console.error("Error in createPedido:", err)
            const errorMsg = err.message || "Error al crear pedido"
            const errorDetail = err.detail ? ` (${err.detail})` : ""
            const errorCode = err.code ? ` [Code: ${err.code}]` : ""
            toast.error(`${errorMsg}${errorDetail}${errorCode}`)
        } finally {
            setCreating(false)
        }
    }

    const allHighConfidence = items.every(i => i.confidence === "HIGH")
    const needsAttention = items.filter(i => i.confidence !== "HIGH")

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <Upload className="h-4 w-4" />
                    Importar (IA)
                </Button>
            </DialogTrigger>
            <DialogContent className="!w-[95vw] !max-w-[1200px] h-[95vh] flex flex-col p-4 md:p-6 overflow-hidden">
                <DialogHeader className="shrink-0">
                    <DialogTitle>Importar Pedido desde Archivo</DialogTitle>
                    <DialogDescription>
                        Sube una imagen, PDF o Excel. La IA detectará los artículos automáticamente.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-hidden flex flex-col gap-4 min-h-0">
                    {!result && !analyzing && (
                        <div className="border-2 border-dashed rounded-lg p-10 flex flex-col items-center justify-center text-muted-foreground hover:bg-muted/50 transition-colors cursor-pointer relative">
                            <input
                                type="file"
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                accept="image/*,.pdf,.xlsx,.xls"
                                multiple
                                onChange={handleFileUpload}
                            />
                            <Upload className="h-10 w-10 mb-4" />
                            <p className="text-sm font-medium">Arrastra uno o varios archivos o haz clic para subir</p>
                            <p className="text-xs mt-1">Soporta múltiples JPG, PNG, PDF, Excel</p>
                        </div>
                    )}

                    {analyzing && (
                        <div className="flex flex-col items-center justify-center py-10 space-y-4">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <div className="text-center space-y-1">
                                <p className="font-medium">Analizando archivos con Gemini 2.0...</p>
                                <p className="text-sm text-muted-foreground">Interpretando todos los artículos y consolidando el pedido.</p>
                                <p className="text-xs text-muted-foreground animate-pulse">Esto puede tardar un momento dependiendo de la cantidad de fotos.</p>
                            </div>
                        </div>
                    )}

                    {result && !analyzing && (
                        <div className="flex flex-col flex-1 gap-4 min-h-0">
                            {/* Error Summary if any */}
                            {result.errors && result.errors.length > 0 && (
                                <div className="bg-destructive/15 p-3 rounded-md text-sm text-destructive flex flex-col gap-1">
                                    <div className="font-semibold flex items-center gap-2">
                                        <AlertCircle className="h-4 w-4" />
                                        Algunos archivos no se pudieron procesar:
                                    </div>
                                    <ul className="list-disc list-inside px-2">
                                        {result.errors.map((err, idx) => (
                                            <li key={idx}>{err}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Summary Header */}
                            <div className="flex items-center justify-between bg-muted/30 p-4 rounded-lg border shrink-0">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full ${allHighConfidence ? "bg-green-100 text-green-600" : "bg-orange-100 text-orange-600"}`}>
                                        {allHighConfidence ? <CheckCircle className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                                    </div>
                                    <div>
                                        <h3 className="font-medium">
                                            {allHighConfidence ? "Análisis Exitoso" : "Revisión Recomendada"}
                                        </h3>
                                        <p className="text-sm text-muted-foreground">
                                            Se detectaron {items.length} artículos.
                                            {!allHighConfidence && ` ${needsAttention.length} requieren atención.`}
                                        </p>
                                    </div>
                                </div>

                                {/* Client Selector - Custom Inline Autocomplete to avoid Dialog Focus Trap */}
                                <div className="flex items-center gap-2 relative">
                                    <span className="text-sm text-muted-foreground">Cliente:</span>
                                    <div className="relative w-[250px]">
                                        <div className="relative">
                                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                placeholder={result.candidateCustomer ? `Detectado: ${result.candidateCustomer}` : "Buscar cliente..."}
                                                className="pl-8"
                                                value={selectedClienteName}
                                                onChange={(e) => {
                                                    setSelectedClienteName(e.target.value)
                                                    setClienteId("") // Reset ID on change until selected
                                                    if (e.target.value.length >= 2) {
                                                        handleSearchClientes(e.target.value)
                                                        setClienteSearchOpen(true)
                                                    } else {
                                                        setClienteSearchOpen(false)
                                                    }
                                                }}
                                                onFocus={() => {
                                                    if (selectedClienteName.length >= 2) setClienteSearchOpen(true)
                                                }}
                                            />
                                        </div>

                                        {clienteSearchOpen && clientesEncontrados.length > 0 && (
                                            <div className="absolute top-full left-0 w-full bg-popover border rounded-md shadow-md mt-1 z-50 max-h-[200px] overflow-auto">
                                                {clientesEncontrados.map(c => (
                                                    <div
                                                        key={c.id}
                                                        className="px-3 py-2 hover:bg-muted cursor-pointer text-sm flex items-center justify-between"
                                                        onClick={() => {
                                                            setClienteId(c.id)
                                                            setSelectedClienteName(c.razon_social)
                                                            setClienteSearchOpen(false)
                                                        }}
                                                    >
                                                        <span>{c.razon_social}</span>
                                                        {clienteId === c.id && <Check className="h-4 w-4 text-primary" />}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {clienteSearchOpen && clientesEncontrados.length === 0 && selectedClienteName.length >= 2 && (
                                            <div className="absolute top-full left-0 w-full bg-popover border rounded-md shadow-md mt-1 z-50 p-2 text-sm text-muted-foreground text-center">
                                                No encontrado
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Items Table */}
                            <ScrollArea className="flex-1 border rounded-md min-h-0 bg-background relative z-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[60%]">Artículo</TableHead>
                                            <TableHead className="w-[100px] text-center">Cant.</TableHead>
                                            <TableHead className="w-[120px] text-center">Estado</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {items.map((item, idx) => (
                                            <TableRow key={idx} className={item.confidence !== "HIGH" ? "bg-red-50/50" : ""}>
                                                <TableCell className="relative">
                                                    {searchingIdx === idx ? (
                                                        <div className="relative">
                                                            <Input
                                                                autoFocus
                                                                placeholder="Buscar producto..."
                                                                className="h-8 text-sm"
                                                                value={productSearchQuery}
                                                                onChange={(e) => {
                                                                    setProductSearchQuery(e.target.value)
                                                                    if (e.target.value.length >= 2) {
                                                                        handleSearchProducts(e.target.value)
                                                                    } else {
                                                                        setProductsFound([])
                                                                    }
                                                                }}
                                                            />
                                                            {productsFound.length > 0 && (
                                                                <div className="absolute top-full left-0 w-full bg-popover border rounded-md shadow-md mt-1 z-[60] max-h-[200px] overflow-auto">
                                                                    {productsFound.map(p => (
                                                                        <div
                                                                            key={p.id}
                                                                            className="px-3 py-2 hover:bg-muted cursor-pointer text-sm flex flex-col items-start border-b last:border-0"
                                                                            onClick={() => updateItemProduct(idx, p)}
                                                                        >
                                                                            <span className="font-medium">{p.descripcion}</span>
                                                                            <div className="text-[10px] text-muted-foreground flex gap-2">
                                                                                <span>SKU: {p.sku}</span>
                                                                                <span>${p.precio_venta || p.precio_base}</span>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            <div
                                                                className="absolute right-2 top-1.5 cursor-pointer text-muted-foreground hover:text-foreground"
                                                                onClick={() => setSearchingIdx(null)}
                                                            >
                                                                <X className="h-4 w-4" />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div
                                                            className="flex items-center justify-between group cursor-pointer hover:bg-muted/50 p-2 rounded-md transition-colors"
                                                            onClick={() => {
                                                                setSearchingIdx(idx)
                                                                setProductSearchQuery(item.matchedProduct?.descripcion || item.originalText)
                                                                if (item.matchedProduct?.descripcion || item.originalText) {
                                                                    handleSearchProducts(item.matchedProduct?.descripcion || item.originalText)
                                                                }
                                                            }}
                                                        >
                                                            {item.matchedProduct ? (
                                                                <div className="space-y-0.5">
                                                                    <div className="font-semibold text-sm text-primary">{item.matchedProduct.descripcion || item.matchedProduct.nombre}</div>
                                                                    <div className="text-xs text-muted-foreground flex gap-3">
                                                                        <span>SKU: {item.matchedProduct.sku}</span>
                                                                        <span>Original: {item.originalText}</span>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center gap-2">
                                                                    <AlertTriangle className="h-4 w-4 text-destructive" />
                                                                    <span className="text-destructive font-bold text-sm underline decoration-destructive/50 underline-offset-4">
                                                                        {item.originalText}
                                                                    </span>
                                                                    <span className="text-xs text-destructive/80 ml-2">(Clic para vincular)</span>
                                                                </div>
                                                            )}
                                                            <Search className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Input
                                                        type="number"
                                                        className="h-8 w-20 mx-auto text-center"
                                                        value={item.quantity}
                                                        onChange={(e) => {
                                                            const newItems = [...items]
                                                            newItems[idx].quantity = parseInt(e.target.value) || 0
                                                            setItems(newItems)
                                                        }}
                                                    />
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Badge variant="secondary" className={`${getConfidenceColor(item.confidence)} text-white border-0`}>
                                                        {item.confidence}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </ScrollArea>

                            <div className="flex justify-end gap-2 pt-2 pb-2 shrink-0 bg-background z-10">
                                <Button variant="outline" onClick={() => { setResult(null); setItems([]); }}>
                                    Cancelar / Subir Otro
                                </Button>
                                <Button
                                    onClick={handleCreateOrder}
                                    disabled={creating || items.length === 0}
                                    className="gap-2"
                                >
                                    {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Crear Pedido ({items.length})
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
