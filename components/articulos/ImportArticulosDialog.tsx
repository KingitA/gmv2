"use client"

/**
 * ImportArticulosDialog
 *
 * Diálogo de importación masiva de atributos de artículos desde Excel.
 * Flujo:
 *   1. Upload del archivo
 *   2. Mapeo de columnas (auto-sugerencia + override manual)
 *   3. Preview del diff (valores actuales → nuevos)
 *   4. Confirmación y aplicación
 */

import React, { useRef, useState } from "react"
import * as XLSX from "xlsx"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Upload, ArrowRight, CheckCircle2, AlertCircle, Loader2, FileSpreadsheet } from "lucide-react"

// ─── Campos mapeables de la DB ────────────────────────────────────────────────

interface DbFieldDef {
  id: string
  label: string
  /** Keywords para auto-sugerencia (todo en minúsculas sin espacios) */
  aliases: string[]
}

const DB_FIELD_DEFS: DbFieldDef[] = [
  { id: "sku",                   label: "SKU / Código",               aliases: ["sku", "codigo", "cod", "code"] },
  { id: "ean13",                 label: "EAN / Código de barras",     aliases: ["ean", "ean13", "barcode", "barra", "codbar"] },
  { id: "descripcion",           label: "Descripción",                aliases: ["descripcion", "descripción", "nombre", "detalle", "articulo", "artículo", "name"] },
  { id: "unidades_por_bulto",    label: "Unidades por bulto",         aliases: ["bulto", "unidadesbulto", "unidadesxbulto", "xbulto", "porb", "cant"] },
  { id: "precio_compra",         label: "Precio de compra / costo",   aliases: ["compra", "costo", "cost", "preciocompra", "preciocosto"] },
  { id: "descuento_comercial",   label: "Descuento comercial",        aliases: ["dcomer", "desccomercial", "descuento", "desc", "dto", "d1"] },
  { id: "descuento_financiero",  label: "Descuento financiero",       aliases: ["dfinan", "descfinanciero", "financiero", "d2"] },
  { id: "descuento_promocional", label: "Descuento promocional",      aliases: ["dpromo", "descpromocional", "promocional", "promo", "d3"] },
  { id: "porcentaje_ganancia",   label: "% Ganancia / Margen",        aliases: ["ganancia", "margen", "margin", "margin%", "pctgan", "utilidad"] },
  { id: "precio_base_contado",   label: "Precio base contado",        aliases: ["basecontado", "pbasecontado", "pcontado", "contado"] },
  { id: "precio_base",           label: "Precio base (cta cte)",      aliases: ["cuentacorriente", "ctacte", "preciobase", "pbase", "base", "precio"] },
  { id: "marca_codigo",          label: "Marca (código)",             aliases: ["marca", "brand", "codigomarca", "marcacod"] },
  { id: "__skip__",              label: "— No importar —",            aliases: [] },
]

const SKIP_ID = "__skip__"

function suggestField(colName: string): string {
  const norm = colName.toLowerCase().replace(/[^a-z0-9]/g, "")
  for (const def of DB_FIELD_DEFS) {
    if (def.id === SKIP_ID) continue
    if (def.aliases.some(a => norm.includes(a))) return def.id
  }
  return SKIP_ID
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ColumnMapping {
  excelCol: string
  dbField: string
}

interface DiffRow {
  sku: string
  articulo_id: string | null
  campo: string
  valor_actual: string | number | null
  valor_nuevo: string | number | null
  accion: "actualizar" | "nuevo"
}

interface PreviewResult {
  total_filas: number
  articulos_nuevos: number
  articulos_actualizados: number
  articulos_sin_cambios: number
  cambios_totales: number
  diffs: DiffRow[]
}

type Step = "upload" | "mapping" | "preview" | "done"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete?: () => void
}

