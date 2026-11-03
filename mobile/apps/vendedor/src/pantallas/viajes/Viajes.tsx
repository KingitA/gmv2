import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { useOnline, useParamEstado } from "@gm/core"
import { hoyISO } from "@gm/formato"
import { localMatch } from "@gm/vendedor"
import { DS, type ClienteViaje, type ViajeVendedor } from "../../datasets"
import { useRefrescarAlEntrar, useRefrescarFilas, useViajes } from "../../datos/hooks"
import { DIAS_CORTOS, mesDe, mesesNavegables, nombreMes, semanasDelMes, sumarMeses, viajeEnDia, viajeEnMes } from "../../datos/calendario"
import { usePdfComprobantes } from "../../datos/comprobantes-pdf"
import { BadgeEstado, fechaCorta, formatCurrency, NecesitaConexion, Pantalla, SinDescargar, SinEnviar, useToast } from "../../ui"

// MIS VIAJES = CALENDARIO DE REPARTO DE LA OFICINA (pedido de Juan, 03/11/2026).
// La oficina arma el calendario del mes en el ERP (/viajes/planificar). El vendedor NO crea
// viajes: ve los que tocan zonas donde tiene clientes (con el chofer cuando ya está), entra,
// ve sus pedidos cargados y levanta pedidos para ese viaje. Después sigue cómo fue: entregas,
// cobros y comprobantes de sus clientes. Servidor: lib/vendedor/viajes-reparto.ts.
//   /viajes        calendario del mes (de 3 meses atrás al mes que viene)
//   /viajes/:id    detalle: mis pedidos del viaje, cómo fue cada parada, clientes de la zona

