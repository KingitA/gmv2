import { useState, useSyncExternalStore, type CSSProperties } from "react"
import { useRuntime } from "../react/contexto"

// Permiso de avisos para "hacer sonar un equipo perdido" (20/11/2026). Va en el inicio de
// las tres apps: si Android todavía no dejó avisar, lo explica en simple y pide permiso.
// "Ahora no" lo esconde hasta que se vuelva a abrir la app. Estilos en línea (depósito
// no usa las clases de Tailwind). MOBILE.md → "Hacer sonar un equipo".

const caja: CSSProperties = { borderRadius: 20, padding: "16px 16px", border: "2px solid #93c5fd", background: "#eff6ff", boxShadow: "0 2px 10px rgba(0,0,0,0.06)" }
let pospuesto = false

export function AvisoPermisoAvisos() {
  const { alarma } = useRuntime()
  const permiso = useSyncExternalStore(alarma.suscribir, () => alarma.permiso)
  const [, setOculto] = useState(0)
  if (permiso !== false || pospuesto) return null
  return (
    <div style={caja} role="alert">
      <p style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#1e3a8a", lineHeight: 1.25 }}>🔔 Para encontrar este equipo si se pierde</p>
      <p style={{ margin: "8px 0 0", fontSize: 16, color: "#1e293b", lineHeight: 1.35 }}>
        La oficina lo puede hacer sonar. Para eso Android tiene que dejar que la app avise. Tocá <b>PERMITIR</b>.
      </p>
      <button type="button" onClick={() => void alarma.pedirPermiso()}
        style={{ marginTop: 12, width: "100%", minHeight: 56, border: "none", borderRadius: 14, background: "#1d4ed8", color: "#fff", fontSize: 20, fontWeight: 800 }}>
        PERMITIR
      </button>
      <button type="button" onClick={() => { pospuesto = true; setOculto((n) => n + 1) }}
        style={{ marginTop: 6, width: "100%", minHeight: 44, border: "none", background: "transparent", color: "#1e40af", fontSize: 15, fontWeight: 700 }}>
        Ahora no
      </button>
    </div>
  )
}
