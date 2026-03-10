"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Trash2, Link as LinkIcon, AlertTriangle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner" // Assuming you use sonner or similar for toasts

interface ArticuloProveedoresDialogProps {
    articulo: any
    trigger?: React.ReactNode
}

interface Mapping {
    proveedor_id: string
    proveedor_nombre: string
    codigo_proveedor: string
    descripcion_proveedor: string
    unidad_factura: "UNIDAD" | "BULTO" | "CAJA" | "PACK" | "DOCENA" | null
    factor_conversion: number | null
    veces_usado: number
    last_used_at: string
}

export function ArticuloProveedoresDialog({ articulo, trigger }: ArticuloProveedoresDialogProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [mappings, setMappings] = useState<Mapping[]>([])

    useEffect(() => {
        if (isOpen && articulo) {
            loadMappings()
        }
    }, [isOpen, articulo])

    async function loadMappings() {
        setLoading(true)
        const supabase = createClient()

        const { data, error } = await supabase
            .from("articulos_proveedores")
            .select(`
        proveedor_id,
        codigo_proveedor,
        descripcion_proveedor_norm,
        unidad_factura,
        factor_conversion,
        veces_usado,
        last_used_at,
        proveedor:proveedores(nombre)
      `)
            .eq("articulo_id", articulo.id)

        if (error) {
            console.error("Error loading mappings:", error)
            toast.error("Error al cargar vinculaciones")
        } else {
            setMappings(data.map((m: any) => ({
                proveedor_id: m.proveedor_id,
                proveedor_nombre: m.proveedor?.nombre || "Desconocido",
                codigo_proveedor: m.codigo_proveedor,
                descripcion_proveedor: m.descripcion_proveedor_norm,
                unidad_factura: m.unidad_factura,
                factor_conversion: m.factor_conversion,
                veces_usado: m.veces_usado,
                last_used_at: m.last_used_at
            })))
        }
        setLoading(false)
    }

    async function updateMapping(proveedorId: string, updates: Partial<Mapping>) {
        const supabase = createClient()

        // Prepare update object
        const dbUpdates: any = {}
        if (updates.unidad_factura !== undefined) dbUpdates.unidad_factura = updates.unidad_factura
        if (updates.factor_conversion !== undefined) dbUpdates.factor_conversion = updates.factor_conversion

        const { error } = await supabase
            .from("articulos_proveedores")
            .update(dbUpdates)
            .match({ articulo_id: articulo.id, proveedor_id: proveedorId })

        if (error) {
            console.error("Error updating mapping:", error)
            toast.error("Error al actualizar vinculación")
        } else {
            toast.success("Actualizado correctamente")
            loadMappings()
        }
    }

    async function deleteMapping(proveedorId: string) {
        if (!confirm("¿Desvincular este artículo del proveedor? El sistema dejará de reconocerlo automáticamente.")) return

        const supabase = createClient()
        const { error } = await supabase
            .from("articulos_proveedores")
            .delete()
            .match({ articulo_id: articulo.id, proveedor_id: proveedorId })

        if (error) {
            console.error("Error deleting mapping:", error)
            toast.error("Error al eliminar")
        } else {
            loadMappings()
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="ghost" size="icon" title="Gestionar Vinculaciones">
                        <LinkIcon className="h-4 w-4" />
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Vinculaciones con Proveedores: {articulo.descripcion}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Configurá cómo se interpreta la facturación de este artículo para cada proveedor.
                        El factor de conversión tiene prioridad sobre la configuración general.
                    </p>

                    {loading ? (
                        <div className="text-center py-4">Cargando...</div>
                    ) : mappings.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-md">
                            No hay vinculaciones registradas para este artículo.
                            <br />
                            Las vinculaciones se crean automáticamente al procesar comprobantes OCR.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Proveedor</TableHead>
                                    <TableHead>Descripción / Código</TableHead>
                                    <TableHead>Unidad Facturada (Override)</TableHead>
                                    <TableHead>Factor Conv.</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {mappings.map((mapping) => (
                                    <TableRow key={mapping.proveedor_id}>
                                        <TableCell className="font-medium">{mapping.proveedor_nombre}</TableCell>
                                        <TableCell className="text-sm">
                                            <div className="flex flex-col">
                                                <span>{mapping.descripcion_proveedor || "—"}</span>
                                                {mapping.codigo_proveedor && (
                                                    <span className="text-xs text-muted-foreground">Cod: {mapping.codigo_proveedor}</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Select
                                                value={mapping.unidad_factura || "UNIDAD"}
                                                onValueChange={(val: any) => updateMapping(mapping.proveedor_id, { unidad_factura: val })}
                                            >
                                                <SelectTrigger className="w-[140px]">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="UNIDAD">UNIDAD</SelectItem>
                                                    <SelectItem value="BULTO">BULTO</SelectItem>
                                                    <SelectItem value="CAJA">CAJA</SelectItem>
                                                    <SelectItem value="PACK">PACK</SelectItem>
                                                    <SelectItem value="DOCENA">DOCENA</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            {mapping.unidad_factura && mapping.unidad_factura !== "UNIDAD" && !mapping.factor_conversion && !articulo.unidades_por_bulto && (
                                                <div className="flex items-center gap-1 text-xs text-amber-600 mt-1">
                                                    <AlertTriangle className="h-3 w-3" />
                                                    <span>Falta conversión</span>
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                type="number"
                                                className="w-[80px]"
                                                placeholder={mapping.unidad_factura === "UNIDAD" ? "-" : (articulo.unidades_por_bulto?.toString() || "1")}
                                                value={mapping.factor_conversion || ""}
                                                onChange={(e) => {
                                                    const val = e.target.value ? parseFloat(e.target.value) : null
                                                    updateMapping(mapping.proveedor_id, { factor_conversion: val })
                                                }}
                                            />
                                            <span className="text-[10px] text-muted-foreground block mt-1">
                                                {mapping.factor_conversion
                                                    ? `x${mapping.factor_conversion} = UNIDAD`
                                                    : mapping.unidad_factura === "UNIDAD"
                                                        ? ""
                                                        : articulo.unidades_por_bulto
                                                            ? `Default: x${articulo.unidades_por_bulto}`
                                                            : "Sin factor definido"}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="icon" onClick={() => deleteMapping(mapping.proveedor_id)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
