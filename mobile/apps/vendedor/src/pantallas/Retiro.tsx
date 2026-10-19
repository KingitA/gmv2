import { useState } from "react"
import { useNavigate } from "react-router"
import { DS } from "../datasets"
import { useBilletera, type OpRetiro } from "../datos/billetera"
import { useEncolar } from "../datos/hooks"
import { formatCurrency, MontoInput, Pantalla, SinDescargar, useToast } from "../ui"

// Retiro de efectivo (regla del dueño 19/10/2026): el vendedor retira él mismo de la plata
// que tiene en la mano. Se debita en su cuenta personal y baja lo que tiene que rendir; la
// oficina lo controla en la rendición. Funciona sin señal (operación retiro.registrar del
// outbox, misma función que POST /api/vendedor/retiro). El servidor vuelve a controlar el
// efectivo al recibirlo: si no alcanza o la cuenta no está vinculada, lo rechaza con el motivo.

export function Retiro() {
  const navigate = useNavigate()
  const encolar = useEncolar()
  const { toast, mostrar } = useToast()
  const { data, cargando } = useBilletera()
  const [monto, setMonto] = useState(0)
  const [obs, setObs] = useState("")
  const [guardando, setGuardando] = useState(false)

  if (cargando) return <Pantalla titulo="💸 Retirar efectivo">{null}</Pantalla>
  if (!data) return <Pantalla titulo="💸 Retirar efectivo" dataset={DS.billetera}><SinDescargar que="la billetera" /></Pantalla>

  const sinCuenta = !data.cuenta_personal
  const supera = monto > data.balance + 0.005

  const registrar = async () => {
    if (guardando) return
    if (sinCuenta) return mostrar("Tu cuenta personal todavía no está vinculada: pedile a la oficina que la vincule.", "err")
    if (!(monto > 0)) return mostrar("Ingresá el monto que retirás.", "err")
    if (supera) return mostrar(`Tenés ${formatCurrency(data.balance)} de efectivo en la mano: no podés retirar ${formatCurrency(monto)}.`, "err")
    setGuardando(true)
    try {
      await encolar<OpRetiro>("retiro.registrar", { monto, observaciones: obs.trim() || null }, `Retiro de efectivo ${formatCurrency(monto)}`)
      navigate("/billetera", { replace: true })
    } catch {
      mostrar("No se pudo guardar el retiro en el equipo.", "err")
      setGuardando(false)
    }
  }

  return (
    <Pantalla
      titulo="💸 Retirar efectivo"
      dataset={DS.billetera}
      pie={
        <div className="border-t border-gray-200 bg-white p-4">
          <button onClick={() => void registrar()} disabled={guardando || sinCuenta || !(monto > 0) || supera} className="mx-auto block w-full max-w-2xl rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:bg-gray-300">
            {guardando ? "Guardando..." : `Registrar retiro ${monto > 0 ? formatCurrency(monto) : ""}`}
          </button>
        </div>
      }
    >
      {toast}
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 text-center">
          <p className="text-sm text-gray-500">Efectivo de la empresa en tu mano</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{formatCurrency(data.balance)}</p>
          {data.cuenta_personal && (
            <p className={`mt-1 text-sm ${data.cuenta_personal.a_favor >= 0 ? "text-green-700" : "text-red-600"}`}>
              Tu cuenta: {formatCurrency(Math.abs(data.cuenta_personal.a_favor))} {data.cuenta_personal.a_favor >= 0 ? "a tu favor" : "debés"}
            </p>
          )}
        </div>

        {sinCuenta ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
            Tu cuenta personal todavía no está vinculada. Pedile a la oficina que la vincule en Cuentas del personal para poder retirar.
          </p>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-sm text-gray-500">Monto que retirás</label>
              <MontoInput valor={monto} onCambio={setMonto} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-right text-2xl font-bold" />
              {supera && <p className="mt-1 text-sm font-bold text-red-600">Supera el efectivo que tenés en la mano ({formatCurrency(data.balance)}).</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-500">Observación (opcional)</label>
              <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3" placeholder="Ej: adelanto de comisiones" />
            </div>
            <p className="text-xs text-gray-500">
              El retiro se descuenta de tu cuenta y de la plata que tenés que rendir. La oficina lo controla en la rendición. Funciona sin señal: se envía solo cuando vuelve.
            </p>
          </>
        )}
      </div>
    </Pantalla>
  )
}
