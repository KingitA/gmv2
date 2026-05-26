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
  total_neto: number
  total_factura: number
  saldo_pendiente: number
  estado_pago: string
}

interface Props {
  clienteId: string
  seleccionados: Record<string, number>  // { comprobante_id: monto_a_imputar }
  onChange: (next: Record<string, number>) => void
  onComprobantesLoaded?: (comps: Comprobante[]) => void
  onDtosHechosLoaded?: (dtosHechos: Set<string>) => void
}

export function ComprobantesSelector({ clienteId, seleccionados, onChange, onComprobantesLoaded, onDtosHechosLoaded }: Props) {
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([])
  const [conDtoHecho, setConDtoHecho] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (!clienteId) return
    setLoading(true)

    Promise.all([
      // Comprobantes pendientes
      supabase
        .from("comprobantes_venta")
        .select("id, tipo_comprobante, numero_comprobante, fecha, total_neto, total_factura, saldo_pendiente, estado_pago")
        .eq("cliente_id", clienteId)
        .in("estado_pago", ["pendiente", "parcial"])
        .in("tipo_comprobante", ["FA", "FB", "FC", "PRES"])
        .order("fecha", { ascending: true }),

      // NCs/REVs de pago contado ya generadas para este cliente
      supabase
        .from("comprobantes_venta")
        .select("observaciones")
        .eq("cliente_id", clienteId)
        .in("tipo_comprobante", ["REV", "NCA", "NCB", "NCC"])
        .ilike("observaciones", "%Bonificación contado%"),
    ]).then(([{ data: comps }, { data: ncs }]) => {
      const lista = comps || []
      setComprobantes(lista)
      onComprobantesLoaded?.(lista)

      // Detectar qué comprobantes ya tienen dto hecho (NC/REV menciona su número)
      const ncsObs = (ncs || []).map(n => n.observaciones || "")
      const dtosHechos = new Set<string>()
      for (const comp of lista) {
        if (ncsObs.some(obs => obs.includes(comp.numero_comprobante))) {
          dtosHechos.add(comp.id)
        }
      }
      setConDtoHecho(dtosHechos)
      onDtosHechosLoaded?.(dtosHechos)
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
              const dtoHecho = conDtoHecho.has(comp.id)
              return (
                <tr key={comp.id} className={`border-t ${checked ? "bg-blue-50" : "hover:bg-muted/30"}`}>
                  <td className="p-2 text-center">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleComprobante(comp)}
                    />
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="text-xs">{comp.tipo_comprobante}</Badge>
                      <span className="font-mono text-xs">{comp.numero_comprobante}</span>
                      {dtoHecho && (
                        <span className="text-[10px] font-semibold text-green-700 bg-green-100 rounded px-1.5 py-0.5">
                          Dto. pago ctdo hecho
                        </span>
                      )}
                    </div>
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
