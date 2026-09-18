// Overlay optimista: lo que ve el operario = réplica + sus operaciones del outbox
// que todavía no se enviaron. Funciones PURAS (tests en packages/core/test/deposito-overlay.test.ts).
//
// Por qué así: el outbox es durable (IndexedDB), así que el progreso de un picking
// a medias sobrevive a cerrar la app, cambiar de pantalla o quedarse sin WiFi sin
// guardar nada aparte. Cuando la operación se envía, el servidor devuelve la fila
// ya actualizada (parche de réplica) y el overlay de esa operación desaparece.

import type { ItemOutbox } from "@gm/core"
import { calcularBonificados, estadoItemPicking, estadoLineaRecepcion } from "@gm/deposito"
import type {
  Articulo, DetallePedido, Devolucion, EstadoItem, EstadoLinea, OpDatos, OpPickingItem, OpRecepcionItem, OpStock,
  OrdenRecepcion, PedidoDeposito, Preparador,
} from "../datasets"

const enCola = (i: ItemOutbox) => i.estado === "pendiente" || i.estado === "enviando"

export interface Yo {
  id: string
  nombre: string
}

// ─── Picking ─────────────────────────────────────────────────────────────────

export interface PedidoVista extends PedidoDeposito {
  /** renglones con un cambio local sin enviar */
  sinEnviar: Set<string>
  /** el operario ya lo finalizó en el equipo; falta que llegue al servidor */
  cierrePendiente: boolean
  /** operaciones de este pedido que el servidor rechazó (hay que mostrarlas) */
  rechazos: ItemOutbox[]
  progreso: { total: number; resueltos: number; pendientes: number; completos: number; faltantes: number }
}

export const estadoDe = (d: DetallePedido): EstadoItem => d.estado_item || "PENDIENTE"

export function vistaPedido(p: PedidoDeposito, ops: ItemOutbox[]): PedidoVista {
  const detalle = p.pedidos_detalle.map((d) => ({ ...d }))
  const porId = new Map(detalle.map((d) => [d.id, d]))
  const preparadores: Record<string, Preparador> = { ...p.preparadores }
  const sinEnviar = new Set<string>()
  const rechazos: ItemOutbox[] = []
  let cierrePendiente = false
  let recalcular = false

  for (const op of ops) {
    const pl = op.payload as { pedido_id?: string }
    if (pl?.pedido_id !== p.id || !op.tipo.startsWith("picking.")) continue
    if (op.estado === "rechazado") {
      rechazos.push(op)
      continue
    }
    if (!enCola(op)) continue
    if (op.tipo === "picking.cerrar") cierrePendiente = true
    if (op.tipo !== "picking.item") continue
    const x = op.payload as OpPickingItem
    const d = porId.get(x.pedido_detalle_id)
    if (!d) continue
    d.cantidad_preparada = x.cantidad_preparada
    d.estado_item = estadoItemPicking(x.cantidad_preparada, d.cantidad, x.es_faltante)
    if (d.estado_item === "PENDIENTE") delete preparadores[d.id]
    else preparadores[d.id] = { usuario_id: op.usuarioId, usuario_nombre: x.operario || "Operario" }
    sinEnviar.add(d.id)
    if (!d.es_bonificado) recalcular = true
  }

  // Misma cuenta que hace el servidor después de cada renglón (lib/deposito/bonificados.ts)
  if (recalcular) {
    for (const b of calcularBonificados(p.bonif_mercaderia_pct, detalle)) {
      if (!b.cambia) continue
      const d = porId.get(b.id)!
      d.cantidad = b.cantidad
      d.cantidad_preparada = b.cantidad
      d.estado_item = "COMPLETO"
    }
  }

  let completos = 0
  let faltantes = 0
  for (const d of detalle) {
    const e = estadoDe(d)
    if (e === "FALTANTE") faltantes++
    else if (e !== "PENDIENTE") completos++
  }
  const total = detalle.length
  return {
    ...p,
    pedidos_detalle: detalle,
    preparadores,
    sinEnviar,
    cierrePendiente,
    rechazos,
    progreso: { total, resueltos: completos + faltantes, pendientes: total - completos - faltantes, completos, faltantes },
  }
}

