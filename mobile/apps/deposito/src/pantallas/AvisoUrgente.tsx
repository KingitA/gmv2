import { useEffect } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"
import { useDataset } from "@gm/core"
import { DS, type PedidoDeposito } from "../datasets"

// Aviso de PEDIDO URGENTE, en cualquier pantalla (en la web: UrgentOrderNotification
// + el modal del listado, ambos por Supabase Realtime). Acá sale de la réplica: la
// cola se re-sincroniza en segundos (dataset invalidable) y un pedido que PASA a
// prioridad 1 dispara el aviso. Es un overlay ⇒ entrada de historial: atrás lo cierra.

const PARAM = "urgente"
/** Urgentes ya conocidos en esta sesión de la app (los que había al abrir no avisan) */
const vistos = new Set<string>()
let lineaBase = false

export function AvisoUrgente() {
  const { filas, meta } = useDataset<PedidoDeposito>(DS.pedidos)
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const abiertoId = sp.get(PARAM)
  const pedido = abiertoId ? filas.find((p) => p.id === abiertoId) : undefined

  useEffect(() => {
    if (!meta?.generadoAt) return
    const urgentes = filas.filter((p) => p.prioridad === 1)
    if (!lineaBase) {
      lineaBase = true
      for (const p of urgentes) vistos.add(p.id)
      return
    }
    // Nuevo urgente que nadie empezó a preparar
    const nuevo = urgentes.find((p) => !vistos.has(p.id) && p.estado !== "en_preparacion" && Object.keys(p.preparadores || {}).length === 0)
    for (const p of urgentes) vistos.add(p.id)
    if (!nuevo || abiertoId || location.pathname.startsWith(`/preparar/${nuevo.id}`)) return
    try { navigator.vibrate?.([250, 120, 250]) } catch { /* noop */ }
    const n = new URLSearchParams(location.search)
    n.set(PARAM, nuevo.id)
    navigate({ pathname: location.pathname, search: `?${n}` }, { state: { overlay: true } })
  }, [filas, meta?.generadoAt, abiertoId, location.pathname, location.search, navigate])

  const cerrar = () => {
    if ((location.state as { overlay?: boolean } | null)?.overlay) navigate(-1)
    else {
      const n = new URLSearchParams(location.search)
      n.delete(PARAM)
      navigate({ pathname: location.pathname, search: n.size ? `?${n}` : "" }, { replace: true })
    }
  }

  // Lo tomó otro (o ya no está en la cola) mientras el aviso estaba abierto: se cierra solo
  const tomado = !!pedido && (pedido.estado === "en_preparacion" || Object.keys(pedido.preparadores || {}).length > 0)
  useEffect(() => {
    if (abiertoId && meta?.generadoAt && (!pedido || tomado)) cerrar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abiertoId, pedido, tomado, meta?.generadoAt])

  if (!abiertoId || !pedido || tomado) return null
  const cliente = pedido.clientes?.razon_social || pedido.clientes?.nombre || "Sin cliente"
  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9998 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 9999, width: "min(420px, 90vw)", background: "#fff", borderRadius: 24, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.3)" }}>
        <div style={{ background: "linear-gradient(135deg, #dc2626, #b91c1c)", padding: "28px 24px 20px", textAlign: "center", color: "#fff" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🚨</div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px" }}>PEDIDO URGENTE</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>Requiere preparación inmediata</div>
        </div>
        <div style={{ padding: "20px 24px" }}>
          <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 16, padding: "16px 18px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Pedido</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#111827" }}>#{pedido.numero_pedido}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Artículos</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#dc2626" }}>{pedido.pedidos_detalle.length}</div>
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 16, fontWeight: 700, color: "#111827" }}>{cliente}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <button onClick={cerrar} style={{ padding: 16, borderRadius: 16, background: "#f3f4f6", border: "1.5px solid #e5e7eb", fontSize: 16, fontWeight: 700, color: "#6b7280" }}>Rechazar</button>
            {/* replace: el aviso no queda en el historial; atrás desde el pedido vuelve adonde estaba */}
            <button onClick={() => navigate(`/preparar/${pedido.id}`, { replace: true })} style={{ padding: 16, borderRadius: 16, background: "#dc2626", border: "none", fontSize: 16, fontWeight: 800, color: "#fff" }}>¡Preparar!</button>
          </div>
        </div>
      </div>
    </>
  )
}
