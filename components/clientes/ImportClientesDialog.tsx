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
import { Upload, ArrowRight, AlertCircle, Loader2, FileSpreadsheet } from "lucide-react"
import { ImportReportView } from "@/components/import/ImportReportView"

// ─── Campos de cliente mapeables ────────────────────────────────────────────
interface DbFieldDef { id: string; label: string; aliases: string[] }

const SKIP_ID = "__skip__"

const DB_FIELD_DEFS: DbFieldDef[] = [
  // Conectores y los más usados primero
  { id: "codigo_cliente",       label: "Código de cliente (conector)",  aliases: ["codigocliente", "codcliente", "codigo", "cod", "cliente"] },
  { id: "percepcion_iibb",      label: "% Percepción IIBB (alícuota a cobrar)", aliases: ["percepcioniibb", "percepcion", "percepción", "alicuotaiibb", "aliciibb"] },
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
  { id: "nro_iibb",             label: "N° de inscripción IIBB (NO es la percepción)", aliases: ["nroiibb", "numeroiibb", "iibbnro", "inscripcioniibb"] },
  { id: "exento_iibb",          label: "Exento IIBB (SI/NO)",           aliases: ["exentoiibb"] },
  { id: "exento_iva",           label: "Exento IVA (SI/NO)",            aliases: ["exentoiva"] },
  { id: "dias_credito",         label: "Días de crédito",               aliases: ["diascredito", "diasdecredito"] },
  { id: "limite_credito",       label: "Límite de crédito",             aliases: ["limitecredito", "limite", "límite"] },
  { id: "descuento_especial",   label: "Descuento especial (%)",        aliases: ["descuentoespecial", "descespecial"] },
  { id: "zona",                 label: "Zona",                          aliases: ["zona"] },
  { id: "observaciones",        label: "Observaciones",                 aliases: ["observaciones", "obs", "nota", "notas"] },
  { id: SKIP_ID,                label: "— No importar —",               aliases: [] },
]

/**
 * Sugiere el campo destino para una columna del Excel.
 * Reglas ordenadas por especificidad (la primera que matchea gana). Es clave que
 * "percepción/alícuota" se evalúe ANTES que "nro/inscripción", y que una columna
 * "IIBB" a secas caiga en percepción (que es la alícuota que se cobra y lo que
 * normalmente se actualiza en masa), no en el número de inscripción.
 */
function suggestField(colName: string): string {
  const n = colName.toLowerCase().replace(/[^a-z0-9]/g, "")
  const has = (...subs: string[]) => subs.some(s => n.includes(s))

  // Conector
  if (has("codcli", "codigocli", "codigodecli", "nrocli", "clientecod")) return "codigo_cliente"
  if (has("cuit", "cuil")) return "cuit"
  // IIBB: percepción/alícuota primero; luego inscripción; luego "IIBB" a secas → percepción
  if (has("perc", "alic", "tasaiibb", "tasadeiibb")) return "percepcion_iibb"
  if (has("nroiibb", "numeroiibb", "inscrip", "iibbnro", "ndeiibb", "niibb")) return "nro_iibb"
  if (has("iibb", "ingresosbrutos", "ingbrutos", "brutos")) return "percepcion_iibb"
  // Resto
  if (has("razonsocial", "razon", "nombre")) return "nombre_razon_social"
  if (has("mail", "email", "correo")) return "mail"
  if (has("telefono", "celular") || n === "tel" || n === "cel") return "telefono"
  if (has("direccion", "domicilio")) return "direccion"
  if (has("localidad", "ciudad")) return "localidad"
  if (has("provincia")) return "provincia"
  if (has("condicioniva", "condiva")) return "condicion_iva"
  if (has("factur")) return "metodo_facturacion"
  if (has("condicionpago", "formapago") || n === "pago") return "condicion_pago"
  if (has("canal")) return "tipo_canal"
  if (has("exentoiibb")) return "exento_iibb"
  if (has("exentoiva")) return "exento_iva"
  if (has("diascred", "diasdecred")) return "dias_credito"
  if (has("limitecred") || n === "limite") return "limite_credito"
  if (has("descuentoesp", "descesp")) return "descuento_especial"
  if (has("zona")) return "zona"
  if (has("observ", "nota") || n === "obs") return "observaciones"
  if (has("codigo") || n === "cod" || n === "cliente") return "codigo_cliente"
  return SKIP_ID
}

interface ColumnMapping { excelCol: string; dbField: string }

interface FilaReporte {
  clave: string | null
  nombre: string | null
  status: "actualizado" | "actualizar" | "sin_cambios" | "no_encontrado" | "error"
  cambios: { campo: string; actual: any; nuevo: any }[]
  error?: string
}

interface Resultado {
  total_filas: number
  filas: FilaReporte[]
}

type Step = "upload" | "mapping" | "done"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete?: () => void
}

export const clientesFieldLabel = (id: string) => DB_FIELD_DEFS.find(d => d.id === id)?.label ?? id
const fieldLabel = clientesFieldLabel

export function ImportClientesDialog({ open, onOpenChange, onImportComplete }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>("upload")
  const [fileName, setFileName] = useState("")
  const [excelRows, setExcelRows] = useState<any[][]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [headerColIndices, setHeaderColIndices] = useState<number[]>([])
  const [mappings, setMappings] = useState<ColumnMapping[]>([])
  const [result, setResult] = useState<Resultado | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setStep("upload"); setFileName(""); setExcelRows([]); setHeaders([])
    setHeaderColIndices([]); setMappings([]); setResult(null)
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
        body: JSON.stringify({ connector, rows, dry_run: false, archivo: fileName }),
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

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="w-[56rem] max-w-[95vw] sm:max-w-[56rem] max-h-[90vh] overflow-y-auto">
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
          <ImportReportView
            filas={result.filas}
            totalFilas={result.total_filas}
            claveLabel="Código"
            nombreLabel="Nombre"
            statuses={["actualizado", "sin_cambios", "no_encontrado", "error"]}
            archivo={fileName}
            fieldLabel={fieldLabel}
          />
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
