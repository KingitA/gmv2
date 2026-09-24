import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useBlocker, useLocation, useNavigate, useSearchParams } from "react-router"
import { decidirAtras, indiceHistorial, useItemsOutbox, useOnline, useRuntime, type ItemOutbox } from "@gm/core"
import { autoFormatoFechaAR, avisosBcraPendientes, fechaARAIso, fechaIsoAAR, resultadoSinCuit, type ConsultaBcraResultado } from "@gm/cheques"
import { Encabezado, Frescura, Hoja } from "@gm/core/ui"

// UI compartida de la app Chofer. Mismos textos, colores y jerarquía que el módulo web
// /chofer (los choferes ya lo conocen); lo único propio de la app es el encabezado del
// core (atrás · En línea/Sin red · contador ⇪) y la frescura del dato.
// (Rechazos, AvisosBcra, MontoInput, HojaConfirmar y los toasts son el mismo patrón que
// la app Vendedor; consolidarlos en @gm/core/ui es tarea de la próxima actualización
// batcheada de las tres apps.)

const ARS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" })
export const formatCurrency = (n: number | null | undefined) => ARS.format(Number(n) || 0)
export const round2 = (n: number) => Math.round(n * 100) / 100

/** = formatDateAR de la web: fecha (DATE o timestamp) en el día calendario de Argentina. */
export function formatDateAR(f: string | null | undefined): string {
  if (!f) return ""
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(f) ? `${f}T12:00:00Z` : f)
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })
}
/** Fecha de un viaje ("lunes, 23 de septiembre"): la fecha es un DATE, sin corrimiento de huso. */
export function fechaViaje(f: string | null | undefined, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }): string {
  if (!f) return ""
  const d = new Date(`${f.slice(0, 10)}T12:00:00Z`)
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-AR", { ...opts, timeZone: "UTC" })
}
/** "23 sept, 14:30" de un timestamp (billetera, cobros). */
export const fechaHora = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "")

/** Marco de toda pantalla: encabezado del core + (opcional) frescura del dataset que se muestra. */
export function Pantalla({ titulo, atras = true, derecha, dataset, etiquetaFrescura, viejoTrasMin = 60, pie, children, fondo = "bg-gray-50" }: {
  titulo: string; atras?: boolean; derecha?: ReactNode; dataset?: string; etiquetaFrescura?: string; viejoTrasMin?: number; pie?: ReactNode; children: ReactNode; fondo?: string
}) {
  return (
    <div className={`flex h-dvh flex-col ${fondo} text-gray-900`}>
      <Encabezado titulo={titulo} atras={atras} derecha={derecha} />
      {dataset && <Frescura dataset={dataset} etiqueta={etiquetaFrescura} viejoTrasMin={viejoTrasMin} />}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
      {pie}
    </div>
  )
}

export function Vacio({ icono = "📭", children }: { icono?: string; children: ReactNode }) {
  return (
    <div className="px-5 py-14 text-center">
      <div className="mb-3 text-5xl">{icono}</div>
      <div className="font-medium text-gray-500">{children}</div>
    </div>
  )
}

/** Estado vacío de algo que solo existe con red. NUNCA un spinner infinito (MOBILE.md §9). */
export function NecesitaConexion({ que }: { que: string }) {
  return <Vacio icono="📡">Necesitás conexión para {que}.</Vacio>
}

/** Dato que todavía no se descargó en este equipo (primera vez, sin señal). */
export function SinDescargar({ que }: { que: string }) {
  const online = useOnline()
  return <Vacio icono={online ? "⏳" : "📡"}>{online ? `Descargando ${que}…` : `Todavía no se descargó ${que} en este equipo. Conectate una vez para tenerlo sin señal.`}</Vacio>
}

/** Guardado en el equipo y todavía sin enviar. Rechazado: rojo. */
export const SinEnviar = ({ texto = "sin enviar", rechazado = false }: { texto?: string; rechazado?: boolean }) => (
  <span className={`shrink-0 rounded-full border px-2 py-px text-[11px] font-extrabold ${rechazado ? "border-red-200 bg-red-50 text-red-700" : "border-amber-300 bg-amber-50 text-amber-800"}`}>⇪ {texto}</span>
)

