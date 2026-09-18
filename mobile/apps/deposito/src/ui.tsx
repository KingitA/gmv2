import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { useLocation, useNavigate } from "react-router"
import { decidirAtras, indiceHistorial, useRuntime, type ItemOutbox } from "@gm/core"
import { Encabezado, Frescura } from "@gm/core/ui"
import { AvisoUrgente } from "./pantallas/AvisoUrgente"

// Paleta y medidas del módulo web /deposito (réplica fiel: los operarios ya la conocen)
export const C = {
  bg: "#f4f6f9", white: "#ffffff", border: "#e5e7eb",
  text: "#111827", sub: "#6b7280", light: "#9ca3af",
  orange: "#ea580c", orangeL: "#fff7ed", orangeB: "#fed7aa",
  green: "#16a34a", greenL: "#f0fdf4", greenB: "#bbf7d0",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  yellow: "#d97706", yellowL: "#fffbeb", yellowB: "#fde68a",
  purple: "#9333ea", purpleL: "#faf5ff", purpleB: "#e9d5ff",
  indigo: "#4338ca", indigoL: "#eef2ff", indigoB: "#c7d2fe",
}

/** Marco de toda pantalla: encabezado del core (atrás, red, pendientes) + frescura + contenido. */
export function Marco({ titulo, atras = true, dataset, derecha, children }: { titulo: string; atras?: boolean; dataset?: string; derecha?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: C.bg, color: C.text }}>
      <Encabezado titulo={titulo} atras={atras} derecha={derecha} />
      {dataset && <Frescura dataset={dataset} viejoTrasMin={10} />}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto", position: "relative" }}>{children}</div>
      <AvisoUrgente />
    </div>
  )
}

// ─── Toast ───────────────────────────────────────────────────────────────────

export function useToast() {
  const [toast, setToast] = useState<{ msg: string; tipo: "ok" | "err" } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mostrar = useCallback((msg: string, tipo: "ok" | "err" = "ok") => {
    clearTimeout(timer.current)
    setToast({ msg, tipo })
    timer.current = setTimeout(() => setToast(null), 3000)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  const nodo = toast ? (
    <div style={{ position: "fixed", top: 72, left: "50%", transform: "translateX(-50%)", background: toast.tipo === "ok" ? C.green : C.red, color: "#fff", padding: "11px 22px", borderRadius: 14, fontSize: 15, fontWeight: 600, zIndex: 300, maxWidth: "92vw", textAlign: "center", boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}>
      {toast.msg}
    </div>
  ) : null
  return { toast: nodo, mostrar }
}

/** Toast que sobrevive a un cambio de pantalla (confirmar en la pantalla de cantidad → aviso en la lista). */
const CLAVE_AVISO = "gm.deposito.aviso"
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

// ─── Tarjeta con swipe (deslizar ← revela la acción; tocar la confirma) ──────

export function TarjetaSwipe({ children, bg, borde, accion, bloqueado }: {
  children: ReactNode; bg: string; borde: string; bloqueado?: boolean
  accion: { fondo: string; icono: string; etiqueta: string; onConfirmar: () => void }
}) {
  const [dx, setDx] = useState(0)
  const [revelado, setRevelado] = useState(false)
  const inicio = useRef(0)
  const UMBRAL = 72
  const cerrar = () => { setRevelado(false); setDx(0) }
  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, marginBottom: 8 }}>
      <button
        onClick={() => { accion.onConfirmar(); cerrar() }}
        style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: UMBRAL, background: accion.fondo, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "none", borderRadius: "0 16px 16px 0", gap: 2 }}
      >
        <span style={{ color: "#fff", fontSize: 22, fontWeight: 700 }}>{accion.icono}</span>
        <span style={{ color: "#fff", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>{accion.etiqueta}</span>
      </button>
      <div
        onClick={() => revelado && cerrar()}
        onTouchStart={(e) => { if (!revelado && !bloqueado) inicio.current = e.touches[0]!.clientX }}
        onTouchMove={(e) => {
          if (revelado || bloqueado) return
          const d = inicio.current - e.touches[0]!.clientX
          setDx(d > 0 ? Math.min(d, UMBRAL + 10) : 0)
        }}
        onTouchEnd={() => { if (dx >= UMBRAL) { setRevelado(true); setDx(UMBRAL) } else cerrar() }}
        style={{ position: "relative", background: bg, border: `1.5px solid ${borde}`, borderRadius: 16, padding: "20px 16px", display: "flex", alignItems: "center", gap: 14, transform: `translateX(-${revelado ? UMBRAL : dx}px)` }}
      >
        {children}
      </div>
    </div>
  )
}

// ─── Piezas comunes de picking y recepción ───────────────────────────────────

