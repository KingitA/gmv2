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

  // Cuántos bloques Detalle/Antes/Después hacen falta = máximo de campos cambiados
  // en una misma fila. Mínimo 1 para que errores / no encontrados tengan su columna.
  const maxCambios = Math.max(1, ...opts.filas.map(f => f.cambios?.length ?? 0))

  // Encabezados: clave, nombre, estado + N bloques (Detalle / Antes / Después).
  const suf = (k: number) => (k === 0 ? "" : ` ${k + 1}`)
  const header: string[] = [opts.claveLabel, opts.nombreLabel, "Estado"]
  for (let k = 0; k < maxCambios; k++) header.push(`Detalle${suf(k)}`, `Antes${suf(k)}`, `Después${suf(k)}`)

  const rows = opts.filas.map(f => {
    const row: Record<string, any> = {
      [opts.claveLabel]: f.clave ?? "",
      [opts.nombreLabel]: f.nombre ?? "",
      Estado: STATUS_LABEL[f.status] ?? f.status,
    }
    // Inicializar todos los bloques vacíos (así todas las filas tienen las mismas columnas)
    for (let k = 0; k < maxCambios; k++) {
      row[`Detalle${suf(k)}`] = ""
      row[`Antes${suf(k)}`] = ""
      row[`Después${suf(k)}`] = ""
    }
    // Errores y "no encontrado" van en el primer Detalle, sin antes/después
    if (f.error) {
      row["Detalle"] = f.error
    } else if (f.status === "no_encontrado") {
      row["Detalle"] = "No existe en el sistema"
    } else {
      // Un bloque por cada campo que cambió: nombre del campo + valor antes + valor después
      ;(f.cambios ?? []).forEach((c, k) => {
        row[`Detalle${suf(k)}`] = fieldLabel(c.campo)
        row[`Antes${suf(k)}`] = fmt(c.campo, c.actual)
        row[`Después${suf(k)}`] = fmt(c.campo, c.nuevo)
      })
    }
    return row
  })

  const ws = XLSX.utils.json_to_sheet(rows, { header })
  ws["!cols"] = [
    { wch: 16 }, { wch: 40 }, { wch: 14 },
    ...Array.from({ length: maxCambios }, () => [{ wch: 24 }, { wch: 18 }, { wch: 18 }]).flat(),
  ]
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
