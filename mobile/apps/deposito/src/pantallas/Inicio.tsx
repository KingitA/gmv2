import { useState } from "react"
import { Link } from "react-router"
import { useContadoresOutbox, useOverlay, useRuntime } from "@gm/core"
import { Hoja } from "@gm/core/ui"
import { useDevoluciones, usePedidos, useRecepciones, useYo } from "../datos/hooks"
import { C, Marco } from "../ui"

/** / — home del módulo (misma grilla que /deposito en la web). Atrás acá minimiza la app. */
export function Inicio() {
  const yo = useYo()
  const rt = useRuntime()
  const c = useContadoresOutbox()
  const salir = useOverlay("salir")
  const [saliendo, setSaliendo] = useState(false)
  const { pedidos } = usePedidos()
  const { ordenes } = useRecepciones()
  const { devoluciones } = useDevoluciones()

  const MODULOS = [
    { to: "/preparar", label: "Preparar Pedidos", icon: "📦", desc: "Picking de órdenes de venta", bg: C.orangeL, accent: C.orange, border: C.orangeB, n: pedidos.filter((p) => !p.cierrePendiente).length },
    { to: "/recibir", label: "Recibir Mercadería", icon: "🚚", desc: "Recepción contra OC", bg: C.greenL, accent: C.green, border: C.greenB, n: ordenes.filter((o) => !o.cierrePendiente).length },
    { to: "/articulos", label: "Modificación de Artículos", icon: "🔧", desc: "Datos y stock de artículos", bg: C.yellowL, accent: C.yellow, border: C.yellowB, n: 0 },
    { to: "/devoluciones", label: "Devoluciones", icon: "↩️", desc: "Recibir devoluciones", bg: C.purpleL, accent: C.purple, border: C.purpleB, n: devoluciones.length },
  ]

  return (
    <Marco
      titulo="Depósito"
      atras={false}
      derecha={
        <button onClick={salir.abrir} aria-label="Cambiar de usuario" className="mr-1 flex h-11 w-11 items-center justify-center rounded-full active:bg-white/20">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
        </button>
      }
    >
      <div style={{ padding: "24px 16px" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Hola, {yo.nombre} 👋</div>
          <div style={{ color: C.sub, fontSize: 14, marginTop: 2 }}>¿Qué vas a hacer hoy?</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {MODULOS.map((m) => (
            <Link key={m.to} to={m.to} style={{ position: "relative", textDecoration: "none", background: m.bg, borderRadius: 20, padding: "20px 16px", display: "flex", flexDirection: "column", gap: 12, border: `1px solid ${m.border}`, minHeight: 140, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>{m.icon}</div>
              {m.n > 0 && (
                <span style={{ position: "absolute", top: 14, right: 14, minWidth: 30, textAlign: "center", background: m.accent, color: "#fff", fontWeight: 800, fontSize: 15, borderRadius: 999, padding: "3px 9px" }}>{m.n}</span>
              )}
              <div>
                <div style={{ color: C.text, fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{m.label}</div>
                <div style={{ color: C.sub, fontSize: 12, marginTop: 3 }}>{m.desc}</div>
              </div>
            </Link>
          ))}
        </div>
        <div style={{ marginTop: 28, textAlign: "center", color: C.light, fontSize: 12 }}>GM Distribuidora · Depósito v{rt.config.version}</div>
      </div>

      <Hoja abierta={salir.abierto} onCerrar={salir.cerrar} titulo="Cambiar de usuario">
        <p style={{ fontSize: 15, color: C.sub, lineHeight: 1.45, margin: "0 0 16px" }}>
          Sale <b style={{ color: C.text }}>{yo.nombre}</b> para que ingrese otro operario.
          {c.pendientes > 0 && (
            <>
              {" "}Hay <b style={{ color: C.yellow }}>{c.pendientes} {c.pendientes > 1 ? "operaciones" : "operación"} sin enviar</b>: quedan guardadas en el equipo y se envían solas,
              a nombre de quien las hizo, apenas haya señal. No se pierde nada.
            </>
          )}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
          <button onClick={salir.cerrar} style={{ background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "16px 0", borderRadius: 16, border: `1.5px solid ${C.border}` }}>Cancelar</button>
          <button
            disabled={saliendo}
            onClick={async () => {
              setSaliendo(true)
              salir.cerrar() // el próximo operario arranca en el inicio, sin esta hoja abierta
              try { await rt.cambiarUsuario() } finally { setSaliendo(false) }
            }}
            style={{ background: C.text, color: "#fff", fontWeight: 800, fontSize: 16, padding: "16px 0", borderRadius: 16, border: "none", opacity: saliendo ? 0.6 : 1 }}
          >
            {saliendo ? "Saliendo…" : "Cambiar de usuario"}
          </button>
        </div>
      </Hoja>
    </Marco>
  )
}
