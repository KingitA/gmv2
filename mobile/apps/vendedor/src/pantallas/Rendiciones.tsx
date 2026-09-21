import { useEffect, useState } from "react"
import { ErrorHttp, ErrorSesion, useContadoresOutbox, useOnline, useOverlay, useParamEstado, useRuntime } from "@gm/core"
import { DS } from "../datasets"
import { useFilaBilletera, useRefrescarAlEntrar } from "../datos/hooks"
import { fechaCorta, formatCurrency, HojaConfirmar, Pantalla, SinDescargar, useToast } from "../ui"

// Rendiciones del viajante (= app/vendedor/rendiciones/page.tsx) — vos declarás
// (POST /api/viajante/rendir) y la plata pasa a "en viaje a oficina" (billetera en 0);
// oficina confirma cuando recibe el dinero (segunda firma, rendicion_confirmar).
//
// Lecturas: filas "pagos_pendientes" y "rendiciones" de vendedor_billetera.
// Rendir es ONLINE-ONLY a propósito (RPC atómica de plata en el servidor): no pasa por el outbox.

interface PagoPendiente {
  id: string
  monto: number
  monto_efectivo?: number
  fecha_pago: string
  cliente_nombre: string
  metodo_resumen: string
}

interface PagoRendicion {
  id: string
  monto: number
  fecha_pago: string
  cliente_nombre: string
  metodo_resumen: string
}

interface Rendicion {
  id: string
  fecha: string
  estado: string
  efectivo_declarado: number
  efectivo_registrado: number
  diferencia: number
  observaciones: string | null
  cantidad_pagos: number
  total: number
  confirmado_at: string | null
  pagos: PagoRendicion[]
}

interface FilaPendientes { pagos?: PagoPendiente[]; total?: number; total_efectivo?: number; total_otros?: number }
interface FilaRendiciones { rendiciones?: Rendicion[] }

const TZ = "America/Argentina/Buenos_Aires"
const SIN_PAGOS: PagoPendiente[] = []
const fechaPago = (f: string) => fechaCorta(f, {})

