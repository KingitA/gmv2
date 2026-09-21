import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { useOnline, useOverlay } from "@gm/core"
import { DS, type ClienteViaje, type OpViajeEstado, type OpViajeNoVa, type ViajeVendedor } from "../../datasets"
import { useEncolar, useRefrescarAlEntrar, useRefrescarFilas, useViajes, useZonas, uuidv4 } from "../../datos/hooks"
import { esIdLocal } from "../../datos/overlay"
import { fechaCorta, formatCurrency, HojaConfirmar, NecesitaConexion, Pantalla, SinDescargar, SinEnviar, useToast } from "../../ui"

// Viajes de levantamiento del viajante (= app/vendedor/viajes/**).
//   /viajes          listado (en curso + anteriores)
//   /viajes/nuevo    alta: fechas + zonas donde tiene clientes        → outbox viaje.crear
//   /viajes/:id      clientes del viaje por estado                    → outbox viaje.cliente_no_va / viaje.estado
// Lo pendiente de enviar ya viene superpuesto por datos/overlay.ts (viajesVisibles): acá no hay estado optimista.

/** Hoy en Argentina (no UTC: a las 21 hs toISOString() ya dice "mañana"). */
const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })

// ─── Listado ─────────────────────────────────────────────────────────────────

function TarjetaViaje({ v }: { v: ViajeVendedor }) {
  const navigate = useNavigate()
  const r = v.resumen
  return (
    <button onClick={() => navigate(`/viajes/${v.id}`)} className="w-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm active:bg-gray-50">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-gray-900">{r.nombre}</p>
          <p className="mt-0.5 text-sm text-gray-500">
            {fechaCorta(r.fecha_inicio)} → {fechaCorta(r.fecha_fin_estimada)}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {r.zonas.map((z) => (
              <span key={z.id} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                {z.nombre}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-1 text-xs font-bold ${r.estado === "en_curso" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
            {r.estado === "en_curso" ? "EN CURSO" : r.estado.toUpperCase()}
          </span>
          {v.sinEnviar && <SinEnviar />}
        </div>
      </div>
    </button>
  )
}

export function Viajes() {
  const navigate = useNavigate()
  const { viajes, cargando } = useViajes()
  useRefrescarAlEntrar(DS.viajes)

  const enCurso = viajes.filter((v) => v.resumen.estado === "en_curso")
  const cerrados = viajes.filter((v) => v.resumen.estado !== "en_curso")

  return (
    <Pantalla
      titulo="Mis Viajes"
      dataset={DS.viajes}
      derecha={
        <button onClick={() => navigate("/viajes/nuevo")} className="mr-1 min-h-11 rounded-xl border border-emerald-500 bg-emerald-600 px-4 text-sm font-medium">
          + Nuevo
        </button>
      }
    >
      <div className="mx-auto w-full max-w-2xl space-y-3 p-4">
        {cargando ? null : viajes.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <p className="mb-3 text-4xl">🧭</p>
            <p className="text-lg text-gray-500">Todavía no hay viajes.</p>
            <button onClick={() => navigate("/viajes/nuevo")} className="mt-4 min-h-12 rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white">
              Crear el primero
            </button>
          </div>
        ) : (
          <>
            {enCurso.map((v) => (
              <TarjetaViaje key={v.id} v={v} />
            ))}
            {cerrados.length > 0 && (
              <>
                <p className="px-1 pt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Anteriores</p>
                {cerrados.map((v) => (
                  <TarjetaViaje key={v.id} v={v} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </Pantalla>
  )
}

// ─── Nuevo viaje ─────────────────────────────────────────────────────────────

export function ViajeNuevo() {
  const navigate = useNavigate()
  const encolar = useEncolar()
  const zonas = useZonas()
  const { toast, mostrar } = useToast()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [nombre, setNombre] = useState("")
  const [fechaInicio, setFechaInicio] = useState(hoyAR)
  const [fechaFin, setFechaFin] = useState("")
  const [creando, setCreando] = useState(false)

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Solo las zonas donde el vendedor tiene clientes propios
  const mias = zonas.filter((z) => z.mis_clientes > 0).sort((a, b) => b.mis_clientes - a.mis_clientes)
  const elegidas = zonas.filter((z) => sel.has(z.id))
  const clientesTotal = elegidas.reduce((s, z) => s + z.mis_clientes, 0)

  const crear = async () => {
    if (!elegidas.length || !fechaInicio || creando) return
    setCreando(true)
    try {
      const id = uuidv4()
      const zonasVista = elegidas.map((z) => ({ id: z.id, nombre: z.nombre }))
      // Mismo nombre que genera el servidor cuando viene vacío
      const nombreVista = nombre.trim() || `Levantamiento ${zonasVista.map((z) => z.nombre).join(" + ")} · ${fechaInicio}`
      await encolar(
        "viaje.crear",
        {
          id,
          nombre: nombre.trim() || undefined,
          fecha_inicio: fechaInicio,
          fecha_fin_estimada: fechaFin || undefined,
          zona_ids: elegidas.map((z) => z.id),
          vista: { zonas: zonasVista, nombre: nombreVista },
        },
        `Viaje nuevo: ${nombreVista}`,
      )
      navigate(`/viajes/${id}`, { replace: true })
    } catch {
      mostrar("No se pudo guardar el viaje en este equipo.", "err")
      setCreando(false)
    }
  }

  return (
    <Pantalla
      titulo="Nuevo viaje"
      pie={
        <div className="border-t border-gray-200 bg-white p-4">
          <div className="mx-auto max-w-2xl space-y-2">
            {sel.size > 0 && (
              <p className="text-center text-sm text-gray-500">
                {elegidas.length} {elegidas.length === 1 ? "zona" : "zonas"} · {clientesTotal} clientes
              </p>
            )}
            <button onClick={() => void crear()} disabled={creando || !elegidas.length || !fechaInicio} className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:bg-gray-300">
              {creando ? "Creando..." : "Crear viaje"}
            </button>
          </div>
        </div>
      }
    >
      {toast}
      <div className="mx-auto w-full max-w-2xl space-y-5 p-4">
        {/* Fechas */}
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div>
            <label className="mb-1 block text-sm text-gray-500">Nombre (opcional)</label>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Se genera solo con las zonas y la fecha" className="w-full rounded-xl border border-gray-300 px-4 py-3" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-gray-500">Inicio de pedidos</label>
              <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} className="w-full rounded-xl border border-gray-300 px-3 py-3" />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-500">Fin estimado</label>
              <input type="date" value={fechaFin} min={fechaInicio} onChange={(e) => setFechaFin(e.target.value)} className="w-full rounded-xl border border-gray-300 px-3 py-3" />
            </div>
          </div>
        </section>

        {/* Zonas: solo las que tienen clientes tuyos */}
        <section>
          <h2 className="mb-2 text-lg font-bold text-gray-700">Zonas del viaje</h2>
          {!zonas.length ? (
            <SinDescargar que="las zonas" />
          ) : !mias.length ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-gray-500">No hay zonas con clientes tuyos. Pedile a oficina que te asigne clientes.</div>
          ) : (
            <div className="space-y-2">
              {mias.map((z) => {
                const activo = sel.has(z.id)
                return (
                  <button key={z.id} onClick={() => toggle(z.id)} className={`min-h-11 w-full rounded-xl border-2 bg-white p-3 text-left ${activo ? "border-emerald-500" : "border-gray-200"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-gray-900">
                          {activo ? "☑" : "☐"} {z.nombre}
                        </p>
                        {z.descripcion && <p className="truncate text-sm text-gray-500">{z.descripcion}</p>}
                      </div>
                      <span className="shrink-0 text-sm font-bold text-emerald-700">
                        {z.mis_clientes} {z.mis_clientes === 1 ? "cliente" : "clientes"}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </Pantalla>
  )
}

// ─── Detalle ─────────────────────────────────────────────────────────────────

function AccionMini({ icono, onClick, title }: { icono: string; onClick: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-lg active:bg-gray-200">
      {icono}
    </button>
  )
}

export function ViajeDetalle() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const online = useOnline()
  const encolar = useEncolar()
  const completar = useOverlay("completar")
  const { viajes, cargando } = useViajes()
  const v = viajes.find((x) => x.id === id) ?? null

  // Con señal se re-lee SOLO este viaje (trae el detalle si no estaba replicado). Uno sin enviar todavía no existe en el servidor.
  useRefrescarFilas(DS.viajes, [v && !v.sinEnviar ? id : undefined])

  // Nunca un "descargando" infinito: si el detalle no llega, se dice.
  const faltaDetalle = !!v && !v.sinEnviar && !v.clientes
  const [vencido, setVencido] = useState(false)
  useEffect(() => {
    setVencido(false)
    if (!faltaDetalle || !online) return
    const t = setTimeout(() => setVencido(true), 20_000)
    return () => clearTimeout(t)
  }, [faltaDetalle, online, id])

  if (cargando) return <Pantalla titulo="Viaje">{null}</Pantalla>

  if (!v || !id) {
    return (
      <Pantalla titulo="Viaje">
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="space-y-4 text-center">
            <p className="text-xl text-red-500">Viaje no encontrado</p>
            <button onClick={() => navigate("/viajes", { replace: true })} className="min-h-12 rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white">
              Volver a viajes
            </button>
          </div>
        </div>
      </Pantalla>
    )
  }

  const viaje = v.viaje ?? v.resumen
  const clientes = v.clientes ?? []
  const abierto = viaje.estado === "en_curso"

  const marcarNoVa = (c: ClienteViaje, noVa: boolean) =>
    void encolar<OpViajeNoVa>("viaje.cliente_no_va", { viaje_id: id, cliente_id: c.id, no_va: noVa }, `${viaje.nombre}: ${c.nombre} ${noVa ? "no va" : "vuelve al viaje"}`)

  const cambiarEstado = (estado: OpViajeEstado["estado"]) =>
    void encolar<OpViajeEstado>("viaje.estado", { viaje_id: id, estado }, `${viaje.nombre}: ${estado === "completado" ? "completar" : "reabrir"}`)

  const levantados = clientes.filter((c) => c.estado_viaje === "pedido_levantado")
  const pendientes = clientes.filter((c) => c.estado_viaje === "pendiente")
  const noVan = clientes.filter((c) => c.estado_viaje === "no_va")
  const enJuego = levantados.length + pendientes.length
  const progreso = enJuego ? Math.round((levantados.length / enJuego) * 100) : 0

  return (
    <Pantalla
      titulo={viaje.nombre}
      dataset={DS.viajes}
      derecha={
        <button
          onClick={() => (abierto ? completar.abrir() : cambiarEstado("en_curso"))}
          className={`mr-1 min-h-11 shrink-0 rounded-full px-3 text-xs font-bold ${abierto ? "border border-emerald-500 bg-emerald-600" : "bg-gray-500"}`}
        >
          {abierto ? "Completar ✓" : "Reabrir"}
        </button>
      }
    >
      <div className="bg-emerald-700 px-5 py-3 text-white">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-emerald-200">
            {fechaCorta(viaje.fecha_inicio)} → {fechaCorta(viaje.fecha_fin_estimada)} · {viaje.zonas.map((z) => z.nombre).join(" + ")}
          </p>
          {v.sinEnviar && <SinEnviar />}
        </div>
        {/* Progreso */}
        {v.clientes && (
          <div className="mt-2">
            <div className="mb-1 flex justify-between text-xs text-emerald-200">
              <span>
                {levantados.length} de {enJuego} pedidos levantados
              </span>
              <span>{progreso}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-emerald-900/40">
              <div className="h-full rounded-full bg-white" style={{ width: `${progreso}%` }} />
            </div>
          </div>
        )}
      </div>

      {v.sinEnviar ? (
        <div className="px-5 py-14 text-center font-medium text-gray-500">Los clientes aparecen cuando el viaje se envíe.</div>
      ) : !v.clientes ? (
        !online ? (
          <NecesitaConexion que="ver los clientes de este viaje" />
        ) : vencido ? (
          <div className="px-5 py-14 text-center font-medium text-gray-500">No se pudieron descargar los clientes de este viaje. Probá de nuevo en un rato.</div>
        ) : (
          <div className="px-5 py-14 text-center font-medium text-gray-500">Descargando los clientes del viaje…</div>
        )
      ) : (
        <div className="mx-auto w-full max-w-2xl space-y-5 p-4 pb-10">
          {/* Pedidos levantados */}
          <section>
            <h2 className="mb-2 text-lg font-bold text-gray-700">✅ Con pedido ({levantados.length})</h2>
            {levantados.length ? (
              <div className="space-y-2">
                {levantados.map((c) => (
                  <div key={c.id} className="rounded-xl border border-emerald-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <button onClick={() => c.pedido && navigate(`/pedidos/${c.pedido.id}`)} className="min-h-11 min-w-0 flex-1 text-left">
                        <p className="truncate font-bold text-gray-900">{c.nombre}</p>
                        <p className="text-sm text-gray-500">
                          {c.pedido?.numero_pedido ? `#${c.pedido.numero_pedido} · ` : ""}
                          {formatCurrency(c.pedido?.total || 0)}
                          {c.pedido?.estado === "en_venta" ? " · EN VENTA" : ""}
                        </p>
                        {esIdLocal(c.pedido?.id) && <SinEnviar />}
                      </button>
                      <div className="flex shrink-0 gap-1.5">
                        <AccionMini icono="👤" title="Ficha del cliente" onClick={() => navigate(`/clientes/${c.id}`)} />
                        <AccionMini icono="💵" title="Cobrar" onClick={() => navigate(`/clientes/${c.id}/cobrar`)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white p-4 text-center text-sm text-gray-500">Todavía no levantaste pedidos en este viaje.</div>
            )}
          </section>

          {/* Pendientes */}
          <section>
            <h2 className="mb-2 text-lg font-bold text-gray-700">🕐 Sin pedido ({pendientes.length})</h2>
            <div className="space-y-2">
              {pendientes.map((c) => (
                <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-gray-900">{c.nombre}</p>
                      <p className="text-sm text-gray-500">
                        {c.localidad || "—"}
                        {c.saldo_actual > 0 ? <span className="font-bold text-red-600"> · debe {formatCurrency(c.saldo_actual)}</span> : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button onClick={() => navigate(`/pedido/nuevo/${c.id}`)} className="min-h-11 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white active:bg-emerald-700">
                        🛒 Pedido
                      </button>
                      <AccionMini icono="👤" title="Ficha del cliente" onClick={() => navigate(`/clientes/${c.id}`)} />
                      <AccionMini icono="💵" title="Cobrar" onClick={() => navigate(`/clientes/${c.id}/cobrar`)} />
                      <AccionMini icono="🚫" title="No va en este viaje" onClick={() => marcarNoVa(c, true)} />
                    </div>
                  </div>
                </div>
              ))}
              {!pendientes.length && <div className="rounded-xl border border-gray-200 bg-white p-4 text-center text-sm text-gray-500">No quedan clientes pendientes. 🎉</div>}
            </div>
          </section>

          {/* No van */}
          {noVan.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-bold text-gray-400">🚫 No van en este viaje ({noVan.length})</h2>
              <div className="space-y-2">
                {noVan.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-100 p-3 opacity-70">
                    <p className="flex-1 truncate font-medium text-gray-600">{c.nombre}</p>
                    <button onClick={() => marcarNoVa(c, false)} className="min-h-11 shrink-0 px-2 text-sm font-bold text-emerald-700">
                      Reponer
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* = confirm() de la web */}
      <HojaConfirmar
        abierta={completar.abierto}
        onCerrar={completar.cerrar}
        titulo="¿Marcar el viaje como completado?"
        confirmar="Completar"
        onConfirmar={() => {
          completar.cerrar()
          cambiarEstado("completado")
        }}
      />
    </Pantalla>
  )
}
