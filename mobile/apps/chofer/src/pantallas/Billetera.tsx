import { useOverlay, useParamEstado } from "@gm/core"
import { DS } from "../datasets"
import { useBilletera, useMe, useRefrescarAlEntrar } from "../datos/hooks"
import { fechaHora, formatCurrency, Pantalla, SinDescargar, SinEnviar, useToast } from "../ui"
import { GastoHoja } from "./GastoHoja"

// Billetera del chofer (= app/chofer/billetera/page.tsx): efectivo en mano (cobros sin
// rendir + plata a cuenta del viaje − gastos) y cheques en mano. Todo sale de la réplica
// (chofer_billetera) MÁS lo cobrado y gastado en este equipo que todavía no salió, con su
// marca: el chofer ve en todo momento cuánta plata registró, qué está pendiente de enviar
// y qué ya confirmó el servidor. Es plata: cero ambigüedad.
//   /billetera?tab=cobros|gastos (replace)  ·  ?ver=gasto (hoja, historial)

const ESTADO_COBRO: Record<string, { label: string; cls: string }> = {
  en_mano: { label: "EN MANO", cls: "bg-green-100 text-green-700" },
  en_rendicion: { label: "RENDIDO · ESPERANDO OFICINA", cls: "bg-amber-100 text-amber-700" },
  rendido: { label: "CONFIRMADO", cls: "bg-gray-100 text-gray-500" },
  sin_enviar: { label: "EN MANO · SIN ENVIAR", cls: "bg-amber-50 text-amber-800 border border-amber-300" },
  rechazado: { label: "RECHAZADO POR OFICINA", cls: "bg-red-100 text-red-700" },
}

