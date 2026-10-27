/**
 * #28: PRES de respaldo, uno por cliente, para lo devuelto sin comprobante con
 * ese artículo (negro). Uno solo por cliente vivo: lo asegura el índice único
 * ux_comprobantes_venta_respaldo_devolucion (20261027b_respaldo_devolucion_unico.sql).
 * Los PRES viejos de la apertura entran con PV 0002 (#18): la apertura frena el
 * que caería en este mismo número (R9, 27/10).
 */
export const NUMERO_RESPALDO_DEVOLUCION = "0002-00000001"
