import { useNavigate, useParams } from "react-router"
import { useLector, useOverlay } from "@gm/core"
import { Hoja } from "@gm/core/ui"
import { useEncolar, usePedido } from "../../datos/hooks"
import { estadoDe, tomadoPorOtro } from "../../datos/overlay"
import { BarraProgreso, C, Contadores, dejarAviso, Marco, Rechazos, useAvisoEntrante, useToast, useVolver } from "../../ui"
import { PanelBuscar } from "../comunes/Buscar"
import { PanelCantidad } from "../comunes/Cantidad"
import { DATASET, PedidoNoDisponible, RenglonPedido, usePicking } from "./comun"
import type { PedidoVista } from "../../datos/overlay"

const clienteDe = (p: PedidoVista) => p.clientes?.razon_social || p.clientes?.nombre || "Sin cliente"
const AYUDA_RECHAZO = "La lista ya muestra el estado real del servidor. Si hace falta, volvé a marcar el renglón."

/** Finalizar: confirmación con la mercadería bonificada (como la web) y cierre por outbox. */
function useFinalizar(pedido: PedidoVista | null, mostrar: (m: string, t?: "ok" | "err") => void) {
  const encolar = useEncolar()
  const volver = useVolver()
  const hoja = useOverlay("finalizar")
  const bonificados = pedido?.pedidos_detalle.filter((i) => i.es_bonificado && (i.cantidad ?? 0) > 0) ?? []

  const cerrar = async (desdeHoja: boolean, pasosExtra = 0) => {
    if (!pedido) return
    await encolar("picking.cerrar", { pedido_id: pedido.id }, `Finalizar pedido ${pedido.numero_pedido} — ${clienteDe(pedido)}`)
    dejarAviso("✅ Pedido finalizado")
    volver(1 + (desdeHoja ? 1 : 0) + pasosExtra)
  }
  const pedir = (pasosExtra = 0) => {
    if (!pedido) return
    if (pedido.progreso.pendientes > 0) { mostrar(`Faltan ${pedido.progreso.pendientes} artículos por resolver`, "err"); return }
    if (bonificados.length > 0) hoja.abrir()
    else void cerrar(false, pasosExtra)
  }
  const nodo = (pasosExtra = 0) => (
    <Hoja abierta={hoja.abierto} onCerrar={hoja.cerrar} titulo="Mercadería bonificada a entregar">
      <ul style={{ margin: "0 0 16px", padding: 0, listStyle: "none" }}>
        {bonificados.map((b) => (
          <li key={b.id} style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontSize: 16 }}>
            <b>{b.cantidad} u</b> — {b.articulos?.descripcion ?? ""}
          </li>
        ))}
      </ul>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
        <button onClick={hoja.cerrar} style={{ background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "16px 0", borderRadius: 16, border: `1.5px solid ${C.border}` }}>Cancelar</button>
        <button onClick={() => void cerrar(true, pasosExtra)} style={{ background: C.green, color: "#fff", fontWeight: 800, fontSize: 16, padding: "16px 0", borderRadius: 16, border: "none" }}>✅ Finalizar la preparación</button>
      </div>
    </Hoja>
  )
  return { pedir, nodo }
}

function BotonFinalizar({ pedido, onClick, etiqueta, flex = 1 }: { pedido: PedidoVista; onClick: () => void; etiqueta: string; flex?: number }) {
  const listo = pedido.progreso.pendientes === 0
  return (
    <button onClick={onClick} style={{ flex, background: listo ? C.green : "#f3f4f6", color: listo ? "#fff" : C.light, fontWeight: listo ? 800 : 700, fontSize: 16, padding: "19px 0", borderRadius: 18, border: listo ? "none" : `1.5px solid ${C.border}` }}>
      ✅ {etiqueta}
    </button>
  )
}

// ─── /preparar/:id — lista principal ─────────────────────────────────────────

