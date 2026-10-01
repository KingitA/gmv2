// Reglas PURAS del cobro en la calle (sin imports: corre igual en el servidor, en la web y
// en las apps como @gm/cobro). Dos reglas viven acá para que pantalla y servidor no puedan
// divergir:
//
//  1. 10 % CONTADO SOBRE PEDIDOS SIN FACTURAR: solo lo reciben los pedidos SELECCIONADOS para
//     cobrar. "10% contado a todo" = a todo lo seleccionado, nunca a toda la lista. Al servidor
//     viajan los anticipos (`pedidos_anticipo`) y la marca solo se pone sobre esos.
//
//  2. AJUSTE POR REDONDEO (con signo: + falta plata, se le perdona · − sobra plata):
//     · El tope del 1 % aplica SOLO al ajuste en contra (perdonar saldo): nadie puede redondear
//       para abajo de más desde la calle.
//     · El sobrante JAMÁS rebota un cobro: si es chico (≤ 1 %) puede tomarse como ajuste a
//       favor; si no, queda a cuenta del cliente.
//     · La base del tope es TODO lo seleccionado: comprobantes imputados + anticipos a pedidos
//       sin facturar (los anticipos no viajan como imputaciones: antes la base daba $0).

export const PEDIDO_PREFIX = "pedido:"

/** = TOPE_AJUSTE_PCT de lib/cobranzas/ajuste.ts (test de igualdad en contado-ajuste.test.ts) */
export const TOPE_AJUSTE_PCT = 0.01

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => Number(v) || 0

/** Máximo ajuste EN CONTRA admitido: 1 % de lo seleccionado. */
export function topeAjuste(totalSeleccionado: number): number {
  return r2(Math.max(0, num(totalSeleccionado)) * TOPE_AJUSTE_PCT)
}

// ─── 10 % contado ────────────────────────────────────────────────────────────
// REGLA (01/10, caso Urquiza PRES 3): la NC del 10% se calcula sobre lo que se
// está saldando HOY de cada comprobante (lo seleccionado en ESTE cobro), nunca
// sobre entregas a cuenta sin tildar ni sobre el total histórico. Si un
// comprobante se completa en varios cobros contado, cada cobro genera SU parte
// (cada NC lleva la marca [pago:<id>] de su pago).

/** NC del 10% proyectada para lo seleccionado hoy de un comprobante. */
export function ncContado(seleccionadoHoy: number): number {
  return r2(Math.max(0, num(seleccionadoHoy)) * 0.1)
}

/** El server reconstruye la NC desde lo CUBIERTO (plata + créditos + devolución
 *  neta = 90% de lo saldado): NC = cubierto / 9. Inversa exacta de ncContado. */
export function ncContadoDesdeCubierto(cubierto: number): number {
  return r2(Math.max(0, num(cubierto)) / 9)
}

// ─── 10 % contado sobre pedidos sin facturar ─────────────────────────────────

const seleccionado = (seleccion: Record<string, number>, pedidoId: string) => seleccion[PEDIDO_PREFIX + pedidoId] !== undefined

/** Toggle "10% contado a todo": los pedidos sin facturar que quedan con el 10 % (solo los seleccionados). */
export function pedidosContadoAlAplicarTodo(activar: boolean, pedidosSinFacturarIds: string[], seleccion: Record<string, number>): string[] {
  if (!activar) return []
  return pedidosSinFacturarIds.filter((id) => seleccionado(seleccion, id))
}

/** Lo que viaja en `pedidos_contado`: los tildados con 10 % que ADEMÁS están seleccionados para cobrar. */
export function pedidosContadoAEnviar(contado: Iterable<string>, seleccion: Record<string, number>): string[] {
  return [...new Set(contado)].filter((id) => num(seleccion[PEDIDO_PREFIX + id]) > 0)
}

/** Anticipos a pedidos sin facturar de la selección (viajan en `pedidos_anticipo`). */
export function anticiposDeSeleccion(seleccion: Record<string, number>): Array<{ pedido_id: string; monto: number }> {
  return Object.entries(seleccion)
    .filter(([k, monto]) => k.startsWith(PEDIDO_PREFIX) && num(monto) > 0)
    .map(([k, monto]) => ({ pedido_id: k.slice(PEDIDO_PREFIX.length), monto: r2(num(monto)) }))
}

export interface AnticipoPedido { pedido_id: string; monto: number }

/** Servidor: normaliza `pedidos_anticipo`; null = el cliente (APK vieja) no lo manda. */
export function normalizarAnticipos(pedidos_anticipo: unknown): AnticipoPedido[] | null {
  if (!Array.isArray(pedidos_anticipo)) return null
  return pedidos_anticipo
    .map((a: any) => ({ pedido_id: String(a?.pedido_id || ""), monto: r2(num(a?.monto)) }))
    .filter((a) => a.pedido_id && a.monto > 0)
}

