import type { DefDataset } from "@gm/core"

// Datasets que replica la app Depósito (servidor: lib/mobile/sync/deposito.ts).
// El galpón tiene WiFi irregular: se aprovecha cada momento con señal.
//  - pedidos y artículos son delta + invalidables: un pedido nuevo/urgente o un
//    renglón tomado por otro operario llega en segundos (sondeo de 15 s).
//  - recepciones/devoluciones son snapshot con hash (si no cambió, no viaja nada).
export const DS = {
  pedidos: "deposito_pedidos",
  recepciones: "deposito_recepciones",
  devoluciones: "deposito_devoluciones",
  articulos: "deposito_articulos",
  catalogos: "deposito_catalogos",
} as const

export const DATASETS: DefDataset[] = [
  { nombre: DS.pedidos, prioridad: 1, invalidable: true, cadaMs: 45_000 },
  { nombre: DS.recepciones, prioridad: 2, cadaMs: 60_000 },
  { nombre: DS.devoluciones, prioridad: 3, cadaMs: 2 * 60_000 },
  { nombre: DS.catalogos, prioridad: 4, cadaMs: 30 * 60_000 },
  { nombre: DS.articulos, prioridad: 5, invalidable: true, cadaMs: 5 * 60_000 },
]

// ─── Formas de las filas ─────────────────────────────────────────────────────

export type EstadoItem = "PENDIENTE" | "COMPLETO" | "PARCIAL" | "FALTANTE"

export interface ArticuloDePedido {
  id: string
  sku: string
  descripcion: string
  ean13?: string[] | string | null
  codigo_bulto?: string | null
  unidades_por_bulto?: number | null
  orden_deposito?: number | null
  proveedores?: { nombre: string } | null
  marca?: { descripcion: string } | null
}

export interface DetallePedido {
  id: string
  articulo_id: string
  cantidad: number
  cantidad_preparada: number
  estado_item: EstadoItem | null
  es_bonificado?: boolean | null
  precio_base?: number | null
  excluye_bonif?: boolean
  articulos: ArticuloDePedido | null
}

export interface Preparador {
  usuario_id: string | null
  usuario_nombre: string
}

export interface PedidoDeposito {
  id: string
  numero_pedido: string
  estado: string
  fecha: string
  prioridad: number | null
  observaciones?: string | null
  created_at: string
  bonif_mercaderia_pct?: number | null
  clientes: { id: string; nombre: string; razon_social?: string | null; direccion?: string | null; localidad?: string | null } | null
  pedidos_detalle: DetallePedido[]
  /** renglón → quién lo tomó */
  preparadores: Record<string, Preparador>
}

export interface Articulo {
  id: string
  sku: string
  descripcion: string
  ean13: string[] | null
  codigo_bulto: string | null
  stock_actual: number | null
  unidades_por_bulto: number | null
  unidad_de_medida: string | null
  orden_deposito: number | null
  proveedor_id: string | null
  categoria: string | null
  tipo_fraccion: string | null
  cantidad_fraccion: number | null
  marca: string | null
  /** Foto del artículo (bucket público). La tienen ~4 de cada 10 artículos. */
  imagen_url: string | null
}

export type EstadoLinea = "pendiente" | "ok" | "faltante"

export interface RecepcionItem {
  id: string
  articulo_id: string
  cantidad_oc: number
  cantidad_fisica: number
  estado_linea: EstadoLinea
  fuera_de_oc?: boolean | null
}

export interface OrdenRecepcion {
  id: string
  numero_orden: string
  estado: string
  fecha_orden: string
  observaciones?: string | null
  proveedores: { id: string; nombre: string } | null
  ordenes_compra_detalle: Array<{
    id: string
    cantidad_pedida: number
    articulo_id: string
    articulos: { id: string; sku: string; descripcion: string; ean13?: string[] | string | null; unidades_por_bulto?: number | null } | null
  }>
  recepcion: {
    id: string
    estado: string
    numero_tanda: number
    conformidad_transporte: string | null
    recepciones_items: RecepcionItem[]
    recepciones_documentos: Array<{ id: string }>
  } | null
}

export interface DetalleDevolucion {
  id: string
  cantidad: number
  motivo?: string | null
  es_vendible: boolean
  articulos: { id: string; sku: string; descripcion: string; ean13?: string[] | string | null }
}

export interface Devolucion {
  id: string
  numero_devolucion?: string | null
  estado: string
  observaciones?: string | null
  created_at: string
  clientes: { id: string; nombre: string; razon_social?: string | null } | null
  devoluciones_detalle: DetalleDevolucion[]
}

export interface CatProveedores { id: "proveedores"; items: Array<{ id: string; nombre: string }> }
export interface CatTipos { id: "tipos"; tiposBulto: string[]; tiposFraccion: string[] }
export interface CatTransportes { id: "transportes"; items: Array<{ id: string; nombre: string }> }

// ─── Payloads del outbox (servidor: lib/mobile/outbox/deposito.ts) ───────────

export interface OpPickingItem { pedido_id: string; pedido_detalle_id: string; cantidad_preparada: number; es_faltante: boolean; operario?: string }
export interface OpRecepcionItem { orden_compra_id: string; articulo_id: string; cantidad_fisica: number }
export interface OpStock { articulo_id: string; tipo: "correccion" | "entrada" | "salida"; cantidad: number; motivo?: string | null; stock_visto: number | null }
export interface OpDatos { articulo_id: string; cambios: Record<string, { antes: unknown; despues: unknown }> }
