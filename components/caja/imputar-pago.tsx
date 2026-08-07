"use client"

// Imputación posterior de un cobro ya confirmado, desde la Caja del Día.
// Misma experiencia que choferes/vendedores: ComprobantesSelector con pedidos
// completos, comprobantes dentro del pedido y chip "Dto. ctdo", más la opción
// de aplicar el 10% por pago contado (genera NC/REV vía generar-bonificacion).
// Backend: PATCH /api/pagos/[id]/confirmar — cobranza_confirmar es idempotente
// sobre confirmados y aplica solo las imputaciones nuevas. Lo que no se impute
// queda a cuenta del cliente (su saldo ya bajó al confirmarse el cobro).

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  ComprobantesSelector,
  PEDIDO_PREFIX,
  type Comprobante,
} from "@/components/pagos/ComprobantesSelector"
import { useToast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"

const NUM = { fontVariantNumeric: "tabular-nums" } as const
const fmt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 })
const round2 = (n: number) => Math.round(n * 100) / 100

export interface PagoAImputar {
  pago_id: string
  cliente_id: string
  quien: string
  disponible: number
}

export function ImputarPago({
  pago,
  usuarioId,
  onCerrar,
  onListo,
}: {
  pago: PagoAImputar
  usuarioId: string
  onCerrar: () => void
  onListo: () => void
}) {
  const { toast } = useToast()
  const [guardando, setGuardando] = useState(false)
  const [saldoCliente, setSaldoCliente] = useState<number | null>(null)
  const [seleccionados, setSeleccionados] = useState<Record<string, number>>({})
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([])
  const [dtosHechos, setDtosHechos] = useState<Set<string>>(new Set())
  const [aplicarContado, setAplicarContado] = useState(false)

  useEffect(() => {
    createClient()
      .from("v_saldo_clientes")
      .select("saldo_actual")
      .eq("cliente_id", pago.cliente_id)
      .single()
      .then(({ data }) => setSaldoCliente(data ? Number(data.saldo_actual) : null))
  }, [pago.cliente_id])

  const imputaciones = useMemo(
    () =>
      Object.entries(seleccionados)
        .filter(([k, v]) => !k.startsWith(PEDIDO_PREFIX) && Number(v) > 0)
        .map(([comprobante_id, v]) => ({ comprobante_id, monto_imputado: Number(v) })),
    [seleccionados]
  )
  const anticiposElegidos = useMemo(
    () => Object.keys(seleccionados).filter((k) => k.startsWith(PEDIDO_PREFIX)),
    [seleccionados]
  )
  const totalImputado = imputaciones.reduce((s, i) => s + i.monto_imputado, 0)
  const restante = pago.disponible - totalImputado

  // La NC del 10% es proporcional a TODOS los componentes (neto+IVA+percepciones)
  // → exactamente 10% del total de cada comprobante.
  const bonificacionEstimada = useMemo(() => {
    if (!aplicarContado) return 0
    let total = 0
    for (const i of imputaciones) {
      if (dtosHechos.has(i.comprobante_id)) continue
      const comp = comprobantes.find((c) => c.id === i.comprobante_id)
      if (comp) total += Math.abs(Number(comp.total_factura)) * 0.1
    }
    return round2(total)
  }, [aplicarContado, imputaciones, dtosHechos, comprobantes])

  const imputar = async () => {
    if (!imputaciones.length) {
      toast({ variant: "destructive", title: "Nada para imputar", description: "Tildá al menos un comprobante" })
      return
    }
    if (totalImputado > pago.disponible + 0.01) {
      toast({
        variant: "destructive",
        title: "Imputación excedida",
        description: `Solo hay $ ${fmt(pago.disponible)} disponibles de este cobro.`,
      })
      return
    }
    setGuardando(true)
    try {
      const res = await fetch(`/api/pagos/${pago.pago_id}/confirmar`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario_confirmador: usuarioId, accion: "confirmar", imputaciones }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error imputando el pago")

      // Bonificación 10% contado sobre lo recién imputado (excluye los que ya la tienen)
      let bonifMsg = ""
      if (aplicarContado) {
        const ids = imputaciones.map((i) => i.comprobante_id).filter((id) => !dtosHechos.has(id))
        if (ids.length) {
          try {
            const bonifRes = await fetch("/api/pagos/generar-bonificacion", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cliente_id: pago.cliente_id, comprobante_ids: ids, pago_id: pago.pago_id }),
            })
            const bonifData = await bonifRes.json()
            if (bonifRes.ok) bonifMsg = ` NC por bonificación contado: $ ${fmt(Number(bonifData.total_bonificacion) || 0)}.`
            else bonifMsg = ` ⚠ La bonificación falló: ${bonifData.error || "revisala a mano"}.`
          } catch {
            bonifMsg = " ⚠ La bonificación no se pudo generar — revisala a mano."
          }
        }
      }

      toast({
        title: "Pago imputado",
        description:
          (restante > 0.01
            ? `Aplicado $ ${fmt(totalImputado)}; quedan $ ${fmt(restante)} a cuenta del cliente.`
            : `Aplicado $ ${fmt(totalImputado)} a los comprobantes elegidos.`) + bonifMsg,
      })
      onListo()
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCerrar}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-slate-900">Imputar cobro — {pago.quien}</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Disponible de este cobro: <b style={NUM}>$ {fmt(pago.disponible)}</b>
          {saldoCliente != null && (
            <>
              {" · "}Saldo del cliente:{" "}
              <b className={saldoCliente > 0 ? "text-red-600" : "text-green-600"} style={NUM}>
                $ {fmt(saldoCliente)}
              </b>
            </>
          )}
        </p>

        <div className="mt-3">
          <ComprobantesSelector
            clienteId={pago.cliente_id}
            seleccionados={seleccionados}
            onChange={setSeleccionados}
            onComprobantesLoaded={setComprobantes}
            onDtosHechosLoaded={setDtosHechos}
          />
        </div>

        {anticiposElegidos.length > 0 && (
          <p className="mt-2 text-xs font-semibold text-amber-700">
            ⚠ Los anticipos a pedidos sin facturar se marcan al registrar el cobro, no después — acá
            se ignoran (imputá solo comprobantes).
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
            <input
              type="checkbox"
              checked={aplicarContado}
              onChange={(e) => setAplicarContado(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            10% descuento pago contado
            {bonificacionEstimada > 0 && <span style={NUM}>· NC estimada $ {fmt(bonificacionEstimada)}</span>}
          </label>
          <span>
            Imputado: <b style={NUM}>$ {fmt(totalImputado)}</b>
          </span>
        </div>
        {restante > 0.01 && totalImputado > 0 && (
          <p className="mt-1 text-xs text-slate-400">
            Los $ {fmt(restante)} sin imputar quedan a cuenta del cliente (podés volver a imputar después).
          </p>
        )}
        {restante < -0.01 && (
          <p className="mt-1 text-xs font-semibold text-red-600">
            Estás imputando $ {fmt(-restante)} más que lo disponible del cobro — bajá algún monto.
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={imputar}
            disabled={guardando || !imputaciones.length}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}✓ Imputar
            {aplicarContado && bonificacionEstimada > 0 ? " + Bonif. contado" : ""}
          </button>
          <button
            onClick={onCerrar}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
