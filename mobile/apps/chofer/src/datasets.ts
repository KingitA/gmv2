import type { DefDataset } from "@gm/core"
import type { ContextoDevolucion, OrigenDevolucion } from "@gm/vendedor"

// Datasets que replica la app Chofer (servidor: lib/mobile/sync/chofer.ts). MOBILE.md → "Chofer".
//
// Prioridad = orden de descarga. Primero la identidad y la hoja de ruta (lo que se ve al
// abrir), después la ficha de cada parada (la pantalla crítica), la billetera y los
// catálogos (clientes para cobro conjunto, artículos para devoluciones, cuentas bancarias).
export const DS = {
  me: "chofer_me",
  viajes: "chofer_viajes",
  clientesViaje: "chofer_viaje_clientes",
  billetera: "chofer_billetera",
  catalogos: "chofer_catalogos",
  clientes: "chofer_clientes",
  articulos: "chofer_articulos",
} as const

const MIN = 60_000
export const DATASETS: DefDataset[] = [
  { nombre: DS.me, prioridad: 1, cadaMs: 5 * MIN },
  { nombre: DS.viajes, prioridad: 2, cadaMs: 5 * MIN },
  { nombre: DS.clientesViaje, prioridad: 3, cadaMs: 10 * MIN },
  { nombre: DS.billetera, prioridad: 4, cadaMs: 10 * MIN },
  { nombre: DS.catalogos, prioridad: 5, cadaMs: 60 * MIN },
  { nombre: DS.clientes, prioridad: 6, cadaMs: 30 * MIN },
  { nombre: DS.articulos, prioridad: 7, cadaMs: 60 * MIN },
]

/** Clave de la fila de chofer_viaje_clientes (= lib/mobile/sync/chofer.ts). */
export const idClienteViaje = (viajeId: string, clienteId: string) => `${viajeId}:${clienteId}`

/** Estados en los que el chofer todavía puede cobrar / corregir cobros. */
export const ESTADOS_COBRABLES = ["despachado", "en_curso", "en_rendicion"]
export const esEnCurso = (estado: string) => estado === "en_curso" || estado === "despachado"

// ─── Identidad ───────────────────────────────────────────────────────────────

export interface ViajeResumen {
  id: string
  nombre: string | null
  fecha: string
  estado: string
  zonas?: { nombre: string } | null
}

export interface ChoferMe {
  id: "me"
  usuario: { id: string; nombre: string | null; email: string | null }
  viaje_activo: ViajeResumen | null
  historial: ViajeResumen[]
}

// ─── Hoja de ruta (= lib/viajes/hoja-ruta.ts, la parte que usa el chofer) ────

export interface RemitoHoja { id: string; tipo_remito: string; numero_remito: string; estado_pdf: string }
export interface PedidoHoja {
  /** #22 */
  pallets?: number
  id: string
  numero: string
  estado: string
  total: number
  bultos: number
  vendedor: string
  comprobantes: Array<{ id: string; tipo: string; numero: string; total: number; saldo: number }>
  remitos: RemitoHoja[]
}
export interface PagoHoja {
  id: string
  monto: number
  estado: string
  fecha: string
  cargado_por: string
  metodos: Array<{ tipo: string; monto: number; detalle: string }>
  imputaciones: Array<{ comprobante: string; monto: number; de_este_viaje: boolean }>
  a_cuenta: number
  contado_10: boolean
  ajuste: number
  /** Clave con la que este equipo lo registró (el overlay no lo cuenta dos veces mientras la operación sale de la cola) */
  idempotency_key?: string | null
}
export interface ParadaHoja {
  id: string
  orden: number
  cliente_id: string
  cliente_nombre: string
  direccion: string
  localidad: string
  telefono: string
  vendedores: string[]
  exigir_cobro_anterior: boolean
  exigir_cobro_actual: boolean
  bloquear_entrega: boolean
  motivo_bloqueo: string | null
  nota_oficina: string | null
  estado: string
  bultos_entregados: number | null
  motivo_no_entrega: string | null
  motivo_no_cobro: string | null
  resuelto_at: string | null
  pedidos: PedidoHoja[]
  bultos: number
  /** #22: pallets de la parada (los carga la oficina). Falta en réplicas viejas. */
  pallets?: number
  total_viaje: number
  saldo_anterior: number
  total_a_cobrar: number
  /** Lo exigido NETO de lo devuelto en el viaje (#27) */
  minimo_exigido: number
  /** 10 % contado y ajuste de los cobros del viaje: también cubren lo exigido (#27). Falta en réplicas viejas. */
  descuentos_cobro?: number
  cobrado: number
  cobrado_anterior: number
  cobrado_viaje: number
  devuelto: number
  /** cobrado + descuentos_cobro ≥ minimo_exigido */
  cobro_cumplido: boolean
  /** #23: "NO ENTREGAR SIN COBRAR" y todavía no cubrió lo exigido → solo se puede marcar "no entregado". Falta en réplicas viejas. */
  entrega_bloqueada?: boolean
  pagos: PagoHoja[]
}
export interface GastoHoja {
  id: string
  categoria: string
  monto: number
  observaciones: string | null
  estado: string
  cargado_por: string
  foto_url: string | null
  fecha: string
}
export interface DineroHoja {
  fondo_entregado: number
  fondos: Array<{ id: string; monto: number; origen: string; retirado_por: string; entregado_por: string; fecha: string }>
  gastos: GastoHoja[]
  gastos_total: number
  cobrado_efectivo: number
  cobrado_cheques: number
  cheques_cantidad: number
  cobrado_transferencias: number
  efectivo_en_mano: number
  saldo_billetera_titular: number
}

