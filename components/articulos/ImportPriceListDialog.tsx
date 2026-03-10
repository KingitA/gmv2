import { useState, useMemo } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, Loader2, Upload, ArrowRight, Search, Save, FileText } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { createClient } from "@/lib/supabase/client"
import { parsePriceList } from "@/lib/parsing/price_list_parser"

interface ImportPriceListDialogProps {
    proveedores: any[]
    onImportSuccess: (updates: any[]) => void
}

export function ImportPriceListDialog({ proveedores, onImportSuccess }: ImportPriceListDialogProps) {
    const [open, setOpen] = useState(false)
    const [file, setFile] = useState<File | null>(null)
    const [proveedorId, setProveedorId] = useState<string>("")
    const [isLoading, setIsLoading] = useState(false)
    const [previewItems, setPreviewItems] = useState<any[]>([])
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [stats, setStats] = useState<any>(null)
    const [step, setStep] = useState<"upload" | "preview">("upload")
    const [detectedProviderName, setDetectedProviderName] = useState<string | null>(null)

    // New State for Advanced Features
    const [priceMode, setPriceMode] = useState<"UNITARIO" | "BULTO">("UNITARIO")
    const [globalDiscount, setGlobalDiscount] = useState<number>(0)
    const [reviewTab, setReviewTab] = useState<"linked" | "pending">("linked")

    // For manual matching
    const [searchTerm, setSearchTerm] = useState("")
    const [searchResults, setSearchResults] = useState<any[]>([])
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [isSearching, setIsSearching] = useState(false)
    const [selectedMappingItem, setSelectedMappingItem] = useState<number | null>(null) // Index of item being mapped

    const [pendingDbItems, setPendingDbItems] = useState<any[]>([])

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0])
            setDetectedProviderName(null)
        }
    }

    const processImport = async () => {
        if (!file) return
        setIsLoading(true)
        try {
            // Use the new robust parser
            const { parsePriceList } = await import('@/lib/parsing/price_list_parser');

            console.log("Starting parsePriceList with file:", file.name);

            const items = await parsePriceList(file, {
                price_mode: priceMode,
                provider_id: proveedorId
            });

            console.log(`[ImportDialog] Parsed ${items.length} items`);

            if (items.length === 0) {
                alert("⚠️ No se detectaron artículos válidos.\n\nPosibles causas:\n- El archivo no tiene una columna de 'Precio' numérica clara.\n- Faltan descripciones.\n- El archivo es una imagen pegada en Excel.\n\nIntente limpiar los títulos superiores.");
                setIsLoading(false);
                return;
            }

            // Send to generic pipeline
            const response = await fetch('/api/import/price_list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider_id: proveedorId,
                    items, // Sends ParsedItem[]
                    filename: file.name
                })
            });

            const result = await response.json();

            if (result.success) {
                // Redirect to the Processed Import Review Page
                window.location.href = `/imports/${result.importId}`;
            } else {
                alert("Error creating import: " + (result.error || "Unknown error"));
            }
            setIsLoading(false);





        } catch (error: any) {
            alert(error.message)
            setIsLoading(false)
        }
    }

    // --- LOGIC FOR PRICE CALCULATION ---
    const getCalculatedPrice = (item: any) => {
        let basePrice = item.new_precio > 0 ? item.new_precio : item.old_precio

        if (globalDiscount > 0) {
            basePrice = basePrice * (1 - (globalDiscount / 100))
        }

        return basePrice
    }

    const getVariation = (item: any) => {
        const newP = getCalculatedPrice(item)
        const oldP = item.old_precio || 0
        if (oldP === 0) return 100
        return ((newP - oldP) / oldP) * 100
    }

    // --- MANUAL MATCHING LOGIC ---
    const searchArticles = async (term: string) => {
        if (!term || term.length < 2) return
        setIsSearching(true)
        const supabase = createClient()
        const { data } = await supabase
            .from("articulos")
            .select("id, descripcion, sku")
            .ilike("descripcion", `%${term}%`)
            .eq("activo", true)
            .limit(10)

        setSearchResults(data || [])
        setIsSearching(false)
    }

    const saveMapping = async (itemIndex: number, article: any) => {
        if (!proveedorId) {
            alert("Seleccione un proveedor primero")
            return
        }

        const item = previewItems[itemIndex]

        try {
            await fetch("/api/articulos/mappings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    proveedor_id: proveedorId,
                    articulo_id: article.id,
                    codigo_proveedor: item.original_code,
                    descripcion_proveedor: item.original_desc
                })
            })

            // Update local state
            const newItems = [...previewItems]
            newItems[itemIndex] = {
                ...newItems[itemIndex],
                articulo_id: article.id,
                articulo_desc: article.descripcion,
                articulo_sku: article.sku,
                status: "found",
                old_precio: 0,
                match_confidence: 1
            }
            setPreviewItems(newItems)
            setSelectedMappingItem(null)
            setSearchTerm("")
            setSearchResults([])

        } catch (error) {
            console.error(error)
            alert("Error al guardar vinculación")
        }
    }

    const confirmImport = () => {
        const updates = previewItems
            .filter(item => item.articulo_id) // Only linked items
            .map(item => {
                const finalPrice = getCalculatedPrice(item)
                return {
                    articulo_id: item.articulo_id,
                    precio_compra: finalPrice,
                    descuento1: 0
                }
            })

        if (updates.length > 0) {
            onImportSuccess(updates)
            setOpen(false)
            setStep("upload")
            setFile(null)
            setPreviewItems([])
        } else {
            alert("No hay artículos vinculados para actualizar.")
        }
    }

    // Filter File Items for manual matching (only show those not linked yet)
    const availableFileItems = useMemo(() => previewItems.filter(i => !i.articulo_id), [previewItems])
    const linkedItems = useMemo(() => previewItems.filter(i => i.articulo_id), [previewItems, globalDiscount])

    const linkManualItem = (dbArticle: any, fileItem: any) => {
        // Find index of fileItem in previewItems
        const idx = previewItems.indexOf(fileItem)
        if (idx === -1) return

        const newItems = [...previewItems]
        newItems[idx] = {
            ...newItems[idx],
            articulo_id: dbArticle.id,
            articulo_desc: dbArticle.descripcion,
            articulo_sku: dbArticle.sku,
            status: "manual_linked",
            old_precio: dbArticle.precio_compra || 0,
            descuento1: dbArticle.descuento1 || 0
            // Note: price calculation happens in getCalculatedPrice/confirmImport using this new data
        }

        setPreviewItems(newItems)
        // Remove from pending DB list locally to update UI immediately
        setPendingDbItems(prev => prev.filter(p => p.id !== dbArticle.id))
        setSelectedMappingItem(null)
        setSearchTerm("")
    }

    // ...

    {/* PENDING TAB: INVERTED FLOW (DB Items -> Search in File) */ }
    // ...

    return (
        <Dialog open={open} onOpenChange={(val) => { setOpen(val); if (!val) setStep("upload"); }}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <Upload className="h-4 w-4" />
                    Importar Precios
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[90vw] w-full max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Importar Lista de Precios</DialogTitle>
                </DialogHeader>

                {step === "upload" && (
                    <div className="space-y-6 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Proveedor</Label>
                                <Select value={proveedorId || "auto"} onValueChange={(val) => setProveedorId(val === "auto" ? "" : val)}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Detectar automáticamente" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="auto">Detectar automáticamente</SelectItem>
                                        {proveedores.map(p => (
                                            <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Modo de Precio</Label>
                                <Select value={priceMode} onValueChange={(val: any) => setPriceMode(val)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="UNITARIO">Precio Unitario</SelectItem>
                                        <SelectItem value="BULTO">Precio por Bulto</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Archivo (Excel o Imagen OCR)</Label>
                            <div className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-muted/50 transition"
                                onClick={() => document.getElementById('price-file-upload')?.click()}>
                                <FileText className="h-10 w-10 text-muted-foreground mb-2" />
                                {file ? (
                                    <span className="text-sm font-medium">{file.name}</span>
                                ) : (
                                    <span className="text-sm text-muted-foreground">Click para subir archivo</span>
                                )}
                                <Input id="price-file-upload" type="file" className="hidden" onChange={handleFileChange} accept=".xlsx,.xls,.jpg,.jpeg,.png" />
                            </div>
                        </div>

                        <Button onClick={processImport} disabled={!file || isLoading} className="w-full">
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                            Procesar Lista
                        </Button>
                    </div>
                )}

                {step === "preview" && (
                    <div className="flex flex-col flex-1 overflow-hidden gap-4">
                        {/* Summary Header */}
                        <div className="flex items-center justify-between bg-muted/30 p-3 rounded-lg border">
                            <div className="flex items-center gap-4">
                                {detectedProviderName && <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">{detectedProviderName}</Badge>}
                                <div className="text-sm text-muted-foreground">
                                    Total: <strong>{previewItems.length}</strong> | Vinculados: <strong>{linkedItems.length}</strong> | Pendientes DB: <strong>{pendingDbItems.length}</strong>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Label className="whitespace-nowrap">Descuento Global (%):</Label>
                                <Input
                                    type="number"
                                    className="w-20"
                                    value={globalDiscount}
                                    onChange={e => setGlobalDiscount(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        {!proveedorId && !detectedProviderName && (
                            <Alert variant="destructive">
                                <AlertCircle className="h-4 w-4" />
                                <AlertTitle>Proveedor requerido</AlertTitle>
                                <AlertDescription>Seleccione un proveedor para habilitar la vinculación automática.</AlertDescription>
                            </Alert>
                        )}

                        <Tabs value={reviewTab} onValueChange={(v: any) => setReviewTab(v)} className="flex-1 flex flex-col overflow-hidden">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="linked">Vinculados ({linkedItems.length} articulos)</TabsTrigger>
                                <TabsTrigger value="pending">Pendientes de Revisión ({pendingDbItems.length})</TabsTrigger>
                            </TabsList>

                            {/* LINKED TAB */}
                            <TabsContent value="linked" className="border rounded-md mt-2">
                                <div className="h-[400px] overflow-y-auto">
                                    <Table>
                                        <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                                            <TableRow>
                                                <TableHead>Producto (Importado)</TableHead>
                                                <TableHead>Artículo Interno</TableHead>
                                                <TableHead className="text-right">Precio Actual</TableHead>
                                                <TableHead></TableHead>
                                                <TableHead className="text-right">Nuevo Precio (c/Desc)</TableHead>
                                                <TableHead className="text-right">Var %</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {linkedItems.map((item, idx) => (
                                                <TableRow key={idx}>
                                                    <TableCell>
                                                        <div className="font-medium">{item.original_desc}</div>
                                                        <div className="text-xs text-muted-foreground">{item.original_code}</div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="text-blue-600 font-medium">{item.articulo_desc}</div>
                                                        <div className="text-xs">{item.articulo_sku}</div>
                                                    </TableCell>
                                                    <TableCell className="text-right">${item.old_precio?.toFixed(2)}</TableCell>
                                                    <TableCell><ArrowRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                                                    <TableCell className="text-right font-bold">
                                                        ${getCalculatedPrice(item).toFixed(2)}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <span className={getVariation(item) > 0 ? "text-red-600" : "text-green-600"}>
                                                            {getVariation(item).toFixed(1)}%
                                                        </span>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            {linkedItems.length === 0 && (
                                                <TableRow>
                                                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                                        No hay artículos vinculados. Revisá la pestaña "Pendientes" para vincular manualmente.
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </TabsContent>

                            <TabsContent value="pending" className="border rounded-md mt-2">
                                <div className="h-[400px] overflow-y-auto relative">
                                    <Table>
                                        <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                                            <TableRow>
                                                <TableHead className="w-[50%]">Mi Artículo (Sin actualizar)</TableHead>
                                                <TableHead className="w-[50%]">Buscar en Archivo</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {pendingDbItems.map((dbItem) => (
                                                <TableRow key={dbItem.id}>
                                                    <TableCell className="align-top">
                                                        <div className="font-medium text-blue-700">{dbItem.descripcion}</div>
                                                        <div className="text-xs text-muted-foreground">SKU: {dbItem.sku}</div>
                                                        <div className="text-xs font-mono mt-1">
                                                            Último Precio: ${dbItem.precio_compra}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="align-top">
                                                        {selectedMappingItem === dbItem.id ? (
                                                            <div className="space-y-2">
                                                                <div className="flex gap-2">
                                                                    <div className="relative flex-1">
                                                                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                                                        <Input
                                                                            autoFocus
                                                                            placeholder="Buscar en archivo..."
                                                                            className="pl-8 h-9"
                                                                            value={searchTerm}
                                                                            onChange={e => setSearchTerm(e.target.value)}
                                                                        />
                                                                    </div>
                                                                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSelectedMappingItem(null)}>x</Button>
                                                                </div>

                                                                {/* File Item Search Results */}
                                                                <div className="border rounded-md max-h-60 overflow-y-auto bg-white shadow-lg space-y-1 p-1 z-20 relative">
                                                                    {availableFileItems
                                                                        .filter(fi => !searchTerm ||
                                                                            fi.original_desc.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                                                            (fi.original_code && fi.original_code.includes(searchTerm)))
                                                                        .slice(0, 50) // Limit results
                                                                        .map((fi, idx) => (
                                                                            <div
                                                                                key={idx}
                                                                                className="p-2 hover:bg-slate-100 cursor-pointer rounded text-sm group"
                                                                                onClick={() => linkManualItem(dbItem, fi)}
                                                                            >
                                                                                <div className="font-medium truncate">{fi.original_desc}</div>
                                                                                <div className="flex justify-between text-xs text-muted-foreground">
                                                                                    <span>{fi.original_code}</span>
                                                                                    <span className="text-green-600 font-bold">${fi.new_precio?.toFixed(2)}</span>
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    {availableFileItems.length === 0 && <div className="p-2 text-xs text-muted-foreground">No hay items disponibles.</div>}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <Button size="sm" variant="secondary" className="gap-2 w-full justify-start" onClick={() => {
                                                                setSelectedMappingItem(dbItem.id) // Use ID for tracking now
                                                                setSearchTerm("")
                                                            }}>
                                                                <Search className="h-3 w-3" />
                                                                Vincular con Item del Archivo
                                                            </Button>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            {pendingDbItems.length === 0 && (
                                                <TableRow>
                                                    <TableCell colSpan={2} className="text-center py-8 text-green-600 font-medium">
                                                        ¡Excelente! No hay artículos internos pendientes de vincular.
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </TabsContent>
                        </Tabs>

                        <div className="flex justify-between items-center pt-2 border-t">
                            <Button variant="ghost" onClick={() => setStep("upload")}>Cancelar</Button>
                            <div className="flex items-center gap-4">
                                <div className="text-sm text-right">
                                    <div className="font-bold">{linkedItems.length} artículos a actualizar</div>
                                </div>
                                <Button onClick={confirmImport} disabled={linkedItems.length === 0} className="gap-2">
                                    <Save className="h-4 w-4" />
                                    Confirmar Actualización
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
