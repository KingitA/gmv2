/**
 * VALOR DE UNA DEVOLUCIÓN — LA regla, en un solo lugar (29/09, rehecha 21/10).
 *
 * Regla del dueño (21/10/2026): la NC/REV de una devolución sale TAL CUAL FUE
 * FACTURADA esa mercadería, ni un centavo más ni uno menos:
 *  - neto: el precio unitario del renglón facturado × cantidad devuelta;
 *  - IVA: el IVA por unidad que llevó ese renglón (sin renglón: 21% del neto);
 *  - percepción IVA (3%): solo si la factura de origen la llevaba (neto de esa
 *    factura > $100.000 y cliente RI no excluido) — aunque la devolución sea
 *    chica. Si la factura no la llevaba, la NC tampoco;
 *  - percepción IIBB: alícuota VIGENTE el día de la NC sobre el neto devuelto;
 *  - 10% contado: si la factura de origen fue cobrada contado con 10%, cada
 *    renglón sale bonificado (el cliente pagó el 90%).
 * Cada renglón se valúa según SU comprobante de origen (fiscal → NC A/B,
 * presupuesto → REV); una devolución puede tener las dos partes.
 *
 * Ese número es a la vez lo que se descuenta en el cobro (web, apps) y el
 * importe de la NC/REV. Todos llaman a esta función: coinciden al centavo.
 *
 * Casos de referencia (dueño):
 *  (a) factura $500.000 contado → cobra $450.000; devolución de $10.000 en
 *      presupuesto vale $9.000 → a cobrar $441.000.
 *  (b) pedido $260.930,88 contado, devolución $10.491,36 → (260.930,88 −
 *      10.491,36) × 0,9 = $225.395,57.
 *  (c) $100 neto + 21% IVA + 3% perc. IVA + 3% IIBB, contado: 10 unidades
 *      valen 900 + 189 + 27 + 27 = $1.143.
 *
 * P2-48 (regla de Juan, 29/10): lo devuelto de una factura SIN detalle (sistema
 * viejo / apertura, o artículo nunca facturado en gmv2) no se valúa "tal cual
 * facturado" porque no hay renglón: el precio es el FINAL y la NC sale por ese
 * precio JUSTO, con todo adentro (neto + IVA + percepción IVA + IIBB). Se abre
 * hacia atrás, al centavo (ARCA: ImpTotal = ImpNeto + ImpIva + ImpTrib).
 *  (d) precio final $100, IIBB 3 %, sin perc. IVA: neto 80,65 + IVA 16,94 + IIBB 2,41 = $100.
 *
 * La plata a cuenta NUNCA lleva 10% (eso ya lo maneja el circuito de créditos).
 */

const r2 = (n: number) => Math.round(n * 100) / 100

export const DTO_CONTADO = 0.10
/** Percepción IVA RG 5329 (= TASA_PERCEPCION_IVA de lib/comprobantes/calcular-percepciones). */
export const TASA_PERCEPCION_IVA_DEVOLUCION = 3
const IVA_GENERAL = 21

export interface RenglonDevolucionValor {
  /** cantidad × precio unitario facturado (neto si fiscal; final si presupuesto) */
  subtotal: number
  cantidad?: number
  /** Va en NC A/B (true) o en REV (false). Sin dato: `conIva` de la llamada. */
  fiscal?: boolean
  /** Su comprobante de origen fue cobrado contado con 10%. Sin dato: `aplica10` de la llamada. */
  aplica10?: boolean
  /** Su comprobante de origen llevó percepción IVA (3%). */
  percepcionIva?: boolean
  /** IVA por unidad del renglón facturado; null/undefined = 21% del neto. */
  ivaUnitario?: number | null
  /**
   * P2-48: `subtotal` es el precio FINAL (todo adentro): factura del sistema viejo
   * o sin detalle. Solo en renglones fiscales; se abre hacia atrás al centavo.
   */
  precioFinal?: boolean
}

export interface ValorDevolucionInput {
  renglones: RenglonDevolucionValor[]
  /** Valor por defecto para renglones sin `aplica10` propio */
  aplica10?: boolean
  /** Valor por defecto para renglones sin `fiscal` propio */
  conIva?: boolean
  /** Alícuota IIBB vigente del cliente (%, 0 = no se le percibe) */
  alicuotaIIBB?: number
}

export interface ValorDevolucionResult {
  /** Neto por renglón YA bonificado (para el detalle de la NC/REV) */
  netoPorRenglon: number[]
  /** IVA por renglón (0 en los de REV) */
  ivaPorRenglon: number[]
  /** Parte fiscal (NC A/B) */
  fiscal: { neto: number; iva: number; baseIva: number; percepcionIva: number; percepcionIibb: number; total: number }
  /** Parte presupuesto (REV) */
  rev: { total: number }
  neto: number
  iva: number
  percepciones: number
  /** El número de la regla: lo que se descuenta en el cobro y el total NC + REV */
  total: number
}

