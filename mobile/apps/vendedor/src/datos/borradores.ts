// BORRADOR del pedido en curso, durable en el equipo (IndexedDB · kv).
//
// En la web el carrito ES un pedido "en_venta" en la base, guardado ítem a ítem: sin
// señal eso no existe. Acá cada cambio del carrito se persiste en el acto (clave
// `borrador:<usuario>:<cliente>`), así matar la app a mitad de un pedido no pierde
// nada, y al confirmar viaja COMPLETO en una sola operación del outbox
// (pedido.crear / pedido.editar). Un borrador por cliente, igual que la web retoma
// el "en_venta" abierto del cliente en vez de duplicar.
//
// El borrador guarda artículos y cantidades, NUNCA precios: el precio se calcula al
// mostrarlo con el motor (MOBILE.md §5).

import { useCallback, useMemo, useSyncExternalStore } from "react"
import { Emisor, useRuntime, useSesion, uuidv4, type Runtime } from "@gm/core"
import { COND_VACIA, type CondPedido } from "../datasets"

export interface ItemBorrador {
  articuloId: string
  cantidad: number
  /** Renglón del pedido en el servidor (solo al editar uno existente) */
  detalleId?: string | null
  /**
   * Precio YA guardado del renglón (pedido confirmado que se edita). Vale mientras no
   * cambien las condiciones del pedido: igual que la web, que solo re-precia si cambian.
   */
  precioFijo?: { precio: number; precioNeto: number } | null
  /** Lo mínimo para mostrar la línea aunque el artículo salga del catálogo */
  art: { descripcion: string; sku: string | null; unidades_por_bulto: number | null; imagen_url: string | null }
}

export interface Borrador {
  /** Id del pedido en el equipo (⇒ pedidos.movil_local_id). No cambia al re-editar. */
  localId: string
  clienteId: string
  clienteNombre: string
  /** Presente = se están editando los renglones de un pedido que ya existe en el servidor */
  pedidoId: string | null
  numeroPedido: string | null
  estadoPedido: string | null
  items: ItemBorrador[]
  cond: CondPedido
  /** Condiciones con las que está guardado el pedido que se edita (null = pedido nuevo / en_venta) */
  condOriginal?: CondPedido | null
  obs: string
  actualizadoAt: string
}

const PREFIJO = "borrador:"

class AlmacenBorradores {
  private emisor = new Emisor()
  private mapa = new Map<string, Borrador>()
  private lista: Borrador[] = []
  private cargado = false
  private cola: Promise<unknown> = Promise.resolve()

  constructor(private rt: Runtime) {}

  suscribir = (fn: () => void) => this.emisor.suscribir(fn)
  todos = () => this.lista

  private clave(uid: string, clienteId: string) {
    return `${PREFIJO}${uid}:${clienteId}`
  }

  /** Lee todos los borradores del equipo (una vez; milisegundos, sin red). */
  async cargar() {
    if (this.cargado) return
    this.cargado = true
    const db = this.rt.db
    const claves = (await db.getAllKeys("kv")).filter((k) => typeof k === "string" && k.startsWith(PREFIJO)) as string[]
    for (const k of claves) {
      const b = (await db.get("kv", k)) as Borrador | undefined
      if (b?.clienteId) this.mapa.set(k, b)
    }
    this.publicar()
  }

  private publicar() {
    this.lista = [...this.mapa.values()]
    this.emisor.emitir()
  }

  de(uid: string, clienteId: string): Borrador | null {
    return this.mapa.get(this.clave(uid, clienteId)) ?? null
  }

  /** Persiste y publica. La escritura es secuencial: el último estado siempre gana. */
  guardar(uid: string, b: Borrador): Promise<void> {
    const k = this.clave(uid, b.clienteId)
    const fila = { ...b, actualizadoAt: new Date().toISOString() }
    this.mapa.set(k, fila)
    this.publicar()
    const p = this.cola.then(() => this.rt.db.put("kv", fila, k)).then(() => {})
    this.cola = p.catch(() => {})
    return p
  }