export function Billetera() {
  const [tabParam, setTab] = useParamEstado("tab", "cobros")
  const tab = tabParam === "gastos" ? "gastos" : "cobros"
  const gasto = useOverlay("gasto")
  const { billetera: data, cargando } = useBilletera()
  const { fila: me } = useMe()
  const { toast, mostrar } = useToast()
  useRefrescarAlEntrar(DS.billetera)

  const viajeActivo = me?.viaje_activo ?? null
  const sinEnviar = data ? data.cobros.filter((c) => c.estado === "sin_enviar") : []
  const rechazados = data ? data.cobros.filter((c) => c.estado === "rechazado") : []
  const efectivoSinEnviar = sinEnviar.reduce((s, c) => s + (c.metodos.every((m) => m === "Efectivo") ? c.monto : 0), 0)
  const gastosSinEnviar = data ? data.gastos.filter((g) => g.local).reduce((s, g) => s + g.monto, 0) : 0

  return (
    <Pantalla
      titulo="Mi billetera"
      dataset={DS.billetera}
      pie={
        <div className="border-t border-gray-200 bg-white p-4">
          <button onClick={gasto.abrir} className="min-h-14 w-full rounded-2xl bg-red-500 py-4 text-lg font-bold text-white active:scale-95">
            💸 Cargar un gasto
          </button>
        </div>
      }
    >
      {toast}
      {cargando ? null : !data ? (
        <SinDescargar que="la billetera" />
      ) : (
        <div className="space-y-4 p-4">
          <div className="rounded-2xl bg-blue-700 p-5 text-white">
            <p className="text-sm text-blue-200">Efectivo en mano</p>
            <p className="text-4xl font-bold">{formatCurrency(data.efectivo)}</p>
            {(efectivoSinEnviar > 0 || gastosSinEnviar > 0) && (
              <p className="mt-1 text-xs text-amber-200">
                ⇪ incluye {efectivoSinEnviar > 0 ? `${formatCurrency(efectivoSinEnviar)} cobrados` : ""}{efectivoSinEnviar > 0 && gastosSinEnviar > 0 ? " y " : ""}{gastosSinEnviar > 0 ? `${formatCurrency(gastosSinEnviar)} gastados` : ""} sin enviar
              </p>
            )}
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div><p className="text-blue-200">Cobros</p><p className="font-bold">{formatCurrency(data.desglose.cobros_efectivo)}</p></div>
              <div><p className="text-blue-200">A cuenta viaje</p><p className="font-bold">{formatCurrency(data.desglose.fondo_viaje)}</p></div>
              <div><p className="text-blue-200">Gastos</p><p className="font-bold text-red-200">−{formatCurrency(data.desglose.gastos)}</p></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-blue-500 pt-3 text-sm">
              <span className="rounded-full bg-blue-600 px-3 py-1">🧾 {data.cheques_cantidad} {data.cheques_cantidad === 1 ? "cheque" : "cheques"} en mano · {formatCurrency(data.desglose.cheques_monto)}</span>
              {data.desglose.en_rendicion > 0 && <span className="rounded-full bg-amber-500/80 px-3 py-1">📦 {formatCurrency(data.desglose.en_rendicion)} camino a oficina</span>}
            </div>
            {Math.abs(data.saldo_cuenta_corriente) > 0.01 && (
              <p className={`mt-2 text-sm ${data.saldo_cuenta_corriente < 0 ? "text-red-200" : "text-green-200"}`}>
                {data.saldo_cuenta_corriente < 0 ? `Debés ${formatCurrency(-data.saldo_cuenta_corriente)} de rendiciones anteriores` : `Tenés ${formatCurrency(data.saldo_cuenta_corriente)} a favor de rendiciones anteriores`}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={() => setTab("cobros")} className={`min-h-11 flex-1 rounded-xl py-2 text-sm font-bold ${tab === "cobros" ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-600"}`}>Cobros</button>
            <button onClick={() => setTab("gastos")} className={`min-h-11 flex-1 rounded-xl py-2 text-sm font-bold ${tab === "gastos" ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-600"}`}>Gastos y plata recibida</button>
          </div>

          {tab === "cobros" ? (
            <div className="space-y-2">
              {data.cobros.length === 0 && <p className="py-8 text-center text-gray-400">Sin cobros todavía.</p>}
              {[...rechazados, ...sinEnviar, ...data.cobros.filter((c) => c.estado === "en_mano"), ...data.cobros.filter((c) => c.estado === "en_rendicion" || c.estado === "rendido")].map((c) => {
                const est = ESTADO_COBRO[c.estado] || ESTADO_COBRO.en_mano!
                return (
                  <div key={c.id} className={`rounded-xl border bg-white px-4 py-3 shadow-sm ${c.estado === "rendido" ? "border-gray-100 opacity-60" : c.estado === "rechazado" ? "border-red-200" : c.estado === "sin_enviar" ? "border-amber-300" : "border-gray-100"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-gray-800">{c.cliente}</p>
                        <p className="text-xs text-gray-500">{c.metodos.join(" + ") || "Efectivo"}{c.viaje ? ` · ${c.viaje}` : ""}</p>
                        <p className="text-xs text-gray-400">{fechaHora(c.fecha)}</p>
                        {c.estado === "rechazado" && c.error && <p className="mt-1 text-xs font-medium text-red-700">{c.error}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-lg font-bold ${c.estado === "rechazado" ? "text-red-500 line-through" : "text-green-600"}`}>{formatCurrency(c.monto)}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${est.cls}`}>{est.label}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {data.fondos.map((f) => (
                <div key={f.id} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                  <div><p className="text-sm font-bold text-gray-800">A cuenta viaje {f.viaje}</p><p className="text-xs text-gray-400">{fechaHora(f.created_at)}</p></div>
                  <p className="text-lg font-bold text-blue-600">+{formatCurrency(f.monto)}</p>
                </div>
              ))}
              {data.gastos.map((g) => (
                <div key={g.id} className={`flex items-center justify-between rounded-xl border bg-white px-4 py-3 shadow-sm ${g.local ? "border-amber-300" : "border-gray-100"}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-bold capitalize text-gray-800">{g.categoria}{g.observaciones ? <span className="font-normal text-gray-500"> · {g.observaciones}</span> : null}</p>
                    <p className="text-xs text-gray-400">{g.viaje ? `${g.viaje} · ` : ""}{fechaHora(g.created_at)} · {g.local ? <SinEnviar /> : g.estado === "aprobado" ? "aprobado" : "a revisar en oficina"}</p>
                  </div>
                  <p className="text-lg font-bold text-red-500">−{formatCurrency(g.monto)}</p>
                </div>
              ))}
              {data.fondos.length === 0 && data.gastos.length === 0 && <p className="py-8 text-center text-gray-400">Sin gastos ni plata recibida.</p>}
            </div>
          )}
        </div>
      )}

      <GastoHoja viajeId={viajeActivo?.id ?? null} viajeNombre={viajeActivo?.nombre} abierta={gasto.abierto} onCerrar={gasto.cerrar} onGuardado={(m) => mostrar(m)} />
    </Pantalla>
  )
}
