import type { DefDataset } from "@gm/core"

// Datasets que replica la app Vendedor (servidor: lib/mobile/sync/vendedor.ts y,
// para los insumos de precio, lib/mobile/sync/datasets.ts). MOBILE.md → "Vendedor".
//
// Prioridad = orden de descarga. Los PRECIOS van primero y son `invalidable`: un
// cambio en el ERP llega en segundos (sondeo de 15 s). Catálogo y pedidos son delta
// (baratos de refrescar). Lo caro por fila (cuenta corriente) se refresca cada tanto
// y, con señal, solo el cliente que se abre (replica.refrescarIds).
export const DS = {
  preciosListas: "precios_listas",
  preciosReglas: "precios_reglas",
  preciosProgramados: "precios_programados",
  preciosArticulos: "precios_articulos",
  preciosClientes: "precios_clientes",
  me: "vendedor_me",
  articulos: "vendedor_articulos",
  catalogos: "vendedor_catalogos",
  clientes: "vendedor_clientes",
  cc: "vendedor_cc",
  pedidos: "vendedor_pedidos",
  billetera: "vendedor_billetera",
  viajes: "vendedor_viajes",
} as const

/** Datasets que alimentan el motor de precios: su frescura más VIEJA es `precios_al`. */
export const DS_PRECIOS = [DS.preciosListas, DS.preciosReglas, DS.preciosProgramados, DS.preciosArticulos, DS.preciosClientes] as const

const MIN = 60_000
export const DATASETS: DefDataset[] = [
  { nombre: DS.preciosListas, prioridad: 1, invalidable: true, cadaMs: 5 * MIN },
  { nombre: DS.preciosReglas, prioridad: 1, invalidable: true, cadaMs: 5 * MIN },
  { nombre: DS.preciosProgramados, prioridad: 1, invalidable: true, cadaMs: 5 * MIN },
  { nombre: DS.preciosArticulos, prioridad: 2, invalidable: true, cadaMs: 10 * MIN },
  { nombre: DS.preciosClientes, prioridad: 2, invalidable: true, cadaMs: 10 * MIN },
  { nombre: DS.articulos, prioridad: 3, invalidable: true, cadaMs: 10 * MIN },
  { nombre: DS.clientes, prioridad: 3, cadaMs: 3 * MIN },
  { nombre: DS.catalogos, prioridad: 4, cadaMs: 30 * MIN },
  { nombre: DS.me, prioridad: 4, cadaMs: 5 * MIN },
  { nombre: DS.pedidos, prioridad: 5, invalidable: true, cadaMs: 5 * MIN },
  { nombre: DS.cc, prioridad: 6, cadaMs: 15 * MIN },
  { nombre: DS.viajes, prioridad: 7, cadaMs: 10 * MIN },
  { nombre: DS.billetera, prioridad: 8, cadaMs: 10 * MIN },
]

// ─── Catálogo ────────────────────────────────────────────────────────────────

/** = mapArticuloVendedor de la web + campos para resolver sin red (proveedor, novedades, códigos). */
export interface Articulo {
  id: string
  sku: string | null
  ean13: string | string[] | null
  descripcion: string
  unidades_por_bulto: number | null
  tipo_fraccion?: string | null
  cantidad_fraccion?: number | null
  stock_disponible: number
  descuento_propio: number
  iva_ventas: string | null
  marca: string | null
  proveedor: string | null
  imagen_url: string | null
  rubro_id: string | null
  categoria_id: string | null
  subcategoria_id: string | null
  rubro_nombre: string | null
  categoria_nombre: string | null
  subcategoria_nombre: string | null
  proveedor_id: string | null
  marca_id: string | null
  codigo_bulto: string | null
  sigla: string | null
  created_at: string | null
  /** Solo en la vista "habituales" */
  veces_pedido?: number
  cantidad_habitual?: number
}

export interface CatalogoSubcategoria { id: string; nombre: string; cantidad: number }
export interface CatalogoCategoria { id: string; nombre: string; cantidad: number; subcategorias: CatalogoSubcategoria[] }
export interface CatalogoRubro { id: string; nombre: string; slug?: string | null; descripcion?: string | null; imagen_url?: string | null; cantidad?: number; categorias: CatalogoCategoria[] }
export interface ProveedorCatalogo { id: string; nombre: string; sigla: string | null; cantidad: number }
export interface ListaPrecio { id: string; nombre: string; codigo?: string | null }

