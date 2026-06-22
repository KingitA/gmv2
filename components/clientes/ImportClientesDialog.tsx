"use client"

/**
 * ImportClientesDialog
 *
 * Diálogo de actualización masiva de clientes desde Excel.
 * Flujo:
 *   1. Subir archivo
 *   2. Mapear columnas (auto-sugerencia + override manual). Una columna debe ser la
 *      conectora: codigo_cliente o cuit.
 *   3. Click en "Actualizar"
 *   4. Reporte filtrable: actualizados / sin cambios / no encontrados / errores,
 *      mostrando código, nombre y el dato actualizado.
 */

import React, { useRef, useState } from "react"
import * as XLSX from "xlsx"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Upload, ArrowRight, CheckCircle2, AlertCircle, Loader2, FileSpreadsheet } from "lucide-react"

// ─── Campos de cliente mapeables ────────────────────────────────────────────
interface DbFieldDef { id: string; label: string; aliases: string[] }

const SKIP_ID = "__skip__"

const DB_FIELD_DEFS: DbFieldDef[] = [
  // Conectores y los más usados primero
  { id: "codigo_cliente",       label: "Código de cliente (conector)",  aliases: ["codigocliente", "codcliente", "codigo", "cod", "cliente"] },
  { id: "percepcion_iibb",      label: "Percepción IIBB (%)",           aliases: ["percepcioniibb", "percepcion", "percepción", "alicuotaiibb", "aliciibb"] },
  { id: "cuit",                 label: "CUIT (conector)",               aliases: ["cuit", "cuil"] },
  { id: "nombre_razon_social",  label: "Nombre / Razón social",         aliases: ["nombrerazonsocial", "razonsocial", "razon", "nombre"] },
  { id: "mail",                 label: "Mail",                          aliases: ["mail", "email", "correo", "e-mail"] },
  { id: "telefono",             label: "Teléfono",                      aliases: ["telefono", "teléfono", "tel", "celular", "cel"] },
  // Resto
  { id: "direccion",            label: "Dirección",                     aliases: ["direccion", "dirección", "domicilio"] },
  { id: "localidad",            label: "Localidad",                     aliases: ["localidad", "ciudad"] },
  { id: "provincia",            label: "Provincia",                     aliases: ["provincia"] },
  { id: "condicion_iva",        label: "Condición IVA",                 aliases: ["condicioniva", "condición iva", "iva", "condiva"] },
  { id: "metodo_facturacion",   label: "Método de facturación",         aliases: ["metodofacturacion", "facturacion", "facturación"] },
  { id: "condicion_pago",       label: "Condición de pago",             aliases: ["condicionpago", "formapago", "pago"] },
  { id: "tipo_canal",           label: "Tipo de canal",                 aliases: ["tipocanal", "canal"] },
  { id: "nro_iibb",             label: "Nro. de IIBB / inscripción",    aliases: ["nroiibb", "numeroiibb", "iibbnro", "inscripcioniibb", "ingresosbrutos"] },
  { id: "exento_iibb",          label: "Exento IIBB (SI/NO)",           aliases: ["exentoiibb"] },
  { id: "exento_iva",           label: "Exento IVA (SI/NO)",            aliases: ["exentoiva"] },
  { id: "dias_credito",         label: "Días de crédito",               aliases: ["diascredito", "diasdecredito"] },
  { id: "limite_credito",       label: "Límite de crédito",             aliases: ["limitecredito", "limite", "límite"] },
  { id: "descuento_especial",   label: "Descuento especial (%)",        aliases: ["descuentoespecial", "descespecial"] },
  { id: "zona",                 label: "Zona",                          aliases: ["zona"] },
  { id: "observaciones",        label: "Observaciones",                 aliases: ["observaciones", "obs", "nota", "notas"] },
  { id: SKIP_ID,                label: "— No importar —",               aliases: [] },
]

function suggestField(colName: string): string {
  const norm = colName.toLowerCase().replace(/[^a-z0-9]/g, "")
  for (const def of DB_FIELD_DEFS) {
    if (def.id === SKIP_ID) continue
    if (def.aliases.some(a => norm.includes(a.replace(/[^a-z0-9]/g, "")))) return def.id
  }
  return SKIP_ID
}

interface ColumnMapping { excelCol: string; dbField: string }

