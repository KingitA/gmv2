// DEUDA VENCIDA / A VENCER (condiciones de pago, fase 3 — Juan, 19/11/2026).
//
// La misma regla que la base (cc_deuda_vencimiento / v_deuda_vencimiento,
// migración 20261119q_deuda_vencida.sql), sin base de datos: para los tests y para
// las apps sin señal. Lo que se muestra con señal sale de la base.
//
//   · saldo = el del libro mayor.
//   · Cada débito (FA/FB/FC/PRES/ND) con saldo pendiente vence en su fecha_vencimiento
//     (fecha + plazo); sin ella, en su fecha. Los créditos (NC/REV) no se miran.
//   · Lo que los débitos suman de MÁS sobre el saldo (créditos y pagos a cuenta sin
//     imputar) se aplica a lo más viejo primero; lo que suman de MENOS (deuda sin
//     comprobante: ajustes) es exigible y cuenta como vencida.
//   · Vencida = vencimiento anterior a hoy; a vencer = el resto. vencida + a_vencer = saldo.
//     Saldo ≤ 0: 0 y 0.

export interface DebitoVencimiento {
  id: string
  /** aaaa-mm-dd */
  fecha: string
  /** aaaa-mm-dd; null = vence en su fecha (facturado antes de la fase 2) */
  fecha_vencimiento: string | null
  saldo_pendiente: number
}

export interface DeudaVencimiento {
  saldo: number
  vencida: number
  a_vencer: number
  vencimiento_mas_viejo: string | null
  proximo_vencimiento: string | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function repartirVencimientos(saldo: number, debitos: DebitoVencimiento[], hoy: string): DeudaVencimiento {
  const s = r2(Number(saldo) || 0)
  if (s <= 0.005) return { saldo: s, vencida: 0, a_vencer: 0, vencimiento_mas_viejo: null, proximo_vencimiento: null }

  const items = debitos
    .filter((d) => Number(d.saldo_pendiente) > 0.005)
    .map((d) => ({ ...d, venc: d.fecha_vencimiento || d.fecha, monto: Number(d.saldo_pendiente) }))
    .sort((a, b) => a.venc.localeCompare(b.venc) || a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id))
  const total = items.reduce((t, i) => t + i.monto, 0)

  let credito = Math.max(0, total - s) // sin imputar: se come lo más viejo
  let vencida = Math.max(0, s - total) // deuda sin comprobante: exigible
  let masViejo: string | null = null
  let proximo: string | null = null
  for (const i of items) {
    const usa = Math.min(i.monto, credito)
    credito -= usa
    const queda = i.monto - usa
    if (queda <= 0.005) continue
    if (!masViejo) masViejo = i.venc
    if (i.venc < hoy) vencida += queda
    else if (!proximo) proximo = i.venc
  }
  const v = r2(vencida)
  return { saldo: s, vencida: v, a_vencer: r2(s - v), vencimiento_mas_viejo: masViejo, proximo_vencimiento: proximo }
}
