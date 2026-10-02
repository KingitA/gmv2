/**
 * Componentes (neto / IVA / percepciones / total) de la NC fiscal del 10 %
 * contado. Módulo PURO (sin supabase): es LA fórmula que usa la emisión en
 * generar-bonificacion y la que verifican los tests.
 *
 * Regla del dueño (02/10/2026, caso GRUPO HEMA): en los comprobantes migrados
 * del sistema anterior (APERTURA GM) total_neto = importe FINAL (el IVA no
 * viene discriminado: total = neto en la carga). La NC sobre ellos debe salir
 * por EXACTAMENTE el 10 % del total de factura, con el IVA calculado ADENTRO
 * (neto = total ÷ 1,21) — nunca 21 % agregado encima. Sin esta regla, la NCA
 * de las 3 FA de apertura salió por $1.643.794,68 en vez de $1.358.508,00
 * (sobre-emisión fiscal de $285.286,68 con CAE, irreversible salvo ND).
 *
 * Para las facturas propias (IVA discriminado) la regla de siempre: 10 % de
 * cada componente (neto, IVA, percepciones) → NC = 10 % del total facturado.
 */

export const IVA_PCT = 0.21

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/** ¿Es un comprobante migrado del sistema anterior? (misma marca que usa el
 *  reporte fiscal ARCA para excluirlos: observaciones 'APERTURA GM…'). */
export function esComprobanteApertura(observaciones: string | null | undefined): boolean {
  return (observaciones ?? "").toUpperCase().startsWith("APERTURA GM")
}

export interface FacturaParaNCFiscal {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  total_neto: number
  total_factura: number
  percepcion_iva?: number | null
  percepcion_iibb?: number | null
  /** true = migrado APERTURA GM: total_neto incluye el IVA (sin discriminar) */
  apertura: boolean
}

export interface ComponentesNCFiscal {
  lineas: Array<{ descripcion: string; precio_neto: number }>
  totalNeto: number
  totalIva: number
  percepIva: number
  percepIibb: number
  /** Suma en centavos exactos de neto + IVA + percepciones (validación ARCA) */
  totalFactura: number
}

/**
 * @param fraccionDe fracción (0..1) de cada comprobante que bonifica ESTE cobro
 * @param pct porcentaje de bonificación (10 = descuento contado)
 */
export function componentesNCFiscal(
  facturas: FacturaParaNCFiscal[],
  fraccionDe: (id: string) => number,
  pct = 10,
): ComponentesNCFiscal {
  const normales = facturas.filter((f) => !f.apertura)
  const aperturas = facturas.filter((f) => f.apertura)

  // ── Facturas propias: 10 % del neto por línea, IVA 21 % sobre el agregado ──
  const lineasNormales = normales.map((c) => ({
    id: c.id,
    descripcion: `BONIF. ${pct}% ${c.tipo_comprobante} ${c.numero_comprobante}`,
    precio_neto: r2(Math.abs(c.total_neto) * (pct / 100) * fraccionDe(c.id)),
  }))
  const netoNormal = r2(lineasNormales.reduce((s, l) => s + l.precio_neto, 0))
  const ivaNormal = r2(netoNormal * IVA_PCT)

  // ── Apertura: el 10 % se toma del TOTAL y el IVA sale de adentro ──────────
  // El bruto por comprobante (10 % del total de factura) es el compromiso al
  // centavo con el cliente; el desglose neto/IVA se calcula sobre el agregado
  // (una sola división) para que ARCA valide importe ≈ base × 21 % sin
  // acumular redondeos por línea.
  const brutosApertura = aperturas.map((c) => ({
    id: c.id,
    descripcion: `BONIF. ${pct}% ${c.tipo_comprobante} ${c.numero_comprobante}`,
    bruto: r2(Math.abs(c.total_factura) * (pct / 100) * fraccionDe(c.id)),
  }))
  const brutoApertura = r2(brutosApertura.reduce((s, l) => s + l.bruto, 0))
  const netoApertura = r2(brutoApertura / (1 + IVA_PCT))
  const ivaApertura = r2(brutoApertura - netoApertura)

  // Líneas de apertura: neto por comprobante, con el último absorbiendo el
  // redondeo para que la suma de líneas = neto del comprobante, al centavo.
  const lineasApertura = brutosApertura.map((l) => ({
    descripcion: l.descripcion,
    precio_neto: r2(l.bruto / (1 + IVA_PCT)),
  }))
  if (lineasApertura.length > 0) {
    const sumaLineas = r2(lineasApertura.reduce((s, l) => s + l.precio_neto, 0))
    const ajuste = r2(netoApertura - sumaLineas)
    if (ajuste !== 0) {
      const ultima = lineasApertura[lineasApertura.length - 1]
      ultima.precio_neto = r2(ultima.precio_neto + ajuste)
    }
  }

  // ── Percepciones: 10 % de las de la factura original (apertura: vienen 0) ──
  const percepIva = r2(
    facturas.reduce((s, c) => s + Math.abs(Number(c.percepcion_iva ?? 0)) * fraccionDe(c.id), 0) * (pct / 100),
  )
  const percepIibb = r2(
    facturas.reduce((s, c) => s + Math.abs(Number(c.percepcion_iibb ?? 0)) * fraccionDe(c.id), 0) * (pct / 100),
  )

  const totalNeto = r2(netoNormal + netoApertura)
  const totalIva = r2(ivaNormal + ivaApertura)
  const totalFactura =
    (Math.round(totalNeto * 100) +
      Math.round(totalIva * 100) +
      Math.round(percepIva * 100) +
      Math.round(percepIibb * 100)) /
    100

  return {
    lineas: [...lineasNormales.map(({ descripcion, precio_neto }) => ({ descripcion, precio_neto })), ...lineasApertura],
    totalNeto,
    totalIva,
    percepIva,
    percepIibb,
    totalFactura,
  }
}
