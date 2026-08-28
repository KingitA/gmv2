"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { formatCurrency } from "@/lib/utils"
import { localMatch } from "@/lib/search/local-match"
import { useBackTrap } from "@/lib/vendedor/use-back-trap"
import { CatalogoArbol } from "@/components/vendedor/CatalogoArbol"
import { OrdenSelector } from "@/components/vendedor/OrdenSelector"
import { ordenarArticulos, type OrdenArticulos } from "@/lib/vendedor/orden-articulos"
import {
  actualizarCantidadItem,
  agregarItemPedido,
  aplicarCondicionesPedidoVendedor,
  confirmarPedidoVendedor,
  createPedido,
  eliminarItemPedido,
  previewPrecioArticulo,
  previewPreciosArticulos,
} from "@/lib/actions/pedidos"
import {
  ArteRubro,
  IconoCategoria,
  TINTE_HABITUALES,
  TINTE_NOVEDADES,
  TINTE_OFERTAS,
  tinteRubro,
  type Tinte,
} from "./catalogo-ui"
import { ZoomImageOverlay } from "@/components/vendedor/zoom-image"
import { BuscarPorFoto } from "@/components/vendedor/buscar-por-foto"

interface Articulo {
  id: string
  sku: string | null
  // En DB es text[]: un artículo puede tener varios códigos de barras
  ean13: string | string[] | null
  descripcion: string
  unidades_por_bulto: number | null
  tipo_fraccion?: string | null
  cantidad_fraccion?: number | null
  stock_disponible: number
  descuento_propio: number
  iva_ventas: string | null
  marca: string | null
  proveedor: string | null
  imagen_url: string | null
  rubro_id: string | null
  categoria_id: string | null
  subcategoria_id: string | null
  rubro_nombre: string | null
  categoria_nombre: string | null
  subcategoria_nombre: string | null
  veces_pedido?: number
  cantidad_habitual?: number
}

interface ClienteSel {
  id: string
  nombre: string
  razon_social?: string | null
  cuit?: string | null
  codigo_cliente?: string | null
  direccion?: string | null
  localidad: string | null
  metodo_facturacion: string | null
  lista_precio_id?: string | null
  lista?: { nombre: string } | null
  vendedor_id?: string | null
  saldo_actual?: number
}

// Condiciones comerciales "solo este pedido" (overrides guardados en pedidos.*)
type BonifSeg = Partial<Record<"limpieza_bazar" | "perf0" | "perf_plus", number>>
interface BonifPedidoUI {
  viajante?: BonifSeg | null
  mercaderia?: BonifSeg | null
}
interface CondPedido {
  metodo: string                 // "" = método del cliente
  lista: string                  // "" = lista del cliente
  bonif: BonifPedidoUI | null    // null = bonificaciones de la ficha (por tipo y segmento)
}
const COND_VACIA: CondPedido = { metodo: "", lista: "", bonif: null }
const SEGS = ["limpieza_bazar", "perf0", "perf_plus"] as const
const SEG_LABEL: Record<(typeof SEGS)[number], string> = { limpieza_bazar: "Limpieza / Bazar", perf0: "Perfumería 0", perf_plus: "Perfumería plus" }
const bonifVacia = (b: BonifPedidoUI | null | undefined) =>
  !b || ((!b.viajante || !Object.keys(b.viajante).length) && (!b.mercaderia || !Object.keys(b.mercaderia).length))
const condToOverrides = (c: CondPedido) => ({
  ...(c.metodo ? { metodo_facturacion_pedido: c.metodo } : {}),
  ...(c.lista ? { lista_precio_pedido_id: c.lista } : {}),
  ...(!bonifVacia(c.bonif) ? { bonif_pedido: c.bonif } : {}),
})
// Fila compacta del catálogo desplegable: miniatura (tap = foto grande) ·
// sku · descripción · -oferta% · marca · x u/bulto · precio, y a la derecha
// una casilla de cantidad con "bultos" (si no, unidades) + botón agregar.
// Vive FUERA del componente de página: si se definiera adentro, React la
// remontaría en cada render y la casilla perdería el foco a cada tecla.
function FilaArticulo({
  a,
  precio,
  enCarrito,
  onAbrir,
  onZoom,
  onAgregar,
}: {
  a: Articulo
  precio?: { precio: number; precioNeto: number; especial: { bruto: number; oferta_pct: number } | null }
  enCarrito?: number
  onAbrir: () => void
  onZoom: () => void
  onAgregar: (unidades: number) => void
}) {
  const [cant, setCant] = useState("")
  const [bultos, setBultos] = useState(false)
  if (precio && precio.precio <= 0) return null
  const ub = a.unidades_por_bulto || 1
  const n = parseFloat(cant.replace(",", "."))
  const unidades = Number.isFinite(n) && n > 0 ? (bultos ? n * ub : n) : 0
  const agregar = () => {
    if (unidades <= 0) return
    onAgregar(unidades)
    setCant("")
  }
  return (
    <div className={`w-full flex items-center gap-2 rounded-lg pl-1.5 pr-1.5 py-1.5 bg-white border ${enCarrito ? "border-emerald-500" : "border-gray-100"}`}>
      {/* Miniatura: tap abre la foto grande */}
      <button onClick={onZoom} className="w-11 h-11 rounded-md bg-gray-50 shrink-0 overflow-hidden flex items-center justify-center active:opacity-70">
        {a.imagen_url ? (
          <img src={a.imagen_url} alt="" loading="lazy" className="w-full h-full object-contain" />
        ) : (
          <span className="text-gray-300 text-lg">📦</span>
        )}
      </button>
      {/* Descripción: tap abre la ficha completa */}
      <button onClick={onAbrir} className="min-w-0 flex-1 text-left active:opacity-70">
        <p className="font-bold text-gray-900 text-[13px] leading-snug">
          {a.descripcion}
          {a.descuento_propio > 0 && (
            <span className="ml-1.5 inline-block bg-red-100 text-red-700 px-1.5 rounded text-[10px] font-bold align-middle">-{a.descuento_propio}%</span>
          )}
          {enCarrito ? (
            <span className="ml-1.5 inline-block bg-emerald-600 text-white px-1.5 rounded text-[10px] font-bold align-middle">🛒 {enCarrito}</span>
          ) : null}
        </p>
        <p className="text-[11px] text-gray-400 truncate">
          <span className="font-mono">{a.sku || "—"}</span>
          {a.marca ? ` · ${a.marca}` : ""}
          {a.unidades_por_bulto ? ` · x${a.unidades_por_bulto}` : ""}
          {" · "}
          <span className="font-bold text-gray-700">{precio ? formatCurrency(precio.especial ? precio.precioNeto : precio.precio) : "…"}</span>
        </p>
      </button>
      {/* Cantidad + bultos + agregar */}
      <div className="shrink-0 flex items-center gap-1">
        <div className="flex flex-col items-center gap-0.5">
          <input
            value={cant}
            onChange={(e) => setCant(e.target.value.replace(/[^\d.,]/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregar() } }}
            inputMode="decimal"
            placeholder="0"
            className="w-14 rounded-md border border-gray-300 px-1.5 py-1.5 text-center font-bold text-gray-900 text-sm"
            aria-label="Cantidad"
          />
          <label className="flex items-center gap-1 text-[10px] text-gray-500 select-none">
            <input type="checkbox" checked={bultos} onChange={(e) => setBultos(e.target.checked)} className="w-3 h-3 accent-emerald-600" />
            bultos{bultos && ub > 1 ? ` (=${unidades} u)` : ""}
          </label>
        </div>
        <button
          onClick={agregar}
          disabled={unidades <= 0}
          className="w-9 h-9 rounded-lg bg-emerald-600 text-white text-xl font-bold leading-none disabled:bg-gray-200 disabled:text-gray-400 active:scale-95"
          aria-label="Agregar al pedido"
        >
          +
        </button>
      </div>
    </div>
  )
}

const fmtSeg = (s: BonifSeg | null | undefined) => {
  if (!s) return "—"
  const v = SEGS.map((k) => s[k] ?? 0)
  if (v.every((x) => x === v[0])) return v[0] ? `${v[0]}%` : "0%"
  return `L/B ${v[0]}% · P0 ${v[1]}% · P+ ${v[2]}%`
}

// Datos mínimos del artículo dentro del carrito (al retomar un pedido
// guardado solo tenemos lo que devuelve el detalle, no el Articulo completo).
interface CartArticulo {
  id: string
  descripcion: string
  sku?: string | null
  unidades_por_bulto?: number | null
  imagen_url?: string | null
}

interface CartItem {
  detalleId: string // id de pedidos_detalle — el carrito vive en DB (autoguardado)
  articulo: CartArticulo
  cantidad: number
  precio: number // al cliente
  precioNeto: number
  pendiente?: boolean // optimista: todavía no confirmado por el server
}

interface CatalogoSubcategoria {
  id: string
  nombre: string
  cantidad: number
}

interface CatalogoCategoria {
  id: string
  nombre: string
  cantidad: number
  subcategorias: CatalogoSubcategoria[]
}

interface CatalogoRubro {
  id: string
  nombre: string
  slug: string | null
  descripcion?: string | null
  imagen_url?: string | null
  cantidad?: number
  categorias: CatalogoCategoria[]
}

type Filtro = "novedades" | "ofertas" | "habituales"

// Clave de agrupamiento por categoría/subcategoría con fallback al nombre:
// los artículos nuevos pueden venir sin FK (categoria_id null) pero con el
// nombre en texto — sin esto todos caerían juntos en "Otros".
const claveCategoria = (a: Articulo) => a.categoria_id || (a.categoria_nombre ? `n:${a.categoria_nombre}` : "otros")
const claveSubcategoria = (a: Articulo) =>
  a.subcategoria_id || (a.subcategoria_nombre ? `n:${a.subcategoria_nombre}` : null)

type Ctx =
  | { tipo: Filtro }
  | { tipo: "rubro"; rubroId: string; rubroNombre: string }
  | { tipo: "proveedor"; proveedorId: string; proveedorNombre: string }

type Nav =
  | { s: "home" }
  | { s: "provs" } // selector de proveedor
  | { s: "cats"; ctx: Ctx }
  | { s: "arts"; ctx: Ctx; catId: string | null; catNombre: string; rubroNombre: string | null }

interface ProveedorCatalogo {
  id: string
  nombre: string
  sigla: string | null
  cantidad: number
}

// Tinte del modo "por proveedor" (gris azulado, distinto de los rubros)
const TINTE_PROVEEDORES: Tinte = { bg: "#E8EDF4", bgSoft: "#F4F7FA", ink: "#33475E", accent: "#5B7A9D", border: "#D4DEE9" }