/** Operaciones que el servidor rechazó, visibles donde importan, con el motivo y una salida clara. */
export function Rechazos({ items, ayuda, accion }: { items: ItemOutbox[]; ayuda?: string; accion?: (it: ItemOutbox) => ReactNode }) {
  const { outbox } = useRuntime()
  if (!items.length) return null
  return (
    <div className="border-b border-red-200 bg-red-50 px-4 py-3">
      <p className="font-extrabold text-red-700">⚠ {items.length === 1 ? "Una operación no se aplicó" : `${items.length} operaciones no se aplicaron`}</p>
      {items.map((it) => (
        <div key={it.key} className="mt-2 rounded-xl border border-red-200 bg-white p-3">
          <p className="text-sm font-bold text-gray-900">{it.etiqueta || it.tipo}</p>
          <p className="mt-0.5 text-sm text-red-700">{it.error}</p>
          <div className="mt-2 flex gap-2">
            {accion?.(it)}
            <button onClick={() => void outbox.descartar(it.key)} className="min-h-11 rounded-lg border border-gray-300 bg-gray-50 px-4 text-sm font-bold text-gray-800">Entendido</button>
          </div>
        </div>
      ))}
      {ayuda && <p className="mt-2 text-[13px] text-gray-500">{ayuda}</p>}
    </div>
  )
}

// ─── Avisos del BCRA (cheques) ───────────────────────────────────────────────
// La consulta a la Central de Deudores va por el outbox (`bcra.consultar`, encolada
// justo después del cobro) y contesta cuando puede: el cobro cerró sin esperarla.
// Acá se muestra el veredicto apenas llega (en el inicio, la ficha y el cobro), hasta
// que el chofer lo marca como visto. Lo visto se recuerda en el equipo.

const CLAVE_BCRA_VISTOS = "gm.chofer.bcra.vistos"
function leerVistos(): string[] {
  try { return JSON.parse(localStorage.getItem(CLAVE_BCRA_VISTOS) || "[]") } catch { return [] }
}
function guardarVistos(v: string[]) {
  try { localStorage.setItem(CLAVE_BCRA_VISTOS, JSON.stringify(v.slice(-200))) } catch { /* noop */ }
}

