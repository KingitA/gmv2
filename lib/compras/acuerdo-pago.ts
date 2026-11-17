/**
 * Acuerdo de pago con el proveedor: ÚNICA fuente del plazo (E-06, decisión de Juan del 16/11).
 *
 * Sale de la ficha fiscal del proveedor (`proveedores.pago_blanco_*` / `pago_negro_*`), se COPIA
 * a la orden de compra al crearla (`ordenes_compra.acuerdo_pago`, editable en la orden) y de ahí
 * salen la condición de pago impresa en el PDF y los vencimientos.
 *
 * NO usar más como fuente de plazo: `proveedores.plazo_dias`, `plazo_desde`, `dias_vencimiento`,
 * `condicion_pago` / `condicion_pago_tipo` ni `ordenes_compra.plazo_pago` (legado; las columnas quedan).
 *
 * Archivo PURO (sin base ni red): lo usan el servidor y la pantalla. La misma regla está escrita
 * en SQL en `oc_vencimientos_estimados_sincronizar` (migración 20261117n).
 * Test: mobile/packages/core/test/entrada-orden-compra.test.ts (por eso los imports son relativos)
 */
import { redondear, sumarDiasISO } from "../formato"

export type CanalPago = "blanco" | "negro"
export type MedioPago = "transferencia" | "cheques" | "efectivo" | "cheques_y_efectivo" | "echeq"
export type EntregaPago = "transferencia" | "deposito_bancario" | "retira_oficina" | "envio_grimar"
export type DesdePago = "factura" | "recepcion"

export const MEDIOS_PAGO: { valor: MedioPago; nombre: string }[] = [
  { valor: "transferencia", nombre: "Transferencia" },
  { valor: "cheques", nombre: "Cheques" },
  { valor: "echeq", nombre: "E-cheq" },
  { valor: "efectivo", nombre: "Efectivo" },
  { valor: "cheques_y_efectivo", nombre: "Cheques y efectivo" },
]
export const ENTREGAS_PAGO: { valor: EntregaPago; nombre: string }[] = [
  { valor: "transferencia", nombre: "Por transferencia" },
  { valor: "deposito_bancario", nombre: "Depósito bancario" },
  { valor: "retira_oficina", nombre: "Retira en nuestra oficina" },
  { valor: "envio_grimar", nombre: "Se lo enviamos" },
]
export const DESDE_PAGO: { valor: DesdePago; nombre: string }[] = [
  { valor: "factura", nombre: "la fecha de la factura" },
  { valor: "recepcion", nombre: "la recepción de la mercadería" },
]

export interface AcuerdoCanal {
  medio: MedioPago | null
  /** Plazo en días (0 = contado). Con cuotas, es la primera. null = no acordado. */
  dias: number | null
  /** Cuotas "30/60/90". null = un solo pago a `dias`. */
  cuotas: string | null
  desde: DesdePago
  /** Hasta cuántos días de vencimiento acepta un cheque. */
  plazo_cheque: number | null
  entrega: EntregaPago | null
  /**
   * El proveedor NO tiene acuerdo de pago cargado: el plazo salió del dato viejo de su ficha
   * (plazo_dias / plazo_desde). Se muestra como "acuerdo de pago sin cargar" hasta que se cargue.
   */
  de_legado?: boolean
}
export interface AcuerdoPago {
  blanco: AcuerdoCanal
  /** null = igual que blanco */
  negro: AcuerdoCanal | null
}

const MEDIOS = new Set<string>(MEDIOS_PAGO.map((m) => m.valor))
const ENTREGAS = new Set<string>(ENTREGAS_PAGO.map((m) => m.valor))
const RE_CUOTAS = /^\d{1,3}(\/\d{1,3})*$/

const enteroONull = (v: unknown, max = 999): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.trunc(n) : null
}

/** "30 / 60/90 " → "30/60/90". Un solo número o algo inválido → null. */
export function normalizarCuotas(v: unknown): string | null {
  const s = String(v ?? "").replace(/\s+/g, "").replace(/[-,;]/g, "/")
  if (!s || !RE_CUOTAS.test(s)) return null
  const partes = s.split("/").map((x) => String(Number(x)))
  return partes.length > 1 ? partes.join("/") : null
}

export function canalVacio(): AcuerdoCanal {
  return { medio: null, dias: null, cuotas: null, desde: "factura", plazo_cheque: null, entrega: null }
}

