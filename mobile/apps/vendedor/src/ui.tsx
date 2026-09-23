import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"
import { decidirAtras, indiceHistorial, useOnline, useRuntime, type ItemOutbox } from "@gm/core"
import { Encabezado, Frescura, Hoja } from "@gm/core/ui"
import { CARTEL_PRECIOS_VENCIDOS } from "@gm/vendedor"

// UI compartida de la app Vendedor. Mismos textos, colores y jerarquía que el módulo
// web /vendedor (los viajantes ya lo conocen); lo único propio de la app es el
// encabezado del core (atrás · En línea/Sin red · contador ⇪) y la frescura del dato.

const ARS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" })
export const formatCurrency = (n: number | null | undefined) => ARS.format(Number(n) || 0)
export const round2 = (n: number) => Math.round(n * 100) / 100

/** "12 sept" — fecha YYYY-MM-DD sin corrimiento de huso (igual que fechaCorta de la web). */
export function fechaCorta(f: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  if (!f) return "—"
  const d = new Date(`${f.slice(0, 10)}T00:00:00`)
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-AR", opts)
}
export const fechaAR = (f: string | null | undefined) => fechaCorta(f, { day: "2-digit", month: "2-digit", year: "numeric" })

/** Marco de toda pantalla: encabezado del core + (opcional) frescura del dataset que se muestra. */
export function Pantalla({ titulo, atras = true, derecha, dataset, etiquetaFrescura, viejoTrasMin = 60, pie, children, fondo = "bg-gray-50", preciosVencidos = false }: {
  titulo: string; atras?: boolean; derecha?: ReactNode; dataset?: string; etiquetaFrescura?: string; viejoTrasMin?: number; pie?: ReactNode; children: ReactNode; fondo?: string
  /** Pantallas que muestran PRECIOS: cartel fijo si hace más de 24 hs que no se actualizan */
  preciosVencidos?: boolean
}) {
  return (
    <div className={`flex h-dvh flex-col ${fondo} text-gray-900`}>
      <Encabezado titulo={titulo} atras={atras} derecha={derecha} />
      <CartelPreciosVencidos visible={preciosVencidos} />
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

/** Cartel fijo (texto del dueño) cuando hace más de 24 hs que el equipo no actualiza precios. */
export function CartelPreciosVencidos({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <div role="alert" className="border-b-2 border-red-700 bg-red-600 px-3 py-2 text-center text-[13px] font-extrabold leading-snug text-white">
      ⚠ {CARTEL_PRECIOS_VENCIDOS}
    </div>
  )
}

/** Guardado en el equipo y todavía sin enviar: lavanda (Megasur: "sin sincronizar"). Rechazado: rojo. */
export const SinEnviar = ({ texto = "sin enviar", rechazado = false }: { texto?: string; rechazado?: boolean }) => (
  <span className={`shrink-0 rounded-full border px-2 py-px text-[11px] font-extrabold ${rechazado ? "border-red-200 bg-red-50 text-red-700" : "border-lavanda-200 bg-lavanda-50 text-lavanda-700"}`}>⇪ {texto}</span>
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
 * Texto de búsqueda: responde en el acto (estado local) y se guarda en la URL con un
 * retardo corto (replace, sin historial). Escribir cada tecla en la URL re-renderiza todo
 * el árbol de rutas: en el NuStar eso se siente. La URL sigue siendo la memoria del
 * buscador (volver de una ficha lo encuentra como estaba).
 */
export function useBusqueda(param = "q", retardoMs = 250): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams()
  const enUrl = sp.get(param) ?? ""
  const [valor, setValor] = useState(enUrl)
  const ultimoEscrito = useRef(enUrl)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Cambio que vino de AFUERA (otro componente navegó con ?q=…): adoptar
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
const CLAVE_AVISO = "gm.vendedor.aviso"
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

export function HojaConfirmar({ abierta, onCerrar, titulo, children, confirmar, onConfirmar, peligro }: {
  abierta: boolean; onCerrar: () => void; titulo: string; children?: ReactNode; confirmar: string; onConfirmar: () => void; peligro?: boolean
}) {
  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} titulo={titulo}>
      {children && <div className="mb-4 text-[15px] text-gray-600">{children}</div>}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onCerrar} className="min-h-12 rounded-xl border border-gray-300 bg-white font-bold text-gray-700">Cancelar</button>
        <button onClick={onConfirmar} className={`min-h-12 rounded-xl font-bold text-white ${peligro ? "bg-red-600" : "bg-emerald-600"}`}>{confirmar}</button>
      </div>
    </Hoja>
  )
}

// ─── Zoom de foto (?foto=<url>: entrada de historial, atrás lo cierra) ───────

