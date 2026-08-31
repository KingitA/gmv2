"use client"

// Imputación posterior de un cobro ya confirmado, desde la Caja del Día.
// Misma experiencia que choferes/vendedores: ComprobantesSelector con pedidos
// completos, comprobantes dentro del pedido y chip "Dto. ctdo".
// SIN opción de 10% contado: la plata A CUENTA no genera bonificación (regla
// de negocio 25/08 — el descuento es por plata nueva entregada al pagar).
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
  const [dialogoFalta, setDialogoFalta] = useState<number | null>(null)

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

  const imputar = async (modoDiferencia?: "saldo" | "ajuste") => {
    setDialogoFalta(null)
    if (!imputaciones.length) {
      toast({ variant: "destructive", title: "Nada para imputar", description: "Tildá al menos un comprobante" })
      return
    }
    const disponibleTotal = round2(pago.disponible)
    const falta = round2(totalImputado - disponibleTotal)
    let lista = imputaciones.map((i) => ({ ...i }))
    if (falta > 0.01) {
      if (!modoDiferencia) {
        setDialogoFalta(falta)
        return
      }
      if (modoDiferencia === "saldo") {
        // Pago parcial: se recorta lo imputado hasta lo disponible
        let excedente = falta
        for (let i = lista.length - 1; i >= 0 && excedente > 0.005; i--) {
          const rebaja = Math.min(lista[i].monto_imputado, excedente)
          lista[i].monto_imputado = round2(lista[i].monto_imputado - rebaja)
          excedente = round2(excedente - rebaja)
        }
        lista = lista.filter((i) => i.monto_imputado > 0.009)
      }
      // "ajuste": se imputa completo y la diferencia se acredita como ajuste
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

      // Ajuste por redondeo: la diferencia se acredita en cuenta corriente
      let ajusteMsg = ""
      if (modoDiferencia === "ajuste" && falta > 0.01) {
        try {
          const ajRes = await fetch(`/api/clientes/${pago.cliente_id}/ajustes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              monto: -falta,
              motivo: `Ajuste por redondeo — imputación de cobro (disponible $ ${fmt(pago.disponible)})`,
              // La falta cae en el último comprobante imputado: se salda también ahí
              comprobante_id: imputaciones[imputaciones.length - 1]?.comprobante_id,
              aplicar_saldo: true,
              // Vincular el ajuste al pago: activa el tope del 1%, la
              // resolución del comprobante correcto en el server y la marca
              // [pago:] que permite revertirlo si el cobro se anula.
              pago_id: pago.pago_id,
            }),
          })
          const ajData = await ajRes.json()
          if (!ajRes.ok) throw new Error(ajData.error)
          ajusteMsg = ` Diferencia de $ ${fmt(falta)} pasada como ajuste por redondeo.`
        } catch {
          ajusteMsg = ` ⚠ El ajuste por redondeo de $ ${fmt(falta)} falló — hacelo a mano desde la cuenta corriente.`
        }
      }

      const bonifMsg = ""

      toast({
        title: "Pago imputado",
        description:
          (restante > 0.01
            ? `Aplicado $ ${fmt(totalImputado)}; quedan $ ${fmt(restante)} a cuenta del cliente.`
            : `Aplicado $ ${fmt(totalImputado)} a los comprobantes elegidos.`) + ajusteMsg + bonifMsg,
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
          {/* Regla de negocio (25/08): la plata A CUENTA no lleva el 10% de
              contado — el descuento es por plata nueva entregada en el momento
              del pago, no por aplicar crédito viejo. Por eso acá no hay opción
              de bonificación. */}
          <span className="text-xs text-slate-400">La plata a cuenta no genera 10% contado</span>
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
            onClick={() => imputar()}
            disabled={guardando || !imputaciones.length}
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

        {/* ── Cartel: lo imputado supera lo disponible — ¿redondeo o saldo? ── */}
        {dialogoFalta != null && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setDialogoFalta(null)}>
            <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base font-bold text-slate-900">
                Falta pagar <span style={NUM}>$ {fmt(dialogoFalta)}</span>
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Lo disponible del cobro no cubre lo
                seleccionado. ¿Qué hacemos con la diferencia?
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  onClick={() => imputar("ajuste")}
                  className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
                >
                  Pasar como ajuste por redondeo
                  <span className="block text-[11px] font-normal opacity-80">
                    El comprobante queda saldado; los $ {fmt(dialogoFalta)} se acreditan como ajuste en la cuenta
                  </span>
                </button>
                <button
                  onClick={() => imputar("saldo")}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Dejar saldo pendiente
                  <span className="block text-[11px] font-normal text-slate-400">
                    El comprobante queda parcial, con $ {fmt(dialogoFalta)} por cobrar
                  </span>
                </button>
                <button
                  onClick={() => setDialogoFalta(null)}
                  className="w-full rounded-lg px-4 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
