import { useCallback, useEffect } from "react"
import { useNavigate } from "react-router"
import { esQrOUrl, lecturaError, lecturaOk, useNoEnviados } from "@gm/core"
import { DS, type DetallePedido, type OpPickingItem } from "../../datasets"
import { buscarPorCodigo, eansDe, padEan13 } from "../../datos/busqueda"
import { useArticulos, useEncolar, useYo } from "../../datos/hooks"
import { estadoDe, tomadoPorOtro, type PedidoVista } from "../../datos/overlay"
import { C, DESCRIPCION, META, SinEnviar, TarjetaSwipe } from "../../ui"

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

/**
 * Renglón del pedido (swipe ← para la acción, toque = ficha del artículo).
 *
 * La descripción usa DOS líneas: con una sola y 22 px se cortaba a los ~14 caracteres
 * ("PROTECTOR ANATÓMICO S/D ROSA x20u" quedaba en "PROTECTOR ANAT") y el operario no
 * podía distinguir dos variantes del mismo artículo. En la base, la mediana son 33
 * caracteres y el 90 % entra en 45: dos líneas a 17 px cubren casi todo el catálogo
 * sin que un renglón ocupe más alto que antes.
 */
export function RenglonPedido({ pedido, item, accion, onAbrir }: {
  pedido: PedidoVista
  item: DetallePedido
  accion: { fondo: string; icono: string; etiqueta: string; onConfirmar: () => void }
  onAbrir?: () => void
}) {
  const yo = useYo()
  const estado = estadoDe(item)
  const ok = estado === "COMPLETO" || estado === "PARCIAL"
  const faltante = estado === "FALTANTE"
  const prep = pedido.preparadores[item.id]
  const esOtro = !!tomadoPorOtro(pedido, item.id, yo)
  return (
    <TarjetaSwipe bg={ok ? C.greenL : faltante ? C.redL : C.white} borde={ok ? C.greenB : faltante ? C.redB : C.border} accion={accion} bloqueado={esOtro} onAbrir={onAbrir}>
      <div style={{ width: 10, height: 10, borderRadius: "50%", background: ok ? C.green : faltante ? C.red : "#fbbf24", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={DESCRIPCION}>{item.articulos?.descripcion}</div>
        <div style={META}>
          <span style={{ color: C.light, fontSize: 13, fontFamily: "monospace", flexShrink: 0 }}>{item.articulos?.sku}</span>
          {item.articulos?.proveedores?.nombre && (
            <span style={{ color: C.orange, fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.articulos.proveedores.nombre}
            </span>
          )}
          {item.es_bonificado && <span style={{ background: "#fef3c7", color: "#b45309", border: "1px solid #fcd34d", fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 6, flexShrink: 0 }}>BONIF</span>}
          {prep && (
            <span style={{ background: esOtro ? C.indigoL : C.greenL, color: esOtro ? C.indigo : C.green, border: `1px solid ${esOtro ? C.indigoB : C.greenB}`, fontSize: 12, fontWeight: 700, padding: "1px 7px", borderRadius: 999, flexShrink: 0 }}>
              {esOtro ? "🔒 " : "👤 "}{prep.usuario_nombre}
            </span>
          )}
          {pedido.sinEnviar.has(item.id) && <SinEnviar />}
        </div>
        {item.es_bonificado && <div style={{ color: "#b45309", fontSize: 12, fontWeight: 600, marginTop: 2 }}>Bonificado — agregar como ítem normal</div>}
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {ok ? (
          <><div style={{ color: C.green, fontWeight: 800, fontSize: 24, lineHeight: 1.1 }}>{item.cantidad_preparada}</div><div style={{ color: C.light, fontSize: 12 }}>de {item.cantidad}</div></>
        ) : faltante ? (
          <div style={{ color: C.red, fontWeight: 800, fontSize: 13 }}>FALTANTE</div>
        ) : (
          <><div style={{ color: C.text, fontWeight: 800, fontSize: 24, lineHeight: 1.1 }}>{item.cantidad}</div><div style={{ color: C.light, fontSize: 12 }}>unidades</div></>
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