/** Limpia un canal venga de donde venga (base, pantalla, Excel). Nunca devuelve valores fuera de lista. */
export function normalizarCanal(x: any): AcuerdoCanal {
  const c = x && typeof x === "object" ? x : {}
  const cuotas = normalizarCuotas(c.cuotas)
  let dias = enteroONull(c.dias)
  if (cuotas && dias === null) dias = Number(cuotas.split("/")[0])
  return {
    medio: MEDIOS.has(c.medio) ? c.medio : null,
    dias,
    cuotas,
    desde: c.desde === "recepcion" ? "recepcion" : "factura",
    plazo_cheque: enteroONull(c.plazo_cheque),
    entrega: ENTREGAS.has(c.entrega) ? c.entrega : null,
    ...(c.de_legado === true ? { de_legado: true } : {}),
  }
}

/** ¿El canal tiene un plazo acordado? (sin plazo no se puede calcular cuándo se paga) */
export function tienePlazo(c: AcuerdoCanal): boolean {
  return c.dias !== null || !!c.cuotas
}

const canalSinDatos = (c: AcuerdoCanal | null | undefined) => !c || (!c.medio && c.dias === null && !c.entrega && !c.cuotas)

/** Lo que guarda la orden (`ordenes_compra.acuerdo_pago`) o manda la pantalla. null si no hay nada utilizable. */
export function normalizarAcuerdo(x: any): AcuerdoPago | null {
  if (!x || typeof x !== "object") return null
  const blanco = normalizarCanal(x.blanco)
  const negro = x.negro && typeof x.negro === "object" ? normalizarCanal(x.negro) : null
  return { blanco, negro: canalSinDatos(negro) ? null : negro }
}

/** Acuerdo de la ficha del proveedor (fila de `proveedores`). */
export function acuerdoDeProveedor(p: any): AcuerdoPago {
  const fila = p || {}
  const blanco = normalizarCanal({
    medio: fila.pago_blanco_medio, dias: fila.pago_blanco_dias, cuotas: fila.pago_blanco_cuotas,
    desde: fila.pago_blanco_desde, plazo_cheque: fila.pago_blanco_plazo_cheque, entrega: fila.pago_blanco_entrega,
  })
  const negro = normalizarCanal({
    medio: fila.pago_negro_medio, dias: fila.pago_negro_dias, cuotas: fila.pago_negro_cuotas,
    desde: fila.pago_negro_desde, plazo_cheque: fila.pago_negro_plazo_cheque, entrega: fila.pago_negro_entrega,
  })
  return { blanco, negro: canalSinDatos(negro) ? null : negro }
}

/**
 * Acuerdo de la ficha y, SOLO si el proveedor no tiene plazo cargado en el acuerdo (pago_blanco_dias
 * ni cuotas), el plazo viejo de su ficha (plazo_dias + plazo_desde) como respaldo, marcado
 * `de_legado`. Así un proveedor sin acuerdo no pasa a "30 días fijos" ni a "sin plazo": sigue
 * con lo que tenía, y la orden y el vencimiento avisan que falta cargar el acuerdo.
 * Si el acuerdo y el dato viejo se contradicen, manda el acuerdo (es el campo nuevo).
 */
export function acuerdoDeProveedorConLegado(p: any): AcuerdoPago {
  const a = acuerdoDeProveedor(p)
  if (tienePlazo(a.blanco)) return a
  const dias = enteroONull(p?.plazo_dias)
  if (dias === null) return a
  return { ...a, blanco: { ...a.blanco, dias, desde: p?.plazo_desde === "fecha_recepcion" ? "recepcion" : "factura", de_legado: true } }
}

/** El acuerdo que vale para un canal: negro sin acuerdo propio = el de blanco. */
export function acuerdoDelCanal(a: AcuerdoPago | null | undefined, canal: CanalPago): AcuerdoCanal {
  if (!a) return canalVacio()
  if (canal === "negro" && a.negro && !canalSinDatos(a.negro)) return a.negro
  return a.blanco || canalVacio()
}


/** Días de cada pago: [30] o [30, 60, 90]. Sin plazo acordado: [] */
export function diasDePago(c: AcuerdoCanal): number[] {
  if (c.cuotas) return c.cuotas.split("/").map(Number)
  return c.dias !== null ? [c.dias] : []
}

/**
 * ÚNICO mapeo de medio del acuerdo → `vencimientos.forma_pago`. El CHECK de vencimientos solo
 * admite efectivo / transferencia / cheque, así que el e-cheq va como 'cheque': es un cheque
 * (tiene fecha de pago diferida y por eso lleva `fecha_validez` con el plazo del cheque, que es
 * lo que el calendario necesita). Como 'transferencia' perdería esa fecha. Que sea electrónico
 * queda en el acuerdo (medio = echeq) y se decide al armar el pago.
 */