/** = GET /api/chofer/viaje/[id]. id = viaje.id */
export interface ViajeDetalle {
  id: string
  viaje: { id: string; nombre: string | null; fecha: string; estado: string; zona_nombre: string; es_titular: boolean; chofer_id: string | null; vehiculo?: string | null }
  paradas: ParadaHoja[]
  dinero: DineroHoja | null
  tripulacion: Array<{ usuario_id: string; nombre: string; rol: string }>
}

// ─── Ficha del cliente en el viaje (= lib/viajes/cliente-viaje.ts + cobro + comprados) ─

export interface DetallePedido {
  id: string
  articulo_id: string
  cantidad: number
  precio_final: number
  subtotal: number
  es_bonificado?: boolean | null
  articulos: { sku: string | null; descripcion: string; unidades_por_bulto?: number | null } | null
}
export interface ComprobantePendiente { id: string; tipo_comprobante: string; numero_comprobante: string; fecha: string; total_factura: number; saldo_pendiente: number }
export interface DevolucionRow {
  id: string
  numero_devolucion: string
  /** Bruto (cantidad × precio original) */
  monto_total: number
  /** Lo que descuenta en el cobro = lo que valdrá la NC (regla única valor-devolucion: −10 % si la factura fue contado). Falta en réplicas viejas. */
  valor_cobro?: number
  /** La factura de origen ya tenía el 10 % contado (el valor ya viene neto). Falta en réplicas viejas. */
  aplica_10?: boolean
  estado: string
  devoluciones_detalle?: Array<{ id: string; articulo_id: string; cantidad: number; precio_venta_original: number; motivo: string; condicion: string; comprobante_venta_id?: string | null; estado_renglon?: string | null; bonificado_contado?: boolean | null; articulos?: { sku: string | null; descripcion: string } | null }>
  /** Registrada en este equipo y todavía sin enviar */
  local?: boolean
}
export interface PagoRegistrado {
  id: string
  monto: number
  estado: string
  created_at: string
  idempotency_key?: string | null
  /** Registrado en este equipo: sin enviar / enviando / rechazado */
  local?: { opKey: string; estado: string; error: string | null }
}
export interface ComprobanteCobro {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  fecha: string
  total_neto: number
  total_factura: number
  saldo_pendiente: number
  estado_pago: string
  pedido_id: string | null
  /** Lo que ya está tomado: cobros sin confirmar del vendedor u otro viaje (servidor) + cobros de este equipo sin enviar */
  en_cobro?: number
  /** NC del 10 % contado que le corresponde (regla 07/10: 10 % del TOTAL, una vez; 0 = ya la tiene o no bonifica). Falta en réplicas viejas. */
  nc_contado?: number
}
export interface PedidoCobro { id: string; numero_pedido: string; fecha: string; total: number; estado: string; pago_contado_10?: boolean | null; anticipo_pago_id?: string | null }
export interface CuentaCobro {
  comprobantes: ComprobanteCobro[]
  pedidos: PedidoCobro[]
  pedidos_facturados: string[]
  dtos_hechos: string[]
}
export interface Comprado {
  articulo_id: string
  sku: string | null
  ean13?: string | string[] | null
  descripcion: string
  imagen_url: string | null
  unidades_por_bulto?: number | null
  ultimo_precio: number
  ultima_fecha: string
  comprobante_venta_id: string | null
  numero_comprobante: string
  tipo_comprobante: string
  cantidad_total: number
  /** La factura de origen tiene bonificación contado viva: una devolución de esa mercadería vale 10 % menos */
  bonificado_contado?: boolean
  /** Origen de devolución (= OrigenDevolucion, 21/10/2026). Faltan en réplicas viejas */
  fiscal?: boolean
  percepcion_iva?: boolean
  exacto?: boolean
  precio?: number | null
  iva_unitario?: number | null
}

