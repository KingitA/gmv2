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

const STATUS_LABEL: Record<string, string> = {
  actualizado: "Actualizado",
  actualizar: "Actualizado",
  sin_cambios: "Sin cambios",
  no_encontrado: "No encontrado",
  nuevo: "Nuevo",
  error: "Error",
}

/** Aplana los cambios de una fila a texto legible para el Excel. */
function detalleTexto(f: ReportFila, fieldLabel: (campo: string) => string): string {
  if (f.error) return f.error
  if (f.status === "no_encontrado") return "No existe en el sistema"
  if (!f.cambios?.length) return ""
  return f.cambios
    .map(c => `${fieldLabel(c.campo)}: ${c.actual !== null && c.actual !== "" ? c.actual : "—"} → ${c.nuevo}`)
    .join(" | ")
}

export function exportReportToExcel(opts: {
  filas: ReportFila[]
  claveLabel: string
  nombreLabel: string
  fieldLabel?: (campo: string) => string
  archivo?: string
}) {
  const fieldLabel = opts.fieldLabel ?? ((c: string) => c)
  const rows = opts.filas.map(f => ({
    [opts.claveLabel]: f.clave ?? "",
    [opts.nombreLabel]: f.nombre ?? "",
    Estado: STATUS_LABEL[f.status] ?? f.status,
    Detalle: detalleTexto(f, fieldLabel),
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  ws["!cols"] = [{ wch: 16 }, { wch: 40 }, { wch: 16 }, { wch: 60 }]
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
