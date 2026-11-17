/**
 * Precio neto de compra: ÚNICA función para pasar del precio de lista del proveedor al neto,
 * según cómo aplica ese proveedor sus descuentos (ficha: `proveedores.tipo_descuento`).
 *
 * Decisión de Juan (17/11/2026): «Lo aclara en la ficha del proveedor, hay dos opciones:
 * En cascada / sobre precio lista.»
 *   · cascada      → uno sobre otro:   lista × (1 − d1) × (1 − d2) × (1 − d3) × (1 − d4)
 *   · sobre_lista  → todos sobre lista: lista × (1 − (d1 + d2 + d3 + d4))
 * Misma regla que la del precio de venta (`calcularPrecioBase` en lib/pricing/calculator.ts) y
 * que `oc_neto_unitario` en SQL (migración 20261117n).
 *
 * Devuelve el neto SIN redondear: se redondea recién al multiplicar por las unidades del renglón.
 * La usan la orden de compra (pantalla, PDF, totales) y la verificación.
 *
 * Archivo PURO. Test: mobile/packages/core/test/entrada-orden-compra.test.ts
 */
export type TipoDescuento = "cascada" | "sobre_lista"

/** Valor de la ficha → tipo. Vacío o desconocido = cascada (el valor por defecto de la base). */
export function tipoDescuentoDe(v: unknown): TipoDescuento {
  return v === "sobre_lista" ? "sobre_lista" : "cascada"
}

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export function netoCompra(lista: unknown, descuentos: readonly unknown[], tipo: unknown = "cascada"): number {
  const precio = n(lista)
  if (tipoDescuentoDe(tipo) === "sobre_lista") {
    const suma = descuentos.reduce<number>((s, d) => s + n(d), 0)
    return precio * Math.max(0, 1 - suma / 100)
  }
  return descuentos.reduce<number>((p, d) => p * (1 - n(d) / 100), precio)
}