/**
 * Servidor: pedidos que reciben la marca del 10 %. Con `pedidos_anticipo` presente, solo los
 * que están en la selección; sin él (cliente anterior) se respeta `pedidos_contado` tal cual.
 */
export function pedidosContadoValidos(pedidos_contado: unknown, anticipos: AnticipoPedido[] | null): string[] {
  const contado = [...new Set((Array.isArray(pedidos_contado) ? pedidos_contado : []).map((id) => String(id || "")).filter(Boolean))]
  if (!anticipos) return contado
  const enSeleccion = new Set(anticipos.map((a) => a.pedido_id))
  return contado.filter((id) => enSeleccion.has(id))
}

// ─── Ajuste por redondeo ─────────────────────────────────────────────────────

/**
 * Base del tope = todo lo seleccionado (comprobantes + anticipos). Piso: lo que había que
 * entregar (monto entregado + lo perdonado), para los clientes que no mandan los anticipos.
 */
export function baseTopeAjuste(p: { imputado: number; anticipos: number; montoTotal: number; ajuste: number }): number {
  const seleccionadoTotal = num(p.imputado) + num(p.anticipos)
  const aEntregar = num(p.montoTotal) + Math.max(0, num(p.ajuste))
  return r2(Math.max(seleccionadoTotal, aEntregar))
}

export interface AjusteResuelto {
  /** Ajuste que se asienta (con signo). 0 = sin ajuste. */
  ajuste: number
  tope: number
  /** Motivo de rechazo definitivo (solo ajuste EN CONTRA por encima del tope) */
  rechazo: string | null
  /** El sobrante pedido como ajuste superaba el 1 %: quedó a cuenta del cliente */
  aviso: string | null
}

const pesos = (n: number) => `$ ${r2(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function resolverAjuste(ajustePedido: number, base: number): AjusteResuelto {
  const ajuste = r2(num(ajustePedido))
  const tope = topeAjuste(base)
  if (Math.abs(ajuste) <= 0.005) return { ajuste: 0, tope, rechazo: null, aviso: null }
  if (ajuste > 0) {
    // En contra (se le perdona saldo al cliente): tope 1 %
    if (ajuste > tope + 0.005)
      return { ajuste: 0, tope, aviso: null, rechazo: `El ajuste por redondeo (${pesos(ajuste)}) supera el tope del 1% de lo seleccionado (${pesos(tope)}). Dejá el saldo pendiente: lo resuelve la oficina.` }
    return { ajuste, tope, rechazo: null, aviso: null }
  }
  // Sobrante: nunca rebota. Chico ⇒ ajuste a favor; grande ⇒ a cuenta del cliente.
  if (Math.abs(ajuste) > tope + 0.005)
    return { ajuste: 0, tope, rechazo: null, aviso: `El sobrante de ${pesos(Math.abs(ajuste))} supera el 1% de lo seleccionado: quedó a cuenta del cliente.` }
  return { ajuste, tope, rechazo: null, aviso: null }
}

/** Pantalla: ¿se ofrece "ajuste por redondeo" para esta diferencia? (diff = entregado − a cobrar) */
export function ofreceAjuste(diff: number, totalSeleccionado: number): boolean {
  return Math.abs(r2(num(diff))) <= topeAjuste(totalSeleccionado) + 0.005
}

// ─── Cobrar cierra la parada ─────────────────────────────────────────────────
// Regla del dueño (29/09/2026): si el chofer registra un cobro en una parada, la parada está
// FINALIZADA: queda "entregado" (o "solo cobro" si no llevaba mercadería) sin tocar ningún
// botón. "Cerrar parada" queda para cuando NO hubo cobro (entregado sin cobrar, no entregado,
// parcial). Solo cierra una parada PENDIENTE: nunca pisa un resultado que el chofer ya cargó.
// Si oficina pidió "cobrar sí o sí" y lo cobrado no alcanza, NO bloquea: deja constancia.

export interface ParadaParaCierre {
  estado: string
  /** Bultos que llevaba la parada */
  bultos: number
  tienePedidos: boolean
  minimoExigido: number
  /** Cobrado en la parada INCLUYENDO el cobro que se acaba de registrar */
  cobrado: number
}
export interface CierrePorCobro {
  estado: "entregado" | "solo_cobro"
  bultos_entregados: number | null
  motivo_no_cobro: string | null
}

export function cierreDeParadaPorCobro(p: ParadaParaCierre): CierrePorCobro | null {
  if (p.estado !== "pendiente") return null
  const cumplido = num(p.cobrado) + 0.01 >= num(p.minimoExigido)
  return {
    estado: p.tienePedidos ? "entregado" : "solo_cobro",
    bultos_entregados: p.tienePedidos ? num(p.bultos) : null,
    motivo_no_cobro: cumplido ? null : `Cobró ${pesos(p.cobrado)} de ${pesos(p.minimoExigido)} exigidos (parada cerrada al registrar el cobro)`,
  }
}