export interface CatalogosFicha {
  condiciones_pago: Array<{ id: string; nombre: string }>
  condiciones_entrega: Array<{ id: string; codigo: string; nombre: string }>
  zonas: Array<{ id: string; nombre: string }>
  localidades: Array<{ id: string; nombre: string; provincia: string | null }>
  listas_precio: ListaPrecio[]
  vendedores: Array<{ id: string; nombre: string; lista_precio_id?: string | null; lista_nombre?: string | null }>
  segmentos: Array<{ key: Segmento; label: string }>
  condiciones_iva: string[]
  metodos_facturacion: string[]
  puede_cambiar_lista: boolean
}

export interface ZonaViaje { id: string; nombre: string; descripcion: string | null; dias_visita?: unknown; cantidad_clientes: number; mis_clientes: number }

// ─── Clientes ────────────────────────────────────────────────────────────────

export type Segmento = "limpieza_bazar" | "perf0" | "perf_plus"
export const SEGS: Segmento[] = ["limpieza_bazar", "perf0", "perf_plus"]
export const SEG_LABEL: Record<Segmento, string> = { limpieza_bazar: "Limpieza / Bazar", perf0: "Perfumería 0", perf_plus: "Perfumería plus" }
export type BonifSeg = Partial<Record<Segmento, number>>
export interface BonifTipos { viajante: BonifSeg; mercaderia: BonifSeg }

/** Fila de la cartera: listado web + campos de la ficha + bonificaciones. */
export interface Cliente {
  id: string
  nombre: string
  razon_social: string | null
  cuit: string | null
  codigo_cliente: string | null
  direccion: string | null
  localidad: string | null
  localidad_id: string | null
  provincia: string | null
  telefono: string | null
  mail: string | null
  condicion_iva: string | null
  condicion_pago: string | null
  condicion_entrega: string | null
  metodo_facturacion: string | null
  vendedor_id: string | null
  lista_precio_id: string | null
  lista?: { nombre: string } | null
  saldo_actual: number
  saldo_proyectado: number
  pagos_sin_rendir: number
  bonificaciones: BonifTipos
  /** Alta hecha en este equipo que todavía no llegó al servidor */
  sinEnviar?: boolean
}

export interface ComprobanteCC {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  fecha: string
  total_factura: number
  saldo_pendiente: number
  estado_pago: string
  pedido_id: string | null
  en_cobro: number
  en_cobro_contado: number
}
export interface PedidoCobro { id: string; numero_pedido: string; fecha: string; estado: string; total: number; pago_contado_10: boolean; anticipo_pago_id: string | null; facturado: boolean; cobrable: boolean }
export interface DevolucionPendiente { id: string; numero_devolucion: string; pedido_id: string | null; monto_total: number; created_at?: string; descontado?: number; restante: number }
export interface CreditoCC { id: string; tipo_comprobante: string; numero_comprobante: string; fecha?: string; saldo_pendiente: number }
export interface ACuenta { pago_id: string; fecha: string; estado: string; monto: number; mia: boolean; disponible: number }
export interface PagoReciente { id: string; fecha_pago: string; monto: number; estado: string; forma_pago: string | null; verificado: boolean; eliminable: boolean }
export interface Comprado {
  articulo_id: string; sku: string | null; descripcion: string; imagen_url: string | null; ean13?: string | string[] | null
  ultimo_precio: number; ultima_fecha: string; comprobante_venta_id: string | null; numero_comprobante: string; tipo_comprobante: string; cantidad_total: number
}

/** = GET /api/vendedor/cliente/[id] + comprados + habituales. id = cliente.id */
export interface CuentaCliente {
  id: string
  cliente: Cliente & { pendiente_verificacion?: number; devoluciones_en_proceso?: number; actualizado_at?: string | null; actualizado_por_nombre?: string | null }
  comprobantes: ComprobanteCC[]
  creditos: CreditoCC[]
  a_cuenta: ACuenta[]
  total_a_favor: number
  pedidos_cobro: PedidoCobro[]
  devoluciones_pendientes: DevolucionPendiente[]
  pagos_recientes: PagoReciente[]
  comprados: Comprado[]
  habituales: Array<{ articulo_id: string; veces_pedido: number; cantidad_habitual: number }>
}

// ─── Pedidos ─────────────────────────────────────────────────────────────────

export interface DetallePedido {
  id: string
  articulo_id: string
  cantidad: number
  precio_base: number
  precio_final: number
  subtotal: number
  es_bonificado: boolean | null
  estado_item?: string | null
  descuento_propio_pct?: number | null
  bonif_viajante_pct?: number | null
  articulos: { id: string; sku: string | null; descripcion: string; unidades_por_bulto: number | null; imagen_url: string | null; marca?: { descripcion: string } | null } | null
}

