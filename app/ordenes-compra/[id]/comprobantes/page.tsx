"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Plus, Trash2, Edit, Save, X, Upload, FileText, FileImage, Loader2, Eye, CheckCircle2 } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Alert, AlertDescription } from "@/components/ui/alert"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { RevisarMatches } from "./revisar-matches"

const TIPO_DOC_LABELS: Record<string, string> = {
  factura: 'Factura', remito: 'Remito', adquisicion: 'Adquisición',
  nota_credito: 'Nota de Crédito', foto: 'Foto', otro: 'Otro'
}

export default function CargarComprobantesPage() {
  const supabase = createClient()
  const params = useParams()
  const router = useRouter()
  const ordenId = params.id as string

  const [orden, setOrden] = useState<any>(null)
  const [comprobantes, setComprobantes] = useState<any[]>([])
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)

  // OCR documents state
  const [documentos, setDocumentos] = useState<any[]>([])
  const [subiendoDocumento, setSubiendoDocumento] = useState(false)
  const [tipoDocumento, setTipoDocumento] = useState<string>('factura')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [ultimoOCR, setUltimoOCR] = useState<any>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Formulario
  const [tipoComprobante, setTipoComprobante] = useState<string>("FA")
  const [numeroComprobante, setNumeroComprobante] = useState("")
  const [fechaComprobante, setFechaComprobante] = useState(todayArgentina())
  const [totalFacturaDeclarado, setTotalFacturaDeclarado] = useState<number>(0)

  const [totalNeto, setTotalNeto] = useState<number>(0)
  const [totalIVA, setTotalIVA] = useState<number>(0)
  const [percepcionIVA, setPercepcionIVA] = useState<number>(0)
  const [percepcionIIBB, setPercepcionIIBB] = useState<number>(0)
  const [retencionGanancias, setRetencionGanancias] = useState<number>(0)
  const [mostrarConceptos, setMostrarConceptos] = useState(false)

  const [editNeto, setEditNeto] = useState<number>(0)
  const [editIVA, setEditIVA] = useState<number>(0)
  const [editPercepIVA, setEditPercepIVA] = useState<number>(0)
  const [editPercepIIBB, setEditPercepIIBB] = useState<number>(0)
  const [editRetGanancias, setEditRetGanancias] = useState<number>(0)

  const [nuevoDescuento1, setNuevoDescuento1] = useState<number>(0)
  const [nuevoDescuento2, setNuevoDescuento2] = useState<number>(0)
  const [nuevoDescuento3, setNuevoDescuento3] = useState<number>(0)
  const [nuevoDescuento4, setNuevoDescuento4] = useState<number>(0)

  const [ajustaStock, setAjustaStock] = useState<boolean>(false)

  const TIPOS_COMPROBANTE = [
    { value: "FA", label: "Factura A" },
    { value: "FB", label: "Factura B" },
    { value: "FC", label: "Factura C" },
    { value: "Adquisicion", label: "Adquisición (IVA 0%)" },
    { value: "Reversa", label: "Reversa (IVA 0%)" },
    { value: "NC", label: "Nota de Crédito" },
  ]

  useEffect(() => {
    loadOrden()
    loadComprobantes()
    loadDocumentos()
  }, [ordenId])

  useEffect(() => {
    if (totalFacturaDeclarado > 0 && orden) {
      calcularConceptos()
    }
  }, [totalFacturaDeclarado, tipoComprobante, orden])

  const loadOrden = async () => {
    const { data } = await supabase
      .from("ordenes_compra")
      .select("*, proveedor:proveedores(*)")
      .eq("id", ordenId)
      .single()

    if (data) setOrden(data)
  }

  const loadComprobantes = async () => {
    const { data } = await supabase
      .from("comprobantes_compra")
      .select("*")
      .eq("orden_compra_id", ordenId)
      .order("fecha_comprobante", { ascending: false })

    if (data) setComprobantes(data)
  }

  const loadDocumentos = async () => {
    try {
      const res = await fetch(`/api/ordenes-compra/${ordenId}/documentos`)
      if (res.ok) {
        const data = await res.json()
        setDocumentos(data.documentos || [])
      }
    } catch (e) {
      console.error('[Documentos] Error cargando:', e)
    }
  }

  const subirDocumento = useCallback(async (file: File) => {
    setSubiendoDocumento(true)
    setUploadError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('tipo_documento', tipoDocumento)
      const res = await fetch(`/api/ordenes-compra/${ordenId}/documentos`, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setUploadError(data.error || 'Error al subir el archivo')
        return
      }
      setUltimoOCR(data.ocr)
      // Reload both documents (to get fresh signed URLs) and comprobantes (auto-created by API)
      await Promise.all([loadDocumentos(), loadComprobantes()])
    } finally {
      setSubiendoDocumento(false)
    }
  }, [ordenId, tipoDocumento])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    files.forEach(f => subirDocumento(f))
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    files.forEach(f => subirDocumento(f))
  }

  const eliminarDocumento = async (docId: string) => {
    if (!confirm('¿Eliminar este documento?')) return
    try {
      const res = await fetch(`/api/ordenes-compra/${ordenId}/documentos`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento_id: docId }),
      })
      if (res.ok) {
        setDocumentos(prev => prev.filter(d => d.id !== docId))
      } else {
        const data = await res.json()
        alert(data.error || 'Error al eliminar')
      }
    } catch (e) {
      alert('Error de conexión')
    }
  }

  const calcularConceptos = () => {
    const tieneIVA = tipoComprobante !== "Adquisicion" && tipoComprobante !== "Reversa"

    if (tieneIVA) {
      const factorIVA = 0.21
      const factorPercepIVA = (orden?.proveedor?.percepcion_iva || 0) / 100
      const factorPercepIIBB = (orden?.proveedor?.percepcion_iibb || 0) / 100
      const factorRetGanancias = (orden?.proveedor?.retencion_ganancias || 0) / 100
      const factorTotal = 1 + factorIVA + factorPercepIVA + factorPercepIIBB + factorRetGanancias

      const neto = totalFacturaDeclarado / factorTotal
      setTotalNeto(neto)
      setTotalIVA(neto * factorIVA)
      setPercepcionIVA(neto * factorPercepIVA)
      setPercepcionIIBB(neto * factorPercepIIBB)
      setRetencionGanancias(neto * factorRetGanancias)
    } else {
      setTotalNeto(totalFacturaDeclarado)
      setTotalIVA(0)
      setPercepcionIVA(0)
      setPercepcionIIBB(0)
      setRetencionGanancias(0)
    }

    setMostrarConceptos(true)
  }

  const crearComprobante = async () => {
    if (!numeroComprobante.trim() || totalFacturaDeclarado <= 0) {
      alert("Completá todos los campos obligatorios")
      return
    }

    const { error } = await supabase.from("comprobantes_compra").insert({
      orden_compra_id: ordenId,
      tipo_comprobante: tipoComprobante,
      numero_comprobante: numeroComprobante,
      fecha_comprobante: fechaComprobante,
      proveedor_id: orden.proveedor_id,
      total_factura_declarado: totalFacturaDeclarado,
      total_neto: totalNeto,
      total_iva: totalIVA,
      percepcion_iva_monto: percepcionIVA,
      percepcion_iibb_monto: percepcionIIBB,
      retencion_ganancias_monto: retencionGanancias,
      total_calculado: 0,
      estado: "pendiente_recepcion",
      ajusta_stock: (tipoComprobante === "NC" || tipoComprobante === "Reversa") ? ajustaStock : true,
    })

    if (error) {
      alert(`Error: ${error.message}`)
      return
    }

    alert("Comprobante vinculado exitosamente")
    setMostrarFormulario(false)
    setNumeroComprobante("")
    setTotalFacturaDeclarado(0)
    setMostrarConceptos(false)
    setAjustaStock(false) // Reset checkbox
    loadComprobantes()
  }

  const iniciarEdicion = (comp: any) => {
    setEditandoId(comp.id)
    setEditNeto(comp.total_neto || 0)
    setEditIVA(comp.total_iva || 0)
    setEditPercepIVA(comp.percepcion_iva_monto || 0)
    setEditPercepIIBB(comp.percepcion_iibb_monto || 0)
    setEditRetGanancias(comp.retencion_ganancias_monto || 0)
  }

  const guardarEdicion = async (comprobanteId: string) => {
    const { error } = await supabase
      .from("comprobantes_compra")
      .update({
        total_neto: editNeto,
        total_iva: editIVA,
        percepcion_iva_monto: editPercepIVA,
        percepcion_iibb_monto: editPercepIIBB,
        retencion_ganancias_monto: editRetGanancias,
      })
      .eq("id", comprobanteId)

    if (error) {
      alert(`Error: ${error.message}`)
      return
    }

    setEditandoId(null)
    loadComprobantes()
  }

  const eliminarComprobante = async (comprobanteId: string) => {
    if (!confirm("¿Estás seguro de eliminar este comprobante? Esta acción no se puede deshacer.")) return

    console.log("[v0] Intentando eliminar comprobante:", comprobanteId)

    const { error } = await supabase.from("comprobantes_compra").delete().eq("id", comprobanteId)

    if (error) {
      console.error("[v0] Error al eliminar comprobante:", error)
      alert(`Error al eliminar: ${error.message}\n\nDetalles: ${error.hint || "Sin detalles adicionales"}`)
      return
    }

    console.log("[v0] Comprobante eliminado exitosamente")
    alert("Comprobante eliminado exitosamente")
    loadComprobantes()
  }

  if (!orden) return <div>Cargando...</div>

  const calcularDiferencia = () => {
    const suma = totalNeto + totalIVA + percepcionIVA + percepcionIIBB + retencionGanancias
    return totalFacturaDeclarado - suma
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Cargar Comprobantes</h1>
          <p className="text-muted-foreground">
            Orden: {orden.numero_orden} - Proveedor: {orden.proveedor?.nombre}
          </p>
        </div>
      </div>

      {/* ── SECCIÓN DOCUMENTOS OCR ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Documentos del Comprobante
            {documentos.length > 0 && (
              <Badge variant="secondary">{documentos.length} archivo{documentos.length !== 1 ? 's' : ''}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Tipo de documento selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <Label className="shrink-0">Tipo de documento a subir:</Label>
            <Select value={tipoDocumento} onValueChange={setTipoDocumento}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="factura">Factura</SelectItem>
                <SelectItem value="remito">Remito</SelectItem>
                <SelectItem value="adquisicion">Adquisición</SelectItem>
                <SelectItem value="nota_credito">Nota de Crédito</SelectItem>
                <SelectItem value="otro">Otro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !subiendoDocumento && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30'
            } ${subiendoDocumento ? 'opacity-60 cursor-wait' : ''}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
              disabled={subiendoDocumento}
            />
            {subiendoDocumento ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm font-medium">Procesando con OCR...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Upload className="h-8 w-8" />
                <p className="text-sm font-medium">Arrastrá archivos aquí o hacé clic para seleccionar</p>
                <p className="text-xs">Admite imágenes, PDF y Excel. Podés subir varios a la vez.</p>
              </div>
            )}
          </div>

          {uploadError && (
            <Alert variant="destructive">
              <AlertDescription>{uploadError}</AlertDescription>
            </Alert>
          )}

          {/* OCR result preview */}
          {ultimoOCR && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                <strong>Comprobante creado automáticamente</strong>
                {ultimoOCR.comprobante?.numero_comprobante && ` · ${ultimoOCR.comprobante.numero_comprobante}`}
                {ultimoOCR.comprobante?.total_factura && ` · Total: $${Number(ultimoOCR.comprobante.total_factura).toFixed(2)}`}
                {ultimoOCR.items_detectados > 0 && ` · ${ultimoOCR.items_detectados} artículo${ultimoOCR.items_detectados !== 1 ? 's' : ''} detectado${ultimoOCR.items_detectados !== 1 ? 's' : ''}`}
                {ultimoOCR.items_vinculados > 0 && `, ${ultimoOCR.items_vinculados} vinculado${ultimoOCR.items_vinculados !== 1 ? 's' : ''}`}
                <span className="text-green-700 text-xs block mt-1">El comprobante aparece en la lista de abajo con todos los datos extraídos del OCR.</span>
              </AlertDescription>
            </Alert>
          )}

          {/* Documents list */}
          {documentos.length > 0 && (
            <div className="space-y-2">
              <Separator />
              <p className="text-sm font-medium text-muted-foreground">Archivos cargados</p>
              <div className="grid gap-2">
                {documentos.map(doc => {
                  const ocr = doc.datos_ocr
                  const nroComp = ocr?.comprobante?.numero_comprobante
                  const totalDoc = ocr?.comprobante?.total_factura
                  const isImage = doc.tipo_mime?.startsWith('image/') || doc.url_imagen?.match(/\.(jpg|jpeg|png|webp|heic)$/i)
                  return (
                    <div key={doc.id} className="flex items-center gap-3 p-3 border rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors">
                      <div className="shrink-0">
                        {isImage ? (
                          <FileImage className="h-5 w-5 text-blue-500" />
                        ) : (
                          <FileText className="h-5 w-5 text-orange-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc.nombre_archivo || 'Documento'}</p>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          <Badge variant="outline" className="text-xs">{TIPO_DOC_LABELS[doc.tipo_documento] || doc.tipo_documento}</Badge>
                          {nroComp && <span className="text-xs text-muted-foreground">{nroComp}</span>}
                          {totalDoc && <span className="text-xs text-muted-foreground">${Number(totalDoc).toFixed(2)}</span>}
                          {doc.procesado && <Badge variant="secondary" className="text-xs">OCR ✓</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                          <a href={doc.signed_url || doc.url_imagen} target="_blank" rel="noopener noreferrer">
                            <Eye className="h-4 w-4" />
                          </a>
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => eliminarDocumento(doc.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── REVISAR MATCHES (líneas OCR sin vincular al catálogo) ── */}
      <RevisarMatches comprobantes={comprobantes} onResolved={loadComprobantes} />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Comprobantes Vinculados ({comprobantes.length})</CardTitle>
            <Button onClick={() => setMostrarFormulario(!mostrarFormulario)}>
              <Plus className="h-4 w-4 mr-2" />
              Vincular Nuevo Comprobante
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {mostrarFormulario && (
            <Card className="bg-muted/50">
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Tipo de Comprobante *</Label>
                    <Select value={tipoComprobante} onValueChange={setTipoComprobante}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIPOS_COMPROBANTE.map((tipo) => (
                          <SelectItem key={tipo.value} value={tipo.value}>
                            {tipo.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Número de Comprobante *</Label>
                    <Input
                      placeholder="0001-00000001"
                      value={numeroComprobante}
                      onChange={(e) => setNumeroComprobante(e.target.value)}
                    />
                  </div>
                </div>

                {(tipoComprobante === "NC" || tipoComprobante === "Reversa") && (
                  <div className="flex items-center space-x-2 p-4 bg-amber-50 border border-amber-200 rounded-md">
                    <input
                      type="checkbox"
                      id="ajusta-stock"
                      checked={ajustaStock}
                      onChange={(e) => setAjustaStock(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="ajusta-stock" className="text-sm font-medium cursor-pointer">
                      Ajusta Stock (Marcar solo si devuelve mercadería físicamente)
                    </Label>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Fecha del Comprobante *</Label>
                    <Input type="date" value={fechaComprobante} onChange={(e) => setFechaComprobante(e.target.value)} />
                  </div>

                  <div>
                    <Label>Total de la Factura *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={totalFacturaDeclarado || ""}
                      onChange={(e) => setTotalFacturaDeclarado(Number.parseFloat(e.target.value))}
                    />
                  </div>
                </div>

                {mostrarConceptos && (
                  <div className="space-y-4 border-t pt-4">
                    <h3 className="font-semibold">Desglose de Conceptos (editables)</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Total Neto</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={totalNeto}
                          onChange={(e) => setTotalNeto(Number.parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div>
                        <Label>IVA 21%</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={totalIVA}
                          onChange={(e) => setTotalIVA(Number.parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div>
                        <Label>Percepción IVA</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={percepcionIVA}
                          onChange={(e) => setPercepcionIVA(Number.parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div>
                        <Label>Percepción IIBB</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={percepcionIIBB}
                          onChange={(e) => setPercepcionIIBB(Number.parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div>
                        <Label>Retención Ganancias</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={retencionGanancias}
                          onChange={(e) => setRetencionGanancias(Number.parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </div>

                    {Math.abs(calcularDiferencia()) > 0.01 && (
                      <Alert>
                        <AlertDescription>
                          Diferencia de redondeo: ${calcularDiferencia().toFixed(2)}
                          <br />
                          <span className="text-xs text-muted-foreground">
                            Suma de conceptos: $
                            {(totalNeto + totalIVA + percepcionIVA + percepcionIIBB + retencionGanancias).toFixed(2)} |
                            Total factura: ${totalFacturaDeclarado.toFixed(2)}
                          </span>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setMostrarFormulario(false)
                      setMostrarConceptos(false)
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button onClick={crearComprobante}>Vincular Comprobante</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Número</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="w-32">Total Neto</TableHead>
                  <TableHead className="w-28">IVA 21%</TableHead>
                  <TableHead className="w-28">Percep. IVA</TableHead>
                  <TableHead className="w-28">Percep. IIBB</TableHead>
                  <TableHead className="w-28">Ret. Ganancias</TableHead>
                  <TableHead className="w-32 font-bold">Total Final</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comprobantes.map((comp) => {
                  const estaEditando = editandoId === comp.id
                  const totalFinal = comp.total_factura_declarado

                  return (
                    <TableRow key={comp.id}>
                      <TableCell>{comp.tipo_comprobante}</TableCell>
                      <TableCell className="font-medium">{comp.numero_comprobante}</TableCell>
                      <TableCell>{new Date(comp.fecha_comprobante).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>

                      <TableCell>
                        {estaEditando ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="w-full"
                            value={editNeto}
                            onChange={(e) => setEditNeto(Number.parseFloat(e.target.value) || 0)}
                          />
                        ) : (
                          `$${(comp.total_neto || 0).toFixed(2)}`
                        )}
                      </TableCell>

                      <TableCell>
                        {estaEditando ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="w-full"
                            value={editIVA}
                            onChange={(e) => setEditIVA(Number.parseFloat(e.target.value) || 0)}
                          />
                        ) : comp.total_iva > 0 ? (
                          `$${comp.total_iva.toFixed(2)}`
                        ) : (
                          "-"
                        )}
                      </TableCell>

                      <TableCell>
                        {estaEditando ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="w-full"
                            value={editPercepIVA}
                            onChange={(e) => setEditPercepIVA(Number.parseFloat(e.target.value) || 0)}
                          />
                        ) : comp.percepcion_iva_monto > 0 ? (
                          `$${comp.percepcion_iva_monto.toFixed(2)}`
                        ) : (
                          "-"
                        )}
                      </TableCell>

                      <TableCell>
                        {estaEditando ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="w-full"
                            value={editPercepIIBB}
                            onChange={(e) => setEditPercepIIBB(Number.parseFloat(e.target.value) || 0)}
                          />
                        ) : comp.percepcion_iibb_monto > 0 ? (
                          `$${comp.percepcion_iibb_monto.toFixed(2)}`
                        ) : (
                          "-"
                        )}
                      </TableCell>

                      <TableCell>
                        {estaEditando ? (
                          <Input
                            type="number"
                            step="0.01"
                            className="w-full"
                            value={editRetGanancias}
                            onChange={(e) => setEditRetGanancias(Number.parseFloat(e.target.value) || 0)}
                          />
                        ) : comp.retencion_ganancias_monto > 0 ? (
                          `$${comp.retencion_ganancias_monto.toFixed(2)}`
                        ) : (
                          "-"
                        )}
                      </TableCell>

                      <TableCell className="font-bold text-primary">${totalFinal.toFixed(2)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {estaEditando ? (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => guardarEdicion(comp.id)}>
                                <Save className="h-4 w-4 text-green-600" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => setEditandoId(null)}>
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => iniciarEdicion(comp)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => eliminarComprobante(comp.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="border-t pt-4 space-y-2">
            <div className="flex justify-between text-lg">
              <span>Total NETO (sin impuestos):</span>
              <span className="font-semibold">
                ${comprobantes.reduce((sum, comp) => sum + (comp.total_neto || 0), 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-xl font-bold border-t pt-2">
              <span>Total FINAL con impuestos:</span>
              <span className="text-primary">
                ${comprobantes.reduce((sum, comp) => sum + comp.total_factura_declarado, 0).toFixed(2)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
