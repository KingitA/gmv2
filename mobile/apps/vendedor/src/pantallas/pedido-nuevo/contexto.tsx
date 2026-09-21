import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"
import { ordenarArticulos, type OrdenArticulos } from "@gm/vendedor"
import { COND_VACIA, type Articulo, type Cliente, type CondPedido } from "../../datasets"
import { conArticulo, conCantidad, nuevoBorrador, sinArticulo, useBorrador, type Borrador, type ItemBorrador } from "../../datos/borradores"
import type { IndiceCatalogo } from "../../datos/busqueda"
import { useCatalogo, useCliente, useVentas } from "../../datos/hooks"
import { useMotorCliente, type MotorLocal } from "../../datos/precios"

// Estado COMPARTIDO por todas las pantallas del pedido en curso (/pedido/nuevo/:clienteId/*).
// En la web era un solo componente con ~40 useState; acá cada pantalla es una ruta, así
// que lo que tiene que sobrevivir al cambio de pantalla vive en el borrador durable
// (datos/borradores.ts) o en la URL, y esto solo lo junta.

export interface LineaCarrito extends ItemBorrador {
  precio: { precio: number; precioNeto: number } | null
  /** true = precio ya guardado del renglón (pedido confirmado, condiciones sin cambios) */
  fijo: boolean
}

export interface PedidoEnCurso {
  clienteId: string
  cliente: Cliente | null
  cargandoCliente: boolean
  borrador: Borrador | null
  cond: CondPedido
  motor: MotorLocal
  indice: IndiceCatalogo
  catalogoVacio: boolean
  ventas: Record<string, number>
  orden: OrdenArticulos
  setOrden(o: OrdenArticulos): void
  ordenar<T extends Articulo>(arts: T[]): T[]
  lineas: LineaCarrito[]
  total: number
  totalItems: number
  /** Unidades de un artículo ya en el pedido (undefined = no está) */
  enCarrito(articuloId: string): number | undefined
  agregar(a: Articulo, unidades: number): boolean
  setCantidad(articuloId: string, unidades: number): void
  quitar(articuloId: string): void
  setCond(c: CondPedido): void
  setObs(o: string): void
  descartar(): Promise<void>
  /** Reemplaza el borrador entero (retomar un pedido del servidor / uno pendiente de enviar) */
  cargarBorrador(b: Borrador): void
}

const Ctx = createContext<PedidoEnCurso | null>(null)

export function usePedidoEnCurso(): PedidoEnCurso {
  const v = useContext(Ctx)
  if (!v) throw new Error("usePedidoEnCurso fuera del pedido en curso")
  return v
}

const CLAVE_ORDEN = "gm.vendedor.orden"

