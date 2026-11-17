/**
 * Los renglones de un comprobante tienen que SUMAR lo que dice el comprobante (E-46).
 *
 * Decisión de Juan, 17/11/2026: "dos ítems de $10 cada uno deberían sumar $20. Si el
 * subtotal es $21 hay un error, no hay problema con redondear centavos, el tema es que a
 * través de este redondeo podemos llegar a tener diferencia entre la suma de los ítems y
 * el total del comprobante."
 *
 * Dos controles, los dos con una tolerancia de centavos de redondeo:
 *   A. (comprobantes con precios: factura / adquisición) la suma de los renglones NETOS
 *      —todos, también los marcados "no es mercadería" (flete, etc.)— = neto del comprobante;
 *   B. neto + IVA + percepciones + otros impuestos = total del comprobante.
 * Si no coinciden, el comprobante NO se puede validar hasta corregir los renglones o la
 * cabecera. Lo controla el servidor (ruta de validar y función SQL), no solo la pantalla.
 *
 * Nada de esto cambia la deuda: la deuda es siempre el total de la factura.
 *
 * Archivo PURO. Tests: mobile/packages/core/test/entrada-control-suma.test.ts
 */

import { netoDocumento } from "./diferencias"
import { esComprobanteConPrecios, esRemito } from "./finalizar-oc"

/**
 * Centavos de redondeo que se toleran por comprobante: la diferencia tiene que ser MENOR a este
 * importe. Un peso entero de diferencia ya es un error (el ejemplo de Juan: 20 contra 21).
 */
export const TOLERANCIA_SUMA_PESOS = 1

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const pesos = (n: number) => {
  const [e, d = "00"] = Math.abs(r2(n)).toFixed(2).split(".") // formato-ok: texto de mensaje, sin dependencias
  return `${n < 0 ? "-" : ""}$${e!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d}`
}

export interface CabeceraComprobante {
  tipo_comprobante: string
  numero_comprobante?: string | null
  total_factura_declarado?: number | null
  total_neto?: number | null
  total_iva?: number | null
  percepcion_iva_monto?: number | null
  percepcion_iibb_monto?: number | null
  retencion_ganancias_monto?: number | null
  /** Descuento al pie de la factura, en % (0 = no hay) */
  descuento_fuera_factura?: number | null
}

export interface RenglonComprobante {
  cantidad_facturada: number
  precio_unitario: number
  descuento1?: number | null
  descuento2?: number | null
  descuento3?: number | null
  descuento4?: number | null
}

export interface ControlSuma {
  ok: boolean
  /** Qué no cierra, en palabras para la oficina. Vacío = cierra. */
  faltas: string[]
  neto_renglones: number
  neto_comprobante: number
  total_calculado: number
  total: number
}

export function controlSuma(c: CabeceraComprobante, renglones: RenglonComprobante[]): ControlSuma {
  const total = r2(num(c.total_factura_declarado))
  const impuestos = num(c.total_iva) + num(c.percepcion_iva_monto) + num(c.percepcion_iibb_monto) + num(c.retencion_ganancias_monto)
  const netoComprobante = r2(num(c.total_neto) > 0 ? num(c.total_neto) : total - impuestos)
  const netoRenglones = r2(
    renglones.reduce((s, l) => s + r2(num(l.cantidad_facturada) * netoDocumento(l.precio_unitario, [l.descuento1, l.descuento2, l.descuento3, l.descuento4])), 0),
  )
  const totalCalculado = r2(netoComprobante + impuestos)
  const r: ControlSuma = { ok: true, faltas: [], neto_renglones: netoRenglones, neto_comprobante: netoComprobante, total_calculado: totalCalculado, total }
  // Un remito no trae precios: no hay nada que sumar
  if (esRemito(c.tipo_comprobante)) return r

  // A. Renglones contra el neto (solo comprobantes con precios; una NC / ND puede no traer renglones)
  if (esComprobanteConPrecios(c.tipo_comprobante)) {
    const dto = num(c.descuento_fuera_factura)
    const conDescuentoAlPie = dto > 0 && dto <= 100 ? r2(netoRenglones * (1 - dto / 100)) : null
    const cierra = Math.abs(netoRenglones - netoComprobante) < TOLERANCIA_SUMA_PESOS
      || (conDescuentoAlPie !== null && Math.abs(conDescuentoAlPie - netoComprobante) < TOLERANCIA_SUMA_PESOS)
    if (!cierra) {
      const dif = r2(netoComprobante - netoRenglones)
      r.faltas.push(
        renglones.length === 0
          ? `El comprobante no tiene renglones cargados y dice ${pesos(netoComprobante)} neto. Cargá los renglones.`
          : `Los renglones suman ${pesos(netoRenglones)} y la factura dice ${pesos(netoComprobante)} neto: ${dif > 0 ? "falta" : "sobra"} ${pesos(Math.abs(dif))}. Revisá los renglones leídos.`,
      )
    }
  }

  // B. Neto + impuestos contra el total
  if (total > 0 && Math.abs(totalCalculado - total) >= TOLERANCIA_SUMA_PESOS) {
    const dif = r2(total - totalCalculado)
    r.faltas.push(`El neto más los impuestos da ${pesos(totalCalculado)} y el total del comprobante dice ${pesos(total)}: ${dif > 0 ? "falta" : "sobra"} ${pesos(Math.abs(dif))}. Revisá neto, IVA y percepciones (lápiz de editar).`)
  }

  r.ok = r.faltas.length === 0
  return r
}
