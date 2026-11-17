"use client"

import { useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, Loader2, CheckCircle2, XCircle, Edit, Trash2, FileText, Plus, RefreshCw, Eye, PenLine } from "lucide-react"
import { useConfirmar } from "@/components/ui/confirmar"
import type { DocumentoRecepcion } from "@/lib/compras/cargar-verificacion"
import { hoyISO } from "@/lib/formato"
import { formatCurrency, formatDateAR } from "@/lib/utils"
import { RevisarMatches } from "../comprobantes/revisar-matches"
import { InputMonto } from "@/components/ui/input-monto"
import { DateInputAR } from "@/components/ui/date-input-ar"
import { toast } from "sonner"

// ND = nota de débito: SUMA deuda (E-35). NC / Reversa restan.
const TIPOS = ["FA", "FB", "FC", "Adquisicion", "Remito", "Reversa", "NC", "NCA", "NCB", "NCC", "ND", "NDA", "NDB", "NDC"]

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
    comprobantes,
    documentos,
    soloLectura = false,
    onVerDocumento,
}: {
    ordenId: string
    onChanged: () => void
    /** Comprobantes de la orden (sin las NC esperadas). Los carga la página, junto con todo lo demás. */
    comprobantes: any[]
    /** Fotos y PDF de la orden; los "no leídos" se muestran acá hasta que se resuelvan */
    documentos: DocumentoRecepcion[]
    /** Orden finalizada o cancelada: solo mirar */
    soloLectura?: boolean
    onVerDocumento?: (doc: DocumentoRecepcion) => void
}) {
    const supabase = createClient()
    const { confirmar, dialogo } = useConfirmar()
    const [reintentando, setReintentando] = useState<string | null>(null)
    // Documentos que la lectura automática no pudo leer y todavía no tienen comprobante (E-95):
    // quedan a la vista hasta que se lean, se carguen a mano o se quiten.
    const noLeidos = documentos.filter((d) => d.no_leido && !d.comprobante_id)
    const docDe = (compId: string) => documentos.find((d) => d.comprobante_id === compId && !!d.url)
    const [uploads, setUploads] = useState<UploadJob[]>([])
    const fileRef = useRef<HTMLInputElement>(null)
    const jobSeq = useRef(0)

    // Edición manual
    const [editando, setEditando] = useState<any>(null)
    const [guardando, setGuardando] = useState(false)

    const refrescar = () => { onChanged() }

    // Reintentar la lectura automática del MISMO archivo
    const reintentar = async (doc: DocumentoRecepcion) => {
        setReintentando(doc.id)
        try {
            const res = await fetch(`/api/ordenes-compra/${ordenId}/documentos`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documento_id: doc.id }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(data.error || `No se pudo reintentar (error ${res.status})`, { duration: 12000 }); return }
            if (data.no_leido) toast.warning("Sigue sin poder leerse. Probá subirlo de nuevo más nítido, o cargá el comprobante a mano.", { duration: 10000 })
            else toast.success(`Se leyó: ${data.comprobante?.tipo_comprobante || "comprobante"} ${data.comprobante?.numero_comprobante || ""}`)
            refrescar()
        } finally {
            setReintentando(null)
        }
    }

    const quitarDocumento = async (doc: DocumentoRecepcion) => {
        if (!(await confirmar({ titulo: "¿Quitar este documento?", detalle: `${doc.nombre_archivo || "El archivo"} se borra de la orden. No tenía comprobante cargado.`, confirmar: "Quitar", peligro: true }))) return
        const res = await fetch(`/api/ordenes-compra/${ordenId}/documentos`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documento_id: doc.id }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(data.error || "No se pudo quitar el documento"); return }
        refrescar()
    }

    // Cargar el comprobante a mano (con o sin un documento "no leído" detrás)
    const cargarAMano = (doc?: DocumentoRecepcion) => setEditando({
        nuevo: true, documento_id: doc?.id || null,
        tipo_comprobante: "FA", numero_comprobante: "", fecha_comprobante: hoyISO(),
        total_factura_declarado: null, total_neto: null, total_iva: null, percepcion_iva_monto: null, percepcion_iibb_monto: null, retencion_ganancias_monto: null,
    })

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
                    const data = await res.json().catch(() => ({}))
                    if (!res.ok) throw new Error(data.error || `No se pudo cargar el archivo (error ${res.status})`)
                    // no_leido (E-37): la IA no pudo leerlo, quedó guardado sin comprobante. aviso (E-36): sin número.
                    const base = data.comprobante ? `${data.comprobante.tipo_comprobante} ${data.comprobante.numero_comprobante}` : "Documento cargado"
                    setUploads(prev => prev.map(u => u.id === jobId
                        ? { ...u, estado: data.no_leido ? "error" : "ok", mensaje: data.no_leido ? data.aviso : data.aviso ? `${base} — ${data.aviso}` : base }
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
    const [lineaCant, setLineaCant] = useState<number | null>(null)
    const [lineaPrecio, setLineaPrecio] = useState<number | null>(null)
    const [lineaGuardando, setLineaGuardando] = useState(false)

    const abrirAgregarLinea = async (comp: any) => {
        setLineaComp(comp); setLineaArt(""); setLineaCant(null); setLineaPrecio(null)
        const { data } = await supabase
            .from("ordenes_compra_detalle")
            .select("articulo_id, cantidad_pedida, precio_unitario, articulos:articulo_id(sku, descripcion)")
            .eq("orden_compra_id", ordenId)
        setOcArts(data || [])
    }

    const guardarLinea = async () => {
        const cant = lineaCant ?? 0
        const precio = lineaPrecio ?? 0
        if (!lineaArt || !cant || cant <= 0) { toast.error("Elegí el artículo y la cantidad"); return }
        setLineaGuardando(true)
        try {
            const res = await fetch(`/api/comprobantes-compra/${lineaComp.id}/lineas`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ articulo_id: lineaArt, cantidad: cant, precio_unitario: precio || 0 }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(data.error || "No se pudo agregar el renglón"); return }
            setLineaComp(null)
            refrescar()
        } finally {
            setLineaGuardando(false)
        }
    }

    const validar = async (comp: any) => {
        if (!(await confirmar({
            titulo: `¿Validar ${comp.tipo_comprobante} ${comp.numero_comprobante}?`,
            detalle: `Se da por bueno el comprobante por ${formatCurrency(comp.total_factura_declarado || 0)}: se registra la deuda en la cuenta corriente del proveedor, se genera el vencimiento de pago y se actualiza el costo de los artículos.\n\nDespués de validar no se puede editar ni eliminar.`,
            confirmar: "Validar",
        }))) return
        const res = await fetch(`/api/comprobantes-compra/${comp.id}/validar`, { method: "POST" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(`No se validó ${comp.tipo_comprobante} ${comp.numero_comprobante}: ${data.error || `error ${res.status}`}`, { duration: 12000 }); return }
        // El servidor avisa si ya estaba validado, si es un remito (sin deuda) o si quedó sin vencimiento
        const avisos: string[] = data.avisos || []
        if (avisos.length > 0) toast.warning(avisos.join(" "), { duration: 12000 })
        else toast.success(`${comp.tipo_comprobante} ${comp.numero_comprobante} validado`)
        refrescar()
    }

    const eliminar = async (comp: any) => {
        if (!(await confirmar({
            titulo: `¿Eliminar ${comp.tipo_comprobante} ${comp.numero_comprobante}?`,
            detalle: "Se borran el comprobante y sus renglones, y se descuenta de la orden lo que había documentado. No se puede deshacer.",
            confirmar: "Eliminar", peligro: true,
        }))) return
        const res = await fetch(`/api/comprobantes-compra/${comp.id}`, { method: "DELETE" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(data.error || "No se pudo eliminar el comprobante", { duration: 10000 }); return }
        toast.success("Comprobante eliminado")
        refrescar()
    }

    const guardarEdicion = async () => {
        if (!editando) return
        setGuardando(true)
        try {
            // Nuevo (cargado a mano) o edición de uno existente
            const res = await fetch(editando.nuevo ? `/api/ordenes-compra/${ordenId}/comprobantes` : `/api/comprobantes-compra/${editando.id}`, {
                method: editando.nuevo ? "POST" : "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...(editando.nuevo ? { documento_id: editando.documento_id } : {}),
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
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(data.error || "No se pudo guardar el comprobante", { duration: 10000 }); return }
            if (editando.nuevo) toast.success("Comprobante cargado. Agregale los renglones con el botón +.", { duration: 8000 })
            setEditando(null)
            refrescar()
        } finally {
            setGuardando(false)
        }
    }

    return (
        <div className="space-y-4">
            {dialogo}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                        <FileText className="h-4 w-4" /> Comprobantes vinculados ({comprobantes.length})
                        <div className="flex items-center gap-2 ml-auto">
                            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf,.xlsx,.xls"
                                className="hidden"
                                onChange={e => { subirArchivos(Array.from(e.target.files || [])); e.target.value = "" }} />
                            {!soloLectura && <>
                                <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => cargarAMano()} title="Cargar un comprobante sin foto, escribiendo sus datos">
                                    <PenLine className="h-3.5 w-3.5" /> Cargar a mano
                                </Button>
                                <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => fileRef.current?.click()}>
                                    <Upload className="h-3.5 w-3.5" /> Subir comprobantes
                                </Button>
                            </>}
                        </div>
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        La lectura automática detecta sola el tipo: factura con impuestos → FA/FB/FC; con precios sin respaldo fiscal → Adquisición; sin precios → Remito.
                        Podés subir varios a la vez y seguir trabajando mientras se leen.
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
                                    <span className="truncate shrink-0 max-w-[40%]">{u.nombre}</span>
                                    <span className={`flex-1 text-right ${u.estado === "error" ? "text-red-600" : "text-muted-foreground"}`}>
                                        {u.estado === "procesando" ? "Leyendo el archivo…" : u.mensaje}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    {noLeidos.length > 0 && (
                        <div className="space-y-2">
                            {noLeidos.map((doc) => (
                                <div key={doc.id} className="p-3 rounded-lg border border-red-300 bg-red-50 text-sm">
                                    <div className="flex items-start gap-2 flex-wrap">
                                        <XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                                        <div className="flex-1 min-w-48">
                                            <p className="font-semibold text-red-900">No se pudo leer el archivo{doc.nombre_archivo ? `: ${doc.nombre_archivo}` : ""}</p>
                                            <p className="text-red-900">Probá de nuevo o cargá el comprobante a mano. Quedó guardado, sin comprobante.</p>
                                            {doc.motivo && (
                                                <details className="mt-1 text-xs text-red-800/80">
                                                    <summary className="cursor-pointer">Detalle técnico</summary>
                                                    <p className="mt-1 break-all font-mono">{doc.motivo}</p>
                                                </details>
                                            )}
                                        </div>
                                        <div className="flex gap-1 flex-wrap">
                                            {doc.url && <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => onVerDocumento?.(doc)}><Eye className="h-3.5 w-3.5" /> Ver</Button>}
                                            {!soloLectura && <>
                                                <Button size="sm" variant="outline" className="h-7 gap-1" disabled={reintentando === doc.id} onClick={() => reintentar(doc)}>
                                                    {reintentando === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Reintentar la lectura
                                                </Button>
                                                <Button size="sm" className="h-7 gap-1" onClick={() => cargarAMano(doc)}><PenLine className="h-3.5 w-3.5" /> Cargar a mano</Button>
                                                <Button size="sm" variant="ghost" className="h-7 text-red-700" onClick={() => quitarDocumento(doc)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                            </>}
                                        </div>
                                    </div>
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
                                                {comp.tipo_comprobante === "Remito" ? (
                                                    // Un remito no se valida: no trae precios (decisión de Juan, 17/11)
                                                    <Badge className="bg-sky-100 text-sky-800 border-sky-300" variant="outline" title="Sirve para comparar las cantidades con lo recibido. No trae precios: no se valida, no genera deuda y no alcanza para finalizar la orden (hace falta la factura).">
                                                        Remito: controla cantidades
                                                    </Badge>
                                                ) : comp.estado === "validado" ? (
                                                    <Badge className="bg-green-100 text-green-700 border-green-300" variant="outline">
                                                        <CheckCircle2 className="h-3 w-3 mr-1" /> Validado
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="secondary">{comp.estado === "pendiente_recepcion" || comp.estado === "recibido" ? "Sin validar" : comp.estado}</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {docDe(comp.id) && (
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver la foto o el PDF al lado de la tabla" onClick={() => onVerDocumento?.(docDe(comp.id)!)}>
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                {!soloLectura && comp.estado !== "validado" && comp.estado !== "cerrado" && (
                                                    <div className="flex gap-1 justify-end">
                                                        {comp.tipo_comprobante !== "Remito" && (
                                                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Validar: registra la deuda y el vencimiento"
                                                                onClick={() => validar(comp)}>
                                                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                                            </Button>
                                                        )}
                                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Agregar un renglón a mano"
                                                            onClick={() => abrirAgregarLinea(comp)}>
                                                            <Plus className="h-4 w-4 text-blue-600" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar a mano"
                                                            onClick={() => setEditando({ ...comp })}>
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Eliminar el comprobante"
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

            {!soloLectura && <RevisarMatches comprobantes={comprobantes} onResolved={refrescar} />}

            <Dialog open={!!editando} onOpenChange={open => !open && setEditando(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader><DialogTitle>{editando?.nuevo ? "Cargar comprobante a mano" : "Editar comprobante"}</DialogTitle></DialogHeader>
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
                                    <DateInputAR value={editando.fecha_comprobante || ""}
                                        onChange={v => setEditando((p: any) => ({ ...p, fecha_comprobante: v }))} />
                                </div>
                                <div>
                                    <Label className="text-xs">Total final</Label>
                                    <InputMonto pesos value={editando.total_factura_declarado ?? null}
                                        onChange={n => setEditando((p: any) => ({ ...p, total_factura_declarado: n }))} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs">Neto</Label>
                                    <InputMonto pesos value={editando.total_neto ?? null}
                                        onChange={n => setEditando((p: any) => ({ ...p, total_neto: n }))} />
                                </div>
                                <div>
                                    <Label className="text-xs">IVA</Label>
                                    <InputMonto pesos value={editando.total_iva ?? null}
                                        onChange={n => setEditando((p: any) => ({ ...p, total_iva: n }))} />
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <Label className="text-xs">Percep. IVA</Label>
                                    <InputMonto pesos value={editando.percepcion_iva_monto ?? null}
                                        onChange={n => setEditando((p: any) => ({ ...p, percepcion_iva_monto: n }))} />
                                </div>
                                <div>
                                    <Label className="text-xs">Percep. IIBB</Label>
                                    <InputMonto pesos value={editando.percepcion_iibb_monto ?? null}
                                        onChange={n => setEditando((p: any) => ({ ...p, percepcion_iibb_monto: n }))} />
                                </div>
                                <div>
                                    <Label className="text-xs">Ret. Ganancias</Label>
                                    <InputMonto pesos value={editando.retencion_ganancias_monto ?? null}
                                        onChange={n => setEditando((p: any) => ({ ...p, retencion_ganancias_monto: n }))} />
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
                                    if (it && !lineaPrecio) setLineaPrecio(it.precio_unitario != null ? Number(it.precio_unitario) : null)
                                    if (it && !lineaCant) setLineaCant(it.cantidad_pedida != null ? Number(it.cantidad_pedida) : null)
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
                                <InputMonto decimales={3} soloPositivos className="h-auto w-full rounded-md border px-2 py-1.5 text-sm tabular-nums" value={lineaCant}
                                    onChange={setLineaCant} />
                            </div>
                            <div>
                                <label className="text-xs font-medium">Precio unitario</label>
                                <InputMonto decimales={4} soloPositivos className="h-auto w-full rounded-md border px-2 py-1.5 text-sm tabular-nums" value={lineaPrecio}
                                    onChange={setLineaPrecio} />
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
