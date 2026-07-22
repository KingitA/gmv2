import type { MovImport } from "@/lib/finanzas/extractos-import"

/**
 * Fuente de extracto: MercadoPago API (token en env MP_ACCESS_TOKEN).
 *
 * Estrategia en dos niveles, según qué exponga la cuenta:
 *  1. /v1/account/movements/search — movimientos de dinero en cuenta
 *     (incluye comisiones, impuestos y rendimientos). No todas las cuentas
 *     lo tienen habilitado.
 *  2. Fallback: /v1/payments/search — pagos recibidos aprobados; las
 *     comisiones/impuestos de cada pago (fee_details/taxes) se registran
 *     como movimientos negativos aparte. Los rendimientos NO aparecen acá
 *     (para eso queda el import XLSX o el nivel 1).
 *
 * Fechas en TZ Argentina (UTC-3). Referencias = IDs reales de MP → dedup.
 */

const TZ_OFFSET = "-03:00"

function fechaAR(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
}

async function mpGet(path: string, token: string): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`https://api.mercadopago.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  let data: any = null
  try {
    data = await res.json()
  } catch {
    /* respuesta no-JSON */
  }
  return { ok: res.ok, status: res.status, data }
}

export async function fetchMovimientosMP(
  desde: string, // YYYY-MM-DD
  hasta: string
): Promise<{ movimientos: MovImport[]; fuente_detalle: string }> {
  const token = process.env.MP_ACCESS_TOKEN
  if (!token) throw new Error("MP_ACCESS_TOKEN no configurado en las variables de entorno")

  const begin = `${desde}T00:00:00${TZ_OFFSET}`
  const end = `${hasta}T23:59:59${TZ_OFFSET}`

  // ── Nivel 1: movimientos de cuenta ──
  const movRes = await mpGet(
    `/v1/account/movements/search?range=date_created&begin_date=${encodeURIComponent(begin)}&end_date=${encodeURIComponent(end)}&limit=200`,
    token
  )
  if (movRes.ok && Array.isArray(movRes.data?.results) && movRes.data.results.length) {
    const movimientos: MovImport[] = movRes.data.results
      .map((m: any) => ({
        fecha: fechaAR(m.date_created),
        descripcion: [m.description, m.detail, m.type].filter(Boolean).join(" · "),
        monto: Number(m.amount ?? 0),
        referencia_externa: `mp:${m.id}`,
      }))
      .filter((m: MovImport) => m.monto !== 0)
    return { movimientos, fuente_detalle: "account/movements" }
  }

  // ── Nivel 2: pagos recibidos (fallback) ──
  const payRes = await mpGet(
    `/v1/payments/search?sort=date_approved&criteria=desc&range=date_approved&begin_date=${encodeURIComponent(begin)}&end_date=${encodeURIComponent(end)}&limit=100`,
    token
  )
  if (!payRes.ok) {
    throw new Error(
      `MercadoPago API: movements ${movRes.status}, payments ${payRes.status} — ${JSON.stringify(payRes.data?.message ?? payRes.data ?? "sin detalle")}`
    )
  }

  const movimientos: MovImport[] = []
  for (const p of payRes.data?.results ?? []) {
    if (p.status !== "approved") continue
    const fecha = fechaAR(p.date_approved || p.date_created)
    const bruto = Number(p.transaction_amount ?? 0)
    if (!bruto) continue
    const quien = p.payer?.first_name || p.payer?.email || p.description || "pago"
    movimientos.push({
      fecha,
      descripcion: `Pago recibido ${quien}${p.description ? ` · ${p.description}` : ""}`,
      monto: bruto,
      referencia_externa: `mp:pay:${p.id}`,
    })
    const fees = [...(p.fee_details ?? []), ...(p.taxes ?? [])]
    for (let i = 0; i < fees.length; i++) {
      const f = fees[i]
      const monto = Number(f.amount ?? f.value ?? 0)
      if (!monto) continue
      movimientos.push({
        fecha,
        descripcion: `${f.type ?? "fee"} s/pago ${p.id}`,
        monto: -Math.abs(monto),
        referencia_externa: `mp:fee:${p.id}:${i}`,
      })
    }
  }
  return { movimientos, fuente_detalle: "payments/search" }
}
