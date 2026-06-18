"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ChevronDown, ChevronRight } from "lucide-react"

export interface Comprobante {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  fecha: string
  total_neto: number
  total_factura: number
  saldo_pendiente: number
  estado_pago: string
  pedido_id?: string | null
}

interface Pedido {
  id: string
  numero_pedido: string
  fecha: string
  total: number
  estado: string
}

interface Props {
  clienteId: string
  seleccionados: Record<string, number>  // { comprobante_id | "pedido:<id>": monto }
  onChange: (next: Record<string, number>) => void
  onComprobantesLoaded?: (comps: Comprobante[]) => void
  onDtosHechosLoaded?: (dtosHechos: Set<string>) => void
}

// Prefijo de clave para anticipos a pedidos sin facturar (quedan como pago a cuenta).
export const PEDIDO_PREFIX = "pedido:"

const fmtARS = (n: number) => Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })

export function ComprobantesSelector({ clienteId, seleccionados, onChange, onComprobantesLoaded, onDtosHechosLoaded }: Props) {
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([])
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [pedidosFacturados, setPedidosFacturados] = useState<Set<string>>(new Set())
  const [conDtoHecho, setConDtoHecho] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [expandido, setExpandido] = useState<Record<string, boolean>>({})
  const supabase = createClient()

  useEffect(() => {
    if (!clienteId) return
    setLoading(true)
    Promise.all([
      supabase
        .from("comprobantes_venta")
        .select("id, tipo_comprobante, numero_comprobante, fecha, total_neto, total_factura, saldo_pendiente, estado_pago, pedido_id")
        .eq("cliente_id", clienteId)
        .in("estado_pago", ["pendiente", "parcial"])
        .in("tipo_comprobante", ["FA", "FB", "FC", "PRES"])
        .order("fecha", { ascending: true }),
      supabase
        .from("comprobantes_venta")
        .select("observaciones")
        .eq("cliente_id", clienteId)
        .in("tipo_comprobante", ["REV", "NCA", "NCB", "NCC"])
        .ilike("observaciones", "%Bonificación contado%"),
      supabase
        .from("pedidos")
        .select("id, numero_pedido, fecha, total, estado")
        .eq("cliente_id", clienteId)
        .neq("estado", "eliminado")
        .order("fecha", { ascending: true }),
      // Pedidos que ya tienen comprobante (facturados), sin importar el saldo
      supabase
        .from("comprobantes_venta")
        .select("pedido_id")
        .eq("cliente_id", clienteId)
        .not("pedido_id", "is", null),
    ]).then(([{ data: comps }, { data: ncs }, { data: peds }, { data: facturados }]) => {
      const lista = (comps || []) as Comprobante[]
      setComprobantes(lista)
      onComprobantesLoaded?.(lista)
      setPedidos((peds || []) as Pedido[])
      setPedidosFacturados(new Set((facturados || []).map((f: any) => f.pedido_id).filter(Boolean)))
      const ncsObs = (ncs || []).map((n) => n.observaciones || "")
      const dtos = new Set<string>()
      for (const c of lista) if (ncsObs.some((o) => o.includes(c.numero_comprobante))) dtos.add(c.id)
      setConDtoHecho(dtos)
      onDtosHechosLoaded?.(dtos)
      setLoading(false)
    })
  }, [clienteId])

  // Agrupar comprobantes por pedido
  const compsPorPedido = new Map<string, Comprobante[]>()
  const sinPedido: Comprobante[] = []
  for (const c of comprobantes) {
    if (c.pedido_id) {
      if (!compsPorPedido.has(c.pedido_id)) compsPorPedido.set(c.pedido_id, [])
      compsPorPedido.get(c.pedido_id)!.push(c)
    } else sinPedido.push(c)
  }

  const setSel = (key: string, monto: number | null) => {
    const next = { ...seleccionados }
    if (monto === null) delete next[key]
    else next[key] = monto
    onChange(next)
  }

  const toggleComprobante = (comp: Comprobante) =>
    setSel(comp.id, seleccionados[comp.id] !== undefined ? null : Number(comp.saldo_pendiente))

  const togglePedidoCompleto = (comps: Comprobante[]) => {
    const todosSel = comps.every((c) => seleccionados[c.id] !== undefined)
    const next = { ...seleccionados }
    for (const c of comps) {
      if (todosSel) delete next[c.id]
      else next[c.id] = Number(c.saldo_pendiente)
    }
    onChange(next)
  }

  const toggleAnticipo = (ped: Pedido) =>
    setSel(PEDIDO_PREFIX + ped.id, seleccionados[PEDIDO_PREFIX + ped.id] !== undefined ? null : Number(ped.total))

  const toggleExpand = (id: string) => setExpandido((p) => ({ ...p, [id]: !p[id] }))

  const totalSeleccionado = Object.values(seleccionados).reduce((s, v) => s + v, 0)

  if (loading) return <div className="text-sm text-muted-foreground py-4">Cargando…</div>

  // Pedidos a mostrar: los que tienen comprobantes pendientes (a cobrar), o los
  // SIN facturar (sin ningún comprobante) → anticipo. Los facturados y ya pagados no se muestran.
  const pedidosVisibles = pedidos.filter((p) => compsPorPedido.has(p.id) || !pedidosFacturados.has(p.id))

  if (pedidosVisibles.length === 0 && sinPedido.length === 0)
    return <div className="text-sm text-muted-foreground py-4 text-center">No hay pedidos ni comprobantes pendientes para este cliente</div>

  return (
    <div className="space-y-2">
      {pedidosVisibles.map((ped) => {
        const comps = compsPorPedido.get(ped.id) || []
        const facturado = comps.length > 0
        const anticipoSel = seleccionados[PEDIDO_PREFIX + ped.id] !== undefined
        const todosCompsSel = facturado && comps.every((c) => seleccionados[c.id] !== undefined)
        const algunoSel = comps.some((c) => seleccionados[c.id] !== undefined)
        const abierto = expandido[ped.id] ?? false

        return (
          <div key={ped.id} className={`border rounded-lg ${anticipoSel || algunoSel ? "border-blue-300 bg-blue-50/40" : ""}`}>
            <div className="flex items-center gap-2 p-2.5">
              <Checkbox
                checked={facturado ? todosCompsSel : anticipoSel}
                onCheckedChange={() => (facturado ? togglePedidoCompleto(comps) : toggleAnticipo(ped))}
              />
              <button
                onClick={() => facturado && toggleExpand(ped.id)}
                className="flex items-center gap-1.5 flex-1 text-left"
                disabled={!facturado}
              >
                {facturado ? (abierto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="w-4" />}
                <span className="font-semibold text-sm">Pedido #{ped.numero_pedido}</span>
                <span className="text-xs text-muted-foreground">{new Date(ped.fecha).toLocaleDateString("es-AR")}</span>
                {facturado ? (
                  <Badge variant="outline" className="text-[10px]">{comps.length} comprob.</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">Sin facturar (anticipo)</Badge>
                )}
              </button>
              <span className="font-mono text-sm">${fmtARS(facturado ? comps.reduce((s, c) => s + Number(c.saldo_pendiente), 0) : Number(ped.total))}</span>
            </div>

            {facturado && abierto && (
              <div className="border-t bg-white">
                {comps.map((comp) => {
                  const checked = seleccionados[comp.id] !== undefined
                  const dtoHecho = conDtoHecho.has(comp.id)
                  return (
                    <div key={comp.id} className={`flex items-center gap-2 px-3 py-2 border-t text-sm ${checked ? "bg-blue-50" : ""}`}>
                      <Checkbox checked={checked} onCheckedChange={() => toggleComprobante(comp)} />
                      <Badge variant="outline" className="text-xs">{comp.tipo_comprobante}</Badge>
                      <span className="font-mono text-xs">{comp.numero_comprobante}</span>
                      {dtoHecho && <span className="text-[10px] font-semibold text-green-700 bg-green-100 rounded px-1.5 py-0.5">Dto. ctdo</span>}
                      <span className="ml-auto font-mono text-orange-600">saldo ${fmtARS(Number(comp.saldo_pendiente))}</span>
                      {checked ? (
                        <Input
                          type="number" min={0} max={comp.saldo_pendiente} step="0.01"
                          value={seleccionados[comp.id]}
                          onChange={(e) => setSel(comp.id, parseFloat(e.target.value) || 0)}
                          className="w-28 h-7 text-right text-sm"
                        />
                      ) : <span className="w-28 text-right text-muted-foreground">—</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* Comprobantes sin pedido asociado */}
      {sinPedido.length > 0 && (
        <div className="border rounded-lg">
          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b">Otros comprobantes</div>
          {sinPedido.map((comp) => {
            const checked = seleccionados[comp.id] !== undefined
            return (
              <div key={comp.id} className={`flex items-center gap-2 px-3 py-2 border-t text-sm ${checked ? "bg-blue-50" : ""}`}>
                <Checkbox checked={checked} onCheckedChange={() => toggleComprobante(comp)} />
                <Badge variant="outline" className="text-xs">{comp.tipo_comprobante}</Badge>
                <span className="font-mono text-xs">{comp.numero_comprobante}</span>
                <span className="ml-auto font-mono text-orange-600">saldo ${fmtARS(Number(comp.saldo_pendiente))}</span>
                {checked ? (
                  <Input
                    type="number" min={0} max={comp.saldo_pendiente} step="0.01"
                    value={seleccionados[comp.id]}
                    onChange={(e) => setSel(comp.id, parseFloat(e.target.value) || 0)}
                    className="w-28 h-7 text-right text-sm"
                  />
                ) : <span className="w-28 text-right text-muted-foreground">—</span>}
              </div>
            )
          })}
        </div>
      )}

      {Object.keys(seleccionados).length > 0 && (
        <div className="flex justify-end text-sm font-semibold pt-1">
          Total a pagar: <span className="ml-2 text-blue-700">${fmtARS(totalSeleccionado)}</span>
        </div>
      )}
    </div>
  )
}
