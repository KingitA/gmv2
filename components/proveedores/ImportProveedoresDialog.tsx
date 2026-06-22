"use client"

/**
 * ImportProveedoresDialog — actualización masiva de proveedores desde Excel.
 * Mismo flujo que clientes: subir → mapear (conector codigo_proveedor o cuit) →
 * actualizar → reporte filtrable con export. NO crea proveedores nuevos.
 */

import React, { useRef, useState } from "react"
import * as XLSX from "xlsx"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Upload, ArrowRight, AlertCircle, Loader2, FileSpreadsheet } from "lucide-react"
import { ImportReportView } from "@/components/import/ImportReportView"

interface DbFieldDef { id: string; label: string }
const SKIP_ID = "__skip__"

const DB_FIELD_DEFS: DbFieldDef[] = [
  { id: "codigo_proveedor",     label: "Código de proveedor (conector)" },
  { id: "email",                label: "Mail principal" },
  { id: "mail_oficina",         label: "Mail oficina" },
  { id: "mail_vendedor",        label: "Mail vendedor" },
  { id: "cuit",                 label: "CUIT (conector)" },
  { id: "nombre",               label: "Nombre / Razón social" },
  { id: "sigla",                label: "Sigla" },
  { id: "telefono",             label: "Teléfono" },
  { id: "telefono_oficina",     label: "Teléfono oficina" },
  { id: "telefono_vendedor",    label: "Teléfono vendedor" },
  { id: "direccion",            label: "Dirección" },
  { id: "localidad",            label: "Localidad" },
  { id: "provincia",            label: "Provincia" },
  { id: "codigo_postal",        label: "Código postal" },
  { id: "condicion_pago",       label: "Condición de pago" },
  { id: "plazo_dias",           label: "Plazo (días)" },
  { id: "dias_vencimiento",     label: "Días de vencimiento" },
  { id: "tipo_proveedor",       label: "Tipo de proveedor" },
  { id: "percepcion_iva",       label: "% Percepción IVA" },
  { id: "percepcion_iibb",      label: "% Percepción IIBB" },
  { id: "retencion_iibb",       label: "% Retención IIBB" },
  { id: "retencion_ganancias",  label: "% Retención Ganancias" },
  { id: "margen_ganancia",      label: "% Margen de ganancia" },
  { id: "banco_nombre",         label: "Banco - nombre" },
  { id: "banco_numero_cuenta",  label: "Banco - N° de cuenta" },
  { id: SKIP_ID,                label: "— No importar —" },
]

export const proveedoresFieldLabel = (id: string) => DB_FIELD_DEFS.find(d => d.id === id)?.label ?? id

function suggestField(colName: string): string {
  const n = colName.toLowerCase().replace(/[^a-z0-9]/g, "")
  const has = (...s: string[]) => s.some(x => n.includes(x))
  if (has("codprov", "codigoprov", "codigodeprov", "nroprov")) return "codigo_proveedor"
  if (has("cuit", "cuil")) return "cuit"
  if (has("mailofic", "emailofic", "correoofic")) return "mail_oficina"
  if (has("mailvend", "emailvend", "correovend")) return "mail_vendedor"
  if (has("mail", "email", "correo")) return "email"
  if (has("telofic")) return "telefono_oficina"
  if (has("telvend")) return "telefono_vendedor"
  if (has("telefono", "celular") || n === "tel" || n === "cel") return "telefono"
  if (has("razonsocial", "razon", "nombre")) return "nombre"
  if (has("sigla")) return "sigla"
  if (has("direccion", "domicilio")) return "direccion"
  if (has("localidad", "ciudad")) return "localidad"
  if (has("provincia")) return "provincia"
  if (has("codigopostal", "cpostal") || n === "cp") return "codigo_postal"
  if (has("perciibb", "percepcioniibb")) return "percepcion_iibb"
  if (has("perciva", "percepcioniva")) return "percepcion_iva"
  if (has("retiibb", "retencioniibb")) return "retencion_iibb"
  if (has("retgan", "retenciongan")) return "retencion_ganancias"
  if (has("margen", "ganancia")) return "margen_ganancia"
  if (has("plazo")) return "plazo_dias"
  if (has("vencimiento")) return "dias_vencimiento"
  if (has("condicionpago", "formapago")) return "condicion_pago"
  if (has("tipoprov")) return "tipo_proveedor"
  if (has("banco")) return "banco_nombre"
  if (has("codigo") || n === "cod") return "codigo_proveedor"
  return SKIP_ID
}

