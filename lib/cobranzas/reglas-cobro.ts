// Reglas PURAS del cobro en la calle (solo importa lib/formato, también puro: corre igual en el servidor, en la web y
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

import { moneda } from "../formato"

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
// REGLA (07/10/2026, dueño — reemplaza la del 01/10): la NC del 10% es SIEMPRE
// por el TOTAL del comprobante y se emite UNA sola vez: el primer cobro contado
// que lo toca la genera completa (aunque pague una parte) y después queda
// bloqueado para otra NC de contado. Si el cliente no cumple, se anula la NC/REV
// (y recién ahí se puede volver a emitir). Ej.: presupuesto $100 → NC $10, queda
// en $90; el cliente puede pagarlo en 3 × $30 o 2 × $45.

/** NC del 10% de contado de un comprobante: 10% de su total. */
export function ncContadoComprobante(totalFactura: number): number {
  return r2(Math.abs(num(totalFactura)) * 0.1)
}

/** @deprecated regla del 01/10 (NC sobre lo seleccionado): solo la usan las APK
 *  instaladas para estimar en pantalla; el servidor usa ncContadoComprobante. */
export function ncContado(seleccionadoHoy: number): number {
  return r2(Math.max(0, num(seleccionadoHoy)) * 0.1)
}

/** @deprecated regla del 01/10: inversa de ncContado. Sin uso en el servidor. */
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

const pesos = (n: number) => moneda(r2(n))

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
  /** 10 % contado y ajuste de los cobros: también cubren lo exigido (#27). Opcional (APK viejas). */
  descuentos?: number
  /** "NO ENTREGAR SIN COBRAR" (#23). Opcional (APK viejas). */
  bloqueada?: boolean
}
export interface CierrePorCobro {
  estado: "entregado" | "solo_cobro"
  bultos_entregados: number | null
  motivo_no_cobro: string | null
}

// #23 (regla de Juan, 25/10): con "NO ENTREGAR SIN COBRAR", si lo cobrado no llega a lo exigido
// la parada NO se cierra como entregada: queda pendiente y el chofer cobra más o marca "no entregado".
export const TEXTO_ENTREGA_BLOQUEADA = "Si no salda lo solicitado, retirar el pedido"
export const CODIGO_ENTREGA_BLOQUEADA = "ENTREGA_BLOQUEADA"

export function cobroCumple(p: { minimoExigido: number; cobrado: number; descuentos?: number }): boolean {
  return num(p.minimoExigido) <= 0 || num(p.cobrado) + num(p.descuentos) + 0.01 >= num(p.minimoExigido)
}

/**
 * R4 (27/10): anular un cobro de una parada "NO ENTREGAR SIN COBRAR" que ya quedó
 * cerrada (entregado / solo cobro). Si sin ese cobro deja de cumplir lo exigido:
 * con el viaje en curso la parada VUELVE A PENDIENTE (el chofer cobra de nuevo o
 * marca "no entregado"); con el viaje terminado se FRENA la anulación (la
 * mercadería ya se dejó: lo corrige la oficina). Sin bloqueo o cumpliendo igual, nada.
 */
export function efectoAnulacionEnParada(p: {
  estado: string
  bloqueada: boolean
  minimoExigido: number
  /** Cobrado en la parada SIN el cobro que se anula */
  cobradoSin: number
  descuentos?: number
  viajeEnCurso: boolean
}): "nada" | "reabrir" | "frenar" {
  if (!p.bloqueada || !["entregado", "solo_cobro"].includes(p.estado)) return "nada"
  if (cobroCumple({ minimoExigido: p.minimoExigido, cobrado: p.cobradoSin, descuentos: p.descuentos })) return "nada"
  return p.viajeEnCurso ? "reabrir" : "frenar"
}

export function cierreDeParadaPorCobro(p: ParadaParaCierre): CierrePorCobro | null {
  if (p.estado !== "pendiente") return null
  const cumplido = cobroCumple(p)
  if (p.bloqueada && !cumplido) return null
  const desc = num(p.descuentos)
  return {
    estado: p.tienePedidos ? "entregado" : "solo_cobro",
    bultos_entregados: p.tienePedidos ? num(p.bultos) : null,
    motivo_no_cobro: cumplido
      ? null
      : `Cobró ${pesos(p.cobrado)}${desc > 0.005 ? ` (+ ${pesos(desc)} de 10 % contado / ajuste)` : ""} de ${pesos(p.minimoExigido)} exigidos (parada cerrada al registrar el cobro)`,
  }
}

// ── P2-29 (regla de Juan, 2ª prueba): una devolución descuenta SOLO del comprobante al que
// pertenece. Si se cobra otro, no se puede restar (CHEN: la devolución del PRES 0028 se restó
// del 0026 y el 0026 quedó debiendo). Los renglones sin comprobante cobrable (sin origen o al
// PRES de respaldo 0002-00000001, que está en $0) no atan la devolución a ningún comprobante.
export interface RenglonDevolucionCobro {
  devolucion_id: string
  /** Comprobante de origen del renglón; null = sin origen */
  comprobante_venta_id: string | null
  /** El origen no es un débito cobrable (PRES de respaldo del sistema viejo) */
  sin_comprobante_cobrable?: boolean
  rechazado?: boolean
}

/** Por cada devolución, los comprobantes de origen que NO están entre los que se cobran. */
export function devolucionesFueraDelCobro(
  renglones: RenglonDevolucionCobro[],
  comprobantesCobrados: Iterable<string>,
): Map<string, string[]> {
  const cobrados = new Set(comprobantesCobrados)
  const fuera = new Map<string, Set<string>>()
  for (const r of renglones) {
    if (r.rechazado || !r.comprobante_venta_id || r.sin_comprobante_cobrable) continue
    if (cobrados.has(r.comprobante_venta_id)) continue
    if (!fuera.has(r.devolucion_id)) fuera.set(r.devolucion_id, new Set())
    fuera.get(r.devolucion_id)!.add(r.comprobante_venta_id)
  }
  return new Map([...fuera].map(([k, v]) => [k, [...v]]))
}
