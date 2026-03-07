export interface Viaje {
  id: string
  nombre: string
  fecha: string
  estado: 'pendiente' | 'asignado' | 'en_curso' | 'completado' | 'cancelado'
  vehiculo: string
  chofer_id: string
  chofer_nombre?: string
  chofer_email?: string
  pedidos_count?: number
  total_facturado?: number
  zonas?: string
  dinero_nafta: number
  gastos_peon: number
  gastos_hotel: number
  gastos_adicionales: number
  observaciones?: string
  created_at?: string
}

export interface Pedido {
  id: string
  numero_pedido: string
  fecha: string
  estado: 'pendiente' | 'asignado' | 'en_curso' | 'completado' | 'cancelado'
  cliente_id: string
  cliente_nombre: string
  direccion?: string
  telefono?: string
  localidad?: string
  bultos: number
  saldo_anterior: number
  saldo_actual: number
  total: number
  viaje_id?: string
  observaciones?: string
}

export interface Pago {
  id?: string
  viaje_id: string
  pedido_id: string
  cliente_id: string
  monto: number
  forma_pago: 'efectivo' | 'cheque' | 'transferencia'
  fecha: string
  observaciones?: string
  numero_cheque?: string
  banco?: string
  fecha_cheque?: string
  referencia_transferencia?: string
  registrado_por?: string
}

export interface Devolucion {
  id?: string
  pedido_id: string
  cliente_id: string
  motivo: string
  retira_viajante: boolean
  items: ArticuloItemDevolucion[]
  estado?: string
}

export interface ArticuloItemDevolucion {
  id: string
  articulo_id: string
  descripcion: string
  cantidad_original: number
  cantidad_devolver: number
  seleccionado: boolean
  precio?: number
  fecha_venta?: string
  origen?: 'pedido_actual' | 'ultima_factura'
}

export interface DevolucionItem {
  articulo_id: string
  cantidad: number
  descripcion?: string
}

export interface ResumenPagos {
  total_efectivo: number
  cantidad_cheques: number
  cantidad_transferencias: number
  total_cobrado: number
}

export interface Estadisticas {
  periodo: string
  total_viajes: number
  viajes_finalizados: number
  kilometros_recorridos: number
  pernoctadas: number
  total_facturado: number
  pedidos_entregados: number
  total_cobrado: number
}

export interface Profile {
  id: string
  nombre: string
  email: string
  rol: string
}

export interface Usuario {
  id: string
  nombre: string
  email: string
  telefono?: string
  estado: 'activo' | 'inactivo'
  created_at?: string
  updated_at?: string
}

export interface Role {
  id: string
  nombre: string
  descripcion?: string
}

export interface UsuarioConRoles extends Usuario {
  roles: string[]
}

export interface Articulo {
  id: string
  sku: string
  sigla?: string
  ean13?: string
  descripcion: string
  rubro: string
  categoria: string
  subcategoria?: string
  unidad: string
  unidad_medida?: "unidad" | "bulto"
  unidades_por_bulto?: number
  precio_venta: number
  precio_compra?: number
  descuento1?: number
  descuento2?: number
  descuento3?: number
  descuento4?: number
  porcentaje_ganancia?: number
  iva_compras?: "factura" | "adquisicion_stock" | "mixto"
  iva_ventas?: "factura" | "adquisicion_stock" | "mixto"
  stock_actual?: number
  stock_minimo?: number
  orden_deposito?: number
  proveedor_id?: string
  proveedor?: Proveedor
  activo?: boolean
  created_at?: string
  updated_at?: string
}

export interface Proveedor {
  id: string
  nombre: string
  sigla?: string
  codigo_proveedor?: string
  cuit?: string
  telefono?: string
  email?: string
  direccion?: string
  codigo_postal?: string
  localidad?: string
  provincia?: string
  codigo_provincia_dj?: number
  telefono_oficina?: string
  telefono_vendedor?: string
  mail_vendedor?: string
  mail_oficina?: string
  tipo_iva?: number
  condicion_pago_tipo?: "cuenta_corriente" | "contado" | "anticipado"
  plazo_dias?: number
  plazo_desde?: "fecha_factura" | "fecha_recepcion"
  tipo_proveedor?: "mercaderia_general" | "servicios"
  banco_nombre?: string
  banco_cuenta?: string
  banco_numero_cuenta?: string
  banco_tipo_cuenta?: string
  tipo_pago?: string[]
  retencion_iibb?: number
  retencion_ganancias?: number
  percepcion_iva?: number
  percepcion_iibb?: number
  tipo_descuento?: "cascada" | "sobre_lista"
  default_unidad_factura?: "UNIDAD" | "BULTO" | "CAJA" | "PACK" | "DOCENA"
  activo?: boolean
  created_at?: string
  updated_at?: string
}

export type UserRole = 'admin' | 'vendedor' | 'viajante' | 'cliente' | 'chofer' | 'operador'

export interface OrdenCompra {
  id: string
  numero_oc: string
  numero_orden?: string
  proveedor_id: string
  proveedor?: Proveedor
  fecha_emision: string
  fecha_orden?: string
  fecha_entrega_estimada?: string
  estado: 'borrador' | 'enviada' | 'confirmada' | 'recibida' | 'cancelada' | 'pendiente'
  subtotal: number
  descuento?: number
  total: number
  observaciones?: string
  comprobantes?: any[]
  created_at?: string
  updated_at?: string
}