export interface BonifPedido { general?: BonifSeg | null; viajante?: BonifSeg | null; mercaderia?: BonifSeg | null }

/** = GET /api/vendedor/pedidos/[id]. id = pedido.id */
export interface PedidoVendedor {
  id: string
  pedido: {
    id: string
    numero_pedido: string | null
    fecha: string
    estado: string
    total: number
    observaciones: string | null
    metodo_facturacion_pedido: string | null
    lista_precio_pedido_id: string | null
    bonif_pedido: BonifPedido | null
    cliente_id: string
    created_at: string
    clientes: { id: string; nombre: string; localidad: string | null; metodo_facturacion: string | null; lista_precio_id: string | null; lista?: { nombre: string } | null } | null
    pedidos_detalle: DetallePedido[]
  }
  comprobantes: Array<{ id: string; tipo_comprobante: string; numero_comprobante: string; estado_pdf: string | null }>
  remitos: Array<{ id: string; tipo_remito: string; numero_remito: string; estado_pdf: string | null }>
  descuentos: {
    segmentos: Array<{ segmento: Segmento; general: { pct: number; origen: string }; viajante: { pct: number; origen: string }; mercaderia: { pct: number; origen: string } }>
    condiciones: Array<{ ambito: string; origen: string; nombre: string; dto_general_pct: number; dto_viajante_pct: number; dto_mercaderia_pct: number }>
    solo_este_pedido: boolean
  }
}

// ─── Operaciones del outbox (servidor: lib/mobile/outbox/vendedor.ts) ────────

export interface CondPedido {
  /** "" = método del cliente */
  metodo: string
  /** "" = lista del cliente */
  lista: string
  /** null = bonificaciones de la ficha */
  bonif: { viajante?: BonifSeg | null; mercaderia?: BonifSeg | null } | null
}
export const COND_VACIA: CondPedido = { metodo: "", lista: "", bonif: null }

export interface ItemOpPedido {
  articulo_id: string
  cantidad: number
  precio: number
  detalle_id?: string | null
  /** El precio mostrado es el YA guardado del renglón (no se re-verifica contra el motor) */
  precio_fijo?: boolean
  /** Solo para mostrar el pedido mientras no llegó al servidor (el servidor los ignora) */
  precio_neto?: number
  descripcion?: string
  sku?: string | null
  unidades_por_bulto?: number | null
  imagen_url?: string | null
}

export interface OpPedido {
  local_id: string
  pedido_id?: string | null
  cliente_id: string
  items: ItemOpPedido[]
  cond: { metodo_facturacion_pedido?: string | null; lista_precio_pedido_id?: string | null; bonif_pedido?: CondPedido["bonif"] } | null
  observaciones: string | null
  precios_al: string | null
  /** false = solo guardar renglones, sin confirmar (edición desde el detalle del pedido) */
  confirmar?: boolean
  /** Para mostrarlo en "Mis pedidos" antes de que sincronice */
  vista: { cliente_nombre: string; total: number; numero_pedido?: string | null; estado?: string | null }
}

export interface OpClienteEditar { cliente_id: string; cambios: Record<string, { antes: unknown; despues: unknown }> }
export interface OpBonificaciones { cliente_id: string; viajante: BonifSeg; mercaderia: BonifSeg }
export interface OpCobroAnular { pago_id: string; cliente_id: string }
export interface OpViajeNoVa { viaje_id: string; cliente_id: string; no_va: boolean }
export interface OpViajeEstado { viaje_id: string; estado: "completado" | "en_curso" }

// ─── Viajes ──────────────────────────────────────────────────────────────────

export interface ViajeResumen { id: string; nombre: string; estado: string; fecha_inicio: string | null; fecha_fin_estimada: string | null; zonas: Array<{ id: string; nombre: string }> }
export interface ClienteViaje {
  id: string; nombre: string; localidad: string | null; telefono?: string | null; saldo_actual: number
  estado_viaje: "pendiente" | "pedido_levantado" | "no_va"
  pedido: { id: string; numero_pedido: string | null; total: number; estado: string } | null
}
/** id = viaje.id. `viaje`/`clientes` solo en los viajes con detalle replicado. */
export interface ViajeVendedor { id: string; resumen: ViajeResumen; viaje?: ViajeResumen; clientes?: ClienteViaje[]; sinEnviar?: boolean }
