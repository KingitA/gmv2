"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useUrlParams } from "@/lib/hooks/use-url-state"
import { useRealtime } from "@/lib/hooks/use-realtime"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { TablaPedidos, type Orden, type PedidoFila } from "@/components/clientes/tabla-pedidos"
import { FiltrosPedidos, type Filtros } from "@/components/clientes/filtros-pedidos"
import { CalendarioViajes, celdasMes, celdasSemana, type PedidoSuelto } from "@/components/viajes/calendario-viajes"
import { ProgramarViajeDialog } from "@/components/viajes/programar-viaje-dialog"
import { useViajesRango, sumarDias, viajeMovible, type ViajeCal } from "@/lib/viajes/use-viajes-rango"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { toast } from "sonner"
import { formatDateAR, formatCurrency, todayArgentina } from "@/lib/utils"
import { localMatch } from "@/lib/search/local-match"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import Link from "next/link"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Search,
  Truck,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  FileText,
  Receipt,
  ExternalLink,
  Printer,
  Trash2,
  Eye,
  Plus,
  X,
  AlertCircle,
  RefreshCw,
  DollarSign,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { EmailPreviewModal } from "@/components/ai/EmailPreviewModal"
import { NuevoPedidoDialog } from "@/components/pedidos/NuevoPedidoDialog"
import { ReviewPedidoDialog } from "@/components/pedidos/ReviewPedidoDialog"
import { useOrderQueue } from "@/hooks/use-order-queue"
import type { QueueItem } from "@/hooks/use-order-queue"
import { agregarItemPedido, actualizarCantidadItem, eliminarItemPedido, marcarPedidoImpreso, cambiarEstadoPedidoManual, softDeletePedido, repreciarPedidoPreciosActuales } from "@/lib/actions/pedidos"
import { transicionesManuales, puedeEliminarPedido, puedeAsignarViaje, ESTADO_LABEL } from "@/lib/pedidos/estados"
import { calcularDescuentosPedido, type DescuentosPedido } from "@/lib/pedidos/descuentos-cabecera"
import { comprobantesDePedidos } from "@/lib/comprobantes/comprobantes-de-pedido"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type Pedido = {
  id: string
  numero_pedido: string
  fecha: string
  estado: string
  cliente_id: string
  vendedor_id: string
  viaje_id: string | null
  subtotal: number
  descuento_general: number
  total_flete: number
  total_comision: number
  total_impuestos: number
  total: number
  observaciones: string | null
  prioridad: number
  fecha_entrega?: string | null
  condicion_entrega: string
  metodo_facturacion_pedido: string | null
  lista_precio_pedido_id?: string | null
  lista_limpieza_pedido_id?: string | null
  metodo_limpieza_pedido?: string | null
  lista_perf0_pedido_id?: string | null
  metodo_perf0_pedido?: string | null
  lista_perf_plus_pedido_id?: string | null
  metodo_perf_plus_pedido?: string | null
  clientes?: {
    nombre_razon_social: string
    cuit: string
    direccion: string | null
    localidad: string | null
    metodo_facturacion: string | null
    lista_precio_id: string | null
    lista_limpieza_id?: string | null
    metodo_limpieza?: string | null
    lista_perf0_id?: string | null
    metodo_perf0?: string | null
    lista_perf_plus_id?: string | null
    metodo_perf_plus?: string | null
    listas_precio?: { nombre: string } | null
  }
  vendedores?: {
    nombre: string
  }
  viajes?: {
    nombre: string
    fecha: string
  }
}

type PedidoDetalle = {
  id: string
  articulo_id: string
  cantidad: number
  cantidad_preparada?: number
  estado_item?: string
  precio_base: number
  precio_final: number
  subtotal: number
  descuento_articulo: number
  precio_lista?: number | null
  bonif_general_pct?: number | null
  bonif_viajante_pct?: number | null
  flete: number
  comision: number
  impuestos: number
  articulos?: {
    sku: string
    descripcion: string
    sigla: string
    iva_ventas?: string
    orden_deposito?: number | null
    proveedores?: {
      nombre: string
    }
  }
}

type Viaje = {
  id: string
  nombre: string
  fecha: string
  estado: string
  zona_id: string
  zonas?: {
    nombre: string
  }
}

type Comprobante = {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  total_factura: number
  anulado_en: string | null
}

type Remito = {
  id: string
  tipo_remito: string
  numero_remito: string
  pedido_id: string
  estado: string
  estado_pdf: string
}

const ESTADOS_PEDIDO = [
  { value: "en_venta", label: "En Venta", color: "bg-amber-500" },
  { value: "pendiente", label: "Pendiente", color: "bg-yellow-500" },
  { value: "en_preparacion", label: "En Preparación", color: "bg-blue-500" },
  { value: "impreso", label: "Impreso", color: "bg-green-500" },
  { value: "pendiente_facturacion", label: "Pendiente Facturación", color: "bg-orange-500" },
  { value: "facturado", label: "Facturado", color: "bg-emerald-600" },
  { value: "listo_para_retirar", label: "Listo para Retirar", color: "bg-cyan-500" },
  { value: "listo_para_enviar", label: "Listo para Enviar", color: "bg-teal-500" },
  { value: "en_viaje", label: "En Viaje", color: "bg-purple-500" },
  { value: "entregado", label: "Entregado", color: "bg-green-600" },
  { value: "rechazado", label: "Rechazado", color: "bg-red-500" },
  { value: "eliminado", label: "Eliminado", color: "bg-gray-500" },
]

