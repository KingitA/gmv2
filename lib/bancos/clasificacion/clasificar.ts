/**
 * Clasificador de movimientos del banco (Tanda 2 del plan de bancos).
 * Funciones puras, sin IA: el mismo texto da siempre el mismo concepto. Los textos de cada banco
 * salen de los extractos de octubre y de las capturas del homebanking (noviembre 2026).
 * Probado en mobile/packages/core/test/bancos-clasificacion.test.ts.
 *
 * SOLO clasifica (columna concepto_id): no crea asientos en el kardex ni toca saldos.
 * Si cambian las reglas, subir VERSION_CLASIFICACION: los movimientos ya guardados se vuelven a
 * clasificar solos la próxima vez (lib/bancos/clasificacion-servidor.ts).
 */
import type { BancoLectura } from "../lectura/tipos"
import type { ConceptoId } from "./conceptos"

export const VERSION_CLASIFICACION = 1

/** Mayúsculas, sin acentos, guiones raros (−–—) como "-", espacios simples. */
export function normalizarConcepto(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
}

interface Regla {
  id: ConceptoId
  re: RegExp
  /** Solo para estos bancos (si no, para todos) */
  bancos?: BancoLectura[]
}

/** "COM", "COM.", "COMIS", "COMIS.", "COMISION" como palabra (no COMERCIO, COMPRA, COMBTE). */
const COMI = String.raw`\bCOM(?:IS(?:ION)?)?\.?(?![A-Z])`
const re = (s: string) => new RegExp(s)

/**
 * El orden importa: la primera que coincide gana. Primero las reversas, después los impuestos
 * (la percepción de IVA antes que el IVA a secas), las comisiones, los pagos, lo financiero y
 * al final lo operativo.
 */
