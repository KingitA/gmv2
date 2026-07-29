import { createClient } from '@/lib/supabase/server'
import type { PlayroomFiltersState } from './types'

// Paginación segura: helpers compartidos por toda la app (re-export para
// mantener los imports existentes del Playroom)
export { fetchAllRows, fetchByIds } from '@/lib/supabase/fetch-all'

// Calcula el rango comparativo anterior dado el período actual
export function getPreviousPeriod(from: string, to: string): { from: string; to: string } {
  const start = new Date(from)
  const end = new Date(to)
  const diffMs = end.getTime() - start.getTime()
  const prevEnd = new Date(start.getTime() - 1)
  const prevStart = new Date(prevEnd.getTime() - diffMs)
  return {
    from: prevStart.toISOString().slice(0, 10),
    to: prevEnd.toISOString().slice(0, 10),
  }
}

export function getSameLastYear(from: string, to: string): { from: string; to: string } {
  return {
    from: from.replace(/^(\d{4})/, y => String(Number(y) - 1)),
    to: to.replace(/^(\d{4})/, y => String(Number(y) - 1)),
  }
}

export function calcVariacionPct(actual: number, anterior: number): number {
  if (!anterior) return 0
  return ((actual - anterior) / Math.abs(anterior)) * 100
}

// ─── Reporte 1: Rotación & Stock Muerto ─────────────────────────────────────
// Implementado en Fase 2A
// Fuente: articulos LEFT JOIN kardex (último movimiento de venta)
// Columnas clave: stock_actual, ultimo_costo, capital_inmovilizado, dias_sin_venta

// ─── Reporte 2: Ranking ABC de Clientes ─────────────────────────────────────
// Implementado en Fase 2B
// Fuente: comprobantes_venta JOIN clientes JOIN pedidos (para vendedor_id)
// Columnas clave: total_factura, saldo_pendiente, fecha

// ─── Reporte 3: Cuentas Corrientes ──────────────────────────────────────────
// Implementado en Fase 3
// Fuente: comprobantes_venta WHERE saldo_pendiente > 0
// Columnas clave: saldo_pendiente, fecha, fecha_vencimiento

// ─── Reporte 4: Artículos Vendidos ──────────────────────────────────────────
// Implementado en Fase 4
// Fuente: kardex WHERE tipo_movimiento IN ('venta', ...) AND signo = -1
// Columnas clave: cantidad, subtotal_neto, margen_unitario, margen_porcentaje

// ─── Reporte 5: Comisiones ───────────────────────────────────────────────────
// Implementado en Fase 5
// Fuente: comisiones JOIN vendedores JOIN comprobantes_venta
// Columnas clave: monto, porcentaje, pagado, comprobante_cobrado

// ─── Reporte 6A: Comprobantes Fiscales ───────────────────────────────────────
// Implementado en Fase 6A
// Fuente: comprobantes_venta con joins a clientes (cuit, condicion_iva)
// Columnas clave: total_neto, total_iva, percepcion_iva, percepcion_iibb, tipo_comprobante

// ─── Reporte 6B: Control NC y Diferencias ────────────────────────────────────
// Implementado en Fase 6B
// Fuente: comprobantes_venta WHERE tipo_comprobante LIKE 'NC%' o comprobante_relacionado_id IS NOT NULL
