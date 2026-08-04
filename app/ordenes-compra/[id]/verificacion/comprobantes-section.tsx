"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, Loader2, CheckCircle2, XCircle, Edit, Trash2, FileText, Plus } from "lucide-react"
import { formatCurrency, formatDateAR } from "@/lib/utils"
import { RevisarMatches } from "../comprobantes/revisar-matches"

const TIPOS = ["FA", "FB", "FC", "Adquisicion", "Remito", "Reversa", "NC", "NCA", "NCB", "NCC"]

interface UploadJob {
    id: number
    nombre: string
    estado: "procesando" | "ok" | "error"
    mensaje?: string
}

// Gestión unificada de comprobantes dentro de la verificación:
// subir (varios a la vez, sin bloquear), ver, editar a mano, validar y
// eliminar (revirtiendo lo que el OCR aplicó) + revisar matches.
export function ComprobantesSection({
    ordenId,
    onChanged,
}: {
    ordenId: string
    onChanged: () => void
}) {
    const supabase = createClient()
    const [comprobantes, setComprobantes] = useState<any[]>([])
    const [uploads, setUploads] = useState<UploadJob[]>([])
    const fileRef = useRef<HTMLInputElement>(null)
    const jobSeq = useRef(0)

    // Edición manual
    const [editando, setEditando] = useState<any>(null)
    const [guardando, setGuardando] = useState(false)

    const cargar = useCallback(async () => {
        const { data } = await supabase
            .from("comprobantes_compra")
            .select("*")
            .eq("orden_compra_id", ordenId)
            .neq("estado", "esperada")
            .order("fecha_comprobante", { ascending: false })
        setComprobantes(data || [])
    }, [ordenId, supabase])

    useEffect(() => { cargar() }, [cargar])

    const refrescar = () => { cargar(); onChanged() }

    // Subida no bloqueante: cada archivo es un job independiente; se puede
    // seguir trabajando mientras el OCR procesa.
    const subirArchivos = (files: File[]) => {
        for (const file of files) {
            const jobId = ++jobSeq.current
            setUploads(prev => [...prev, { id: jobId, nombre: file.name, estado: "procesando" }])
            const fd = new FormData()
            fd.append("file", file)
            fetch(`/api/ordenes-compra/${ordenId}/documentos`, { method: "POST", body: fd })
                .then(async res => {
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || "Error al procesar")
                    setUploads(prev => prev.map(u => u.id === jobId
                        ? { ...u, estado: "ok", mensaje: data.comprobante ? `${data.comprobante.tipo_comprobante} ${data.comprobante.numero_comprobante}` : "Documento cargado" }
                        : u))
                    refrescar()
                })
                .catch(e => {
                    setUploads(prev => prev.map(u => u.id === jobId ? { ...u, estado: "error", mensaje: e.message } : u))
                })
        }
    }

    // Agregar a mano una linea que el OCR no extrajo (ej. primera fila cortada)
    const [lineaComp, setLineaComp] = useState<any>(null)
    const [ocArts, setOcArts] = useState<any[]>([])
    const [lineaArt, setLineaArt] = useState("")
    const [lineaCant, setLineaCant] = useState("")
    const [lineaPrecio, setLineaPrecio] = useState("")
    const [lineaGuardando, setLineaGuardando] = useState(false)

    const abrirAgregarLinea = async (comp: any) => {
        setLineaComp(comp); setLineaArt(""); setLineaCant(""); setLineaPrecio("")
        const { data } = await supabase
            .from("ordenes_compra_detalle")
            .select("articulo_id, cantidad_pedida, precio_unitario, articulos:articulo_id(sku, descripcion)")
            .eq("orden_compra_id", ordenId)
        setOcArts(data || [])
    }

    const guardarLinea = async () => {
        const cant = Number(String(lineaCant).replace(",", "."))
        const precio = Number(String(lineaPrecio).replace(",", "."))
        if (!lineaArt || !cant || cant <= 0) { alert("Elegí el artículo y la cantidad"); return }
        setLineaGuardando(true)
        try {
            const res = await fetch(`/api/comprobantes-compra/${lineaComp.id}/lineas`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ articulo_id: lineaArt, cantidad: cant, precio_unitario: precio || 0 }),
            })
            const data = await res.json()
            if (!res.ok) { alert(data.error || "Error al agregar la línea"); return }
            setLineaComp(null)
            refrescar()
        } finally {
            setLineaGuardando(false)
        }
    }

    const validar = async (comp: any) => {
        if (!confirm(`¿Validar ${comp.tipo_comprobante} ${comp.numero_comprobante}?\n\nImputa la CC del proveedor, confirma el kardex y genera el vencimiento.`)) return
        const res = await fetch(`/api/comprobantes-compra/${comp.id}/validar`, { method: "POST" })
        const data = await res.json()
        if (!res.ok) { alert(data.error || "Error al validar"); return }
        refrescar()
    }

    const eliminar = async (comp: any) => {
        if (!confirm(`¿Eliminar ${comp.tipo_comprobante} ${comp.numero_comprobante}?\n\nSe revierte todo lo que su OCR aplicó (detalle y cantidades documentadas).`)) return
        const res = await fetch(`/api/comprobantes-compra/${comp.id}`, { method: "DELETE" })
        const data = await res.json()
        if (!res.ok) { alert(data.error || "Error al eliminar"); return }
        refrescar()
    }

    const guardarEdicion = async () => {
        if (!editando) return
        setGuardando(true)
        try {
            const res = await fetch(`/api/comprobantes-compra/${editando.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tipo_comprobante: editando.tipo_comprobante,
                    numero_comprobante: editando.numero_comprobante,
                    fecha_comprobante: editando.fecha_comprobante,
                    total_factura_declarado: Number(editando.total_factura_declarado) || 0,
                    total_neto: Number(editando.total_neto) || 0,
                    total_iva: Number(editando.total_iva) || 0,
                    percepcion_iva_monto: Number(editando.percepcion_iva_monto) || 0,
                    percepcion_iibb_monto: Number(editando.percepcion_iibb_monto) || 0,
                    retencion_ganancias_monto: Number(editando.retencion_ganancias_monto) || 0,
                }),
            })
            const data = await res.json()
            if (!res.ok) { alert(data.error || "Error al guardar"); return }
            setEditando(null)
            refrescar()
        } finally {
            setGuardando(false)
        }
    }

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                        <FileText className="h-4 w-4" /> Comprobantes vinculados ({comprobantes.length})
                        <div className="flex items-center gap-2 ml-auto">
                            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf,.xlsx,.xls"
                                className="hidden"
                                onChange={e => { subirArchivos(Array.from(e.target.files || [])); e.target.value = "" }} />
                            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => fileRef.current?.click()}>
                                <Upload className="h-3.5 w-3.5" /> Subir comprobantes
                            </Button>
                        </div>
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        El OCR detecta solo el tipo: factura con impuestos → FA/FB/FC; con precios sin respaldo fiscal → Adquisición; sin precios → Remito.
                        Podés subir varios a la vez y seguir trabajando mientras procesan.
                    </p>
                </CardHeader>
                <CardContent className="space-y-3">
                    {uploads.length > 0 && (
                        <div className="space-y-1">
                            {uploads.map(u => (
                                <div key={u.id} className="flex items-center gap-2 text-xs p-2 rounded border bg-muted/30">
                                    {u.estado === "procesando" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                                        : u.estado === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                                            : <XCircle className="h-3.5 w-3.5 text-red-500" />}
                                    <span className="truncate flex-1">{u.nombre}</span>
                                    <span className={u.estado === "error" ? "text-red-600" : "text-muted-foreground"}>
                                        {u.estado === "procesando" ? "Procesando OCR…" : u.mensaje}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    {comprobantes.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">
                            Sin comprobantes vinculados — subí la factura, remito o adquisición para empezar la verificación.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Tipo</TableHead>
                                        <TableHead>Número</TableHead>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead className="text-right">Neto</TableHead>
                                        <TableHead className="text-right">IVA</TableHead>
                                        <TableHead className="text-right">Percepciones</TableHead>
                                        <TableHead className="text-right font-bold">Total</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {comprobantes.map(comp => (
                                        <TableRow key={comp.id}>
                                            <TableCell><Badge variant="outline">{comp.tipo_comprobante}</Badge></TableCell>
                                            <TableCell className="font-medium">{comp.numero_comprobante}</TableCell>
                                            <TableCell>{formatDateAR(comp.fecha_comprobante)}</TableCell>
                                            <TableCell className="text-right font-mono text-sm">{formatCurrency(comp.total_neto || 0)}</TableCell>
                                            <TableCell className="text-right font-mono text-sm">{comp.total_iva > 0 ? formatCurrency(comp.total_iva) : "—"}</TableCell>
                                            <TableCell className="text-right font-mono text-sm">
                                                {(comp.percepcion_iva_monto || 0) + (comp.percepcion_iibb_monto || 0) > 0
                                                    ? formatCurrency((comp.percepcion_iva_monto || 0) + (comp.percepcion_iibb_monto || 0)) : "—"}
                                            </TableCell>
                                            <TableCell className="text-right font-mono font-bold">{formatCurrency(comp.total_factura_declarado || 0)}</TableCell>
                                            <TableCell>
                                                {comp.estado === "validado" ? (
                                                    <Badge className="bg-green-100 text-green-700 border-green-300" variant="outline">
                                                        <CheckCircle2 className="h-3 w-3 mr-1" /> Validado
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="secondary">{comp.estado}</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {comp.estado !== "validado" && (
                                                    <div className="flex gap-1 justify-end">
                                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Validar (CC + vencimiento + kardex)"
                                                            onClick={() => validar(comp)}>
                                                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Agregar línea que el OCR no leyó"
                                                            onClick={() => abrirAgregarLinea(comp)}>
                                                            <Plus className="h-4 w-4 text-blue-600" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar a mano"
                                                            onClick={() => setEditando({ ...comp })}>
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Eliminar (revierte el OCR)"
                                                            onClick={() => eliminar(comp)}>
                                                            <Trash2 className="h-4 w-4 text-destructive" />
                                                        </Button>
                                                    </div>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <RevisarMatches comprobantes={comprobantes} onResolved={refrescar} />

            <Dialog open={!!editando} onOpenChange={open => !open && setEditando(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader><DialogTitle>Editar comprobante</DialogTitle></DialogHeader>
                    {editando && (
                        <div className="space-y-3 py-2">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs">Tipo</Label>
                                    <Select value={editando.tipo_comprobante}
                                        onValueChange={v => setEditando((p: any) => ({ ...p, tipo_comprobante: v }))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {TIPOS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-xs">Número</Label>
                                    <Input value={editando.numero_comprobante || ""}
                                        onChange={e => setEditando((p: any) => ({ ...p, numero_comprobante: e.target.value }))} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs">Fecha</Label>
                                    <Input type="date" value={editando.fecha_comprobante || ""}
                                        onChange={e => setEditando((p: any) => ({ ...p, fecha_comprobante: e.target.value }))} />
                                </div>
                                <div>
                                    <Label className="text-xs">Total final</Label>
                                    <Input type="number" step="0.01" value={editando.total_factura_declarado ?? ""}
                                        onChange={e => setEditando((p: any) => ({ ...p, total_factura_declarado: e.target.value }))} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs">Neto</Label>
                                    <Input type="number" step="0.01" value={editando.total_neto ?? ""}
                                        onChange={e => setEditando((p: any) => ({ ...p, total_neto: e.target.value }))} />
                                </div>
                                <div>
                                    <Label className="text-xs">IVA</Label>
                                    <Input type="number" step="0.01" value={editando.total_iva ?? ""}
                                        onChange={e => setEditando((p: any) => ({ ...p, total_iva: e.target.value }))} />
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <Label className="text-xs">Percep. IVA</Label>
                                    <Input type="number" step="0.01" value={editando.percepcion_iva_monto ?? ""}
                                        onChange={e => setEditando((p: any) => ({ ...p, percepcion_iva_monto: e.target.value }))} />
                                </div>
                                <div>
                                    <Label className="text-xs">Percep. IIBB</Label>
                                    <Input type="number" step="0.01" value={editando.percepcion_iibb_monto ?? ""}
                                        onChange={e => setEditando((p: any) => ({ ...p, percepcion_iibb_monto: e.target.value }))} />
                                </div>
                                <div>
                                    <Label className="text-xs">Ret. Ganancias</Label>
                                    <Input type="number" step="0.01" value={editando.retencion_ganancias_monto ?? ""}
                                        onChange={e => setEditando((p: any) => ({ ...p, retencion_ganancias_monto: e.target.value }))} />
                                </div>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
                        <Button onClick={guardarEdicion} disabled={guardando}>
                            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {lineaComp && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setLineaComp(null)}>
                    <div className="bg-white rounded-xl p-5 w-[440px] shadow-xl space-y-3" onClick={e => e.stopPropagation()}>
                        <h3 className="font-bold text-sm">Agregar línea — {lineaComp.tipo_comprobante} {lineaComp.numero_comprobante}</h3>
                        <p className="text-xs text-muted-foreground">Para líneas que el OCR no extrajo del documento. Suma también la cantidad documentada en la recepción.</p>
                        <div>
                            <label className="text-xs font-medium">Artículo (de la OC)</label>
                            <select className="w-full rounded-md border px-2 py-1.5 text-sm" value={lineaArt}
                                onChange={e => {
                                    setLineaArt(e.target.value)
                                    const it = ocArts.find((a: any) => a.articulo_id === e.target.value)
                                    if (it && !lineaPrecio) setLineaPrecio(String(it.precio_unitario ?? ""))
                                    if (it && !lineaCant) setLineaCant(String(it.cantidad_pedida ?? ""))
                                }}>
                                <option value="">Elegir artículo…</option>
                                {ocArts.map((a: any) => (
                                    <option key={a.articulo_id} value={a.articulo_id}>
                                        {a.articulos?.sku} — {a.articulos?.descripcion} (OC: {a.cantidad_pedida})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-xs font-medium">Cantidad</label>
                                <input inputMode="decimal" className="w-full rounded-md border px-2 py-1.5 text-sm tabular-nums" value={lineaCant}
                                    onChange={e => setLineaCant(e.target.value)} />
                            </div>
                            <div>
                                <label className="text-xs font-medium">Precio unitario (punto = centavos)</label>
                                <input inputMode="decimal" className="w-full rounded-md border px-2 py-1.5 text-sm tabular-nums" value={lineaPrecio}
                                    onChange={e => setLineaPrecio(e.target.value)} />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <Button variant="outline" size="sm" onClick={() => setLineaComp(null)}>Cancelar</Button>
                            <Button size="sm" disabled={lineaGuardando} onClick={guardarLinea}>{lineaGuardando ? "Guardando…" : "Agregar línea"}</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
