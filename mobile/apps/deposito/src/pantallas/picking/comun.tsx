import { useCallback, useEffect } from "react"
import { useNavigate } from "react-router"
import { esQrOUrl, lecturaError, lecturaOk, useNoEnviados } from "@gm/core"
import { DS, type DetallePedido, type OpPickingItem } from "../../datasets"
import { buscarPorCodigo, eansDe, padEan13 } from "../../datos/busqueda"
import { useArticulos, useEncolar, useYo } from "../../datos/hooks"
import { estadoDe, tomadoPorOtro, type PedidoVista } from "../../datos/overlay"
import { C, SinEnviar, TarjetaSwipe } from "../../ui"

export const DATASET = DS.pedidos

const abiertosEstaSesion = new Set<string>()

/** Acciones de picking sobre un pedido. Todo va al outbox: responde igual con o sin señal. */
export function usePicking(pedido: PedidoVista | null, mostrar: (m: string, t?: "ok" | "err") => void) {
  const yo = useYo()
  const encolar = useEncolar()
  const navigate = useNavigate()
  const ops = useNoEnviados()
  const { indice } = useArticulos()

  // Paridad con la web: abrir el pedido lo deja "en preparación" (una vez)
  useEffect(() => {
    if (!pedido || pedido.cierrePendiente || pedido.estado === "en_preparacion" || abiertosEstaSesion.has(pedido.id)) return
    if (ops.some((o) => o.tipo === "picking.abrir" && (o.payload as { pedido_id: string }).pedido_id === pedido.id)) return
    abiertosEstaSesion.add(pedido.id)
    void encolar("picking.abrir", { pedido_id: pedido.id }, `Abrir pedido ${pedido.numero_pedido}`)
  }, [pedido, ops, encolar])

  const marcar = useCallback(
    async (det: DetallePedido, cantidad: number, esFaltante: boolean) => {
      if (!pedido) return false
      const otro = tomadoPorOtro(pedido, det.id, yo)
      if (otro) { lecturaError(); mostrar(`🔒 Ya lo preparó ${otro}`, "err"); return false }
      const payload: OpPickingItem = {
        pedido_id: pedido.id, pedido_detalle_id: det.id,
        cantidad_preparada: esFaltante ? 0 : cantidad, es_faltante: esFaltante, operario: yo.nombre,
      }
      const que = esFaltante ? "faltante" : cantidad > 0 ? `${cantidad} u` : "a pendientes"
      await encolar("picking.item", payload, `Pedido ${pedido.numero_pedido}: ${det.articulos?.descripcion ?? "artículo"} → ${que}`)
      return true
    },
    [pedido, yo, encolar, mostrar],
  )

  /** Renglón del pedido para un código leído (EAN o código de bulto), o el motivo por el que no. */
  const resolverCodigo = useCallback(
    (codigo: string): DetallePedido | null => {
      if (!pedido) return null
      if (esQrOUrl(codigo)) { lecturaError(); mostrar("QR ignorado — escaneá el código de barras", "err"); return null }
      const buscado = new Set([codigo, padEan13(codigo)])
      const lineas = pedido.pedidos_detalle.filter((d) => {
        const a = d.articulos
        return !!a && [...eansDe(a), a.codigo_bulto || ""].some((c) => c && (buscado.has(c) || buscado.has(padEan13(c))))
      })
      if (lineas.length === 0) {
        const art = buscarPorCodigo(indice, codigo)[0]
        lecturaError()
        mostrar(art ? `"${art.descripcion}" no está en este pedido` : `No se encontró el código ${codigo}`, "err")
        return null
      }
      // Mismo artículo en más de un renglón (ej. normal + bonificado): primero el que falta resolver
      const det = lineas.find((d) => estadoDe(d) === "PENDIENTE" && !tomadoPorOtro(pedido, d.id, yo)) ?? lineas[0]!
      const otro = tomadoPorOtro(pedido, det.id, yo)
      if (otro) { lecturaError(); mostrar(`🔒 Ya lo preparó ${otro}`, "err"); return null }
      lecturaOk()
      return det
    },
    [pedido, indice, yo, mostrar],
  )

  const abrirItem = useCallback(
    (det: DetallePedido, opts: { replace?: boolean } = {}) => pedido && navigate(`/preparar/${pedido.id}/item/${det.id}`, { replace: opts.replace }),
    [pedido, navigate],
  )

  return { yo, marcar, resolverCodigo, abrirItem }
}