const centavos = (n: number) => Math.round(n * 100)

/**
 * P2-48: abre un precio FINAL en neto + IVA 21 % + percepción IVA (3 %, si va) +
 * IIBB, de modo que la suma dé el final EXACTO al centavo. Busca el neto alrededor
 * de final / (1 + tasas); si ningún neto cierra por redondeo, el centavo que falta
 * va a una percepción (IIBB, si no IVA): ARCA controla el IVA contra su base y
 * de los tributos solo que sumen ImpTrib. Sin percepciones, al neto.
 */
export function abrirPrecioFinal(final: number, p: { percepcionIva: boolean; alicuotaIIBB: number }) {
  const objetivo = centavos(final)
  const tPerc = p.percepcionIva ? TASA_PERCEPCION_IVA_DEVOLUCION / 100 : 0
  const tIibb = (Number(p.alicuotaIIBB) || 0) / 100
  const partes = (netoCent: number) => {
    const neto = netoCent / 100
    const iva = r2((neto * IVA_GENERAL) / 100)
    const percepcionIva = tPerc > 0 ? r2(neto * tPerc) : 0
    const percepcionIibb = tIibb > 0 ? r2(neto * tIibb) : 0
    return { neto, iva, percepcionIva, percepcionIibb }
  }
  const suma = (x: ReturnType<typeof partes>) => centavos(x.neto) + centavos(x.iva) + centavos(x.percepcionIva) + centavos(x.percepcionIibb)
  const base = Math.round(objetivo / (1 + IVA_GENERAL / 100 + tPerc + tIibb))
  for (const d of [0, -1, 1, -2, 2, -3, 3]) {
    const x = partes(base + d)
    if (suma(x) === objetivo) return x
  }
  const x = partes(base)
  const resto = (objetivo - suma(x)) / 100
  if (x.percepcionIibb > 0 || tIibb > 0) return { ...x, percepcionIibb: r2(x.percepcionIibb + resto) }
  if (x.percepcionIva > 0 || tPerc > 0) return { ...x, percepcionIva: r2(x.percepcionIva + resto) }
  return { ...x, neto: r2(x.neto + resto) }
}

export function valorDevolucion({ renglones, aplica10 = false, conIva = false, alicuotaIIBB = 0 }: ValorDevolucionInput): ValorDevolucionResult {
  const netoPorRenglon: number[] = []
  const ivaPorRenglon: number[] = []
  let netoFiscal = 0
  let ivaFiscal = 0
  let baseIva = 0
  let totalRev = 0
  // P2-48: lo de precio final (todo adentro) lleva sus percepciones ya calculadas
  let netoAbierto = 0
  let percIvaAbierta = 0
  let percIibbAbierta = 0
  let baseIvaAbierta = 0
  for (const r of renglones) {
    const factor = (r.aplica10 ?? aplica10) ? 1 - DTO_CONTADO : 1
    const fiscal = r.fiscal ?? conIva
    if (fiscal && r.precioFinal) {
      const x = abrirPrecioFinal(r2((Number(r.subtotal) || 0) * factor), { percepcionIva: !!r.percepcionIva, alicuotaIIBB: Number(alicuotaIIBB) || 0 })
      netoFiscal += x.neto
      ivaFiscal += x.iva
      netoAbierto += x.neto
      percIvaAbierta += x.percepcionIva
      percIibbAbierta += x.percepcionIibb
      if (r.percepcionIva) baseIvaAbierta += x.neto
      netoPorRenglon.push(x.neto)
      ivaPorRenglon.push(x.iva)
      continue
    }
    // Por renglón, redondeado como lo va a escribir la NC en su detalle
    const neto = r2((Number(r.subtotal) || 0) * factor)
    let iva = 0
    if (fiscal) {
      const ivaUnit = r.ivaUnitario
      iva = ivaUnit != null && Number.isFinite(Number(ivaUnit))
        ? r2(Number(ivaUnit) * (Number(r.cantidad) || 0) * factor)
        : r2((neto * IVA_GENERAL) / 100)
      netoFiscal += neto
      ivaFiscal += iva
      if (r.percepcionIva) baseIva += neto
    } else {
      totalRev += neto
    }
    netoPorRenglon.push(neto)
    ivaPorRenglon.push(iva)
  }
  netoFiscal = r2(netoFiscal)
  ivaFiscal = r2(ivaFiscal)
  baseIva = r2(baseIva)
  totalRev = r2(totalRev)
  // Lo "tal cual facturado" percibe sobre su neto; lo de precio final ya trae las suyas
  const baseIvaFacturado = baseIva
  baseIva = r2(baseIva + baseIvaAbierta)
  const netoFacturado = r2(netoFiscal - netoAbierto)
  const percepcionIva = r2((baseIvaFacturado * TASA_PERCEPCION_IVA_DEVOLUCION) / 100 + percIvaAbierta)
  const percepcionIibb = netoFiscal > 0 ? r2((netoFacturado > 0 ? (netoFacturado * (Number(alicuotaIIBB) || 0)) / 100 : 0) + percIibbAbierta) : 0
  // Suma en centavos enteros — misma aritmética que la emisión fiscal (ARCA
  // valida ImpTotal == ImpNeto + ImpIva + ImpTrib al centavo)
  const totalFiscal = (centavos(netoFiscal) + centavos(ivaFiscal) + centavos(percepcionIva) + centavos(percepcionIibb)) / 100
  const percepciones = r2(percepcionIva + percepcionIibb)
  return {
    netoPorRenglon,
    ivaPorRenglon,
    fiscal: { neto: netoFiscal, iva: ivaFiscal, baseIva, percepcionIva, percepcionIibb, total: totalFiscal },
    rev: { total: totalRev },
    neto: r2(netoFiscal + totalRev),
    iva: ivaFiscal,
    percepciones,
    total: (centavos(totalFiscal) + centavos(totalRev)) / 100,
  }
}

