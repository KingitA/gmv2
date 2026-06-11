/**
 * Tabla de equivalencias entre los tipos internos del sistema y los códigos numéricos de ARCA.
 * Fuente: Manual WSFEV1 v4.x
 */

// Tipos de comprobante del sistema → código ARCA
export const TIPO_CBTE_ARCA: Record<string, number> = {
  FA:  1,   // Factura A
  NDA: 2,   // Nota de Débito A
  NCA: 3,   // Nota de Crédito A
  FB:  6,   // Factura B
  NDB: 7,   // Nota de Débito B
  NCB: 8,   // Nota de Crédito B
  FC:  11,  // Factura C (no emitida por esta empresa, incluida por completitud)
  NDC: 12,  // Nota de Débito C
  NCC: 13,  // Nota de Crédito C
}

// Tipos que requieren CAE — el resto (PRES, REM, REV) son documentos internos
export const REQUIERE_CAE = new Set(['FA', 'FB', 'NDA', 'NDB', 'NDC', 'NCA', 'NCB', 'NCC'])

// DocTipo: tipo de documento del receptor
export const DOC_TIPO = {
  CUIT:             80,
  CUIL:             86,
  DNI:              96,
  CONSUMIDOR_FINAL: 99,  // No aplica para esta empresa (requiere CUIT)
}

// Concepto de la operación
export const CONCEPTO = {
  PRODUCTOS:          1,
  SERVICIOS:          2,
  PRODUCTOS_SERVICIOS: 3,
}

// Alícuotas de IVA — id para el campo <AlicIva><Id>
export const IVA_ID = {
  EXENTO:    3,
  IVA_10_5:  4,
  IVA_21:    5,
  IVA_27:    6,
}

// Tributos — id para el campo <Tributo><Id> según tabla FEParamGetTiposTributos:
//   1 = Impuestos nacionales · 2 = Impuestos provinciales · 3 = Impuestos municipales
//   4 = Impuestos internos · 6 = Percepción de IVA · 99 = Otro
// Percepción IVA RG 5329 → id 6 (afip.gob.ar/fe/documentos/otros_Tributos.xlsx)
// Percepción IIBB → id 2 (impuestos provinciales)
export const TRIBUTO_ID = {
  PERCEPCION_IVA:      '6',
  PERCEPCION_IIBB:     '2',
  PERCEPCION_MUNICIPAL:'3',
  PERCEPCION_INGRESOS: '99',
}

export const MONEDA_PESOS = 'PES'
export const COTIZACION_PESOS = 1

// Condición frente al IVA del receptor — obligatorio desde RG 5616/2024
// en FECAESolicitar (<CondicionIVAReceptorId>). Tabla oficial ARCA:
//   1 = IVA Responsable Inscripto · 4 = IVA Sujeto Exento
//   5 = Consumidor Final · 6 = Responsable Monotributo
export const CONDICION_IVA_RECEPTOR_ID = {
  RESPONSABLE_INSCRIPTO: 1,
  SUJETO_EXENTO:         4,
  CONSUMIDOR_FINAL:      5,
  MONOTRIBUTO:           6,
}

/**
 * Mapea clientes.condicion_iva al código de receptor de ARCA.
 * Mismo matching que determinarTipoFactura. Retorna null si no mapea —
 * el llamador DEBE bloquear la emisión (nunca asumir un default).
 */
export function condicionIvaReceptorId(condicionIva: string | null | undefined): number | null {
  const c = (condicionIva ?? '').toLowerCase().trim()
  if (c.includes('responsable inscri')) return CONDICION_IVA_RECEPTOR_ID.RESPONSABLE_INSCRIPTO
  if (c.includes('monotributo'))        return CONDICION_IVA_RECEPTOR_ID.MONOTRIBUTO
  if (c.includes('exento'))             return CONDICION_IVA_RECEPTOR_ID.SUJETO_EXENTO
  if (c.includes('consumidor final'))   return CONDICION_IVA_RECEPTOR_ID.CONSUMIDOR_FINAL
  return null
}

export type AmbienteARCA = 'testing' | 'produccion'

export interface TributoARCA {
  id: string
  desc: string
  baseImp: number
  alic: number
  importe: number
}

export interface IvaARCA {
  id: number
  baseImp: number
  importe: number
}

export interface CbteAsocARCA {
  tipo: number
  ptoVta: number
  nro: number
}

export interface SolicitudCAE {
  ambiente: AmbienteARCA
  token: string
  sign: string
  cuit: string
  ptoVta: number
  cbteTipo: number
  cbteDesde: number
  cbteHasta: number
  concepto: number
  docTipo: number
  docNro: string
  fecha: string        // YYYYMMDD
  impTotal: number
  impTotConc: number
  impNeto: number
  impOpEx: number
  impIva: number
  impTrib: number
  iva: IvaARCA[]
  tributos?: TributoARCA[]
  cbteAsoc?: CbteAsocARCA[]
  /** RG 4540: período asociado (YYYYMMDD) para ND/NC que no referencian un comprobante puntual */
  periodoAsoc?: { desde: string; hasta: string }
  condicionIVAReceptorId: number  // RG 5616/2024 — obligatorio
}

export interface RespuestaCAE {
  cae: string
  vencimientoCae: string
  observaciones: string[]
}

export interface UltimoAutorizado {
  cbteNro: number
}
