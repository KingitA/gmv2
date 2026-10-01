// Cobro CONJUNTO en el reparto: un mismo pago físico (un cheque, un fajo de efectivo) que cubre
// a varios clientes. Reglas PURAS (sin imports: servidor, web y app como @gm/cobro/conjunto).
//
// Caso real (dueño, 01/10/2026): el cliente del viaje tiene otro local y paga los dos con UN
// cheque. El chofer agrega el otro cliente, ve su cuenta completa (pedidos, comprobantes, 10 %,
// devoluciones) igual que la del principal, y los medios de pago se reparten entre todos.
//
// Modelo (= cobro del vendedor): UN pago por cliente, agrupados por una cabecera `cobranzas`.
//  · A cada cliente agregado se le cobra EXACTAMENTE lo que suma su selección (más lo que se
//    cargue "a cuenta"). La diferencia entre lo entregado y lo seleccionado (falta, sobra,
//    ajuste por redondeo) es siempre del cliente PRINCIPAL.
//  · Los medios de pago se reparten EN CASCADA, al centavo: se completa al principal y después
//    a cada agregado, en el orden en que se cargaron los medios. Cada pago suma exacto su monto
//    y cada medio queda repartido exacto. Un cheque solo se parte si cruza de un cliente a otro.

const centavos = (n: unknown) => Math.round((Number(n) || 0) * 100)
const pesos = (c: number) => c / 100

export interface ClienteExtraCobro {
  cliente_id: string
  /** Lo que se le cobra a este cliente (parte del total entregado) */
  monto: number
}

export interface ErrorReparto { error: string }

/** Lo que le queda al cliente principal: total entregado − lo de los clientes agregados. */
export function montoDelPrincipal(totalEntregado: number, montosExtras: number[]): number {
  return pesos(centavos(totalEntregado) - montosExtras.reduce((s, m) => s + centavos(m), 0))
}

/** Valida el reparto antes de registrar nada. null = se puede registrar. */
export function validarCobroConjunto(clientePrincipalId: string, totalEntregado: number, extras: ClienteExtraCobro[]): string | null {
  const ids = new Set<string>([clientePrincipalId])
  for (const e of extras) {
    if (!e?.cliente_id) return "Hay un cliente agregado sin identificar."
    if (ids.has(e.cliente_id)) return "Un mismo cliente está dos veces en el cobro."
    ids.add(e.cliente_id)
    if (centavos(e.monto) <= 0) return "Hay un cliente agregado sin importe: quitalo o seleccioná qué se le cobra."
  }
  if (centavos(montoDelPrincipal(totalEntregado, extras.map((e) => e.monto))) <= 0)
    return "Lo entregado no alcanza para cubrir a los clientes agregados y dejarle algo al cliente de la parada."
  return null
}

/**
 * Reparte los medios de pago entre los clientes, EN CASCADA y al centavo.
 * `montos[0]` es el del principal. Devuelve, por cliente, sus medios (mismos datos, otro monto).
 * Si un cheque queda partido en pedazos de IGUAL importe, los pedazos repetidos llevan el número
 * con sufijo " (2)", " (3)"…: la unicidad de cheques es (banco, número, importe, vencimiento) y
 * dos pedazos idénticos chocarían.
 */
export function repartirMetodos<M extends { tipo: string; monto: number; numero_cheque?: string }>(metodos: M[], montos: number[]): M[][] {
  const restan = montos.map(centavos)
  const total = metodos.reduce((s, m) => s + centavos(m.monto), 0)
  if (Math.abs(total - restan.reduce((s, x) => s + x, 0)) > 1) throw new Error("Los medios de pago no suman lo que se cobra a los clientes.")
  const out: M[][] = montos.map(() => [])
  let k = 0
  for (const m of metodos) {
    let queda = centavos(m.monto)
    const piezas: Array<{ cliente: number; pieza: M }> = []
    while (queda > 0 && k < restan.length) {
      if (restan[k] <= 0) { k++; continue }
      const toma = Math.min(queda, restan[k])
      const pieza = { ...m, monto: pesos(toma) }
      piezas.push({ cliente: k, pieza })
      restan[k] -= toma
      queda -= toma
    }
    // Centavo suelto por redondeo de entrada: se lo lleva el último que recibió de este medio
    if (queda > 0 && piezas.length) piezas[piezas.length - 1].pieza.monto = pesos(centavos(piezas[piezas.length - 1].pieza.monto) + queda)
    if (m.tipo === "cheque" && piezas.length > 1) {
      const vistos = new Map<number, number>()
      for (const p of piezas) {
        const c = centavos(p.pieza.monto)
        const n = (vistos.get(c) || 0) + 1
        vistos.set(c, n)
        if (n > 1) p.pieza.numero_cheque = `${m.numero_cheque || ""} (${n})`
      }
    }
    for (const p of piezas) out[p.cliente].push(p.pieza)
  }
  return out
}

/**
 * Clave de idempotencia del pago de cada cliente del cobro conjunto: el principal usa la del
 * envío; el agregado N pisa el nibble de versión (pos 14) con 'e' —un uuid v4 del equipo jamás
 * colisiona— y los dos últimos dígitos con el índice. Un reintento no duplica ningún pago.
 */
export function claveDelCliente(idempotencyKey: string | null | undefined, indice: number): string | null {
  if (!idempotencyKey) return null
  if (indice === 0) return idempotencyKey
  return idempotencyKey.slice(0, 14) + "e" + idempotencyKey.slice(15, 34) + String(10 + indice - 1)
}