// Cheques registrados SIN CUIT válido: no hubo consulta, pero tampoco puede pasar en silencio.
const CLAVE_SIN_CUIT = "gm.chofer.bcra.sincuit"
type AvisoLocal = { key: string; resultado: ConsultaBcraResultado }
const oyentesSinCuit = new Set<() => void>()
function leerSinCuit(): AvisoLocal[] {
  try { return JSON.parse(localStorage.getItem(CLAVE_SIN_CUIT) || "[]") } catch { return [] }
}
function guardarSinCuit(v: AvisoLocal[]) {
  try { localStorage.setItem(CLAVE_SIN_CUIT, JSON.stringify(v.slice(-50))) } catch { /* noop */ }
  for (const fn of oyentesSinCuit) fn()
}
export function dejarAvisoSinCuit(cheque: ConsultaBcraResultado["cheque"], leido?: string | null) {
  guardarSinCuit([...leerSinCuit(), { key: `sincuit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, resultado: resultadoSinCuit(cheque, leido) }])
}

export function useAvisosBcra() {
  const items = useItemsOutbox()
  const [vistos, setVistos] = useState<string[]>(leerVistos)
  const [locales, setLocales] = useState<AvisoLocal[]>(leerSinCuit)
  useEffect(() => {
    const fn = () => setLocales(leerSinCuit())
    oyentesSinCuit.add(fn)
    return () => void oyentesSinCuit.delete(fn)
  }, [])
  const avisos = useMemo(
    () => [
      ...locales.map((a) => ({ ...a, item: null as ItemOutbox | null })),
      ...avisosBcraPendientes(items, vistos).map((a) => ({ ...a, item: (items.find((i) => i.key === a.key) ?? null) as ItemOutbox | null })),
    ],
    [items, vistos, locales],
  )
  const marcarVisto = useCallback((key: string) => {
    if (key.startsWith("sincuit-")) {
      guardarSinCuit(leerSinCuit().filter((a) => a.key !== key))
      return
    }
    const v = [...leerVistos(), key]
    guardarVistos(v)
    setVistos(v)
  }, [])
  return { avisos, marcarVisto }
}

export function AvisosBcra() {
  const { avisos, marcarVisto } = useAvisosBcra()
  const { outbox } = useRuntime()
  if (!avisos.length) return null
  const cls: Record<string, string> = {
    apto: "border-green-300 bg-green-50 text-green-800",
    riesgo: "border-red-400 bg-red-50 text-red-800",
    sin_respuesta: "border-amber-300 bg-amber-50 text-amber-800",
    sin_cuit: "border-amber-400 bg-amber-50 text-amber-900",
  }
  return (
    <div className="space-y-2 px-4 pt-3">
      {avisos.map(({ key, resultado: r, item }) => (
        <div key={key} className={`rounded-xl border-2 px-3 py-2 text-sm ${cls[r.veredicto] || cls.sin_respuesta}`}>
          <p className="text-xs opacity-70">{[r.cheque.numero_cheque ? `Cheque ${r.cheque.numero_cheque}` : "Cheque", r.cheque.banco, r.cheque.cliente_nombre].filter(Boolean).join(" · ")}</p>
          <p className={r.veredicto === "riesgo" ? "font-extrabold" : "font-bold"}>{r.titulo}</p>
          {r.detalle.slice(0, 3).map((d, i) => (
            <p key={i} className="mt-0.5 text-xs opacity-80">{d}</p>
          ))}
          <div className="mt-2 flex gap-2">
            {r.veredicto === "sin_respuesta" && item && (
              <button
                onClick={() => {
                  void outbox.encolar({ tipo: "bcra.consultar", payload: item.payload, etiqueta: item.etiqueta ?? "BCRA" })
                  marcarVisto(key)
                }}
                className="min-h-11 rounded-lg bg-white/80 px-4 text-sm font-bold"
              >
                Reintentar
              </button>
            )}
            <button onClick={() => marcarVisto(key)} className="min-h-11 rounded-lg border border-current px-4 text-sm font-bold">Visto</button>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Volver a la pantalla anterior (misma decisión que el botón atrás físico y la flecha del encabezado). */
export function useVolver() {
  const navigate = useNavigate()
  const location = useLocation()
  return useCallback(
    (pasos = 1) => {
      const d = decidirAtras(location.pathname, indiceHistorial())
      if (d.accion === "back") navigate(-Math.min(pasos, indiceHistorial()))
      else if (d.accion === "padre") navigate(d.a, { replace: true })
    },
    [navigate, location.pathname],
  )
}

/**
 * Overlay con valor dinámico (?ver=parada:<id>): como useOverlay del core, pero el valor
 * lo decide quien abre. `valor` = lo que sigue al prefijo, o null si no está abierto.
 */
export function useOverlayDinamico(prefijo: string, param = "ver") {
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const actual = sp.get(param)
  const valor = actual && actual.startsWith(`${prefijo}:`) ? actual.slice(prefijo.length + 1) : null
  const abrir = useCallback(
    (v: string) => {
      const n = new URLSearchParams(location.search)
      n.set(param, `${prefijo}:${v}`)
      navigate({ pathname: location.pathname, search: `?${n}` }, { state: { overlay: true } })
    },
    [location.pathname, location.search, navigate, param, prefijo],
  )
  const cerrar = useCallback(() => {
    if (valor === null) return
    if ((location.state as { overlay?: boolean } | null)?.overlay) navigate(-1)
    else {
      const n = new URLSearchParams(location.search)
      n.delete(param)
      navigate({ pathname: location.pathname, search: n.size ? `?${n}` : "" }, { replace: true })
    }
  }, [valor, location.pathname, location.search, location.state, navigate, param])
  return { valor, abierto: valor !== null, abrir, cerrar }
}

/**
 * Texto de búsqueda: responde en el acto (estado local) y se guarda en la URL con un
 * retardo corto (replace, sin historial).
 */
export function useBusqueda(param = "q", retardoMs = 250): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams()
  const enUrl = sp.get(param) ?? ""
  const [valor, setValor] = useState(enUrl)
  const ultimoEscrito = useRef(enUrl)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (enUrl !== ultimoEscrito.current) { ultimoEscrito.current = enUrl; setValor(enUrl) }
  }, [enUrl])
  useEffect(() => () => clearTimeout(timer.current), [])
  const cambiar = useCallback(
    (v: string) => {
      setValor(v)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        ultimoEscrito.current = v
        setSp((prev) => { const n = new URLSearchParams(prev); if (v) n.set(param, v); else n.delete(param); return n }, { replace: true, preventScrollReset: true })
      }, retardoMs)
    },
    [param, retardoMs, setSp],
  )
  return [valor, cambiar]
}

// ─── Toast ───────────────────────────────────────────────────────────────────

export function useToast() {
  const [toast, setToast] = useState<{ msg: string; tipo: "ok" | "err" } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mostrar = useCallback((msg: string, tipo: "ok" | "err" = "ok") => {
    clearTimeout(timer.current)
    setToast({ msg, tipo })
    timer.current = setTimeout(() => setToast(null), 3500)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  const nodo = toast ? (
    <div className={`fixed left-1/2 top-[72px] z-[300] max-w-[92vw] -translate-x-1/2 rounded-2xl px-5 py-3 text-center text-[15px] font-semibold text-white shadow-lg ${toast.tipo === "ok" ? "bg-green-600" : "bg-red-600"}`}>
      {toast.msg}
    </div>
  ) : null
  return { toast: nodo, mostrar }
}

/** Aviso que sobrevive a un cambio de pantalla ("Cobro registrado" → se ve en la ficha). */
const CLAVE_AVISO = "gm.chofer.aviso"
export function dejarAviso(msg: string) {
  try { sessionStorage.setItem(CLAVE_AVISO, msg) } catch { /* noop */ }
}
export function useAvisoEntrante(mostrar: (m: string, t?: "ok" | "err") => void) {
  useEffect(() => {
    try {
      const m = sessionStorage.getItem(CLAVE_AVISO)
      if (m) { sessionStorage.removeItem(CLAVE_AVISO); mostrar(m, "ok") }
    } catch { /* noop */ }
  }, [mostrar])
}

// ─── Confirmación (reemplaza a confirm() de la web: es una hoja con historial) ─

export function HojaConfirmar({ abierta, onCerrar, titulo, children, confirmar, onConfirmar, peligro, ocupado }: {
  abierta: boolean; onCerrar: () => void; titulo: string; children?: ReactNode; confirmar: string; onConfirmar: () => void; peligro?: boolean; ocupado?: boolean
}) {
  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo={titulo}>
      {children && <div className="mb-4 text-[15px] text-gray-600">{children}</div>}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onCerrar} className="min-h-12 rounded-xl border border-gray-300 bg-white font-bold text-gray-700">Cancelar</button>
        <button onClick={onConfirmar} disabled={ocupado} className={`min-h-12 rounded-xl font-bold text-white disabled:opacity-50 ${peligro ? "bg-red-600" : "bg-blue-600"}`}>{ocupado ? "Guardando…" : confirmar}</button>
      </div>
    </Hoja>
  )
}

/**
 * Salir de una pantalla con datos a medio cargar (cobro, devolución) pide confirmación:
 * bloquea la navegación (incluido el botón ATRÁS físico, que en la app es history.back)
 * y muestra la hoja "¿Descartar?". `sucio` = hay algo que se perdería.
 */
export function useBloqueoSalida(sucio: boolean, textos: { titulo: string; detalle: string; confirmar: string }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => sucio && currentLocation.pathname !== nextLocation.pathname)
  const bloqueado = blocker.state === "blocked"
  const hoja = (
    <Hoja abierta={bloqueado} onCerrar={() => blocker.reset?.()} titulo={textos.titulo}>
      <div className="mb-4 text-[15px] text-gray-600">{textos.detalle}</div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => blocker.reset?.()} className="min-h-12 rounded-xl border border-gray-300 bg-white font-bold text-gray-700">Seguir acá</button>
        <button onClick={() => blocker.proceed?.()} className="min-h-12 rounded-xl bg-red-600 font-bold text-white">{textos.confirmar}</button>
      </div>
    </Hoja>
  )
  return { hoja, bloqueado }
}

// ─── Campos ──────────────────────────────────────────────────────────────────

// ─── Fecha dd/mm/aaaa (= DateInputAR de la web) ───────────────────────────────

/** Fecha de un cheque como la tipea y lee todo el sistema: dd/mm/aaaa. `valor` y `onCambio` en ISO (aaaa-mm-dd o ""). */
export function FechaInput({ valor, onCambio, className = "", placeholder = "DD/MM/AAAA" }: { valor: string; onCambio: (iso: string) => void; className?: string; placeholder?: string }) {
  const [texto, setTexto] = useState(() => fechaIsoAAR(valor))
  const emitido = useRef(valor)
  // Cambio que vino de AFUERA (el OCR completó la fecha): adoptar. Lo propio no se pisa a medio tipear.
  useEffect(() => {
    if (valor !== emitido.current) { emitido.current = valor; setTexto(fechaIsoAAR(valor)) }
  }, [valor])
  return (
    <input
      type="text" inputMode="numeric" placeholder={placeholder} maxLength={10} value={texto}
      onChange={(e) => { const f = autoFormatoFechaAR(e.target.value); setTexto(f); const iso = fechaARAIso(f); emitido.current = iso; onCambio(iso) }}
      className={className}
    />
  )
}


/** Monto en pesos: acepta coma o punto; confirma al salir o con Enter. */
export function MontoInput({ valor, onCambio, className = "", placeholder = "0" }: { valor: number; onCambio: (n: number) => void; className?: string; placeholder?: string }) {
  const [texto, setTexto] = useState(valor ? String(valor) : "")
  const editando = useRef(false)
  useEffect(() => {
    if (!editando.current) setTexto(valor ? String(valor) : "")
  }, [valor])
  const confirmar = () => {
    editando.current = false
    onCambio(Math.max(0, parseFloat(texto.replace(",", ".")) || 0))
  }
  return (
    <input
      value={texto}
      inputMode="decimal"
      placeholder={placeholder}
      onFocus={() => (editando.current = true)}
      onChange={(e) => setTexto(e.target.value.replace(/[^\d.,]/g, ""))}
      onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
      className={className}
    />
  )
}

/** Enter en un input cierra el teclado. Se instala una vez en el inicio de la app. */
export function useEnterCierraTeclado() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.target.blur()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}

/** Abrir un PDF del ERP (remito): la web redirige a una URL firmada del bucket; se resuelve con la sesión del equipo y se abre FUERA de la app. Online-only. */
export function useAbrirPdf(mostrar: (m: string, t?: "ok" | "err") => void) {
  const rt = useRuntime()
  return useCallback(
    async (ruta: string) => {
      try {
        const token = await rt.auth.accessToken()
        const ctrl = new AbortController()
        const res = await fetch(`${rt.api.base}${ruta}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal })
        const url = res.url
        ctrl.abort()
        if (!res.ok || !url || url.startsWith(rt.api.base)) throw new Error()
        window.open(url, "_blank")
      } catch {
        mostrar("No se pudo abrir el PDF. Probá de nuevo con buena señal.", "err")
      }
    },
    [rt, mostrar],
  )
}