export function useFotoZoom() {
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const src = sp.get("foto")
  const abrir = useCallback(
    (url: string | null | undefined) => {
      if (!url) return
      const n = new URLSearchParams(location.search)
      n.set("foto", url)
      navigate({ pathname: location.pathname, search: `?${n}` }, { state: { overlay: true } })
    },
    [location.pathname, location.search, navigate],
  )
  const cerrar = useCallback(() => {
    if ((location.state as { overlay?: boolean } | null)?.overlay) navigate(-1)
    else {
      const n = new URLSearchParams(location.search)
      n.delete("foto")
      navigate({ pathname: location.pathname, search: n.size ? `?${n}` : "" }, { replace: true })
    }
  }, [location.pathname, location.search, location.state, navigate])
  return { src, abrir, cerrar }
}

/** Foto a pantalla completa: pellizco 1–5×, doble toque 1 ↔ 2,5×, arrastre con zoom, toque afuera cierra. */
export function ZoomFoto({ src, alt, onCerrar }: { src: string; alt?: string; onCerrar: () => void }) {
  const [t, setT] = useState({ escala: 1, x: 0, y: 0 })
  const gesto = useRef<{ dist: number; escala: number; x: number; y: number; px: number; py: number; ultimoTap: number }>({ dist: 0, escala: 1, x: 0, y: 0, px: 0, py: 0, ultimoTap: 0 })
  const dist = (e: React.TouchEvent) => Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY)
  return (
    <div
      className="fixed inset-0 z-[60] flex touch-none items-center justify-center bg-black/90"
      onClick={() => t.escala <= 1.02 && onCerrar()}
      onTouchStart={(e) => {
        const g = gesto.current
        if (e.touches.length === 2) Object.assign(g, { dist: dist(e), escala: t.escala })
        else Object.assign(g, { px: e.touches[0]!.clientX, py: e.touches[0]!.clientY, x: t.x, y: t.y })
      }}
      onTouchMove={(e) => {
        const g = gesto.current
        if (e.touches.length === 2 && g.dist > 0) setT((p) => ({ ...p, escala: Math.min(5, Math.max(1, (g.escala * dist(e)) / g.dist)) }))
        else if (e.touches.length === 1 && t.escala > 1) setT((p) => ({ ...p, x: g.x + e.touches[0]!.clientX - g.px, y: g.y + e.touches[0]!.clientY - g.py }))
      }}
      onTouchEnd={(e) => {
        const g = gesto.current
        if (t.escala <= 1.02) setT({ escala: 1, x: 0, y: 0 })
        if (e.touches.length === 0 && e.changedTouches.length === 1) {
          const ahora = Date.now()
          if (ahora - g.ultimoTap < 300) {
            e.preventDefault()
            setT((p) => (p.escala > 1 ? { escala: 1, x: 0, y: 0 } : { escala: 2.5, x: 0, y: 0 }))
            g.ultimoTap = 0
          } else g.ultimoTap = ahora
        }
      }}
    >
      <img src={src} alt={alt || ""} className="max-h-full max-w-full object-contain" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.escala})` }} onClick={(e) => t.escala > 1.02 && e.stopPropagation()} />
      <button onClick={onCerrar} aria-label="Cerrar" className="absolute right-3 top-3 h-11 w-11 rounded-full bg-white/15 text-2xl leading-none text-white">×</button>
    </div>
  )
}

// ─── Campos ──────────────────────────────────────────────────────────────────

/** Monto en pesos: acepta coma o punto; confirma al salir o con Enter (= MontoInput de la web). */
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

/** Enter en un input cierra el teclado (= <EnterBlur/> del layout web). Se instala una vez en el inicio de la app. */
export function useEnterCierraTeclado() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.target.blur()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}

// ─── Estados de pedido (una sola tabla: en la web había tres copias distintas) ─

export const ESTADO_BADGE: Record<string, string> = {
  // Chips Megasur: fondo tono 50 + texto tono 700/800 + punto de color
  en_venta: "bg-neutro-100 text-neutro-700",
  pendiente: "bg-alerta-50 text-alerta-700",
  impreso: "bg-azul-50 text-azul-700",
  en_preparacion: "bg-azul-50 text-azul-700",
  en_viaje: "bg-azul-100 text-azul-800",
  confirmado: "bg-azul-50 text-azul-700",
  facturado: "bg-cian-50 text-cian-800",
  entregado: "bg-exito-50 text-exito-700",
  cancelado: "bg-error-50 text-error-700",
}
const ESTADO_TEXTO: Record<string, string> = { en_venta: "EN VENTA", pendiente: "PENDIENTE", impreso: "IMPRESO", en_preparacion: "EN PREPARACIÓN", en_viaje: "EN VIAJE" }
export const estadoTexto = (e: string) => ESTADO_TEXTO[e] || e.toUpperCase()
export function BadgeEstado({ estado }: { estado: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${ESTADO_BADGE[estado] || "bg-gray-100 text-gray-700"}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {estadoTexto(estado)}
    </span>
  )
}