export interface ClienteViajeRow {
  id: string
  viaje_id: string
  cliente_id: string
  cliente: { nombre: string | null; razon_social: string | null; direccion: string | null; telefono: string | null; cuit: string | null; condicion_pago: string | null } | null
  pedido: { id: string; numero: string; fecha: string; estado: string; total: number; bultos: number; observaciones: string | null; detalle: DetallePedido[] } | null
  comprobantes_pendientes: ComprobantePendiente[]
  devoluciones: DevolucionRow[]
  pagos_registrados: PagoRegistrado[]
  /** Cobros sin confirmar que NO son de este viaje (oficina, vendedor u otro viaje). Faltan en réplicas viejas. */
  cobros_sin_confirmar?: Array<{ id: string; monto: number; created_at: string; origen: "viaje" | "oficina" }>
  /** Devoluciones en proceso de otros viajes (ya descuentan del saldo). Faltan en réplicas viejas. */
  otras_devoluciones?: Array<{ id: string; numero_devolucion: string; estado: string; valor: number; created_at: string }>
  resumen: {
    saldo_anterior: number
    saldo_real: number
    saldo_proyectado: number
    pendiente_verificacion: number
    total_pedido: number
    total_devuelto: number
    total_cobrado: number
    total_a_cobrar: number
    ya_cobrado: boolean
  }
  viaje_estado: string
  cobro: CuentaCobro
  comprados: Comprado[]
  /** Para valuar devoluciones igual que el servidor (IIBB vigente, comprobante más reciente). Ausente = réplica vieja */
  contexto_devolucion?: ContextoDevolucion | null
  /** #25: por (comprobante de origen, artículo) lo vendido y lo ya devuelto (= tope del servidor). Ausente = réplica vieja */
  devolvible?: Array<{ comprobante_venta_id: string; articulo_id: string; vendido: number; devuelto: number }> | null
}

// ─── Billetera (= GET /api/chofer/billetera) ─────────────────────────────────

export interface CobroBilletera { id: string; fecha: string; cliente: string; viaje: string; monto: number; metodos: string[]; estado: "en_mano" | "en_rendicion" | "rendido" | "sin_enviar" | "rechazado"; error?: string | null; idempotency_key?: string | null }
/** Cuenta personal del chofer (= su cuenta de cliente; cuentas corrientes etapa 3). null = la oficina no la vinculó. */
export interface CuentaPersonalChofer { cliente_id: string; saldo_real: number; saldo_proyectado: number; a_favor: number; comisiones_ganadas: number; retiros: number }
export interface GastoBilletera { id: string; viaje: string; categoria: string; monto: number; estado: string; observaciones: string | null; created_at: string; local?: boolean; motivo_rechazo?: string | null }
export interface FondoBilletera { id: string; viaje: string; monto: number; created_at: string }
export interface BilleteraData {
  id: "billetera"
  efectivo: number
  desglose: { cobros_efectivo: number; fondo_viaje: number; gastos: number; cheques_monto: number; transferencias: number; en_rendicion: number }
  cheques_cantidad: number
  /** > 0 a favor del chofer, < 0 debe (sale de la cuenta personal si está vinculada) */
  saldo_cuenta_corriente: number
  cuenta_personal?: CuentaPersonalChofer | null
  cobros: CobroBilletera[]
  gastos: GastoBilletera[]
  fondos: FondoBilletera[]
}

// ─── Catálogos ───────────────────────────────────────────────────────────────

export interface ClienteBusqueda {
  id: string
  nombre: string | null
  razon_social: string | null
  nombre_razon_social: string | null
  cuit: string | null
  codigo_cliente: string | null
  direccion: string | null
  localidad: string | null
  saldo_actual: number
  /** Fuente única (lib/cuenta-corriente/saldo.ts); falta en réplicas viejas */
  saldo_proyectado?: number
}
export const nombreCliente = (c: { nombre?: string | null; razon_social?: string | null; nombre_razon_social?: string | null } | null | undefined) =>
  c?.nombre_razon_social || c?.razon_social || c?.nombre || "Cliente"

export interface Articulo {
  id: string
  sku: string | null
  ean13: string | string[] | null
  descripcion: string
  imagen_url: string | null
  unidades_por_bulto: number | null
  marca?: string | null
  proveedor?: string | null
}

