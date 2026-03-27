export type UserRole = "admin" | "vendedor" | "cliente"
export type UserStatus = "pendiente" | "activo" | "rechazado"
export type PaymentMethod = "efectivo" | "transferencia" | "cheque" | "tarjeta"
export type OrderStatus =
  | "borrador"
  | "pendiente"
  | "confirmado"
  | "en_preparacion"
  | "en_viaje"
  | "entregado"
  | "cancelado"
export type TipoMovimiento = "entrada" | "salida" | "ajuste" | "devolucion"

// UsuarioCRM interface for the usuarios_crm table
export interface UsuarioCRM {
  id: string
  email: string
  nombre_completo: string
  telefono: string | null
  empresa: string | null
  rol: UserRole
  estado: UserStatus
  cliente_id: number | null
  viajante_id: number | null
  created_at: string
  updated_at: string
  aprobado_por: string | null
  aprobado_at: string | null
  notas_admin: string | null
}

// Vendedores (Viajantes/Salespeople)
export interface Vendedor {
  id: string
  nombre: string
  email: string
  telefono: string | null
  comision_perfumeria: number
  comision_bazar_limpieza: number
  activo: boolean
  created_at: string
}

// Clientes (Customers)
export interface Cliente {
  id: string
  codigo_cliente?: string | null
  nombre: string
  razon_social: string | null
  nombre_razon_social: string | null
  cuit: string | null
  direccion: string | null
  localidad: string | null
  provincia: string | null
  localidad_id: string | null
  telefono: string | null
  mail: string | null
  email?: string | null
  vendedor_id: string | null
  condicion_iva: string | null
  condicion_pago: string | null
  tipo_canal: string | null
  nivel_puntaje: string | null
  puntaje: number | null
  porcentaje_ajuste: number | null
  exento_iva: boolean
  exento_iibb: boolean
  percepcion_iibb: number | null
  nro_iibb: string | null
  metodo_facturacion: string | null
  zona?: string | null
  dias_credito?: number | null
  limite_credito?: number | null
  descuento_especial?: number | null
  aplica_percepciones?: boolean | null
  observaciones?: string | null
  activo: boolean
  created_at: string
}

// Artículos (Products)
export interface Articulo {
  id: string
  sku: string
  ean13: string | null
  descripcion: string | null
  categoria: string | null
  subcategoria: string | null
  rubro: string | null
  proveedor_id: string | null
  precio_compra: number
  /** Precio base almacenado. Si está seteado se usa directamente; si es null se calcula desde precio_compra - descuentos + margen */
  precio_base?: number | null
  /** Precio base con descuento de pago contado (10%). Se actualiza automáticamente vía trigger: precio_base * 0.9 */
  precio_base_contado?: number | null
  margen_ganancia_custom: number | null
  descuento_propio: number | null
  descuento1: number | null
  descuento2: number | null
  descuento3: number | null
  descuento4: number | null
  stock_actual: number
  unidades_por_bulto: number | null
  unidad_medida: string | null
  sigla: string | null
  orden_deposito: number | null
  activo: boolean
  created_at: string
  updated_at: string
}

// Pedidos (Orders)
export interface Pedido {
  id: string
  numero_pedido: string | null
  cliente_id: string
  vendedor_id: string | null
  viaje_id: string | null
  fecha: string
  estado: OrderStatus
  punto_venta: string | null
  subtotal: number
  descuento_vendedor: number | null
  descuento_general: number | null
  total_flete: number | null
  total_impuestos: number | null
  total_comision: number | null
  total: number
  observaciones: string | null
  created_at: string
}

// Pedidos Detalle (Order Items)
export interface PedidoDetalle {
  id: string
  pedido_id: string
  articulo_id: string
  cantidad: number
  precio_costo: number | null
  precio_base: number
  precio_final: number
  descuento_articulo: number | null
  flete: number | null
  impuestos: number | null
  comision: number | null
  subtotal: number
  created_at: string
}

// Viajes (Trips)
export interface Viaje {
  id: string
  nombre: string
  zona_id: string | null
  fecha: string
  estado: string
  tipo_transporte: string | null
  transporte_id: string | null
  chofer: string | null
  vehiculo: string | null
  porcentaje_flete: number | null
  dinero_nafta: number | null
  gastos_hotel: number | null
  gastos_peon: number | null
  gastos_adicionales: number | null
  observaciones: string | null
  created_at: string
}

// Zonas (Zones)
export interface Zona {
  id: string
  nombre: string
  descripcion: string | null
  tipo_flete: string | null
  porcentaje_flete: number | null
  costo_nafta: number | null
  costo_pernoctada: number | null
  costo_sueldo: number | null
  costo_otros: number | null
  dias_visita: string | null
  transporte_id: string | null
  created_at: string
}

// Comprobantes de Venta (Sales Invoices)
export interface ComprobanteVenta {
  id: string
  tipo_comprobante: string
  numero_comprobante: string | null
  cliente_id: string
  pedido_id: string | null
  fecha: string
  fecha_vencimiento: string | null
  total_neto: number
  total_iva: number
  percepcion_iva: number | null
  percepcion_iibb: number | null
  total_factura: number
  saldo_pendiente: number | null
  estado_pago: string
  observaciones: string | null
  created_at: string
}

// Proveedores (Suppliers)
export interface Proveedor {
  id: string
  nombre: string
  sigla: string | null
  codigo_proveedor: string | null
  cuit: string | null
  direccion: string | null
  localidad: string | null
  provincia: string | null
  codigo_postal: string | null
  telefono: string | null
  email: string | null
  telefono_oficina: string | null
  telefono_vendedor: string | null
  mail_oficina: string | null
  mail_vendedor: string | null
  condicion_pago: string | null
  condicion_pago_tipo: string | null
  plazo_desde: string | null
  plazo_dias: number | null
  dias_vencimiento: number | null
  tipo_pago: string[] | null
  margen_ganancia: number | null
  percepcion_iva: number | null
  percepcion_iibb: number | null
  retencion_ganancias: number | null
  retencion_iibb: number | null
  tipo_proveedor: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

// User metadata for auth
export interface UserMetadata {
  role: UserRole
  vendedor_id?: string
  cliente_id?: string
}