  descartar(uid: string, clienteId: string): Promise<void> {
    const k = this.clave(uid, clienteId)
    this.mapa.delete(k)
    this.publicar()
    const p = this.cola.then(() => this.rt.db.delete("kv", k))
    this.cola = p.catch(() => {})
    return p
  }
}

const almacenes = new WeakMap<Runtime, AlmacenBorradores>()
export function almacenBorradores(rt: Runtime): AlmacenBorradores {
  let a = almacenes.get(rt)
  if (!a) {
    almacenes.set(rt, (a = new AlmacenBorradores(rt)))
    void a.cargar()
  }
  return a
}

export function nuevoBorrador(clienteId: string, clienteNombre: string, extra: Partial<Borrador> = {}): Borrador {
  return {
    localId: uuidv4(), clienteId, clienteNombre, pedidoId: null, numeroPedido: null, estadoPedido: null,
    items: [], cond: COND_VACIA, obs: "", actualizadoAt: new Date().toISOString(), ...extra,
  }
}

/** Todos los borradores del usuario logueado (para "tenés un pedido a medio cargar"). */
export function useBorradores(): Borrador[] {
  const rt = useRuntime()
  const { sesion } = useSesion()
  const almacen = almacenBorradores(rt)
  const todos = useSyncExternalStore(almacen.suscribir, almacen.todos)
  const uid = sesion?.user.id ?? ""
  // Las claves llevan el usuario; acá alcanza con filtrar por lo que el almacén le devuelve a ESE usuario
  return useMemo(() => todos.filter((b) => almacen.de(uid, b.clienteId) === b), [todos, almacen, uid])
}

export interface ManejoBorrador {
  borrador: Borrador | null
  /** Aplica un cambio (crea el borrador si no existía) y lo persiste en el acto. */
  cambiar(fn: (b: Borrador) => Borrador, base?: () => Borrador): void
  descartar(): Promise<void>
}

export function useBorrador(clienteId: string | undefined, clienteNombre = ""): ManejoBorrador {
  const rt = useRuntime()
  const { sesion } = useSesion()
  const uid = sesion?.user.id ?? ""
  const almacen = almacenBorradores(rt)
  const todos = useSyncExternalStore(almacen.suscribir, almacen.todos)
  const borrador = useMemo(() => (clienteId ? almacen.de(uid, clienteId) : null), [todos, almacen, uid, clienteId]) // eslint-disable-line react-hooks/exhaustive-deps

  const cambiar = useCallback(
    (fn: (b: Borrador) => Borrador, base?: () => Borrador) => {
      if (!clienteId || !uid) return
      const actual = almacen.de(uid, clienteId) ?? base?.() ?? nuevoBorrador(clienteId, clienteNombre)
      void almacen.guardar(uid, fn(actual))
    },
    [almacen, uid, clienteId, clienteNombre],
  )
  const descartar = useCallback(() => (clienteId && uid ? almacen.descartar(uid, clienteId) : Promise.resolve()), [almacen, uid, clienteId])
  return { borrador, cambiar, descartar }
}

// ── Operaciones puras sobre el carrito (mismas reglas que la web) ──

/** Agregar: si el artículo ya está, SUMA la cantidad (igual que agregarArticuloAlPedido). */
export function conArticulo(b: Borrador, item: ItemBorrador): Borrador {
  const ya = b.items.find((i) => i.articuloId === item.articuloId)
  return {
    ...b,
    items: ya ? b.items.map((i) => (i.articuloId === item.articuloId ? { ...i, cantidad: i.cantidad + item.cantidad } : i)) : [...b.items, item],
  }
}

/** Cantidad TOTAL de la línea (absoluta). Menos de 1 no se acepta (para quitar está sinArticulo). */
export function conCantidad(b: Borrador, articuloId: string, cantidad: number): Borrador {
  if (!(cantidad > 0)) return b
  return { ...b, items: b.items.map((i) => (i.articuloId === articuloId ? { ...i, cantidad } : i)) }
}

export const sinArticulo = (b: Borrador, articuloId: string): Borrador => ({ ...b, items: b.items.filter((i) => i.articuloId !== articuloId) })
