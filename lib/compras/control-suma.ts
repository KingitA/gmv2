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
 *   B. neto + IVA + percepciones + impuestos internos + otros impuestos = total del comprobante
 *      (la retención de Ganancias no cuenta: no viene en la factura, se hace al pagar).
 * Si no coinciden, el comprobante NO se puede validar hasta corregir los renglones o la
 * cabecera. Lo controla el servidor (ruta de validar y función SQL), no solo la pantalla.
 *
 * Nada de esto cambia la deuda: la deuda es siempre el total de la factura.
 *
 * Archivo PURO. Tests: mobile/packages/core/test/entrada-control-suma.test.ts
 */

import { netoDocumento, precioNeto, type TipoDescuento } from "./diferencias"
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
  impuestos_internos?: number | null
  otros_impuestos?: number | null
  /** Descuento al pie de la factura, en % (0 = no hay) */
  descuento_fuera_factura?: number | null
  /** Cómo aplica los descuentos de cada renglón el proveedor (su ficha). Sin dato: en cascada. */
  tipo_descuento?: TipoDescuento | null
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
  // Lo que una factura trae además del neto. La retención de Ganancias NO va: no viene en la
  // factura, la hacemos nosotros al pagar (si la lectura automática la trajo, no cuenta).
  const impuestos = num(c.total_iva) + num(c.percepcion_iva_monto) + num(c.percepcion_iibb_monto) + num(c.impuestos_internos) + num(c.otros_impuestos)
  const netoComprobante = r2(num(c.total_neto) > 0 ? num(c.total_neto) : total - impuestos)
  const descuentos = (l: RenglonComprobante) => [l.descuento1, l.descuento2, l.descuento3, l.descuento4]
  // El importe de un renglón se puede armar de dos formas y las dos son legítimas según cómo
  // facture el proveedor; con muchas unidades difieren en centavos (1.415,048 × 600 contra
  // 1.415,05 × 600 = $1,20). El control pasa si CUALQUIERA de las dos cierra.
  //   1. cantidad × lista × descuentos, redondeado UNA vez por renglón
  //   2. cantidad × (neto por unidad ya redondeado a centavos)
  const sumaRenglon = r2(renglones.reduce((s, l) => s + r2(num(l.cantidad_facturada) * precioNeto(l.precio_unitario, descuentos(l), c.tipo_descuento)), 0))
  const sumaUnidad = r2(renglones.reduce((s, l) => s + r2(num(l.cantidad_facturada) * netoDocumento(l.precio_unitario, descuentos(l), c.tipo_descuento)), 0))
  const cerca = (a: number, b: number) => Math.abs(a - b) < TOLERANCIA_SUMA_PESOS
  // La que quedó más cerca es la que se informa
  const netoRenglones = Math.abs(sumaRenglon - netoComprobante) <= Math.abs(sumaUnidad - netoComprobante) ? sumaRenglon : sumaUnidad
  const totalCalculado = r2(netoComprobante + impuestos)
  const r: ControlSuma = { ok: true, faltas: [], neto_renglones: netoRenglones, neto_comprobante: netoComprobante, total_calculado: totalCalculado, total }
  // Un remito no trae precios: no hay nada que sumar
  if (esRemito(c.tipo_comprobante)) return r

  // B. Primero la CABECERA: neto + impuestos contra el total. Si esto no cierra, lo que está mal
  //    son los datos del comprobante (neto, IVA, percepciones), no los renglones: se dice eso y
  //    no se sigue, porque comparar renglones contra un neto mal cargado solo confunde.
  if (total > 0 && !cerca(totalCalculado, total)) {
    const dif = r2(total - totalCalculado)
    r.faltas.push(`Los datos del comprobante no cierran: neto ${pesos(netoComprobante)} más impuestos ${pesos(impuestos)} da ${pesos(totalCalculado)} y el total dice ${pesos(total)} (${dif > 0 ? "falta" : "sobra"} ${pesos(Math.abs(dif))}). Corregí neto, IVA, percepciones u otros impuestos con el lápiz de editar.`)
    r.ok = false
    return r
  }

  // A. Renglones contra el neto (solo comprobantes con precios; una NC / ND puede no traer renglones)
  if (esComprobanteConPrecios(c.tipo_comprobante)) {
    const dto = num(c.descuento_fuera_factura)
    const alPie = (suma: number) => (dto > 0 && dto <= 100 ? r2(suma * (1 - dto / 100)) : null)
    const cierra = [sumaRenglon, sumaUnidad].some((s) => cerca(s, netoComprobante) || (alPie(s) !== null && cerca(alPie(s)!, netoComprobante)))
    if (!cierra) {
      const dif = r2(netoComprobante - netoRenglones)
      // Una factura que no discrimina IVA (B / C) o una adquisición: los renglones se comparan contra el total
      const contra = impuestos > 0 ? "neto" : "en total"
      r.faltas.push(
        renglones.length === 0
          ? `El comprobante no tiene renglones cargados y dice ${pesos(netoComprobante)} ${contra}. Cargá los renglones.`
          : `Los renglones suman ${pesos(netoRenglones)} y la factura dice ${pesos(netoComprobante)} ${contra}: ${dif > 0 ? "falta" : "sobra"} ${pesos(Math.abs(dif))}. Revisá los renglones leídos.`,
      )
    }
  }

  r.ok = r.faltas.length === 0
  return r
}