export function Pedido() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { pedido, cargando } = usePedido(id)
  const { toast, mostrar } = useToast()
  useAvisoEntrante(mostrar)
  const { marcar, resolverCodigo, abrirItem } = usePicking(pedido, mostrar)
  const fin = useFinalizar(pedido, mostrar)

  // Gatillo del lector desde la lista: abre la cantidad del renglón sin tocar la pantalla
  useLector({ enabled: !!pedido, onCodigo: (c) => { const det = resolverCodigo(c); if (det) abrirItem(det) } })

  if (!pedido || pedido.cierrePendiente) {
    return <Marco titulo="Preparar Pedidos" dataset={DATASET}>{toast}<PedidoNoDisponible cargando={cargando} finalizado={pedido?.cierrePendiente} /></Marco>
  }

  const pendientes = pedido.pedidos_detalle.filter((i) => estadoDe(i) === "PENDIENTE")
  const completos = pedido.pedidos_detalle.filter((i) => estadoDe(i) === "COMPLETO" || estadoDe(i) === "PARCIAL")
  const { progreso } = pedido
  const aFaltante = (item: (typeof pendientes)[number]) => ({
    fondo: C.red, icono: "✕", etiqueta: "Faltante",
    onConfirmar: () => void marcar(item, 0, true).then((ok) => ok && mostrar("Marcado como faltante")),
  })

  return (
    <Marco titulo="Preparar Pedidos" dataset={DATASET}>
      {toast}
      <Rechazos items={pedido.rechazos} ayuda={AYUDA_RECHAZO} />
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.text, lineHeight: 1.2 }}>{clienteDe(pedido)}</div>
            <div style={{ color: C.sub, fontSize: 13, marginTop: 4, lineHeight: 1.4 }}>{[pedido.clientes?.direccion, pedido.clientes?.localidad].filter(Boolean).join(" · ")}</div>
            <div style={{ color: C.light, fontSize: 12, marginTop: 2, fontFamily: "monospace" }}>{pedido.numero_pedido}</div>
          </div>
          {progreso.faltantes > 0 && (
            <button onClick={() => navigate(`/preparar/${pedido.id}/faltantes`)} style={{ background: C.redL, border: `1.5px solid ${C.redB}`, borderRadius: 12, padding: "7px 14px", minHeight: 44, fontSize: 13, fontWeight: 700, color: C.red, whiteSpace: "nowrap" }}>
              ✕ {progreso.faltantes} faltante{progreso.faltantes > 1 ? "s" : ""}
            </button>
          )}
        </div>
        <BarraProgreso resueltos={progreso.resueltos} total={progreso.total} pendientes={progreso.pendientes} ok={progreso.completos} faltantes={progreso.faltantes} />
      </div>

      {pendientes.length > 0 && (
        <div style={{ background: C.orangeL, borderBottom: `1px solid ${C.orangeB}`, padding: "10px 18px", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 16 }}>👈</span>
          <span style={{ fontSize: 13, color: C.orange, fontWeight: 600 }}>Swipeá para marcar faltante · Escaneá para registrar cantidad</span>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "12px 14px 0" }}>
        {pendientes.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.light, textTransform: "uppercase", letterSpacing: "0.1em", padding: "2px 2px 10px" }}>Pendientes ({pendientes.length})</div>
            {pendientes.map((item) => <RenglonPedido key={item.id} pedido={pedido} item={item} accion={aFaltante(item)} />)}
          </>
        )}
        {completos.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.light, textTransform: "uppercase", letterSpacing: "0.1em", padding: "8px 2px 10px" }}>Preparados ({completos.length})</div>
            {completos.map((item) => <RenglonPedido key={item.id} pedido={pedido} item={item} accion={aFaltante(item)} />)}
          </>
        )}
        <div style={{ height: 16 }} />
      </div>

      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "14px 16px", display: "flex", gap: 12 }}>
        <button onClick={() => navigate(`/preparar/${pedido.id}/buscar`)} style={{ flex: 2, background: C.white, color: C.text, fontWeight: 700, fontSize: 18, padding: "19px 0", borderRadius: 18, border: `1.5px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔍</span> Buscar artículo
        </button>
        <BotonFinalizar pedido={pedido} etiqueta="Listo" onClick={() => fin.pedir()} />
      </div>
      {fin.nodo()}
    </Marco>
  )
}

// ─── /preparar/:id/buscar — búsqueda manual / scanner ────────────────────────

export function PedidoBuscar() {
  const { id } = useParams()
  const { pedido, cargando } = usePedido(id)
  const { toast, mostrar } = useToast()
  const { yo, resolverCodigo, abrirItem } = usePicking(pedido, mostrar)
  const fin = useFinalizar(pedido, mostrar)
  const volver = useVolver()

  if (!pedido || pedido.cierrePendiente) return <Marco titulo="Buscar artículo">{toast}<PedidoNoDisponible cargando={cargando} finalizado={pedido?.cierrePendiente} /></Marco>
  const { progreso } = pedido
  const lineaDe = (articuloId: string) => pedido.pedidos_detalle.find((i) => i.articulo_id === articuloId)

  return (
    <Marco titulo="Buscar artículo">
      {toast}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}`, padding: "14px 16px" }}>
        <div style={{ fontSize: 13, color: C.sub, marginBottom: 4 }}>{pedido.numero_pedido} · {clienteDe(pedido)}</div>
        <Contadores pendientes={progreso.pendientes} ok={progreso.completos} faltantes={progreso.faltantes} />
      </div>
      <PanelBuscar
        placeholder="Escanear EAN o buscar artículo..."
        vacio={{ icono: "📱", texto: <>Escaneá el código de barras<br />o escribí para buscar</> }}
        mostrar={mostrar}
        decorar={(art) => {
          const l = lineaDe(art.id)
          if (!l) return null
          const listo = estadoDe(l) === "COMPLETO" || estadoDe(l) === "PARCIAL"
          return {
            bg: listo ? C.greenL : C.orangeL, borde: listo ? C.greenB : C.orangeB,
            leyenda: <span style={{ color: listo ? C.green : C.orange }}>Pedido: {l.cantidad} u · {estadoDe(l)}</span>,
          }
        }}
        onElegir={(art) => {
          const l = lineaDe(art.id)
          if (!l) { mostrar(`"${art.descripcion}" no está en este pedido`, "err"); return }
          const otro = tomadoPorOtro(pedido, l.id, yo)
          if (otro) { mostrar(`🔒 Ya lo preparó ${otro}`, "err"); return }
          abrirItem(l, { replace: true }) // confirmar vuelve a la lista (como la web)
        }}
        onCodigo={(c) => { const det = resolverCodigo(c); if (det) abrirItem(det, { replace: true }) }}
      />
      <div style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "14px 16px", display: "flex", gap: 10 }}>
        <button onClick={() => volver()} style={{ flex: 1, background: C.bg, color: C.text, fontWeight: 700, fontSize: 16, padding: "19px 0", borderRadius: 18, border: `1.5px solid ${C.border}` }}>📋 Lista</button>
        <BotonFinalizar pedido={pedido} etiqueta="Finalizar" onClick={() => fin.pedir(1)} />
      </div>
      {fin.nodo(1)}
    </Marco>
  )
}