export function Rendiciones() {
  const { api, sync } = useRuntime()
  const online = useOnline()
  const outbox = useContadoresOutbox()
  const { toast, mostrar } = useToast()
  const confirmar = useOverlay("confirmar")
  const [abierta, setAbierta] = useParamEstado("abierta") // rendición expandida
  useRefrescarAlEntrar(DS.billetera)

  const { fila: pend, cargando } = useFilaBilletera<FilaPendientes>("pagos_pendientes")
  const { fila: hist } = useFilaBilletera<FilaRendiciones>("rendiciones")
  const pagos = pend?.pagos ?? SIN_PAGOS
  const historial = hist?.rendiciones ?? []
  const totales = { total_efectivo: pend?.total_efectivo || 0, total_otros: pend?.total_otros || 0 }

  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [efectivoDeclarado, setEfectivoDeclarado] = useState<number>(0)
  const [obs, setObs] = useState("")
  const [enviando, setEnviando] = useState(false)

  // Igual que `cargar()` de la web: cuando cambia lo pendiente, todo seleccionado y el efectivo
  // estimado como declarado. La firma evita pisar lo que tocó el usuario en cada sync sin cambios.
  const firma = `${pagos.map((p) => p.id).join(",")}|${pend?.total_efectivo ?? 0}`
  useEffect(() => {
    setSeleccionados(new Set(pagos.map((p) => p.id)))
    setEfectivoDeclarado(pend?.total_efectivo || 0)
  }, [firma]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const elegidos = pagos.filter((p) => seleccionados.has(p.id))
  const totalSeleccionado = elegidos.reduce((s, p) => s + p.monto, 0)
  const efectivoSel = elegidos.reduce((s, p) => s + (p.monto_efectivo ?? 0), 0)
  const difDeclarado = Math.round((efectivoDeclarado - efectivoSel) * 100) / 100
  const cuantos = `${elegidos.length} cobro${elegidos.length === 1 ? "" : "s"}`

  const rendir = async () => {
    confirmar.cerrar()
    if (!elegidos.length || enviando) return
    if (!online) {
      mostrar("Necesitás conexión para rendir", "err")
      return
    }
    setEnviando(true)
    try {
      const d = await api.post<{ error?: string; efectivo_declarado?: number }>(
        "/api/viajante/rendir",
        { pago_ids: elegidos.map((p) => p.id), efectivo_declarado: efectivoDeclarado, observaciones: obs || null },
        { timeoutMs: 30_000 },
      )
      if (d?.error) {
        mostrar(d.error || "Error al rendir.", "err")
        return
      }
      mostrar(
        `✅ Rendición enviada: ${cuantos} por ${formatCurrency(totalSeleccionado)}, efectivo declarado ${formatCurrency(Number(d?.efectivo_declarado ?? efectivoDeclarado))}. La plata figura "en viaje a oficina" hasta que la confirmen.`,
      )
      setObs("")
    } catch (e) {
      if (e instanceof ErrorHttp) mostrar(e.message || "Error al rendir.", "err")
      else if (e instanceof ErrorSesion) mostrar(e.message, "err")
      else mostrar("Error de conexión al rendir.", "err")
    } finally {
      // Siempre se re-lee: si el pedido se cortó por timeout, la rendición pudo haberse aplicado igual
      await sync.dataset(DS.billetera).catch(() => {})
      setEnviando(false)
    }
  }

  return (
    <Pantalla titulo="🧾 Rendiciones" dataset={DS.billetera}>
      {toast}
      <div className="bg-emerald-700 px-5 py-2 text-sm text-emerald-100">Vos rendís, oficina confirma al recibir</div>

      {outbox.pendientes > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Tenés operaciones sin enviar: los cobros que hiciste sin señal aparecen acá cuando se envíen.
        </div>
      )}

      {cargando ? null : !pend ? (
        <SinDescargar que="el dinero para rendir" />
      ) : (
        <div className="mx-auto w-full max-w-2xl space-y-5 p-4 pb-10">
          {/* ── Dinero para rendir ── */}
          <section>
            <h2 className="mb-2 text-lg font-bold text-gray-700">Dinero para rendir ({pagos.length})</h2>
            {pagos.length ? (
              <div className="space-y-2">
                {pagos.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    className={`flex min-h-11 w-full items-center justify-between rounded-xl border-2 bg-white p-3 text-left ${seleccionados.has(p.id) ? "border-emerald-500" : "border-gray-200"}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-bold text-gray-900">
                        {seleccionados.has(p.id) ? "☑" : "☐"} {p.cliente_nombre}
                      </p>
                      <p className="text-sm text-gray-500">
                        {fechaPago(p.fecha_pago)} · {p.metodo_resumen}
                      </p>
                    </div>
                    <p className="ml-2 shrink-0 font-bold text-gray-900">{formatCurrency(p.monto)}</p>
                  </button>
                ))}

                <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Efectivo estimado: {formatCurrency(totales.total_efectivo)}</span>
                    <span>Cheques/transf.: {formatCurrency(totales.total_otros)}</span>
                  </div>
                  <div>
                    <label className="mb-1 block font-bold text-gray-700">💵 Efectivo contado (declarado)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={efectivoDeclarado || ""}
                      onChange={(e) => setEfectivoDeclarado(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-3 text-right text-lg font-bold"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-gray-500">Observaciones</label>
                    <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="Opcional..." />
                  </div>
                  <button
                    onClick={confirmar.abrir}
                    disabled={enviando || !elegidos.length || !online}
                    className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:bg-gray-300"
                  >
                    {enviando ? "Enviando..." : !online ? "Necesitás conexión para rendir" : "📤 RENDIR DINERO"}
                  </button>
                  <p className="text-center text-xs text-gray-400">Oficina recibe el aviso de que el dinero está en viaje y tu billetera queda en 0.</p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-gray-500">
                🟢 No tenés dinero pendiente de rendir.
                <p className="mt-2 text-sm text-gray-400">Cada cobro que registres en la calle aparece acá para rendirlo.</p>
              </div>
            )}
          </section>

          {/* ── Historial de rendiciones ── */}
          <section>
            <h2 className="mb-2 text-lg font-bold text-gray-700">Rendiciones anteriores</h2>
            {historial.length ? (
              <div className="space-y-2">
                {historial.map((r) => {
                  const expandida = abierta === r.id
                  return (
                    <div key={r.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                      <button onClick={() => setAbierta(expandida ? "" : r.id)} className="flex min-h-11 w-full items-center justify-between p-3 text-left">
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900">
                            {new Date(r.fecha).toLocaleDateString("es-AR", { timeZone: TZ })} · {r.cantidad_pagos} {r.cantidad_pagos === 1 ? "pago" : "pagos"} ·{" "}
                            {formatCurrency(r.total)}
                          </p>
                          <p className="text-sm text-gray-500">
                            Efectivo declarado {formatCurrency(r.efectivo_declarado)}
                            {r.diferencia ? ` · dif. ${formatCurrency(r.diferencia)}` : ""}
                          </p>
                        </div>
                        <div className="ml-2 flex shrink-0 items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-bold ${
                              r.estado === "confirmada" ? "bg-green-100 text-green-700" : r.estado === "cancelada" ? "bg-gray-200 text-gray-600" : "bg-yellow-100 text-yellow-700"
                            }`}
                          >
                            {r.estado === "confirmada" ? "🟢 Confirmada" : r.estado === "cancelada" ? "⚫ Cancelada" : "🟡 En viaje"}
                          </span>
                          <span className="text-gray-400">{expandida ? "▴" : "▾"}</span>
                        </div>
                      </button>

                      {expandida && (
                        <div className="space-y-2 border-t border-gray-100 bg-gray-50 p-3">
                          {(r.pagos || []).map((p) => (
                            <div key={p.id} className="flex items-center justify-between text-sm">
                              <div className="min-w-0">
                                <p className="truncate font-medium text-gray-800">{p.cliente_nombre}</p>
                                <p className="text-xs text-gray-400">
                                  {fechaPago(p.fecha_pago)} · {p.metodo_resumen}
                                </p>
                              </div>
                              <p className="ml-2 shrink-0 font-bold text-gray-800">{formatCurrency(p.monto)}</p>
                            </div>
                          ))}
                          <div className="space-y-0.5 border-t border-gray-200 pt-2 text-xs text-gray-500">
                            <p>
                              Efectivo: declarado {formatCurrency(r.efectivo_declarado)} · registrado {formatCurrency(r.efectivo_registrado)}
                            </p>
                            {r.observaciones && <p>Obs: {r.observaciones}</p>}
                            {r.confirmado_at && (
                              <p>
                                Confirmada por oficina el{" "}
                                {new Date(r.confirmado_at).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ })}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white p-4 text-center text-sm text-gray-500">Sin rendiciones registradas.</div>
            )}
          </section>
        </div>
      )}

      {/* = confirm() de la web */}
      <HojaConfirmar
        abierta={confirmar.abierto}
        onCerrar={confirmar.cerrar}
        titulo={`¿Rendir ${cuantos} por ${formatCurrency(totalSeleccionado)}?`}
        confirmar="Rendir"
        onConfirmar={() => void rendir()}
      >
        <p>Efectivo que declarás llevar: <b>{formatCurrency(efectivoDeclarado)}</b></p>
        {difDeclarado !== 0 && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
            ⚠ Según los cobros deberías llevar {formatCurrency(efectivoSel)} en efectivo ({difDeclarado > 0 ? "sobran" : "faltan"} {formatCurrency(Math.abs(difDeclarado))}). Oficina lo va
            a ver al controlar.
          </p>
        )}
        <p className="mt-2">Oficina recibe el aviso de que el dinero está en viaje y tu billetera queda en 0. Los pagos se confirman cuando oficina recibe la plata.</p>
      </HojaConfirmar>
    </Pantalla>
  )
}
