"use client"

import { useEffect, useMemo, useState } from "react"
import { ComprobantesSelector } from "@/components/pagos/ComprobantesSelector"
import { anticiposDeSeleccion, pedidosContadoAEnviar } from "@/lib/cobranzas/reglas-cobro"
import { formatCurrency } from "@/lib/utils"

// Cliente AGREGADO a un cobro conjunto del chofer (web): su cuenta completa, igual que la del
// cliente de la parada — pedidos y comprobantes seleccionables, "Incluir devoluciones como
// crédito", "10% contado a todo" — más plata a cuenta. Los medios de pago son los del cobro: el
// servidor los reparte entre todos (lib/cobranzas/cobro-conjunto.ts). Misma pantalla en la app
// (mobile/apps/chofer/src/pantallas/Cobrar.tsx → CuentaAgregada).

const r2 = (n: number) => Math.round(n * 100) / 100
const TIPOS_BONIFICABLES = ["FA", "FB", "FC", "PRES"]

/** Lo que viaja en `clientes_extra[i]` de POST /api/chofer/viaje/[id]/cobro. */
export interface ResumenAgregado {
  cliente_id: string
  monto: number
  imputaciones: Array<{ comprobante_id: string; monto_imputado: number }>
  devolucion_ids: string[]
  pedidos_contado: string[]
  pedidos_anticipo: Array<{ pedido_id: string; monto: number }>
  contado_general: boolean
}

