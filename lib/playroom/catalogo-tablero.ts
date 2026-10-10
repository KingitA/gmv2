// Catálogo de tarjetas del tablero de Playroom. Cada usuario elige cuáles ver
// (se guarda en su computadora). Los valores los calcula /api/playroom/tablero,
// siempre leyendo la base: nada de esto modifica datos.

export type GrupoTarjeta = "Ventas" | "Cobranza y deuda" | "Operación" | "Compras y stock"

export interface TarjetaCatalogo {
  id: string
  titulo: string
  grupo: GrupoTarjeta
  /** qué muestra, en una línea, para el catálogo */
  descripcion: string
  /** columnas que ocupa en el tablero (de 6) */
  ancho: 1 | 2 | 3 | 6
}

export const CATALOGO_TABLERO: TarjetaCatalogo[] = [
  // Ventas
  { id: "ventas_mes", titulo: "Ventas del mes", grupo: "Ventas", descripcion: "Pedidos tomados en el mes, contra el mismo tramo del mes anterior", ancho: 1 },
  { id: "ventas_hoy", titulo: "Ventas de hoy", grupo: "Ventas", descripcion: "Pedidos tomados hoy, contra el promedio diario del mes", ancho: 1 },
  { id: "ticket_promedio", titulo: "Ticket promedio", grupo: "Ventas", descripcion: "Importe promedio de cada pedido del mes", ancho: 1 },
  { id: "clientes_compraron", titulo: "Clientes que compraron", grupo: "Ventas", descripcion: "Clientes distintos con pedido en el mes", ancho: 1 },
  { id: "margen_bruto", titulo: "Margen bruto", grupo: "Ventas", descripcion: "Venta sin IVA menos costo, sobre la venta del mes", ancho: 1 },
  { id: "grafico_ventas_dia", titulo: "Ventas acumuladas del mes", grupo: "Ventas", descripcion: "Gráfico día por día, este mes contra el anterior", ancho: 3 },
  { id: "ventas_por_zona", titulo: "Ventas por zona", grupo: "Ventas", descripcion: "Gráfico de barras del mes por zona", ancho: 3 },
  { id: "ventas_por_viajante", titulo: "Ventas por viajante", grupo: "Ventas", descripcion: "Gráfico de barras del mes por viajante", ancho: 3 },
  { id: "ventas_por_rubro", titulo: "Ventas por categoría", grupo: "Ventas", descripcion: "Gráfico de barras del mes por categoría de artículo", ancho: 3 },
  { id: "top_articulos", titulo: "Top 5 artículos del mes", grupo: "Ventas", descripcion: "Los que más vendieron (sin IVA)", ancho: 3 },
  // Cobranza y deuda
  { id: "cobrado_mes", titulo: "Cobrado del mes", grupo: "Cobranza y deuda", descripcion: "Cobros confirmados en Caja este mes", ancho: 1 },
  { id: "deuda_clientes", titulo: "Deuda de clientes", grupo: "Cobranza y deuda", descripcion: "Saldo a cobrar en cuenta corriente", ancho: 1 },
  { id: "cobros_pendientes", titulo: "Cobros por verificar", grupo: "Cobranza y deuda", descripcion: "Cobros registrados que Finanzas todavía no confirmó", ancho: 1 },
  { id: "clientes_mas_deben", titulo: "Clientes que más deben", grupo: "Cobranza y deuda", descripcion: "Los 5 saldos más altos de cuenta corriente", ancho: 3 },
  // Operación
  { id: "pedidos_preparar", titulo: "Pedidos para preparar", grupo: "Operación", descripcion: "Pendientes, impresos y en preparación", ancho: 1 },
  { id: "viajes_calle", titulo: "Viajes en la calle", grupo: "Operación", descripcion: "Viajes en curso y esperando rendición", ancho: 1 },
  { id: "devoluciones_mes", titulo: "Devoluciones del mes", grupo: "Operación", descripcion: "Devoluciones cargadas este mes", ancho: 1 },
  // Compras y stock
  { id: "pagos_7dias", titulo: "Pagos próximos 7 días", grupo: "Compras y stock", descripcion: "Vencimientos a proveedores de la semana", ancho: 1 },
  { id: "oc_abiertas", titulo: "Órdenes de compra abiertas", grupo: "Compras y stock", descripcion: "Órdenes sin recibir completas", ancho: 1 },
  { id: "cheques_cartera", titulo: "Cheques en cartera", grupo: "Compras y stock", descripcion: "Cheques de terceros sin depositar ni entregar", ancho: 1 },
  { id: "stock_valorizado", titulo: "Stock valorizado", grupo: "Compras y stock", descripcion: "Stock por costo (depende de que el stock esté cargado)", ancho: 1 },
  { id: "sin_movimiento", titulo: "Artículos sin movimiento", grupo: "Compras y stock", descripcion: "Con stock y sin ventas en 60 días", ancho: 1 },
]

/** Lo que trae el tablero de entrada (lo acordado con el dueño, 10/10/2026) */
export const TABLERO_INICIAL = [
  "ventas_mes", "cobrado_mes", "deuda_clientes", "margen_bruto", "pedidos_preparar", "pagos_7dias",
  "grafico_ventas_dia", "ventas_por_zona",
]

export const tarjetaPorId = (id: string) => CATALOGO_TABLERO.find(t => t.id === id)