const REGLAS: Regla[] = [
  // ── Reversas (Provincia: "REV. IMP.DEBITO.-LEY 25413", "REVERSA INGRESOS BRUTO SIRCREB")
  { id: "ley25413_reverso", re: /^(REV\b|REV\.|REVERSA|REVERSO|ANUL).*25\.?413/ },
  { id: "sircreb_reverso", re: /^(REV\b|REV\.|REVERSA|REVERSO|ANUL).*SIRCREB/ },
  { id: "percepcion_reverso", re: /^(REV\b|REV\.|REVERSA|REVERSO|ANUL).*(PERCEP|BRUTO|2408)/ },

  // ── Impuestos
  // Credicoop "Impuesto Ley 25.413 Ali Gral s/Creditos" · Nación "GRAVAMEN LEY 25413 S/CRED" · Provincia "IMPUESTO CREDITO -LEY 25413"
  { id: "ley25413_creditos", re: /25\.?413.*CRED|CREDITO.*25\.?413/ },
  { id: "ley25413_debitos", re: /25\.?413/ },
  // MercadoPago: "Pago de impuestos <a quién se transfirió>" = 0,6 % de la transferencia (Ley 25.413 s/débitos)
  { id: "ley25413_debitos", re: /^PAGO DE IMPUESTOS?\b/, bancos: ["mp"] },
  // "Recaudacion SIRCREB CM - Condicion E" · "REG.REC.SIRCREB" · "INGRESOS BRUTOS SIRCREB"
  { id: "sircreb", re: /SIRCREB/ },
  // "Percepcion IVA RG 2408 s/Comis-Gastos" · "RETEN. I.V.A. RG.2408"
  { id: "percepcion_iva", re: /2408/ },
  // "Percep Ingr Brutos Bs.As. - Categoria 1" · "GRAVAMEN IB PERCEP. BA" · "IMPUESTO I.BRUTOS - PERCEPCION"
  { id: "percepcion_iibb", re: /PERCEP.*(\bING|BRUTO|\bIB\b|IIBB)|(\bING\w*\.? BRUTO|I\.? ?BRUTOS|\bIB\b|IIBB).*PERCEP/ },
  // "I.V.A. - Debito Fiscal 21%" · "I.V.A. BASE"
  { id: "iva_comisiones", re: /^(I\.? ?V\.? ?A\.?|IVA)(\s|-|$)/ },

  // ── Comisiones y gastos
  // "CHEQUE-Com acred Camara sin Filial Bco" · "ECHQ-Comis acred..." · "Comision E-CHEQ pagado por Clearing"
  // "COM ECH CANJE O/BANCOS" · "COMISION GESTION DE COBRO DE CHEQUES"
  { id: "comision_cheques", re: re(`(CHEQ|ECHQ|CHQ|\\bECH\\b).*${COMI}|${COMI}.*(CHEQ|ECHQ|CHQ|\\bECH\\b|CANJE|CLEARING|CAMARA)`) },
  // "Comision Transferencias]Inmediatas!COM" · "COMIS.TRANSF.NE24" · "COMISION TRANSFERENCIA/GIRO"
  { id: "comision_transferencias", re: re(`${COMI}.*(TRANSF|GIRO)`) },
  // "Com. mantenimiento cuenta" · "COMISION PAQUETES" · "COMISION MANTENIM. PERIODO..."
  { id: "comision_mantenimiento", re: re(`${COMI}.*(MANTEN|PAQUETE)|^MANTENIMIENTO|CARGO (DE )?MANTEN`) },
  // "Honorarios por Informes" · "Arancel por Informe de Domino"
  { id: "honorarios_informes", re: /HONORARIO|INFORME/ },
  // "Servicio acreditaciones automaticas" · "Comis. Retiro Caja en Filial de Origen" · MP "Débito por deuda Facturas vencidas de Mercado Libre"
  { id: "comision_otros", re: re(`${COMI}|^SERVICIO ACREDITACIONES|^ARANCEL|^CARGO\\b|^DEBITO POR DEUDA`) },

  // ── Pagos por el banco
  // "Pago de Obligaciones a ARCA" (antes de débito automático: un VEP puede venir como débito)
  { id: "pago_arca", re: /^(?!TRANSF|CREDITO INMEDIATO|DEBIN|CR\b).*(\bARCA\b|\bAFIP\b|\bVEP\b)/ },
  // "Debito Automatico Directo" · "Debito/Credito Aut - Segurcoop Comercio" · Nación "DEBITO PAGO DIRECTO"
  { id: "debito_automatico", re: /DEBITO AUTOMATICO|DEBITO\/CREDITO AUT|DEBITO PAGO DIRECTO|\bDEB\.? ?AUT/ },
  // Credicoop "Pago de Servicios" · MP "Pago de servicio Osecac"
  { id: "pago_servicios", re: /^PAGO (DE )?SERVICIO/ },

  // ── Financieros
  // "Liquidacion de Prestamo" · "Prestamo por convenio" · Nación "PAGO PRESTAMO" · Credicoop "Cobranza de Creditos" (cuota)
  { id: "prestamo", re: /PRESTAMO|^COBRANZA DE CREDITOS/ },
  { id: "rendimientos", re: /^RENDIMIENTO/ },
  { id: "intereses", re: /INTERES/ },

  // ── Operativos (no son gastos: transferencias, DEBIN, cheques, depósitos, ventas)
  {
    id: "movimiento",
    re: /TRANSF|DEBIN|\bDEB\.TRAN|ACRED.*VALORES|CHEQUE|ECHEQ|\bCH\.|DEPOSITO|\bDEP\.|CAM\.FED|HABERES|LIQUIDACION DE DINERO|COBRADO POR CAJA|\bBIP\b|EMIS TRANSF|\bGIRO\b|PAGO CHEQUE|RECHAZAD|CREDITO INMEDIATO|DEBITO INMEDIATO/,
  },
]

/** Los impuestos que, si vienen a favor (importe positivo), son en realidad una reversa. */
const REVERSA_DE: Partial<Record<ConceptoId, ConceptoId>> = {
  ley25413_debitos: "ley25413_reverso",
  ley25413_creditos: "ley25413_reverso",
  sircreb: "sircreb_reverso",
  percepcion_iibb: "percepcion_reverso",
  percepcion_iva: "percepcion_reverso",
}

/**
 * Concepto de un movimiento. `texto` = concepto del banco (concepto_banco) o, en los movimientos
 * viejos, la descripción. `monto` con signo (crédito +, débito −).
 */
export function clasificarMovimiento(banco: BancoLectura, texto: string | null | undefined, monto: number): ConceptoId {
  const t = normalizarConcepto(texto)
  if (!t) return "otro"
  for (const r of REGLAS) {
    if (r.bancos && !r.bancos.includes(banco)) continue
    if (!r.re.test(t)) continue
    // Un impuesto con importe a favor es una reversa aunque el banco no lo diga
    if (monto > 0 && REVERSA_DE[r.id]) return REVERSA_DE[r.id]!
    return r.id
  }
  return "otro"
}

/** Texto a clasificar de un movimiento guardado: el concepto del banco si está; si no, la descripción. */
export function textoAClasificar(m: { concepto_banco?: string | null; descripcion?: string | null }): string {
  return (m.concepto_banco && m.concepto_banco.trim()) || m.descripcion || ""
}