export default function ClientesPedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [viajes, setViajes] = useState<Viaje[]>([])
  // Filtros, orden, calendario y pedido abierto viven en la URL
  // (?estados=…&vendedor=…&zona=…&pedido=001755…): "atrás" cierra el pedido y
  // vuelve a la lista con los mismos filtros, y el link se puede compartir.
  const url = useUrlParams()
  const router = useRouter()
  const hoy = todayArgentina()
  // Por defecto: pendientes e impresos de los últimos 30 días (decisión del dueño, 07/10/2026)
  const DEF = { estados: "pendiente,impreso", desde: sumarDias(hoy, -30) }
  const [busqueda, setBusquedaLocal] = useState(() => url.get("q"))
  const estadosParam = url.get("estados", DEF.estados)
  const desdeParam = url.get("desde", DEF.desde)
  const filtros: Filtros = {
    q: busqueda,
    estados: estadosParam === "todos" ? [] : estadosParam.split(",").filter(Boolean),
    vendedor: url.get("vendedor"),
    zona: url.get("zona"),
    prioridad: url.get("prio"),
    viaje: url.get("viaje"),
    desde: desdeParam === "todo" ? "" : desdeParam,
    hasta: url.get("hasta"),
  }
  const setFiltros = (c: Partial<Filtros>) => {
    if (c.q !== undefined) setBusquedaLocal(c.q)
    const p: Record<string, string | null> = {}
    if (c.q !== undefined) p.q = c.q
    if (c.estados !== undefined) p.estados = c.estados.length ? c.estados.join(",") : "todos"
    if (c.vendedor !== undefined) p.vendedor = c.vendedor
    if (c.zona !== undefined) p.zona = c.zona
    if (c.prioridad !== undefined) p.prio = c.prioridad
    if (c.viaje !== undefined) p.viaje = c.viaje
    if (c.desde !== undefined) p.desde = c.desde || "todo"
    if (c.hasta !== undefined) p.hasta = c.hasta
    url.set(p, "replace", DEF)
  }
  const limpiarFiltros = () => {
    setBusquedaLocal("")
    url.set({ q: null, estados: null, vendedor: null, zona: null, prio: null, viaje: null, desde: null, hasta: null, entrega: null }, "replace")
  }
  const entregaParam = /^\d{4}-\d{2}-\d{2}$/.test(url.get("entrega")) ? url.get("entrega") : ""
  const hayFiltrosExtra = !!(entregaParam || filtros.vendedor || filtros.zona || filtros.prioridad || filtros.viaje || filtros.hasta || desdeParam !== DEF.desde || estadosParam !== DEF.estados || busqueda)
  const incluyeEliminados = filtros.estados.includes("eliminado")
  const orden = (url.get("orden", "prioridad") as Orden)
  const dir = (url.get("dir", "desc") === "asc" ? "asc" : "desc") as "asc" | "desc"
  const ordenar = (o: Orden) => url.set({ orden: o, dir: orden === o && dir === "desc" ? "asc" : "desc" }, "replace", { orden: "prioridad", dir: "desc" })
  const pedidoParam = url.get("pedido")
  const abiertoDesdeListaRef = useRef(false)
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState<Pedido | null>(null)
  const [detallesPedido, setDetallesPedido] = useState<PedidoDetalle[]>([])
  // Descuentos efectivos del pedido abierto (ficha + overrides del pedido + condiciones aparte)
  const [descPedido, setDescPedido] = useState<DescuentosPedido | null>(null)
  // Quién preparó el pedido abierto (picking_items): [{ nombre, renglones, desde, hasta }]
  const [preparadoresPedido, setPreparadoresPedido] = useState<Array<{ nombre: string; renglones: number; desde: string | null; hasta: string | null }>>([])
  const [viajeAsignado, setViajeAsignado] = useState<string>("")
  const [cargando, setCargando] = useState(true)
  const [sortColumn, setSortColumn] = useState<string>("numero_pedido")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")
  const [guardandoCambios, setGuardandoCambios] = useState(false)
  const [generandoComprobante, setGenerandoComprobante] = useState<string | null>(null)
  const [repreciando, setRepreciando] = useState<string | null>(null)
  const [comprobantesGenerados, setComprobantesGenerados] = useState<{ [pedidoId: string]: Comprobante[] }>({})
  const [remitosGenerados, setRemitosGenerados] = useState<{ [pedidoId: string]: Remito[] }>({})
  const [generandoRemitos, setGenerandoRemitos] = useState(false)
  const [modalDetalleAbierto, setModalDetalleAbierto] = useState(false)
  const [pedidoAEliminar, setPedidoAEliminar] = useState<Pedido | null>(null)
  const [eliminando, setEliminando] = useState(false)
  const [pickingStatus, setPickingStatus] = useState<Record<string, any>>({})
  const [expandedPriorities, setExpandedPriorities] = useState<Record<string, boolean>>({ "1": true, "2": true, "3": true })
  const [dragPedidoId, setDragPedidoId] = useState<string | null>(null)
  const [expandedArticulosGroups, setExpandedArticulosGroups] = useState<Record<string, boolean>>({ pendientes: true, preparados: true, faltantes: false })
  const [previewEmailId, setPreviewEmailId] = useState<string | null>(null)
  const [nuevoPedidoOpen, setNuevoPedidoOpen] = useState(false)
  const [reviewingItem, setReviewingItem] = useState<QueueItem | null>(null)
  // Order editing state
  const [editMode, setEditMode] = useState(false)
  const [addProductQuery, setAddProductQuery] = useState("")
  const [addProductsFound, setAddProductsFound] = useState<any[]>([])
  const [addProductQty, setAddProductQty] = useState(1)
  const [savingItem, setSavingItem] = useState(false)
  const [listasPrecio, setListasPrecio] = useState<{ id: string; nombre: string; recargo_limpieza_bazar?: number; recargo_perfumeria_negro?: number; recargo_perfumeria_blanco?: number }[]>([])
  const [sheetWidth, setSheetWidth] = useState(680)
  const resizingRef = useRef(false)

  const supabase = createClient()

  // ?pedido=001755 abre el panel de ese pedido (click en la lista, link desde la
  // ficha del cliente, atrás/adelante). Sin el parámetro, el panel se cierra.
  useEffect(() => {
    if (!pedidoParam) {
      cerrandoRef.current = false
      if (modalDetalleAbierto) setModalDetalleAbierto(false)
      return
    }
    if (cerrandoRef.current) return
    if (pedidoSeleccionado?.numero_pedido === pedidoParam && modalDetalleAbierto) return
    if (cargando && pedidos.length === 0) return // esperar a que cargue la lista
    const p = pedidos.find(x => x.numero_pedido === pedidoParam)
    if (p) {
      setPedidoSeleccionado(p)
      setDetallesPedido([]) // limpiar ítems del pedido anterior mientras cargan los nuevos
      cargarDetallesPedido(p.id)
      setModalDetalleAbierto(true)
    } else if (!cargando) {
      // No está en la lista cargada (es viejo o lo tapan los filtros): se abren
      // los filtros a "todo" con ese número en el buscador; al recargar, se abre.
      if (!(desdeParam === "todo" && estadosParam === "todos")) {
        setBusquedaLocal(pedidoParam)
        url.set({ q: pedidoParam, desde: "todo", estados: "todos" }, "replace", DEF)
      } else {
        setBusquedaLocal(pedidoParam)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoParam, pedidos, cargando])

  const abrirPedido = (pedido: Pedido) => {
    cerrandoRef.current = false
    abiertoDesdeListaRef.current = true
    url.set({ pedido: pedido.numero_pedido }, "push")
  }

  const cerrandoRef = useRef(false)
  const cerrarPedido = () => {
    cerrandoRef.current = true
    setModalDetalleAbierto(false)
    if (!pedidoParam) return
    // Si lo abrimos desde la lista, "cerrar" = volver atrás (no deja una entrada de más)
    if (abiertoDesdeListaRef.current) { abiertoDesdeListaRef.current = false; router.back() }
    else url.set({ pedido: null }, "replace")
  }

  // Descuentos efectivos del pedido abierto para la cabecera del modal: misma
  // resolución que el motor de precios (ficha + "solo este pedido" + aparte).
  useEffect(() => {
    const p = pedidoSeleccionado
    if (!p?.cliente_id) { setDescPedido(null); return }
    let vivo = true
    setDescPedido(null)
    calcularDescuentosPedido(supabase, p.id, p.cliente_id, listaName)
      .then(d => { if (vivo) setDescPedido(d) })
      .catch(() => { if (vivo) setDescPedido(null) })
    setPreparadoresPedido([])
    fetch(`/api/deposito/picking/item?pedido_id=${p.id}`)
      .then(r => r.json())
      .then(d => { if (vivo && Array.isArray(d?.resumen)) setPreparadoresPedido(d.resumen) })
      .catch(() => {})
    return () => { vivo = false }
  }, [pedidoSeleccionado?.id, listasPrecio.length])

  useEffect(() => {
    supabase.from("listas_precio").select("id, nombre, recargo_limpieza_bazar, recargo_perfumeria_negro, recargo_perfumeria_blanco").eq("activo", true).then(({ data }) => setListasPrecio(data || []))
    cargarPedidos()
    cargarViajes()
    cargarPickingStatus()
    cargarPendingImports()

    // Realtime: recargar detalles del pedido abierto cuando el depósito escanea
    const channel = supabase
      .channel("erp-picking-realtime")
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "pedidos_detalle",
      }, () => {
        // Si hay un pedido abierto en el modal, recargamos sus detalles
        setPedidoSeleccionado(prev => {
          if (prev) cargarDetallesPedido(prev.id)
          return prev
        })
        cargarPickingStatus()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Se vuelve a leer de la base solo cuando cambia el rango de fechas o si se
  // piden eliminados; el resto de los filtros se aplican sobre lo ya cargado.
  const primeraCarga = useRef(true)
  useEffect(() => {
    if (primeraCarga.current) { primeraCarga.current = false; return }
    cargarPedidos()
  }, [incluyeEliminados, filtros.desde, filtros.hasta])

  useEffect(() => {
    if (pedidos.length > 0) {
      cargarComprobantesExistentes()
    }
  }, [pedidos])

  // silencioso: recarga en segundo plano (cambio hecho por otro usuario), sin
  // mostrar la barra de carga ni vaciar la lista.
  const filtrosRef = useRef(filtros)
  filtrosRef.current = filtros
  const turnoPedidosRef = useRef(0)
  const cargarPedidos = async (silencioso = false) => {
    const turno = ++turnoPedidosRef.current
    try {
      if (!silencioso) setCargando(true)
      const f = filtrosRef.current
      // Paginado interno: PostgREST corta en 1000 y ya hay 1159+ pedidos → se ocultaban.
      const buildPedidosQuery = () => {
        let q = supabase
          .from("pedidos")
          .select(`
          *,
          clientes (nombre_razon_social, cuit, codigo_cliente, direccion, localidad, metodo_facturacion, lista_precio_id, lista_limpieza_id, metodo_limpieza, lista_perf0_id, metodo_perf0, lista_perf_plus_id, metodo_perf_plus, listas_precio:lista_precio_id (nombre), localidades (zonas (id, nombre))),
          vendedores (nombre),
          viajes (nombre, fecha)
        `)
        if (!f.estados.includes("eliminado")) q = q.neq("estado", "eliminado")
        // Rango de fechas del filtro (por defecto, últimos 30 días)
        if (f.desde) q = q.gte("fecha", f.desde)
        if (f.hasta) q = q.lte("fecha", f.hasta)
        return q
          .order("prioridad", { ascending: true })
          .order("numero_pedido", { ascending: false })
      }
      const data = await fetchAllRows(buildPedidosQuery, "id")
      if (turno !== turnoPedidosRef.current) return // llegó una lectura más nueva
      setPedidos(data || [])
    } catch (error) {
      console.error("Error cargando pedidos:", JSON.stringify(error, null, 2))
    } finally {
      if (turno === turnoPedidosRef.current) setCargando(false)
    }
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { queue, addToQueue, removeFromQueue, confirmOrder, retryItem } = useOrderQueue(cargarPedidos)

  // En vivo: un pedido nuevo, impreso, facturado o movido por otro usuario
  // aparece solo. El picking del pedido abierto sigue con su canal propio.
  useRealtime(["pedidos"], () => { cargarPedidos(true); cargarSueltosRef.current?.() }, { esperaMs: 1500 })
  const cargarSueltosRef = useRef<(() => void) | null>(null)
  useRealtime(["picking_items"], () => cargarPickingStatus(), { esperaMs: 1500 })

  const cargarComprobantesExistentes = async () => {
    try {
      const pedidoIds = pedidos.map((p) => p.id)
      // Comprobantes del pedido + sus NC/REV (10% contado, etc.), en tandas de
      // 100 ids (el .in() con cientos de UUIDs revienta el límite de URL).
      const data = await comprobantesDePedidos(supabase, pedidoIds)

      // Agrupar comprobantes por pedido (las NC/REV van con el pedido de su comprobante)
      const comprobantesAgrupados: { [pedidoId: string]: Comprobante[] } = {}
      data.forEach((comp: any) => {
        if (!comprobantesAgrupados[comp.pedido_ref]) {
          comprobantesAgrupados[comp.pedido_ref] = []
        }
        comprobantesAgrupados[comp.pedido_ref].push(comp)
      })
      setComprobantesGenerados(comprobantesAgrupados)

      // Remitos de esos pedidos (mismas tandas de 100 por el límite de URL)
      const remitosData: any[] = []
      for (let i = 0; i < pedidoIds.length; i += 100) {
        const { data: page, error } = await supabase
          .from("remitos")
          .select("id, tipo_remito, numero_remito, pedido_id, estado, estado_pdf")
          .in("pedido_id", pedidoIds.slice(i, i + 100))
        if (error) throw error
        remitosData.push(...(page || []))
      }
      const remitosAgrupados: { [pedidoId: string]: Remito[] } = {}
      remitosData.forEach((rem: any) => {
        if (!remitosAgrupados[rem.pedido_id]) remitosAgrupados[rem.pedido_id] = []
        remitosAgrupados[rem.pedido_id].push(rem)
      })
      setRemitosGenerados(remitosAgrupados)
    } catch (error) {
      console.error("Error cargando comprobantes:", error)
    }
  }

  const cargarPickingStatus = async () => {
    try {
      const res = await fetch("/api/pedidos/picking-status")
      if (res.ok) setPickingStatus(await res.json())
    } catch (e) { console.error("Error cargando picking status:", e) }
  }

  const cargarPendingImports = async () => {
    // Legacy: no longer displayed — queue managed in-memory via useOrderQueue
    return
  }

  const cambiarPrioridad = async (pedidoId: string, nuevaPrioridad: number) => {
    try {
      const res = await fetch("/api/pedidos/prioridad", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_id: pedidoId, prioridad: nuevaPrioridad }),
      })
      if (res.ok) {
        setPedidos(prev => prev.map(p => p.id === pedidoId ? { ...p, prioridad: nuevaPrioridad } : p))
        return true
      }
      toast.error("No se pudo cambiar la prioridad")
    } catch (e) { console.error("Error cambiando prioridad:", e) }
    return false
  }

  const PRIORIDADES = [
    { nivel: 1, label: "🔴 Urgente", color: "bg-red-500", bgLight: "bg-red-50 border-red-200", textColor: "text-red-700" },
    { nivel: 2, label: "🟠 Alta", color: "bg-orange-500", bgLight: "bg-orange-50 border-orange-200", textColor: "text-orange-700" },
    { nivel: 3, label: "🟢 Normal", color: "bg-green-500", bgLight: "bg-green-50 border-green-200", textColor: "text-green-700" },
  ]

  const getPrioridadLabel = (p: number) => {
    if (p === 1) return "🔴 Urgente"
    if (p === 2) return "🟠 Alta"
    return "🟢 Normal"
  }

  const cargarViajes = async () => {
    try {
      const { data, error } = await supabase
        .from("viajes")
        .select("*, zonas (nombre)")
        .eq("tipo", "reparto")
        .eq("estado", "programado")
        .order("fecha", { ascending: true })

      if (error) throw error
      setViajes(data || [])
    } catch (error) {
      console.error("Error cargando viajes:", error)
    }
  }

  const detallesReqRef = useRef(0)
  // Repreciar: el precio del pedido se cerró al tomarlo; esto lo lleva a los
  // precios de HOY con las condiciones que el pedido ya tiene. Hasta facturar.
  const repreciarPedidoActual = async (pedido: Pedido) => {
    if (!confirm(`Repreciar el pedido ${pedido.numero_pedido} con los precios de HOY?\n\nSe mantienen sus condiciones (lista, método, descuentos, contado). Cambia lo que se va a facturar.`)) return
    setRepreciando(pedido.id)
    try {
      const r = await repreciarPedidoPreciosActuales(pedido.id)
      const fmt = (n: number) => `$${(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      alert(`Pedido ${pedido.numero_pedido} repreciado: ${fmt(r.total_anterior)} → ${fmt(r.total)}`)
      await cargarPedidos()
      await cargarDetallesPedido(pedido.id)
      setPedidoSeleccionado((prev: any) => (prev && prev.id === pedido.id ? { ...prev, total: r.total } : prev))
    } catch (e: any) {
      alert(e?.message || "No se pudo repreciar el pedido")
    } finally {
      setRepreciando(null)
    }
  }

  const cargarDetallesPedido = async (pedidoId: string) => {
    // Token de orden: si mientras esta consulta viaja se pidió cargar otro
    // pedido, descartamos esta respuesta para no mostrar ítems ajenos.
    const reqId = ++detallesReqRef.current
    try {
      const { data, error } = await supabase
        .from("pedidos_detalle")
        .select(`
          *,
          estado_item,
          cantidad_preparada,
          articulos (
            sku,
            descripcion,
            sigla,
            iva_ventas,
            orden_deposito,
            proveedores:proveedor_id (nombre),
            marcas:marca_id (descripcion)
          )
        `)
        .eq("pedido_id", pedidoId)

      if (error) throw error
      if (reqId !== detallesReqRef.current) return
      setDetallesPedido(data || [])
    } catch (error) {
      console.error("Error cargando detalles del pedido:", error)
    }
  }

  // Cambio manual de estado: pasa por el servidor, que solo acepta transiciones
  // del flujo (lib/pedidos/estados.ts). Nunca se vuelve atrás de facturado.
  const cambiarEstadoPedido = async (pedidoId: string, nuevoEstado: string) => {
    try {
      await cambiarEstadoPedidoManual(pedidoId, nuevoEstado)

      await cargarPedidos()
      if (pedidoSeleccionado?.id === pedidoId) {
        setPedidoSeleccionado({ ...pedidoSeleccionado, estado: nuevoEstado })
      }
    } catch (error: any) {
      console.error("Error cambiando estado:", error)
      toast.error(error?.message || "No se pudo cambiar el estado")
    }
  }

  const asignarViaje = async (pedidoId: string, viajeId: string) => {
    // El pedido se sube a un viaje PROGRAMADO en cualquier estado previo a salir;
    // pasa a en_viaje recién cuando oficina despacha el viaje.
    const estadoActual = pedidos.find(p => p.id === pedidoId)?.estado ?? pedidoSeleccionado?.estado
    if (!puedeAsignarViaje(estadoActual)) {
      toast.error(`El pedido está ${(ESTADO_LABEL[estadoActual || ""] || estadoActual || "").toLowerCase()}: ya no se puede asignar a un viaje.`)
      return
    }
    try {
      const res = await fetch(`/api/viajes/${viajeId}/pedidos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agregar: [pedidoId] }),
      })
      const r = await res.json()
      if (!res.ok) throw new Error(r.error || "No se pudo asignar el viaje")
      if (r.rechazados?.length) throw new Error(r.rechazados[0].motivo)

      await cargarPedidos()
      setViajeAsignado("")
    } catch (error: any) {
      console.error("Error asignando viaje:", error)
      toast.error(error?.message || "No se pudo asignar el viaje")
    }
  }

  const generarComprobantes = async (pedidoId: string) => {
    setGenerandoComprobante(pedidoId)
    try {
      const response = await fetch("/api/comprobantes-venta/generar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_id: pedidoId }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Error generando comprobantes")
      }

      alert(
        `Comprobantes generados exitosamente:\n${result.comprobantes.map((c: any) => `${c.tipo_comprobante} ${c.numero}`).join("\n")}`,
      )

      // Recargar pedidos y comprobantes
      await cargarPedidos()
      await cargarComprobantesExistentes()

      // Abrir UN solo PDF con todos los comprobantes del pedido (incluida la NC/REV del contado)
      if (result.comprobantes?.length) verComprobantesPedido(pedidoId)
    } catch (error: any) {
      console.error("Error generando comprobantes:", error)
      alert(error.message || "Error al generar comprobantes")
    } finally {
      setGenerandoComprobante(null)
    }
  }

  const verComprobante = (comprobanteId: string) => {
    window.open(`/api/comprobantes-venta/${comprobanteId}/pdf`, "_blank")
  }

  // Todos los comprobantes vivos del pedido (facturas/presupuestos + NC/REV) en un solo PDF
  const verComprobantesPedido = (pedidoId: string) => {
    window.open(`/api/comprobantes-venta/pedido/${pedidoId}/pdf`, "_blank")
  }

  const verRemito = (remitoId: string) => {
    window.open(`/api/remitos/${remitoId}/pdf`, "_blank")
  }

  const generarRemitos = async (pedidoId: string) => {
    try {
      setGenerandoRemitos(true)
      const res = await fetch("/api/remitos/generar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_id: pedidoId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || "Error generando remitos")
      const partes: string[] = []
      if (result.generados?.length) partes.push(`Generados:\n${result.generados.map((r: any) => `Remito ${r.tipo_remito === "REM" ? "R" : "X"} ${r.numero_remito}`).join("\n")}`)
      if (result.omitidos?.length) partes.push(`Omitidos:\n${result.omitidos.join("\n")}`)
      if (result.errores?.length) partes.push(`Errores:\n${result.errores.join("\n")}`)
      alert(partes.join("\n\n") || "Sin cambios")
      await cargarComprobantesExistentes()
    } catch (error: any) {
      alert(`Error generando remitos: ${error.message}`)
    } finally {
      setGenerandoRemitos(false)
    }
  }

  const imprimirPedido = async (pedido: Pedido) => {
    try {
      // Descuentos efectivos del pedido (ficha + "solo este pedido" + condiciones aparte),
      // misma resolución que el motor de precios y que el modal del listado.
      const desc = await calcularDescuentosPedido(supabase, pedido.id, pedido.cliente_id, listaName)
      const bonifLines = (segKey: string | null) => {
        const lineas = segKey
          ? (desc.segs.find(s => s.key === segKey)?.lineas ?? [])
          : Array.from(new Set(desc.segs.flatMap(s => s.lineas)))
        if (lineas.length === 0) return ""
        return `<div style="font-size:12px;color:#c2410c;font-weight:bold;margin-top:2px;">${lineas.join(" · ")}</div>`
      }

      // Siempre cargar los detalles frescos de la DB por pedido.id: el estado
      // detallesPedido puede ser del pedido anterior si su carga async todavía
      // no terminó (imprimía la cabecera de un cliente con los ítems de otro).
      const { data, error } = await supabase
        .from("pedidos_detalle")
        .select(`
          *,
          articulos (
            sku,
            descripcion,
            sigla,
            iva_ventas,
            orden_deposito,
            proveedor_id,
            marca_id,
            proveedores:proveedor_id (nombre),
            marcas:marca_id (descripcion)
          )
        `)
        .eq("pedido_id", pedido.id)

      if (error) throw error
      const detalles = data || []
      // Mercadería bonificada: no es mercadería del pedido sino un % que varía con
      // lo que se prepare. En el papel va en un cartel (código + descripción), sin
      // cantidad; depósito la ajusta al preparar. Un renglón por artículo.
      const bonificadosImpresion = detalles
        .filter((d: any) => d.es_bonificado)
        .filter((d: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.articulo_id === d.articulo_id) === i)

      // Ordenar por orden_deposito (los null van al final), luego por proveedor y descripción
      const detallesOrdenados = [...detalles].sort((a, b) => {
        const ordenA = a.articulos?.orden_deposito ?? Number.MAX_SAFE_INTEGER
        const ordenB = b.articulos?.orden_deposito ?? Number.MAX_SAFE_INTEGER

        if (ordenA !== ordenB) return ordenA - ordenB

        const provA = a.articulos?.proveedores?.nombre || ""
        const provB = b.articulos?.proveedores?.nombre || ""
        if (provA !== provB) return provA.localeCompare(provB)

        const descA = a.articulos?.descripcion || ""
        const descB = b.articulos?.descripcion || ""
        return descA.localeCompare(descB)
      })

      const printWindow = window.open("", "_blank")
      if (!printWindow) {
        alert("Por favor, permite las ventanas emergentes para imprimir.")
        return
      }

      const html = `
        <html>
          <head>
            <title>Pedido ${pedido.numero_pedido}</title>
            <style>
              body { font-family: sans-serif; padding: 20px; line-height: 1.4; }
              .header { margin-bottom: 30px; border-bottom: 2px solid #eee; padding-bottom: 15px; }
              .title { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
              .info { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
              .info-box { border: 1px solid #ddd; padding: 10px; border-radius: 4px; }
              .label { color: #666; font-size: 12px; text-transform: uppercase; margin-bottom: 2px; }
              .value { font-weight: bold; }
              table { width: 100%; border-collapse: collapse; margin-top: 20px; }
              th { text-align: left; border-bottom: 2px solid #333; padding: 8px; font-size: 14px; }
              td { padding: 8px; border-bottom: 1px solid #eee; font-size: 13px; }
              .text-right { text-align: right; }
              .footer { margin-top: 30px; border-top: 2px solid #eee; pt: 15px; }
              .total-row { display: flex; justify-content: flex-end; font-size: 18px; font-weight: bold; margin-top: 10px; }
              @media print {
                button { display: none; }
                body { padding: 0; }
                * {
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                }
              }
            </style>
          </head>
          <body>
            <div class="header">
              <div class="title">ORDEN DE PEDIDO #${pedido.numero_pedido}</div>
              <div style="color: #666;">Fecha: ${formatDateAR(pedido.fecha)}</div>
            </div>

            <div class="info">
              <div class="info-box">
                <div class="label">Cliente</div>
                <div class="value">${pedido.clientes?.nombre_razon_social}${pedido.clientes?.codigo_cliente ? ` (${pedido.clientes?.codigo_cliente})` : ''}</div>
                <div class="label" style="margin-top: 8px;">Dirección</div>
                <div class="value">${pedido.clientes?.direccion || "—"}</div>
                <div class="label" style="margin-top: 8px;">Localidad</div>
                <div class="value">${pedido.clientes?.localidad || "—"}</div>
              </div>
              <div class="info-box">
                ${(() => {
                  const c = pedido.clientes as any
                  const hasSegmentos = (pedido as any).lista_limpieza_pedido_id || c?.lista_limpieza_id ||
                    (pedido as any).lista_perf0_pedido_id || c?.lista_perf0_id ||
                    (pedido as any).lista_perf_plus_pedido_id || c?.lista_perf_plus_id ||
                    (pedido as any).metodo_limpieza_pedido || c?.metodo_limpieza ||
                    (pedido as any).metodo_perf0_pedido || c?.metodo_perf0 ||
                    (pedido as any).metodo_perf_plus_pedido || c?.metodo_perf_plus

                  if (hasSegmentos) {
                    const segRows = [
                      { label: "Limpieza / Bazar", segKey: "limpieza_bazar",
                        listaId: (pedido as any).lista_limpieza_pedido_id || c?.lista_limpieza_id,
                        metodo: (pedido as any).metodo_limpieza_pedido || c?.metodo_limpieza },
                      { label: "Perfumería 0", segKey: "perf0",
                        listaId: (pedido as any).lista_perf0_pedido_id || c?.lista_perf0_id,
                        metodo: (pedido as any).metodo_perf0_pedido || c?.metodo_perf0 },
                      { label: "Perfumería +", segKey: "perf_plus",
                        listaId: (pedido as any).lista_perf_plus_pedido_id || c?.lista_perf_plus_id,
                        metodo: (pedido as any).metodo_perf_plus_pedido || c?.metodo_perf_plus },
                    ].filter(s => s.listaId || s.metodo)
                    return segRows.map(s => {
                      const listaNombre = listaName(s.listaId) || "Sin lista"
                      return `
                        <div class="label">${s.label}</div>
                        <div class="value" style="margin-bottom: 2px;">${s.metodo || c?.metodo_facturacion || "—"} — ${listaNombre}</div>
                        ${bonifLines(s.segKey)}
                      `
                    }).join('')
                  } else {
                    const listaNombre = listaName(pedido.lista_precio_pedido_id) || c?.listas_precio?.nombre || "Sin lista"
                    return `
                      <div class="label">Lista de Precios</div>
                      <div class="value">${listaNombre}</div>
                      <div class="label" style="margin-top: 8px;">Forma de Facturación</div>
                      <div class="value">${pedido.metodo_facturacion_pedido || pedido.clientes?.metodo_facturacion || "—"}</div>
                      ${bonifLines(null)}
                    `
                  }
                })()}
                <div class="label" style="margin-top: 8px;">Vendedor</div>
                <div class="value">${pedido.vendedores?.nombre || "Sin asignar"}</div>
              </div>
            </div>

            ${desc.contado ? `
            <div class="info-box" style="margin-bottom: 20px; border: 2px solid #7c3aed;">
              <div class="value" style="color:#6d28d9;">PAGO CONTADO — 10% de descuento por pago contado</div>
              <div style="font-size:12px;color:#475569;margin-top:2px;">No va en la factura: se entrega una nota de crédito aparte por el 10%. Si no se paga de contado, esa nota se anula.</div>
            </div>` : ""}

            ${desc.mercaderiaPendiente ? `
            <div class="info-box" style="margin-bottom: 20px; border: 2px solid #dc2626;">
              <div class="value" style="color:#b91c1c;">MERCADERÍA BONIFICADA SIN DEFINIR — elegir qué se regala antes de facturar</div>
            </div>` : ""}

            ${bonificadosImpresion.length ? `
            <div class="info-box" style="margin-bottom: 20px; border: 2px solid #16a34a;">
              <div class="value" style="color:#15803d;">MERCADERÍA A BONIFICAR</div>
              <div style="font-size:11px;color:#475569;margin:2px 0 6px;">Va sin cargo. La cantidad no se fija acá: se calcula al terminar de preparar, sobre lo que realmente va.</div>
              ${bonificadosImpresion.map((d: any) => `<div style="margin-bottom: 3px;"><strong>${d.articulos?.sku || "-"}</strong> — ${d.articulos?.descripcion || "Sin descripción"}</div>`).join("")}
            </div>` : ""}

            ${desc.aparte.length ? `
            <div class="info-box" style="margin-bottom: 20px;">
              <div class="label" style="margin-bottom: 6px;">Segmentado aparte (marca / proveedor — se factura por separado)</div>
              ${desc.aparte.map(r => `<div style="margin-bottom: 4px;">
                  <span class="value">${r.nombre}:</span> <span style="color:#c2410c;font-weight:bold;">${r.texto}</span>
                </div>`).join("")}
            </div>` : ""}

            <table>
              <thead>
                <tr>
                  <th width="120">Código</th>
                  <th>Descripción</th>
                  <th>Marca</th>
                  <th width="80" class="text-right">Cant.</th>
                </tr>
              </thead>
              <tbody>
                ${detallesOrdenados
          .filter((d) => !d.es_bonificado)
          .map((d) => {
            const esPresupuesto = d.articulos?.iva_ventas?.toLowerCase() === "presupuesto"
            const bgCode = esPresupuesto ? "#000" : "transparent"
            const textCode = esPresupuesto ? "#fff" : "inherit"

            return `
                  <tr>
                    <td style="background-color: ${bgCode}; color: ${textCode}; font-weight: bold; padding-left: 8px;">${d.articulos?.sku || "-"}</td>
                    <td>${d.articulos?.descripcion || "Sin descripción"}</td>
                    <td style="color: #666; font-size: 11px;">
                      ${(d.articulos as any)?.marcas?.descripcion || "—"}
                    </td>
                    <td class="text-right"><strong>${d.cantidad}</strong></td>
                  </tr>
                `
          })
          .join("")}
              </tbody>
            </table>

            <div class="footer">
              ${pedido.observaciones
          ? `
                <div style="margin-bottom: 15px;">
                  <div class="label">Observaciones</div>
                  <div style="font-size: 13px;">${pedido.observaciones}</div>
                </div>
              `
          : ""
        }
              <div class="total-row">
                <span>TOTAL: $${pedido.total?.toFixed(2)}</span>
              </div>
            </div>

            <script>
              window.onload = function() {
                window.print();
                // Opcional: window.close();
              }
            </script>
          </body>
        </html>
      `

      printWindow.document.write(html)
      printWindow.document.close()

      // Cambiar estado a "impreso" vía server action (admin client, bypass RLS)
      try {
        await marcarPedidoImpreso(pedido.id)
        setPedidos(prev => prev.map(p => p.id === pedido.id ? { ...p, estado: "impreso" } : p))
        setPedidoSeleccionado(prev => prev?.id === pedido.id ? { ...prev, estado: "impreso" } : prev)
        toast.success("Pedido marcado como impreso")
      } catch (estadoErr: any) {
        console.error("[imprimir] Error al cambiar estado:", estadoErr)
        toast.error(`No se pudo actualizar el estado: ${estadoErr?.message || "error desconocido"}`)
      }
    } catch (error) {
      console.error("Error al preparar impresión:", error)
      alert("Error al preparar la impresión del pedido.")
    }
  }

  const handleSoftDelete = async () => {
    if (!pedidoAEliminar) return
    setEliminando(true)
    try {
      // Por servidor: aplica la traba por estado y marca el kardex del pedido.
      await softDeletePedido(pedidoAEliminar.id)

      await cargarPedidos()
      setPedidoAEliminar(null)
    } catch (error: any) {
      console.error("Error eliminando pedido:", error)
      alert(error?.message || "Error al eliminar el pedido")
    } finally {
      setEliminando(false)
    }
  }

  const getDiasRestantes = (eliminadoAt: string) => {
    const eliminado = new Date(eliminadoAt)
    const ahora = new Date()
    const diffMs = 45 * 24 * 60 * 60 * 1000 - (ahora.getTime() - eliminado.getTime())
    return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)))
  }

  const getTipoComprobanteLabel = (tipo: string) => {
    const tipos: { [key: string]: string } = {
      FA: "Factura A",
      FB: "Factura B",
      FC: "Factura C",
      PRES: "Presupuesto",
      REM: "Remito",
      NCA: "Nota Crédito A",
      NCB: "Nota Crédito B",
      NCC: "Nota Crédito C",
    }
    return tipos[tipo] || tipo
  }

  const guardarCambiosModal = async () => {
    if (!pedidoSeleccionado) return

    setGuardandoCambios(true)
    try {
      if (viajeAsignado && !pedidoSeleccionado.viaje_id) {
        await asignarViaje(pedidoSeleccionado.id, viajeAsignado)
      }

      alert("Cambios guardados exitosamente")
      await cargarPedidos()

      const { data } = await supabase
        .from("pedidos")
        .select(`
          *,
          clientes (nombre_razon_social, cuit),
          vendedores (nombre),
          viajes (nombre, fecha)
        `)
        .eq("id", pedidoSeleccionado.id)
        .single()

      if (data) setPedidoSeleccionado(data)
    } catch (error) {
      console.error("Error guardando cambios:", error)
      alert("Error al guardar cambios")
    } finally {
      setGuardandoCambios(false)
    }
  }

  // Zona del pedido = zona de la localidad del cliente
  const zonaDe = (p: Pedido): { id: string; nombre: string } | null => (p.clientes as any)?.localidades?.zonas ?? null

  const pedidosFiltrados = pedidos.filter((p) => {
    if (busqueda.trim() && !localMatch(busqueda, p.numero_pedido, p.clientes?.nombre_razon_social, p.clientes?.cuit)) return false
    if (filtros.estados.length && !filtros.estados.includes(p.estado)) return false
    if (filtros.vendedor && p.vendedor_id !== filtros.vendedor) return false
    if (filtros.zona && zonaDe(p)?.id !== filtros.zona) return false
    if (filtros.prioridad && String(p.prioridad || 3) !== filtros.prioridad) return false
    if (filtros.desde && (p.fecha || "") < filtros.desde) return false
    if (filtros.hasta && (p.fecha || "").slice(0, 10) > filtros.hasta) return false
    if (filtros.viaje === "con" && !p.viaje_id) return false
    if (filtros.viaje === "sin" && p.viaje_id) return false
    if (entregaParam && (p.viaje_id || p.fecha_entrega !== entregaParam)) return false
    return true
  })

  const pedidosLista: PedidoFila[] = [...pedidosFiltrados]
    .sort((a, b) => {
      const s = dir === "asc" ? 1 : -1
      const porFecha = (b.fecha || "").localeCompare(a.fecha || "") || (b.numero_pedido || "").localeCompare(a.numero_pedido || "")
      switch (orden) {
        case "numero": return (a.numero_pedido || "").localeCompare(b.numero_pedido || "") * s
        case "fecha": return ((a.fecha || "").localeCompare(b.fecha || "") || (a.numero_pedido || "").localeCompare(b.numero_pedido || "")) * s
        case "cliente": return (a.clientes?.nombre_razon_social || "").localeCompare(b.clientes?.nombre_razon_social || "") * s
        case "total": return ((a.total || 0) - (b.total || 0)) * s
        case "zona": return ((zonaDe(a)?.nombre || "~").localeCompare(zonaDe(b)?.nombre || "~") || porFecha) * s
        case "estado": return ((ESTADO_LABEL[a.estado] || a.estado || "").localeCompare(ESTADO_LABEL[b.estado] || b.estado || "") || porFecha) * s
        case "viaje": return (((a.viajes?.fecha || "~") + (a.viajes?.nombre || "")).localeCompare((b.viajes?.fecha || "~") + (b.viajes?.nombre || "")) || porFecha) * s
        default: return ((a.prioridad || 3) - (b.prioridad || 3)) * (dir === "desc" ? 1 : -1) || porFecha
      }
    })
    .map((p) => ({ ...p, zona: zonaDe(p) }) as PedidoFila)

  // Opciones de los filtros: los vendedores y zonas que aparecen en lo cargado
  const opcionesVendedores = [...new Map(pedidos.filter(p => p.vendedor_id && p.vendedores?.nombre).map(p => [p.vendedor_id, { id: p.vendedor_id, nombre: p.vendedores!.nombre }])).values()]
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
  const opcionesZonas = [...new Map(pedidos.map(zonaDe).filter(Boolean).map(z => [z!.id, z!])).values()]
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  // ── Selección múltiple ─────────────────────────────────────────────
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const toggleSel = (id: string) => setSeleccion(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleTodos = () => setSeleccion(prev => pedidosLista.every(p => prev.has(p.id)) ? new Set() : new Set(pedidosLista.map(p => p.id)))
  // Solo cuenta lo que está a la vista (si un filtro oculta algo seleccionado, no se suma)
  const seleccionados = pedidosLista.filter(p => seleccion.has(p.id))
  const totalSel = seleccionados.reduce((s, p) => s + (p.total || 0), 0)
  const bultosSel = seleccionados.reduce((s, p) => s + (p.bultos || 0), 0)
  const totalLista = pedidosLista.reduce((s, p) => s + (p.total || 0), 0)

  // ── Calendario de viajes (semana o mes, en la URL: ?cal=mes&dia=2026-10-07) ──
  const calModo: "semana" | "mes" = url.get("cal") === "mes" ? "mes" : "semana"
  const calDia = /^\d{4}-\d{2}-\d{2}$/.test(url.get("dia")) ? url.get("dia") : hoy
  const calVisible = url.get("calendario") !== "no"
  const celdasCal = calModo === "semana"
    ? celdasSemana(calDia)
    : celdasMes(Number(calDia.slice(0, 4)), Number(calDia.slice(5, 7)) - 1)
  const diasCal = celdasCal.filter(Boolean) as string[]
  const { viajes: viajesCal, moverViaje, recargar: recargarViajesCal } = useViajesRango(diasCal[0], diasCal[diasCal.length - 1])
  const moverCal = (delta: number) => {
    let nuevo: string
    if (calModo === "semana") nuevo = sumarDias(calDia, 7 * delta)
    else {
      const d = new Date(Number(calDia.slice(0, 4)), Number(calDia.slice(5, 7)) - 1 + delta, 1)
      nuevo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
    }
    url.set({ dia: nuevo }, "replace", { dia: hoy })
  }
  const MESES_NOMBRE = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
  const tituloCal = calModo === "semana"
    ? (() => {
        const a = diasCal[0], b = diasCal[6]
        const mesA = MESES_NOMBRE[Number(a.slice(5, 7)) - 1], mesB = MESES_NOMBRE[Number(b.slice(5, 7)) - 1]
        return mesA === mesB ? `${Number(a.slice(8))} al ${Number(b.slice(8))} de ${mesA}` : `${Number(a.slice(8))} de ${mesA} al ${Number(b.slice(8))} de ${mesB}`
      })()
    : `${MESES_NOMBRE[Number(calDia.slice(5, 7)) - 1]} ${calDia.slice(0, 4)}`

  // ── Programar viaje (desde el calendario o al soltar pedidos en un día) ──
  const [progAbierto, setProgAbierto] = useState(false)
  const [progFecha, setProgFecha] = useState("")
  const [progZonas, setProgZonas] = useState<string[]>([])
  const [progAviso, setProgAviso] = useState<React.ReactNode>(null)
  const progPedidosRef = useRef<string[]>([])
  const abrirProgramar = (fecha: string, zonaIds: string[] = [], pedidoIds: string[] = [], aviso: React.ReactNode = null) => {
    setProgFecha(fecha); setProgZonas(zonaIds); setProgAviso(aviso); progPedidosRef.current = pedidoIds; setProgAbierto(true)
  }

  // ── Confirmaciones (subir a un viaje de otra zona, usar un viaje existente) ──
  const [propuesta, setPropuesta] = useState<{ titulo: string; texto: React.ReactNode; boton: string; accion: () => void; boton2?: string; accion2?: () => void } | null>(null)

  // ── Subir pedidos a un viaje (misma API que la hoja de ruta y el panel) ──
  const subirPedidosAViaje = async (viajeId: string, viajeNombre: string, ids: string[]) => {
    const estadoDe = (id: string) => pedidos.find(p => p.id === id)?.estado ?? sueltosCal.find(s => s.id === id)?.estado
    const elegibles = ids.filter(id => puedeAsignarViaje(estadoDe(id)))
    const noElegibles = ids.length - elegibles.length
    if (!elegibles.length) {
      toast.error(ids.length === 1 ? "Ese pedido ya no se puede subir a un viaje." : "Ninguno de esos pedidos se puede subir a un viaje.")
      return
    }
    try {
      const res = await fetch(`/api/viajes/${viajeId}/pedidos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agregar: elegibles }),
      })
      const r = await res.json()
      if (!res.ok) throw new Error(r.error || "No se pudieron subir los pedidos")
      const rechazados: { motivo?: string }[] = Array.isArray(r.rechazados) ? r.rechazados : []
      const subidos = elegibles.length - rechazados.length
      if (subidos > 0) toast.success(`${subidos === 1 ? "1 pedido subido" : `${subidos} pedidos subidos`} a ${viajeNombre}`)
      if (rechazados.length) toast.error(`${rechazados.length} no se pudieron subir: ${rechazados[0]?.motivo || ""}`)
      if (noElegibles) toast.message(`${noElegibles} quedaron afuera porque ya salieron o están entregados.`)
      setSeleccion(new Set())
      await cargarPedidos(true)
      recargarViajesCal(true)
      cargarViajes()
    } catch (e: any) {
      toast.error(e?.message || "No se pudieron subir los pedidos")
    }
  }

  const arrastreRef = useRef<string[]>([])
  const zonasDeIds = (ids: string[]) => ids.map(id => { const p = pedidos.find(x => x.id === id); return p ? zonaDe(p) : (sueltosCal.find(s => s.id === id)?.zona ?? null) })

  const soltarEnViaje = (v: ViajeCal) => {
    const ids = arrastreRef.current
    if (!ids.length) return
    const zonasViaje = new Set(v.zonas.map(z => z.id))
    const deOtraZona = zonasDeIds(ids).filter(z => !z || !zonasViaje.has(z.id)).length
    const nombre = v.zonas.map(z => z.nombre).join(" + ") || v.nombre
    if (deOtraZona > 0 && zonasViaje.size > 0) {
      setPropuesta({
        titulo: "Hay pedidos de otra zona",
        texto: <>{deOtraZona === ids.length ? (ids.length === 1 ? "Ese pedido no es" : "Esos pedidos no son") : `${deOtraZona} de los ${ids.length} pedidos no son`} de las zonas del viaje <b>{nombre}</b>. ¿Subirlos igual?</>,
        boton: "Subirlos igual",
        accion: () => subirPedidosAViaje(v.id, nombre, ids),
      })
      return
    }
    subirPedidosAViaje(v.id, nombre, ids)
  }

  // ── Pedidos "sueltos": con fecha de entrega y todavía sin viaje ──
  const [sueltosCal, setSueltosCal] = useState<{ id: string; numero_pedido: string; estado: string; cliente: string; fecha_entrega: string; zona: { id: string; nombre: string } | null }[]>([])
  const cargarSueltos = async () => {
    const { data, error } = await supabase
      .from("pedidos")
      .select("id, numero_pedido, estado, fecha_entrega, clientes (nombre_razon_social, localidades (zonas (id, nombre)))")
      .is("viaje_id", null)
      .not("estado", "in", "(entregado,eliminado,rechazado)")
      .gte("fecha_entrega", diasCal[0])
      .lte("fecha_entrega", diasCal[diasCal.length - 1])
    if (error) return // sin la migración de fecha_entrega todavía: el calendario no muestra sueltos
    setSueltosCal((data || []).map((p: any) => ({ id: p.id, numero_pedido: p.numero_pedido, estado: p.estado, cliente: p.clientes?.nombre_razon_social || "Sin cliente", fecha_entrega: p.fecha_entrega, zona: p.clientes?.localidades?.zonas ?? null })))
  }
  useEffect(() => { cargarSueltos() }, [diasCal[0], diasCal[diasCal.length - 1]])
  cargarSueltosRef.current = cargarSueltos
  // Un chip por pedido suelto: cliente y zona chica abajo (ordenados por zona y cliente)
  const sueltosPorDia = (() => {
    const m = new Map<string, PedidoSuelto[]>()
    const orden = [...sueltosCal].sort((a, b) => (a.zona?.nombre || "").localeCompare(b.zona?.nombre || "") || a.cliente.localeCompare(b.cliente))
    for (const p of orden) {
      const lista = m.get(p.fecha_entrega) ?? []
      lista.push({ id: p.id, cliente: p.cliente, zona: p.zona?.nombre ?? null })
      m.set(p.fecha_entrega, lista)
    }
    return m
  })()
  const abrirSuelto = (id: string) => {
    const p = sueltosCal.find(x => x.id === id)
    if (p) { abiertoDesdeListaRef.current = true; cerrandoRef.current = false; url.set({ pedido: p.numero_pedido }, "push") }
  }

  /** Deja pedidos para un día sin viaje (fecha null = sacarles la fecha). */
  const setFechaEntrega = async (ids: string[], fecha: string | null) => {
    try {
      const res = await fetch("/api/pedidos/fecha-entrega", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_ids: ids, fecha }),
      })
      const r = await res.json()
      if (!res.ok) throw new Error(r.error || "No se pudo guardar la fecha de entrega")
      const cant = ids.length === 1 ? "El pedido" : `Los ${ids.length} pedidos`
      if (fecha) toast.success(`${cant} quedó para el ${Number(fecha.slice(8))}/${Number(fecha.slice(5, 7))}, sin viaje`.replace("quedó", ids.length === 1 ? "quedó" : "quedaron"))
      else toast.success(ids.length === 1 ? "Se sacó la fecha de entrega" : "Se sacaron las fechas de entrega")
      setSeleccion(new Set())
      await cargarPedidos(true)
      cargarSueltos()
    } catch (e: any) {
      toast.error(e?.message || "No se pudo guardar la fecha de entrega")
    }
  }

  const soltarEnDia = (dia: string) => {
    const ids = arrastreRef.current
    if (!ids.length) return
    const fechaTxt = `${Number(dia.slice(8))}/${Number(dia.slice(5, 7))}`
    const zonas = zonasDeIds(ids)
    const distintas = new Set(zonas.map(z => z?.id ?? "?"))
    // Zonas distintas (o sin zona): nunca se juntan solos en un viaje → quedan para ese día
    if (distintas.size > 1 || distintas.has("?")) { setFechaEntrega(ids, dia); return }
    const zona = zonas[0]!
    // Lo que ya hay ese día de la misma zona: un viaje, o pedidos sueltos
    const existente = viajesCal.find(v => v.zonas.some(z => z.id === zona.id) && viajeMovible(v.estado) &&
      dia >= String(v.fecha).slice(0, 10) && dia <= sumarDias(String(v.fecha).slice(0, 10), Math.max(1, v.dias) - 1))
    const sueltosMismaZona = sueltosCal.filter(p => p.fecha_entrega === dia && p.zona?.id === zona.id && !ids.includes(p.id)).map(p => p.id)
    const nuevos = ids.length === 1 ? "este pedido" : `estos ${ids.length} pedidos`

    if (existente) {
      const todos = [...ids, ...sueltosMismaZona]
      setPropuesta({
        titulo: `Ya hay un viaje a ${zona.nombre} el ${fechaTxt}`,
        texto: <>¿Subir {nuevos}{sueltosMismaZona.length ? <> (y {sueltosMismaZona.length === 1 ? "el otro suelto" : `los otros ${sueltosMismaZona.length} sueltos`} de ese día)</> : null} al viaje <b>{existente.nombre}</b>, o dejarlos para ese día sin viaje?</>,
        boton: "Subir al viaje",
        accion: () => subirPedidosAViaje(existente.id, existente.nombre, todos),
        boton2: "Dejarlos sin viaje",
        accion2: () => setFechaEntrega(ids, dia),
      })
      return
    }
    // Un solo pedido y nada más de esa zona ese día: queda suelto, sin preguntar
    if (ids.length === 1 && sueltosMismaZona.length === 0) { setFechaEntrega(ids, dia); return }
    // Dos o más de la misma zona ese día (entre los que soltás y los que ya estaban): ofrecer el viaje
    const todos = [...ids, ...sueltosMismaZona]
    setPropuesta({
      titulo: `${todos.length} pedidos de ${zona.nombre} para el ${fechaTxt}`,
      texto: <>{sueltosMismaZona.length ? <>Ese día ya {sueltosMismaZona.length === 1 ? "hay 1 pedido suelto" : `hay ${sueltosMismaZona.length} pedidos sueltos`} de <b>{zona.nombre}</b>. </> : null}¿Querés programar un viaje con los {todos.length} pedidos, o dejar {nuevos} para ese día sin viaje?</>,
      boton: "Programar viaje",
      accion: () => abrirProgramar(dia, [zona.id], todos, <>Al programarlo se le suben los {todos.length} pedidos de <b>{zona.nombre}</b>.</>),
      boton2: "Dejarlos sin viaje",
      accion2: () => setFechaEntrega(ids, dia),
    })
  }

  // Barra de selección → "Crear viaje" con los pedidos marcados
  const crearViajeConSeleccion = () => {
    const ids = seleccionados.map(p => p.id)
    const zonas = [...new Map(seleccionados.map(p => p.zona).filter(Boolean).map(z => [z!.id, z!])).values()]
    abrirProgramar("", zonas.map(z => z.id), ids, <>Se le van a subir {ids.length === 1 ? "el pedido seleccionado" : `los ${ids.length} pedidos seleccionados`}{zonas.length > 1 ? <> (son de {zonas.length} zonas: {zonas.map(z => z.nombre).join(", ")})</> : null}.</>)
  }

  const eliminarVarios = async (lista: PedidoFila[]) => {
    const elegibles = lista.filter(p => puedeEliminarPedido(p.estado))
    let ok = 0
    for (const p of elegibles) {
      try { await softDeletePedido(p.id); ok++ } catch (e: any) { console.error("Error eliminando pedido:", e) }
    }
    if (ok) toast.success(ok === 1 ? "1 pedido eliminado" : `${ok} pedidos eliminados`)
    if (ok < elegibles.length) toast.error(`${elegibles.length - ok} no se pudieron eliminar`)
    if (lista.length > elegibles.length) toast.message(`${lista.length - elegibles.length} no se pueden eliminar por su estado (ya facturados, en viaje o entregados).`)
    setSeleccion(new Set())
    await cargarPedidos(true)
    cargarSueltos()
  }
  const pedirEliminarSeleccion = () => {
    const elegibles = seleccionados.filter(p => puedeEliminarPedido(p.estado)).length
    setPropuesta({
      titulo: `¿Eliminar ${seleccionados.length === 1 ? "el pedido seleccionado" : `los ${seleccionados.length} pedidos seleccionados`}?`,
      texto: <>Se van a eliminar <b>{elegibles}</b>{elegibles !== seleccionados.length ? <> (los otros {seleccionados.length - elegibles} no se pueden por su estado)</> : null}. Quedan en la papelera 45 días (filtro "Eliminado"), igual que al eliminar uno por uno.</>,
      boton: "Eliminar",
      accion: () => eliminarVarios(seleccionados),
    })
  }

  const cambiarPrioridadVarios = async (ids: string[], prioridad: 1 | 2 | 3) => {
    let ok = 0
    for (const id of ids) if (await cambiarPrioridad(id, prioridad)) ok++
    if (ok) toast.success(`Prioridad actualizada en ${ok === 1 ? "1 pedido" : `${ok} pedidos`}`)
    if (ok < ids.length) toast.error(`${ids.length - ok} no se pudieron actualizar`)
  }

  const getEstadoBadge = (estado: string) => {
    const estadoConfig = ESTADOS_PEDIDO.find((e) => e.value === estado)
    return <Badge className={`${estadoConfig?.color} text-white`}>{estadoConfig?.label || estado}</Badge>
  }

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc")
    } else {
      setSortColumn(column)
      setSortDirection("asc")
    }
  }

  const getSortIcon = (column: string) => {
    if (sortColumn !== column) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />
    return sortDirection === "asc"
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />
  }

  const pedidosOrdenados = [...pedidosFiltrados].sort((a, b) => {
    const dir = sortDirection === "asc" ? 1 : -1
    switch (sortColumn) {
      case "numero_pedido":
        return (a.numero_pedido || "").localeCompare(b.numero_pedido || "") * dir
      case "fecha":
        return ((a.fecha || "").localeCompare(b.fecha || "")) * dir
      case "cliente":
        return ((a.clientes?.nombre_razon_social || "").localeCompare(b.clientes?.nombre_razon_social || "")) * dir
      case "vendedor":
        return ((a.vendedores?.nombre || "").localeCompare(b.vendedores?.nombre || "")) * dir
      case "estado":
        return (a.estado || "").localeCompare(b.estado || "") * dir
      case "total":
        return ((a.total || 0) - (b.total || 0)) * dir
      default:
        return 0
    }
  })

  // Solo los comprobantes vigentes (no anulados) blindan el pedido.
  // Un pedido con todos sus comprobantes anulados puede modificarse y re-facturarse.
  const tieneComprobantes = (pedidoId: string) => {
    // Solo los emitidos AL facturar el pedido (llevan pedido_id); sus NC/REV no
    // impiden volver a facturar si se anularon los comprobantes.
    return comprobantesGenerados[pedidoId]?.some((c: any) => !c.anulado_en && c.pedido_id === pedidoId) ?? false
  }

  const listaName = (id: string | null | undefined) =>
    listasPrecio.find(lp => lp.id === id)?.nombre || null

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    // SheetContent tiene data-slot="sheet-content"
    let el: HTMLElement | null = e.currentTarget as HTMLElement
    while (el && el.dataset.slot !== "sheet-content") el = el.parentElement
    const sheetEl = el as HTMLElement | null

    const applyWidth = (w: number) => {
      if (!sheetEl) return
      sheetEl.style.width = w + "px"
      sheetEl.style.maxWidth = "none"
    }

    const onMove = (ev: MouseEvent) => {
      applyWidth(Math.max(300, window.innerWidth - ev.clientX))
    }
    const onUp = (ev: MouseEvent) => {
      const w = Math.max(300, window.innerWidth - ev.clientX)
      applyWidth(w)
      setSheetWidth(w)
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const getListaDisplay = (pedido: Pedido): string => {
    const c = pedido.clientes as any
    // Effective segment lists: pedido-level override OR client-level
    const limpieza = pedido.lista_limpieza_pedido_id || c?.lista_limpieza_id || null
    const perf0    = pedido.lista_perf0_pedido_id    || c?.lista_perf0_id    || null
    const perfPlus = pedido.lista_perf_plus_pedido_id || c?.lista_perf_plus_id || null
    const segIds   = [limpieza, perf0, perfPlus].filter(Boolean) as string[]

    const generalId = pedido.lista_precio_pedido_id || c?.lista_precio_id || null
    const generalNombre = listaName(generalId) || "Sin lista"

    if (segIds.length === 0) return generalNombre

    const uniqueSegs = [...new Set(segIds)]
    if (uniqueSegs.length === 1) {
      const nombre = listaName(uniqueSegs[0]) || "?"
      return `${nombre} (por segmentos)`
    }
    return "VARIOS (por segmentos)"
  }

  const getMetodoDisplay = (pedido: Pedido): string => {
    const c = pedido.clientes as any
    return pedido.metodo_facturacion_pedido || c?.metodo_facturacion || "—"
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {/* ═══ ENCABEZADO ═══ */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azul-900 sm:text-3xl">Pedidos y viajes</h1>
          <p className="text-sm text-neutro-500">
            {cargando && pedidos.length === 0 ? "Cargando…" : <><b className="font-semibold text-azul-900 tabular-nums">{pedidosLista.length}</b> pedidos en la lista · <b className="font-semibold text-azul-900 tabular-nums">{formatCurrency(totalLista)}</b></>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="gap-2" onClick={() => setNuevoPedidoOpen(true)}>
            <Plus className="h-4 w-4" />
            Importar pedido
          </Button>
          <Button variant="outline" className="gap-2" asChild>
            <Link href="/clientes-pedidos/nuevo">
              <Plus className="h-4 w-4" />
              Mostrador
            </Link>
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => abrirProgramar("")}>
            <Truck className="h-4 w-4" />
            Programar viaje
          </Button>
        </div>
      </div>

      {/* ═══ CALENDARIO DE VIAJES ═══ */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-base font-bold text-azul-900 first-letter:uppercase">
            {calModo === "semana" ? "Semana del " : ""}{tituloCal}
          </h2>
          {calVisible && (
            <>
              <div className="inline-flex rounded-lg border bg-white p-0.5" role="group" aria-label="Vista del calendario">
                {(["semana", "mes"] as const).map(m => (
                  <button key={m} type="button" aria-pressed={calModo === m}
                    onClick={() => url.set({ cal: m }, "replace", { cal: "semana" })}
                    className={`rounded-md px-3 py-1 text-[13px] font-semibold ${calModo === m ? "bg-azul-600 text-white" : "text-neutro-600 hover:bg-neutro-100"}`}>
                    {m === "semana" ? "Semana" : "Mes"}
                  </button>
                ))}
              </div>
              <Button variant="outline" size="icon" onClick={() => moverCal(-1)} aria-label="Anterior"><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" onClick={() => url.set({ dia: null }, "replace")}>Hoy</Button>
              <Button variant="outline" size="icon" onClick={() => moverCal(1)} aria-label="Siguiente"><ChevronRight className="h-4 w-4" /></Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={() => url.set({ calendario: calVisible ? "no" : null }, "replace")}>
            {calVisible ? "Ocultar" : "Mostrar calendario"}
          </Button>
        </div>
        {calVisible && (
          <div className="overflow-x-auto">
            <div className="md:min-w-[640px]">
              <CalendarioViajes
                modo={calModo}
                celdas={celdasCal}
                viajes={viajesCal}
                hoy={hoy}
                onAbrirViaje={(id) => router.push(`/viajes/${id}`)}
                onProgramar={(dia) => abrirProgramar(dia)}
                onMoverViaje={moverViaje}
                onSoltarPedidosEnViaje={soltarEnViaje}
                onSoltarPedidosEnDia={soltarEnDia}
                sueltos={sueltosPorDia}
                onAbrirSuelto={abrirSuelto}
                onQuitarSuelto={(id) => setFechaEntrega([id], null)}
                onArrastrarSuelto={(id) => { arrastreRef.current = [id] }}
              />
            </div>
          </div>
        )}
        {calVisible && <p className="hidden text-xs text-neutro-400 md:block">Arrastrá pedidos de la lista a un viaje para subirlos, o a un día para dejarlos para esa fecha (con varios de la misma zona te ofrece armar el viaje).</p>}
      </section>

      {/* ═══ FILTROS ═══ */}
      <FiltrosPedidos
        f={filtros}
        set={setFiltros}
        vendedores={opcionesVendedores}
        zonas={opcionesZonas}
        hayFiltrosExtra={hayFiltrosExtra}
        onLimpiar={limpiarFiltros}
      />

      {/* ═══ PEDIDOS EN PROCESAMIENTO ═══ */}
      {queue.filter(q => q.status !== "done").length > 0 && (
        <div className="space-y-2">
          {queue.filter(q => q.status !== "done").map(item => (
            <div key={item.id} className="bg-white border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {item.status === "needs_review" && (
                  <AlertCircle className="h-4 w-4 text-orange-500 shrink-0" />
                )}
                {item.status === "error" && (
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                )}
                <div className="min-w-0">
                  <span className="text-sm font-medium">{item.clienteNombre}</span>
                  <span className="text-xs text-muted-foreground ml-2">{item.files.map(f => f.name).join(", ")}</span>
                  {item.status === "error" && item.error && (
                    <p className="text-xs text-destructive mt-0.5">{item.error}</p>
                  )}
                  {item.status === "processing" && (
                    <CargaProgreso compacto mensajes={MENSAJES.importarPedido} className="mt-1.5 max-w-sm" />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  item.status === "processing" ? "bg-blue-100 text-blue-700" :
                  item.status === "waiting" ? "bg-gray-100 text-gray-600" :
                  item.status === "needs_review" ? "bg-orange-100 text-orange-700" :
                  "bg-red-100 text-red-700"
                }`}>
                  {item.status === "processing" ? "Importando" :
                   item.status === "waiting" ? "En espera" :
                   item.status === "needs_review" ? "Revisar" : "Error"}
                </span>
                {item.status === "needs_review" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-50 gap-1"
                    onClick={() => setReviewingItem(item)}>
                    <Eye className="h-3 w-3" />Revisar
                  </Button>
                )}
                {item.status === "error" && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-blue-600" onClick={() => retryItem(item.id)}>
                    <RefreshCw className="h-3 w-3 mr-1" />Reintentar
                  </Button>
                )}
                {(item.status === "error" || item.status === "needs_review") && (
                  <button className="text-muted-foreground hover:text-foreground" onClick={() => removeFromQueue(item.id)}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {entregaParam && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ambar-300 bg-ambar-50 px-4 py-2 text-sm text-ambar-900">
          Pedidos sin viaje para el <b>{Number(entregaParam.slice(8))}/{Number(entregaParam.slice(5, 7))}</b>
          <button type="button" className="ml-auto font-semibold text-azul-600 hover:underline" onClick={() => url.set({ entrega: null, zona: null }, "push")}>Ver todos</button>
        </div>
      )}

      {/* ═══ LISTA DE PEDIDOS ═══ */}
      {cargando && pedidos.length === 0 ? (
        <CargaProgreso mensajes={MENSAJES.pedidos} />
      ) : pedidosLista.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white px-6 py-12 text-center">
          <p className="font-semibold text-azul-900">No hay pedidos con estos filtros</p>
          <p className="mt-1 text-sm text-neutro-500">Probá ampliar las fechas o elegir otros estados.</p>
          {hayFiltrosExtra && <Button variant="outline" className="mt-4" onClick={limpiarFiltros}>Volver a los filtros de siempre</Button>}
        </div>
      ) : (
        <TablaPedidos
          pedidos={pedidosLista}
          seleccion={seleccion}
          onToggle={toggleSel}
          onToggleTodos={toggleTodos}
          onAbrir={(p) => abrirPedido(p as unknown as Pedido)}
          onPrioridad={(p, n) => cambiarPrioridad(p.id, n)}
          onEliminar={(p) => setPedidoAEliminar(p as unknown as Pedido)}
          puedeEliminar={puedeEliminarPedido}
          estadoBadge={getEstadoBadge}
          picking={pickingStatus}
          orden={orden}
          dir={dir}
          onOrdenar={ordenar}
          onArrastrar={(ids) => { arrastreRef.current = ids }}
          onQuitarEntrega={(p) => setFechaEntrega([p.id], null)}
        />
      )}

      {/* ═══ BARRA DE SELECCIÓN ═══ */}
      {seleccionados.length > 0 && (
        <div className="sticky bottom-3 z-30 mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-azul-900 px-4 py-3 text-white shadow-[0_18px_40px_-12px_rgba(23,26,69,0.6)]">
          <div className="mr-auto">
            <div className="text-sm font-semibold tabular-nums">
              {seleccionados.length === 1 ? "1 pedido" : `${seleccionados.length} pedidos`} · {formatCurrency(totalSel)}
            </div>
            {bultosSel > 0 && <div className="text-xs text-azul-200 tabular-nums">{bultosSel} bultos</div>}
          </div>
          <Select value="" onValueChange={(viajeId) => {
            const v = viajes.find(x => x.id === viajeId)
            if (v) subirPedidosAViaje(v.id, v.nombre, seleccionados.map(p => p.id))
          }}>
            <SelectTrigger className="h-9 w-auto min-w-44 border-white/20 bg-white/10 text-white data-[placeholder]:text-white [&_svg:not([class*='text-'])]:text-white">
              <SelectValue placeholder="Subir a un viaje…" />
            </SelectTrigger>
            <SelectContent>
              {viajes.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No hay viajes programados</div>}
              {viajes.map(v => (
                <SelectItem key={v.id} value={v.id}>{v.nombre} · {formatDateAR(v.fecha)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="secondary" className="h-9 bg-white text-azul-900 hover:bg-azul-50" onClick={crearViajeConSeleccion}>
            <Truck className="h-4 w-4" /> Crear viaje
          </Button>
          <Select value="" onValueChange={(v) => cambiarPrioridadVarios(seleccionados.map(p => p.id), Number(v) as 1 | 2 | 3)}>
            <SelectTrigger className="h-9 w-auto min-w-36 border-white/20 bg-white/10 text-white data-[placeholder]:text-white [&_svg:not([class*='text-'])]:text-white">
              <SelectValue placeholder="Prioridad…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Urgente</SelectItem>
              <SelectItem value="2">Alta</SelectItem>
              <SelectItem value="3">Normal</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setSeleccion(new Set())}>
            Quitar selección
          </Button>
          <Button size="icon" variant="ghost" className="h-9 w-9 text-error-200 hover:bg-error-500 hover:text-white" onClick={pedirEliminarSeleccion}
            aria-label="Eliminar los pedidos seleccionados" title="Eliminar los pedidos seleccionados">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}

      <ProgramarViajeDialog
        open={progAbierto}
        onOpenChange={setProgAbierto}
        fechaInicial={progFecha}
        zonaIdsIniciales={progZonas}
        aviso={progAviso}
        onProgramado={async (v) => {
          const ids = progPedidosRef.current
          progPedidosRef.current = []
          if (ids.length) await subirPedidosAViaje(v.id, "el viaje nuevo", ids)
          else recargarViajesCal(true)
          cargarViajes()
        }}
      />

      <AlertDialog open={!!propuesta} onOpenChange={(o) => { if (!o) setPropuesta(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{propuesta?.titulo}</AlertDialogTitle>
            <AlertDialogDescription>{propuesta?.texto}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {propuesta?.boton2 && (
              <Button variant="outline" onClick={() => { const a = propuesta?.accion2; setPropuesta(null); a?.() }}>{propuesta.boton2}</Button>
            )}
            <AlertDialogAction onClick={() => { const a = propuesta?.accion; setPropuesta(null); a?.() }}>{propuesta?.boton}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet
        open={modalDetalleAbierto}
        onOpenChange={(open) => {
          if (open) setModalDetalleAbierto(true)
          else cerrarPedido()
          if (!open) {
            setTimeout(() => {
              document.body.style.pointerEvents = '';
            }, 100);
          }
        }}
      >
        <SheetContent side="right" className="max-w-none p-0 flex flex-col overflow-hidden" style={{ width: sheetWidth, maxWidth: "none" }}>
          {/* Resize handle — arrastrar para cambiar el ancho */}
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-50 group"
            onMouseDown={handleResizeStart}
          >
            <div className="absolute inset-y-0 left-0.5 w-0.5 bg-transparent group-hover:bg-indigo-400/50 transition-colors" />
          </div>

          {/* ── Gradient header ── */}
          {pedidoSeleccionado ? (
            <div className="bg-gradient-to-br from-slate-800 via-slate-700 to-slate-800 text-white pt-12 pb-5 px-6 pr-14 shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <SheetTitle className="text-white text-2xl font-bold">Pedido #{pedidoSeleccionado.numero_pedido}</SheetTitle>
                  <SheetDescription className="text-white/60 text-sm mt-0.5">
                    {formatDateAR(pedidoSeleccionado.fecha)} · {pedidoSeleccionado.clientes?.nombre_razon_social}
                  </SheetDescription>
                </div>
                <div className="shrink-0 mt-1">{getEstadoBadge(pedidoSeleccionado.estado)}</div>
              </div>

              {/* Stats */}
              <div className="flex gap-2 mt-5">
                <div className="bg-white/10 rounded-xl px-3 py-2.5 backdrop-blur-sm flex-1 min-w-0">
                  <p className="text-white/50 text-[10px] uppercase tracking-wide font-semibold">Total</p>
                  <p className="text-lg font-bold text-white mt-0.5 truncate">${pedidoSeleccionado.total?.toLocaleString("es-AR", { maximumFractionDigits: 0 })}</p>
                </div>
                <div className="bg-white/10 rounded-xl px-3 py-2.5 backdrop-blur-sm min-w-[70px] text-center">
                  <p className="text-white/50 text-[10px] uppercase tracking-wide font-semibold">Arts.</p>
                  <p className="text-lg font-bold text-white mt-0.5">{detallesPedido.length}</p>
                </div>
                <div className="bg-white/10 rounded-xl px-3 py-2.5 backdrop-blur-sm min-w-0 max-w-[110px]">
                  <p className="text-white/50 text-[10px] uppercase tracking-wide font-semibold">Entrega</p>
                  <p className="text-xs font-semibold text-white mt-1 truncate">
                    {pedidoSeleccionado.condicion_entrega === "entregamos_nosotros" ? "Nosotros" :
                     pedidoSeleccionado.condicion_entrega === "retira_mostrador" ? "Mostrador" : "Transporte"}
                  </p>
                </div>
              </div>

              {/* Action buttons — 2 columnas */}
              <div className="grid grid-cols-2 gap-2 mt-4">
                {!tieneComprobantes(pedidoSeleccionado.id) ? (
                  <Button size="sm" onClick={() => generarComprobantes(pedidoSeleccionado.id)}
                    disabled={generandoComprobante === pedidoSeleccionado.id}
                    className="bg-white text-slate-800 hover:bg-slate-100 font-semibold shadow-sm">
                    {generandoComprobante === pedidoSeleccionado.id
                      ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Generando</>
                      : <><Receipt className="h-3.5 w-3.5 mr-1.5" />Generar</>}
                  </Button>
                ) : (
                  // Ya tiene comprobantes: acceso directo al PDF del primero vigente
                  <Button size="sm"
                    onClick={() => verComprobantesPedido(pedidoSeleccionado.id)}
                    className="bg-emerald-500 text-white hover:bg-emerald-600 font-semibold shadow-sm">
                    <Receipt className="h-3.5 w-3.5 mr-1.5" />Ver comprobantes
                  </Button>
                )}
                <Button size="sm" onClick={() => window.open(`/api/comprobantes-venta/preview?pedido_id=${pedidoSeleccionado.id}`, "_blank")}
                  className="bg-transparent border border-white/40 text-white hover:bg-white/15 font-medium">
                  <FileText className="h-3.5 w-3.5 mr-1.5" />Vista previa
                </Button>
                <Button size="sm" onClick={() => imprimirPedido(pedidoSeleccionado)}
                  className="bg-transparent border border-white/40 text-white hover:bg-white/15 font-medium">
                  <Printer className="h-3.5 w-3.5 mr-1.5" />Imprimir
                </Button>
                {!tieneComprobantes(pedidoSeleccionado.id) && pedidoSeleccionado.estado !== "eliminado" && (
                  <Button size="sm" onClick={() => repreciarPedidoActual(pedidoSeleccionado)}
                    disabled={repreciando === pedidoSeleccionado.id}
                    title="Recalcula el pedido con los precios de hoy, manteniendo sus condiciones"
                    className="bg-transparent border border-amber-300/70 text-amber-100 hover:bg-amber-400/20 font-medium">
                    {repreciando === pedidoSeleccionado.id
                      ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Repreciando</>
                      : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Repreciar</>}
                  </Button>
                )}
                <Link href={`/pagos-clientes?cliente_id=${pedidoSeleccionado.cliente_id}&pedido_id=${pedidoSeleccionado.id}`} className="contents">
                  <Button size="sm" className="bg-emerald-500 text-white hover:bg-emerald-600 font-semibold shadow-sm">
                    <DollarSign className="h-3.5 w-3.5 mr-1.5" />Registrar pago
                  </Button>
                </Link>
                <Link href={`/clientes-pedidos/${pedidoSeleccionado.id}`} className="contents">
                  <Button size="sm" className="bg-transparent border border-white/40 text-white hover:bg-white/15 font-medium">
                    <FileText className="h-3.5 w-3.5 mr-1.5" />Editar pedido
                  </Button>
                </Link>
                {puedeEliminarPedido(pedidoSeleccionado.estado) ? (
                  <Button size="sm" variant="outline"
                    onClick={() => { cerrarPedido(); setPedidoAEliminar(pedidoSeleccionado) }}
                    className="border-red-400/50 text-red-300 hover:bg-red-500/20">
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />Eliminar
                  </Button>
                ) : <div />}
              </div>
            </div>
          ) : (
            <div className="pt-12 pb-4 px-6 shrink-0">
              <SheetTitle>Detalle del Pedido</SheetTitle>
              <SheetDescription>Cargando...</SheetDescription>
            </div>
          )}

          {/* ── Scrollable body ── */}
          {pedidoSeleccionado && (
            <div className="flex-1 overflow-y-auto p-5 space-y-4">

              {/* Cliente + Facturación */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                  <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-2">Cliente</p>
                  <p className="font-bold text-slate-800">{pedidoSeleccionado.clientes?.nombre_razon_social}</p>
                  {pedidoSeleccionado.clientes?.direccion && (
                    <p className="text-xs text-slate-500 mt-1">{pedidoSeleccionado.clientes.direccion}</p>
                  )}
                  {pedidoSeleccionado.clientes?.localidad && (
                    <p className="text-xs text-slate-500">{pedidoSeleccionado.clientes.localidad}</p>
                  )}
                  {pedidoSeleccionado.vendedores?.nombre && (
                    <p className="text-xs text-blue-600 mt-2 font-semibold">👤 {pedidoSeleccionado.vendedores.nombre}</p>
                  )}
                </div>

                <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                  <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-2">Facturación y Precios</p>
                  <p className="font-bold text-slate-800 text-sm">{getMetodoDisplay(pedidoSeleccionado)}</p>
                  <p className="text-xs text-slate-700 mt-1.5 font-semibold">{getListaDisplay(pedidoSeleccionado)}</p>
                  {/* Descuentos efectivos: por segmento (ficha + "solo este pedido") y condiciones aparte */}
                  {descPedido && (() => {
                    const conDesc = descPedido.segs.filter(s => s.lineas.length > 0)
                    if (conDesc.length === 0 && descPedido.aparte.length === 0) return null
                    return (
                      <div className="mt-2 space-y-0.5">
                        {conDesc.map(s => (
                          <p key={s.key} className="text-xs text-orange-700 font-bold">
                            <span className="text-[10px] text-amber-600 font-semibold uppercase mr-1">{s.label}:</span>{s.lineas.join(" · ")}
                          </p>
                        ))}
                        {descPedido.aparte.map((a, i) => (
                          <p key={`ap-${i}`} className="text-xs text-teal-700 font-bold">
                            <span className="text-[10px] text-teal-600 font-semibold uppercase mr-1">Aparte · {a.nombre}:</span>{a.texto}
                          </p>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              </div>

              {/* Estado y Logística */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Estado y Logística</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-slate-500 mb-1.5">Cambiar estado</p>
                    {/* Solo transiciones del flujo (lib/pedidos/estados.ts); sin opciones = final o lo mueve otro proceso */}
                    {(() => {
                      const opciones = [pedidoSeleccionado.estado, ...transicionesManuales(pedidoSeleccionado.estado)]
                      return (
                        <Select value={pedidoSeleccionado.estado} onValueChange={(value) => cambiarEstadoPedido(pedidoSeleccionado.id, value)} disabled={opciones.length <= 1}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {opciones.map((e) => (
                              <SelectItem key={e} value={e}>{ESTADO_LABEL[e] || e}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )
                    })()}
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1.5">Viaje</p>
                    {pedidoSeleccionado.viajes ? (
                      <div className="bg-purple-50 rounded-lg px-3 py-2 border border-purple-100">
                        <p className="text-sm font-semibold text-purple-700">🚚 {pedidoSeleccionado.viajes.nombre}</p>
                        <p className="text-xs text-purple-500">{formatDateAR(pedidoSeleccionado.viajes.fecha)}</p>
                      </div>
                    ) : !puedeAsignarViaje(pedidoSeleccionado.estado) ? (
                      <p className="text-xs text-slate-400 italic px-1 py-2">Ya salió o está cerrado: no se asigna a un viaje</p>
                    ) : (
                      <div className="flex gap-1.5">
                        <Select value={viajeAsignado} onValueChange={setViajeAsignado}>
                          <SelectTrigger className="h-9 text-sm flex-1"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                          <SelectContent>
                            {viajes.map((viaje) => (
                              <SelectItem key={viaje.id} value={viaje.id}>
                                {viaje.nombre} ({new Date(viaje.fecha).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" className="h-9 px-3" onClick={() => asignarViaje(pedidoSeleccionado.id, viajeAsignado)} disabled={!viajeAsignado}>
                          <Truck className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Quién lo preparó (registro por renglón en depósito) */}
              {preparadoresPedido.length > 0 && (
                <div className="bg-indigo-50 rounded-xl px-4 py-3 border border-indigo-100">
                  <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1.5">Preparó</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {preparadoresPedido.map((pr, i) => {
                      const hora = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }) : ""
                      const fecha = pr.desde ? formatDateAR(pr.desde) : ""
                      return (
                        <p key={i} className="text-sm text-indigo-900">
                          <span className="font-bold">👤 {pr.nombre}</span>
                          <span className="text-indigo-600 text-xs"> · {pr.renglones} renglón{pr.renglones !== 1 ? "es" : ""}{fecha ? ` · ${fecha} ${hora(pr.desde)}${pr.hasta && pr.hasta !== pr.desde ? `–${hora(pr.hasta)}` : ""}` : ""}</span>
                        </p>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Comprobantes */}
              {comprobantesGenerados[pedidoSeleccionado.id]?.length > 0 && (
                <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200">
                  <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-3">Comprobantes generados</p>
                  <div className="flex flex-wrap gap-2">
                    {comprobantesGenerados[pedidoSeleccionado.id].map((comp) => (
                      <Button key={comp.id} size="sm" onClick={() => verComprobante(comp.id)}
                        className={comp.anulado_en
                          ? "bg-slate-400 hover:bg-slate-500 text-white text-xs h-8 shadow-sm line-through"
                          : "bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 shadow-sm"}>
                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                        {getTipoComprobanteLabel(comp.tipo_comprobante)} {comp.numero_comprobante}{comp.anulado_en ? " (Anulado)" : ""}
                        <ExternalLink className="h-3 w-3 ml-1.5 opacity-70" />
                      </Button>
                    ))}
                    {remitosGenerados[pedidoSeleccionado.id]?.map((rem) => (
                      <Button key={rem.id} size="sm" onClick={() => verRemito(rem.id)}
                        disabled={rem.estado_pdf !== "generado"}
                        className={rem.estado === "anulado"
                          ? "bg-slate-400 hover:bg-slate-500 text-white text-xs h-8 shadow-sm line-through"
                          : "bg-sky-700 hover:bg-sky-800 text-white text-xs h-8 shadow-sm"}>
                        <Truck className="h-3.5 w-3.5 mr-1.5" />
                        Remito {rem.tipo_remito === "REM" ? "R" : "X"} {rem.numero_remito}
                        {rem.estado === "anulado" ? " (Anulado)" : rem.estado_pdf !== "generado" ? " (PDF pendiente)" : ""}
                        <ExternalLink className="h-3 w-3 ml-1.5 opacity-70" />
                      </Button>
                    ))}
                    {/* Reintento/backfill: hay comprobantes vigentes pero ningún remito activo.
                        El endpoint decide si corresponde (mostrador → lo omite). */}
                    {comprobantesGenerados[pedidoSeleccionado.id].some((c) => !c.anulado_en && ["FA", "FB", "PRES"].includes(c.tipo_comprobante)) &&
                      !remitosGenerados[pedidoSeleccionado.id]?.some((r) => r.estado === "activo") &&
                      pedidoSeleccionado.condicion_entrega !== "retira_mostrador" && (
                      <Button size="sm" variant="outline" disabled={generandoRemitos}
                        onClick={() => generarRemitos(pedidoSeleccionado.id)}
                        className="text-xs h-8 border-sky-700 text-sky-700 hover:bg-sky-50">
                        <Truck className="h-3.5 w-3.5 mr-1.5" />
                        {generandoRemitos ? "Generando..." : "Generar remitos"}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Artículos */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Artículos del pedido · <span className="text-slate-600">{detallesPedido.length}</span>
                  </p>
                  <Link href={`/clientes-pedidos/${pedidoSeleccionado.id}`}>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-slate-300">
                      <Plus className="h-3 w-3" />Agregar / Editar
                    </Button>
                  </Link>
                </div>
                {detallesPedido.length > 0 ? (
                  <div className="border rounded-xl overflow-hidden">
                    <div className="divide-y max-h-[280px] overflow-y-auto">
                      {detallesPedido.map((d) => (
                        <div key={d.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors">
                          <div className={`w-1.5 h-7 rounded-full shrink-0 ${
                            d.estado_item === "COMPLETO" ? "bg-green-500" :
                            d.estado_item === "FALTANTE" ? "bg-red-500" :
                            d.estado_item === "PARCIAL" ? "bg-orange-500" : "bg-yellow-400"
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700 truncate">{d.articulos?.descripcion}</p>
                            <p className="text-[10px] text-slate-400 font-mono">{d.articulos?.sku} · {d.articulos?.proveedores?.nombre || "—"}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-sm font-bold text-slate-700">{d.cantidad} u.</span>
                            <span className="text-[10px] text-slate-400 block">${d.precio_final?.toLocaleString("es-AR", { maximumFractionDigits: 0 })}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic text-center py-4 bg-slate-50 rounded-xl border border-dashed">
                    Sin artículos cargados
                  </p>
                )}
              </div>

              {/* Totales */}
              <div className="bg-slate-800 rounded-xl p-4 text-white">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-3">Resumen de totales</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-white/70">
                    <span>Subtotal</span>
                    <span>${pedidoSeleccionado.subtotal?.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>
                  </div>
                  {(pedidoSeleccionado.descuento_general || 0) > 0 && (
                    <div className="flex justify-between text-red-300">
                      <span>Descuento</span>
                      <span>−${pedidoSeleccionado.descuento_general?.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {(pedidoSeleccionado.total_flete || 0) > 0 && (
                    <div className="flex justify-between text-white/60">
                      <span>Flete</span>
                      <span>${pedidoSeleccionado.total_flete?.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {(pedidoSeleccionado.total_comision || 0) > 0 && (
                    <div className="flex justify-between text-white/60">
                      <span>Comisión</span>
                      <span>${pedidoSeleccionado.total_comision?.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {(pedidoSeleccionado.total_impuestos || 0) > 0 && (
                    <div className="flex justify-between text-white/60">
                      <span>Impuestos</span>
                      <span>${pedidoSeleccionado.total_impuestos?.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-lg pt-2 border-t border-white/20">
                    <span>TOTAL</span>
                    <span>${pedidoSeleccionado.total?.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              {/* Observaciones + Email */}
              {pedidoSeleccionado.observaciones && (
                <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Observaciones</p>
                  <p className="text-xs text-slate-600 leading-relaxed">{pedidoSeleccionado.observaciones.substring(0, 200)}{pedidoSeleccionado.observaciones.length > 200 ? "..." : ""}</p>
                  {pedidoSeleccionado.observaciones.includes("Gmail") && (
                    <Button size="sm" variant="outline" className="mt-2 h-7 text-xs gap-1.5"
                      onClick={async () => {
                        const obs = pedidoSeleccionado.observaciones || ""
                        const deMatch = obs.match(/De:\s*(\S+)/)
                        const asuntoMatch = obs.match(/Asunto:\s*"([^"]+)"/)
                        if (deMatch || asuntoMatch) {
                          const { data } = await supabase.from("ai_emails").select("id")
                            .or([
                              deMatch ? `from_email.ilike.%${deMatch[1]}%` : null,
                              asuntoMatch ? `subject.ilike.%${asuntoMatch[1].substring(0, 30)}%` : null,
                            ].filter(Boolean).join(","))
                            .order("created_at", { ascending: false }).limit(1).maybeSingle()
                          if (data?.id) setPreviewEmailId(data.id)
                        }
                      }}>
                      <Eye className="h-3 w-3" />Ver email original
                    </Button>
                  )}
                </div>
              )}

            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!pedidoAEliminar} onOpenChange={(open) => !open && setPedidoAEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar pedido {pedidoAEliminar?.numero_pedido}?</AlertDialogTitle>
            <AlertDialogDescription>
              El pedido de <strong>{pedidoAEliminar?.clientes?.nombre_razon_social}</strong> por{" "}
              <strong>${pedidoAEliminar?.total?.toFixed(2)}</strong> será marcado como eliminado.
              Permanecerá eliminado por 45 días, después de los cuales se borrará permanentemente del sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={eliminando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSoftDelete}
              disabled={eliminando}
              className="bg-red-600 hover:bg-red-700"
            >
              {eliminando ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EmailPreviewModal
        emailId={previewEmailId}
        open={!!previewEmailId}
        onClose={() => setPreviewEmailId(null)}
      />

      <NuevoPedidoDialog
        open={nuevoPedidoOpen}
        onOpenChange={setNuevoPedidoOpen}
        onAddToQueue={addToQueue}
      />

      {reviewingItem && reviewingItem.parseResult && (
        <ReviewPedidoDialog
          open={true}
          onOpenChange={(open) => { if (!open) setReviewingItem(null) }}
          queueItemId={reviewingItem.id}
          clienteId={reviewingItem.clienteId}
          clienteNombre={reviewingItem.clienteNombre}
          parseResult={reviewingItem.parseResult}
          onConfirm={async (itemId, items, clienteId) => {
            await confirmOrder(itemId, items, clienteId)
            setReviewingItem(null)
          }}
        />
      )}
    </div>
  )
}


