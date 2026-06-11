/**
 * Cálculo de percepciones sobre comprobantes de venta.
 *
 * Percepción IVA (RG AFIP 5329/2023, modificada por 5334/2023):
 *   Tasa: 3% sobre base imponible neta.
 *   Solo aplica a receptores Responsables Inscriptos. A monotributistas,
 *   exentos y consumidores finales NO se les percibe.
 *   Mínimo legal (RG 5334/2023): si la percepción calculada es ≤ $3.000
 *   por operación, no corresponde percibir.
 *   No aplica: clientes con exento_iva = true (exclusión manual).
 *
 * Percepción IIBB (Convenio Multilateral):
 *   Tasa: campo percepcion_iibb del cliente (configurado según padrón provincial).
 *   Solo aplica a receptores Responsables Inscriptos.
 *   No aplica: clientes con exento_iibb = true, o provincia = 'Buenos Aires'
 *   (no somos agentes ARBA), o percepcion_iibb = 0 / null.
 *
 * Ambas percepciones solo aplican a comprobantes fiscales (FA, FB, NCA, NCB, NDA, NDB).
 */

export const TASA_PERCEPCION_IVA = 3  // RG AFIP 5329/2023 — 3%

// RG 5334/2023: monto mínimo de percepción IVA por operación.
// Si el monto calculado es menor o igual a este valor, la percepción es $0.
// ARCA actualiza este monto por resolución — modificar acá si cambia.
export const MINIMO_PERCEPCION_IVA = 3000

// Provincias en las que NO se cobra percepción IIBB (domicilio del cliente)
const PROVINCIAS_SIN_IIBB = new Set([
  'buenos aires', 'bs as', 'ba', 'pba',
  'buenos aires (provincia)', 'provincia de buenos aires', 'gba',
])

export interface ClientePercepcion {
  condicion_iva?:    string | null   // las percepciones solo aplican a Responsables Inscriptos
  exento_iva?:       boolean | null
  exento_iibb?:      boolean | null
  provincia?:        string | null
  percepcion_iibb?:  number | null  // porcentaje configurado en ficha del cliente, ej: 3.0 = 3%
}

export interface ResultadoPercepcion {
  percepcion_iva:     number
  percepcion_iibb:    number
  tasa_iva_aplicada:  number
  tasa_iibb_aplicada: number
}

/** Las percepciones (IVA RG 5329 e IIBB) solo se practican a Responsables Inscriptos. */
function esResponsableInscripto(condicionIva: string | null | undefined): boolean {
  return (condicionIva ?? '').toLowerCase().trim().includes('responsable inscri')
}

/**
 * Calcula el monto de percepción IVA e IIBB para un comprobante.
 * @param totalNeto - Base imponible neta (sin IVA)
 * @param cliente - Datos del cliente con condición IVA, campos de exención y tasa
 * @param esFiscal - True para FA/FB/NCA/NCB/NDA/NDB; false para PRES/REV/REM
 */
export function calcularPercepciones(
  totalNeto: number,
  cliente: ClientePercepcion,
  esFiscal: boolean,
): ResultadoPercepcion {
  const sinPercepciones = { percepcion_iva: 0, percepcion_iibb: 0, tasa_iva_aplicada: 0, tasa_iibb_aplicada: 0 }

  if (!esFiscal || totalNeto <= 0) return sinPercepciones

  // Solo se percibe a Responsables Inscriptos (RG 5329).
  // Monotributistas, exentos y consumidores finales quedan fuera de ambas percepciones.
  if (!esResponsableInscripto(cliente.condicion_iva)) return sinPercepciones

  // ── Percepción IVA ──
  const aplicaIVA = !cliente.exento_iva
  let   percIVA   = aplicaIVA ? r2(totalNeto * TASA_PERCEPCION_IVA / 100) : 0
  // Mínimo legal RG 5334: percepciones chicas no se practican
  if (percIVA <= MINIMO_PERCEPCION_IVA) percIVA = 0
  const tasaIVA = percIVA > 0 ? TASA_PERCEPCION_IVA : 0

  // ── Percepción IIBB ──
  const provinciaRaw  = (cliente.provincia ?? '').toLowerCase().trim()
  const esProvinciaBA = PROVINCIAS_SIN_IIBB.has(provinciaRaw)
  const tasaIIBB      = Number(cliente.percepcion_iibb ?? 0)
  const aplicaIIBB    = !cliente.exento_iibb && !esProvinciaBA && tasaIIBB > 0
  const percIIBB      = aplicaIIBB ? r2(totalNeto * tasaIIBB / 100) : 0

  return {
    percepcion_iva:     percIVA,
    percepcion_iibb:    percIIBB,
    tasa_iva_aplicada:  tasaIVA,
    tasa_iibb_aplicada: aplicaIIBB ? tasaIIBB : 0,
  }
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}