export function formaPagoVencimiento(medio: MedioPago | null | undefined): "efectivo" | "transferencia" | "cheque" | null {
  if (medio === "transferencia") return "transferencia"
  if (medio === "efectivo") return "efectivo"
  if (medio === "cheques" || medio === "cheques_y_efectivo" || medio === "echeq") return "cheque"
  return null
}

/** Entrega del acuerdo → `vencimientos.modalidad`. */
export function modalidadVencimiento(entrega: EntregaPago | null | undefined): "deposito" | "entrega" | "grimar" | null {
  if (entrega === "deposito_bancario") return "deposito"
  if (entrega === "retira_oficina") return "entrega"
  if (entrega === "envio_grimar") return "grimar"
  return null
}

export interface PagoPlaneado {
  cuota: number
  de: number
  dias: number
  fecha: string
  monto: number
  forma_pago: ReturnType<typeof formaPagoVencimiento>
  modalidad: ReturnType<typeof modalidadVencimiento>
  /** Cheques: hasta cuándo puede estar fechado */
  fecha_validez: string | null
  /** No había plazo acordado: se tomó la fecha base */
  sin_plazo: boolean
}

/**
 * Cuándo y cuánto se paga: una fila por cuota. `fechaBase` = fecha de la factura, de la recepción
 * o (en la orden de compra, antes de que exista ninguna) la fecha estimada de entrega.
 */
export function planDePagos(total: number, fechaBase: string, c: AcuerdoCanal): PagoPlaneado[] {
  if (!(total > 0) || !fechaBase) return []
  const dias = diasDePago(c)
  const sinPlazo = dias.length === 0
  const lista = sinPlazo ? [0] : dias
  const forma = formaPagoVencimiento(c.medio)
  const modalidad = modalidadVencimiento(c.entrega)
  let resto = redondear(total)
  return lista.map((d, i) => {
    const monto = i === lista.length - 1 ? redondear(resto) : redondear(total / lista.length)
    resto = redondear(resto - monto)
    const fecha = sumarDiasISO(fechaBase, d)
    return {
      cuota: i + 1, de: lista.length, dias: d, fecha, monto, forma_pago: forma, modalidad,
      fecha_validez: forma === "cheque" && Number(c.plazo_cheque ?? 0) > 0 ? sumarDiasISO(fecha, Number(c.plazo_cheque)) : null,
      sin_plazo: sinPlazo,
    }
  })
}

const nombreDe = <T extends string>(lista: { valor: T; nombre: string }[], v: T | null) => lista.find((x) => x.valor === v)?.nombre ?? null

/** "Cheques a 30/60 días de la fecha de la factura (cheques hasta 30 días) · Retira en nuestra oficina" */
export function textoCanal(c: AcuerdoCanal): string {
  if (canalSinDatos(c)) return "Sin acuerdo de pago cargado"
  const partes: string[] = []
  const medio = nombreDe(MEDIOS_PAGO, c.medio)
  const dias = diasDePago(c)
  let plazo = ""
  if (dias.length === 1 && dias[0] === 0) plazo = "contado"
  else if (dias.length > 0) plazo = `a ${dias.join("/")} días de ${nombreDe(DESDE_PAGO, c.desde)}`
  partes.push([medio, plazo].filter(Boolean).join(" ") || "Plazo sin acordar")
  if (formaPagoVencimiento(c.medio) === "cheque" && Number(c.plazo_cheque ?? 0) > 0) partes[0] += ` (cheques hasta ${c.plazo_cheque} días)`
  const entrega = nombreDe(ENTREGAS_PAGO, c.entrega)
  if (entrega && c.entrega !== "transferencia") partes.push(entrega)
  return partes.join(" · ")
}

/**
 * Texto corto para la orden y el PDF (`ordenes_compra.condicion_pago`, 100 caracteres).
 * Si la orden tiene parte sin factura con un acuerdo distinto, se aclaran los dos.
 */
export function textoCondicionPago(a: AcuerdoPago | null | undefined, hay: { blanco: boolean; negro: boolean } = { blanco: true, negro: false }): string {
  if (!a) return "Sin acuerdo de pago cargado"
  const blanco = textoCanal(acuerdoDelCanal(a, "blanco"))
  const negro = textoCanal(acuerdoDelCanal(a, "negro"))
  if (hay.blanco && hay.negro && negro !== blanco) return `Con factura: ${blanco}. Sin factura: ${negro}`.slice(0, 100)
  return (hay.negro && !hay.blanco ? negro : blanco).slice(0, 100)
}
