export const dynamic = 'force-dynamic'
"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Loader2, ArrowLeft, Check, X, Search, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { getPendingImports, approveImport, rejectImport } from "@/lib/actions/import-review"
import { Input } from "@/components/ui/input"
import { searchClientes } from "@/lib/actions/clientes"
import { searchProductos } from "@/lib/actions/productos"

export default function ImportReviewPage() {
    const [imports, setImports] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedImport, setSelectedImport] = useState<any>(null)
    const [processing, setProcessing] = useState(false)

    // Editing state for selected import
    const [items, setItems] = useState<any[]>([])
    const [clienteId, setClienteId] = useState("")
    const [selectedClienteName, setSelectedClienteName] = useState("")
    const [clienteSearchOpen, setClienteSearchOpen] = useState(false)
    const [clientesEncontrados, setClientesEncontrados] = useState<any[]>([])

    // Manual product linking state
    const [linkingItemIndex, setLinkingItemIndex] = useState<number | null>(null)
    const [productSearchTerm, setProductSearchTerm] = useState("")
    const [productSearchResults, setProductSearchResults] = useState<any[]>([])
    const [isSearchingProduct, setIsSearchingProduct] = useState(false)

    useEffect(() => {
        loadImports()
    }, [])

    const loadImports = async () => {
        setLoading(true)
        try {
            const data = await getPendingImports()
            setImports(data)
        } catch (error) {
            console.error(error)
            toast.error("Error al cargar importaciones")
        } finally {
            setLoading(false)
        }
    }

    const handleSelectImport = (imp: any) => {
        setSelectedImport(imp)
        const transformedItems = imp.import_items.map((ii: any) => {
            const hasLink = !!ii.linkedArticulo;
            const isConfidenceHigh = ii.status === "matched" || ii.match_confidence >= 0.82;
            return {
                id: ii.id,
                originalText: ii.raw_data.description,
                quantity: ii.raw_data.quantity,
                matchedProduct: ii.linkedArticulo ? {
                    id: ii.linkedArticulo.id,
                    descripcion: ii.linkedArticulo.descripcion,
                    sku: ii.linkedArticulo.sku,
                    precio_base: ii.linkedArticulo.precio_base
                } : null,
                confidence: hasLink && isConfidenceHigh ? "HIGH" : (ii.match_confidence > 0.6 ? "MEDIUM" : "LOW")
            };
        })
        setItems(transformedItems)
        setClienteId(imp.meta.cliente_id || "")
        setSelectedClienteName(imp.meta.cliente_nombre || "")
    }

    const handleSearchClientes = async (term: string) => {
        if (term.length < 2) return
        const res = await searchClientes(term)
        setClientesEncontrados(res || [])
    }

    const handleSearchProducts = async (term: string) => {
        setProductSearchTerm(term)
        if (term.length < 2) {
            setProductSearchResults([])
            return
        }
        setIsSearchingProduct(true)
        try {
            const res = await searchProductos(term)
            setProductSearchResults(res || [])
        } catch (error) {
            console.error(error)
        } finally {
            setIsSearchingProduct(false)
        }
    }

    const handleAssignProduct = (idx: number, product: any) => {
        const newItems = [...items]
        newItems[idx].matchedProduct = {
            id: product.id,
            descripcion: product.descripcion || product.nombre,
            sku: product.sku,
            precio_base: product.precio_base
        }
        newItems[idx].confidence = "HIGH"
        newItems[idx].manuallyMatched = true
        setItems(newItems)
        setLinkingItemIndex(null)
        setProductSearchTerm("")
        setProductSearchResults([])
    }

    const handleApprove = async () => {
        if (!clienteId) {
            toast.error("Por favor selecciona un cliente")
            return
        }
        setProcessing(true)
        try {
            await approveImport(selectedImport.id, clienteId, items)
            toast.success("Pedido creado y aprobado")
            setSelectedImport(null)
            loadImports()
        } catch (error) {
            console.error(error)
            toast.error("Error al aprobar importación")
        } finally {
            setProcessing(false)
        }
    }

    const handleReject = async (id: string) => {
        if (!confirm("¿Seguro que deseas descartar esta importación?")) return
        try {
            await rejectImport(id)
            toast.success("Importación descartada")
            if (selectedImport?.id === id) setSelectedImport(null)
            loadImports()
        } catch (error) {
            console.error(error)
            toast.error("Error al descartar")
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" asChild>
                    <a href="/clientes-pedidos"><ArrowLeft className="h-4 w-4 mr-2" /> Volver</a>
                </Button>
                <h1 className="text-3xl font-bold">Revisión de Pedidos Automáticos</h1>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* List of Imports */}
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle className="text-lg">Cola de Pendientes ({imports.length})</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        {imports.length === 0 ? (
                            <div className="p-10 text-center text-muted-foreground">
                                No hay importaciones pendientes.
                            </div>
                        ) : (
                            <div className="divide-y">
                                {imports.map((imp) => (
                                    <div
                                        key={imp.id}
                                        className={`p-4 cursor-pointer hover:bg-muted transition-colors ${selectedImport?.id === imp.id ? "bg-muted" : ""}`}
                                        onClick={() => handleSelectImport(imp)}
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <Badge variant="secondary">{imp.meta.source?.toUpperCase() || "AUTO"}</Badge>
                                            <span className="text-xs text-muted-foreground">
                                                {new Date(imp.created_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}
                                            </span>
                                        </div>
                                        <div className="font-medium truncate">{imp.meta.sender || "Remitente desconocido"}</div>
                                        <div className="text-sm text-muted-foreground">
                                            {imp.meta.total_items} artículos detectados
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Import Details & Editor */}
                <Card className="lg:col-span-2">
                    {selectedImport ? (
                        <>
                            <CardHeader className="flex flex-row items-center justify-between border-b px-6 py-4">
                                <div>
                                    <CardTitle className="text-lg">Detalles de la Importación</CardTitle>
                                    <p className="text-sm text-muted-foreground">Origen: {selectedImport.meta.source}</p>
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" onClick={() => handleReject(selectedImport.id)}>
                                        <X className="h-4 w-4 mr-1" /> Descartar
                                    </Button>
                                    <Button size="sm" onClick={handleApprove} disabled={processing}>
                                        {processing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                                        <Check className="h-4 w-4 mr-1" /> Aprobar y Crear Pedido
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="p-6 space-y-6">
                                {/* Client Selection */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Asignar Cliente</label>
                                    <div className="relative">
                                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Buscar cliente..."
                                            className="pl-8"
                                            value={selectedClienteName}
                                            onChange={(e) => {
                                                setSelectedClienteName(e.target.value)
                                                if (e.target.value.length >= 2) {
                                                    handleSearchClientes(e.target.value)
                                                    setClienteSearchOpen(true)
                                                } else {
                                                    setClienteSearchOpen(false)
                                                }
                                            }}
                                        />
                                        {clienteSearchOpen && clientesEncontrados.length > 0 && (
                                            <div className="absolute top-full left-0 w-full bg-popover border rounded-md shadow-md mt-1 z-50 max-h-[200px] overflow-auto">
                                                {clientesEncontrados.map(c => (
                                                    <div
                                                        key={c.id}
                                                        className="px-3 py-2 hover:bg-muted cursor-pointer text-sm"
                                                        onClick={() => {
                                                            setClienteId(c.id)
                                                            setSelectedClienteName(c.razon_social)
                                                            setClienteSearchOpen(false)
                                                        }}
                                                    >
                                                        {c.razon_social}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    {!clienteId && (
                                        <div className="text-xs text-destructive flex items-center gap-1">
                                            <AlertCircle className="h-3 w-3" /> Debe seleccionar un cliente para continuar.
                                        </div>
                                    )}
                                </div>

                                {/* Items Table */}
                                <div className="border rounded-md">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Artículo Detectado</TableHead>
                                                <TableHead className="w-[100px] text-center">Cant.</TableHead>
                                                <TableHead>Acción</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {items.map((item, idx) => (
                                                <TableRow key={idx} className={item.confidence !== "HIGH" ? "bg-red-50/50" : ""}>
                                                    <TableCell>
                                                        {linkingItemIndex === idx ? (
                                                            <div className="space-y-2 relative">
                                                                <div className="flex items-center gap-2">
                                                                    <Input
                                                                        autoFocus
                                                                        placeholder="Buscar artículo..."
                                                                        value={productSearchTerm}
                                                                        onChange={(e) => handleSearchProducts(e.target.value)}
                                                                        className="w-full"
                                                                    />
                                                                    <Button variant="ghost" size="icon" onClick={() => { setLinkingItemIndex(null); setProductSearchTerm(""); setProductSearchResults([]) }}>
                                                                        <X className="h-4 w-4" />
                                                                    </Button>
                                                                </div>
                                                                {productSearchResults.length > 0 && (
                                                                    <div className="absolute top-full left-0 w-[400px] max-w-full bg-background border rounded-md shadow-lg mt-1 z-50 max-h-[250px] overflow-auto">
                                                                        {productSearchResults.map(p => (
                                                                            <div
                                                                                key={p.id}
                                                                                className="px-3 py-2 hover:bg-muted cursor-pointer text-sm border-b last:border-0"
                                                                                onClick={() => handleAssignProduct(idx, p)}
                                                                            >
                                                                                <div className="font-medium">{p.descripcion || p.nombre}</div>
                                                                                <div className="text-xs text-muted-foreground flex gap-2">
                                                                                    <span>SKU: {p.sku}</span>
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                {isSearchingProduct && (
                                                                    <div className="absolute top-full left-0 w-full p-2 bg-background border rounded-md shadow-lg mt-1 z-50 text-center text-xs text-muted-foreground">
                                                                        Buscando...
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : item.matchedProduct ? (
                                                            <div className="space-y-0.5">
                                                                <div className="font-semibold text-sm text-primary">{item.matchedProduct.descripcion}</div>
                                                                <div className="text-xs text-muted-foreground flex gap-3">
                                                                    <span>SKU: {item.matchedProduct.sku}</span>
                                                                    <span>Original: {item.originalText}</span>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-2" onDoubleClick={() => setLinkingItemIndex(idx)}>
                                                                <span className="text-destructive font-bold text-sm underline decoration-destructive/50 underline-offset-4 cursor-pointer" onClick={() => setLinkingItemIndex(idx)}>
                                                                    {item.originalText}
                                                                </span>
                                                            </div>
                                                        )}
                                                        <div className="text-xs text-muted-foreground mt-1">
                                                            Confianza: {item.confidence} {item.manuallyMatched && "(Manual)"}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        {item.quantity}
                                                    </TableCell>
                                                    <TableCell>
                                                        {linkingItemIndex === idx ? (
                                                            <Badge variant="outline">Buscando...</Badge>
                                                        ) : (
                                                            <Badge
                                                                variant={item.matchedProduct ? "default" : "secondary"}
                                                                className={item.matchedProduct ? "bg-green-600 hover:bg-green-700 cursor-pointer" : "cursor-pointer hover:bg-muted-foreground/20"}
                                                                onClick={() => { if (!item.matchedProduct) setLinkingItemIndex(idx) }}
                                                            >
                                                                {item.matchedProduct ? "Vinculado" : "Haga clic para buscar"}
                                                            </Badge>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                            <AlertCircle className="h-12 w-12 mb-4 opacity-20" />
                            <p>Selecciona una importación de la lista para revisarla.</p>
                        </div>
                    )}
                </Card>
            </div>
        </div>
    )
}