/** Nombre de quien tomó el renglón si NO soy yo (renglón bloqueado), o null. */
export function tomadoPorOtro(v: PedidoVista, detId: string, yo: Yo): string | null {
  const p = v.preparadores[detId]
  if (!p) return null
  const esOtro = p.usuario_id ? p.usuario_id !== yo.id : p.usuario_nombre !== yo.nombre
  return esOtro ? p.usuario_nombre : null
}

// ─── Recepción ───────────────────────────────────────────────────────────────

export interface LineaRecepcion {
  articulo_id: string
  cantidad_oc: number
  cantidad_fisica: number
  estado_linea: EstadoLinea
  fuera_de_oc: boolean
  sinEnviar: boolean
  articulo: { sku: string; descripcion: string; ean13?: string[] | string | null; codigo_bulto?: string | null; unidades_por_bulto?: number | null } | null
}

export interface RecepcionVista {
  orden: OrdenRecepcion
  lineas: LineaRecepcion[]
  /** null = falta el control de bultos */
  conformidad: string | null
  cierrePendiente: boolean
  rechazos: ItemOutbox[]
  /** id de la recepción en el servidor (null = todavía no se creó allá: fotos deshabilitadas) */
  recepcionId: string | null
  documentos: number
}

export function vistaRecepcion(o: OrdenRecepcion, ops: ItemOutbox[], articulo: (id: string) => Articulo | undefined): RecepcionVista {
  const infoOC = new Map(o.ordenes_compra_detalle.map((d) => [d.articulo_id, d.articulos]))
  const info = (id: string): LineaRecepcion["articulo"] => infoOC.get(id) ?? articulo(id) ?? null

  // Sin recepción en el servidor todavía: las líneas salen de la OC (igual que al crearla allá)
  const lineas: LineaRecepcion[] = o.recepcion
    ? o.recepcion.recepciones_items.map((ri) => ({
        articulo_id: ri.articulo_id,
        cantidad_oc: Number(ri.cantidad_oc || 0),
        cantidad_fisica: Number(ri.cantidad_fisica || 0),
        estado_linea: ri.estado_linea || "pendiente",
        fuera_de_oc: !!ri.fuera_de_oc,
        sinEnviar: false,
        articulo: info(ri.articulo_id),
      }))
    : o.ordenes_compra_detalle.map((d) => ({
        articulo_id: d.articulo_id,
        cantidad_oc: Number(d.cantidad_pedida || 0),
        cantidad_fisica: 0,
        estado_linea: "pendiente" as EstadoLinea,
        fuera_de_oc: false,
        sinEnviar: false,
        articulo: info(d.articulo_id),
      }))
  const porArt = new Map(lineas.map((l) => [l.articulo_id, l]))

  let conformidad = o.recepcion?.conformidad_transporte ?? null
  let cierrePendiente = false
  const rechazos: ItemOutbox[] = []
  for (const op of ops) {
    const pl = op.payload as { orden_compra_id?: string }
    if (pl?.orden_compra_id !== o.id || !op.tipo.startsWith("recepcion.")) continue
    if (op.estado === "rechazado") {
      rechazos.push(op)
      continue
    }
    if (!enCola(op)) continue
    if (op.tipo === "recepcion.cerrar") cierrePendiente = true
    else if (op.tipo === "recepcion.conformidad") conformidad ??= (op.payload as { conformidad: { estado: string } }).conformidad.estado
    else if (op.tipo === "recepcion.item") {
      const x = op.payload as OpRecepcionItem
      const e = estadoLineaRecepcion(x.cantidad_fisica)
      const l = porArt.get(x.articulo_id)
      if (l) {
        l.cantidad_fisica = e.cantidad
        l.estado_linea = e.estado_linea
        l.sinEnviar = true
      } else {
        // Artículo que no estaba en la OC: se registra igual (fuera de OC)
        const nueva: LineaRecepcion = {
          articulo_id: x.articulo_id, cantidad_oc: 0, cantidad_fisica: e.cantidad, estado_linea: e.estado_linea,
          fuera_de_oc: true, sinEnviar: true, articulo: info(x.articulo_id),
        }
        lineas.push(nueva)
        porArt.set(x.articulo_id, nueva)
      }
    }
  }
  return {
    orden: o, lineas, conformidad, cierrePendiente, rechazos,
    recepcionId: o.recepcion?.id ?? null,
    documentos: o.recepcion?.recepciones_documentos?.length ?? 0,
  }
}

