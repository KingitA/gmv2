"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { formatCurrency } from "@/lib/utils"
import {
  actualizarCantidadItem,
  agregarItemPedido,
  confirmarPedidoVendedor,
  createPedido,
  eliminarItemPedido,
  previewPrecioArticulo,
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

interface Articulo {
  id: string
  sku: string | null
  ean13: string | null
  descripcion: string
  unidades_por_bulto: number | null
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
  categorias: CatalogoCategoria[]
}

type Filtro = "novedades" | "ofertas" | "habituales"

type Ctx = { tipo: Filtro } | { tipo: "rubro"; rubroId: string; rubroNombre: string }

type Nav =
  | { s: "home" }
  | { s: "cats"; ctx: Ctx }
  | { s: "arts"; ctx: Ctx; catId: string | null; catNombre: string; rubroNombre: string | null }

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

  // ── Búsqueda ────────────────────────────────────────────────────────
  const [q, setQ] = useState("")
  const [resultados, setResultados] = useState<Articulo[]>([])
  const [buscando, setBuscando] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [sel, setSel] = useState<Articulo | null>(null)
  const [selPrecio, setSelPrecio] = useState<{ precio: number; precioNeto: number } | null>(null)
  const [selCantidad, setSelCantidad] = useState(1)
  const [cargandoPrecio, setCargandoPrecio] = useState(false)

  const [cart, setCart] = useState<CartItem[]>([])
  const [verCarrito, setVerCarrito] = useState(false)
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

  // ── Carga de listas por filtro (novedades/ofertas/habituales) ───────
  const cargarLista = useCallback(
    (tipo: Filtro) => {
      if (!cliente || listas[tipo]) return
      setCargandoLista(true)
      const params = new URLSearchParams({ vista: tipo, cliente: cliente.id })
      fetch(`/api/vendedor/articulos?${params}`)
        .then((r) => r.json())
        .then((d) => setListas((prev) => ({ ...prev, [tipo]: d.articulos || [] })))
        .catch(() => setListas((prev) => ({ ...prev, [tipo]: [] })))
        .finally(() => setCargandoLista(false))
    },
    [cliente, listas]
  )

  // ── Artículos de una categoría (navegación por rubro) ───────────────
  const cargarCategoria = useCallback(
    (catId: string) => {
      if (!cliente) return
      setCargandoArts(true)
      const params = new URLSearchParams({ vista: "categoria", cliente: cliente.id, categoria: catId })
      fetch(`/api/vendedor/articulos?${params}`)
        .then((r) => r.json())
        .then((d) => setArtsCategoria(d.articulos || []))
        .catch(() => setArtsCategoria([]))
        .finally(() => setCargandoArts(false))
    },
    [cliente]
  )

  const abrirFiltro = (tipo: Filtro) => {
    setNav({ s: "cats", ctx: { tipo } })
    cargarLista(tipo)
  }

  const abrirRubro = (r: CatalogoRubro) => {
    setNav({ s: "cats", ctx: { tipo: "rubro", rubroId: r.id, rubroNombre: r.nombre } })
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
    else if (nav.s === "cats") setNav({ s: "home" })
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
        .then((d) => setResultados(d.articulos || []))
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false))
    }, 400)
  }

  // ── Detalle de artículo + precio en vivo ────────────────────────────
  const abrirArticulo = async (a: Articulo) => {
    setSel(a)
    setSelCantidad(a.cantidad_habitual || 1)
    setSelPrecio(null)
    setCargandoPrecio(true)
    try {
      const p = await previewPrecioArticulo(cliente!.id, a.id, {})
      setSelPrecio({ precio: p.precio, precioNeto: p.precioNeto })
    } catch {
      setSelPrecio(null)
    } finally {
      setCargandoPrecio(false)
    }
  }

  // Agregar ítem: crea el pedido "en_venta" al primer artículo, después
  // sincroniza cada alta contra pedidos_detalle. Los precios los fija el server.
  const agregarAlCarrito = () => {
    if (!sel || !selPrecio || selCantidad <= 0 || !cliente) return
    const art = sel
    const cant = selCantidad
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
      } catch (e) {
        console.error("Error guardando ítem del pedido:", e)
        setSync("error")
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
  const ctxLabel = (ctx: Ctx) => (ctx.tipo === "rubro" ? ctx.rubroNombre : FILTROS[ctx.tipo].label)

  const ctxTinte = (ctx: Ctx): Tinte => (ctx.tipo === "rubro" ? tinteRubro(ctx.rubroNombre) : FILTROS[ctx.tipo].tinte)

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
    const lista = listas[nav.ctx.tipo] || []
    const grupos = new Map<string, { id: string | null; nombre: string; cantidad: number; rubroNombre: string | null }>()
    for (const a of lista) {
      const key = a.categoria_id || "otros"
      const g = grupos.get(key)
      if (g) g.cantidad += 1
      else
        grupos.set(key, {
          id: a.categoria_id,
          nombre: a.categoria_nombre || "Otros",
          cantidad: 1,
          rubroNombre: a.rubro_nombre,
        })
    }
    return [...grupos.values()].sort((a, b) => b.cantidad - a.cantidad)
  }, [nav, catalogo, listas])

  // Artículos visibles en la pantalla de lista
  const articulosVisibles = useMemo(() => {
    if (nav.s !== "arts") return []
    let base: Articulo[]
    if (nav.ctx.tipo === "rubro") base = artsCategoria
    else base = (listas[nav.ctx.tipo] || []).filter((a) => (a.categoria_id || "otros") === (nav.catId || "otros"))
    if (subSel) base = base.filter((a) => a.subcategoria_id === subSel)
    return base
  }, [nav, artsCategoria, listas, subSel])

  // Chips de subcategoría derivados de los artículos presentes
  const subchips = useMemo(() => {
    if (nav.s !== "arts") return []
    const base =
      nav.ctx.tipo === "rubro"
        ? artsCategoria
        : (listas[nav.ctx.tipo] || []).filter((a) => (a.categoria_id || "otros") === (nav.catId || "otros"))
    const m = new Map<string, { id: string; nombre: string; cantidad: number }>()
    for (const a of base) {
      if (!a.subcategoria_id) continue
      const g = m.get(a.subcategoria_id)
      if (g) g.cantidad += 1
      else m.set(a.subcategoria_id, { id: a.subcategoria_id, nombre: a.subcategoria_nombre || "—", cantidad: 1 })
    }
    return [...m.values()].sort((a, b) => b.cantidad - a.cantidad)
  }, [nav, artsCategoria, listas])

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
          </div>
          <div className="text-right shrink-0">
            {a.descuento_propio > 0 && (
              <span className="inline-block bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold">
                -{a.descuento_propio}%
              </span>
            )}
            {enCarrito && (
              <p className="text-emerald-700 font-bold text-sm mt-1">✓ {enCarrito.cantidad}</p>
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
        : nav.s === "cats"
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
          {pedidoId && (
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
        </div>
        {nav.s === "home" && (
          <div className="px-4 pb-3">
            <div className="relative">
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
            <div className="grid grid-cols-3 gap-2.5">
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
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400 mb-2 px-1">
                Catálogo por rubro
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {catalogo.map((r) => {
                  const t = tinteRubro(r.nombre)
                  return (
                    <button
                      key={r.id}
                      onClick={() => abrirRubro(r)}
                      className="rounded-2xl border overflow-hidden text-left active:scale-[0.98] transition-transform flex sm:flex-col"
                      style={{ background: t.bg, borderColor: t.border }}
                    >
                      <div
                        className="w-28 sm:w-full h-24 sm:h-28 shrink-0 flex items-center justify-center p-3"
                        style={{ color: t.ink }}
                      >
                        <div className="w-20 h-20">
                          <ArteRubro nombre={r.nombre} accent={t.accent} />
                        </div>
                      </div>
                      <div className="bg-white/85 flex-1 px-4 py-3 flex flex-col justify-center">
                        <p
                          className="text-[10px] font-bold uppercase tracking-[0.16em]"
                          style={{ color: t.accent }}
                        >
                          Rubro
                        </p>
                        <p className="font-bold text-gray-900 text-base leading-tight">{r.nombre}</p>
                        <p className="text-gray-500 text-xs mt-0.5">{r.categorias.length} categorías</p>
                      </div>
                    </button>
                  )
                })}
                {catalogo.length === 0 && (
                  <div className="col-span-full text-center py-6">
                    <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : nav.s === "cats" ? (
          /* ── Tarjetas de categorías del contexto ── */
          cargandoLista && nav.ctx.tipo !== "rubro" && !listas[nav.ctx.tipo] ? (
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

      {/* Sheet de artículo */}
      {sel && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={() => setSel(null)}>
          <div
            className="bg-white w-full rounded-t-3xl p-5 max-w-2xl mx-auto space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              {sel.imagen_url ? (
                <img
                  src={sel.imagen_url}
                  alt=""
                  className="w-16 h-16 rounded-xl object-cover bg-gray-100 shrink-0"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="font-bold text-gray-900 text-lg leading-snug">{sel.descripcion}</p>
                <p className="text-gray-500 text-sm mt-1">
                  {[sel.marca, sel.proveedor].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
              {sel.sku && <span>SKU {sel.sku}</span>}
              {sel.ean13 && <span>EAN {sel.ean13}</span>}
              {sel.unidades_por_bulto ? <span>{sel.unidades_por_bulto} u/bulto</span> : null}
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
                  <p className="text-3xl font-bold text-gray-900">{formatCurrency(selPrecio.precio)}</p>
                  {Math.abs(selPrecio.precio - selPrecio.precioNeto) > 0.01 ? (
                    <p className="text-gray-500 text-sm mt-1">
                      Neto {formatCurrency(selPrecio.precioNeto)} + IVA{" "}
                      {formatCurrency(selPrecio.precio - selPrecio.precioNeto)}
                    </p>
                  ) : (
                    <p className="text-gray-500 text-sm mt-1">IVA incluido</p>
                  )}
                </>
              ) : (
                <p className="text-red-500">No se pudo calcular el precio</p>
              )}
            </div>

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setSelCantidad((c) => Math.max(1, c - 1))}
                className="w-14 h-14 rounded-xl bg-gray-100 text-2xl font-bold text-gray-700"
              >
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={selCantidad}
                onChange={(e) => setSelCantidad(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 h-14 text-center text-2xl font-bold border border-gray-300 rounded-xl"
              />
              <button
                onClick={() => setSelCantidad((c) => c + 1)}
                className="w-14 h-14 rounded-xl bg-gray-100 text-2xl font-bold text-gray-700"
              >
                +
              </button>
              {sel.unidades_por_bulto ? (
                <button
                  onClick={() => setSelCantidad((c) => c + (sel.unidades_por_bulto || 0))}
                  className="h-14 px-4 rounded-xl bg-emerald-50 text-emerald-700 font-bold text-sm"
                >
                  +bulto
                </button>
              ) : null}
            </div>

            {selPrecio && (
              <p className="text-center text-gray-500">
                Subtotal: <span className="font-bold text-gray-900">{formatCurrency(selPrecio.precio * selCantidad)}</span>
              </p>
            )}

            <button
              onClick={agregarAlCarrito}
              disabled={!selPrecio}
              className="w-full bg-emerald-600 disabled:bg-gray-300 text-white rounded-xl py-4 text-lg font-bold"
            >
              Agregar al pedido
            </button>
          </div>
        </div>
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
                  onChange={(e) => setMetodoOverride(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 bg-white"
                >
                  <option value="">Del cliente{cliente.metodo_facturacion ? ` (${cliente.metodo_facturacion})` : ""}</option>
                  <option value="Factura">Factura</option>
                  <option value="Final">Final (Mixto)</option>
                  <option value="Presupuesto">Presupuesto</option>
                </select>
                {metodoOverride && (
                  <p className="text-orange-600 text-xs mt-1">
                    ⚠ Los precios se recalculan al confirmar con el método elegido.
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
