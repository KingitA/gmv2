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

  // Cada bloque Detalle/Antes/Después corresponde a UN campo fijo para todo el
  // Excel (bloque 1 = siempre el mismo campo, bloque 2 = siempre otro, etc.),
  // así una columna no mezcla "Base contado" en una fila y "Unidades" en otra.
  // Orden de los bloques: el campo más modificado primero (desempate: primera
  // aparición). Mínimo 1 bloque para que errores / no encontrados tengan columna.
  const frecuencia = new Map<string, { n: number; orden: number }>()
  for (const f of opts.filas) {
    for (const c of f.cambios ?? []) {
      const cur = frecuencia.get(c.campo)
      if (cur) cur.n += 1
      else frecuencia.set(c.campo, { n: 1, orden: frecuencia.size })
    }
  }
  const campos = [...frecuencia.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].orden - b[1].orden)
    .map(([campo]) => campo)
  const bloques = campos.length ? campos : ["__sin_cambios__"]

  // Encabezados: clave, nombre, estado + un bloque (Detalle / Antes / Después) por campo.
  const suf = (k: number) => (k === 0 ? "" : ` ${k + 1}`)
  const header: string[] = [opts.claveLabel, opts.nombreLabel, "Estado"]
  bloques.forEach((_, k) => header.push(`Detalle${suf(k)}`, `Antes${suf(k)}`, `Después${suf(k)}`))

  const rows = opts.filas.map(f => {
    const row: Record<string, any> = {
      [opts.claveLabel]: f.clave ?? "",
      [opts.nombreLabel]: f.nombre ?? "",
      Estado: STATUS_LABEL[f.status] ?? f.status,
    }
    // Todas las filas con las mismas columnas (bloques vacíos por defecto)
    bloques.forEach((_, k) => {
      row[`Detalle${suf(k)}`] = ""
      row[`Antes${suf(k)}`] = ""
      row[`Después${suf(k)}`] = ""
    })
    // Errores y "no encontrado" van en el primer Detalle, sin antes/después
    if (f.error) {
      row["Detalle"] = f.error
    } else if (f.status === "no_encontrado") {
      row["Detalle"] = "No existe en el sistema"
    } else {
      // Cada cambio va al bloque de SU campo (misma columna para todas las filas)
      for (const c of f.cambios ?? []) {
        const k = bloques.indexOf(c.campo)
        if (k < 0) continue
        row[`Detalle${suf(k)}`] = fieldLabel(c.campo)
        row[`Antes${suf(k)}`] = fmt(c.campo, c.actual)
        row[`Después${suf(k)}`] = fmt(c.campo, c.nuevo)
      }
    }
    return row
  })

  const ws = XLSX.utils.json_to_sheet(rows, { header })
  ws["!cols"] = [
    { wch: 16 }, { wch: 40 }, { wch: 14 },
    ...bloques.flatMap(() => [{ wch: 24 }, { wch: 18 }, { wch: 18 }]),
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