export function BarraProgreso({ resueltos, total, pendientes, ok, faltantes }: { resueltos: number; total: number; pendientes: number; ok: number; faltantes: number }) {
  const pct = total > 0 ? Math.round((resueltos / total) * 100) : 0
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.sub, marginBottom: 6 }}>
        <span><span style={{ color: C.green, fontWeight: 700 }}>{resueltos}</span> de {total} resueltos</span>
        <span style={{ fontWeight: 800, color: pct === 100 ? C.green : C.text, fontSize: 14 }}>{pct}%</span>
      </div>
      <div style={{ background: C.border, borderRadius: 999, height: 8 }}>
        <div style={{ height: "100%", background: pct === 100 ? C.green : C.orange, borderRadius: 999, width: `${pct}%` }} />
      </div>
      <Contadores pendientes={pendientes} ok={ok} faltantes={faltantes} estilo={{ marginTop: 7, fontSize: 13, gap: 18 }} />
    </div>
  )
}

export function Contadores({ pendientes, ok, faltantes, estilo }: { pendientes: number; ok: number; faltantes: number; estilo?: CSSProperties }) {
  return (
    <div style={{ display: "flex", gap: 16, fontSize: 14, ...estilo }}>
      <span style={{ color: C.yellow, fontWeight: 700 }}>⏳ {pendientes}</span>
      <span style={{ color: C.green, fontWeight: 700 }}>✓ {ok}</span>
      {faltantes > 0 && <span style={{ color: C.red, fontWeight: 700 }}>✕ {faltantes}</span>}
    </div>
  )
}

/** Etiqueta "sin enviar" de un renglón guardado en el equipo que todavía no llegó al servidor. */
export const SinEnviar = () => (
  <span style={{ background: C.yellowL, color: C.yellow, border: `1px solid ${C.yellowB}`, fontSize: 11, fontWeight: 800, padding: "1px 7px", borderRadius: 999, flexShrink: 0 }}>⇪ sin enviar</span>
)

/** Operaciones que el servidor rechazó: visibles en la pantalla donde importan, con acción clara. */
export function Rechazos({ items, ayuda }: { items: ItemOutbox[]; ayuda: string }) {
  const { outbox } = useRuntime()
  if (items.length === 0) return null
  return (
    <div style={{ background: C.redL, borderBottom: `1.5px solid ${C.redB}`, padding: "12px 16px" }}>
      <div style={{ color: C.red, fontWeight: 800, fontSize: 15 }}>⚠ {items.length === 1 ? "Un cambio no se aplicó" : `${items.length} cambios no se aplicaron`}</div>
      {items.map((it) => (
        <div key={it.key} style={{ marginTop: 8, background: C.white, border: `1px solid ${C.redB}`, borderRadius: 12, padding: "10px 12px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{it.etiqueta || it.tipo}</div>
          <div style={{ fontSize: 14, color: C.red, marginTop: 2 }}>{it.error}</div>
          <button onClick={() => void outbox.descartar(it.key)} style={{ marginTop: 8, minHeight: 44, padding: "0 16px", borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.bg, fontWeight: 700, fontSize: 14, color: C.text }}>
            Entendido
          </button>
        </div>
      ))}
      <div style={{ fontSize: 13, color: C.sub, marginTop: 8 }}>{ayuda}</div>
    </div>
  )
}

export function Vacio({ icono, children }: { icono: string; children: ReactNode }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>{icono}</div>
      <div style={{ color: C.sub, fontSize: 16, fontWeight: 600 }}>{children}</div>
    </div>
  )
}

export const botonPie: CSSProperties = { fontWeight: 700, fontSize: 16, padding: "17px 0", borderRadius: 16, minHeight: 56 }

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
 * Campo de texto a prueba del lector. El lector en modo teclado "tipea" el código
 * en el input que tenga foco (y si el texto estaba seleccionado, lo PISA). Este hook
 * recuerda el valor previo a cada ráfaga de teclas (< 80 ms entre cambios = lector,
 * no un dedo) para poder restaurarlo cuando el detector confirma que fue una lectura.
 * Encontrado en el NuStar: un segundo escaneo dejaba la cantidad en 0.
 */
export function useCampoSinRafaga(inicial: string, gapMs = 80) {
  const [valor, setValor] = useState(inicial)
  const ref = useRef({ actual: inicial, antesDeRafaga: inicial, ultimoCambio: 0 })
  const cambiar = useCallback((v: string) => {
    const r = ref.current
    const ahora = performance.now()
    if (ahora - r.ultimoCambio > gapMs) r.antesDeRafaga = r.actual // empieza una (posible) ráfaga
    r.ultimoCambio = ahora
    r.actual = v
    setValor(v)
  }, [gapMs])
  /** Llamar cuando el detector reporta una lectura: deshace lo que la ráfaga tipeó. Devuelve el valor restaurado. */
  const restaurar = useCallback(() => {
    const r = ref.current
    if (performance.now() - r.ultimoCambio < 400) {
      r.actual = r.antesDeRafaga
      setValor(r.antesDeRafaga)
    }
    return r.actual
  }, [])
  return { valor, cambiar, restaurar }
}