/**
 * P2-41 (regla de Juan, 29/10): cuánto de la NC/REV de una devolución corresponde
 * a CADA comprobante de origen — lo que vale lo devuelto de ese comprobante (neto +
 * IVA de sus renglones + su parte de las percepciones, por neto). La NC/REV se
 * imputa a cada origen solo por eso: lo que va al respaldo 0002-00000001 (sistema
 * viejo) o sin origen queda A FAVOR y no baja ni la deuda ni la base del 10 %
 * contado de otro comprobante (URQUIZA: la REV entera cayó en el PRES 0027 y su
 * 10 % dio $25.061,52 en vez de $27.319,90). La suma da el total al centavo.
 */
export function importePorOrigen(
  renglones: Array<{ origen_id: string | null; neto: number; iva: number }>,
  percepciones: number,
): Map<string | null, number> {
  const netoTotal = renglones.reduce((s, r) => s + (Number(r.neto) || 0), 0)
  const porOrigen = new Map<string | null, { neto: number; iva: number }>()
  for (const r of renglones) {
    const a = porOrigen.get(r.origen_id) || { neto: 0, iva: 0 }
    a.neto += Number(r.neto) || 0
    a.iva += Number(r.iva) || 0
    porOrigen.set(r.origen_id, a)
  }
  const out = new Map<string | null, number>()
  const claves = [...porOrigen.keys()]
  let percRestante = centavos(percepciones)
  claves.forEach((k, i) => {
    const a = porOrigen.get(k)!
    const perc = i === claves.length - 1 ? percRestante : netoTotal > 0 ? Math.round((centavos(percepciones) * a.neto) / netoTotal) : 0
    percRestante -= perc
    out.set(k, (centavos(r2(a.neto)) + centavos(r2(a.iva)) + perc) / 100)
  })
  return out
}

/** Neto a cobrar de un comprobante contado (10% sobre el total de factura). */
export function netoContado(totalFactura: number): number {
  return r2((Number(totalFactura) || 0) * (1 - DTO_CONTADO))
}

// ─── Origen de un renglón devuelto ───────────────────────────────────────────

/**
 * Comprobante al que se asocia un renglón devuelto y cómo se valúa. Lo arma el
 * servidor (lib/cobranzas/origen-devolucion.ts) y viaja a las apps en la lista
 * de "comprados" y en el contexto de devolución del cliente.
 */
export interface OrigenDevolucion {
  comprobante_venta_id: string | null
  tipo_comprobante: string | null
  numero_comprobante: string | null
  /** NC A/B (true) o REV (false) */
  fiscal: boolean
  /** El comprobante de origen llevó percepción IVA (3%) */
  percepcion_iva: boolean
  /** El comprobante de origen fue cobrado contado con 10% */
  bonificado_contado: boolean
  /** true = el artículo ESTÁ en ese comprobante: precio e IVA son los facturados y no se tocan */
  exacto: boolean
  /** Precio unitario facturado (neto si fiscal, final si presupuesto); null si no es exacto */
  precio: number | null
  /** IVA por unidad del renglón facturado; null = 21% del neto */
  iva_unitario: number | null
  /**
   * R2 (27/10): no se sabe si va por factura o por presupuesto (cliente mixto y
   * el artículo sin precio calculable). Se valúa como presupuesto, pero la NC
   * NO se emite hasta resolverlo: nunca "factura" por defecto (riesgo fiscal).
   */
  indeterminado?: boolean
}

