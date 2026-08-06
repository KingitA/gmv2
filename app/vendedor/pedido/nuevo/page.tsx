"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { formatCurrency } from "@/lib/utils"
import {
  actualizarCantidadItem,
  agregarItemPedido,
  aplicarMetodoPedidoVendedor,
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
  ean13: string | null
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
  localidad: string | null
  metodo_facturacion: string | null
  saldo_actual?: number
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

  // ── Navegación por proveedor ────────────────────────────────────────
  const [proveedores, setProveedores] = useState<ProveedorCatalogo[]>([])
  const [cargandoProvs, setCargandoProvs] = useState(false)
  const [qProv, setQProv] = useState("")
  const [artsProveedor, setArtsProveedor] = useState<Articulo[]>([])
  const [cargandoArtsProv, setCargandoArtsProv] = useState(false)
  const provCache = useRef<Map<string, Articulo[]>>(new Map())

  // ── Búsqueda ────────────────────────────────────────────────────────
  const [q, setQ] = useState("")
  const [resultados, setResultados] = useState<Articulo[]>([])
  const [buscando, setBuscando] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Precios por artículo para las listas del catálogo (batch, por cliente+método)
  const [precios, setPrecios] = useState<Record<string, { precio: number; precioNeto: number; contado: number; ivaIncluido: boolean }>>({})
  const preciosPedidos = useRef<Set<string>>(new Set())

  const [sel, setSel] = useState<Articulo | null>(null)
  const [zoomFoto, setZoomFoto] = useState<string | null>(null)
  const [buscarFoto, setBuscarFoto] = useState(false)
  const [selPrecio, setSelPrecio] = useState<{ precio: number; precioNeto: number; contado: number } | null>(null)
  // Cantidad en el modo elegido; arranca vacía (sin el "1" fantasma)
  const [selCantidad, setSelCantidad] = useState<number | "">("")
  const [selModo, setSelModo] = useState<"unidad" | "fraccion" | "bulto">("unidad")
  const [cargandoPrecio, setCargandoPrecio] = useState(false)

  const [cart, setCart] = useState<CartItem[]>([])
  const [verCarrito, setVerCarrito] = useState(false)
  // Panel de acceso rápido al cliente (ficha, CC, método de facturación)
  const [verCliente, setVerCliente] = useState(false)
  const [metodoSel, setMetodoSel] = useState("")
  const [obs, setObs] = useState("")
  const [metodoOverride, setMetodoOverride] = useState("")
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
      setCart(
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
        setMetodoOverride(p.metodo_facturacion_pedido || "")
        if (p.clientes) {
          setCliente((prev) =>
            prev || {
              id: p.clientes.id,
              nombre: p.clientes.nombre,
              localidad: p.clientes.localidad,
              metodo_facturacion: p.clientes.metodo_facturacion,
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
        const res = await previewPreciosArticulos(
          cliente.id,
          ids,
          metodoOverride ? { metodo_facturacion_pedido: metodoOverride } : {}
        )
        setPrecios((prev) => {
          const next = { ...prev }
          for (const p of res)
            next[p.articulo_id] = { precio: p.precio, precioNeto: p.precioNeto, contado: p.contado, ivaIncluido: p.ivaIncluido }
          return next
        })
      } catch (e) {
        console.error("Error cargando precios del listado:", e)
        for (const id of ids) preciosPedidos.current.delete(id)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cliente, metodoOverride]
  )

  // Vacía el cache de precios y recalcula todo lo cargado en pantalla
  const recalcularPreciosCatalogo = useCallback(() => {
    setPrecios({})
    preciosPedidos.current = new Set()
    const cargados: Articulo[] = [
      ...Object.values(listas).flatMap((l) => l || []),
      ...artsCategoria,
      ...resultados,
    ]
    if (cargados.length) cargarPrecios(cargados)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listas, artsCategoria, resultados, cargarPrecios])

  // Al cambiar el método del pedido, los precios del catálogo se recalculan
  useEffect(() => {
    recalcularPreciosCatalogo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metodoOverride])

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
    setNav({ s: "cats", ctx: { tipo: "proveedor", proveedorId: p.id, proveedorNombre: p.nombre } })
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
    if (nav.s === "arts") setNav({ s: "cats", ctx: nav.ctx })
    else if (nav.s === "cats") setNav(nav.ctx.tipo === "proveedor" ? { s: "provs" } : { s: "home" })
    else if (nav.s === "provs") setNav({ s: "home" })
    else router.back()
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
    debounce.current = setTimeout(() => {
      if (!cliente) return
      const params = new URLSearchParams({ vista: "buscar", cliente: cliente.id, q: value })
      fetch(`/api/vendedor/articulos?${params}`)
        .then((r) => r.json())
        .then((d) => {
          const arts = d.articulos || []
          setResultados(arts)
          cargarPrecios(arts)
        })
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false))
    }, 400)
  }

  // ── Detalle de artículo + precio en vivo ────────────────────────────
  const abrirArticulo = async (a: Articulo) => {
    setSel(a)
    // Sin default de 1: arranca vacío. En habituales precarga la última cantidad.
    setSelCantidad(a.cantidad_habitual || "")
    setSelModo("unidad")
    setSelPrecio(null)
    setCargandoPrecio(true)
    try {
      const p = await previewPrecioArticulo(
        cliente!.id,
        a.id,
        metodoOverride ? { metodo_facturacion_pedido: metodoOverride } : {}
      )
      setSelPrecio({ precio: p.precio, precioNeto: p.precioNeto, contado: p.contado })
    } catch {
      setSelPrecio(null)
    } finally {
      setCargandoPrecio(false)
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
  const agregarAlCarrito = () => {
    if (!sel || !selPrecio || selUnidades <= 0 || !cliente) return
    const art = sel
    const cant = selUnidades // siempre se guarda en unidades
    setSel(null)
    setSync("saving")
    enqueue(async () => {
      try {
        if (!pedidoIdRef.current) {
          const pedido: any = await createPedido({
            cliente_id: cliente.id,
            items: [{ producto_id: art.id, cantidad: cant, precio_unitario: 0, descuento: 0 }],
            estado_inicial: "en_venta",
            ...(metodoOverride ? { metodo_facturacion_pedido: metodoOverride } : {}),
          })
          pedidoIdRef.current = pedido.id
          setPedidoId(pedido.id)
          setNumeroPedido(pedido.numero_pedido || null)
          setEstadoPedido("en_venta")
          // URL con ?pedido= para que un refresh/back retome este pedido
          window.history.replaceState(null, "", `/vendedor/pedido/nuevo?cliente=${cliente.id}&pedido=${pedido.id}`)
          await refreshPedido(pedido.id)
        } else {
          const existente = cartRef.current.find((i) => i.articulo.id === art.id)
          if (existente) {
            await actualizarCantidadItem(existente.detalleId, pedidoIdRef.current, existente.cantidad + cant)
          } else {
            await agregarItemPedido(pedidoIdRef.current, art.id, cant)
          }
          await refreshPedido(pedidoIdRef.current)
        }
        setSync("idle")
      } catch (e: any) {
        console.error("Error guardando ítem del pedido:", e)
        setSync("error")
        alert(`No se pudo guardar el artículo en el pedido: ${e?.message || e}`)
      }
    })
  }

  // Cambio de método de facturación: si el pedido ya existe, re-precia TODO
  // el carrito en el server y refresca; el catálogo recalcula por el effect.
  const cambiarMetodo = (metodo: string) => {
    setMetodoOverride(metodo)
    if (!pedidoIdRef.current) return
    setSync("saving")
    enqueue(async () => {
      try {
        await aplicarMetodoPedidoVendedor(pedidoIdRef.current!, metodo)
        await refreshPedido(pedidoIdRef.current!)
        setSync("idle")
      } catch (e: any) {
        console.error("Error repreciando el pedido:", e)
        setSync("error")
        alert(`No se pudieron recalcular los precios: ${e?.message || e}`)
      }
    })
  }

  // Guardar el método EN LA FICHA del cliente (queda para futuros pedidos),
  // limpiando el override del pedido y repreciando carrito + catálogo.
  const guardarMetodoCliente = (metodo: string) => {
    if (!cliente || !metodo) return
    setVerCliente(false)
    setSync("saving")
    enqueue(async () => {
      try {
        const res = await fetch(`/api/vendedor/cliente/${cliente.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metodo_facturacion: metodo }),
        })
        const d = await res.json()
        if (d.error) throw new Error(d.error)
        setCliente((prev) => (prev ? { ...prev, metodo_facturacion: metodo } : prev))
        if (pedidoIdRef.current) {
          // el pedido pasa a usar el método del cliente (sin override)
          await aplicarMetodoPedidoVendedor(pedidoIdRef.current, "", { forzarReprecio: true })
          await refreshPedido(pedidoIdRef.current)
        }
        if (metodoOverride) setMetodoOverride("") // el effect recalcula el catálogo
        else recalcularPreciosCatalogo()
        setSync("idle")
      } catch (e: any) {
        console.error("Error guardando método del cliente:", e)
        setSync("error")
        alert(`No se pudo guardar el método del cliente: ${e?.message || e}`)
      }
    })
  }

  // Cambiar cantidad desde el carrito: optimista + sync con debounce
  const setCantidadItem = (detalleId: string, cantidad: number) => {
    if (cantidad < 1 || !pedidoIdRef.current) return
    setCart((prev) => prev.map((i) => (i.detalleId === detalleId ? { ...i, cantidad } : i)))
    const t = cantTimers.current.get(detalleId)
    if (t) clearTimeout(t)
    cantTimers.current.set(
      detalleId,
      setTimeout(() => {
        cantTimers.current.delete(detalleId)
        setSync("saving")
        enqueue(async () => {
          try {
            await actualizarCantidadItem(detalleId, pedidoIdRef.current!, cantidad)
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
    if (!pedidoIdRef.current) return
    const t = cantTimers.current.get(detalleId)
    if (t) {
      clearTimeout(t)
      cantTimers.current.delete(detalleId)
    }
    setCart((prev) => prev.filter((i) => i.detalleId !== detalleId))
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
      setCart([])
      setVerCarrito(false)
      pedidoIdRef.current = null
      setPedidoId(null)
      setNumeroPedido(null)
      setEstadoPedido(null)
      setObs("")
      setMetodoOverride("")
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

  // Tarjetas de categoría según contexto: por rubro sale de la taxonomía;
  // por filtro se agrupa la lista ya cargada (solo categorías con artículos en el filtro).
  const categoriasCtx = useMemo(() => {
    if (nav.s !== "cats") return []
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
    return [...grupos.values()].sort((a, b) => b.cantidad - a.cantidad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, catalogo, listas, artsProveedor])

  // Artículos visibles en la pantalla de lista
  const articulosVisibles = useMemo(() => {
    if (nav.s !== "arts") return []
    let base: Articulo[]
    if (nav.ctx.tipo === "rubro") base = artsCategoria
    else base = listaDeCtx(nav.ctx).filter((a) => claveCategoria(a) === (nav.catId || "otros"))
    if (subSel) base = base.filter((a) => claveSubcategoria(a) === subSel)
    return base
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, artsCategoria, listas, artsProveedor, subSel])

  // Chips de subcategoría derivados de los artículos presentes
  const subchips = useMemo(() => {
    if (nav.s !== "arts") return []
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
    return [...m.values()].sort((a, b) => b.cantidad - a.cantidad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, artsCategoria, listas, artsProveedor])

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
    const filtrados = qCliente
      ? clientes.filter(
          (c) =>
            c.nombre.toLowerCase().includes(qCliente.toLowerCase()) ||
            (c.localidad || "").toLowerCase().includes(qCliente.toLowerCase())
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
              <p className="text-gray-500 text-sm">{c.localidad || "—"}</p>
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
            ) : (
              <p className="text-gray-300 text-xs">$ …</p>
            )}
            {a.descuento_propio > 0 && (
              <span className="inline-block bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold mt-1">
                -{a.descuento_propio}%
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
              setMetodoSel(metodoOverride || cliente.metodo_facturacion || "")
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
                type="search"
                value={q}
                onChange={(e) => onBuscar(e.target.value)}
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
              {resultados.map((a) => (
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
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400 mb-2 px-1">
                Catálogo por rubro
              </p>
              {/* Rubros apilados: header con imagen + título + descripción (entra al
                  rubro) y debajo las categorías principales como accesos directos */}
              <div className="space-y-3">
                {catalogo.map((r) => {
                  const t = tinteRubro(r.nombre)
                  const cats = [...r.categorias].sort((a, b) => b.cantidad - a.cantidad)
                  const top = cats.slice(0, 6)
                  const resto = cats.length - top.length
                  const totalArts = r.cantidad ?? cats.reduce((s, c) => s + c.cantidad, 0)
                  return (
                    <div
                      key={r.id}
                      className="rounded-2xl border overflow-hidden bg-white"
                      style={{ borderColor: t.border }}
                    >
                      <button
                        onClick={() => abrirRubro(r)}
                        className="w-full text-left active:opacity-90"
                        style={{ background: t.bg }}
                      >
                        <div className="flex items-center gap-4 p-4">
                          <div
                            className="w-20 h-20 shrink-0 rounded-xl overflow-hidden flex items-center justify-center bg-white/60"
                            style={{ color: t.ink }}
                          >
                            {r.imagen_url ? (
                              <img src={r.imagen_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-16 h-16">
                                <ArteRubro nombre={r.nombre} accent={t.accent} />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: t.accent }}>
                              Rubro
                            </p>
                            <p className="font-bold text-gray-900 text-xl leading-tight">{r.nombre}</p>
                            {r.descripcion && (
                              <p className="text-gray-600 text-sm mt-0.5 line-clamp-2">{r.descripcion}</p>
                            )}
                            <p className="text-xs mt-1 font-medium" style={{ color: t.accent }}>
                              {r.categorias.length} categorías · {totalArts} artículos
                            </p>
                          </div>
                          <span className="text-3xl font-light shrink-0" style={{ color: t.accent }}>
                            ›
                          </span>
                        </div>
                      </button>
                      <div className="p-3 grid grid-cols-2 gap-2">
                        {top.map((c) => (
                          <button
                            key={c.id}
                            onClick={() =>
                              abrirCategoria(
                                { tipo: "rubro", rubroId: r.id, rubroNombre: r.nombre },
                                c.id,
                                c.nombre,
                                r.nombre
                              )
                            }
                            className="flex items-center gap-2.5 rounded-xl border p-2.5 text-left active:scale-[0.97] transition-transform"
                            style={{ background: t.bgSoft, borderColor: t.border }}
                          >
                            <div
                              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                              style={{ background: t.bg, color: t.ink }}
                            >
                              <IconoCategoria nombre={c.nombre} className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-gray-900 text-[13px] leading-snug truncate">{c.nombre}</p>
                              <p className="text-[11px]" style={{ color: t.accent }}>
                                {c.cantidad} {c.cantidad === 1 ? "artículo" : "artículos"}
                              </p>
                            </div>
                          </button>
                        ))}
                        {resto > 0 && (
                          <button
                            onClick={() => abrirRubro(r)}
                            className="flex items-center justify-center rounded-xl border border-dashed p-2.5 text-[13px] font-bold active:scale-[0.97]"
                            style={{ borderColor: t.border, color: t.accent }}
                          >
                            +{resto} categorías más ›
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
                {catalogo.length === 0 && (
                  <div className="text-center py-6">
                    <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                  </div>
                )}
              </div>
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
            {cargandoArts && nav.ctx.tipo === "rubro" ? (
              <div className="text-center py-10">
                <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : articulosVisibles.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
                No hay artículos en esta categoría.
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

            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-gray-700 font-bold text-sm">Método de facturación</p>
                <p className="text-gray-400 text-xs">
                  Actual: {metodoOverride ? `${metodoOverride} (solo este pedido)` : cliente.metodo_facturacion || "—"}
                </p>
              </div>
              <select
                value={metodoSel}
                onChange={(e) => setMetodoSel(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-4 py-3 bg-white"
              >
                <option value="">Elegir método...</option>
                <option value="Factura">Factura</option>
                <option value="Final">Final (Mixto)</option>
                <option value="Presupuesto">Presupuesto</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    if (!metodoSel) return
                    setVerCliente(false)
                    cambiarMetodo(metodoSel)
                  }}
                  disabled={!metodoSel}
                  className="bg-white border border-gray-300 disabled:opacity-40 text-gray-700 rounded-xl py-3 text-sm font-bold active:scale-[0.97]"
                >
                  Solo este pedido
                </button>
                <button
                  onClick={() => guardarMetodoCliente(metodoSel)}
                  disabled={!metodoSel}
                  className="bg-gray-900 disabled:opacity-40 text-white rounded-xl py-3 text-sm font-bold active:scale-[0.97]"
                >
                  Guardar para el cliente
                </button>
              </div>
              <p className="text-gray-400 text-xs">
                En ambos casos se recalculan al instante los precios del catálogo y de los artículos ya cargados en
                el pedido — de estos precios sale la factura.
              </p>
              {metodoOverride && (
                <button
                  onClick={() => {
                    setVerCliente(false)
                    cambiarMetodo("")
                  }}
                  className="w-full text-emerald-700 text-sm font-bold py-1"
                >
                  Volver al método del cliente ({cliente.metodo_facturacion || "—"})
                </button>
              )}
            </div>
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
              {sel.descuento_propio > 0 && (
                <span className="text-red-600 font-bold">Oferta -{sel.descuento_propio}%</span>
              )}
            </div>

            <div className="bg-gray-50 rounded-xl p-4 text-center">
              {cargandoPrecio ? (
                <div className="w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              ) : selPrecio ? (
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
                </>
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
