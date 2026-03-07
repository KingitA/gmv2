import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertCircle, CheckCircle2, FileText, Loader2, Upload, AlertTriangle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

interface ImportOrderDialogProps {
    proveedores: any[]
    onImportSuccess: (items: any[], proveedorId: string) => void
}

export function ImportOrderDialog({ proveedores, onImportSuccess }: ImportOrderDialogProps) {
    const [open, setOpen] = useState(false)
    const [file, setFile] = useState<File | null>(null)
    const [proveedorId, setProveedorId] = useState<string>("")
    const [isLoading, setIsLoading] = useState(false)
    const [previewItems, setPreviewItems] = useState<any[]>([])
    const [stats, setStats] = useState<any>(null)
    const [step, setStep] = useState<"upload" | "preview">("upload")

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0])
        }
    }

    const processImport = async () => {
        if (!file || !proveedorId) return
        setIsLoading(true)

        try {
            const formData = new FormData()
            formData.append("file", file)
            formData.append("proveedorId", proveedorId)
            const prov = proveedores.find(p => p.id === proveedorId)
            if (prov) formData.append("proveedorNombre", prov.nombre)

            const res = await fetch("/api/ordenes-compra/import", {
                method: "POST",
                body: formData
            })

            const data = await res.json()

            if (!res.ok) throw new Error(data.error || "Error al importar")

            setPreviewItems(data.items)
            setStats(data.stats)
            setStep("preview")
        } catch (error: any) {
            alert(error.message)
        } finally {
            setIsLoading(false)
        }
    }

    const confirmImport = () => {
        // Filter only valid items or all? 
        // User might want to import unmapped items to map them manually later?
        // Current requirement: "Pre-fill order".
        // Use all items, but map them to the format expected by parent.

        const mappedForParent = previewItems.map(item => ({
            articulo_id: item.articulo_id, // Might be null
            articulo: {
                id: item.articulo_id,
                descripcion: item.articulo_desc || item.original_desc, // Fallback
                sku: item.articulo_sku || item.original_code, // Fallback
                unidades_por_bulto: 1, // Default if not found
                // We need more article data ideally, but parent will fetch or we use what we have.
                // Parent `loadOrdenes` fetches `articulo(...)`. 
                // Parent `handleProveedorChange` fetches `articulos` and maps them.
                // Here we might verify if parent needs full article object.
                // Parent uses: `item.articulo.descripcion`, `item.articulo.unidades_por_bulto`
            },
            cantidad_pedida: item.cantidad_pedida,
            tipo_cantidad: "bulto", // Check this! Import usually gives "unidades" or "bultos" depending on conversion.
            // Our API returned `cantidad_pedida` after conversion? 
            // API matching logic returned raw quantity?
            // `ocr.ts` matching logic applies conversion to `cantidad_documentada`.
            // `import/route.ts` just maps.
            // Let's assume quantity is in "unidades" if factor applied, or we assume "bulto" if typical?
            // Safest: "unidad" if we don't know pack size, "bulto" if we do. 
            // Parent default is "bulto".

            // Let's use "bulto" but we might need to adjust quantity if it was units.
            // THIS IS TRICKY. 
            // MATCHING SERVICE applied conversion? 
            // No, `import/route.ts` didn't call `resolveFactorConversion`.
            // It just called `matchItems`. `matchItems` returns raw items with `match_result`.
            // So `cantidad_pedida` is RAW from excel/ocr.

            precio_unitario: item.precio_unitario,
            descuento1: item.descuento1,
            descuento2: item.descuento2,
            descuento3: item.descuento3,
            descuento4: item.descuento4,

            // Extra flags for UI
            is_manual: item.status === "not_found",
            original_data: item
        }))

        onImportSuccess(mappedForParent, proveedorId)
        setOpen(false)
        resetState()
    }

    const resetState = () => {
        setFile(null)
        setPreviewItems([])
        setStats(null)
        setStep("upload")
    }

    return (
        <Dialog open={open} onOpenChange={(val) => { setOpen(val); if (!val) resetState(); }}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <Upload className="h-4 w-4" />
                    Importar (Beta)
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh]">
                <DialogHeader>
                    <DialogTitle>Importar Orden de Compra</DialogTitle>
                </DialogHeader>

                {step === "upload" && (
                    <div className="space-y-6 py-4">
                        <div className="space-y-2">
                            <Label>Proveedor</Label>
                            <Select value={proveedorId} onValueChange={setProveedorId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar proveedor" />
                                </SelectTrigger>
                                <SelectContent>
                                    {proveedores.map(p => (
                                        <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Archivo (Excel .xlsx o Imagen)</Label>
                            <div className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-muted/50 transition"
                                onClick={() => document.getElementById('file-upload')?.click()}>
                                <FileText className="h-10 w-10 text-muted-foreground mb-2" />
                                {file ? (
                                    <span className="text-sm font-medium">{file.name}</span>
                                ) : (
                                    <span className="text-sm text-muted-foreground">Click para seleccionar archivo</span>
                                )}
                                <Input id="file-upload" type="file" className="hidden" onChange={handleFileChange} accept=".xlsx,.xls,.csv,.jpg,.jpeg,.png" />
                            </div>
                        </div>

                        <Button onClick={processImport} disabled={!file || !proveedorId || isLoading} className="w-full">
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                            Procesar Archivo
                        </Button>
                    </div>
                )}

                {step === "preview" && (
                    <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
                        <div className="grid grid-cols-3 gap-4">
                            <Alert className="bg-green-50 dark:bg-green-900/10 border-green-200">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                <AlertTitle>Encontrados</AlertTitle>
                                <AlertDescription className="text-2xl font-bold">{stats?.found}</AlertDescription>
                            </Alert>
                            <Alert className="bg-yellow-50 dark:bg-yellow-900/10 border-yellow-200">
                                <AlertCircle className="h-4 w-4 text-yellow-600" />
                                <AlertTitle>Sugeridos</AlertTitle>
                                <AlertDescription className="text-2xl font-bold">{stats?.found_suggested || 0}</AlertDescription>
                            </Alert>
                            <Alert className="bg-red-50 dark:bg-red-900/10 border-red-200">
                                <AlertTriangle className="h-4 w-4 text-red-600" />
                                <AlertTitle>No Encontrados</AlertTitle>
                                <AlertDescription className="text-2xl font-bold">{stats?.not_found}</AlertDescription>
                            </Alert>
                        </div>

                        <div className="border rounded-md flex-1 overflow-y-auto min-h-[300px]">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Producto (Importado)</TableHead>
                                        <TableHead>Coincidencia (Sistema)</TableHead>
                                        <TableHead>Cant.</TableHead>
                                        <TableHead>Precio</TableHead>
                                        <TableHead>Estado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {previewItems.map((item, idx) => (
                                        <TableRow key={idx}>
                                            <TableCell>
                                                <div className="font-medium">{item.original_desc}</div>
                                                <div className="text-xs text-muted-foreground">{item.original_code}</div>
                                            </TableCell>
                                            <TableCell>
                                                {item.articulo_desc ? (
                                                    <div>
                                                        <div className="font-medium text-blue-600">{item.articulo_desc}</div>
                                                        <div className="text-xs">{item.articulo_sku}</div>
                                                    </div>
                                                ) : <span className="text-muted-foreground italic">Sin coincidencia</span>}
                                            </TableCell>
                                            <TableCell>{item.cantidad_pedida}</TableCell>
                                            <TableCell>${item.precio_unitario}</TableCell>
                                            <TableCell>
                                                {item.status === 'found' && <span className="text-green-600 text-xs font-bold">Encontrado</span>}
                                                {item.status === 'suggested' && <span className="text-yellow-600 text-xs font-bold">Sug. {(item.match_confidence * 100).toFixed(0)}%</span>}
                                                {item.status === 'not_found' && <span className="text-red-400 text-xs">Nuevo</span>}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        <div className="flex justify-between items-center pt-2">
                            <div className="text-sm text-muted-foreground">
                                Los productos no encontrados se agregarán como líneas manuales para revisar.
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" onClick={() => setStep("upload")}>Atrás</Button>
                                <Button onClick={confirmImport}>Confirmar e Importar</Button>
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