/** Lo que hace falta del cliente para valuar una devolución sin señal (apps). */
export interface ContextoDevolucion {
  /** Alícuota IIBB vigente hoy (%), 0 si no se le percibe */
  alicuota_iibb: number
  /** Comprobante fiscal más reciente (asociación de lo que no está en ninguna factura del sistema) */
  ultimo_fiscal: OrigenDevolucion | null
  /** Presupuesto más reciente (ídem, para lo que va por presupuesto) */
  ultimo_presupuesto: OrigenDevolucion | null
}

/**
 * Regla del dueño (21/10/2026) para un artículo devuelto:
 *  1. si está en un comprobante del sistema → ese (el último), exacto;
 *  2. si no (comprobante importado del sistema viejo, o nunca facturado) → el
 *     comprobante MÁS RECIENTE del cliente del tipo que corresponde según cómo
 *     va hoy ese artículo para ESE cliente (si el cliente lleva todo facturado,
 *     es NC A/B aunque el artículo sea de presupuesto). Precio a mano.
 */
export function elegirOrigenDevolucion(
  comprado: OrigenDevolucion | null | undefined,
  contexto: ContextoDevolucion | null | undefined,
  vaEnComprobante: "factura" | "presupuesto",
): OrigenDevolucion {
  if (comprado?.exacto && comprado.comprobante_venta_id) return comprado
  const fiscal = vaEnComprobante === "factura"
  const ultimo = fiscal ? contexto?.ultimo_fiscal : contexto?.ultimo_presupuesto
  if (ultimo) return { ...ultimo, fiscal, exacto: false, precio: null, iva_unitario: null }
  return {
    comprobante_venta_id: null,
    tipo_comprobante: null,
    numero_comprobante: null,
    fiscal,
    percepcion_iva: false,
    bonificado_contado: false,
    exacto: false,
    precio: null,
    iva_unitario: null,
  }
}

/** Valor de renglones cargados en pantalla, con su origen (misma función que el servidor). */
export function valorDevolucionConOrigen(
  items: Array<{ cantidad: number; precio_venta_original: number; origen: OrigenDevolucion | null | undefined }>,
  alicuotaIIBB: number,
): ValorDevolucionResult {
  return valorDevolucion({
    renglones: items.map((i) => ({
      subtotal: r2((Number(i.cantidad) || 0) * (Number(i.precio_venta_original) || 0)),
      cantidad: Number(i.cantidad) || 0,
      fiscal: !!i.origen?.fiscal,
      aplica10: !!i.origen?.bonificado_contado,
      percepcionIva: !!i.origen?.fiscal && !!i.origen?.percepcion_iva,
      ivaUnitario: i.origen?.exacto ? i.origen.iva_unitario : null,
      // P2-48: fiscal sin renglón facturado (sistema viejo / nunca facturado en gmv2):
      // el precio es el FINAL y la NC sale por ese precio justo
      precioFinal: !!i.origen?.fiscal && !i.origen?.exacto,
    })),
    alicuotaIIBB,
  })
}

/** Fila de "comprados" (lib/vendedor/comprados.ts) tal como llega a la web y a las apps. */
export interface CompradoConOrigen {
  comprobante_venta_id: string | null
  tipo_comprobante: string
  numero_comprobante: string
  ultimo_precio: number
  bonificado_contado?: boolean
  /** Campos de origen: faltan en réplicas anteriores al 21/10/2026 */
  fiscal?: boolean
  percepcion_iva?: boolean
  exacto?: boolean
  precio?: number | null
  iva_unitario?: number | null
}

/** Origen de devolución de un artículo comprado (réplica vieja: se deduce del tipo de comprobante). */
export function origenDesdeComprado(c: CompradoConOrigen): OrigenDevolucion {
  return {
    comprobante_venta_id: c.comprobante_venta_id,
    tipo_comprobante: c.tipo_comprobante || null,
    numero_comprobante: c.numero_comprobante || null,
    fiscal: c.fiscal ?? ["FA", "FB", "FC"].includes(c.tipo_comprobante),
    percepcion_iva: !!c.percepcion_iva,
    bonificado_contado: !!c.bonificado_contado,
    exacto: c.exacto ?? !!c.comprobante_venta_id,
    precio: c.precio ?? c.ultimo_precio,
    iva_unitario: c.iva_unitario ?? null,
  }
}
