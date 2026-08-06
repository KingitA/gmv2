"use client"

// Imputación posterior de un cobro ya confirmado, desde la Caja del Día.
// Se abre clickeando el chip "Imputar" de la fila: muestra la cuenta corriente
// del cliente (comprobantes con saldo) y aplica la plata disponible del pago.
// Backend: PATCH /api/pagos/[id]/confirmar — cobranza_confirmar es idempotente
// sobre pagos confirmados (guards de libro mayor/recibo/kardex) y aplica las
// imputaciones nuevas en estado 'pendiente'. Lo que no se impute queda a
// cuenta del cliente (su saldo ya bajó al confirmarse el cobro).

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"

const NUM = { fontVariantNumeric: "tabular-nums" } as const
const fmt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 })

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
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [saldoCliente, setSaldoCliente] = useState<number | null>(null)
  const [comprobantes, setComprobantes] = useState<any[]>([])
  const [montos, setMontos] = useState<Record<string, number>>({})

  useEffect(() => {
    const cargar = async () => {
      try {
        const supabase = createClient()
        const [compRes, saldoRes] = await Promise.all([
          supabase
            .from("comprobantes_venta")
            .select("id, numero_comprobante, tipo_comprobante, fecha, saldo_pendiente")
            .eq("cliente_id", pago.cliente_id)
            .in("estado_pago", ["pendiente", "parcial"])
            .gt("saldo_pendiente", 0)
            .order("fecha", { ascending: true })
            .limit(50),
          supabase
            .from("v_saldo_clientes")
            .select("saldo_actual")
            .eq("cliente_id", pago.cliente_id)
            .single(),
        ])
        setComprobantes(compRes.data || [])
        setSaldoCliente(saldoRes.data ? Number(saldoRes.data.saldo_actual) : null)
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [pago.cliente_id])

  const totalImputado = Object.values(montos).reduce((s, v) => s + (Number(v) || 0), 0)
  const restante = pago.disponible - totalImputado

  const toggle = (c: any, on: boolean) => {
    setMontos((prev) => {
      const next = { ...prev }
      if (on) {
        const libre = pago.disponible - Object.values(prev).reduce((s, v) => s + (Number(v) || 0), 0)
        next[c.id] = Math.max(0, Math.min(Number(c.saldo_pendiente), libre))
      } else delete next[c.id]
      return next
    })
  }

  const imputar = async () => {
    const lista = Object.entries(montos)
      .filter(([, v]) => Number(v) > 0)
      .map(([comprobante_id, v]) => ({ comprobante_id, monto_imputado: Number(v) }))
    if (!lista.length) {
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
    for (const [id, v] of Object.entries(montos)) {
      const comp = comprobantes.find((c) => c.id === id)
      if (comp && Number(v) > Number(comp.saldo_pendiente) + 0.01) {
        toast({
          variant: "destructive",
          title: "Monto mayor al saldo",
          description: `${comp.tipo_comprobante} ${comp.numero_comprobante} tiene saldo $ ${fmt(Number(comp.saldo_pendiente))}.`,
        })
        return
      }
    }
    setGuardando(true)
    try {
      const res = await fetch(`/api/pagos/${pago.pago_id}/confirmar`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario_confirmador: usuarioId, accion: "confirmar", imputaciones: lista }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error imputando el pago")
      toast({
        title: "Pago imputado",
        description:
          restante > 0.01
            ? `Aplicado $ ${fmt(totalImputado)}; quedan $ ${fmt(restante)} a cuenta del cliente.`
            : `Aplicado $ ${fmt(totalImputado)} a los comprobantes elegidos.`,
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
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"
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

        {cargando ? (
          <div className="py-8 text-center text-sm text-slate-400">Cargando cuenta corriente…</div>
        ) : comprobantes.length === 0 ? (
          <div className="mt-4 rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            El cliente no tiene comprobantes con saldo — la plata queda a su favor, a cuenta.
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-1.5">
            {comprobantes.map((c) => (
              <label
                key={c.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                  montos[c.id] != null ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"
                }`}
              >
                <input
                  type="checkbox"
                  checked={montos[c.id] != null}
                  onChange={(e) => toggle(c, e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="flex-1 min-w-0 truncate">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">
                    {c.tipo_comprobante}
                  </span>{" "}
                  {c.numero_comprobante}
                  <span className="ml-1 text-[11px] text-slate-400">
                    {c.fecha ? c.fecha.split("-").reverse().join("/") : ""}
                  </span>
                </span>
                <span className="text-xs text-orange-600" style={NUM}>
                  saldo $ {fmt(Number(c.saldo_pendiente))}
                </span>
                {montos[c.id] != null && (
                  <input
                    value={montos[c.id]}
                    onChange={(e) =>
                      setMontos((prev) => ({ ...prev, [c.id]: Number(e.target.value.replace(",", ".")) || 0 }))
                    }
                    inputMode="decimal"
                    className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right text-sm outline-none focus:border-blue-500"
                    style={NUM}
                  />
                )}
              </label>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">Imputado</span>
          <span className="font-bold" style={NUM}>
            $ {fmt(totalImputado)}
          </span>
        </div>
        {restante > 0.01 && (
          <p className="mt-1 text-xs text-slate-400">
            Los $ {fmt(restante)} sin imputar quedan a cuenta del cliente (podés volver a imputar después).
          </p>
        )}
        {restante < -0.01 && (
          <p className="mt-1 text-xs font-semibold text-red-600">
            Estás imputando $ {fmt(-restante)} de más — bajá algún monto.
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={imputar}
            disabled={guardando || cargando || comprobantes.length === 0}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}✓ Imputar
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
