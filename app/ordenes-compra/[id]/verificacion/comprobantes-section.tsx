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
import { Upload, Loader2, CheckCircle2, XCircle, Edit, Trash2, FileText, Plus, RefreshCw, Eye, PenLine, ListChecks } from "lucide-react"
import { RenglonesComprobante } from "./renglones-comprobante"
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
        total_factura_declarado: null, total_neto: null, total_iva: null, percepcion_iva_monto: null, percepcion_iibb_monto: null, retencion_ganancias_monto: null, impuestos_internos: null, otros_impuestos: null,
    })

    // Subida no bloqueante (se puede seguir trabajando mientras se leen), pero DE A UN ARCHIVO:
    // dos documentos de la misma orden leídos a la vez se pisaban (prueba del 18/11: subiendo una
    // factura y una adquisición juntas, a la factura le quedó un renglón de menos; sola, se leyó
    // bien). Cada archivo espera a que termine el anterior.
    const colaSubida = useRef<Promise<void>>(Promise.resolve())
    const subirArchivos = (files: File[]) => {
        for (const file of files) {
            const jobId = ++jobSeq.current
            setUploads(prev => [...prev, { id: jobId, nombre: file.name, estado: "procesando" }])
            colaSubida.current = colaSubida.current.then(async () => {
                try {
                    const fd = new FormData()
                    fd.append("file", file)
                    const res = await fetch(`/api/ordenes-compra/${ordenId}/documentos`, { method: "POST", body: fd })
                    const data = await res.json().catch(() => ({}))
                    if (!res.ok) throw new Error(data.error || `No se pudo cargar el archivo (error ${res.status})`)
                    // no_leido (E-37): la IA no pudo leerlo, quedó guardado sin comprobante. aviso (E-36): sin número, renglones dudosos.
                    const base = data.comprobante ? `${data.comprobante.tipo_comprobante} ${data.comprobante.numero_comprobante}` : "Documento cargado"
                    setUploads(prev => prev.map(u => u.id === jobId
                        ? { ...u, estado: data.no_leido ? "error" : "ok", mensaje: data.no_leido ? data.aviso : data.aviso ? `${base} — ${data.aviso}` : base }
                        : u))
                    if (data.aviso && !data.no_leido) toast.warning(`${base}: ${data.aviso}`, { duration: 20000 })
                    refrescar()
                } catch (e: any) {
                    setUploads(prev => prev.map(u => u.id === jobId ? { ...u, estado: "error", mensaje: e?.message || "No se pudo cargar el archivo" } : u))
                }
            })
        }
    }

    // Renglones del comprobante: verlos, agregar uno a mano, corregirlo o borrarlo (renglones-comprobante.tsx)
    const [renglonesDe, setRenglonesDe] = useState<{ comp: any; agregar: boolean } | null>(null)

    const validar = async (comp: any) => {
        if (!(await confirmar({
            titulo: `¿Validar ${comp.tipo_comprobante} ${comp.numero_comprobante}?`,
            detalle: `Se da por bueno el comprobante por ${formatCurrency(comp.total_factura_declarado || 0)}: se registra la deuda en la cuenta corriente del proveedor, se genera el vencimiento de pago y se actualiza el costo de los artículos.\n\nDespués de validar no se puede editar ni eliminar.`,
            confirmar: "Validar",
        }))) return
        await enviarValidacion(comp, {})
    }

    // E-102: la factura puede estar ya anotada a mano en el calendario. Si el servidor encuentra
    // vencimientos a mano que coinciden, no valida: devuelve los candidatos y acá se pregunta.
    const [aMano, setAMano] = useState<{ comp: any; candidatos: any[]; total: number; cuotas: number; elegidos: string[] } | null>(null)
    const enviarValidacion = async (comp: any, decision: { vencimiento_a_mano?: "enlazar" | "otra_cosa"; vencimientos_ids?: string[] }) => {
        const res = await fetch(`/api/comprobantes-compra/${comp.id}/validar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decision) })
        const data = await res.json().catch(() => ({}))
        if (res.status === 409 && data.codigo === "vencimiento_a_mano") {
            const candidatos: any[] = data.candidatos || []
            // por defecto marcado solo si hay uno, o los que coinciden por número
            const porNumero = candidatos.filter((v) => v.coincide === "numero").map((v) => v.vencimiento_id)
            setAMano({ comp, candidatos, total: Number(data.total || 0), cuotas: Number(data.cuotas || 0), elegidos: candidatos.length === 1 ? [candidatos[0].vencimiento_id] : porNumero })
            return
        }
        setAMano(null)
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
            detalle: "Se borran el comprobante, sus renglones y el archivo (foto o PDF) del que se leyó, y se descuenta de la orden lo que había documentado. No se puede deshacer.",
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
                    impuestos_internos: Number(editando.impuestos_internos) || 0,
                    otros_impuestos: Number(editando.otros_impuestos) || 0,
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
                                                <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver los renglones (corregir o borrar uno)" onClick={() => setRenglonesDe({ comp, agregar: false })}>
                                                    <ListChecks className="h-4 w-4" />
                                                </Button>
                                                {!soloLectura && comp.estado !== "validado" && comp.estado !== "cerrado" && (
                                                    <div className="flex gap-1 justify-end">
                                                        {comp.tipo_comprobante !== "Remito" && (
                                                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Validar: registra la deuda y el vencimiento"
                                                                onClick={() => validar(comp)}>
                                                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                                            </Button>
                                                        )}
                                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Agregar un renglón a mano"
                                                            onClick={() => setRenglonesDe({ comp, agregar: true })}>
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
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs">Impuestos internos</Label>
                                    <InputMonto pesos value={editando.impuestos_internos ?? null}
                                        onChange={n => setEditando((p: any) => ({ ...p, impuestos_internos: n }))} />
                                </div>
                                <div>
                                    <Label className="text-xs">Otros impuestos</Label>
                                    <InputMonto pesos value={editando.otros_impuestos ?? null}
                                        onChange={n => setEditando((p: any) => ({ ...p, otros_impuestos: n }))} />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">Neto + IVA + percepciones + impuestos internos + otros impuestos tiene que dar el total; si no, el comprobante no se puede validar. (La retención de Ganancias no cuenta: no viene en la factura, se hace al pagar.) En una factura B o C, que no discrimina IVA, el neto es el total y el IVA va en 0.</p>
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

            {aMano && (
                <Dialog open onOpenChange={(abierto) => { if (!abierto) setAMano(null) }}>
                    <DialogContent className="max-w-xl">
                        <DialogHeader><DialogTitle>¿Esta factura ya estaba anotada en el calendario?</DialogTitle></DialogHeader>
                        <p className="text-sm">
                            Vas a validar <strong>{aMano.comp.tipo_comprobante} {aMano.comp.numero_comprobante}</strong> por <strong>{formatCurrency(aMano.total)}</strong>.
                            Este proveedor tiene {aMano.candidatos.length === 1 ? "un vencimiento anotado a mano" : `${aMano.candidatos.length} vencimientos anotados a mano`} que {aMano.candidatos.length === 1 ? "puede" : "pueden"} ser esta misma factura:
                        </p>
                        <div className="space-y-2">
                            {aMano.candidatos.map((v) => (
                                <label key={v.vencimiento_id} className="flex items-start gap-2 border rounded-md p-2 text-sm cursor-pointer">
                                    <input type="checkbox" className="mt-1" checked={aMano.elegidos.includes(v.vencimiento_id)}
                                        onChange={(e) => setAMano({ ...aMano, elegidos: e.target.checked ? [...aMano.elegidos, v.vencimiento_id] : aMano.elegidos.filter((id) => id !== v.vencimiento_id) })} />
                                    <span>
                                        <span className="font-medium">{v.concepto || "(sin concepto)"}</span>
                                        <span className="block text-muted-foreground">{formatCurrency(Number(v.monto || 0))} · vence el {formatDateAR(v.fecha_vencimiento)} · coincide por {v.coincide === "numero" ? "el número del comprobante" : "importe y fecha"}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            <strong>Es esta factura:</strong> lo anotado a mano pasa a ser el vencimiento de este comprobante y no se crea otro (la deuda no queda dos veces en el calendario). Conserva su fecha; si el importe anotado era distinto, queda en el total del comprobante.
                            {aMano.cuotas > 1 ? ` El proveedor tiene ${aMano.cuotas} cuotas acordadas: si enlazás, vale lo que ya estaba anotado y no se crean las cuotas.` : ""}
                            {" "}<strong>Es otra cosa:</strong> se valida como siempre y se crea el vencimiento del comprobante; lo anotado a mano no se toca.
                        </p>
                        <DialogFooter className="gap-2">
                            <Button variant="outline" onClick={() => setAMano(null)}>Cancelar</Button>
                            <Button variant="outline" onClick={() => enviarValidacion(aMano.comp, { vencimiento_a_mano: "otra_cosa" })}>Es otra cosa</Button>
                            <Button disabled={aMano.elegidos.length === 0} onClick={() => enviarValidacion(aMano.comp, { vencimiento_a_mano: "enlazar", vencimientos_ids: aMano.elegidos })}>Es esta factura: enlazar</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}

            {renglonesDe && (
                <RenglonesComprobante comprobante={renglonesDe.comp} abrirEnAgregar={renglonesDe.agregar} soloLectura={soloLectura}
                    onCerrar={() => setRenglonesDe(null)} onCambio={refrescar} />
            )}
        </div>
    )
}
