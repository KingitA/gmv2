import { useState } from "react"
import { Link } from "react-router"
import { useContadoresOutbox, useOverlay, useRuntime } from "@gm/core"
import { Hoja } from "@gm/core/ui"
import { useBorradorCarga } from "../datos/borradorCarga"
import { useDevoluciones, usePedidos, useRecepciones, useYo } from "../datos/hooks"
import { C, Marco } from "../ui"

/** / — home del módulo, ordenado por uso (05/11: Preparar domina). Atrás acá minimiza la app. */
export function Inicio() {
  const yo = useYo()
  const rt = useRuntime()
  const c = useContadoresOutbox()
  const salir = useOverlay("salir")
  const [saliendo, setSaliendo] = useState(false)
  const { pedidos } = usePedidos()
  const { ordenes } = useRecepciones()
  const { devoluciones } = useDevoluciones()
  const { borrador } = useBorradorCarga()

  // Uso real del menú (Juan, 05/11): Preparar ≈ 90 %; Recibir y Devoluciones ≈ 3 % cada uno;
  // Modificar artículos y Cargar pedido ≈ 2 %. Preparar domina (grande, arriba, con la cola a
  // la vista); los dos secundarios iguales entre sí; los terciarios chicos abajo. Sin scroll.
  const cola = pedidos.filter((p) => !p.cierrePendiente)
  const urgentes = cola.filter((p) => p.prioridad === 1).length
  const enCurso = cola.filter((p) => p.progreso.resueltos > 0).length
  const nOrdenes = ordenes.filter((o) => !o.cierrePendiente).length

  const secundario = (to: string, icono: string, label: string, n: number, color: { bg: string; borde: string; acento: string }) => (
    <Link to={to} style={{ position: "relative", textDecoration: "none", background: color.bg, border: `1.5px solid ${color.borde}`, borderRadius: 20, padding: "16px 14px", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 130, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
      <div style={{ width: 42, height: 42, borderRadius: 13, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>{icono}</div>
      {n > 0 && <span style={{ position: "absolute", top: 14, right: 14, minWidth: 30, textAlign: "center", background: color.acento, color: "#fff", fontWeight: 800, fontSize: 15, borderRadius: 999, padding: "3px 9px" }}>{n}</span>}
      <div style={{ color: C.text, fontWeight: 800, fontSize: 16, lineHeight: 1.2, marginTop: 10 }}>{label}</div>
    </Link>
  )
  const terciario = (to: string, icono: string, label: string, nota?: string) => (
    <Link to={to} style={{ textDecoration: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "0 12px", minHeight: 58, display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 20 }}>{icono}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", color: C.text, fontWeight: 700, fontSize: 14, lineHeight: 1.15 }}>{label}</span>
        {nota && <span style={{ display: "block", color: C.orange, fontWeight: 700, fontSize: 11, marginTop: 2 }}>{nota}</span>}
      </span>
    </Link>
  )

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
      <div style={{ padding: "16px 16px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 19, fontWeight: 700, color: C.text }}>Hola, {yo.nombre} 👋</div>

        {/* PREPARAR PEDIDOS: lo que se usa casi siempre */}
        <Link to="/preparar" style={{ textDecoration: "none", background: C.orange, borderRadius: 24, padding: "20px 20px 18px", display: "flex", flexDirection: "column", gap: 14, minHeight: 260, justifyContent: "space-between", boxShadow: "0 4px 14px rgba(234,88,12,0.35)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 58, height: 58, borderRadius: 18, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, flexShrink: 0 }}>📦</div>
            <div style={{ flex: 1, color: "#fff", fontWeight: 900, fontSize: 25, lineHeight: 1.1, letterSpacing: "0.01em" }}>PREPARAR PEDIDOS</div>
            <span style={{ color: "#fff", fontSize: 34, fontWeight: 700, lineHeight: 1 }}>›</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
            <div>
              <div style={{ color: "#fff", fontWeight: 900, fontSize: 60, lineHeight: 1 }}>{cola.length}</div>
              <div style={{ color: "#ffedd5", fontSize: 15, fontWeight: 600, marginTop: 4 }}>{cola.length === 1 ? "pedido en la cola" : "pedidos en la cola"}</div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
              {urgentes > 0 && <span style={{ background: "#fff", color: C.red, fontWeight: 800, fontSize: 14, borderRadius: 999, padding: "4px 12px" }}>🔴 {urgentes} urgente{urgentes > 1 ? "s" : ""}</span>}
              {enCurso > 0 && <span style={{ background: "rgba(255,255,255,0.22)", color: "#fff", fontWeight: 700, fontSize: 13, borderRadius: 999, padding: "4px 12px" }}>{enCurso} empezado{enCurso > 1 ? "s" : ""}</span>}
            </div>
          </div>
        </Link>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {secundario("/recibir", "🚚", "Recibir mercadería", nOrdenes, { bg: C.greenL, borde: C.greenB, acento: C.green })}
          {secundario("/devoluciones", "↩️", "Devoluciones", devoluciones.length, { bg: C.purpleL, borde: C.purpleB, acento: C.purple })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {terciario("/articulos", "🔧", "Modificar artículos")}
          {terciario("/cargar", "🛒", "Cargar pedido", borrador ? `En curso · ${borrador.items.length} art.` : undefined)}
        </div>

        <div style={{ marginTop: 4, textAlign: "center", color: C.light, fontSize: 12 }}>GM Distribuidora · Depósito v{rt.config.version}</div>
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
