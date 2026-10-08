"use client"

// Carteles de diferencia del cobro — UNA sola copia para la barra de Caja y
// para Cobros (/pagos-clientes), con la misma regla del tope de ajuste por
// redondeo (lib/cobranzas/ajuste: 1% de lo seleccionado, solo en contra).
//
//  · SOBRA plata: ajustar (débito, no queda a favor) o dejar a cuenta.
//  · FALTA plata: pasar como ajuste (crédito, comprobante saldado) o dejar saldo.

import { topeAjuste } from "@/lib/cobranzas/ajuste"

const NUM: React.CSSProperties = { fontVariantNumeric: "tabular-nums" }
const fmt = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export function DialogoSobra({
  monto,
  baseTope,
  conContado,
  onAjustar,
  onACuenta,
  onCancelar,
}: {
  monto: number
  /** Base del tope del 1% (lo seleccionado en este cobro) */
  baseTope: number
  conContado?: boolean
  onAjustar: () => void
  onACuenta: () => void
  onCancelar: () => void
}) {
  const tope = topeAjuste(baseTope)
  return (
    <Overlay onClose={onCancelar}>
      <h3 className="text-base font-bold text-slate-900">
        Sobran <span style={NUM}>$ {fmt(monto)}</span>
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Lo entregado{conContado ? " (más la NC del 10%)" : ""} supera lo seleccionado. ¿Qué hacemos con el resto?
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {monto <= tope + 0.005 ? (
          <button
            onClick={onAjustar}
            className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
          >
            Ajustar por redondeo — no queda a favor
            <span className="block text-[11px] font-normal opacity-80">
              La cuenta queda en cero; los $ {fmt(monto)} se asientan como ajuste (débito)
            </span>
          </button>
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Supera el tope de ajuste por redondeo (1% de lo seleccionado = $ {fmt(tope)}).
            Un sobrante así de grande queda a cuenta del cliente (o revisá los montos).
          </p>
        )}
        <button
          onClick={onACuenta}
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Dejar a cuenta
          <span className="block text-[11px] font-normal text-slate-400">
            Los $ {fmt(monto)} quedan a favor del cliente para su próxima compra
          </span>
        </button>
        <button onClick={onCancelar} className="w-full rounded-lg px-4 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-50">
          Cancelar
        </button>
      </div>
    </Overlay>
  )
}

export function DialogoFalta({
  monto,
  baseTope,
  conContado,
  onAjustar,
  onSaldo,
  onCancelar,
}: {
  monto: number
  baseTope: number
  conContado?: boolean
  onAjustar: () => void
  onSaldo: () => void
  onCancelar: () => void
}) {
  const tope = topeAjuste(baseTope)
  return (
    <Overlay onClose={onCancelar}>
      <h3 className="text-base font-bold text-slate-900">
        Falta pagar <span style={NUM}>$ {fmt(monto)}</span>
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Lo entregado{conContado ? " (más la NC del 10%)" : ""} no llega a cubrir lo seleccionado. ¿Qué hacemos con la diferencia?
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {monto <= tope + 0.005 ? (
          <button
            onClick={onAjustar}
            className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
          >
            Pasar como ajuste por redondeo
            <span className="block text-[11px] font-normal opacity-80">
              El comprobante queda saldado; los $ {fmt(monto)} se acreditan como ajuste en la cuenta
            </span>
          </button>
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Supera el tope de ajuste por redondeo (1% de lo seleccionado = $ {fmt(tope)}).
            Perdonar más que eso es una decisión de cuentas corrientes: dejá el saldo pendiente y resolvelo desde la cuenta del cliente.
          </p>
        )}
        <button
          onClick={onSaldo}
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Dejar saldo pendiente
          <span className="block text-[11px] font-normal text-slate-400">
            El comprobante queda parcial, con $ {fmt(monto)} por cobrar
          </span>
        </button>
        <button onClick={onCancelar} className="w-full rounded-lg px-4 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-50">
          Cancelar
        </button>
      </div>
    </Overlay>
  )
}