interface ColumnMapping { excelCol: string; dbField: string }
interface FilaReporte { clave: string | null; nombre: string | null; status: string; cambios: { campo: string; actual: any; nuevo: any }[]; error?: string }
interface Resultado { total_filas: number; filas: FilaReporte[] }
type Step = "upload" | "mapping" | "done"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete?: () => void
}

export function ImportProveedoresDialog({ open, onOpenChange, onImportComplete }: Props) {
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
    setHeaderColIndices([]); setMappings([]); setResult(null); setLoading(false); setError(null)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null); setFileName(file.name)
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: "array" })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" })
      if (!data || data.length < 2) { setError("El archivo no tiene datos suficientes."); return }
      let headerRowIdx = 0
      for (let r = 0; r < Math.min(data.length, 15); r++) {
        const nonEmpty = (data[r] as any[]).filter(c => String(c ?? "").trim() !== "").length
        if (nonEmpty >= 2) { headerRowIdx = r; break }
      }
      const hdrObjects = (data[headerRowIdx] as any[]).map((h, i) => ({ name: String(h ?? "").trim(), colIdx: i })).filter(h => h.name !== "")
      if (hdrObjects.length === 0) { setError("No se encontraron columnas con nombre."); return }
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

  function updateMapping(excelCol: string, dbField: string) {
    setMappings(prev => prev.map(m => m.excelCol === excelCol ? { ...m, dbField } : m))
  }

  function getConnector(): "codigo_proveedor" | "cuit" | null {
    if (mappings.some(m => m.dbField === "codigo_proveedor")) return "codigo_proveedor"
    if (mappings.some(m => m.dbField === "cuit")) return "cuit"
    return null
  }

  function getValidationError(): string | null {
    const connector = getConnector()
    if (!connector) return "Tenés que mapear una columna como conector: 'Código de proveedor' o 'CUIT'."
    const activos = mappings.filter(m => m.dbField !== SKIP_ID)
    if (activos.length < 2) return "Mapeá al menos dos columnas: el conector + algún dato a actualizar."
    const usados = activos.map(m => m.dbField)
    if (new Set(usados).size !== usados.length) return "Hay dos columnas apuntando al mismo campo. Revisá el mapeo."
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

  async function handleActualizar() {
    const validation = getValidationError()
    if (validation) { setError(validation); return }
    const connector = getConnector()!
    setError(null); setLoading(true)
    try {
      const rows = buildRows(connector)
      if (rows.length === 0) { setError("No se encontraron filas con valor en la columna conectora."); setLoading(false); return }
      const res = await fetch("/api/proveedores/import-bulk", {
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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-blue-600" />
            Actualizar proveedores desde Excel
          </DialogTitle>
          <DialogDescription>
            {step === "upload" && "Subí tu Excel. El sistema detecta las columnas automáticamente."}
            {step === "mapping" && "Indicá qué columna corresponde a cada dato. Una debe ser el conector (código o CUIT)."}
            {step === "done" && "Resultado de la actualización."}
          </DialogDescription>
        </DialogHeader>

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

        {step === "mapping" && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FileSpreadsheet className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium">{fileName}</span>
              <Badge variant="secondary">{headers.length} columnas</Badge>
              <Badge variant="outline">{excelRows.length} filas</Badge>
            </div>
            <div className="text-xs text-muted-foreground mb-3">
              El conector se usa para encontrar al proveedor; los demás campos se actualizan.
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

        {step === "done" && result && (
          <ImportReportView
            filas={result.filas}
            totalFilas={result.total_filas}
            claveLabel="Código"
            nombreLabel="Nombre"
            statuses={["actualizado", "sin_cambios", "no_encontrado", "error"]}
            archivo={fileName}
            fieldLabel={proveedoresFieldLabel}
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
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Actualizando...</> : "Actualizar proveedores"}
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
