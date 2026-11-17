"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertCircle, CheckCircle2, FileText, Loader2, Upload, AlertTriangle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { moneda, numero, porcentaje } from "@/lib/formato"
import { toast } from "sonner"

/** Lo que el archivo deja listo para la orden (E-13) */
export interface ResultadoImportacionOC {
    proveedorId: string
    /** En qué vienen las cantidades del archivo: lo elige el usuario, no se adivina */
    unidad: "bulto" | "unidad"
    /** Renglones vinculados a un artículo del catálogo */
    items: { articulo_id: string; cantidad: number; precio: number | null; descuento1: number | null }[]
    /** Renglones que no se pudieron vincular: van a revisión dentro de la orden, no se pueden guardar así */
    sinArticulo: { descripcion: string; codigo: string | null; cantidad: number; precio: number }[]
}

interface ImportOrderDialogProps {
    proveedores: any[]
    onImportSuccess: (r: ResultadoImportacionOC) => void
}

export function ImportOrderDialog({ proveedores, onImportSuccess }: ImportOrderDialogProps) {
    const [open, setOpen] = useState(false)
    const [file, setFile] = useState<File | null>(null)
    const [proveedorId, setProveedorId] = useState<string>("")
    const [isLoading, setIsLoading] = useState(false)
    const [previewItems, setPreviewItems] = useState<any[]>([])
    const [stats, setStats] = useState<any>(null)
    const [step, setStep] = useState<"upload" | "preview">("upload")
    const [unidad, setUnidad] = useState<"bulto" | "unidad" | "">("")

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
            toast.error(error.message || "No se pudo leer el archivo.", { duration: 10000 })
        } finally {
            setIsLoading(false)
        }
    }

    const confirmImport = () => {
        if (unidad !== "bulto" && unidad !== "unidad") {
            toast.error("Elegí si las cantidades del archivo son bultos o unidades.")
            return
        }
        // E-13: lo vinculado va a la orden; lo que no tiene artículo NO entra como renglón:
        // queda en una lista de revisión dentro de la orden (vincular o descartar).
        // Las unidades por bulto no salen del archivo: las pone el catálogo.
        const conCantidad = previewItems.filter((item) => Number(item.cantidad_pedida) > 0)
        const items = conCantidad.filter((item) => item.articulo_id).map((item) => ({
            articulo_id: item.articulo_id as string,
            cantidad: Number(item.cantidad_pedida),
            precio: Number(item.precio_unitario) > 0 ? Number(item.precio_unitario) : null,
            descuento1: Number(item.descuento1) > 0 ? Number(item.descuento1) : null,
        }))
        const sinArticulo = conCantidad.filter((item) => !item.articulo_id).map((item) => ({
            descripcion: String(item.original_desc || ""),
            codigo: item.original_code ? String(item.original_code) : null,
            cantidad: Number(item.cantidad_pedida),
            precio: Number(item.precio_unitario) || 0,
        }))
        if (items.length === 0 && sinArticulo.length === 0) {
            toast.error("El archivo no tiene renglones con cantidad.")
            return
        }
        onImportSuccess({ proveedorId, unidad, items, sinArticulo })
        setOpen(false)
        resetState()
    }

    const resetState = () => {
        setFile(null)
        setPreviewItems([])
        setStats(null)
        setStep("upload")
        setUnidad("")
    }

    return (
        <Dialog open={open} onOpenChange={(val) => { setOpen(val); if (!val) resetState(); }}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <Upload className="h-4 w-4" />
                    Importar desde archivo
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
                                            <TableCell>{numero(item.cantidad_pedida, 0, 2)}</TableCell>
                                            <TableCell>{moneda(item.precio_unitario)}</TableCell>
                                            <TableCell>
                                                {item.status === 'found' && <span className="text-green-600 text-xs font-bold">Encontrado</span>}
                                                {item.status === 'suggested' && <span className="text-yellow-600 text-xs font-bold">Sug. {porcentaje(item.match_confidence * 100, 0)}</span>}
                                                {item.status === 'not_found' && <span className="text-red-500 text-xs font-bold">Sin artículo</span>}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        <div className="flex justify-between items-center pt-2">
                            <div className="space-y-1.5 text-sm">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium">Las cantidades del archivo son:</span>
                                    <Select value={unidad} onValueChange={(v) => setUnidad(v === "unidad" ? "unidad" : "bulto")}>
                                        <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Elegir…" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="bulto">bultos</SelectItem>
                                            <SelectItem value="unidad">unidades</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="text-muted-foreground">
                                    Lo que no tiene artículo queda a revisión dentro de la orden: hay que vincularlo o descartarlo antes de guardar.
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" onClick={() => setStep("upload")}>Atrás</Button>
                                <Button onClick={confirmImport} disabled={!unidad}>Pasar a la orden</Button>
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