export const ESTADO_PARADA: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "PENDIENTE", cls: "bg-gray-200 text-gray-700" },
  entregado: { label: "ENTREGADO", cls: "bg-green-600 text-white" },
  entregado_parcial: { label: "PARCIAL", cls: "bg-amber-500 text-white" },
  no_entregado: { label: "NO ENTREGADO", cls: "bg-red-600 text-white" },
  solo_cobro: { label: "COBRADO", cls: "bg-blue-600 text-white" },
}

export function Linea({ etiqueta, valor, fuerte, rojo }: { etiqueta: string; valor: string; fuerte?: boolean; rojo?: boolean }) {
  return (
    <div className={`flex justify-between ${fuerte ? "text-base font-bold" : ""}`}>
      <span className="text-gray-500">{etiqueta}</span>
      <span className={rojo ? "font-bold text-red-600" : "font-bold"}>{valor}</span>
    </div>
  )
}

export function Botones({ ocupado, onCancelar, onConfirmar, texto, naranja }: { ocupado: boolean; onCancelar: () => void; onConfirmar: () => void; texto: string; naranja?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button onClick={onCancelar} className="min-h-12 rounded-2xl border-2 border-gray-300 py-3 font-bold text-gray-600 active:scale-95">Cancelar</button>
      <button onClick={onConfirmar} disabled={ocupado} className={`min-h-12 rounded-2xl py-3 font-bold text-white active:scale-95 disabled:opacity-50 ${naranja ? "bg-orange-500" : "bg-blue-600"}`}>
        {ocupado ? "Guardando…" : texto}
      </button>
    </div>
  )
}