// ─── /preparar/:id/item/:detId — cantidad ────────────────────────────────────

export function PedidoItem() {
  const { id, detId } = useParams()
  const navigate = useNavigate()
  const { pedido, cargando } = usePedido(id)
  const { toast, mostrar } = useToast()
  const { marcar } = usePicking(pedido, mostrar)
  const volver = useVolver()
  const item = pedido?.pedidos_detalle.find((d) => d.id === detId)

  if (!pedido || !item?.articulos || pedido.cierrePendiente) return <Marco titulo="Cantidad">{toast}<PedidoNoDisponible cargando={cargando} finalizado={pedido?.cierrePendiente} /></Marco>

  const guardar = async (cantidad: number, esFaltante: boolean) => {
    if (await marcar(item, cantidad, esFaltante)) {
      dejarAviso(esFaltante ? "Marcado como faltante" : "✓ Guardado")
      volver()
    }
  }
  return (
    <Marco titulo="Cantidad">
      {toast}
      <PanelCantidad
        articulo={item.articulos}
        titulo="Artículo encontrado"
        etiquetaInput="Cantidad que separaste físicamente:"
        inicial={String(item.cantidad)}
        mostrar={mostrar}
        cabecera={
          <div style={{ background: C.orangeL, border: `1.5px solid ${C.orangeB}`, borderRadius: 16, padding: "16px 20px", textAlign: "center" }}>
            <div style={{ color: C.orange, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Cantidad pedida</div>
            <div style={{ color: C.orange, fontWeight: 800, fontSize: 52, lineHeight: 1.1 }}>{item.cantidad}</div>
          </div>
        }
        onConfirmar={(c) => void guardar(c, false)}
        onFaltante={() => void guardar(0, true)}
        onVolverBuscar={() => navigate(`/preparar/${pedido.id}/buscar`, { replace: true })}
      />
    </Marco>
  )
}

// ─── /preparar/:id/faltantes ─────────────────────────────────────────────────

export function PedidoFaltantes() {
  const { id } = useParams()
  const { pedido, cargando } = usePedido(id)
  const { toast, mostrar } = useToast()
  const { marcar, resolverCodigo, abrirItem } = usePicking(pedido, mostrar)
  const volver = useVolver()
  useLector({ enabled: !!pedido, onCodigo: (c) => { const det = resolverCodigo(c); if (det) abrirItem(det, { replace: true }) } })

  if (!pedido || pedido.cierrePendiente) return <Marco titulo="Faltantes">{toast}<PedidoNoDisponible cargando={cargando} finalizado={pedido?.cierrePendiente} /></Marco>
  const faltantes = pedido.pedidos_detalle.filter((i) => estadoDe(i) === "FALTANTE")
  return (
    <Marco titulo="Faltantes">
      {toast}
      <div style={{ padding: "16px 14px" }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>Artículos faltantes ({faltantes.length})</div>
          <div style={{ fontSize: 14, color: C.sub, marginTop: 4 }}>Swipeá hacia la izquierda para devolver a pendientes</div>
        </div>
        {faltantes.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: C.light, fontSize: 16 }}>No hay faltantes</div>}
        {faltantes.map((item) => (
          <RenglonPedido
            key={item.id} pedido={pedido} item={item}
            accion={{ fondo: C.green, icono: "↩", etiqueta: "Pendiente", onConfirmar: () => void marcar(item, 0, false).then((ok) => ok && mostrar("Devuelto a pendientes")) }}
          />
        ))}
        <button onClick={() => volver()} style={{ width: "100%", background: C.white, color: C.text, fontWeight: 700, fontSize: 16, padding: 17, borderRadius: 18, border: `1.5px solid ${C.border}`, marginTop: 12 }}>
          ← Volver a la lista
        </button>
      </div>
    </Marco>
  )
}