const FILTROS: Record<Filtro, { label: string; sub: string; tinte: Tinte; icono: React.ReactNode }> = {
  novedades: {
    label: "Novedades",
    sub: "Últimos ingresos",
    tinte: TINTE_NOVEDADES,
    icono: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" aria-hidden>
        <path
          d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3ZM18.5 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  ofertas: {
    label: "Ofertas",
    sub: "Con descuento",
    tinte: TINTE_OFERTAS,
    icono: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" aria-hidden>
        <path
          d="M11 3.5h6.5c1.7 0 3 1.3 3 3V13L12 21.5c-1 1-2.6 1-3.5 0L3.5 16.5c-1-1-1-2.6 0-3.5L11 3.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="15.5" cy="8.5" r="1.6" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
  },
  habituales: {
    label: "Habituales",
    sub: "Lo de siempre",
    tinte: TINTE_HABITUALES,
    icono: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" aria-hidden>
        <path
          d="M12 3.5l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
}

function NuevoPedidoInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const clienteParam = searchParams.get("cliente")
  const pedidoParam = searchParams.get("pedido")

  const [cliente, setCliente] = useState<ClienteSel | null>(null)
  const [clientes, setClientes] = useState<ClienteSel[]>([])
  const [qCliente, setQCliente] = useState("")

  // ── Navegación del catálogo ─────────────────────────────────────────
  const [nav, setNav] = useState<Nav>({ s: "home" })
  const [catalogo, setCatalogo] = useState<CatalogoRubro[]>([])
  const [listas, setListas] = useState<Partial<Record<Filtro, Articulo[]>>>({})
  const [cargandoLista, setCargandoLista] = useState(false)
  const [artsCategoria, setArtsCategoria] = useState<Articulo[]>([])
  const [cargandoArts, setCargandoArts] = useState(false)
  const [subSel, setSubSel] = useState<string | null>(null)
  // Búsqueda local DENTRO del filtro/categoría abierta (no toca el server)
  const [qFiltro, setQFiltro] = useState("")
  // Orden de los listados (precio / ventas / marca) — persiste durante la sesión
  const [orden, setOrden] = useState<OrdenArticulos>("default")
  // Unidades vendidas por artículo (180 días) para "ordenar por ventas"
  const [ventas, setVentas] = useState<Record<string, number>>({})
  useEffect(() => {
    fetch("/api/vendedor/articulos-ventas")
      .then((r) => r.json())
      .then((d) => setVentas(d.ventas || {}))
      .catch(() => {})
  }, [])
  // Cambiar de pantalla/categoría limpia la búsqueda del filtro
  useEffect(() => setQFiltro(""), [nav])

  // ── Navegación por proveedor ────────────────────────────────────────
  const [proveedores, setProveedores] = useState<ProveedorCatalogo[]>([])
  const [cargandoProvs, setCargandoProvs] = useState(false)
  const [qProv, setQProv] = useState("")
  const [artsProveedor, setArtsProveedor] = useState<Articulo[]>([])
  const [cargandoArtsProv, setCargandoArtsProv] = useState(false)
  const provCache = useRef<Map<string, Articulo[]>>(new Map())
  // Artículos cargados por el árbol del home (por categoría), para re-preciar
  const artsArbolRef = useRef<Map<string, Articulo[]>>(new Map())

  // ── Búsqueda ────────────────────────────────────────────────────────
  const [q, setQ] = useState("")
  const [resultados, setResultados] = useState<Articulo[]>([])
  const [buscando, setBuscando] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Colectora: después de agregar un artículo escaneado, el foco vuelve al
  // buscador para encadenar el próximo escaneo sin tocar la pantalla
  const inputBusqueda = useRef<HTMLInputElement | null>(null)
  const vinoDeScan = useRef(false)

  // Precios por artículo para las listas del catálogo (batch, por cliente+método)
  const [precios, setPrecios] = useState<Record<string, { precio: number; precioNeto: number; contado: number; ivaIncluido: boolean; especial: { bruto: number; oferta_pct: number } | null; bonifViajantePct?: number }>>({})
  const preciosPedidos = useRef<Set<string>>(new Set())

  const [sel, setSel] = useState<Articulo | null>(null)
  const selIdRef = useRef<string | null>(null) // guarda contra respuestas tardías de preview
  const [zoomFoto, setZoomFoto] = useState<string | null>(null)
  const [buscarFoto, setBuscarFoto] = useState(false)
  const [selPrecio, setSelPrecio] = useState<{ precio: number; precioNeto: number; contado: number; especial: { bruto: number; oferta_pct: number } | null; bonifViajantePct?: number } | null>(null)
  // Cantidad en el modo elegido; arranca vacía (sin el "1" fantasma)
  const [selCantidad, setSelCantidad] = useState<number | "">("")
  const [selModo, setSelModo] = useState<"unidad" | "fraccion" | "bulto">("unidad")
  const [cargandoPrecio, setCargandoPrecio] = useState(false)

  const [cart, setCart] = useState<CartItem[]>([])
  const [verCarrito, setVerCarrito] = useState(false)
  // Panel de acceso rápido al cliente (ficha, CC, método de facturación)
  const [verCliente, setVerCliente] = useState(false)
  const [metodoSel, setMetodoSel] = useState("")
  const [listaSel, setListaSel] = useState("")
  // Edición de bonificaciones en el panel: { "viajante.limpieza_bazar": "10", ... }
  const [bonifSel, setBonifSel] = useState<Record<string, string>>({})
  const [obs, setObs] = useState("")
  // Overrides "solo este pedido" (persisten en pedidos.metodo_facturacion_pedido /
  // lista_precio_pedido_id / bonif_viajante_pedido_pct)
  const [cond, setCond] = useState<CondPedido>(COND_VACIA)
  const metodoOverride = cond.metodo
  const setMetodoOverride = (m: string) => setCond((p) => ({ ...p, metodo: m }))
  // Catálogos para el panel del cliente: listas, permiso de lista, viajantes
  const [catFicha, setCatFicha] = useState<{
    listas_precio: { id: string; nombre: string }[]
    vendedores: { id: string; lista_precio_id?: string | null; lista_nombre?: string | null }[]
    puede_cambiar_lista: boolean
  } | null>(null)
  // Bonificaciones vigentes en la ficha (por tipo y segmento)
  const [bonifCliente, setBonifCliente] = useState<{ viajante: BonifSeg; mercaderia: BonifSeg } | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [pedidoOk, setPedidoOk] = useState<{ numero: string; editado?: boolean } | null>(null)

  // ── Pedido en DB (autoguardado en tiempo real) ──────────────────────
  // El carrito se persiste ítem a ítem: al primer artículo se crea el pedido
  // en estado "en_venta" y cada cambio se sincroniza. El ERP lo ve al instante.
  const [pedidoId, setPedidoId] = useState<string | null>(pedidoParam)
  const [numeroPedido, setNumeroPedido] = useState<string | null>(null)
  const [estadoPedido, setEstadoPedido] = useState<string | null>(null)
  const [sync, setSync] = useState<"idle" | "saving" | "error">("idle")
  const pedidoIdRef = useRef<string | null>(pedidoParam)
  const cartRef = useRef<CartItem[]>([])
  const opQueue = useRef<Promise<void>>(Promise.resolve())
  const cantTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    cartRef.current = cart
  }, [cart])
  // Escritura del carrito con el ref sincronizado AL INSTANTE (no al próximo
  // render): las operaciones encoladas leen cartRef y no pueden ver estado viejo.
  const updateCart = (fn: (prev: CartItem[]) => CartItem[]) => {
    const next = fn(cartRef.current)
    cartRef.current = next
    setCart(next)
  }
  const esTmp = (detalleId: string) => detalleId.startsWith("tmp-")

  // Serializa las mutaciones al pedido (evita carreras entre taps rápidos)
  const enqueue = (op: () => Promise<void>) => {
    opQueue.current = opQueue.current.then(op).catch(() => {})
    return opQueue.current
  }

  // Rehidrata el carrito desde el pedido guardado (fuente de verdad: DB)
  const refreshPedido = useCallback(
    async (id: string, opts?: { hydrateMeta?: boolean }) => {
      const r = await fetch(`/api/vendedor/pedidos/${id}`)
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      const p = d.pedido
      setNumeroPedido(p.numero_pedido || null)
      setEstadoPedido(p.estado || null)
      const items = (p.pedidos_detalle || []).filter((i: any) => !i.es_bonificado)
      updateCart(() =>
        items.map((i: any) => ({
          detalleId: i.id,
          articulo: {
            id: i.articulos?.id || i.articulo_id,
            descripcion: i.articulos?.descripcion || "Artículo",
            sku: i.articulos?.sku ?? null,
            unidades_por_bulto: i.articulos?.unidades_por_bulto ?? null,
            imagen_url: i.articulos?.imagen_url ?? null,
          },
          cantidad: i.cantidad,
          precio: i.precio_final,
          precioNeto: i.precio_base,
        }))
      )
      if (opts?.hydrateMeta) {
        setObs(p.observaciones || "")
        setCond({
          metodo: p.metodo_facturacion_pedido || "",
          lista: p.lista_precio_pedido_id || "",
          bonif: p.bonif_pedido && typeof p.bonif_pedido === "object" ? p.bonif_pedido : null,
        })
        if (p.clientes) {
          setCliente((prev) =>
            prev || {
              id: p.clientes.id,
              nombre: p.clientes.nombre,
              localidad: p.clientes.localidad,
              metodo_facturacion: p.clientes.metodo_facturacion,
              lista_precio_id: p.clientes.lista_precio_id ?? null,
              lista: p.clientes.lista ?? null,
            }
          )
        }
      }
      return p
    },
    []
  )

  // Retomar pedido desde la URL (?pedido=): al volver a entrar no se pierde nada
  useEffect(() => {
    if (!pedidoParam) return
    pedidoIdRef.current = pedidoParam
    setPedidoId(pedidoParam)
    refreshPedido(pedidoParam, { hydrateMeta: true }).catch(() => setSync("error"))
  }, [pedidoParam, refreshPedido])

  // Si el cliente ya tiene un pedido "en venta" abierto, retomarlo en vez de duplicar
  useEffect(() => {
    if (!cliente || pedidoIdRef.current) return
    let cancel = false
    fetch(`/api/vendedor/pedidos?estado=en_venta&cliente=${cliente.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancel || pedidoIdRef.current) return
        const p = d.pedidos?.[0]
        if (p) router.replace(`/vendedor/pedido/nuevo?cliente=${cliente.id}&pedido=${p.id}`)
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [cliente, router])

  // ── Selección de cliente ────────────────────────────────────────────
  useEffect(() => {
    if (clienteParam) {
      fetch(`/api/vendedor/cliente/${clienteParam}`)
        .then((r) => r.json())
        .then((d) => {
          if (!d.error) setCliente(d.cliente)
        })
        .catch(() => {})
    }
  }, [clienteParam])

  // Catálogos del panel (listas, permiso) una vez; bonif viajante por cliente
  useEffect(() => {
    fetch("/api/vendedor/catalogos-ficha")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return
        setCatFicha({
          listas_precio: d.listas_precio || [],
          vendedores: d.vendedores || [],
          puede_cambiar_lista: !!d.puede_cambiar_lista,
        })
      })
      .catch(() => {})
  }, [])
  const cargarBonifCliente = useCallback((clienteId: string) => {
    fetch(`/api/vendedor/cliente/${clienteId}/bonificaciones`)
      .then((r) => r.json())
      .then((d) => {
        const b = d.bonificaciones
        setBonifCliente(b ? { viajante: b.viajante || {}, mercaderia: b.mercaderia || {} } : null)
      })
      .catch(() => setBonifCliente(null))
  }, [])
  useEffect(() => {
    if (cliente?.id) cargarBonifCliente(cliente.id)
  }, [cliente?.id, cargarBonifCliente])

  useEffect(() => {
    if (!clienteParam) {
      fetch("/api/vendedor/clientes")
        .then((r) => r.json())
        .then((d) => !d.error && setClientes(d.clientes))
        .catch(() => {})
    }
  }, [clienteParam])

  // Taxonomía (rubros → categorías → subcategorías) una sola vez
  useEffect(() => {
    if (!cliente) return
    fetch("/api/vendedor/catalogo")
      .then((r) => r.json())
      .then((d) => !d.error && setCatalogo(d.rubros || []))
      .catch(() => {})
  }, [cliente])

  // ── Precios de las listas del catálogo (batch, cache por artículo) ──
  const cargarPrecios = useCallback(
    async (arts: Articulo[]) => {
      if (!cliente || !arts.length) return
      const ids = arts.map((a) => a.id).filter((id) => !preciosPedidos.current.has(id))
      if (!ids.length) return
      for (const id of ids) preciosPedidos.current.add(id)
      try {
        const res = await previewPreciosArticulos(cliente.id, ids, condToOverrides(cond))
        setPrecios((prev) => {
          const next = { ...prev }
          for (const p of res)
            next[p.articulo_id] = { precio: p.precio, precioNeto: p.precioNeto, contado: p.contado, ivaIncluido: p.ivaIncluido, especial: p.especial ?? null, bonifViajantePct: p.bonifViajantePct || 0 }
          return next
        })
      } catch (e) {
        console.error("Error cargando precios del listado:", e)
        for (const id of ids) preciosPedidos.current.delete(id)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cliente, cond.metodo, cond.lista, cond.bonif]
  )

  // Vacía el cache de precios y recalcula todo lo cargado en pantalla
  const recalcularPreciosCatalogo = useCallback(() => {
    setPrecios({})
    preciosPedidos.current = new Set()
    const cargados: Articulo[] = [
      ...Object.values(listas).flatMap((l) => l || []),
      ...artsCategoria,
      ...resultados,
      ...[...artsArbolRef.current.values()].flat(), // categorías abiertas en el árbol
    ]
    if (cargados.length) cargarPrecios(cargados)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listas, artsCategoria, resultados, cargarPrecios])

  // Al cambiar método/lista/bonif del pedido, los precios del catálogo se recalculan
  useEffect(() => {
    recalcularPreciosCatalogo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cond.metodo, cond.lista, cond.bonif])

  // ── Carga de listas por filtro (novedades/ofertas/habituales) ───────
  const cargarLista = useCallback(
    (tipo: Filtro) => {
      if (!cliente || listas[tipo]) return
      setCargandoLista(true)
      const params = new URLSearchParams({ vista: tipo, cliente: cliente.id })
      fetch(`/api/vendedor/articulos?${params}`)
        .then((r) => r.json())
        .then((d) => {
          const arts = d.articulos || []
          setListas((prev) => ({ ...prev, [tipo]: arts }))
          cargarPrecios(arts)
        })
        .catch(() => setListas((prev) => ({ ...prev, [tipo]: [] })))
        .finally(() => setCargandoLista(false))
    },
    [cliente, listas, cargarPrecios]
  )

  // ── Artículos de una categoría (navegación por rubro) ───────────────
  const cargarCategoria = useCallback(
    (catId: string) => {
      if (!cliente) return
      setCargandoArts(true)
      const params = new URLSearchParams({ vista: "categoria", cliente: cliente.id, categoria: catId })
      fetch(`/api/vendedor/articulos?${params}`)
        .then((r) => r.json())
        .then((d) => {
          const arts = d.articulos || []
          setArtsCategoria(arts)
          cargarPrecios(arts)
        })
        .catch(() => setArtsCategoria([]))
        .finally(() => setCargandoArts(false))
    },
    [cliente, cargarPrecios]
  )

  // Loader para el árbol del home: todos los artículos de una categoría + precios.
  // (Hook: tiene que vivir acá arriba, antes de cualquier return temprano.)
  const cargarCategoriaArbol = useCallback(
    async (catId: string): Promise<Articulo[]> => {
      if (!cliente) return []
      const params = new URLSearchParams({ vista: "categoria", cliente: cliente.id, categoria: catId })
      const d = await fetch(`/api/vendedor/articulos?${params}`).then((r) => r.json())
      const arts: Articulo[] = d.articulos || []
      artsArbolRef.current.set(catId, arts)
      cargarPrecios(arts)
      return arts
    },
    [cliente, cargarPrecios]
  )

  const abrirFiltro = (tipo: Filtro) => {
    setNav({ s: "cats", ctx: { tipo } })
    cargarLista(tipo)
  }

  const abrirRubro = (r: CatalogoRubro) => {
    setNav({ s: "cats", ctx: { tipo: "rubro", rubroId: r.id, rubroNombre: r.nombre } })
  }

  const abrirProveedores = () => {
    setNav({ s: "provs" })
    if (proveedores.length) return
    setCargandoProvs(true)
    fetch("/api/vendedor/proveedores")
      .then((r) => r.json())
      .then((d) => setProveedores(d.proveedores || []))
      .catch(() => setProveedores([]))
      .finally(() => setCargandoProvs(false))
  }

  const abrirProveedor = (p: ProveedorCatalogo) => {
    // Directo al listado completo del proveedor; las categorías filtran
    // desde chips en la cabecera (catId null = todas)
    setSubSel(null)
    setNav({
      s: "arts",
      ctx: { tipo: "proveedor", proveedorId: p.id, proveedorNombre: p.nombre },
      catId: null,
      catNombre: p.nombre,
      rubroNombre: null,
    })
    const cacheado = provCache.current.get(p.id)
    if (cacheado) {
      setArtsProveedor(cacheado)
      return
    }
    setArtsProveedor([])
    setCargandoArtsProv(true)
    const params = new URLSearchParams({ vista: "proveedor", cliente: cliente!.id, proveedor: p.id })
    fetch(`/api/vendedor/articulos?${params}`)
      .then((r) => r.json())
      .then((d) => {
        const arts = d.articulos || []
        provCache.current.set(p.id, arts)
        setArtsProveedor(arts)
        cargarPrecios(arts)
      })
      .catch(() => setArtsProveedor([]))
      .finally(() => setCargandoArtsProv(false))
  }

  const abrirCategoria = (ctx: Ctx, catId: string | null, catNombre: string, rubroNombre: string | null) => {
    setSubSel(null)
    setNav({ s: "arts", ctx, catId, catNombre, rubroNombre })
    if (ctx.tipo === "rubro" && catId) cargarCategoria(catId)
  }

  const volver = () => {
    setSubSel(null)
    if (q) {
      setQ("")
      setResultados([])
      return
    }
    if (nav.s === "arts") setNav(nav.ctx.tipo === "proveedor" ? { s: "provs" } : { s: "cats", ctx: nav.ctx })
    else if (nav.s === "cats") setNav(nav.ctx.tipo === "proveedor" ? { s: "provs" } : { s: "home" })
    else if (nav.s === "provs") setNav({ s: "home" })
    else router.back()
  }

  // Botón "atrás" físico del teléfono/tablet: desarma UN paso interno por vez
  // (foto → sheet → búsqueda → nivel del catálogo) en vez de sacar al vendedor
  // de la pantalla y hacerle perder el pedido a medio armar.
  useBackTrap(() => {
    if (zoomFoto) { setZoomFoto(null); return true }
    if (buscarFoto) { setBuscarFoto(false); return true }
    if (sel) { setSel(null); return true }
    if (verCliente) { setVerCliente(false); return true }
    if (verCarrito) { setVerCarrito(false); return true }
    if (!cliente || pedidoOk) return false // selector de cliente / pantalla de éxito: salir normal
    if (qFiltro) { setQFiltro(""); return true }
    if (q) { setQ(""); setResultados([]); return true }
    if (subSel) { setSubSel(null); return true }
    if (nav.s !== "home") { volver(); return true }
    return false // home del catálogo, nada abierto: salir de verdad
  })

  // ¿Es un código escaneado? (colectora/lector: solo dígitos, 8-14 = EAN/DUN)
  const esScan = (v: string) => /^[0-9]{8,14}$/.test(v.trim())
  // ¿El artículo matchea EXACTO el código? (ean13 puede ser lista)
  const matchExacto = (a: Articulo, code: string) =>
    a.sku === code || (Array.isArray(a.ean13) ? (a.ean13 as any).includes(code) : a.ean13 === code)

  const ejecutarBusqueda = (value: string) => {
    if (!cliente) return
    const code = value.trim()
    const params = new URLSearchParams({ vista: "buscar", cliente: cliente.id, q: code })
    fetch(`/api/vendedor/articulos?${params}`)
      .then((r) => r.json())
      .then((d) => {
        const arts: Articulo[] = d.articulos || []
        // Colectora: un código escaneado con coincidencia 1 a 1 abre la ficha
        // del artículo directo, sin pasar por el listado de resultados.
        if (esScan(code)) {
          const exacto = arts.find((a) => matchExacto(a, code)) || (arts.length === 1 ? arts[0] : null)
          if (exacto) {
            setQ("")
            setResultados([])
            vinoDeScan.current = true
            cargarPrecios([exacto])
            abrirArticulo(exacto)
            return
          }
        }
        setResultados(arts)
        cargarPrecios(arts)
      })
      .catch(() => setResultados([]))
      .finally(() => setBuscando(false))
  }

  const onBuscar = (value: string) => {
    setQ(value)
    if (debounce.current) clearTimeout(debounce.current)
    if (!value.trim()) {
      setResultados([])
      setBuscando(false)
      return
    }
    setBuscando(true)
    // Un código completo de colectora no espera el debounce de tipeo
    debounce.current = setTimeout(() => ejecutarBusqueda(value), esScan(value) ? 80 : 400)
  }

  // Enter del lector (sufijo estándar de las colectoras): buscar YA
  const onBuscarEnter = () => {
    if (!q.trim()) return
    if (debounce.current) clearTimeout(debounce.current)
    setBuscando(true)
    ejecutarBusqueda(q)
  }

  // ── Escaneo global (colectora sin foco en el buscador) ──────────────
  // La colectora emite los dígitos como teclado a toda velocidad y termina
  // con Enter. Este listener junta ráfagas de dígitos (gap < 150 ms) aunque
  // el foco esté en cualquier lado de la pantalla, y al Enter dispara la
  // apertura directa del artículo. Si el foco está en un input real (buscar,
  // cantidad, observaciones) no interfiere: ahí manda el input.
  const escanearGlobal = useRef<(code: string) => void>(() => {})
  escanearGlobal.current = (code: string) => {
    if (!cliente) return
    setQ(code) // si no hay match exacto, el código queda en el buscador con resultados
    setBuscando(true)
    ejecutarBusqueda(code)
  }
  useEffect(() => {
    let buf = ""
    let last = 0
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const enInput =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      if (enInput) return
      const now = Date.now()
      if (now - last > 150) buf = "" // tipeo humano/lento: no es un escaneo
      last = now
      if (/^[0-9]$/.test(e.key)) {
        buf += e.key
        return
      }
      if ((e.key === "Enter" || e.key === "Tab") && /^[0-9]{8,14}$/.test(buf)) {
        e.preventDefault()
        const code = buf
        buf = ""
        escanearGlobal.current(code)
        return
      }
      buf = "" // cualquier otra tecla corta la ráfaga
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])

  // ── Input trampa para Android (Chrome / WebView de la colectora) ────
  // En Android el lector inyecta el código como texto de teclado virtual
  // (IME): sin un campo enfocado, no llega a ningún lado y el listener de
  // teclas de arriba nunca se entera. Este input invisible se queda con el
  // foco siempre que el vendedor no esté usando un campo real, recibe el
  // escaneo y dispara la apertura directa. inputMode="none" evita que se
  // abra el teclado en pantalla.
  const trapRef = useRef<HTMLInputElement | null>(null)
  const trapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!cliente) return
    const tick = setInterval(() => {
      const ae = document.activeElement as HTMLElement | null
      const enCampoReal =
        !!ae && ae !== trapRef.current &&
        (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)
      if (!enCampoReal) trapRef.current?.focus({ preventScroll: true })
    }, 400)
    return () => clearInterval(tick)
  }, [cliente])

  const flushTrap = () => {
    const el = trapRef.current
    if (!el) return
    const code = el.value.trim()
    el.value = ""
    if (/^[0-9]{8,14}$/.test(code)) escanearGlobal.current(code)
  }
  const onTrapChange = () => {
    // Fallback por pausa: si el sufijo Enter no llega (algunas colectoras
    // mandan solo el código), a los 250 ms sin teclas nuevas se procesa igual
    if (trapTimer.current) clearTimeout(trapTimer.current)
    trapTimer.current = setTimeout(flushTrap, 250)
  }

  // ── Detalle de artículo + precio en vivo ────────────────────────────
  const abrirArticulo = async (a: Articulo) => {
    setSel(a)
    // Sin default de 1: arranca vacío. En habituales precarga la última cantidad.
    setSelCantidad(a.cantidad_habitual || "")
    setSelModo("unidad")
    // Si el listado ya calculó el precio de este artículo (mismo cliente, mismas
    // condiciones, mismo motor), la ficha abre con precio al instante y se
    // confirma en background; si no, se espera al server.
    const cacheado = precios[a.id]
    if (cacheado) {
      setSelPrecio({ precio: cacheado.precio, precioNeto: cacheado.precioNeto, contado: cacheado.contado, especial: cacheado.especial ?? null, bonifViajantePct: cacheado.bonifViajantePct || 0 })
      setCargandoPrecio(false)
    } else {
      setSelPrecio(null)
      setCargandoPrecio(true)
    }
    selIdRef.current = a.id
    try {
      const p = await previewPrecioArticulo(cliente!.id, a.id, condToOverrides(cond))
      if (selIdRef.current !== a.id) return // el vendedor ya abrió otro artículo
      setSelPrecio({ precio: p.precio, precioNeto: p.precioNeto, contado: p.contado, especial: p.especial ?? null, bonifViajantePct: p.bonifViajantePct || 0 })
    } catch {
      if (selIdRef.current === a.id && !cacheado) setSelPrecio(null)
    } finally {
      if (selIdRef.current === a.id) setCargandoPrecio(false)
    }
  }

  // Factor de conversión a unidades según el modo de carga elegido
  const factorModo = (a: Articulo, modo: "unidad" | "fraccion" | "bulto") =>
    modo === "bulto" ? a.unidades_por_bulto || 1 : modo === "fraccion" ? a.cantidad_fraccion || 1 : 1

  // Etiqueta de la fracción: usa tipo_fraccion si es un nombre real (CAJA/PACK/DOCENA…)
  const labelFraccion = (a: Articulo) => {
    const t = (a.tipo_fraccion || "").trim().toUpperCase()
    if (t && !["UN", "UNIDAD", "UNIDADES"].includes(t)) {
      return t.charAt(0) + t.slice(1).toLowerCase()
    }
    return "Fracción"
  }

  const selUnidades = (typeof selCantidad === "number" ? selCantidad : 0) * (sel ? factorModo(sel, selModo) : 1)

  // Agregar ítem: crea el pedido "en_venta" al primer artículo, después
  // sincroniza cada alta contra pedidos_detalle. Los precios los fija el server.
  // UI optimista: el ítem aparece en el carrito al instante con el precio del
  // preview (mismo motor que el server) marcado "pendiente"; cuando el server
  // responde se reemplaza por la línea real (id, precio, total). Si falla, se
  // revierte. Así no hay que esperar action + refetch para ver el artículo.
  const agregarAlCarrito = () => {
    if (!sel || !selPrecio || selUnidades <= 0 || !cliente) return
    const art = sel
    setSel(null)
    // Si el artículo vino de un escaneo, dejar el buscador listo para el próximo
    if (vinoDeScan.current) {
      vinoDeScan.current = false
      setTimeout(() => inputBusqueda.current?.focus(), 50)
    }
    agregarArticuloAlPedido(art, selUnidades, selPrecio)
  }

  // Alta rápida desde una fila del catálogo (casilla de cantidad): usa el
  // precio ya calculado del listado; si todavía no está, lo pide al server.
  const agregarRapido = async (art: Articulo, unidades: number) => {
    if (!cliente || unidades <= 0) return
    let p = precios[art.id]
    if (!p) {
      try {
        const r = await previewPrecioArticulo(cliente.id, art.id, condToOverrides(cond))
        p = { precio: r.precio, precioNeto: r.precioNeto, contado: r.contado, ivaIncluido: false, especial: r.especial ?? null, bonifViajantePct: r.bonifViajantePct || 0 }
      } catch {
        alert("No se pudo calcular el precio del artículo.")
        return
      }
    }
    if (p.precio <= 0) { alert("Artículo sin precio: no se puede vender."); return }
    agregarArticuloAlPedido(art, unidades, { precio: p.precio, precioNeto: p.precioNeto })
  }

  // Núcleo del alta: optimista + cola serializada contra el server.
  const agregarArticuloAlPedido = (art: Articulo, cant: number, precioPrev: { precio: number; precioNeto: number }) => {
    if (!cliente || cant <= 0) return
    setSync("saving")

    const cartArt: CartArticulo = {
      id: art.id,
      descripcion: art.descripcion,
      sku: art.sku ?? null,
      unidades_por_bulto: art.unidades_por_bulto ?? null,
      imagen_url: art.imagen_url ?? null,
    }

    // Optimista (síncrono sobre cartRef): si el artículo ya está en el carrito
    // (real o pendiente) se suma la cantidad; si no, entra una línea temporal.
    let tempId: string | null = null
    const yaEstaba = cartRef.current.find((i) => i.articulo.id === art.id)
    if (yaEstaba) {
      updateCart((prev) => prev.map((i) => (i.articulo.id === art.id ? { ...i, cantidad: i.cantidad + cant, pendiente: true } : i)))
    } else {
      tempId = `tmp-${art.id}-${Date.now()}`
      updateCart((prev) => [...prev, { detalleId: tempId!, articulo: cartArt, cantidad: cant, precio: precioPrev.precio, precioNeto: precioPrev.precioNeto, pendiente: true }])
    }

    enqueue(async () => {
      try {
        if (!pedidoIdRef.current) {
          // Primer artículo: crea el pedido. La cantidad sale del carrito (puede
          // haber sumado taps mientras esperaba).
          const cantActual = cartRef.current.find((i) => i.articulo.id === art.id)?.cantidad ?? cant
          const pedido: any = await createPedido({
            cliente_id: cliente.id,
            items: [{ producto_id: art.id, cantidad: cantActual, precio_unitario: 0, descuento: 0 }],
            estado_inicial: "en_venta",
            ...condToOverrides(cond),
          })
          pedidoIdRef.current = pedido.id
          setPedidoId(pedido.id)
          setNumeroPedido(pedido.numero_pedido || null)
          setEstadoPedido("en_venta")
          // URL con ?pedido= para que un refresh/back retome este pedido
          window.history.replaceState(null, "", `/vendedor/pedido/nuevo?cliente=${cliente.id}&pedido=${pedido.id}`)
          // Única vez que se refetchea: necesitamos los ids reales de las líneas.
          // Las líneas temporales de OTROS artículos que ya se encolaron se
          // preservan (sus ops corren después y las reemplazan).
          const tmpOtros = cartRef.current.filter((i) => esTmp(i.detalleId) && i.articulo.id !== art.id)
          await refreshPedido(pedido.id)
          if (tmpOtros.length) updateCart((prev) => [...prev, ...tmpOtros])
          return
        }

        // Al momento de ejecutar (no de tapear): ¿la línea ya tiene id real?
        const linea = cartRef.current.find((i) => i.articulo.id === art.id)
        if (!linea) return // la quitaron mientras esperaba
        if (!esTmp(linea.detalleId)) {
          // Ya existe en DB: mandar la cantidad TOTAL actual (idempotente)
          await actualizarCantidadItem(linea.detalleId, pedidoIdRef.current, linea.cantidad)
          updateCart((prev) => prev.map((i) => (i.articulo.id === art.id ? { ...i, pendiente: false } : i)))
        } else {
          const r: any = await agregarItemPedido(pedidoIdRef.current, art.id, linea.cantidad)
          const it = r?.item
          updateCart((prev) =>
            prev.map((i) =>
              i.articulo.id === art.id
                ? {
                    ...i,
                    detalleId: it?.id || i.detalleId,
                    precio: typeof it?.precio_final === "number" ? it.precio_final : i.precio,
                    precioNeto: typeof it?.precio_base === "number" ? it.precio_base : i.precioNeto,
                    // si hubo más taps después, la cantidad local es mayor: la próxima op la sincroniza
                    pendiente: i.cantidad !== (it?.cantidad ?? i.cantidad),
                  }
                : i
            )
          )
        }
        setSync("idle")
      } catch (e: any) {
        console.error("Error guardando ítem del pedido:", e)
        // Revertir lo optimista de ESTE tap
        updateCart((prev) =>
          prev
            .map((i) => (i.articulo.id === art.id ? { ...i, cantidad: i.cantidad - cant, pendiente: false } : i))
            .filter((i) => i.cantidad > 0)
        )
        setSync("error")
        alert(`No se pudo guardar el artículo en el pedido: ${e?.message || e}`)
      }
    })
  }

  // "Solo este pedido": guarda los overrides en el pedido (si ya existe) y
  // re-precia TODO el carrito en el server; el catálogo recalcula por el effect.
  // Si el pedido todavía no existe, quedan en memoria y viajan en createPedido.
  const aplicarSoloPedido = (nueva: CondPedido) => {
    setCond(nueva)
    if (!pedidoIdRef.current) return
    setSync("saving")
    enqueue(async () => {
      try {
        await aplicarCondicionesPedidoVendedor(pedidoIdRef.current!, {
          metodo_facturacion_pedido: nueva.metodo || null,
          lista_precio_pedido_id: nueva.lista || null,
          bonif_pedido: bonifVacia(nueva.bonif) ? null : nueva.bonif,
        })
        await refreshPedido(pedidoIdRef.current!)
        setSync("idle")
      } catch (e: any) {
        console.error("Error repreciando el pedido:", e)
        setSync("error")
        alert(`No se pudieron recalcular los precios: ${e?.message || e}`)
      }
    })
  }
  const cambiarMetodo = (metodo: string) => aplicarSoloPedido({ ...cond, metodo })

  // "Guardar para el cliente": escribe en la FICHA (queda para futuros
  // pedidos), limpia los overrides del pedido y re-precia carrito + catálogo.
  const guardarParaCliente = (sel: { metodo?: string; lista?: string; bonif?: BonifPedidoUI | null }) => {
    if (!cliente) return
    setVerCliente(false)
    setSync("saving")
    enqueue(async () => {
      try {
        const patch: Record<string, any> = {}
        if (sel.metodo) patch.metodo_facturacion = sel.metodo
        if (sel.lista !== undefined && catFicha?.puede_cambiar_lista) patch.lista_precio_id = sel.lista || null
        if (Object.keys(patch).length) {
          const res = await fetch(`/api/vendedor/cliente/${cliente.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          })
          const d = await res.json()
          if (d.error) throw new Error(d.error)
        }
        if (sel.bonif) {
          // Cada tipo/segmento presente se escribe en la ficha (0 = sin bonif.)
          const body: { viajante: BonifSeg; mercaderia: BonifSeg } = { viajante: {}, mercaderia: {} }
          for (const tipo of ["viajante", "mercaderia"] as const)
            for (const s of SEGS) body[tipo][s] = sel.bonif[tipo]?.[s] ?? 0
          const res = await fetch(`/api/vendedor/cliente/${cliente.id}/bonificaciones`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
          const d = await res.json()
          if (d.error) throw new Error(d.error)
        }
        // Refrescar la ficha en memoria (lista con nombre, método) y la bonif
        const r = await fetch(`/api/vendedor/cliente/${cliente.id}`)
        const dc = await r.json()
        if (!dc.error && dc.cliente) setCliente(dc.cliente)
        cargarBonifCliente(cliente.id)

        // El pedido pasa a heredar TODO del cliente (sin overrides)
        const limpia: CondPedido = {
          metodo: sel.metodo ? "" : cond.metodo,
          lista: sel.lista !== undefined ? "" : cond.lista,
          bonif: sel.bonif ? null : cond.bonif,
        }
        if (pedidoIdRef.current) {
          await aplicarCondicionesPedidoVendedor(
            pedidoIdRef.current,
            {
              metodo_facturacion_pedido: limpia.metodo || null,
              lista_precio_pedido_id: limpia.lista || null,
              bonif_pedido: bonifVacia(limpia.bonif) ? null : limpia.bonif,
            },
            { forzarReprecio: true }
          )
          await refreshPedido(pedidoIdRef.current)
        }
        const cambioCond =
          limpia.metodo !== cond.metodo || limpia.lista !== cond.lista || JSON.stringify(limpia.bonif) !== JSON.stringify(cond.bonif)
        if (cambioCond) setCond(limpia) // el effect recalcula el catálogo
        else recalcularPreciosCatalogo()
        setSync("idle")
      } catch (e: any) {
        console.error("Error guardando condiciones del cliente:", e)
        setSync("error")
        alert(`No se pudo guardar en la ficha del cliente: ${e?.message || e}`)
      }
    })
  }

  // Cambiar cantidad desde el carrito: optimista + sync con debounce
  const setCantidadItem = (detalleId: string, cantidad: number) => {
    if (cantidad < 1) return
    updateCart((prev) => prev.map((i) => (i.detalleId === detalleId ? { ...i, cantidad } : i)))
    // Línea todavía temporal (el alta está en cola): el alta ya manda la
    // cantidad vigente del carrito al ejecutarse; no hay nada que sincronizar.
    if (esTmp(detalleId) || !pedidoIdRef.current) return
    const t = cantTimers.current.get(detalleId)
    if (t) clearTimeout(t)
    cantTimers.current.set(
      detalleId,
      setTimeout(() => {
        cantTimers.current.delete(detalleId)
        setSync("saving")
        enqueue(async () => {
          try {
            // Cantidad vigente al ejecutar (puede haber cambiado en la cola)
            const actual = cartRef.current.find((i) => i.detalleId === detalleId)
            if (!actual) return
            await actualizarCantidadItem(detalleId, pedidoIdRef.current!, actual.cantidad)
            setSync("idle")
          } catch (e) {
            console.error("Error actualizando cantidad:", e)
            setSync("error")
            if (pedidoIdRef.current) await refreshPedido(pedidoIdRef.current).catch(() => {})
          }
        })
      }, 600)
    )
  }

  const quitarItem = (detalleId: string) => {
    const t = cantTimers.current.get(detalleId)
    if (t) {
      clearTimeout(t)
      cantTimers.current.delete(detalleId)
    }
    updateCart((prev) => prev.filter((i) => i.detalleId !== detalleId))
    // Temporal: el alta encolada no encuentra la línea y no hace nada
    if (esTmp(detalleId) || !pedidoIdRef.current) return
    setSync("saving")
    enqueue(async () => {
      try {
        await eliminarItemPedido(detalleId, pedidoIdRef.current!)
        setSync("idle")
      } catch (e) {
        console.error("Error quitando ítem:", e)
        setSync("error")
        if (pedidoIdRef.current) await refreshPedido(pedidoIdRef.current).catch(() => {})
      }
    })
  }

  const total = cart.reduce((s, i) => s + i.precio * i.cantidad, 0)
  const totalItems = cart.reduce((s, i) => s + i.cantidad, 0)

  const editandoExistente = !!estadoPedido && estadoPedido !== "en_venta"

  const confirmarPedido = async () => {
    if (!cliente || !pedidoIdRef.current || !cart.length || confirmando) return
    setConfirmando(true)
    try {
      // Descargar cambios de cantidad pendientes (debounce) antes de confirmar
      const pendientes = [...cantTimers.current.keys()]
      for (const timer of cantTimers.current.values()) clearTimeout(timer)
      cantTimers.current.clear()
      await opQueue.current
      for (const dId of pendientes) {
        const item = cartRef.current.find((i) => i.detalleId === dId)
        if (item) await actualizarCantidadItem(dId, pedidoIdRef.current, item.cantidad)
      }
      const res: any = await confirmarPedidoVendedor(pedidoIdRef.current, {
        observaciones: obs,
        metodo_facturacion_pedido: metodoOverride,
      })
      setPedidoOk({ numero: res?.numero_pedido || numeroPedido || "", editado: editandoExistente })
      updateCart(() => [])
      setVerCarrito(false)
      pedidoIdRef.current = null
      setPedidoId(null)
      setNumeroPedido(null)
      setEstadoPedido(null)
      setObs("")
      setCond(COND_VACIA)
      window.history.replaceState(null, "", `/vendedor/pedido/nuevo?cliente=${cliente.id}`)
    } catch (e: any) {
      alert(`Error al confirmar el pedido: ${e?.message || e}`)
    } finally {
      setConfirmando(false)
    }
  }

  // ── Derivados de navegación ─────────────────────────────────────────
  const ctxLabel = (ctx: Ctx) =>
    ctx.tipo === "rubro" ? ctx.rubroNombre : ctx.tipo === "proveedor" ? ctx.proveedorNombre : FILTROS[ctx.tipo].label

  const ctxTinte = (ctx: Ctx): Tinte =>
    ctx.tipo === "rubro" ? tinteRubro(ctx.rubroNombre) : ctx.tipo === "proveedor" ? TINTE_PROVEEDORES : FILTROS[ctx.tipo].tinte

  // Lista base del contexto cuando se agrupa client-side (filtros y proveedor)
  const listaDeCtx = (ctx: Ctx): Articulo[] =>
    ctx.tipo === "rubro" ? [] : ctx.tipo === "proveedor" ? artsProveedor : listas[ctx.tipo] || []

  // Posición de cada categoría/subcategoría en la taxonomía (el orden que se
  // arma por drag & drop en el ERP): las agrupaciones de filtros/proveedor se
  // muestran en ESE orden, no por cantidad. Fallback por nombre (artículos sin FK).
  const posTaxonomia = useMemo(() => {
    const cat = new Map<string, number>()
    const sub = new Map<string, number>()
    let i = 0, j = 0
    for (const r of catalogo)
      for (const c of r.categorias) {
        cat.set(c.id, i)
        cat.set(`n:${c.nombre}`, i)
        i++
        for (const s of c.subcategorias) {
          sub.set(s.id, j)
          sub.set(`n:${s.nombre}`, j)
          j++
        }
      }
    return { cat, sub }
  }, [catalogo])
  const posCat = (key: string | null) => (key && posTaxonomia.cat.has(key) ? posTaxonomia.cat.get(key)! : Number.MAX_SAFE_INTEGER)
  const posSub = (key: string | null) => (key && posTaxonomia.sub.has(key) ? posTaxonomia.sub.get(key)! : Number.MAX_SAFE_INTEGER)
  // Precio para ordenar: el que ve el cliente (CC); sin precio cargado → al final
  const precioOrden = (a: Articulo) => precios[a.id]?.precio

  // Tarjetas de categoría según contexto: por rubro sale de la taxonomía;
  // por filtro se agrupa la lista ya cargada (solo categorías con artículos en el filtro).
  const categoriasCtx = useMemo(() => {
    // En proveedor las categorías también se usan como chips dentro del listado
    if (nav.s !== "cats" && !(nav.s === "arts" && nav.ctx.tipo === "proveedor")) return []
    if (nav.ctx.tipo === "rubro") {
      const rubroId = nav.ctx.rubroId
      const rubro = catalogo.find((r) => r.id === rubroId)
      return (rubro?.categorias || []).map((c) => ({
        id: c.id as string | null,
        nombre: c.nombre,
        cantidad: c.cantidad,
        rubroNombre: rubro?.nombre || null,
      }))
    }
    const lista = listaDeCtx(nav.ctx)
    const grupos = new Map<string, { id: string | null; nombre: string; cantidad: number; rubroNombre: string | null }>()
    for (const a of lista) {
      const key = claveCategoria(a)
      const g = grupos.get(key)
      if (g) g.cantidad += 1
      else
        grupos.set(key, {
          id: key,
          nombre: a.categoria_nombre || "Otros",
          cantidad: 1,
          rubroNombre: a.rubro_nombre,
        })
    }
    // Orden de la taxonomía (no por cantidad): igual que en el ERP y en el rubro
    return [...grupos.values()].sort((a, b) => posCat(a.id) - posCat(b.id) || b.cantidad - a.cantidad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, catalogo, listas, artsProveedor, posTaxonomia])

  // Artículos visibles en la pantalla de lista
  const articulosVisibles = useMemo(() => {
    if (nav.s !== "arts") return []
    let base: Articulo[]
    if (nav.ctx.tipo === "rubro") base = artsCategoria
    else if (nav.ctx.tipo === "proveedor" && nav.catId === null) base = listaDeCtx(nav.ctx) // todas
    else base = listaDeCtx(nav.ctx).filter((a) => claveCategoria(a) === (nav.catId || "otros"))
    if (subSel) base = base.filter((a) => claveSubcategoria(a) === subSel)
    // Búsqueda de texto dentro del filtro aplicado (acentos-insensible, multi-palabra)
    if (qFiltro.trim())
      base = base.filter((a) =>
        localMatch(qFiltro, a.descripcion, a.sku, Array.isArray(a.ean13) ? a.ean13 : [a.ean13], a.marca, a.subcategoria_nombre)
      )
    // Dentro de una categoría del rubro, el orden natural sigue la taxonomía de
    // subcategorías (drag & drop del ERP); después el orden elegido por el vendedor
    if (nav.ctx.tipo === "rubro" && !subSel)
      base = [...base].sort((a, b) => posSub(claveSubcategoria(a)) - posSub(claveSubcategoria(b)))
    return ordenarArticulos(base, orden, precioOrden, ventas)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, artsCategoria, listas, artsProveedor, subSel, qFiltro, orden, ventas, precios, posTaxonomia])

  // Resultados de búsqueda con el orden elegido (default = relevancia del motor)
  const resultadosOrdenados = useMemo(
    () => ordenarArticulos(resultados, orden, precioOrden, ventas),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resultados, orden, ventas, precios]
  )

  // Chips de subcategoría derivados de los artículos presentes
  const subchips = useMemo(() => {
    if (nav.s !== "arts") return []
    // Con "todas" las categorías de un proveedor no hay chips de subcategoría
    if (nav.ctx.tipo === "proveedor" && nav.catId === null) return []
    const base =
      nav.ctx.tipo === "rubro"
        ? artsCategoria
        : listaDeCtx(nav.ctx).filter((a) => claveCategoria(a) === (nav.catId || "otros"))
    const m = new Map<string, { id: string; nombre: string; cantidad: number }>()
    for (const a of base) {
      const key = claveSubcategoria(a)
      if (!key) continue
      const g = m.get(key)
      if (g) g.cantidad += 1
      else m.set(key, { id: key, nombre: a.subcategoria_nombre || "—", cantidad: 1 })
    }
    // Chips en el orden de la taxonomía (drag & drop del ERP), no por cantidad
    return [...m.values()].sort((a, b) => posSub(a.id) - posSub(b.id) || b.cantidad - a.cantidad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, artsCategoria, listas, artsProveedor, posTaxonomia])

  // ── Pantalla éxito ──────────────────────────────────────────────────
  if (pedidoOk) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center max-w-md w-full space-y-4">
          <p className="text-6xl">✅</p>
          <h1 className="text-2xl font-bold text-gray-900">{pedidoOk.editado ? "Cambios guardados" : "Pedido confirmado"}</h1>
          {pedidoOk.numero && <p className="text-gray-500 text-lg">N° {pedidoOk.numero}</p>}
          <div className="grid grid-cols-1 gap-3 pt-2">
            <button
              onClick={() => setPedidoOk(null)}
              className="bg-emerald-600 text-white rounded-xl px-6 py-4 text-lg font-bold"
            >
              Nuevo pedido para {cliente?.nombre}
            </button>
            <button
              onClick={() => router.push("/vendedor/pedidos")}
              className="bg-white border border-gray-300 text-gray-700 rounded-xl px-6 py-3 font-medium"
            >
              Ver mis pedidos
            </button>
            <button onClick={() => router.push("/vendedor")} className="text-gray-500 py-2">
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Selector de cliente ─────────────────────────────────────────────
  if (!cliente) {
    // Mismos campos que el buscador del ERP: nombre, razón social, dirección
    // ("belgrano" → el cliente de calle Belgrano), localidad, CUIT y código.
    // localMatch normaliza acentos y soporta varias palabras en cualquier orden.
    const filtrados = qCliente
      ? clientes.filter((c) =>
          localMatch(qCliente, c.nombre, c.razon_social, c.direccion, c.localidad, c.cuit, c.codigo_cliente)
        )
      : clientes
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-emerald-700 text-white sticky top-0 z-10 shadow-md">
          <div className="px-5 py-3 flex items-center gap-3">
            <button onClick={() => router.push("/vendedor")} className="text-2xl leading-none px-1">←</button>
            <h1 className="text-xl font-bold">Nuevo pedido — Elegir cliente</h1>
          </div>
          <div className="px-4 pb-3">
            <input
              type="search"
              value={qCliente}
              onChange={(e) => setQCliente(e.target.value)}
              placeholder="Buscar cliente..."
              className="w-full rounded-xl px-4 py-3 text-gray-900 text-lg bg-white outline-none"
            />
          </div>
        </header>
        <div className="p-4 space-y-2 max-w-2xl mx-auto">
          {filtrados.map((c) => (
            <button
              key={c.id}
              onClick={() => router.replace(`/vendedor/pedido/nuevo?cliente=${c.id}`)}
              className="w-full bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-left active:scale-[0.98]"
            >
              <p className="font-bold text-gray-900">{c.nombre}</p>
              <p className="text-gray-500 text-sm">
                {[c.direccion, c.localidad].filter(Boolean).join(" · ") || "—"}
              </p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Tarjeta de artículo (compartida por todas las listas) ───────────
  const ArticuloCard = ({ a }: { a: Articulo }) => {
    const enCarrito = cart.find((i) => i.articulo.id === a.id)
    const p = precios[a.id]
    // Artículo sin precio (en prueba/carga): no se muestra ni se vende
    if (p && p.precio <= 0) return null
    return (
      <button
        onClick={() => abrirArticulo(a)}
        className={`w-full bg-white rounded-xl shadow-sm border p-3 text-left active:scale-[0.98] ${
          enCarrito ? "border-emerald-500 border-2" : "border-gray-200"
        }`}
      >
        <div className="flex items-start gap-3">
          {a.imagen_url ? (
            <img
              src={a.imagen_url}
              alt=""
              loading="lazy"
              className="w-12 h-12 rounded-lg object-cover bg-gray-100 shrink-0"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="font-bold text-gray-900 text-sm leading-snug">{a.descripcion}</p>
            <p className="text-gray-500 text-xs mt-0.5">
              {[a.marca, a.proveedor].filter(Boolean).join(" · ")}
            </p>
            <p className="text-gray-400 text-xs">
              {a.unidades_por_bulto ? `${a.unidades_por_bulto} u/bulto · ` : ""}
              Stock: {a.stock_disponible}
              {a.veces_pedido ? ` · pedido ${a.veces_pedido}×` : ""}
            </p>
            {enCarrito && (
              <span className="inline-block bg-emerald-600 text-white px-2 py-0.5 rounded-full text-xs font-bold mt-1">
                🛒 En pedido: {enCarrito.cantidad} u
              </span>
            )}
          </div>
          <div className="text-right shrink-0">
            {p ? (
              p.especial ? (
                <>
                  {p.especial.oferta_pct > 0 && (
                    <p className="text-xs text-gray-400 leading-tight">
                      <span className="line-through">{formatCurrency(p.especial.bruto)}</span>{" "}
                      <span className="text-red-600 font-bold no-underline">-{p.especial.oferta_pct}%</span>
                    </p>
                  )}
                  <p className="font-bold text-gray-900 leading-tight">{formatCurrency(p.precioNeto)}</p>
                  <p className="text-[10px] font-bold text-orange-500">+ 21% IVA</p>
                  <span className="inline-block bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full text-[10px] font-bold mt-1">
                    ESPECIAL
                  </span>
                </>
              ) : (
                <>
                  <p className="font-bold text-gray-900 leading-tight">
                    <span className="text-[10px] text-gray-400 font-medium">CC </span>
                    {formatCurrency(p.precio)}
                  </p>
                  <p className="font-bold text-emerald-700 text-sm leading-tight">
                    <span className="text-[10px] text-emerald-500 font-medium">Ctdo </span>
                    {formatCurrency(p.contado)}
                  </p>
                  <p className={`text-[10px] font-bold ${p.ivaIncluido ? "text-gray-400" : "text-orange-500"}`}>
                    {p.ivaIncluido ? "IVA incluido" : "sin IVA"}
                  </p>
                </>
              )
            ) : (
              <p className="text-gray-300 text-xs">$ …</p>
            )}
            {!p?.especial && a.descuento_propio > 0 && (
              <span className="inline-block bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold mt-1">
                -{a.descuento_propio}%
              </span>
            )}
            {(p?.bonifViajantePct || 0) > 0 && (
              <span
                className="inline-block bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full text-[10px] font-bold mt-1 ml-1"
                title="Bonificación viajante del cliente, ya aplicada en el precio"
              >
                viaj. −{p!.bonifViajantePct}%
              </span>
            )}
          </div>
        </div>
      </button>
    )
  }

  const tituloHeader =
    q
      ? "Buscar artículos"
      : nav.s === "home"
        ? cliente.nombre
        : nav.s === "provs"
          ? "Por proveedor"
          : nav.s === "cats"
            ? ctxLabel(nav.ctx)
            : nav.ctx.tipo === "proveedor"
              ? ctxLabel(nav.ctx)
              : nav.catNombre

  const subtituloHeader =
    q
      ? cliente.nombre
      : nav.s === "home"
        ? numeroPedido
          ? `Pedido Nº ${numeroPedido}${editandoExistente ? " · editando" : " · guardado automático"}`
          : cliente.metodo_facturacion
            ? `Facturación: ${cliente.metodo_facturacion}`
            : "Nuevo pedido"
        : nav.s === "provs" || nav.s === "cats"
          ? cliente.nombre
          : `${ctxLabel(nav.ctx)} · ${cliente.nombre}`

  // ── Pantalla principal de armado ────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Input trampa: recibe el escaneo de la colectora en Android aunque no
          haya ningún campo tocado (ver comentario en la lógica). Invisible y
          fuera del flujo táctil; inputMode="none" = sin teclado en pantalla. */}
      <input
        ref={trapRef}
        onChange={onTrapChange}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault()
            if (trapTimer.current) clearTimeout(trapTimer.current)
            flushTrap()
          }
        }}
        inputMode="none"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        tabIndex={-1}
        aria-hidden
        className="fixed top-0 left-0 w-px h-px opacity-0 pointer-events-none"
      />
      <header className="bg-emerald-700 text-white sticky top-0 z-10 shadow-md">
        <div className="px-5 py-3 flex items-center gap-3">
          <button onClick={volver} className="text-2xl leading-none px-1">←</button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold truncate">{tituloHeader}</h1>
            <p className="text-emerald-200 text-xs truncate">{subtituloHeader}</p>
          </div>
          {(pedidoId || sync !== "idle") && (
            <span
              className={`text-[10px] px-2.5 py-1 rounded-full font-bold shrink-0 ${
                sync === "saving"
                  ? "bg-emerald-600 text-emerald-100"
                  : sync === "error"
                    ? "bg-red-500 text-white"
                    : "bg-emerald-800 text-emerald-200"
              }`}
            >
              {sync === "saving" ? "Guardando…" : sync === "error" ? "⚠ Sin guardar" : "✓ Guardado"}
            </span>
          )}
          <button
            onClick={() => {
              setMetodoSel(cond.metodo || cliente.metodo_facturacion || "")
              setListaSel(cond.lista || cliente.lista_precio_id || "")
              // Arranca con lo vigente: override del pedido si hay, si no la ficha
              const init: Record<string, string> = {}
              for (const tipo of ["viajante", "mercaderia"] as const)
                for (const s of SEGS) {
                  const v = cond.bonif?.[tipo]?.[s] ?? bonifCliente?.[tipo]?.[s] ?? 0
                  init[`${tipo}.${s}`] = v ? String(v) : ""
                }
              setBonifSel(init)
              setVerCliente(true)
            }}
            className="w-10 h-10 rounded-xl bg-emerald-600 border border-emerald-500 flex items-center justify-center text-lg shrink-0 active:scale-95"
            title="Cliente: ficha, cuenta corriente y método"
          >
            👤
          </button>
        </div>
        {nav.s === "home" && (
          <div className="px-4 pb-3 flex gap-2">
            <div className="relative flex-1">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                aria-hidden
              >
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                ref={inputBusqueda}
                type="search"
                value={q}
                onChange={(e) => onBuscar(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onBuscarEnter() } }}
                placeholder="Buscar artículo, SKU o EAN..."
                className="w-full rounded-xl pl-11 pr-4 py-3 text-gray-900 text-lg bg-white outline-none"
              />
            </div>
            <button
              onClick={() => setBuscarFoto(true)}
              className="w-[52px] rounded-xl bg-emerald-600 border border-emerald-500 flex items-center justify-center shrink-0 active:scale-95 transition-transform"
              title="Buscar con la cámara: código de barras o foto del producto"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" aria-hidden>
                <path
                  d="M4 8.5c0-1.1.9-2 2-2h1.4l1.2-1.8c.2-.3.5-.5.8-.5h5.2c.3 0 .6.2.8.5l1.2 1.8H18c1.1 0 2 .9 2 2V17c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V8.5Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <circle cx="12" cy="12.5" r="3.2" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </button>
          </div>
        )}
      </header>

      <div className="p-4 max-w-2xl mx-auto">
        {/* ── Resultados de búsqueda ── */}
        {nav.s === "home" && q ? (
          buscando ? (
            <div className="text-center py-10">
              <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : resultados.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
              Sin resultados para “{q}”. Probá con otra palabra, SKU o EAN.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-gray-400 text-xs">{resultados.length} resultados</p>
                <OrdenSelector value={orden} onChange={setOrden} />
              </div>
              {resultadosOrdenados.map((a) => (
                <ArticuloCard key={a.id} a={a} />
              ))}
            </div>
          )
        ) : nav.s === "home" ? (
          /* ── Home del catálogo: banners + rubros ── */
          <div className="space-y-5">
            <div className="grid grid-cols-4 gap-2.5">
              {(Object.keys(FILTROS) as Filtro[]).map((tipo) => {
                const f = FILTROS[tipo]
                return (
                  <button
                    key={tipo}
                    onClick={() => abrirFiltro(tipo)}
                    className="rounded-2xl border p-3 text-left active:scale-[0.97] transition-transform"
                    style={{ background: f.tinte.bg, borderColor: f.tinte.border, color: f.tinte.ink }}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center mb-2 bg-white/70"
                      style={{ color: f.tinte.accent }}
                    >
                      {f.icono}
                    </div>
                    <p className="font-bold text-sm leading-tight">{f.label}</p>
                    <p className="text-[11px] mt-0.5 opacity-70">{f.sub}</p>
                  </button>
                )
              })}
              <button
                onClick={abrirProveedores}
                className="rounded-2xl border p-3 text-left active:scale-[0.97] transition-transform"
                style={{ background: TINTE_PROVEEDORES.bg, borderColor: TINTE_PROVEEDORES.border, color: TINTE_PROVEEDORES.ink }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center mb-2 bg-white/70"
                  style={{ color: TINTE_PROVEEDORES.accent }}
                >
                  <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" aria-hidden>
                    <path
                      d="M3.5 8.5 12 4l8.5 4.5M3.5 8.5V17L12 21.5m-8.5-13L12 13m0 8.5V13m8.5-4.5V17L12 21.5m8.5-13L12 13"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <p className="font-bold text-sm leading-tight">Proveedores</p>
                <p className="text-[11px] mt-0.5 opacity-70">Catálogo completo</p>
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Catálogo por rubro</p>
                <OrdenSelector value={orden} onChange={setOrden} />
              </div>
              {/* Listas desplegables: Rubro › Categoría › Subcategoría › artículos,
                  en el orden de la taxonomía (drag & drop del ERP). El › del rubro
                  abre la vista completa con tarjetas y fotos. */}
              {catalogo.length === 0 ? (
                <div className="text-center py-6">
                  <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                </div>
              ) : (
                <CatalogoArbol<Articulo>
                  rubros={catalogo}
                  cargarCategoria={cargarCategoriaArbol}
                  renderArticulo={(a) => (
                    <FilaArticulo
                      a={a}
                      precio={precios[a.id]}
                      enCarrito={cart.find((i) => i.articulo.id === a.id)?.cantidad}
                      onAbrir={() => abrirArticulo(a)}
                      onZoom={() => a.imagen_url && setZoomFoto(a.imagen_url)}
                      onAgregar={(u) => agregarRapido(a, u)}
                    />
                  )}
                  ordenar={(arts) => ordenarArticulos(arts, orden, precioOrden, ventas)}
                  onVerRubro={(r) => abrirRubro(r as CatalogoRubro)}
                  tinte={(nombre) => {
                    const t = tinteRubro(nombre)
                    return { bg: t.bg, border: t.border, ink: t.ink, accent: t.accent }
                  }}
                />
              )}
            </div>
          </div>
        ) : nav.s === "provs" ? (
          /* ── Selector de proveedor ── */
          <div className="space-y-3">
            <input
              type="search"
              value={qProv}
              onChange={(e) => setQProv(e.target.value)}
              placeholder="Buscar proveedor..."
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-lg bg-white outline-none"
            />
            {cargandoProvs ? (
              <div className="text-center py-10">
                <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {proveedores
                  .filter(
                    (p) =>
                      !qProv.trim() ||
                      p.nombre.toLowerCase().includes(qProv.toLowerCase()) ||
                      (p.sigla || "").toLowerCase().includes(qProv.toLowerCase())
                  )
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => abrirProveedor(p)}
                      className="rounded-2xl border p-3.5 text-left active:scale-[0.97] transition-transform"
                      style={{ background: TINTE_PROVEEDORES.bgSoft, borderColor: TINTE_PROVEEDORES.border }}
                    >
                      <p className="font-bold text-gray-900 text-[13px] leading-snug">{p.nombre}</p>
                      <p className="text-xs mt-1" style={{ color: TINTE_PROVEEDORES.accent }}>
                        {p.cantidad} {p.cantidad === 1 ? "artículo" : "artículos"}
                      </p>
                    </button>
                  ))}
                {proveedores.length === 0 && (
                  <div className="col-span-2 bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
                    No hay proveedores con artículos activos.
                  </div>
                )}
              </div>
            )}
          </div>
        ) : nav.s === "cats" ? (
          /* ── Tarjetas de categorías del contexto ── */
          (nav.ctx.tipo === "proveedor" ? cargandoArtsProv : cargandoLista && nav.ctx.tipo !== "rubro" && !listas[nav.ctx.tipo]) ? (
            <div className="text-center py-10">
              <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : categoriasCtx.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
              {nav.ctx.tipo === "habituales"
                ? "Este cliente todavía no tiene artículos habituales. Buscá desde el inicio para armar su primer pedido."
                : nav.ctx.tipo === "ofertas"
                  ? "No hay artículos en oferta en este momento."
                  : nav.ctx.tipo === "novedades"
                    ? "No hay ingresos recientes en el catálogo."
                    : nav.ctx.tipo === "proveedor"
                      ? "Este proveedor no tiene artículos activos."
                      : "Este rubro no tiene categorías con artículos."}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {categoriasCtx.map((c) => {
                const t = nav.ctx.tipo === "rubro" ? ctxTinte(nav.ctx) : tinteRubro(c.rubroNombre)
                return (
                  <button
                    key={c.id || "otros"}
                    onClick={() => abrirCategoria(nav.ctx, c.id, c.nombre, c.rubroNombre)}
                    className="rounded-2xl border p-3.5 text-left active:scale-[0.97] transition-transform"
                    style={{ background: t.bgSoft, borderColor: t.border }}
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center mb-2.5"
                      style={{ background: t.bg, color: t.ink }}
                    >
                      <IconoCategoria nombre={c.nombre} className="w-5.5 h-5.5" />
                    </div>
                    <p className="font-bold text-gray-900 text-[13px] leading-snug">{c.nombre}</p>
                    <p className="text-xs mt-1" style={{ color: t.accent }}>
                      {c.cantidad} {c.cantidad === 1 ? "artículo" : "artículos"}
                    </p>
                  </button>
                )
              })}
            </div>
          )
        ) : (
          /* ── Lista de artículos de la categoría ── */
          <div className="space-y-3">
            {/* Búsqueda DENTRO del filtro aplicado (proveedor, habituales,
                ofertas, categoría...): filtra la lista ya cargada, en vivo.
                Al lado, el orden (precio / ventas / marca). */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden>
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  type="search"
                  value={qFiltro}
                  onChange={(e) => setQFiltro(e.target.value)}
                  placeholder={`Buscar en ${ctxLabel(nav.ctx) || "este listado"}...`}
                  className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-9 py-2.5 text-gray-900 outline-none"
                />
                {qFiltro && (
                  <button
                    onClick={() => setQFiltro("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gray-200 text-gray-500 text-xs leading-none"
                  >
                    ✕
                  </button>
                )}
              </div>
              <OrdenSelector value={orden} onChange={setOrden} className="shrink-0" />
            </div>
            {/* Chips de categoría (navegación por proveedor: se entra al
                listado completo y las categorías filtran desde acá) */}
            {nav.ctx.tipo === "proveedor" && categoriasCtx.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                <button
                  onClick={() => {
                    setSubSel(null)
                    setNav({ ...nav, catId: null, catNombre: ctxLabel(nav.ctx) })
                  }}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border ${
                    nav.catId === null
                      ? "text-white"
                      : "bg-white text-gray-600 border-gray-300"
                  }`}
                  style={nav.catId === null ? { background: TINTE_PROVEEDORES.ink, borderColor: TINTE_PROVEEDORES.ink } : undefined}
                >
                  Todas
                </button>
                {categoriasCtx.map((c) => (
                  <button
                    key={c.id || "otros"}
                    onClick={() => {
                      setSubSel(null)
                      setNav({ ...nav, catId: c.id, catNombre: c.nombre })
                    }}
                    className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border ${
                      nav.catId === c.id ? "text-white" : "bg-white text-gray-600 border-gray-300"
                    }`}
                    style={nav.catId === c.id ? { background: TINTE_PROVEEDORES.ink, borderColor: TINTE_PROVEEDORES.ink } : undefined}
                  >
                    {c.nombre} · {c.cantidad}
                  </button>
                ))}
              </div>
            )}
            {subchips.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                <button
                  onClick={() => setSubSel(null)}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border ${
                    !subSel ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300"
                  }`}
                >
                  Todas
                </button>
                {subchips.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSubSel(subSel === s.id ? null : s.id)}
                    className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border ${
                      subSel === s.id ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300"
                    }`}
                  >
                    {s.nombre} · {s.cantidad}
                  </button>
                ))}
              </div>
            )}
            {(cargandoArts && nav.ctx.tipo === "rubro") || (cargandoArtsProv && nav.ctx.tipo === "proveedor") ? (
              <div className="text-center py-10">
                <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : articulosVisibles.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
                {qFiltro.trim()
                  ? <>Nada con “{qFiltro}” acá. <button onClick={() => { setNav({ s: "home" }); onBuscar(qFiltro) }} className="text-emerald-700 font-bold underline">Buscar en todo el catálogo</button></>
                  : nav.ctx.tipo === "proveedor" && nav.catId === null
                    ? "Este proveedor no tiene artículos activos con precio."
                    : "No hay artículos en esta categoría."}
              </div>
            ) : (
              <div className="space-y-2">
                {articulosVisibles.map((a) => (
                  <ArticuloCard key={a.id} a={a} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Panel del cliente: ficha, cuenta corriente y método de facturación */}
      {verCliente && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={() => setVerCliente(false)}>
          <div
            className="bg-white w-full rounded-t-3xl p-5 max-w-2xl mx-auto space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="font-bold text-gray-900 text-lg leading-snug">{cliente.nombre}</p>
              <p className="text-gray-500 text-sm">
                {cliente.localidad || ""}
                {typeof cliente.saldo_actual === "number" && cliente.saldo_actual > 0 ? (
                  <span className="text-red-600 font-bold"> · debe {formatCurrency(cliente.saldo_actual)}</span>
                ) : null}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => router.push(`/vendedor/clientes/${cliente.id}`)}
                className="bg-white border-2 border-emerald-600 text-emerald-700 rounded-xl py-3 text-center font-bold active:scale-[0.97]"
              >
                👤 Ficha del cliente
              </button>
              <button
                onClick={() => router.push(`/vendedor/clientes/${cliente.id}/cobrar`)}
                className="bg-emerald-600 text-white rounded-xl py-3 text-center font-bold active:scale-[0.97]"
              >
                💵 Cuenta corriente
              </button>
            </div>

            {(() => {
              // Lista impuesta por el viajante del cliente (LISTA NECO → Neco, etc.):
              // no se guarda en ficha; sí se puede pisar "solo este pedido" si tiene permiso.
              const viajCliente = catFicha?.vendedores.find((v) => v.id === cliente.vendedor_id)
              const listaImpuesta = viajCliente?.lista_nombre || null
              const puedeLista = !!catFicha?.puede_cambiar_lista
              const listaNombre = (id: string | null | undefined) =>
                catFicha?.listas_precio.find((l) => l.id === id)?.nombre || null
              const listaClienteNombre = cliente.lista?.nombre || listaNombre(cliente.lista_precio_id) || "Estándar"
              // Bonificaciones: parseo de la grilla (tipo × segmento) a BonifPedidoUI
              const parsePct = (s: string | undefined) => {
                const t = (s ?? "").trim()
                if (t === "") return 0
                const n = Number(t.replace(",", "."))
                return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : NaN
              }
              const bonifParsed: BonifPedidoUI = { viajante: {}, mercaderia: {} }
              let bonifValida = true
              for (const tipo of ["viajante", "mercaderia"] as const)
                for (const s of SEGS) {
                  const n = parsePct(bonifSel[`${tipo}.${s}`])
                  if (Number.isNaN(n)) bonifValida = false
                  else bonifParsed[tipo]![s] = n
                }
              const fichaViaj = fmtSeg(bonifCliente?.viajante)
              const fichaMerc = fmtSeg(bonifCliente?.mercaderia)
              const btnCliente = "bg-gray-900 disabled:opacity-40 text-white rounded-xl py-3 text-sm font-bold active:scale-[0.97]"
              const selCls = "w-full rounded-xl border border-gray-300 px-4 py-3 bg-white"
              // ── UN SOLO guardado para toda la condición del pedido (método + lista + descuentos) ──
              // Lo que coincide con la ficha NO se guarda como override (queda "hereda de la ficha");
              // así, para volver a lo del cliente alcanza con elegir de nuevo el valor de la ficha.
              const fichaMetodo = cliente.metodo_facturacion || ""
              const fichaLista = cliente.lista_precio_id || ""
              const bonifIgualFicha = (["viajante", "mercaderia"] as const).every((t) =>
                SEGS.every((s) => (bonifParsed[t]?.[s] ?? 0) === (bonifCliente?.[t]?.[s] ?? 0)))
              const nuevaCond: CondPedido = {
                metodo: metodoSel && metodoSel !== fichaMetodo ? metodoSel : "",
                lista: puedeLista ? (listaSel && listaSel !== fichaLista ? listaSel : "") : cond.lista,
                bonif: bonifIgualFicha ? null : bonifParsed,
              }
              const hayCambios = JSON.stringify(nuevaCond) !== JSON.stringify({ ...cond, bonif: bonifVacia(cond.bonif) ? null : cond.bonif })
              const hayOverride = !!cond.metodo || !!cond.lista || !bonifVacia(cond.bonif)
              return (
                <div className="space-y-3 max-h-[60dvh] overflow-y-auto -mx-1 px-1">
                  {/* ── Método ── */}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div>
                      <p className="text-gray-700 font-bold text-sm">Método de facturación</p>
                      <p className="text-gray-400 text-xs">
                        Actual: {cond.metodo ? `${cond.metodo} (solo este pedido)` : cliente.metodo_facturacion || "—"}
                      </p>
                    </div>
                    <select value={metodoSel} onChange={(e) => setMetodoSel(e.target.value)} className={selCls}>
                      <option value="">Elegir método...</option>
                      <option value="Factura">Factura{fichaMetodo === "Factura" ? " (ficha)" : ""}</option>
                      <option value="Final">Final (Mixto){fichaMetodo === "Final" ? " (ficha)" : ""}</option>
                      <option value="Presupuesto">Presupuesto{fichaMetodo === "Presupuesto" ? " (ficha)" : ""}</option>
                    </select>
                  </div>

                  {/* ── Lista de precios ── */}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div>
                      <p className="text-gray-700 font-bold text-sm">Lista de precios</p>
                      <p className="text-gray-400 text-xs">
                        Actual: {cond.lista ? `${listaNombre(cond.lista) || "—"} (solo este pedido)` : listaClienteNombre}
                        {listaImpuesta && !cond.lista ? " (por viajante)" : ""}
                      </p>
                    </div>
                    {puedeLista ? (
                      <>
                        <select value={listaSel} onChange={(e) => setListaSel(e.target.value)} className={selCls}>
                          <option value="">Estándar (sin lista)</option>
                          {(catFicha?.listas_precio || []).map((l) => (
                            <option key={l.id} value={l.id}>{l.nombre}{l.id === fichaLista ? " (ficha)" : ""}</option>
                          ))}
                        </select>
                        {listaImpuesta && (
                          <p className="text-gray-400 text-xs">
                            La ficha lleva lista <b>{listaImpuesta}</b> por el viajante asignado; para cambiarla de forma permanente, reasigná el viajante desde la ficha.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-gray-400 text-xs">No tenés permiso para cambiar la lista de precios.</p>
                    )}
                  </div>

                  {/* ── Descuentos por segmento: viajante y mercadería ── */}
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div>
                      <p className="text-gray-700 font-bold text-sm">Descuentos por segmento</p>
                      <p className="text-gray-400 text-xs">
                        {!bonifVacia(cond.bonif) ? (
                          <>Solo este pedido · viajante {fmtSeg(cond.bonif?.viajante ?? bonifCliente?.viajante)} · mercadería {fmtSeg(cond.bonif?.mercaderia ?? bonifCliente?.mercaderia)}</>
                        ) : (
                          <>Ficha · viajante {fichaViaj} · mercadería {fichaMerc}</>
                        )}
                      </p>
                    </div>
                    <div className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-2 items-center text-[11px] font-bold uppercase tracking-wide text-gray-400">
                      <span>Segmento</span>
                      <span className="text-center text-orange-600">Viajante</span>
                      <span className="text-center text-green-700">Mercad.</span>
                    </div>
                    {SEGS.map((s) => (
                      <div key={s} className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-2 items-center">
                        <span className="text-sm text-gray-700">{SEG_LABEL[s]}</span>
                        {(["viajante", "mercaderia"] as const).map((tipo) => (
                          <div key={tipo} className="relative">
                            <input
                              value={bonifSel[`${tipo}.${s}`] ?? ""}
                              onChange={(e) => {
                                const v = e.target.value.replace(/[^\d.,]/g, "")
                                setBonifSel((prev) => ({ ...prev, [`${tipo}.${s}`]: v }))
                              }}
                              inputMode="decimal"
                              placeholder="0"
                              className="w-full rounded-lg border border-gray-300 bg-white pl-2 pr-6 py-2.5 text-right font-bold"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">%</span>
                          </div>
                        ))}
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        // Atajo: copiar la primera fila a las otras dos
                        setBonifSel((prev) => {
                          const n = { ...prev }
                          for (const tipo of ["viajante", "mercaderia"] as const)
                            for (const s of SEGS) n[`${tipo}.${s}`] = prev[`${tipo}.limpieza_bazar`] ?? ""
                          return n
                        })
                      }}
                      className="text-emerald-700 text-xs font-bold"
                    >
                      ⤓ Mismo % en los tres segmentos (copia la fila Limpieza / Bazar)
                    </button>
                    <p className="text-gray-400 text-xs">
                      <b>Viajante</b>: descuento sobre el neto de cada línea del segmento; sale de tu comisión y ya se ve en el precio.{" "}
                      <b>Mercadería</b>: % del neto del segmento que se entrega en mercadería sin cargo (la arma depósito/ERP; no cambia precios).
                      {" "}Ficha: viajante {fichaViaj} · mercadería {fichaMerc}.
                    </p>
                  </div>

                  {/* ── UN SOLO guardado para método + lista + descuentos ── */}
                  <div className="sticky bottom-0 bg-white pt-2 pb-1 space-y-2 border-t border-gray-100">
                    {!bonifValida && <p className="text-red-600 text-xs font-medium">Revisá los porcentajes: hay un valor inválido.</p>}
                    <button
                      onClick={() => { if (!bonifValida || !hayCambios) return; setVerCliente(false); aplicarSoloPedido(nuevaCond) }}
                      disabled={!bonifValida || !hayCambios}
                      className="w-full bg-emerald-600 disabled:opacity-40 text-white rounded-xl py-3.5 text-base font-bold active:scale-[0.97]"
                    >
                      ✅ Aplicar a este pedido
                    </button>
                    <p className="text-gray-400 text-[11px] text-center">
                      Guarda método, lista y descuentos juntos y recalcula al instante todos los precios (de ahí sale la factura).
                      Lo que coincide con la ficha no queda como "solo este pedido".
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          if (!bonifValida) return
                          guardarParaCliente({
                            metodo: metodoSel || undefined,
                            lista: puedeLista && !listaImpuesta ? listaSel : undefined,
                            bonif: bonifIgualFicha ? undefined : bonifParsed,
                          })
                        }}
                        disabled={!bonifValida}
                        className={btnCliente}
                      >
                        Guardar en la ficha del cliente
                      </button>
                      <button
                        onClick={() => { setVerCliente(false); aplicarSoloPedido(COND_VACIA) }}
                        disabled={!hayOverride}
                        className="bg-white border border-gray-300 disabled:opacity-40 text-gray-700 rounded-xl py-3 text-sm font-bold active:scale-[0.97]"
                      >
                        ↩ Volver a lo del cliente
                      </button>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* Sheet de artículo */}
      {sel && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={() => setSel(null)}>
          <div
            className="bg-white w-full rounded-t-3xl p-5 max-w-2xl mx-auto space-y-4 max-h-[92dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Foto protagonista: aprovecha el ancho del sheet; tap = zoom */}
            {sel.imagen_url && (
              <button
                onClick={() => setZoomFoto(sel.imagen_url)}
                className="relative w-full h-48 sm:h-56 rounded-2xl bg-gray-50 border border-gray-100 overflow-hidden active:opacity-90 -mt-1"
              >
                <img src={sel.imagen_url} alt={sel.descripcion} className="w-full h-full object-contain" />
                <span className="absolute bottom-2 right-2 bg-black/50 text-white text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                  <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" aria-hidden>
                    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                    <path d="M16.5 16.5 21 21M11 8v6M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Zoom
                </span>
              </button>
            )}
            <div className="min-w-0">
              <p className="font-bold text-gray-900 text-lg leading-snug">{sel.descripcion}</p>
              <p className="text-gray-500 text-sm mt-1">
                {[sel.marca, sel.proveedor].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
              {sel.sku && <span>SKU {sel.sku}</span>}
              {sel.ean13 && <span>EAN {sel.ean13}</span>}
              {sel.unidades_por_bulto ? <span>{sel.unidades_por_bulto} u/bulto</span> : null}
              {(sel.cantidad_fraccion || 0) > 1 ? (
                <span>
                  {labelFraccion(sel)} ×{sel.cantidad_fraccion}
                </span>
              ) : null}
              <span className={sel.stock_disponible > 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                Stock: {sel.stock_disponible}
              </span>
              {sel.descuento_propio > 0 && !selPrecio?.especial && (
                <span className="text-red-600 font-bold">Oferta -{sel.descuento_propio}%</span>
              )}
            </div>

            <div className="bg-gray-50 rounded-xl p-4 text-center">
              {cargandoPrecio ? (
                <div className="w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              ) : selPrecio ? (
                selPrecio.especial ? (
                  <>
                    <span className="inline-block bg-violet-100 text-violet-700 px-2.5 py-0.5 rounded-full text-xs font-bold mb-1">
                      LISTA ESPECIAL
                    </span>
                    {selPrecio.especial.oferta_pct > 0 && (
                      <p className="text-gray-400 text-sm">
                        <span className="line-through">{formatCurrency(selPrecio.especial.bruto)}</span>{" "}
                        <span className="text-red-600 font-bold">-{selPrecio.especial.oferta_pct}%</span>
                      </p>
                    )}
                    <p className="text-3xl font-bold text-gray-900">
                      {formatCurrency(selPrecio.precioNeto)}
                      <span className="text-sm text-gray-400 font-medium"> neto</span>
                    </p>
                    <p className="text-gray-500 text-sm mt-1">
                      + 21% IVA = {formatCurrency(selPrecio.precio)} · sin precio contado
                    </p>
                  </>
                ) : (
                <>
                  <p className="text-3xl font-bold text-gray-900">
                    {formatCurrency(selPrecio.precio)}
                    <span className="text-sm text-gray-400 font-medium"> cta cte</span>
                  </p>
                  <p className="text-emerald-700 font-bold mt-0.5">
                    {formatCurrency(selPrecio.contado)} <span className="text-xs font-medium">contado (-10%)</span>
                  </p>
                  {Math.abs(selPrecio.precio - selPrecio.precioNeto) > 0.01 ? (
                    <p className="text-gray-500 text-sm mt-1">
                      Neto {formatCurrency(selPrecio.precioNeto)} + IVA{" "}
                      {formatCurrency(selPrecio.precio - selPrecio.precioNeto)}
                    </p>
                  ) : (
                    <p className="text-gray-500 text-sm mt-1">Sin IVA incluido</p>
                  )}
                  {(selPrecio.bonifViajantePct || 0) > 0 && (
                    <p className="text-sky-700 text-xs font-bold mt-1">
                      Incluye bonificación viajante −{selPrecio.bonifViajantePct}% de este cliente
                    </p>
                  )}
                </>
                )
              ) : (
                <p className="text-red-500">No se pudo calcular el precio</p>
              )}
            </div>

            {/* Modo de carga: unidades / fracción / bulto */}
            {(() => {
              const modos: Array<{ key: "unidad" | "fraccion" | "bulto"; label: string; factor: number }> = [
                { key: "unidad", label: "Unidades", factor: 1 },
              ]
              if ((sel.cantidad_fraccion || 0) > 1)
                modos.push({ key: "fraccion", label: `${labelFraccion(sel)} ×${sel.cantidad_fraccion}`, factor: sel.cantidad_fraccion! })
              if ((sel.unidades_por_bulto || 0) > 1)
                modos.push({ key: "bulto", label: `Bulto ×${sel.unidades_por_bulto}`, factor: sel.unidades_por_bulto! })
              if (modos.length === 1) return null
              return (
                <div className="flex gap-2">
                  {modos.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setSelModo(m.key)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold border ${
                        selModo === m.key
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-white text-gray-600 border-gray-300"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )
            })()}

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setSelCantidad((c) => Math.max(0, (typeof c === "number" ? c : 0) - 1) || "")}
                className="w-14 h-14 rounded-xl bg-gray-100 text-2xl font-bold text-gray-700"
              >
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={selCantidad}
                placeholder="0"
                onChange={(e) => {
                  const v = parseInt(e.target.value)
                  setSelCantidad(Number.isFinite(v) && v > 0 ? v : "")
                }}
                className="w-24 h-14 text-center text-2xl font-bold border border-gray-300 rounded-xl placeholder:text-gray-300"
              />
              <button
                onClick={() => setSelCantidad((c) => (typeof c === "number" ? c : 0) + 1)}
                className="w-14 h-14 rounded-xl bg-gray-100 text-2xl font-bold text-gray-700"
              >
                +
              </button>
            </div>

            {selModo !== "unidad" && selUnidades > 0 && (
              <p className="text-center text-gray-500 text-sm -mt-2">
                = <span className="font-bold text-gray-800">{selUnidades}</span> unidades
              </p>
            )}

            {selPrecio && selUnidades > 0 && (
              <p className="text-center text-gray-500">
                Subtotal: <span className="font-bold text-gray-900">{formatCurrency(selPrecio.precio * selUnidades)}</span>
              </p>
            )}

            <button
              onClick={agregarAlCarrito}
              disabled={!selPrecio || selUnidades <= 0}
              className="w-full bg-emerald-600 disabled:bg-gray-300 text-white rounded-xl py-4 text-lg font-bold"
            >
              {selUnidades > 0 ? "Agregar al pedido" : "Ingresá la cantidad"}
            </button>
          </div>
        </div>
      )}

      {/* Zoom de foto de artículo */}
      {zoomFoto && <ZoomImageOverlay src={zoomFoto} alt={sel?.descripcion} onClose={() => setZoomFoto(null)} />}

      {/* Búsqueda por cámara/foto */}
      {buscarFoto && (
        <BuscarPorFoto
          onClose={() => setBuscarFoto(false)}
          onSelect={(a) => {
            setBuscarFoto(false)
            abrirArticulo(a as unknown as Articulo)
          }}
        />
      )}

      {/* Barra de carrito */}
      {cart.length > 0 && !sel && (
        <div className="fixed bottom-0 inset-x-0 z-20 p-3">
          <button
            onClick={() => setVerCarrito(true)}
            className="w-full max-w-2xl mx-auto flex items-center justify-between bg-emerald-700 text-white rounded-2xl px-5 py-4 shadow-lg"
          >
            <span className="font-bold">🛒 {totalItems} ítems</span>
            <span className="text-xl font-bold">{formatCurrency(total)}</span>
            <span className="font-medium">Ver pedido →</span>
          </button>
        </div>
      )}

      {/* Carrito / confirmación */}
      {verCarrito && (
        <div className="fixed inset-0 z-40 bg-gray-50 overflow-y-auto">
          <header className="bg-emerald-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
            <button onClick={() => setVerCarrito(false)} className="text-2xl leading-none px-1">←</button>
            <div>
              <h1 className="text-lg font-bold">Confirmar pedido</h1>
              <p className="text-emerald-200 text-sm">{cliente.nombre}</p>
            </div>
          </header>
          <div className="p-4 space-y-4 max-w-2xl mx-auto pb-40">
            {cart.map((i) => (
              <div key={i.detalleId} className="bg-white rounded-xl border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-gray-900 text-sm leading-snug flex-1">{i.articulo.descripcion}</p>
                  <button
                    onClick={() => quitarItem(i.detalleId)}
                    className="text-red-500 text-xl leading-none px-1"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCantidadItem(i.detalleId, Math.max(1, i.cantidad - 1))}
                      className="w-10 h-10 rounded-lg bg-gray-100 text-xl font-bold text-gray-700"
                    >
                      −
                    </button>
                    <span className="w-10 text-center font-bold text-lg">{i.cantidad}</span>
                    <button
                      onClick={() => setCantidadItem(i.detalleId, i.cantidad + 1)}
                      className="w-10 h-10 rounded-lg bg-gray-100 text-xl font-bold text-gray-700"
                    >
                      +
                    </button>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-400 text-xs">{formatCurrency(i.precio)} c/u</p>
                    <p className="font-bold text-gray-900">{formatCurrency(i.precio * i.cantidad)}</p>
                  </div>
                </div>
              </div>
            ))}

            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div>
                <label className="text-gray-500 text-sm block mb-1">Método de facturación</label>
                <select
                  value={metodoOverride}
                  onChange={(e) => cambiarMetodo(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 bg-white"
                >
                  <option value="">Del cliente{cliente.metodo_facturacion ? ` (${cliente.metodo_facturacion})` : ""}</option>
                  <option value="Factura">Factura</option>
                  <option value="Final">Final (Mixto)</option>
                  <option value="Presupuesto">Presupuesto</option>
                </select>
                <p className="text-gray-400 text-xs mt-1">
                  Al cambiar el método, todos los precios del pedido se recalculan al instante.
                </p>
                {(cond.lista || !bonifVacia(cond.bonif)) && (
                  <p className="text-amber-700 text-xs mt-2 font-medium">
                    Solo este pedido:
                    {cond.lista ? ` lista ${catFicha?.listas_precio.find((l) => l.id === cond.lista)?.nombre || "—"}` : ""}
                    {cond.lista && !bonifVacia(cond.bonif) ? " ·" : ""}
                    {cond.bonif?.viajante && Object.keys(cond.bonif.viajante).length ? ` viajante ${fmtSeg(cond.bonif.viajante)}` : ""}
                    {cond.bonif?.mercaderia && Object.keys(cond.bonif.mercaderia).length ? ` · mercadería ${fmtSeg(cond.bonif.mercaderia)}` : ""}
                    {" "}(se cambia desde 👤)
                  </p>
                )}
              </div>
              <div>
                <label className="text-gray-500 text-sm block mb-1">Observaciones</label>
                <textarea
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3"
                  placeholder="Opcional..."
                />
              </div>
            </div>
          </div>

          <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4">
            <div className="max-w-2xl mx-auto space-y-2">
              <div className="flex items-center justify-between text-lg">
                <span className="text-gray-500">Total ({totalItems} ítems)</span>
                <span className="font-bold text-2xl text-gray-900">{formatCurrency(total)}</span>
              </div>
              <button
                onClick={confirmarPedido}
                disabled={confirmando || !cart.length}
                className="w-full bg-emerald-600 disabled:bg-gray-300 text-white rounded-xl py-4 text-lg font-bold"
              >
                {confirmando
                  ? "Guardando..."
                  : editandoExistente
                    ? "Guardar cambios"
                    : "Confirmar pedido"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function NuevoPedidoPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <NuevoPedidoInner />
    </Suspense>
  )
}
