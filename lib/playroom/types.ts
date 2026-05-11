export interface PlayroomTab {
  id: string
  label: string
  icon: string
  description: string
}

export interface KPICardData {
  label: string
  value: string | number
  subLabel?: string
  badge?: { pct: number; label?: string }
  variant?: 'default' | 'warning' | 'danger' | 'success'
}

export interface DataTableColumn<T> {
  key: string
  label: string
  sortable?: boolean
  align?: 'left' | 'right' | 'center'
  render?: (value: any, row: T) => React.ReactNode
  exportValue?: (value: any, row: T) => string
}

export interface PlayroomFiltersState {
  dateFrom: string
  dateTo: string
  comparePeriod: 'previous' | 'year_ago' | 'none'
}

// Reporte 1 — Rotación & Stock Muerto
export interface StockMuertoRow {
  articulo_id: string
  sku: string
  descripcion: string
  proveedor_nombre: string
  marca_nombre: string
  rubro: string
  stock_actual: number
  ultimo_costo: number
  capital_inmovilizado: number
  ultima_venta: string | null
  dias_sin_venta: number
  velocidad_90d: number
  dias_stock_proyectados: number
  sugerencia: 'Liquidar' | 'Devolver' | 'OK'
}

// Reporte 2 — Ranking ABC de Clientes
export interface ClienteABCRow {
  cliente_id: string
  nombre: string
  localidad: string
  vendedor_nombre: string
  facturacion_periodo: number
  facturacion_anterior: number
  variacion_pct: number
  variacion_anio_pct: number
  margen_pesos: number
  margen_pct: number
  dias_promedio_cobro: number
  cantidad_comprobantes: number
  ultima_compra: string | null
  clasificacion: 'A' | 'B' | 'C'
  estado: 'Activo' | 'En riesgo' | 'Perdido' | 'Nuevo'
}

// Reporte 3 — Cuentas Corrientes
export interface CuentaCorrienteRow {
  cliente_id: string
  nombre: string
  vendedor_nombre: string
  total_deuda: number
  tramo_0_30: number
  tramo_31_60: number
  tramo_61_90: number
  tramo_90_mas: number
  comprobante_mas_viejo: string | null
  dias_promedio_mora: number
  ultima_cobranza: string | null
}

// Reporte 4 — Artículos Vendidos
export interface ArticuloVendidoRow {
  articulo_id: string
  sku: string
  descripcion: string
  proveedor_nombre: string
  marca_nombre: string
  rubro: string
  unidades_vendidas: number
  devoluciones_unidades: number
  venta_neta_unidades: number
  importe_neto: number
  total_iva: number
  total_facturado: number
  costo_total: number
  margen_pesos: number
  margen_pct: number
  variacion_pct: number
  clientes_unicos: number
}

// Reporte 5 — Comisiones
export interface ComisionContableRow {
  id: string
  viajante_nombre: string
  pedido_numero: string
  cliente_nombre: string
  fecha: string
  comprobante: string
  total_venta: number
  porcentaje: number
  monto: number
  pagado: boolean
  comprobante_cobrado: boolean
}

export interface ComisionPerformanceRow {
  viajante_id: string
  viajante_nombre: string
  facturacion: number
  margen_pct: number
  margen_pesos: number
  dias_promedio_cobro: number
  tasa_mora: number
  comision_devengada: number
  comision_efectiva_pct: number
}
