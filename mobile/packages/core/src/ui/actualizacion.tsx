import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react"
import { useRuntime } from "../react/contexto"

// Franja "Hay una versión nueva — TOCÁ ACTUALIZAR" (17/11/2026). Va SOLO en la pantalla de
// inicio de cada app: nunca en medio de un pedido, un cobro o un picking. Pensada para
// gente grande en la calle: letra grande, un solo botón por paso, sin texto técnico.
// Estilos en línea: la usan las tres apps (depósito no usa las clases de Tailwind).
// Ver MOBILE.md → "Actualización desde la app".

const azul = "#1d4ed8"
const caja: CSSProperties = { borderRadius: 20, padding: "18px 16px", border: "2px solid #f59e0b", background: "#fffbeb", boxShadow: "0 2px 10px rgba(0,0,0,0.08)" }
const titulo: CSSProperties = { margin: 0, fontSize: 21, fontWeight: 800, lineHeight: 1.25, color: "#78350f" }
const texto: CSSProperties = { margin: "8px 0 0", fontSize: 17, lineHeight: 1.35, color: "#451a03" }
const boton: CSSProperties = { marginTop: 14, width: "100%", minHeight: 64, border: "none", borderRadius: 16, background: azul, color: "#fff", fontSize: 22, fontWeight: 800, letterSpacing: 0.5 }

function Boton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={boton}>{children}</button>
}

const mb = (bytes: number | null | undefined) => (bytes ? `${Math.max(1, Math.round(bytes / 1_048_576))} MB` : "")

export function FranjaActualizacion() {
  const { actualizacion: a } = useRuntime()
  const e = useSyncExternalStore(a.suscribir, () => a.estado)
  if (e.fase === "nada" || !e.info?.hay) return null
  if (e.pospuesta && e.fase === "disponible") return null
  const version = e.info.version_name ? ` (v${e.info.version_name})` : ""

  if (e.fase === "permiso") {
    return (
      <div style={caja} role="alert">
        <p style={titulo}>Falta un permiso (una sola vez)</p>
        <p style={texto}>Se abre una pantalla de Android. Tocá <b>PERMITIR</b> y después volvé a esta app con la flecha de atrás.</p>
        <Boton onClick={() => void a.abrirPermiso()}>PERMITIR</Boton>
      </div>
    )
  }

  if (e.fase === "bajando") {
    const pct = e.progreso == null ? null : Math.round(e.progreso * 100)
    return (
      <div style={caja} role="status">
        <p style={titulo}>Bajando la versión nueva{version}…</p>
        <div style={{ marginTop: 14, height: 22, borderRadius: 11, background: "#fde68a", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct ?? 30}%`, background: azul, transition: "width 0.3s" }} />
        </div>
        <p style={{ ...texto, fontWeight: 700 }}>{pct == null ? "Esperá un momento" : `${pct} %`} · no cierres la app</p>
      </div>
    )
  }

  if (e.fase === "instalando") {
    return (
      <div style={caja} role="status">
        <p style={titulo}>Tocá INSTALAR en el cartel de Android</p>
        <p style={texto}>Cuando termine, abrí la app de nuevo. Tus datos y lo que no se envió quedan guardados.</p>
        <Boton onClick={() => void a.actualizar()}>VOLVER A INTENTAR</Boton>
      </div>
    )
  }

  if (e.fase === "error") {
    return (
      <div style={{ ...caja, borderColor: "#dc2626", background: "#fef2f2" }} role="alert">
        <p style={{ ...titulo, color: "#7f1d1d" }}>{e.error}</p>
        <Boton onClick={() => void a.actualizar()}>PROBAR DE NUEVO</Boton>
      </div>
    )
  }

  // disponible
  return (
    <div style={caja} role="alert">
      <p style={titulo}>Hay una versión nueva — TOCÁ ACTUALIZAR</p>
      <p style={texto}>
        {e.info.obligatoria ? "Es necesaria para seguir trabajando." : "Tarda un minuto."} {mb(e.info.tamano_bytes) && `Pesa ${mb(e.info.tamano_bytes)}.`}
      </p>
      {e.info.notas && <p style={{ ...texto, fontSize: 15 }}>{e.info.notas}</p>}
      <Boton onClick={() => void a.actualizar()}>ACTUALIZAR{version}</Boton>
      {!e.info.obligatoria && (
        <button type="button" onClick={() => a.posponer()} style={{ marginTop: 10, width: "100%", minHeight: 48, border: "none", background: "transparent", color: "#92400e", fontSize: 16, fontWeight: 700 }}>
          Más tarde
        </button>
      )}
    </div>
  )
}
