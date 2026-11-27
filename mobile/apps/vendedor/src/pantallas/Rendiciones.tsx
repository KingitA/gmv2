import { useEffect, useState } from "react"
import { ErrorHttp, ErrorSesion, useContadoresOutbox, useOnline, useOverlay, useParamEstado, useRuntime } from "@gm/core"
import { fecha, fechaHora, redondear } from "@gm/formato"
import { DS } from "../datasets"
import { efectivoARendir, textoCheques, textoFisico, textoVirtual, useBilletera } from "../datos/billetera"
import { useFilaBilletera, useRefrescarAlEntrar } from "../datos/hooks"
import { fechaAR, formatCurrency, HojaConfirmar, MontoInput, Pantalla, SinDescargar, useToast } from "../ui"

// Enviar rendición (= app/vendedor/rendiciones/page.tsx) — vos declarás
// (POST /api/viajante/rendir) y la plata pasa a "en viaje a oficina" (billetera en 0);
// oficina confirma cuando recibe el dinero (segunda firma, rendicion_confirmar).
// RENDICIÓN ÚNICA (Juan, 27/11/2026): no se eligen cobros. Va TODO lo que tiene en la mano,
// sumando todos sus códigos de vendedor (un usuario = una rendición). Lo FÍSICO (efectivo en
// pesos, cheques de papel en unidades con su monto) va separado de lo VIRTUAL
// (transferencias y echeqs): nunca un total mezclado.
//
// Lecturas: filas "pagos_pendientes" y "rendiciones" de vendedor_billetera.
// Rendir es ONLINE-ONLY a propósito (RPC atómica de plata en el servidor): no pasa por el outbox.

interface Cantidad { cantidad: number; monto: number }

interface PagoPendiente {
  id: string
  monto: number
  monto_efectivo?: number
  /** Servidor desde 27/11 (ausente = servidor viejo) */
  cheques_fisicos?: Cantidad
  echeqs?: Cantidad
  transferencias?: number
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

interface FilaPendientes {
  pagos?: PagoPendiente[]; total?: number; total_efectivo?: number; total_otros?: number
  cheques_fisicos?: Cantidad; echeqs?: Cantidad; transferencias?: number
}
interface FilaRendiciones { rendiciones?: Rendicion[] }

const SIN_PAGOS: PagoPendiente[] = []
const fechaPago = (f: string) => fechaAR(f)

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
  const efectivoCobrado = pend?.total_efectivo || 0
  const chequesFis = pend?.cheques_fisicos ?? null
  const echeqs = pend?.echeqs ?? null
  const transf = pend?.transferencias ?? null

  const { data: billetera } = useBilletera()
  const retiros = billetera?.retiros_sin_rendir || 0

  const [efectivoDeclarado, setEfectivoDeclarado] = useState<number>(0)
  const [obs, setObs] = useState("")
  const [enviando, setEnviando] = useState(false)

  // Cuando cambia lo pendiente, se propone lo que tiene que llevar (efectivo − retiros). La
  // firma evita pisar lo que tocó el usuario en cada sync sin cambios.
  const firma = `${pagos.map((p) => p.id).join(",")}|${efectivoCobrado}|${retiros}`
  useEffect(() => {
    setEfectivoDeclarado(efectivoARendir(efectivoCobrado, retiros))
  }, [firma]) // eslint-disable-line react-hooks/exhaustive-deps

  // Va TODO lo pendiente (rendición única): no se eligen cobros
  const esperado = efectivoARendir(efectivoCobrado, retiros)
  const difDeclarado = redondear(efectivoDeclarado - esperado)
  const fisico = textoFisico(esperado, chequesFis)
  const virtual = textoVirtual(transf, echeqs)

