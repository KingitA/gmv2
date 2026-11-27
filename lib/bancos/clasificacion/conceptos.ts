/**
 * Catálogo de conceptos del banco (Tanda 2 del plan de bancos, docs/bancos/PLAN-BANCOS.md).
 * Es el mismo que la tabla public.bancos_conceptos (migración 20261127b_bancos_clasificacion.sql):
 * la prueba mobile/packages/core/test/bancos-clasificacion.test.ts controla que no se separen.
 *
 * tipo:
 *   impuesto   → lo cobra el banco por cuenta de ARCA / ARBA (Ley 25.413, SIRCREB, percepciones, IVA)
 *   gasto      → comisiones y cargos del banco
 *   pago       → pagos que salen por el banco a terceros (débitos automáticos, servicios, ARCA)
 *   financiero → préstamos, rendimientos, intereses
 *   operativo  → transferencias, DEBIN, cheques, depósitos: NO es gasto (se concilian en otras tandas)
 *   otro       → el clasificador no lo reconoce: hay que mirarlo
 * signo: lo que se espera del importe (débito = sale plata, crédito = entra, ambos).
 */
export type TipoConcepto = "impuesto" | "gasto" | "pago" | "financiero" | "operativo" | "otro"
export type SignoConcepto = "debito" | "credito" | "ambos"

export interface ConceptoBanco {
  id: string
  nombre: string
  tipo: TipoConcepto
  signo: SignoConcepto
  orden: number
}

export const CONCEPTOS_BANCO = [
  { id: "ley25413_debitos", nombre: "Impuesto Ley 25.413 s/débitos", tipo: "impuesto", signo: "debito", orden: 10 },
  { id: "ley25413_creditos", nombre: "Impuesto Ley 25.413 s/créditos", tipo: "impuesto", signo: "debito", orden: 11 },
  { id: "ley25413_reverso", nombre: "Reversa impuesto Ley 25.413", tipo: "impuesto", signo: "credito", orden: 12 },
  { id: "sircreb", nombre: "SIRCREB (recaudación IIBB)", tipo: "impuesto", signo: "debito", orden: 20 },
  { id: "sircreb_reverso", nombre: "Reversa SIRCREB", tipo: "impuesto", signo: "credito", orden: 21 },
  { id: "percepcion_iibb", nombre: "Percepción IIBB", tipo: "impuesto", signo: "debito", orden: 30 },
  { id: "percepcion_iva", nombre: "Percepción IVA RG 2408", tipo: "impuesto", signo: "debito", orden: 31 },
  { id: "percepcion_reverso", nombre: "Reversa de percepción", tipo: "impuesto", signo: "credito", orden: 32 },
  { id: "iva_comisiones", nombre: "IVA sobre comisiones", tipo: "impuesto", signo: "debito", orden: 40 },
  { id: "comision_transferencias", nombre: "Comisión transferencias", tipo: "gasto", signo: "debito", orden: 50 },
  { id: "comision_cheques", nombre: "Comisión cheques", tipo: "gasto", signo: "debito", orden: 51 },
  { id: "comision_mantenimiento", nombre: "Mantenimiento / paquete", tipo: "gasto", signo: "debito", orden: 52 },
  { id: "honorarios_informes", nombre: "Honorarios e informes", tipo: "gasto", signo: "debito", orden: 53 },
  { id: "comision_otros", nombre: "Otras comisiones y cargos", tipo: "gasto", signo: "debito", orden: 59 },
  { id: "debito_automatico", nombre: "Débito automático (servicios / seguros)", tipo: "pago", signo: "debito", orden: 60 },
  { id: "pago_servicios", nombre: "Pago de servicios", tipo: "pago", signo: "debito", orden: 61 },
  { id: "pago_arca", nombre: "Pago ARCA / VEP", tipo: "pago", signo: "debito", orden: 62 },
  { id: "prestamo", nombre: "Préstamos", tipo: "financiero", signo: "ambos", orden: 70 },
  { id: "rendimientos", nombre: "Rendimientos", tipo: "financiero", signo: "credito", orden: 71 },
  { id: "intereses", nombre: "Intereses", tipo: "financiero", signo: "ambos", orden: 72 },
  { id: "movimiento", nombre: "Transferencias, DEBIN, cheques y depósitos", tipo: "operativo", signo: "ambos", orden: 90 },
  { id: "otro", nombre: "Otros (sin reconocer)", tipo: "otro", signo: "ambos", orden: 99 },
] as const satisfies readonly ConceptoBanco[]

export type ConceptoId = (typeof CONCEPTOS_BANCO)[number]["id"]

const POR_ID = new Map<string, ConceptoBanco>(CONCEPTOS_BANCO.map((c) => [c.id, c]))

export function conceptoBanco(id: string | null | undefined): ConceptoBanco | null {
  return (id && POR_ID.get(id)) || null
}

/** Los que van al reporte de gastos bancarios (todo menos lo operativo). */
export const TIPOS_GASTO: readonly TipoConcepto[] = ["impuesto", "gasto", "pago", "financiero", "otro"]

export const NOMBRE_TIPO: Record<TipoConcepto, string> = {
  impuesto: "Impuestos",
  gasto: "Comisiones y gastos",
  pago: "Pagos por el banco",
  financiero: "Financieros",
  operativo: "Operativos",
  otro: "Sin reconocer",
}