export function CuentaAgregada({ viajeId, cliente, onResumen, onQuitar }: {
  viajeId: string
  cliente: { id: string; nombre?: string | null; razon_social?: string | null; nombre_razon_social?: string | null; direccion?: string | null; localidad?: string | null }
  onResumen: (id: string, r: ResumenAgregado) => void
  onQuitar: (id: string) => void
}) {
  const id = cliente.id
  const [sel, setSel] = useState<Record<string, number>>({})
  const [contadoPedidos, setContadoPedidos] = useState<Set<string>>(new Set())
  const [contadoGeneral, setContadoGeneral] = useState(false)
  const [comps, setComps] = useState<any[]>([])
  const [dtosHechos, setDtosHechos] = useState<Set<string>>(new Set())
  const [incluirDevoluciones, setIncluirDevoluciones] = useState(true)
  const [aCuenta, setACuenta] = useState(0)
  // Devoluciones pendientes de este cliente EN ESTE VIAJE (solo si es otra parada del viaje)
  const [devoluciones, setDevoluciones] = useState<any[]>([])
  useEffect(() => {
    let vivo = true
    fetch(`/api/chofer/viaje/${viajeId}/cliente/${id}`)
      .then((r) => r.json())
      .then((d) => { if (vivo) setDevoluciones(Array.isArray(d?.devoluciones) ? d.devoluciones.filter((x: any) => x.estado === "pendiente") : []) })
      .catch(() => {})
    return () => { vivo = false }
  }, [viajeId, id])

  const bonificacion = useMemo(() => {
    if (!contadoGeneral) return 0
    let b = 0
    for (const cp of comps) {
      const imp = sel[cp.id]
      if (imp === undefined || dtosHechos.has(cp.id)) continue
      if (!TIPOS_BONIFICABLES.includes(String(cp.tipo_comprobante || "").toUpperCase())) continue
      // REGLA 07/10 (dueño): 10% del TOTAL, una sola vez, aunque pague una parte
      b += Math.min(imp, Math.abs(Number(cp.total_factura) || 0) * 0.1)
    }
    return r2(b)
  }, [contadoGeneral, comps, sel, dtosHechos])
  const totalImputado = r2(Object.values(sel).reduce((s, v) => s + v, 0))
  const devTotal = incluirDevoluciones ? r2(devoluciones.reduce((s, d) => s + Number(d.monto_total), 0)) : 0
  const total = r2(Math.max(0, r2(totalImputado - devTotal - bonificacion)) + Math.max(0, aCuenta))

  const resumen: ResumenAgregado = useMemo(() => ({
    cliente_id: id,
    monto: total,
    imputaciones: Object.entries(sel).filter(([k, m]) => m > 0 && !k.startsWith("pedido:")).map(([comprobante_id, monto_imputado]) => ({ comprobante_id, monto_imputado })),
    devolucion_ids: incluirDevoluciones ? devoluciones.map((d) => d.id) : [],
    pedidos_contado: pedidosContadoAEnviar(contadoPedidos, sel),
    pedidos_anticipo: anticiposDeSeleccion(sel),
    contado_general: contadoGeneral && bonificacion > 0,
  }), [id, total, sel, incluirDevoluciones, devoluciones, contadoPedidos, contadoGeneral, bonificacion])
  useEffect(() => { onResumen(id, resumen) }, [id, resumen, onResumen])

  const nombre = cliente.nombre_razon_social || cliente.razon_social || cliente.nombre || "Cliente"
  return (
    <div className="mt-3 rounded-2xl border-2 border-blue-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-gray-800 truncate">➕ {nombre}</p>
          <p className="text-xs text-gray-400 truncate">{cliente.direccion || ""}{cliente.localidad ? ` · ${cliente.localidad}` : ""}</p>
        </div>
        <button onClick={() => onQuitar(id)} className="text-red-500 text-xl px-2 shrink-0" aria-label={`Quitar a ${nombre}`}>×</button>
      </div>

      <div className="mt-2 space-y-3">
        <ComprobantesSelector
          clienteId={id}
          seleccionados={sel}
          onChange={setSel}
          onContadoPedidosChange={setContadoPedidos}
          seleccionTotal
          contadoGeneral={contadoGeneral}
          onContadoGeneralChange={setContadoGeneral}
          onComprobantesLoaded={setComps}
          onDtosHechosLoaded={setDtosHechos}
          contadoEnBarra={false}
        />

        {devoluciones.length > 0 && (
          <div className="bg-amber-50 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-amber-800">Incluir devoluciones como crédito</p>
                <p className="text-amber-600 text-sm">{formatCurrency(devoluciones.reduce((s, d) => s + Number(d.monto_total), 0))}</p>
              </div>
              <button onClick={() => setIncluirDevoluciones((p) => !p)} className={`w-14 h-7 rounded-full transition-colors ${incluirDevoluciones ? "bg-green-500" : "bg-gray-300"}`} aria-label="Incluir devoluciones">
                <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform mx-1 ${incluirDevoluciones ? "translate-x-7" : ""}`} />
              </button>
            </div>
          </div>
        )}

        {Object.keys(sel).length > 0 && (
          <div className="bg-emerald-50 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-emerald-800">10% contado a todo</p>
                <p className="text-emerald-700 text-sm">
                  {contadoGeneral
                    ? bonificacion > 0
                      ? `−${formatCurrency(bonificacion)} sobre lo seleccionado (la NC sale al confirmar la rendición)`
                      : "Lo seleccionado ya tiene el 10% aplicado o no bonifica: no se aplica dos veces."
                    : "Aplica a los comprobantes seleccionados que aún no lo tengan; los pedidos sin facturar cobran el 90%."}
                </p>
              </div>
              <button onClick={() => setContadoGeneral((p) => !p)} className={`w-14 h-7 shrink-0 rounded-full transition-colors ${contadoGeneral ? "bg-green-500" : "bg-gray-300"}`} aria-label="10% contado a todo">
                <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform mx-1 ${contadoGeneral ? "translate-x-7" : ""}`} />
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">A cuenta (sin imputar):</span>
          <input type="number" inputMode="decimal" min={0} step="0.01" value={aCuenta || ""} placeholder="0" onChange={(e) => setACuenta(Math.max(0, Number(e.target.value) || 0))} className="flex-1 border-2 border-gray-200 rounded-lg px-2 py-1 text-right font-bold" />
        </div>
        <p className="text-right text-sm font-semibold">Se le cobra: <span className="text-blue-700">{formatCurrency(total)}</span></p>
      </div>
    </div>
  )
}
