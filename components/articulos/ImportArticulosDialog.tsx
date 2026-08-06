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
import { ImportReportView } from "@/components/import/ImportReportView"

// ─── Campos mapeables de la DB ────────────────────────────────────────────────

interface DbFieldDef {
  id: string
  label: string
  /** Aclaración chica y muteada (para no ensuciar el nombre del campo) */
  hint?: string
  /** Keywords para auto-sugerencia (todo en minúsculas sin espacios) */
  aliases: string[]
}

const DB_FIELD_DEFS: DbFieldDef[] = [
  // ── Los más usados van primero ──
  { id: "sku",                   label: "SKU",                     aliases: ["sku", "codigo", "cod", "code"] },
  { id: "descripcion",           label: "Descripción",             hint: "quita (15%)", aliases: ["descripcion", "descripción", "nombre", "detalle", "articulo", "artículo", "name", "item"] },
  { id: "descuento_propio",      label: "Oferta",                  hint: "lee (15%)",   aliases: ["descuentopropio", "pctoferta", "dtopio", "oferta"] },
  { id: "precio_base_contado",   label: "Base contado",            aliases: ["basecontado", "pbasecontado", "pcontado", "contado"] },
  { id: "precio_base",           label: "Base cuenta corriente",   aliases: ["cuentacorriente", "ctacte", "preciobase", "pbase", "base", "precio"] },
  { id: "precio_lista_especial", label: "Precio lista especial",   hint: "neto",        aliases: ["especial", "listaespecial", "precioespecial", "preciolistaespecial", "pespecial"] },
  { id: "oferta_lista_especial", label: "Oferta lista especial",   hint: "%",           aliases: ["ofertaespecial", "ofertalistaespecial", "dtoespecial", "descespecial"] },
  // ── Resto ──
  { id: "ean13",                 label: "EAN / Código de barras",  aliases: ["ean", "ean13", "barcode", "barra", "codbar"] },
  { id: "unidades_por_bulto",    label: "Unidades por bulto",      aliases: ["bulto", "unidadesbulto", "unidadesxbulto", "xbulto", "porb", "cant"] },
  { id: "cantidad_fraccion",     label: "Unidades por fracción",   aliases: ["unidadesfraccion", "unidadesporfraccion", "cantidadfraccion", "porfraccion", "fraccion", "fracción"] },
  { id: "precio_compra",         label: "Precio de compra / costo", aliases: ["compra", "costo", "cost", "preciocompra", "preciocosto"] },
  { id: "iva_compras",           label: "IVA Compras",             hint: "0=adq.stock · +=factura · ½=mixto", aliases: ["ivacompras", "ivacompra", "ivac"] },
  { id: "iva_ventas",            label: "IVA Ventas",              hint: "0=presupuesto · +=factura", aliases: ["ivaventas", "ivaventa", "ivav"] },
  { id: "descuento_comercial",   label: "Descuento comercial",     aliases: ["dcomer", "desccomercial", "descuento", "desc", "dto", "d1"] },
  { id: "descuento_financiero",  label: "Descuento financiero",    aliases: ["dfinan", "descfinanciero", "financiero", "d2"] },
  { id: "descuento_promocional", label: "Descuento promocional",   aliases: ["dpromo", "descpromocional", "promocional", "promo", "d3"] },
  { id: "porcentaje_ganancia",   label: "% Ganancia / Margen",     aliases: ["ganancia", "margen", "margin", "margin%", "pctgan", "utilidad"] },
  { id: "marca_codigo",          label: "Marca (código)",          aliases: ["marca", "brand", "codigomarca", "marcacod"] },
  { id: "__skip__",              label: "— No importar —",         aliases: [] },
]

const SKIP_ID = "__skip__"

export const articulosFieldLabel = (id: string) => DB_FIELD_DEFS.find(d => d.id === id)?.label ?? id