export function ImportArticulosDialog({ open, onOpenChange, onImportComplete }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>("upload")
  const [fileName, setFileName] = useState("")
  const [excelRows, setExcelRows] = useState<any[][]>([])
  const [headers, setHeaders] = useState<string[]>([])
  // Posición original de cada header en el Excel (para columnas con gaps entre ellas)
  const [headerColIndices, setHeaderColIndices] = useState<number[]>([])
  const [mappings, setMappings] = useState<ColumnMapping[]>([])
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewFilter, setPreviewFilter] = useState<"todos" | "actualizar" | "nuevo">("todos")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneResult, setDoneResult] = useState<any>(null)

  function reset() {
    setStep("upload")
    setFileName("")
    setExcelRows([])
    setHeaders([])
    setHeaderColIndices([])
    setMappings([])
    setPreview(null)
    setPreviewFilter("todos")
    setLoading(false)
    setError(null)
    setDoneResult(null)
  }

  // ─── Step 1: Upload ──────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setError(null)
    setFileName(file.name)

    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: "array" })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" })

      if (!data || data.length < 2) {
        setError("El archivo no tiene datos suficientes (se necesita al menos una fila de encabezados y una de datos).")
        return
      }

      // Preservar la posición original de cada columna no-vacía
      const hdrObjects = (data[0] as any[])
        .map((h, i) => ({ name: String(h ?? "").trim(), colIdx: i }))
        .filter(h => h.name !== "")
      if (hdrObjects.length === 0) {
        setError("No se encontraron columnas en la primera fila.")
        return
      }

      const hdrs = hdrObjects.map(h => h.name)
      const initialMappings: ColumnMapping[] = hdrs.map(col => ({
        excelCol: col,
        dbField: suggestField(col),
      }))

      setHeaders(hdrs)
      setHeaderColIndices(hdrObjects.map(h => h.colIdx))
      setExcelRows(data.slice(1))   // sin encabezado
      setMappings(initialMappings)
      setStep("mapping")
    } catch (err: any) {
      setError("Error leyendo el archivo: " + err.message)
    }
  }

  // ─── Step 2: Mapping ─────────────────────────────────────────────────────

  function updateMapping(excelCol: string, dbField: string) {
    setMappings(prev => prev.map(m => m.excelCol === excelCol ? { ...m, dbField } : m))
  }

  function getMappingValidationError(): string | null {
    const skuMapping = mappings.find(m => m.dbField === "sku")
    if (!skuMapping) return "Debe mapear al menos una columna a 'SKU / Código'"
    const activeMappings = mappings.filter(m => m.dbField !== SKIP_ID)
    if (activeMappings.length < 2) return "Debe mapear al menos dos columnas (SKU + algún campo a actualizar)"
    return null
  }

  /** Convierte las filas de Excel al formato ArticleUpdateRow según el mapeo */
  function buildRows(): any[] {
    const colIndexMap: Record<string, number> = {}
    headers.forEach((h, i) => {
      const mapping = mappings.find(m => m.excelCol === h)
      if (mapping && mapping.dbField !== SKIP_ID) {
        // Usar la posición original en el Excel, no el índice del array filtrado
        colIndexMap[mapping.dbField] = headerColIndices[i]
      }
    })

    return excelRows
      .filter(row => {
        const skuIdx = colIndexMap["sku"]
        return skuIdx !== undefined && String(row[skuIdx] ?? "").trim() !== ""
      })
      .map(row => {
        const obj: Record<string, any> = {}
        for (const [field, idx] of Object.entries(colIndexMap)) {
          const val = row[idx]
          if (val === "" || val === undefined || val === null) continue
          // Campos numéricos
          if (["unidades_por_bulto", "precio_compra", "porcentaje_ganancia", "precio_base", "precio_base_contado"].includes(field)) {
            const n = parseFloat(String(val).replace(",", "."))
            if (!isNaN(n) && n > 0) obj[field] = n
          } else {
            obj[field] = String(val).trim()
          }
        }
        return obj
      })
      .filter(r => r.sku)
  }

  async function handlePreview() {
    const validationError = getMappingValidationError()
    if (validationError) { setError(validationError); return }
    setError(null)
    setLoading(true)

    try {
      const rows = buildRows()
      if (rows.length === 0) { setError("No se encontraron filas válidas con SKU."); setLoading(false); return }

      const res = await fetch("/api/articulos/import-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, dry_run: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error en preview")

      setPreview(data)
      setStep("preview")
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ─── Step 3: Confirm ─────────────────────────────────────────────────────

  async function handleConfirm() {
    setError(null)
    setLoading(true)

    try {
      const rows = buildRows()
      const res = await fetch("/api/articulos/import-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, dry_run: false }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error importando")

      setDoneResult(data)
      setStep("done")
      onImportComplete?.()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const fieldLabel = (id: string) => DB_FIELD_DEFS.find(d => d.id === id)?.label ?? id

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-blue-600" />
            Importar artículos desde Excel
          </DialogTitle>
          <DialogDescription>
            {step === "upload" && "Cargá tu archivo Excel. El sistema va a detectar las columnas automáticamente."}
            {step === "mapping" && "Verificá qué columna del Excel corresponde a cada campo del sistema."}
            {step === "preview" && "Revisá los cambios que se van a aplicar antes de confirmar."}
            {step === "done" && "Importación completada."}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
          {(["upload", "mapping", "preview", "done"] as Step[]).map((s, i) => (
            <React.Fragment key={s}>
              <span className={step === s ? "font-semibold text-foreground" : ""}>{["1. Archivo", "2. Mapeo", "3. Preview", "4. Listo"][i]}</span>
              {i < 3 && <ArrowRight className="w-3 h-3" />}
            </React.Fragment>
          ))}
        </div>

        {error && (
          <Alert variant="destructive" className="mb-3">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* ── STEP 1: UPLOAD ── */}
        {step === "upload" && (
          <div className="flex flex-col items-center justify-center gap-4 py-10 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
               onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-10 h-10 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">Hacé click o arrastrá tu archivo acá</p>
              <p className="text-sm text-muted-foreground">Soporta .xlsx, .xls, .csv</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}

        {/* ── STEP 2: MAPPING ── */}
        {step === "mapping" && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FileSpreadsheet className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium">{fileName}</span>
              <Badge variant="secondary">{headers.length} columnas detectadas</Badge>
              <Badge variant="outline">{excelRows.length} filas de datos</Badge>
            </div>

            <div className="text-xs text-muted-foreground mb-3">
              El sistema sugirió un mapeo automático. Podés cambiarlo usando los selectores.
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
                              <SelectItem key={def.id} value={def.id} className="text-xs">
                                {def.label}
                              </SelectItem>
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

        {/* ── STEP 3: PREVIEW ── */}
        {step === "preview" && preview && (
          <div>
            {/* Resumen — cards filtrables */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="bg-muted rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{preview.total_filas}</div>
                <div className="text-xs text-muted-foreground">Filas totales</div>
              </div>
              <button
                onClick={() => setPreviewFilter(f => f === "actualizar" ? "todos" : "actualizar")}
                className={`rounded-lg p-3 text-center transition-all border-2 ${previewFilter === "actualizar" ? "border-amber-500 bg-amber-100" : "border-transparent bg-amber-50 hover:bg-amber-100"}`}
              >
                <div className="text-2xl font-bold text-amber-700">{preview.articulos_actualizados}</div>
                <div className="text-xs text-amber-600">A actualizar</div>
              </button>
              <button
                onClick={() => setPreviewFilter(f => f === "nuevo" ? "todos" : "nuevo")}
                className={`rounded-lg p-3 text-center transition-all border-2 ${previewFilter === "nuevo" ? "border-green-500 bg-green-100" : "border-transparent bg-green-50 hover:bg-green-100"}`}
              >
                <div className="text-2xl font-bold text-green-700">{preview.articulos_nuevos}</div>
                <div className="text-xs text-green-600">Nuevos</div>
              </button>
              <div className="bg-muted rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-muted-foreground">{preview.articulos_sin_cambios}</div>
                <div className="text-xs text-muted-foreground">Sin cambios</div>
              </div>
            </div>

            {preview.diffs.length === 0 ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>No se detectaron cambios. Los datos del archivo coinciden con la base de datos.</AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="text-xs text-muted-foreground mb-2">
                  {preview.cambios_totales} cambio{preview.cambios_totales !== 1 ? "s" : ""} en total.
                  {previewFilter !== "todos" && <span className="ml-1 font-medium text-foreground">· Mostrando: {previewFilter === "actualizar" ? "A actualizar" : "Nuevos"}</span>}
                  {" "}Primeras 200 filas mostradas.
                </div>
                <div className="border rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-2 font-medium">SKU</th>
                        <th className="text-left px-2 py-2 font-medium">Campo</th>
                        <th className="text-left px-2 py-2 font-medium">Actual</th>
                        <th className="text-left px-2 py-2 font-medium">Nuevo</th>
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.diffs.filter(d => previewFilter === "todos" || d.accion === previewFilter).slice(0, 200).map((d, i) => (
                        <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                          <td className="px-2 py-1 font-mono font-medium">{d.sku}</td>
                          <td className="px-2 py-1 text-muted-foreground">{fieldLabel(d.campo)}</td>
                          <td className="px-2 py-1 text-muted-foreground line-through">
                            {d.valor_actual !== null ? String(d.valor_actual) : "—"}
                          </td>
                          <td className="px-2 py-1 font-medium text-amber-700">
                            {d.valor_nuevo !== null ? String(d.valor_nuevo) : "—"}
                          </td>
                          <td className="px-2 py-1">
                            <Badge variant={d.accion === "nuevo" ? "default" : "secondary"} className="text-[10px] py-0">
                              {d.accion === "nuevo" ? "NUEVO" : "UPD"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── STEP 4: DONE ── */}
        {step === "done" && doneResult && (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle2 className="w-12 h-12 text-green-600" />
            <div className="text-center">
              <p className="text-lg font-semibold">¡Importación completada!</p>
              <p className="text-sm text-muted-foreground mt-1">
                {doneResult.articulos_actualizados} actualizados · {doneResult.articulos_nuevos} nuevos
                {doneResult.errores > 0 ? ` · ${doneResult.errores} errores` : ""}
              </p>
            </div>
            {doneResult.errores > 0 && doneResult.errores_detalle?.length > 0 && (
              <div className="w-full border rounded p-2 text-xs text-destructive max-h-32 overflow-y-auto">
                {doneResult.errores_detalle.map((e: any, i: number) => (
                  <div key={i}>SKU {e.sku}: {e.error}</div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 mt-4">
          {step !== "done" && (
            <Button variant="outline" onClick={() => { reset(); onOpenChange(false) }}>
              Cancelar
            </Button>
          )}
          {step === "mapping" && (
            <>
              <Button variant="ghost" onClick={() => setStep("upload")}>← Volver</Button>
              <Button onClick={handlePreview} disabled={loading}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analizando...</> : "Ver preview →"}
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="ghost" onClick={() => setStep("mapping")}>← Volver</Button>
              <Button
                onClick={handleConfirm}
                disabled={loading || (preview?.cambios_totales === 0)}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {loading
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importando...</>
                  : `Confirmar importación (${preview?.cambios_totales ?? 0} cambios)`
                }
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={() => { reset(); onOpenChange(false) }}>
              Cerrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
