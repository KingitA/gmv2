"use client"

/**
 * Vista de resultados de una importación masiva, compartida por clientes,
 * proveedores y articulos (y por el historial). Muestra tarjetas filtrables,
 * una tabla con clave / nombre / estado / detalle, y un botón para exportar a Excel
 * (todo o según el filtro activo).
 */

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import { exportReportToExcel, type ReportFila, type ValueFormat } from "@/lib/import/export-excel"

export interface StatusDef {
  key: string
  label: string
  /** Clases para el número/etiqueta y para el borde activo de la tarjeta */
  textCls: string
  cardCls: string
  activeCls: string
}

export const STATUS_PRESETS: Record<string, StatusDef> = {
  actualizado:   { key: "actualizado",   label: "Actualizados",   textCls: "text-green-700", cardCls: "bg-green-50 hover:bg-green-100", activeCls: "border-green-500 bg-green-100" },
  sin_cambios:   { key: "sin_cambios",   label: "Sin cambios",    textCls: "text-muted-foreground", cardCls: "bg-muted hover:bg-slate-100", activeCls: "border-slate-400 bg-slate-100" },
  no_encontrado: { key: "no_encontrado", label: "No encontrados", textCls: "text-amber-700", cardCls: "bg-amber-50 hover:bg-amber-100", activeCls: "border-amber-500 bg-amber-100" },
  nuevo:         { key: "nuevo",         label: "Nuevos",         textCls: "text-blue-700", cardCls: "bg-blue-50 hover:bg-blue-100", activeCls: "border-blue-500 bg-blue-100" },
  error:         { key: "error",         label: "Errores",        textCls: "text-red-700", cardCls: "bg-red-50 hover:bg-red-100", activeCls: "border-red-500 bg-red-100" },
}

const BADGE_CLS: Record<string, string> = {
  actualizado: "bg-green-100 text-green-700",
  actualizar: "bg-green-100 text-green-700",
  sin_cambios: "bg-muted text-muted-foreground",
  no_encontrado: "bg-amber-100 text-amber-700",
  nuevo: "bg-blue-100 text-blue-700",
  error: "bg-red-100 text-red-700",
}

interface Props {
  filas: ReportFila[]
  totalFilas: number
  claveLabel: string
  nombreLabel: string
  /** Qué estados mostrar como tarjetas (en orden). */
  statuses: string[]
  archivo?: string
  fieldLabel?: (campo: string) => string
  valueFormat?: ValueFormat
}

export function ImportReportView({ filas, totalFilas, claveLabel, nombreLabel, statuses, archivo, fieldLabel = (c) => c, valueFormat }: Props) {
  const [filtro, setFiltro] = useState<string>("todos")

  const cuenta = (key: string) =>
    key === "actualizado"
      ? filas.filter(f => f.status === "actualizado" || f.status === "actualizar").length
      : filas.filter(f => f.status === key).length

  const filasFiltradas = filas.filter(f => {
    if (filtro === "todos") return true
    if (filtro === "actualizado") return f.status === "actualizado" || f.status === "actualizar"
    return f.status === filtro
  })

  const badge = (status: string) => BADGE_CLS[status] ?? "bg-muted text-muted-foreground"
  const statusLabel = (status: string) => STATUS_PRESETS[status === "actualizar" ? "actualizado" : status]?.label.replace(/s$/, "") ?? status

  return (
    <div>
      <div className={`grid gap-3 mb-3`} style={{ gridTemplateColumns: `repeat(${statuses.length}, minmax(0, 1fr))` }}>
        {statuses.map(key => {
          const def = STATUS_PRESETS[key]
          if (!def) return null
          const activo = filtro === key
          return (
            <button key={key} onClick={() => setFiltro(f => f === key ? "todos" : key)}
              className={`rounded-lg p-3 text-center transition-all border-2 ${activo ? def.activeCls : `border-transparent ${def.cardCls}`}`}>
              <div className={`text-2xl font-bold ${def.textCls}`}>{cuenta(key)}</div>
              <div className={`text-xs ${def.textCls}`}>{def.label}</div>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-muted-foreground">
          {totalFilas} fila{totalFilas !== 1 ? "s" : ""} procesada{totalFilas !== 1 ? "s" : ""}.
          {filtro !== "todos" && <span className="ml-1 font-medium text-foreground">· Filtro: {STATUS_PRESETS[filtro]?.label}</span>}
          {filasFiltradas.length > 300 && " Mostrando primeras 300."}
        </div>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs"
          onClick={() => exportReportToExcel({ filas: filasFiltradas, claveLabel, nombreLabel, fieldLabel, valueFormat, archivo })}
          disabled={filasFiltradas.length === 0}>
          <Download className="w-3.5 h-3.5" />
          Exportar {filtro !== "todos" ? "filtro" : "todo"} a Excel
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden max-h-80 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="text-left px-2 py-2 font-medium">{claveLabel}</th>
              <th className="text-left px-2 py-2 font-medium">{nombreLabel}</th>
              <th className="text-left px-2 py-2 font-medium">Estado</th>
              <th className="text-left px-2 py-2 font-medium">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {filasFiltradas.slice(0, 300).map((f, i) => (
              <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                <td className="px-2 py-1 font-mono font-medium">{f.clave ?? "—"}</td>
                <td className="px-2 py-1">{f.nombre ?? "—"}</td>
                <td className="px-2 py-1">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${badge(f.status)}`}>
                    {statusLabel(f.status)}
                  </span>
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  {f.error
                    ? <span className="text-red-600">{f.error}</span>
                    : f.cambios?.length > 0
                      ? f.cambios.map((c, j) => (
                          <span key={j} className="mr-2">
                            {fieldLabel(c.campo)}: <span className="line-through">{c.actual !== null && c.actual !== "" ? String(c.actual) : "—"}</span> → <span className="font-medium text-green-700">{String(c.nuevo)}</span>
                          </span>
                        ))
                      : f.status === "no_encontrado" ? "No existe en el sistema" : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