  const rendir = async () => {
    confirmar.cerrar()
    if (!pagos.length || enviando) return
    if (!online) {
      mostrar("Necesitás conexión para rendir", "err")
      return
    }
    setEnviando(true)
    try {
      const d = await api.post<{ error?: string; efectivo_declarado?: number }>(
        "/api/viajante/rendir",
        // Sin pago_ids: el servidor toma TODO lo pendiente de todos tus códigos (rendición única)
        { efectivo_declarado: efectivoDeclarado, observaciones: obs || null },
        { timeoutMs: 30_000 },
      )
      if (d?.error) {
        mostrar(d.error || "Error al rendir.", "err")
        return
      }
      mostrar(`✅ Rendición enviada: efectivo ${formatCurrency(Number(d?.efectivo_declarado ?? efectivoDeclarado))}${chequesFis?.cantidad ? ` · ${textoCheques(chequesFis)}` : ""}. Queda "en viaje a oficina" hasta que la confirmen.`)
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
    <Pantalla titulo="🧾 Enviar rendición" dataset={DS.billetera}>
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
            <h2 className="mb-2 text-lg font-bold text-gray-700">Lo que tenés para rendir</h2>
            {pagos.length ? (
              <div className="space-y-2">
                {/* FÍSICO: lo que entregás en mano (efectivo en pesos, cheques en unidades) */}
                <div className="rounded-xl border-2 border-emerald-500 bg-white p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Llevás a la oficina</p>
                  <p className="mt-1 text-xl font-bold text-gray-900">{fisico}</p>
                  {retiros > 0 && (
                    <p className="mt-2 rounded-lg bg-indigo-50 p-2 text-sm text-indigo-900">
                      Cobraste {formatCurrency(efectivoCobrado)} en efectivo − retiraste {formatCurrency(retiros)} = <b>llevás {formatCurrency(esperado)}</b>
                    </p>
                  )}
                </div>
                {/* VIRTUAL: no se entrega en mano, la oficina la confirma en el banco */}
                {virtual && (
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Virtual (no se lleva: la confirma la oficina)</p>
                    <p className="mt-1 font-bold text-gray-800">{virtual}</p>
                  </div>
                )}
                {/* Detalle: de qué cobros sale (no se eligen: va todo) */}
                <details className="rounded-xl border border-gray-200 bg-white">
                  <summary className="min-h-11 cursor-pointer p-3 text-sm font-bold text-gray-600">Ver los {pagos.length} cobros que incluye</summary>
                  <div className="divide-y divide-gray-100 border-t border-gray-100">
                    {pagos.map((p) => (
                      <div key={p.id} className="flex items-center justify-between px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-900">{p.cliente_nombre}</p>
                          <p className="text-xs text-gray-500">{fechaPago(p.fecha_pago)} · {p.metodo_resumen}</p>
                        </div>
                        <p className="ml-2 shrink-0 text-sm font-bold text-gray-800">{formatCurrency(p.monto)}</p>
                      </div>
                    ))}
                  </div>
                </details>

                <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
                  <div>
                    <label className="mb-1 block font-bold text-gray-700">💵 Efectivo contado (declarado)</label>
                    <MontoInput
                      valor={efectivoDeclarado}
                      onCambio={setEfectivoDeclarado}
                      className="w-full rounded-lg border border-gray-300 px-3 py-3 text-right text-lg font-bold"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-gray-500">Observaciones</label>
                    <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="Opcional..." />
                  </div>
                  <button
                    onClick={confirmar.abrir}
                    disabled={enviando || !pagos.length || !online}
                    className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:bg-gray-300"
                  >
                    {enviando ? "Enviando..." : !online ? "Necesitás conexión para rendir" : "📤 ENVIAR RENDICIÓN"}
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
                            {fecha(r.fecha)} · {r.cantidad_pagos} {r.cantidad_pagos === 1 ? "pago" : "pagos"} ·{" "}
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
                                {fechaHora(r.confirmado_at)}
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
        titulo="¿Enviar la rendición?"
        confirmar="Enviar"
        onConfirmar={() => void rendir()}
      >
        <p>Llevás: <b>{textoFisico(efectivoDeclarado, chequesFis)}</b></p>
        {virtual && <p className="mt-1 text-gray-600">Virtual (lo confirma la oficina): {virtual}</p>}
        {difDeclarado !== 0 && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
            ⚠ Según los cobros{retiros > 0 ? " y lo que retiraste" : ""} deberías llevar {formatCurrency(esperado)} en efectivo ({difDeclarado > 0 ? "sobran" : "faltan"} {formatCurrency(Math.abs(difDeclarado))}). Oficina lo va
            a ver al controlar.
          </p>
        )}
        <p className="mt-2">Oficina recibe el aviso de que el dinero está en viaje y tu billetera queda en 0. Los pagos se confirman cuando oficina recibe la plata.</p>
      </HojaConfirmar>
    </Pantalla>
  )
}
