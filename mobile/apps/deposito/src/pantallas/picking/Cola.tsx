import { Link } from "react-router"
import { useNoEnviados, useParamEstado } from "@gm/core"
import { usePedidos, useRefrescarAlEntrar } from "../../datos/hooks"
import type { PedidoVista } from "../../datos/overlay"
import { C, Marco, Rechazos, useAvisoEntrante, useToast } from "../../ui"
import { DATASET } from "./comun"

const PRIORIDADES = [
  { nivel: 1, label: "Urgente", bg: C.redL, border: C.redB, color: C.red },
  { nivel: 2, label: "Alta", bg: C.orangeL, border: C.orangeB, color: C.orange },
  { nivel: 3, label: "Normal", bg: C.greenL, border: C.greenB, color: C.green },
]

const fechaAR = (f: string) => {
  const [a, m, d] = (f || "").slice(0, 10).split("-")
  return d ? `${d}/${m}/${a}` : f
}

function FilaPedido({ pedido, ultimo, color }: { pedido: PedidoVista; ultimo: boolean; color: string }) {
  const { total, resueltos } = pedido.progreso
  const pct = total > 0 ? Math.round((resueltos / total) * 100) : 0
  const enProgreso = resueltos > 0 && resueltos < total
  const listo = total > 0 && resueltos === total
  return (
    <Link to={`/preparar/${pedido.id}`} style={{ textDecoration: "none", background: C.white, borderBottom: ultimo ? "none" : `1px solid ${C.border}`, padding: "14px 16px", display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pedido.clientes?.razon_social || pedido.clientes?.nombre}
          </div>
          <div style={{ fontSize: 12, color: C.light, fontFamily: "monospace", marginTop: 2 }}>
            {pedido.numero_pedido} · {fechaAR(pedido.fecha)}
            {pedido.sinEnviar.size > 0 && <span style={{ color: C.yellow, fontFamily: "inherit", fontWeight: 700 }}> · ⇪ {pedido.sinEnviar.size} sin enviar</span>}
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, whiteSpace: "nowrap", flexShrink: 0, background: listo ? C.greenL : enProgreso ? C.orangeL : C.bg, color: listo ? C.green : enProgreso ? C.orange : C.sub, border: `1px solid ${listo ? C.greenB : enProgreso ? C.orangeB : C.border}` }}>
          {listo ? "Listo" : enProgreso ? "En progreso" : "Pendiente"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, background: C.border, borderRadius: 999, height: 5, overflow: "hidden" }}>
          <div style={{ height: "100%", background: listo ? C.green : C.orange, borderRadius: 999, width: `${pct}%` }} />
        </div>
        <span style={{ fontSize: 12, color: listo ? C.green : enProgreso ? C.orange : C.sub, fontWeight: 700, minWidth: 40, textAlign: "right" }}>{total} art.</span>
        <span style={{ fontSize: 13, color, fontWeight: 700 }}>›</span>
      </div>
    </Link>
  )
}

/** /preparar — cola de pedidos a preparar, agrupada por prioridad (réplica local + progreso en curso). */
export function Cola() {
  const { pedidos: todos, cargando, meta } = usePedidos()
  const ops = useNoEnviados()
  const { toast, mostrar } = useToast()
  useAvisoEntrante(mostrar)
  useRefrescarAlEntrar(DATASET)
  // Grupos plegados: estado de vista (en la URL, sin historial)
  const [cerrados, setCerrados] = useParamEstado("plegados")
  const plegados = new Set(cerrados.split(",").filter(Boolean))
  const alternar = (nivel: number) => {
    const n = new Set(plegados)
    if (n.has(String(nivel))) n.delete(String(nivel))
    else n.add(String(nivel))
    setCerrados([...n].join(","))
  }

  // Los que ya finalicé en el equipo salen de la cola aunque el cierre no se haya enviado
  const pedidos = todos.filter((p) => !p.cierrePendiente)
  const cierresSinEnviar = todos.length - pedidos.length
  const cierresRechazados = ops.filter((o) => o.estado === "rechazado" && o.tipo === "picking.cerrar")

  return (
    <Marco titulo="Preparar Pedidos" dataset={DATASET}>
      {toast}
      <Rechazos items={cierresRechazados} ayuda="El pedido volvió a la cola: abrilo y resolvé lo que falta antes de finalizarlo de nuevo." />
      <div style={{ paddingBottom: 24 }}>
        <div style={{ padding: "16px 16px 0", marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>{pedidos.length} pedido{pedidos.length !== 1 ? "s" : ""} pendiente{pedidos.length !== 1 ? "s" : ""}</div>
          <div style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>
            Agrupados por prioridad{cierresSinEnviar > 0 ? ` · ${cierresSinEnviar} finalizado${cierresSinEnviar > 1 ? "s" : ""} sin enviar` : ""}
          </div>
        </div>

        {!cargando && !meta?.generadoAt && (
          <div style={{ margin: "0 16px 12px", background: C.yellowL, border: `1px solid ${C.yellowB}`, borderRadius: 14, padding: 14, color: C.yellow, fontWeight: 600, fontSize: 14 }}>
            Todavía no se descargó la cola de pedidos. Acercate a una zona con WiFi.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 16px" }}>
          {PRIORIDADES.map((prio) => {
            const grupo = pedidos.filter((p) => (p.prioridad || 3) === prio.nivel)
            const abierto = !plegados.has(String(prio.nivel))
            return (
              <div key={prio.nivel}>
                <button onClick={() => alternar(prio.nivel)} style={{ width: "100%", background: prio.bg, border: `1.5px solid ${prio.border}`, borderRadius: abierto ? "16px 16px 0 0" : 16, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: prio.color }} />
                    <span style={{ fontSize: 16, fontWeight: 800, color: prio.color }}>{prio.label}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: prio.color, background: C.white, borderRadius: 999, padding: "2px 10px", minWidth: 28, textAlign: "center" }}>{grupo.length}</span>
                  </div>
                  <span style={{ color: prio.color, fontSize: 18, fontWeight: 700, transform: abierto ? "rotate(180deg)" : "none" }}>▾</span>
                </button>
                {abierto && (
                  <div style={{ border: `1.5px solid ${prio.border}`, borderTop: "none", borderRadius: "0 0 16px 16px", overflow: "hidden" }}>
                    {grupo.length === 0 ? (
                      <div style={{ padding: "14px 18px", background: C.white, textAlign: "center", color: C.light, fontSize: 14 }}>Sin pedidos</div>
                    ) : (
                      grupo.map((p, i) => <FilaPedido key={p.id} pedido={p} ultimo={i === grupo.length - 1} color={prio.color} />)
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Marco>
  )
}
