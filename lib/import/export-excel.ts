/**
 * Exporta a Excel el resultado de una importación (clientes / proveedores / articulos).
 * Se usa tanto en la pantalla de resultados como al reabrir un historial.
 */

import * as XLSX from "xlsx"

export interface ReportFila {
  clave: string | null
  nombre: string | null
  status: string
  cambios: { campo: string; actual: any; nuevo: any }[]
  error?: string
}

/** Formatea el valor de un campo (redondeo de plata, % en porcentajes, etc.). */
export type ValueFormat = (campo: string, valor: any) => string

const STATUS_LABEL: Record<string, string> = {
  actualizado: "Actualizado",
  actualizar: "Actualizado",
  sin_cambios: "Sin cambios",
  no_encontrado: "No encontrado",
  nuevo: "Nuevo",
  error: "Error",
}

/** Por defecto: si es un número con decimales lo redondea a 2; el resto tal cual. */
const defaultValueFormat: ValueFormat = (_campo, valor) => {
  if (valor === null || valor === undefined || valor === "") return "—"
  const s = String(valor).trim()
  if (/^-?\d+\.\d+$/.test(s)) return (Math.round(parseFloat(s) * 100) / 100).toString()
  return s
}

/** Arma las tres celdas (Detalle / Antes / Después) de una fila. */
function celdas(f: ReportFila, fieldLabel: (c: string) => string, fmt: ValueFormat) {
  if (f.error) return { detalle: f.error, antes: "", despues: "" }
  if (f.status === "no_encontrado") return { detalle: "No existe en el sistema", antes: "", despues: "" }
  if (!f.cambios?.length) return { detalle: "", antes: "", despues: "" }
  return {
    // Qué cambió (solo los nombres de los campos)
    detalle: f.cambios.map(c => fieldLabel(c.campo)).join(" | "),
    // Cómo estaba antes del cambio
    antes: f.cambios.map(c => `${fieldLabel(c.campo)}: ${fmt(c.campo, c.actual)}`).join(" | "),
    // Qué se importó
    despues: f.cambios.map(c => `${fieldLabel(c.campo)}: ${fmt(c.campo, c.nuevo)}`).join(" | "),
  }
}

export function exportReportToExcel(opts: {
  filas: ReportFila[]
  claveLabel: string
  nombreLabel: string
  fieldLabel?: (campo: string) => string
  valueFormat?: ValueFormat
  archivo?: string
}) {
  const fieldLabel = opts.fieldLabel ?? ((c: string) => c)
  const fmt = opts.valueFormat ?? defaultValueFormat
  const rows = opts.filas.map(f => {
    const { detalle, antes, despues } = celdas(f, fieldLabel, fmt)
    return {
      [opts.claveLabel]: f.clave ?? "",
      [opts.nombreLabel]: f.nombre ?? "",
      Estado: STATUS_LABEL[f.status] ?? f.status,
      Detalle: detalle,
      Antes: antes,
      Después: despues,
    }
  })

  const ws = XLSX.utils.json_to_sheet(rows)
  ws["!cols"] = [{ wch: 16 }, { wch: 40 }, { wch: 14 }, { wch: 34 }, { wch: 44 }, { wch: 44 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Resultados")

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" })
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  const base = (opts.archivo || "importacion").replace(/\.[^.]+$/, "")
  a.download = `resultado_${base}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
