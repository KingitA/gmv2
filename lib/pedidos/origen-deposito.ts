// Pedidos CARGADOS EN DEPÓSITO (decisión de Juan, 05/11/2026): desde la app de
// Depósito, el empleado carga un pedido para su cuenta personal ("para mí") o
// para un cliente que se armó la mercadería ("para un cliente").
//  - Nace "pendiente" con pedidos.origen = deposito_propio / deposito_cliente y
//    se edita como cualquier pedido pendiente (condiciones, lista, renglones).
//  - No va a la cola de preparación: ya está armado.
//  - "Facturar varios" lo toma estando en "pendiente".
//  - Al facturar pasa directo a "entregado" (la mercadería ya salió): sin remito
//    (condicion_entrega = retira_mostrador) ni cobro de mostrador.
// Parte pura, compartida con los tests.

export const ORIGENES_DEPOSITO = ["deposito_propio", "deposito_cliente"] as const
export type OrigenDeposito = (typeof ORIGENES_DEPOSITO)[number]

export const ETIQUETA_CARGADO_EN_DEPOSITO = "Cargado en depósito"

export function esCargadoEnDeposito(p: { origen?: string | null } | null | undefined): boolean {
  return !!p?.origen && (ORIGENES_DEPOSITO as readonly string[]).includes(p.origen)
}

/** "Facturar varios": los preparados (pendiente_facturacion) y los cargados en depósito que siguen pendientes. */
export function facturableEnLote(p: { estado?: string | null; origen?: string | null }): boolean {
  return p.estado === "pendiente_facturacion" || (p.estado === "pendiente" && esCargadoEnDeposito(p))
}

// ─── Contrato con la app (outbox "pedido.cargar_deposito") ───────────────────

export interface PayloadPedidoDeposito {
  local_id: string
  modo: "propio" | "cliente"
  /** Solo en modo cliente */
  cliente_id?: string
  items: Array<{ articulo_id: string; cantidad: number }>
  observaciones?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const esUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v)

/** Forma del payload (null = válido). La lista vacía no es error de forma: es el rechazo "sin_items". */
export function validarPayloadPedidoDeposito(p: any): string | null {
  if (!p || typeof p !== "object") return "Pedido inválido"
  if (!esUuid(p.local_id)) return "Pedido inválido (local_id)"
  if (p.modo !== "propio" && p.modo !== "cliente") return "Pedido inválido: el modo es propio o cliente"
  if (p.modo === "cliente" && !esUuid(p.cliente_id)) return "Elegí el cliente del pedido"
  if (!Array.isArray(p.items)) return "Pedido inválido (items)"
  for (const it of p.items) {
    if (!esUuid(it?.articulo_id)) return "Hay un artículo inválido en el pedido"
    const c = Number(it?.cantidad)
    if (!Number.isFinite(c) || c <= 0 || c > 100000) return "Hay una cantidad inválida en el pedido"
  }
  if (p.observaciones != null && (typeof p.observaciones !== "string" || p.observaciones.length > 1000)) return "Observaciones inválidas"
  return null
}

/** El mismo artículo escaneado dos veces va en un solo renglón (se suman las cantidades), en el orden en que apareció. */
export function juntarItems(items: Array<{ articulo_id: string; cantidad: number }>): Array<{ articulo_id: string; cantidad: number }> {
  const m = new Map<string, number>()
  for (const it of items) m.set(it.articulo_id, Math.round(((m.get(it.articulo_id) ?? 0) + Number(it.cantidad)) * 1000) / 1000)
  return [...m].map(([articulo_id, cantidad]) => ({ articulo_id, cantidad }))
}

/** Artículos sin precio en la lista del cliente: sin lista para su segmento o con precio 0. */
export function articulosSinPrecio(
  articuloIds: string[],
  precioDe: (id: string) => { precio: number; sinLista: boolean } | null,
): string[] {
  return articuloIds.filter((id) => {
    const p = precioDe(id)
    return !p || p.sinLista || !(p.precio > 0)
  })
}

export const MENSAJE_SIN_CUENTA_PERSONAL = "Tu usuario no tiene cuenta personal. Pedile a la oficina que la vincule en Personal."

export function mensajeSinPrecio(descripciones: string[]): string {
  return `Estos artículos no tienen precio en la lista del cliente: ${descripciones.join(", ")}. Sacalos del pedido o pedile a la oficina que revise la lista.`
}
