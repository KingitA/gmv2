"use client"

/**
 * Diálogo de historial de importaciones, compartido por clientes / proveedores / articulos.
 * Lista las importaciones del módulo (fecha, archivo, contadores) y al hacer click
 * en una abre la misma pantalla de resultados (ImportReportView) con export a Excel.
 */

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ArrowLeft, AlertCircle, Loader2, History } from "lucide-react"
import { ImportReportView } from "@/components/import/ImportReportView"
import type { ReportFila } from "@/lib/import/export-excel"

interface ResumenItem {
  id: string
  created_at: string
  archivo_nombre: string | null
  conector: string | null
  total_filas: number
  actualizados: number
  sin_cambios: number
  no_encontrados: number
  nuevos: number
  errores: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  modulo: "clientes" | "proveedores" | "articulos"
  claveLabel: string
  nombreLabel: string
  statuses: string[]
  fieldLabel?: (campo: string) => string
}

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export function HistorialImportacionesDialog({ open, onOpenChange, modulo, claveLabel, nombreLabel, statuses, fieldLabel }: Props) {
  const [lista, setLista] = useState<ResumenItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<{ archivo: string; filas: ReportFila[]; total: number } | null>(null)

  useEffect(() => {
    if (!open) { setDetalle(null); setError(null); return }
    setLoading(true)
    fetch(`/api/importaciones-historial?modulo=${modulo}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setLista(d.historial ?? []) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [open, modulo])

  async function abrirDetalle(item: ResumenItem) {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/importaciones-historial/${item.id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error")
      setDetalle({ archivo: item.archivo_nombre || "importacion", filas: data.registro.resultado ?? [], total: data.registro.total_filas })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setDetalle(null); onOpenChange(v) }}>
      <DialogContent className="w-[56rem] max-w-[95vw] sm:max-w-[56rem] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5 text-blue-600" />
            Historial de importaciones
          </DialogTitle>
          <DialogDescription>
            {detalle ? "Resultado de esa importación. Podés exportarlo a Excel." : "Importaciones anteriores. Hacé click en una para ver el detalle."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" className="mb-3">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Cargando...
          </div>
        )}

        {!loading && !detalle && (
          lista.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">Todavía no hay importaciones registradas.</div>
          ) : (
            <div className="border rounded-lg overflow-hidden max-h-[60vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-2 font-medium">Fecha</th>
                    <th className="text-left px-2 py-2 font-medium">Archivo</th>
                    <th className="text-right px-2 py-2 font-medium">Filas</th>
                    <th className="text-right px-2 py-2 font-medium">Actualizados</th>
                    <th className="text-right px-2 py-2 font-medium">Errores</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((it, i) => (
                    <tr key={it.id} onClick={() => abrirDetalle(it)}
                      className={`cursor-pointer hover:bg-blue-50 ${i % 2 === 0 ? "bg-background" : "bg-muted/20"}`}>
                      <td className="px-2 py-1 whitespace-nowrap">{fmtFecha(it.created_at)}</td>
                      <td className="px-2 py-1">{it.archivo_nombre || "—"}</td>
                      <td className="px-2 py-1 text-right">{it.total_filas}</td>
                      <td className="px-2 py-1 text-right text-green-700 font-medium">{it.actualizados}</td>
                      <td className="px-2 py-1 text-right text-red-700 font-medium">{it.errores}</td>
                      <td className="px-2 py-1 text-right">
                        <span className="text-blue-600 font-medium text-[11px]">Ver →</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {!loading && detalle && (
          <div>
            <Button variant="ghost" size="sm" className="mb-2 gap-1" onClick={() => setDetalle(null)}>
              <ArrowLeft className="w-4 h-4" /> Volver al historial
            </Button>
            <ImportReportView
              filas={detalle.filas}
              totalFilas={detalle.total}
              claveLabel={claveLabel}
              nombreLabel={nombreLabel}
              statuses={statuses}
              archivo={detalle.archivo}
              fieldLabel={fieldLabel}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