export interface CuentaBancaria { id: string; banco: string; nombre: string; alias: string | null }

// ─── Operaciones del outbox (servidor: lib/mobile/outbox/chofer.ts) ──────────

export interface MetodoPayload {
  tipo: "efectivo" | "cheque" | "transferencia"
  monto: number
  banco_emisor?: string
  numero_cheque?: string
  fecha_cheque?: string
  fecha_emision?: string
  cuit_emisor?: string
  color_cheque?: string
  es_echeq?: boolean
  numero_comprobante?: string
  cuenta_bancaria_id?: string
}
export interface OpCobrar {
  viaje_id: string
  cliente_id: string
  /** Solo para mostrarlo en la billetera antes de que sincronice (el servidor lo ignora) */
  cliente_nombre: string
  monto_total: number
  metodos: MetodoPayload[]
  imputaciones: Array<{ comprobante_id: string; monto_imputado: number }>
  devolucion_ids: string[]
  comprobante_urls: Array<{ url: string }>
  pedidos_contado: string[]
  /** Anticipos a pedidos sin facturar de la selección (el servidor marca el 10 % solo sobre estos) */
  pedidos_anticipo?: Array<{ pedido_id: string; monto: number }>
  contado_general: boolean
  ajuste_redondeo: number
  /** Lo que el 10 % contado y el ajuste bajan además de la plata (estimado en el equipo). Solo lo usa el overlay sin señal para "cobró lo exigido" (#23/#27); el servidor lo ignora. */
  descuento_estimado?: number
  /** Legado (APK ≤ 0.2.1): otro cliente con un monto en efectivo a cuenta. Las apps nuevas mandan `clientes_extra`. */
  cobros_extra: Array<{ cliente_id: string; cliente_nombre?: string; metodos: MetodoPayload[]; imputaciones: [] }>
  /** Cobro conjunto: clientes agregados, cada uno con su selección. El servidor reparte `metodos` entre todos. */
  clientes_extra?: OpClienteExtra[]
  fotos_pendientes: Array<{ b64: string; mime: string; nombre: string }>
}
export interface OpClienteExtra {
  cliente_id: string
  cliente_nombre?: string
  /** Lo que se le cobra a este cliente (parte de `monto_total`) */
  monto: number
  imputaciones: Array<{ comprobante_id: string; monto_imputado: number }>
  devolucion_ids: string[]
  pedidos_contado: string[]
  pedidos_anticipo: Array<{ pedido_id: string; monto: number }>
  contado_general: boolean
  /** = OpCobrar.descuento_estimado, para la parada de este cliente */
  descuento_estimado?: number
}
export interface OpCobroAnular { viaje_id: string; pago_id: string; cliente_id: string }
export interface ItemDevolucion {
  articulo_id: string
  sku: string | null
  descripcion: string
  cantidad: number
  precio_venta_original: number
  motivo: string
  condicion: "vendible" | "no_vendible"
  origen: "pedido" | "vieja"
  comprobante_venta_id?: string | null
  /** Comprobante de origen y cómo se valúa (regla del dueño 21/10/2026). Falta en borradores viejos */
  origen_comp?: OrigenDevolucion | null
}
export interface OpDevolucion {
  viaje_id: string
  id: string
  cliente_id: string
  pedido_id: string | null
  items: ItemDevolucion[]
  /** Valor con la regla única (valorDevolucion: −10 % si la factura fue contado): lo que el overlay descuenta mientras no sincroniza. El servidor lo ignora y lo recalcula. */
  valor_estimado?: number
}
export interface OpParada { viaje_id: string; parada_id: string; cliente_id: string; estado: string; bultos_entregados?: number; motivo_no_entrega?: string; motivo_no_cobro?: string }
export interface OpGasto { viaje_id: string | null; viaje_nombre?: string; categoria: string; monto: number; observaciones: string | null; foto_url: string | null }
export interface OpFinalizar { viaje_id: string; efectivo_declarado: number; observaciones?: string | null }
export interface OpIniciar { viaje_id: string }

export const MOTIVOS_DEVOLUCION = ["diferencia_precios", "rotura", "vencido", "no_pedido", "otro"]
export const CATEGORIAS_GASTO = [
  ["nafta", "⛽ Nafta"], ["peon", "💪 Peón"], ["hotel", "🛏 Hotel"], ["peaje", "🛣 Peaje"],
  ["comida", "🍽 Comida"], ["cubierta", "🛞 Cubierta"], ["otro", "• Otro"],
] as const
