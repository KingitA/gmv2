"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"

export interface Comprobante {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  fecha: string
  total_factura: number
  saldo_pendiente: number
  estado_pago: string
}

interface Props {
  clienteId: string
  seleccionados: Record<string, number>  // { comprobante_id: monto_a_imputar }
  onChange: (next: Record<string, number>) => void
}

export function ComprobantesSelector({ clienteId, seleccionados, onChange }: Props) {
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([])
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (!clienteId) return
    setLoading(true)
    supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, numero_comprobante, fecha, total_factura, saldo_pendiente, estado_pago")
      .eq("cliente_id", clienteId)
      .in("estado_pago", ["pendiente", "parcial"])
      .in("tipo_comprobante", ["FA", "FB", "FC", "PRES"])
      .order("fecha", { ascending: true })
      .then(({ data }) => {
        setComprobantes(data || [])
        setLoading(false)
      })
  }, [clienteId])

  const toggleComprobante = (comp: Comprobante) => {
    if (seleccionados[comp.id] !== undefined) {
      const next = { ...seleccionados }
      delete next[comp.id]
      onChange(next)
    } else {
      onChange({ ...seleccionados, [comp.id]: Number(comp.saldo_pendiente) })
    }
  }

  const updateMonto = (id: string, value: string) => {
    const num = parseFloat(value) || 0
    onChange({ ...seleccionados, [id]: num })
  }

  const fmtARS = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2 })

  const totalSeleccionado = Object.values(seleccionados).reduce((s, v) => s + v, 0)

  if (loading) return <div className="text-sm text-muted-foreground py-4">Cargando comprobantes...</div>
  if (comprobantes.length === 0) return (
    <div className="text-sm text-muted-foreground py-4 text-center">
      No hay comprobantes pendientes para este cliente
    </div>
  )

  return (
    <div>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="w-10 p-2"></th>
              <th className="p-2 text-left">Comprobante</th>
              <th className="p-2 text-left">Fecha</th>
              <th className="p-2 text-right">Total</th>
              <th className="p-2 text-right">Saldo</th>
              <th className="p-2 text-right">A imputar</th>
            </tr>
          </thead>
          <tbody>
            {comprobantes.map((comp) => {
              const checked = seleccionados[comp.id] !== undefined
              return (
                <tr key={comp.id} className={`border-t ${checked ? "bg-blue-50" : "hover:bg-muted/30"}`}>
                  <td className="p-2 text-center">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleComprobante(comp)}
                    />
                  </td>
                  <td className="p-2">
                    <Badge variant="outline" className="mr-1 text-xs">{comp.tipo_comprobante}</Badge>
                    <span className="font-mono text-xs">{comp.numero_comprobante}</span>
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {new Date(comp.fecha).toLocaleDateString("es-AR")}
                  </td>
                  <td className="p-2 text-right font-mono">${fmtARS(Number(comp.total_factura))}</td>
                  <td className="p-2 text-right font-mono text-orange-600">
                    ${fmtARS(Number(comp.saldo_pendiente))}
                  </td>
                  <td className="p-2 text-right">
                    {checked ? (
                      <Input
                        type="number"
                        min={0}
                        max={comp.saldo_pendiente}
                        step="0.01"
                        value={seleccionados[comp.id]}
                        onChange={(e) => updateMonto(comp.id, e.target.value)}
                        className="w-32 h-7 text-right text-sm ml-auto"
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {Object.keys(seleccionados).length > 0 && (
        <div className="flex justify-end mt-2 text-sm font-semibold">
          Total a imputar: <span className="ml-2 text-blue-700">${fmtARS(totalSeleccionado)}</span>
        </div>
      )}
    </div>
  )
}
