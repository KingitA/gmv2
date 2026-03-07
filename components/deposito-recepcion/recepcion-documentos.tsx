"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, Upload, FileCheck, AlertCircle, ArrowRight, Trash2, FileText } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import Image from "next/image"

interface RecepcionDocumentosProps {
    recepcion: any
    onUpdate: () => void
    onNext: () => void
}

export function RecepcionDocumentos({ recepcion, onUpdate, onNext }: RecepcionDocumentosProps) {
    const [isUploading, setIsUploading] = useState(false)
    const [tipoDocumento, setTipoDocumento] = useState("factura")
    const { toast } = useToast()

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setIsUploading(true)
        const formData = new FormData()
        formData.append("file", file)
        formData.append("tipo_documento", tipoDocumento)

        try {
            const response = await fetch(`/api/recepciones/${recepcion.id}/ocr`, {
                method: "POST",
                body: formData,
            })

            if (!response.ok) throw new Error("Error al subir documento")

            const result = await response.json()

            if (result.document?.datos_ocr?.fallback) {
                toast({
                    variant: "default", // or "warning" if available, usually destructive or default
                    title: "Atención: Lectura Limitada",
                    description: "No se pudieron leer todos los items automáticamente. Por favor verificá manualmente.",
                    className: "bg-yellow-50 border-yellow-200 text-yellow-800"
                })
            } else {
                toast({
                    title: "Documento procesado",
                    description: `Se detectaron ${result.document?.datos_ocr?.items?.length || 0} items correctamente.`,
                })
            }

            onUpdate()
        } catch (error) {
            console.error(error)
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo procesar el documento.",
            })
        } finally {
            setIsUploading(false)
            // Reset input
            e.target.value = ""
        }
    }

    const [isDeleting, setIsDeleting] = useState<string | null>(null)

    const handleDelete = async (docId: string) => {
        if (!confirm("¿Estás seguro de eliminar este documento? Se revertirán las cantidades detectadas.")) return

        setIsDeleting(docId)
        try {
            const response = await fetch(`/api/recepciones/${recepcion.id}/ocr`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ document_id: docId }),
            })

            if (!response.ok) throw new Error("Error al eliminar documento")

            toast({
                title: "Documento eliminado",
                description: "Se ha eliminado el documento y revertido los cambios.",
            })

            onUpdate()
        } catch (error) {
            console.error(error)
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo eliminar el documento.",
            })
        } finally {
            setIsDeleting(null)
        }
    }

    return (
        <div className="grid gap-6 md:grid-cols-2 h-full">
            {/* Upload Section */}
            <Card className="flex flex-col">
                <CardHeader>
                    <CardTitle>Cargar Documentación</CardTitle>
                    <CardDescription>
                        Subí fotos de facturas, remitos o presupuestos. El sistema intentará leer los items automáticamente.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Tipo de Documento</label>
                        <Select value={tipoDocumento} onValueChange={setTipoDocumento}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="factura">Factura</SelectItem>
                                <SelectItem value="presupuesto">Presupuesto</SelectItem>
                                <SelectItem value="remito">Remito</SelectItem>
                                <SelectItem value="nota_credito">Nota de Crédito</SelectItem>
                                <SelectItem value="reversa">Reversa</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex-1 border-2 border-dashed rounded-lg flex flex-col items-center justify-center p-6 bg-muted/20 hover:bg-muted/40 transition-colors relative">
                        {isUploading ? (
                            <div className="text-center">
                                <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
                                <p className="font-medium">Procesando imagen con IA...</p>
                                <p className="text-sm text-muted-foreground">Esto puede tardar unos segundos</p>
                            </div>
                        ) : (
                            <>
                                <Upload className="h-10 w-10 text-muted-foreground mb-4" />
                                <p className="font-medium text-center mb-2">Arrastrá una imagen o hacé click</p>
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                    onChange={handleFileUpload}
                                    disabled={isUploading}
                                />
                                <Button variant="secondary" size="sm">Seleccionar Archivo</Button>
                            </>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Documents List */}
            <Card className="flex flex-col">
                <CardHeader>
                    <CardTitle>Documentos Procesados</CardTitle>
                    <CardDescription>
                        {recepcion.documentos?.length || 0} documentos cargados
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 overflow-auto">
                    {(!recepcion.documentos || recepcion.documentos.length === 0) ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                            <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
                            <p>No hay documentos cargados aún</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {recepcion.documentos.map((doc: any) => (
                                <div key={doc.id} className="flex items-start gap-4 p-3 border rounded-lg bg-card group relative">
                                    <div className="h-16 w-16 relative rounded overflow-hidden bg-muted flex-shrink-0">
                                        {doc.url_imagen ? (
                                            <Image
                                                src={doc.url_imagen}
                                                alt="Documento"
                                                fill
                                                className="object-cover"
                                            />
                                        ) : (
                                            <FileText className="h-8 w-8 m-auto text-muted-foreground" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start">
                                            <h4 className="font-medium capitalize">{doc.tipo_documento.replace('_', ' ')}</h4>
                                            {doc.procesado && (
                                                <span className="flex items-center text-xs text-green-600 font-medium">
                                                    <FileCheck className="h-3 w-3 mr-1" />
                                                    Procesado
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {new Date(doc.created_at).toLocaleString()}
                                        </p>
                                    </div>

                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="absolute right-2 top-10 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                                        onClick={() => handleDelete(doc.id)}
                                        disabled={isDeleting === doc.id}
                                    >
                                        {isDeleting === doc.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
                <div className="p-6 pt-0 mt-auto">
                    <Button className="w-full" onClick={onNext}>
                        Continuar a Recepción Física
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            </Card>
        </div>
    )
}