/** Deduce iva_compras desde el símbolo del Excel: 0=adq.stock, +=factura, 1/2=mixto. */
function mapIvaCompras(raw: string): string | undefined {
  const s = raw.trim().toLowerCase()
  if (s === "+" || s === "factura") return "factura"
  if (s === "0" || s === "adquisicion_stock" || s === "adq" || s === "adqstock" || s === "stock") return "adquisicion_stock"
  if (s === "1/2" || s === "½" || s === "0.5" || s === ".5" || s === "medio" || s === "mixto") return "mixto"
  return undefined
}
/** Deduce iva_ventas desde el símbolo del Excel: 0=presupuesto, +=factura. */
function mapIvaVentas(raw: string): string | undefined {
  const s = raw.trim().toLowerCase()
  if (s === "+" || s === "factura") return "factura"
  if (s === "0" || s === "presupuesto") return "presupuesto"
  return undefined
}

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
  descripcion: string | null
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
  const [warnings, setWarnings] = useState<{ sku: string; campo: string; valor: string }[]>([])

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
    setWarnings([])
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

      // La fila de encabezados no siempre es la primera: listas de proveedores suelen
      // traer un título o filas en blanco arriba. Buscar la primera fila (entre las
      // primeras 15) con al menos 2 celdas no vacías y tomarla como encabezado.
      let headerRowIdx = 0
      for (let r = 0; r < Math.min(data.length, 15); r++) {
        const nonEmpty = (data[r] as any[]).filter(c => String(c ?? "").trim() !== "").length
        if (nonEmpty >= 2) { headerRowIdx = r; break }
      }

      // Preservar la posición original de cada columna no-vacía
      const hdrObjects = (data[headerRowIdx] as any[])
        .map((h, i) => ({ name: String(h ?? "").trim(), colIdx: i }))
        .filter(h => h.name !== "")
      if (hdrObjects.length === 0) {
        setError("No se encontraron columnas con nombre en el archivo. Revisá que la fila de encabezados tenga títulos (ej. SKU, Descripción, Precio).")
        return
      }

      const hdrs = hdrObjects.map(h => h.name)
      const initialMappings: ColumnMapping[] = hdrs.map(col => ({
        excelCol: col,
        dbField: suggestField(col),
      }))

      setHeaders(hdrs)
      setHeaderColIndices(hdrObjects.map(h => h.colIdx))
      setExcelRows(data.slice(headerRowIdx + 1))   // filas de datos, después del encabezado
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

  /**
   * Regex para detectar SOLO el formato "(XX%)" al FINAL de la celda.
   * Solo matchea si está entre paréntesis y tiene signo %.
   * NO matchea: "algodon 500", "60x70", números sueltos.
   */
  const OFERTA_RE = /^(.*?)\s*\(\s*(\d+(?:[.,]\d+)?)\s*%\s*\)\s*$/

  /** Convierte las filas de Excel al formato ArticleUpdateRow según el mapeo */
  function buildRows(): { rows: any[]; warnings: { sku: string; campo: string; valor: string }[] } {
    const colIndexMap: Record<string, number> = {}

    headers.forEach((h, i) => {
      const mapping = mappings.find(m => m.excelCol === h)
      if (!mapping || mapping.dbField === SKIP_ID) return
      colIndexMap[mapping.dbField] = headerColIndices[i]
    })

    const NUMERIC_GT0 = ["unidades_por_bulto","cantidad_fraccion","precio_compra","porcentaje_ganancia","precio_base","precio_base_contado","precio_lista_especial"]
    const warnings: { sku: string; campo: string; valor: string }[] = []
    const skuIdxG = colIndexMap["sku"]

    const rows = excelRows
      .filter(row => {
        const skuIdx = colIndexMap["sku"]
        return skuIdx !== undefined && String(row[skuIdx] ?? "").trim() !== ""
      })
      .map(row => {
        const obj: Record<string, any> = {}
        const skuRow = String(row[skuIdxG] ?? "").trim()

        for (const [field, idx] of Object.entries(colIndexMap)) {
          const val = row[idx]
          if (val === "" || val === undefined || val === null) continue
          const str = String(val).trim()

          if (NUMERIC_GT0.includes(field)) {
            // Numérico estricto > 0
            const n = parseFloat(str.replace(",", "."))
            if (!isNaN(n) && n > 0) obj[field] = n
            else warnings.push({ sku: skuRow, campo: fieldLabel(field), valor: str })

          } else if (field === "descripcion") {
            // Guarda descripción limpia; el "(15%)" del final es la oferta:
            // · import de lista ESPECIAL (columna precio_lista_especial mapeada)
            //   → va a oferta_lista_especial; sin % la LIMPIA (no quedan ofertas viejas)
            // · import estándar → va a descuento_propio (comportamiento de siempre)
            const m = str.match(OFERTA_RE)
            const desc = m ? m[1].trim() : str
            if (desc) obj["descripcion"] = desc
            const esImportEspecial = colIndexMap["precio_lista_especial"] !== undefined
            if (esImportEspecial && colIndexMap["oferta_lista_especial"] === undefined) {
              obj["oferta_lista_especial"] = m ? parseFloat(m[2].replace(",", ".")) : null
            } else if (m) {
              obj["descuento_propio"] = parseFloat(m[2].replace(",", "."))
            }

          } else if (field === "descuento_propio" || field === "oferta_lista_especial") {
            // Busca (15%) en CUALQUIER posición del texto (no solo al final)
            // Esto cubre "GRIS (15%)", "(15%)", "15%", "15", etc.
            const mAnywhere = str.match(/\(\s*(\d+(?:[.,]\d+)?)\s*%\s*\)/)
            if (mAnywhere) {
              obj[field] = parseFloat(mAnywhere[1].replace(",", "."))
            } else {
              const n = parseFloat(str.replace(",", "."))
              if (!isNaN(n) && n >= 0 && n <= 100) obj[field] = n
            }

          } else if (field === "iva_compras" || field === "iva_ventas") {
            // Deducción por símbolo del Excel (0 / + / ½). Si no se reconoce, no se importa ese campo.
            const mapped = field === "iva_compras" ? mapIvaCompras(str) : mapIvaVentas(str)
            if (mapped) obj[field] = mapped
            else warnings.push({ sku: skuRow, campo: fieldLabel(field), valor: str })

          } else {
            obj[field] = str
          }
        }

        return obj
      })
      .filter(r => r.sku)

    return { rows, warnings }
  }

  async function handlePreview() {
    const validationError = getMappingValidationError()
    if (validationError) { setError(validationError); return }
    setError(null)
    setLoading(true)

    try {
      const { rows, warnings } = buildRows()
      setWarnings(warnings)
      console.log("[import] buildRows →", rows.length, "filas válidas", rows.slice(0,3))
      const conOferta = rows.filter(r => r.descuento_propio !== undefined)
      console.log("[import] filas con descuento_propio:", conOferta.length, conOferta.map(r => ({ sku: r.sku, descuento_propio: r.descuento_propio })))
      if (rows.length === 0) { setError("No se encontraron filas válidas con SKU."); setLoading(false); return }

      console.log("[import] enviando preview al servidor...")
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 55_000)
      let res: Response
      try {
        res = await fetch("/api/articulos/import-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows, dry_run: true }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }
      console.log("[import] respuesta preview:", res.status, res.statusText)
      const text = await res.text()
      let data: any
      try { data = JSON.parse(text) } catch { throw new Error(`Respuesta no válida (${res.status}): ${text.slice(0, 200)}`) }
      if (!res.ok) throw new Error(data.error || `Error ${res.status}: ${text.slice(0, 200)}`)
      console.log("[import] preview ok:", data.total_filas, "filas,", data.cambios_totales, "cambios")

      setPreview(data)
      setStep("preview")
    } catch (err: any) {
      const msg = err.name === "AbortError" ? "Timeout: el servidor tardó más de 55 segundos" : err.message
      console.error("[import] error preview:", msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  // ─── Step 3: Confirm ─────────────────────────────────────────────────────

  async function handleConfirm() {
    setError(null)
    setLoading(true)

    try {
      const { rows, warnings } = buildRows()
      setWarnings(warnings)
      const res = await fetch("/api/articulos/import-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, dry_run: false, archivo: fileName }),
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

  const fieldLabel = articulosFieldLabel

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="w-[56rem] max-w-[95vw] sm:max-w-[56rem] max-h-[90vh] overflow-y-auto">
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

        {/* Valores que NO se importaron (para corregir y re-subir) */}
        {(step === "preview" || step === "done") && warnings.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
            <div className="font-semibold text-amber-800 mb-1">
              ⚠️ {warnings.length} valor{warnings.length !== 1 ? "es" : ""} no reconocido{warnings.length !== 1 ? "s" : ""} — NO se importaron:
            </div>
            <div className="max-h-28 overflow-y-auto text-amber-700 space-y-0.5">
              {warnings.slice(0, 100).map((w, i) => (
                <div key={i}>
                  SKU <span className="font-mono font-medium">{w.sku || "—"}</span> · {w.campo}: "<span className="font-mono">{w.valor}</span>"
                </div>
              ))}
              {warnings.length > 100 && <div className="italic">…y {warnings.length - 100} más.</div>}
            </div>
            <div className="text-amber-600 mt-1">Corregí esos valores en el Excel y volvé a subirlo.</div>
          </div>
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
                                <span className="font-semibold">{def.label}</span>
                                {def.hint && <span className="text-muted-foreground font-normal"> · {def.hint}</span>}
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
                        <th className="text-left px-2 py-2 font-medium">Descripción</th>
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
                          <td className="px-2 py-1 text-muted-foreground">{d.descripcion ?? "—"}</td>
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
          <div>
            <div className="flex items-center gap-2 mb-3 text-green-700">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-semibold">¡Importación completada!</span>
            </div>
            <ImportReportView
              filas={doneResult.filas ?? []}
              totalFilas={doneResult.total_filas ?? (doneResult.filas?.length ?? 0)}
              claveLabel="SKU"
              nombreLabel="Descripción"
              statuses={["actualizado", "sin_cambios", "nuevo", "error"]}
              archivo={fileName}
              fieldLabel={fieldLabel}
            />
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