interface FilaReporte {
  codigo_cliente: string | null
  cuit: string | null
  nombre: string | null
  status: "actualizado" | "actualizar" | "sin_cambios" | "no_encontrado" | "error"
  cambios: { campo: string; actual: any; nuevo: any }[]
  error?: string
}

interface Resultado {
  total_filas: number
  resumen: { actualizados: number; sin_cambios: number; no_encontrados: number; errores: number }
  filas: FilaReporte[]
}

type Step = "upload" | "mapping" | "done"
type Filtro = "todos" | "actualizado" | "sin_cambios" | "no_encontrado" | "error"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete?: () => void
}

const fieldLabel = (id: string) => DB_FIELD_DEFS.find(d => d.id === id)?.label ?? id

export function ImportClientesDialog({ open, onOpenChange, onImportComplete }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>("upload")
  const [fileName, setFileName] = useState("")
  const [excelRows, setExcelRows] = useState<any[][]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [headerColIndices, setHeaderColIndices] = useState<number[]>([])
  const [mappings, setMappings] = useState<ColumnMapping[]>([])
  const [result, setResult] = useState<Resultado | null>(null)
  const [filtro, setFiltro] = useState<Filtro>("todos")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setStep("upload"); setFileName(""); setExcelRows([]); setHeaders([])
    setHeaderColIndices([]); setMappings([]); setResult(null); setFiltro("todos")
    setLoading(false); setError(null)
  }

  // ── Step 1: Upload ──
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null); setFileName(file.name)
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: "array" })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" })
      if (!data || data.length < 2) {
        setError("El archivo no tiene datos suficientes (se necesita una fila de encabezados y al menos una de datos).")
        return
      }
      // Buscar la primera fila con ≥2 celdas no vacías como encabezado
      let headerRowIdx = 0
      for (let r = 0; r < Math.min(data.length, 15); r++) {
        const nonEmpty = (data[r] as any[]).filter(c => String(c ?? "").trim() !== "").length
        if (nonEmpty >= 2) { headerRowIdx = r; break }
      }
      const hdrObjects = (data[headerRowIdx] as any[])
        .map((h, i) => ({ name: String(h ?? "").trim(), colIdx: i }))
        .filter(h => h.name !== "")
      if (hdrObjects.length === 0) {
        setError("No se encontraron columnas con nombre. Revisá que la primera fila tenga títulos (ej. codigo_cliente, percepcion_iibb).")
        return
      }
      const hdrs = hdrObjects.map(h => h.name)
      setHeaders(hdrs)
      setHeaderColIndices(hdrObjects.map(h => h.colIdx))
      setExcelRows(data.slice(headerRowIdx + 1))
      setMappings(hdrs.map(col => ({ excelCol: col, dbField: suggestField(col) })))
      setStep("mapping")
    } catch (err: any) {
      setError("Error leyendo el archivo: " + err.message)
    }
  }

  // ── Step 2: Mapping ──
  function updateMapping(excelCol: string, dbField: string) {
    setMappings(prev => prev.map(m => m.excelCol === excelCol ? { ...m, dbField } : m))
  }

  /** Determina la columna conectora (codigo_cliente preferido, si no cuit). */
  function getConnector(): "codigo_cliente" | "cuit" | null {
    if (mappings.some(m => m.dbField === "codigo_cliente")) return "codigo_cliente"
    if (mappings.some(m => m.dbField === "cuit")) return "cuit"
    return null
  }

  function getValidationError(): string | null {
    const connector = getConnector()
    if (!connector) return "Tenés que mapear una columna como conector: 'Código de cliente' o 'CUIT'."
    const activos = mappings.filter(m => m.dbField !== SKIP_ID)
    if (activos.length < 2) return "Mapeá al menos dos columnas: el conector + algún dato a actualizar."
    // No permitir el mismo destino dos veces
    const usados = activos.map(m => m.dbField)
    if (new Set(usados).size !== usados.length) return "Hay dos columnas del Excel apuntando al mismo campo. Revisá el mapeo."
    return null
  }

  function buildRows(connector: string): Record<string, any>[] {
    const colIndexMap: Record<string, number> = {}
    headers.forEach((h, i) => {
      const mapping = mappings.find(m => m.excelCol === h)
      if (!mapping || mapping.dbField === SKIP_ID) return
      colIndexMap[mapping.dbField] = headerColIndices[i]
    })
    const connectorIdx = colIndexMap[connector]
    return excelRows
      .filter(row => connectorIdx !== undefined && String(row[connectorIdx] ?? "").trim() !== "")
      .map(row => {
        const obj: Record<string, any> = {}
        for (const [field, idx] of Object.entries(colIndexMap)) {
          const val = row[idx]
          if (val === "" || val === undefined || val === null) continue
          obj[field] = val
        }
        return obj
      })
      .filter(r => r[connector] !== undefined)
  }

  // ── Step 3: Actualizar ──
  async function handleActualizar() {
    const validation = getValidationError()
    if (validation) { setError(validation); return }
    const connector = getConnector()!
    setError(null); setLoading(true)
    try {
      const rows = buildRows(connector)
      if (rows.length === 0) { setError("No se encontraron filas con valor en la columna conectora."); setLoading(false); return }
      const res = await fetch("/api/clientes/import-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connector, rows, dry_run: false }),
      })
      const text = await res.text()
      let data: any
      try { data = JSON.parse(text) } catch { throw new Error(`Respuesta no válida (${res.status}): ${text.slice(0, 200)}`) }
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
      setResult(data)
      setStep("done")
      onImportComplete?.()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Render helpers ──
  const STATUS_META: Record<string, { label: string; cls: string }> = {
    actualizado:   { label: "Actualizado",   cls: "bg-green-100 text-green-700" },
    sin_cambios:   { label: "Sin cambios",   cls: "bg-muted text-muted-foreground" },
    no_encontrado: { label: "No encontrado", cls: "bg-amber-100 text-amber-700" },
    error:         { label: "Error",         cls: "bg-red-100 text-red-700" },
  }

  const filasFiltradas = (result?.filas ?? []).filter(f => {
    if (filtro === "todos") return true
    if (filtro === "actualizado") return f.status === "actualizado" || f.status === "actualizar"
    return f.status === filtro
  })

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-blue-600" />
            Actualizar clientes desde Excel
          </DialogTitle>
          <DialogDescription>
            {step === "upload" && "Subí tu Excel. El sistema detecta las columnas automáticamente."}
            {step === "mapping" && "Indicá qué columna del Excel corresponde a cada dato. Una debe ser el conector (código o CUIT)."}
            {step === "done" && "Resultado de la actualización."}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
          {(["upload", "mapping", "done"] as Step[]).map((s, i) => (
            <React.Fragment key={s}>
              <span className={step === s ? "font-semibold text-foreground" : ""}>{["1. Archivo", "2. Mapeo", "3. Resultado"][i]}</span>
              {i < 2 && <ArrowRight className="w-3 h-3" />}
            </React.Fragment>
          ))}
        </div>

        {error && (
          <Alert variant="destructive" className="mb-3">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* STEP 1: UPLOAD */}
        {step === "upload" && (
          <div className="flex flex-col items-center justify-center gap-4 py-10 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
               onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-10 h-10 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">Hacé click o arrastrá tu archivo acá</p>
              <p className="text-sm text-muted-foreground">Soporta .xlsx, .xls, .csv</p>
            </div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
          </div>
        )}

        {/* STEP 2: MAPPING */}
        {step === "mapping" && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FileSpreadsheet className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium">{fileName}</span>
              <Badge variant="secondary">{headers.length} columnas</Badge>
              <Badge variant="outline">{excelRows.length} filas</Badge>
            </div>
            <div className="text-xs text-muted-foreground mb-3">
              El sistema sugirió un mapeo automático. Cambialo si hace falta. El conector se usa para
              encontrar al cliente; los demás campos se actualizan.
            </div>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium w-1/2">Columna en Excel</th>
                    <th className="text-left px-3 py-2 font-medium w-1/2">Campo en el sistema</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m, i) => (
                    <tr key={m.excelCol} className={i % 2 === 0 ? "bg-background" : "bg-muted/30"}>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{m.excelCol}</td>
                      <td className="px-3 py-1">
                        <Select value={m.dbField} onValueChange={(v) => updateMapping(m.excelCol, v)}>
                          <SelectTrigger className={`h-8 text-xs ${m.dbField === SKIP_ID ? "text-muted-foreground" : "text-foreground font-medium"}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DB_FIELD_DEFS.map(def => (
                              <SelectItem key={def.id} value={def.id} className="text-xs">{def.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* STEP 3: DONE — reporte */}
        {step === "done" && result && (
          <div>
            <div className="grid grid-cols-4 gap-3 mb-4">
              <button onClick={() => setFiltro(f => f === "actualizado" ? "todos" : "actualizado")}
                className={`rounded-lg p-3 text-center transition-all border-2 ${filtro === "actualizado" ? "border-green-500 bg-green-100" : "border-transparent bg-green-50 hover:bg-green-100"}`}>
                <div className="text-2xl font-bold text-green-700">{result.resumen.actualizados}</div>
                <div className="text-xs text-green-600">Actualizados</div>
              </button>
              <button onClick={() => setFiltro(f => f === "sin_cambios" ? "todos" : "sin_cambios")}
                className={`rounded-lg p-3 text-center transition-all border-2 ${filtro === "sin_cambios" ? "border-slate-400 bg-slate-100" : "border-transparent bg-muted hover:bg-slate-100"}`}>
                <div className="text-2xl font-bold text-muted-foreground">{result.resumen.sin_cambios}</div>
                <div className="text-xs text-muted-foreground">Sin cambios</div>
              </button>
              <button onClick={() => setFiltro(f => f === "no_encontrado" ? "todos" : "no_encontrado")}
                className={`rounded-lg p-3 text-center transition-all border-2 ${filtro === "no_encontrado" ? "border-amber-500 bg-amber-100" : "border-transparent bg-amber-50 hover:bg-amber-100"}`}>
                <div className="text-2xl font-bold text-amber-700">{result.resumen.no_encontrados}</div>
                <div className="text-xs text-amber-600">No encontrados</div>
              </button>
              <button onClick={() => setFiltro(f => f === "error" ? "todos" : "error")}
                className={`rounded-lg p-3 text-center transition-all border-2 ${filtro === "error" ? "border-red-500 bg-red-100" : "border-transparent bg-red-50 hover:bg-red-100"}`}>
                <div className="text-2xl font-bold text-red-700">{result.resumen.errores}</div>
                <div className="text-xs text-red-600">Errores</div>
              </button>
            </div>

            <div className="text-xs text-muted-foreground mb-2">
              {result.total_filas} fila{result.total_filas !== 1 ? "s" : ""} procesada{result.total_filas !== 1 ? "s" : ""}.
              {filtro !== "todos" && <span className="ml-1 font-medium text-foreground">· Filtro: {STATUS_META[filtro]?.label}</span>}
              {filasFiltradas.length > 300 && " Mostrando primeras 300."}
            </div>

            <div className="border rounded-lg overflow-hidden max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-2 font-medium">Código</th>
                    <th className="text-left px-2 py-2 font-medium">Nombre</th>
                    <th className="text-left px-2 py-2 font-medium">Estado</th>
                    <th className="text-left px-2 py-2 font-medium">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {filasFiltradas.slice(0, 300).map((f, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                      <td className="px-2 py-1 font-mono font-medium">{f.codigo_cliente ?? f.cuit ?? "—"}</td>
                      <td className="px-2 py-1">{f.nombre ?? "—"}</td>
                      <td className="px-2 py-1">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_META[f.status]?.cls ?? ""}`}>
                          {STATUS_META[f.status]?.label ?? f.status}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {f.error
                          ? <span className="text-red-600">{f.error}</span>
                          : f.cambios.length > 0
                            ? f.cambios.map((c, j) => (
                                <span key={j} className="mr-2">
                                  {fieldLabel(c.campo)}: <span className="line-through">{c.actual !== null && c.actual !== "" ? String(c.actual) : "—"}</span> → <span className="font-medium text-green-700">{String(c.nuevo)}</span>
                                </span>
                              ))
                            : f.status === "no_encontrado"
                              ? "No existe un cliente con ese código/CUIT"
                              : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 mt-4">
          {step !== "done" && (
            <Button variant="outline" onClick={() => { reset(); onOpenChange(false) }}>Cancelar</Button>
          )}
          {step === "mapping" && (
            <>
              <Button variant="ghost" onClick={() => setStep("upload")}>← Volver</Button>
              <Button onClick={handleActualizar} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white">
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Actualizando...</> : "Actualizar clientes"}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={() => { reset(); onOpenChange(false) }}>Cerrar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