/** Renglón del pedido (swipe ← para la acción). Mismo aspecto que la web. */
export function RenglonPedido({ pedido, item, accion }: {
  pedido: PedidoVista
  item: DetallePedido
  accion: { fondo: string; icono: string; etiqueta: string; onConfirmar: () => void }
}) {
  const yo = useYo()
  const estado = estadoDe(item)
  const ok = estado === "COMPLETO" || estado === "PARCIAL"
  const faltante = estado === "FALTANTE"
  const prep = pedido.preparadores[item.id]
  const esOtro = !!tomadoPorOtro(pedido, item.id, yo)
  return (
    <TarjetaSwipe bg={ok ? C.greenL : faltante ? C.redL : C.white} borde={ok ? C.greenB : faltante ? C.redB : C.border} accion={accion} bloqueado={esOtro}>
      <div style={{ width: 13, height: 13, borderRadius: "50%", background: ok ? C.green : faltante ? C.red : "#fbbf24", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: C.text, fontWeight: 700, fontSize: 22, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{item.articulos?.descripcion}</span>
          {item.es_bonificado && <span style={{ background: "#fef3c7", color: "#b45309", border: "1px solid #fcd34d", fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 6, flexShrink: 0 }}>BONIF</span>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 5, flexWrap: "wrap" }}>
          <span style={{ color: C.light, fontSize: 15, fontFamily: "monospace" }}>{item.articulos?.sku}</span>
          {item.articulos?.proveedores?.nombre && <span style={{ color: C.orange, fontSize: 15, fontWeight: 600 }}>{item.articulos.proveedores.nombre}</span>}
          {item.es_bonificado && <span style={{ color: "#b45309", fontSize: 14, fontWeight: 600 }}>Bonificado — agregar como ítem normal</span>}
          {prep && (
            <span style={{ background: esOtro ? C.indigoL : C.greenL, color: esOtro ? C.indigo : C.green, border: `1px solid ${esOtro ? C.indigoB : C.greenB}`, fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999, flexShrink: 0 }}>
              {esOtro ? "🔒 " : "👤 "}{prep.usuario_nombre}
            </span>
          )}
          {pedido.sinEnviar.has(item.id) && <SinEnviar />}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {ok ? (
          <><div style={{ color: C.green, fontWeight: 800, fontSize: 27 }}>{item.cantidad_preparada}</div><div style={{ color: C.light, fontSize: 15 }}>de {item.cantidad}</div></>
        ) : faltante ? (
          <div style={{ color: C.red, fontWeight: 700, fontSize: 16 }}>FALTANTE</div>
        ) : (
          <><div style={{ color: C.text, fontWeight: 800, fontSize: 27 }}>{item.cantidad}</div><div style={{ color: C.light, fontSize: 15 }}>unidades</div></>
        )}
      </div>
    </TarjetaSwipe>
  )
}

export function PedidoNoDisponible({ cargando, finalizado }: { cargando: boolean; finalizado?: boolean }) {
  const navigate = useNavigate()
  if (finalizado) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 44, marginBottom: 10 }}>✅</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Pedido finalizado</div>
        <div style={{ fontSize: 14, color: C.sub, marginTop: 6 }}>Quedó guardado en el equipo y se envía solo apenas haya señal.</div>
        <button onClick={() => navigate("/preparar", { replace: true })} style={{ marginTop: 18, width: "100%", background: C.white, color: C.text, fontWeight: 700, fontSize: 16, padding: 17, borderRadius: 18, border: `1.5px solid ${C.border}` }}>
          ← Volver a la lista
        </button>
      </div>
    )
  }
  if (cargando) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: C.light }}>Cargando pedido...</div>
  return (
    <div style={{ padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: 44, marginBottom: 10 }}>📦</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Este pedido ya no está para preparar</div>
      <div style={{ fontSize: 14, color: C.sub, marginTop: 6 }}>Lo finalizó otro operario o cambió de estado en la oficina.</div>
      <button onClick={() => navigate("/preparar", { replace: true })} style={{ marginTop: 18, width: "100%", background: C.white, color: C.text, fontWeight: 700, fontSize: 16, padding: 17, borderRadius: 18, border: `1.5px solid ${C.border}` }}>
        ← Volver a la lista
      </button>
    </div>
  )
}