// ─── Devoluciones ────────────────────────────────────────────────────────────

/** Devoluciones que el operario ya confirmó en el equipo (salen de la lista aunque no se hayan enviado). */
export function devolucionesConfirmadasLocal(ops: ItemOutbox[]): Set<string> {
  const s = new Set<string>()
  for (const op of ops) if (op.tipo === "devolucion.recibir" && enCola(op)) s.add((op.payload as { devolucion_id: string }).devolucion_id)
  return s
}

export const devolucionesVisibles = (devs: Devolucion[], ops: ItemOutbox[]) => {
  const hechas = devolucionesConfirmadasLocal(ops)
  return devs.filter((d) => !hechas.has(d.id)).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
}

// ─── Artículos (stock y datos) ───────────────────────────────────────────────

export interface ArticuloVista extends Articulo {
  /** hay ajustes de stock o cambios de datos sin enviar */
  stockSinEnviar: boolean
  datosSinEnviar: boolean
  /** enviado a INEXISTENTE en el equipo, sin enviar */
  descartado: boolean
}

export function vistaArticulo(a: Articulo, ops: ItemOutbox[]): ArticuloVista {
  const v: ArticuloVista = { ...a, stockSinEnviar: false, datosSinEnviar: false, descartado: false }
  for (const op of ops) {
    if (!enCola(op) || (op.payload as { articulo_id?: string })?.articulo_id !== a.id) continue
    if (op.tipo === "stock.ajustar") {
      const x = op.payload as OpStock
      const s = Number(v.stock_actual ?? 0)
      v.stock_actual = x.tipo === "correccion" ? x.cantidad : x.tipo === "entrada" ? s + x.cantidad : s - x.cantidad
      v.stockSinEnviar = true
    } else if (op.tipo === "articulo.datos") {
      for (const [campo, c] of Object.entries((op.payload as OpDatos).cambios)) (v as unknown as Record<string, unknown>)[campo] = c.despues
      v.datosSinEnviar = true
    } else if (op.tipo === "articulo.inexistente") v.descartado = true
  }
  return v
}

/** Ids de artículos con operaciones sin enviar (para no recorrer todo el catálogo). */
export function articulosTocados(ops: ItemOutbox[]): Set<string> {
  const s = new Set<string>()
  for (const op of ops) {
    if (!enCola(op)) continue
    if (op.tipo === "stock.ajustar" || op.tipo === "articulo.datos" || op.tipo === "articulo.inexistente") {
      const id = (op.payload as { articulo_id?: string })?.articulo_id
      if (id) s.add(id)
    }
  }
  return s
}

/** Orden del recorrido de depósito: orden_deposito (sin orden al final) → descripción → id. */
export function cmpOrdenDeposito(x: Articulo, y: Articulo): number {
  const ox = x.orden_deposito, oy = y.orden_deposito
  if (ox !== oy) {
    if (ox == null) return 1
    if (oy == null) return -1
    return ox - oy
  }
  if (x.descripcion !== y.descripcion) return x.descripcion < y.descripcion ? -1 : 1
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
}

/** Recorrido "sin código": marca (sin marca al final) → descripción → id. */
export function cmpSinCodigo(x: Articulo, y: Articulo): number {
  const mx = x.marca ? x.marca.toUpperCase() : "￿"
  const my = y.marca ? y.marca.toUpperCase() : "￿"
  if (mx !== my) return mx < my ? -1 : 1
  if (x.descripcion !== y.descripcion) return x.descripcion < y.descripcion ? -1 : 1
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
}