export function ProveedorPedido({ clienteId, children }: { clienteId: string; children: ReactNode }) {
  const { cliente, cargando: cargandoCliente } = useCliente(clienteId)
  const { borrador, cambiar, descartar } = useBorrador(clienteId, cliente?.nombre || "")
  const { indice, vacio: catalogoVacio } = useCatalogo()
  const ventas = useVentas()
  const cond = borrador?.cond ?? COND_VACIA
  // Cliente dado de alta acá que todavía no está en la réplica de precios: nace con su lista y método
  const fichaLocal = useMemo(
    () => (cliente?.sinEnviar ? { lista_precio_id: cliente.lista_precio_id, metodo_facturacion: cliente.metodo_facturacion } : null),
    [cliente?.sinEnviar, cliente?.lista_precio_id, cliente?.metodo_facturacion],
  )
  const motor = useMotorCliente(clienteId, cond, fichaLocal)

  // Orden de los listados: persiste durante la sesión (igual que la web)
  const [orden, setOrdenState] = useState<OrdenArticulos>(() => {
    try { return (sessionStorage.getItem(CLAVE_ORDEN) as OrdenArticulos) || "default" } catch { return "default" }
  })
  const setOrden = useCallback((o: OrdenArticulos) => {
    setOrdenState(o)
    try { sessionStorage.setItem(CLAVE_ORDEN, o) } catch { /* noop */ }
  }, [])
  const ordenar = useCallback(<T extends Articulo>(arts: T[]) => ordenarArticulos(arts, orden, (a) => motor.precio(a.id)?.precio, ventas), [orden, motor, ventas])

  const base = useCallback(() => nuevoBorrador(clienteId, cliente?.nombre || ""), [clienteId, cliente?.nombre])

  // Editando un pedido ya confirmado, los renglones que ya tenía conservan SU precio
  // mientras no cambien las condiciones (la web solo re-precia si cambian método/lista/bonif)
  const condIntacta = !!borrador?.condOriginal && JSON.stringify(borrador.condOriginal) === JSON.stringify(cond)
  const lineas = useMemo<LineaCarrito[]>(
    () => (borrador?.items || []).map((i) => (condIntacta && i.precioFijo ? { ...i, precio: i.precioFijo, fijo: true } : { ...i, precio: motor.precio(i.articuloId), fijo: false })),
    [borrador?.items, motor, condIntacta],
  )
  const total = useMemo(() => lineas.reduce((s, l) => s + (l.precio?.precio || 0) * l.cantidad, 0), [lineas])
  const totalItems = useMemo(() => lineas.reduce((s, l) => s + l.cantidad, 0), [lineas])
  const cantidades = useMemo(() => new Map((borrador?.items || []).map((i) => [i.articuloId, i.cantidad])), [borrador?.items])

  const valor = useMemo<PedidoEnCurso>(
    () => ({
      clienteId, cliente, cargandoCliente, borrador, cond, motor, indice, catalogoVacio, ventas, orden, setOrden, ordenar, lineas, total, totalItems,
      enCarrito: (id) => cantidades.get(id),
      agregar(a, unidades) {
        const p = motor.precio(a.id)
        // Mismas guardas que agregarRapido de la web: sin precio no se vende
        if (!(unidades > 0) || !p || p.precio <= 0) return false
        cambiar((b) => conArticulo(b, { articuloId: a.id, cantidad: unidades, art: { descripcion: a.descripcion, sku: a.sku ?? null, unidades_por_bulto: a.unidades_por_bulto ?? null, imagen_url: a.imagen_url ?? null } }), base)
        return true
      },
      setCantidad: (id, u) => cambiar((b) => conCantidad(b, id, u), base),
      quitar: (id) => cambiar((b) => sinArticulo(b, id), base),
      setCond: (c) => cambiar((b) => ({ ...b, cond: c }), base),
      setObs: (o) => cambiar((b) => ({ ...b, obs: o }), base),
      descartar,
      cargarBorrador: (b) => cambiar(() => b, () => b),
    }),
    [clienteId, cliente, cargandoCliente, borrador, cond, motor, indice, catalogoVacio, ventas, orden, setOrden, ordenar, lineas, total, totalItems, cantidades, cambiar, base, descartar],
  )
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

// ─── Overlays con parámetro (?ver=articulo:<id>) ─────────────────────────────

/**
 * Overlay como entrada de historial (misma convención que useOverlay del core) pero
 * con valor dinámico: `?ver=articulo:<id>`. abrir() hace push; cerrar() vuelve atrás si
 * lo abrimos nosotros, o limpia la URL si se entró directo.
 */
export function useVer() {
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const ver = sp.get("ver")
  const abrir = useCallback(
    (valor: string, opts: { replace?: boolean } = {}) => {
      const n = new URLSearchParams(location.search)
      n.set("ver", valor)
      navigate({ pathname: location.pathname, search: `?${n}` }, { state: { overlay: true }, replace: opts.replace })
    },
    [location.pathname, location.search, navigate],
  )
  const cerrar = useCallback(() => {
    if (!ver) return
    if ((location.state as { overlay?: boolean } | null)?.overlay) navigate(-1)
    else {
      const n = new URLSearchParams(location.search)
      n.delete("ver")
      navigate({ pathname: location.pathname, search: n.size ? `?${n}` : "" }, { replace: true })
    }
  }, [ver, location.pathname, location.search, location.state, navigate])
  return { ver, abrir, cerrar }
}

/** Estado de un acordeón que sobrevive a ir al carrito y volver (en la web el carrito era un overlay y el árbol no se desmontaba). */
export function useAbiertos(clave: string, inicial: string[] = []): [Set<string>, (id: string) => void] {
  const k = `gm.vendedor.arbol:${clave}`
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      const v = sessionStorage.getItem(k)
      return new Set<string>(v ? JSON.parse(v) : inicial)
    } catch {
      return new Set(inicial)
    }
  })
  useEffect(() => {
    try { sessionStorage.setItem(k, JSON.stringify([...set])) } catch { /* noop */ }
  }, [k, set])
  const alternar = useCallback((id: string) => {
    setSet((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])
  return [set, alternar]
}