const ESTADO_VIAJE: Record<string, { label: string; cls: string }> = {
  programado: { label: "Programado", cls: "bg-alerta-50 text-alerta-700" },
  despachado: { label: "Despachado", cls: "bg-azul-50 text-azul-700" },
  en_curso: { label: "En la calle", cls: "bg-azul-100 text-azul-800" },
  en_rendicion: { label: "Rindiendo", cls: "bg-cian-50 text-cian-800" },
  completado: { label: "Terminado", cls: "bg-exito-50 text-exito-700" },
}
const EstadoViaje = ({ estado }: { estado: string }) => {
  const e = ESTADO_VIAJE[estado] ?? { label: estado, cls: "bg-gray-100 text-gray-600" }
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${e.cls}`}>{e.label}</span>
}

const PARADA: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Sin visitar", cls: "text-gray-500" },
  entregado: { label: "✓ Entregado", cls: "text-exito-700" },
  entregado_parcial: { label: "◐ Entregado en parte", cls: "text-alerta-700" },
  no_entregado: { label: "✕ No entregado", cls: "text-error-700" },
  solo_cobro: { label: "💵 Solo cobro", cls: "text-azul-700" },
}

const rango = (v: { fecha: string; fecha_fin: string }) => (v.fecha === v.fecha_fin ? fechaCorta(v.fecha) : `${fechaCorta(v.fecha)} al ${fechaCorta(v.fecha_fin)}`)
const chofer = (v: { choferes: string[] }) => (v.choferes.length ? `Chofer: ${v.choferes.join(", ")}` : "Sin chofer todavía")

// ─── Calendario ──────────────────────────────────────────────────────────────

function TarjetaViaje({ v }: { v: ViajeVendedor }) {
  const navigate = useNavigate()
  const r = v.resumen
  return (
    <button onClick={() => navigate(`/viajes/${v.id}`)} className="w-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm active:bg-gray-50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-gray-900">{r.zonas.map((z) => z.nombre).join(" + ") || r.nombre}</p>
          <p className="mt-0.5 text-sm text-gray-500">{rango(r)} · {chofer(r)}</p>
        </div>
        <EstadoViaje estado={r.estado} />
      </div>
      <p className="mt-2 text-sm">
        {r.mis_pedidos > 0
          ? <><b className="text-gray-900">{r.mis_pedidos} {r.mis_pedidos === 1 ? "pedido" : "pedidos"}</b> <span className="text-gray-500">· {formatCurrency(r.mis_total)}</span></>
          : <span className="text-gray-400">Sin pedidos tuyos todavía</span>}
      </p>
    </button>
  )
}

export function Viajes() {
  useRefrescarAlEntrar(DS.viajes)
  const { viajes, cargando } = useViajes()
  const hoy = hoyISO()
  const limites = mesesNavegables(hoy)
  const [mes, setMes] = useParamEstado("mes", mesDe(hoy))
  const [dia, setDia] = useParamEstado("dia", "")

  const delMes = useMemo(() => viajes.filter((v) => viajeEnMes(v.resumen, mes)).sort((a, b) => a.resumen.fecha.localeCompare(b.resumen.fecha)), [viajes, mes])
  const lista = dia ? delMes.filter((v) => viajeEnDia(v.resumen, dia)) : delMes
  const irA = (n: number) => { const m = sumarMeses(mes, n); if (m >= limites.desde && m <= limites.hasta) { setMes(m); setDia("") } }

  return (
    <Pantalla titulo="Mis Viajes" dataset={DS.viajes}>
      {cargando ? null : (
        <div className="mx-auto w-full max-w-2xl space-y-3 p-4">
          <p className="text-xs text-gray-500">Los viajes los programa la oficina. Entrá a uno para ver tus pedidos y cargar pedidos de esa zona.</p>

          {/* Mes */}
          <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-2">
            <button onClick={() => irA(-1)} disabled={mes <= limites.desde} className="h-11 w-11 rounded-xl text-xl font-bold text-gray-600 disabled:opacity-30" aria-label="Mes anterior">‹</button>
            <p className="font-bold text-gray-900">{nombreMes(mes)}</p>
            <button onClick={() => irA(1)} disabled={mes >= limites.hasta} className="h-11 w-11 rounded-xl text-xl font-bold text-gray-600 disabled:opacity-30" aria-label="Mes siguiente">›</button>
          </div>

          {/* Grilla: cada día con las zonas que se visitan */}
          <div className="rounded-2xl border border-gray-200 bg-white p-2">
            <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[10px] font-bold uppercase text-gray-400">
              {DIAS_CORTOS.map((d) => <span key={d}>{d}</span>)}
            </div>
            {semanasDelMes(mes).map((sem, i) => (
              <div key={i} className="mt-1 grid grid-cols-7 gap-1">
                {sem.map((d, j) => {
                  if (!d) return <span key={j} />
                  const delDia = delMes.filter((v) => viajeEnDia(v.resumen, d))
                  const sel = dia === d
                  return (
                    <button
                      key={d}
                      onClick={() => setDia(sel ? "" : d)}
                      className={`flex min-h-[64px] min-w-0 flex-col items-stretch rounded-lg border p-0.5 text-left ${sel ? "border-azul-600 bg-azul-50" : d === hoy ? "border-azul-300" : "border-gray-100"}`}
                    >
                      <span className={`text-center text-[11px] font-bold ${d === hoy ? "text-azul-700" : d < hoy ? "text-gray-400" : "text-gray-700"}`}>{Number(d.slice(8))}</span>
                      {delDia.slice(0, 2).map((v) => (
                        <span key={v.id} className={`mt-0.5 truncate rounded px-0.5 text-[9px] font-bold leading-tight ${v.resumen.mis_pedidos > 0 ? "bg-azul-600 text-white" : "bg-azul-100 text-azul-800"}`}>
                          {v.resumen.zonas[0]?.nombre ?? "Viaje"}
                        </span>
                      ))}
                      {delDia.length > 2 && <span className="text-center text-[9px] font-bold text-gray-500">+{delDia.length - 2}</span>}
                    </button>
                  )
                })}
              </div>
            ))}
            <p className="px-1 pt-2 text-[10px] text-gray-400"><span className="rounded bg-azul-600 px-1 text-white">Zona</span> = ya tenés pedidos cargados</p>
          </div>

          {/* Viajes del día elegido (o de todo el mes) */}
          <p className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">
            {dia ? `Viajes del ${fechaCorta(dia)}` : `Viajes de ${nombreMes(mes).toLowerCase()}`}
          </p>
          {viajes.length === 0 ? (
            <SinDescargar que="los viajes" />
          ) : lista.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
              {dia ? "Ese día no hay viajes a tus zonas." : "La oficina todavía no programó viajes a tus zonas para este mes."}
            </div>
          ) : (
            <div className="space-y-2">{lista.map((v) => <TarjetaViaje key={v.id} v={v} />)}</div>
          )}
        </div>
      )}
    </Pantalla>
  )
}

// ─── Detalle ─────────────────────────────────────────────────────────────────

function ClienteConPedido({ c, avisar }: { c: ClienteViaje; avisar: (m: string) => void }) {
  const navigate = useNavigate()
  const pdf = usePdfComprobantes(avisar)
  const pa = c.parada
  const est = pa ? PARADA[pa.estado] ?? { label: pa.estado, cls: "text-gray-600" } : null
  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => navigate(`/clientes/${c.id}`)} className="min-w-0 text-left">
          <p className="truncate font-bold text-gray-900">{c.nombre}</p>
          <p className="truncate text-xs text-gray-400">{[c.direccion, c.localidad].filter(Boolean).join(" · ") || "—"}</p>
        </button>
        {est && <span className={`shrink-0 text-xs font-bold ${est.cls}`}>{est.label}</span>}
      </div>
      {c.pedidos.map((p) => (
        <button key={p.id} disabled={p.sinEnviar} onClick={() => navigate(`/pedidos/${p.id}`)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-left disabled:opacity-100">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <span className="font-bold text-gray-800">{p.numero_pedido ? `#${p.numero_pedido}` : "Pedido"}</span>
            {p.sinEnviar ? <SinEnviar /> : <BadgeEstado estado={p.estado} />}
          </span>
          <span className="shrink-0 font-bold text-gray-900">{formatCurrency(p.total)}</span>
        </button>
      ))}
      {pa && (
        <div className="space-y-1 text-xs text-gray-600">
          {pa.motivo_no_entrega && <p>No se entregó: {pa.motivo_no_entrega}</p>}
          <p>
            Cobrado <b className={pa.cobrado > 0.005 ? "text-exito-700" : "text-gray-700"}>{formatCurrency(pa.cobrado)}</b>
            {pa.motivo_no_cobro ? ` · ${pa.motivo_no_cobro}` : ""}
          </p>
          {pa.comprobantes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {pa.comprobantes.map((cp) => (
                <button key={cp.id} disabled={pdf.ocupado} onClick={() => void pdf.abrir({ id: cp.id, tipo_comprobante: cp.tipo, numero_comprobante: cp.numero })} className="min-h-9 rounded-lg border border-gray-300 bg-white px-2 text-[11px] font-bold text-gray-700 disabled:opacity-40">
                  📄 {cp.tipo} {cp.numero}{cp.saldo > 0.005 ? ` · debe ${formatCurrency(cp.saldo)}` : " · pagado"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ViajeDetalle() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const online = useOnline()
  const { toast, mostrar } = useToast()
  // El detalle de los viajes viejos o lejanos se baja al abrirlo (con señal)
  useRefrescarFilas(DS.viajes, [id])
  const { viajes, cargando } = useViajes()
  const v = viajes.find((x) => x.id === id)
  const [q, setQ] = useState("")

  if (cargando) return <Pantalla titulo="Viaje">{null}</Pantalla>
  if (!v) {
    return (
      <Pantalla titulo="Viaje">
        <div className="p-6 text-center text-gray-500">Este viaje no está en tu calendario.</div>
      </Pantalla>
    )
  }
  const r = v.viaje ?? v.resumen
  const conPedido = (v.clientes ?? []).filter((c) => c.pedidos.length > 0)
  const sinPedido = (v.clientes ?? []).filter((c) => c.pedidos.length === 0 && (!q.trim() || localMatch(q, c.nombre, c.localidad, c.direccion)))
  const t = v.totales
  const salio = r.estado !== "programado"

  return (
    <Pantalla titulo={r.zonas.map((z) => z.nombre).join(" + ") || r.nombre} dataset={DS.viajes}>
      {toast}
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        {/* Cabecera: fechas, chofer, estado y números */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-gray-900">{r.nombre}</p>
              <p className="text-sm text-gray-500">{rango(r)}</p>
              <p className="text-sm text-gray-500">{chofer(r)}</p>
            </div>
            <EstadoViaje estado={r.estado} />
          </div>
          <div className={`mt-3 grid gap-2 text-center ${salio && t ? "grid-cols-3" : "grid-cols-2"}`}>
            <div className="rounded-xl bg-gray-50 p-2">
              <p className="text-[11px] text-gray-500">Mis pedidos</p>
              <p className="font-bold text-gray-900">{t?.pedidos ?? r.mis_pedidos}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-2">
              <p className="text-[11px] text-gray-500">Total</p>
              <p className="font-bold text-gray-900">{formatCurrency(t?.total ?? r.mis_total)}</p>
            </div>
            {salio && t && (
              <div className="rounded-xl bg-gray-50 p-2">
                <p className="text-[11px] text-gray-500">Cobrado</p>
                <p className="font-bold text-exito-700">{formatCurrency(t.cobrado)}</p>
              </div>
            )}
          </div>
          {salio && t && (t.entregados > 0 || t.no_entregados > 0) && (
            <p className="mt-2 text-xs text-gray-500">{t.entregados} {t.entregados === 1 ? "cliente entregado" : "clientes entregados"}{t.no_entregados ? ` · ${t.no_entregados} sin entregar` : ""}</p>
          )}
        </section>

        {!v.clientes ? (
          online ? <p className="rounded-xl border border-gray-200 bg-white p-4 text-center text-sm text-gray-500">Bajando el detalle del viaje…</p> : <NecesitaConexion que="ver el detalle de este viaje" />
        ) : (
          <>
            {/* Mis pedidos en el viaje y cómo fue cada parada */}
            <section className="space-y-2">
              <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Mis pedidos en este viaje</h2>
              {conPedido.length === 0
                ? <p className="rounded-xl border border-gray-200 bg-white p-4 text-center text-sm text-gray-500">Todavía no cargaste pedidos para este viaje.</p>
                : conPedido.map((c) => <ClienteConPedido key={c.id} c={c} avisar={(m) => mostrar(m, "err")} />)}
            </section>

            {/* Clientes de la zona: levantar pedido para este viaje */}
            <section className="space-y-2">
              <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Clientes de la zona</h2>
              {!v.admite_pedidos && (
                <p className="rounded-xl border border-alerta-200 bg-alerta-50 p-3 text-xs text-alerta-800">El viaje ya salió: un pedido nuevo queda sin viaje y lo asigna la oficina.</p>
              )}
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente…" inputMode="search" className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3" />
              {sinPedido.length === 0 ? (
                <p className="rounded-xl border border-gray-200 bg-white p-4 text-center text-sm text-gray-500">{q.trim() ? "Nadie con ese nombre en la zona." : "Todos tus clientes de la zona ya tienen pedido en este viaje."}</p>
              ) : (
                sinPedido.map((c) => {
                  const debe = Math.max(0, c.saldo_proyectado)
                  return (
                    <div key={c.id} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-3">
                      <button onClick={() => navigate(`/clientes/${c.id}`)} className="min-w-0 flex-1 text-left">
                        <p className="truncate font-bold text-gray-900">{c.nombre}</p>
                        <p className="truncate text-xs text-gray-400">
                          {c.localidad || "—"}
                          {debe > 0.005 ? <span className="font-bold text-red-600"> · debe {formatCurrency(debe)}</span> : null}
                        </p>
                      </button>
                      <button
                        onClick={() => navigate(`/pedido/nuevo/${c.id}${v.admite_pedidos ? `?viaje=${v.id}` : ""}`)}
                        className="min-h-11 shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white active:bg-emerald-700"
                      >
                        🛒 Pedido
                      </button>
                    </div>
                  )
                })
              )}
            </section>
          </>
        )}
      </div>
    </Pantalla>
  )
}
