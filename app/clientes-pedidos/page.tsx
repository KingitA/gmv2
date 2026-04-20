"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { formatDateAR } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Search,
  Truck,
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
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { EmailPreviewModal } from "@/components/ai/EmailPreviewModal"
import { NuevoPedidoDialog } from "@/components/pedidos/NuevoPedidoDialog"
import { ColaProcesamiento } from "@/components/pedidos/ColaProcesamiento"
import { useOrderQueue } from "@/hooks/use-order-queue"
import { agregarItemPedido, actualizarCantidadItem, eliminarItemPedido } from "@/lib/actions/pedidos"
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
}

const ESTADOS_PEDIDO = [
  { value: "pendiente", label: "Pendiente", color: "bg-yellow-500" },
  { value: "en_preparacion", label: "En Preparación", color: "bg-blue-500" },
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
  const [busqueda, setBusqueda] = useState("")
  const [filtroEstado, setFiltroEstado] = useState<string>("todos")
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState<Pedido | null>(null)
  const [detallesPedido, setDetallesPedido] = useState<PedidoDetalle[]>([])
  const [viajeAsignado, setViajeAsignado] = useState<string>("")
  const [cargando, setCargando] = useState(true)
  const [sortColumn, setSortColumn] = useState<string>("numero_pedido")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")
  const [guardandoCambios, setGuardandoCambios] = useState(false)
  const [generandoComprobante, setGenerandoComprobante] = useState<string | null>(null)
  const [comprobantesGenerados, setComprobantesGenerados] = useState<{ [pedidoId: string]: Comprobante[] }>({})
  const [modalDetalleAbierto, setModalDetalleAbierto] = useState(false)
  const [pedidoAEliminar, setPedidoAEliminar] = useState<Pedido | null>(null)
  const [eliminando, setEliminando] = useState(false)
  const [pickingStatus, setPickingStatus] = useState<Record<string, any>>({})
  const [expandedPriorities, setExpandedPriorities] = useState<Record<string, boolean>>({ "1": true, "2": true, "3": true })
  const [dragPedidoId, setDragPedidoId] = useState<string | null>(null)
  const [expandedArticulosGroups, setExpandedArticulosGroups] = useState<Record<string, boolean>>({ pendientes: true, preparados: true, faltantes: false })
  const [previewEmailId, setPreviewEmailId] = useState<string | null>(null)
  const [nuevoPedidoOpen, setNuevoPedidoOpen] = useState(false)
  // Order editing state
  const [editMode, setEditMode] = useState(false)
  const [addProductQuery, setAddProductQuery] = useState("")
  const [addProductsFound, setAddProductsFound] = useState<any[]>([])
  const [addProductQty, setAddProductQty] = useState(1)
  const [savingItem, setSavingItem] = useState(false)

  const supabase = createClient()
  const searchParams = useSearchParams()

  // Si viene ?pedido=000055 desde el dashboard, auto-buscar ese pedido
  useEffect(() => {
    const pedidoParam = searchParams.get('pedido')
    if (pedidoParam) {
      setBusqueda(pedidoParam)
    }
  }, [searchParams])

  useEffect(() => {
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

  useEffect(() => {
    cargarPedidos()
  }, [filtroEstado])

  useEffect(() => {
    if (pedidos.length > 0) {
      cargarComprobantesExistentes()
    }
  }, [pedidos])

  const cargarPedidos = async () => {
    try {
      setCargando(true)
      let query = supabase
        .from("pedidos")
        .select(`
          *,
          clientes (nombre_razon_social, cuit, codigo_cliente, direccion, localidad, metodo_facturacion, lista_precio_id, lista_limpieza_id, metodo_limpieza, lista_perf0_id, metodo_perf0, lista_perf_plus_id, metodo_perf_plus, listas_precio:lista_precio_id (nombre)),
          vendedores (nombre),
          viajes (nombre, fecha)
        `)

      // Only show eliminated orders when explicitly filtered
      if (filtroEstado !== "eliminado") {
        query = query.neq("estado", "eliminado")
      }

      query = query
        .order("prioridad", { ascending: true })
        .order("fecha", { ascending: false })

      const { data, error } = await query

      if (error) throw error
      setPedidos(data || [])
    } catch (error) {
      console.error("Error cargando pedidos:", JSON.stringify(error, null, 2))
    } finally {
      setCargando(false)
    }
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { queue, addToQueue, removeFromQueue, confirmOrder, retryItem } = useOrderQueue(cargarPedidos)

  const cargarComprobantesExistentes = async () => {
    try {
      const pedidoIds = pedidos.map((p) => p.id)
      const { data, error } = await supabase
        .from("comprobantes_venta")
        .select("id, tipo_comprobante, numero_comprobante, total_factura, pedido_id")
        .in("pedido_id", pedidoIds)

      if (error) throw error

      // Agrupar comprobantes por pedido_id
      const comprobantesAgrupados: { [pedidoId: string]: Comprobante[] } = {}
      data?.forEach((comp: any) => {
        if (!comprobantesAgrupados[comp.pedido_id]) {
          comprobantesAgrupados[comp.pedido_id] = []
        }
        comprobantesAgrupados[comp.pedido_id].push(comp)
      })
      setComprobantesGenerados(comprobantesAgrupados)
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
      }
    } catch (e) { console.error("Error cambiando prioridad:", e) }
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
        .in("estado", ["pendiente", "en_curso"])
        .order("fecha", { ascending: true })

      if (error) throw error
      setViajes(data || [])
    } catch (error) {
      console.error("Error cargando viajes:", error)
    }
  }

  const cargarDetallesPedido = async (pedidoId: string) => {
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
            proveedores:proveedor_id (nombre)
          )
        `)
        .eq("pedido_id", pedidoId)

      if (error) throw error
      setDetallesPedido(data || [])
    } catch (error) {
      console.error("Error cargando detalles del pedido:", error)
    }
  }

  const cambiarEstadoPedido = async (pedidoId: string, nuevoEstado: string) => {
    try {
      const { error } = await supabase.from("pedidos").update({ estado: nuevoEstado }).eq("id", pedidoId)

      if (error) throw error

      await cargarPedidos()
      if (pedidoSeleccionado?.id === pedidoId) {
        setPedidoSeleccionado({ ...pedidoSeleccionado, estado: nuevoEstado })
      }
    } catch (error) {
      console.error("Error cambiando estado:", error)
    }
  }

  const asignarViaje = async (pedidoId: string, viajeId: string) => {
    try {
      const { error } = await supabase
        .from("pedidos")
        .update({ viaje_id: viajeId, estado: "en_viaje" })
        .eq("id", pedidoId)

      if (error) throw error

      await cargarPedidos()
      setViajeAsignado("")
    } catch (error) {
      console.error("Error asignando viaje:", error)
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
    } catch (error: any) {
      console.error("Error generando comprobantes:", error)
      alert(error.message || "Error al generar comprobantes")
    } finally {
      setGenerandoComprobante(null)
    }
  }

  const verComprobante = (comprobanteId: string) => {
    window.open(`/api/comprobantes-venta/${comprobanteId}/imagen`, "_blank")
  }

  const imprimirPedido = async (pedido: Pedido) => {
    try {
      // Si no tenemos los detalles, los cargamos
      let detalles = detallesPedido
      if (!pedidoSeleccionado || pedidoSeleccionado.id !== pedido.id) {
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
            proveedores:proveedor_id (nombre)
          )
        `)
          .eq("pedido_id", pedido.id)

        if (error) throw error
        detalles = data || []
      }

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
                      { label: "Limpieza / Bazar", lista: (pedido as any).lista_limpieza_pedido_id || c?.lista_limpieza_id, metodo: (pedido as any).metodo_limpieza_pedido || c?.metodo_limpieza },
                      { label: "Perfumería Perf0", lista: (pedido as any).lista_perf0_pedido_id || c?.lista_perf0_id, metodo: (pedido as any).metodo_perf0_pedido || c?.metodo_perf0 },
                      { label: "Perfumería Plus", lista: (pedido as any).lista_perf_plus_pedido_id || c?.lista_perf_plus_id, metodo: (pedido as any).metodo_perf_plus_pedido || c?.metodo_perf_plus },
                    ].filter(s => s.lista || s.metodo)
                    return segRows.map(s => `
                      <div class="label">${s.label}</div>
                      <div class="value" style="margin-bottom: 6px;">${s.metodo || c?.metodo_facturacion || "—"}${s.lista ? ` — ${s.lista}` : ""}</div>
                    `).join('')
                  } else {
                    return `
                      <div class="label">Lista de Precios</div>
                      <div class="value">${c?.listas_precio?.nombre || "Sin lista"}</div>
                      <div class="label" style="margin-top: 8px;">Forma de Facturación</div>
                      <div class="value">${pedido.metodo_facturacion_pedido || pedido.clientes?.metodo_facturacion || "—"}</div>
                    `
                  }
                })()}
                <div class="label" style="margin-top: 8px;">Vendedor</div>
                <div class="value">${pedido.vendedores?.nombre || "Sin asignar"}</div>
                <div class="label" style="margin-top: 8px;">Estado</div>
                <div class="value">${pedido.estado.toUpperCase()}</div>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th width="120">Código</th>
                  <th>Descripción</th>
                  <th>Proveedor</th>
                  <th width="80" class="text-right">Cant.</th>
                </tr>
              </thead>
              <tbody>
                ${detallesOrdenados
          .map((d) => {
            const esPresupuesto = d.articulos?.iva_ventas?.toLowerCase() === "presupuesto"
            const bgCode = esPresupuesto ? "#000" : "transparent"
            const textCode = esPresupuesto ? "#fff" : "inherit"

            return `
                  <tr>
                    <td style="background-color: ${bgCode}; color: ${textCode}; font-weight: bold; padding-left: 8px;">${d.articulos?.sku || "-"}</td>
                    <td>${d.articulos?.descripcion || "Sin descripción"}</td>
                    <td style="color: #666; font-size: 11px;">
                      ${d.articulos?.proveedores?.nombre || "Sin proveedor"}
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
    } catch (error) {
      console.error("Error al preparar impresión:", error)
      alert("Error al preparar la impresión del pedido.")
    }
  }

  const handleSoftDelete = async () => {
    if (!pedidoAEliminar) return
    setEliminando(true)
    try {
      const { error } = await supabase
        .from("pedidos")
        .update({
          estado: "eliminado",
          eliminado_at: new Date().toISOString(),
        })
        .eq("id", pedidoAEliminar.id)

      if (error) throw error

      await cargarPedidos()
      setPedidoAEliminar(null)
    } catch (error) {
      console.error("Error eliminando pedido:", error)
      alert("Error al eliminar el pedido")
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

  const pedidosFiltrados = pedidos.filter((pedido) => {
    const coincideBusqueda =
      pedido.numero_pedido?.toLowerCase().includes(busqueda.toLowerCase()) ||
      pedido.clientes?.nombre_razon_social?.toLowerCase().includes(busqueda.toLowerCase()) ||
      pedido.clientes?.cuit?.includes(busqueda)

    const coincideEstado = filtroEstado === "todos" || pedido.estado === filtroEstado

    return coincideBusqueda && coincideEstado
  })

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

  const tieneComprobantes = (pedidoId: string) => {
    return comprobantesGenerados[pedidoId]?.length > 0
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Gestión de Pedidos</h1>
          <p className="text-muted-foreground">Administra todos los pedidos de clientes</p>
        </div>
        <div className="flex gap-2">
          <Button className="gap-2" onClick={() => setNuevoPedidoOpen(true)}>
            <Plus className="h-4 w-4" />
            Nuevo Pedido
          </Button>
          <Button variant="outline" asChild>
            <a href="/viajes">
              <Truck className="h-4 w-4 mr-2" />
              Ver Viajes
            </a>
          </Button>
          <Button asChild>
            <a href="/viajes/nuevo">
              <Truck className="h-4 w-4 mr-2" />
              Crear Viaje
            </a>
          </Button>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Buscar por número de pedido, cliente o CUIT..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filtroEstado} onValueChange={setFiltroEstado}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            {ESTADOS_PEDIDO.map((estado) => (
              <SelectItem key={estado.value} value={estado.value}>
                {estado.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ═══ COLA DE PROCESAMIENTO ═══ */}
      <ColaProcesamiento
        queue={queue}
        onRemove={removeFromQueue}
        onRetry={retryItem}
        onConfirmOrder={confirmOrder}
      />

      {/* ═══ ACORDEÓN POR PRIORIDAD ═══ */}
      <div className="space-y-4">
        {PRIORIDADES.map(prio => {
          const pedidosDeEstaPrioridad = pedidosFiltrados
            .filter(p => (p.prioridad || 3) === prio.nivel)
            .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""))
          const isExpanded = expandedPriorities[String(prio.nivel)] !== false
          const count = pedidosDeEstaPrioridad.length

          return (
            <div
              key={prio.nivel}
              className={`border rounded-xl overflow-hidden ${prio.bgLight}`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move" }}
              onDrop={async (e) => {
                e.preventDefault()
                if (dragPedidoId && prio.nivel) {
                  await cambiarPrioridad(dragPedidoId, prio.nivel)
                  setDragPedidoId(null)
                }
              }}
            >
              {/* Header del acordeón */}
              <button
                onClick={() => setExpandedPriorities(prev => ({ ...prev, [String(prio.nivel)]: !prev[String(prio.nivel)] }))}
                className="w-full flex items-center justify-between px-5 py-3 hover:opacity-80 transition-opacity"
              >
                <div className="flex items-center gap-3">
                  <span className="text-base font-bold">{prio.label}</span>
                  <Badge variant="secondary" className="text-xs">{count}</Badge>
                </div>
                <span className={`text-lg transition-transform ${isExpanded ? "rotate-180" : ""}`}>▾</span>
              </button>

              {/* Contenido */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2">
                  {count === 0 ? (
                    <div className="text-center py-6 text-sm text-muted-foreground opacity-60">
                      {dragPedidoId ? "Soltá acá para cambiar prioridad" : "Sin pedidos"}
                    </div>
                  ) : pedidosDeEstaPrioridad.map(pedido => {
                    const picking = pickingStatus[pedido.id]
                    return (
                      <div
                        key={pedido.id}
                        draggable
                        onDragStart={() => setDragPedidoId(pedido.id)}
                        onDragEnd={() => setDragPedidoId(null)}
                        onClick={() => {
                          setPedidoSeleccionado(pedido)
                          cargarDetallesPedido(pedido.id)
                          setModalDetalleAbierto(true)
                        }}
                        className={`bg-white border rounded-lg p-4 cursor-pointer hover:shadow-md hover:border-gray-300 transition-all
                          ${dragPedidoId === pedido.id ? "opacity-40" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* Línea 1: número + cliente */}
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-sm">{pedido.numero_pedido}</span>
                              <span className="text-xs text-muted-foreground">·</span>
                              <span className="text-sm font-medium truncate">{pedido.clientes?.nombre_razon_social}</span>
                              {pedido.clientes?.cuit && <span className="text-xs text-muted-foreground hidden lg:inline">{pedido.clientes.cuit}</span>}
                            </div>
                            {/* Línea 2: fecha + vendedor + estado */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-muted-foreground">{formatDateAR(pedido.fecha)}</span>
                              {pedido.vendedores?.nombre && (
                                <span className="text-xs text-muted-foreground">· {pedido.vendedores.nombre}</span>
                              )}
                              {getEstadoBadge(pedido.estado)}
                              {pedido.viajes?.nombre && (
                                <Badge variant="outline" className="text-xs">🚚 {pedido.viajes.nombre}</Badge>
                              )}
                            </div>
                            {/* Línea 3: picking info si alguien lo prepara */}
                            {picking && (
                              <div className="mt-2 flex items-center gap-3">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                  <span className="text-xs font-semibold text-green-700">
                                    Preparando: {picking.operario}
                                  </span>
                                </div>
                                <div className="flex-1 max-w-[200px]">
                                  <div className="bg-neutral-200 rounded-full h-1.5 overflow-hidden">
                                    <div
                                      className="h-full bg-green-500 rounded-full transition-all"
                                      style={{ width: `${picking.progreso.total > 0 ? Math.round(((picking.progreso.preparados + picking.progreso.faltantes) / picking.progreso.total) * 100) : 0}%` }}
                                    />
                                  </div>
                                </div>
                                <span className="text-[10px] text-muted-foreground">
                                  {picking.progreso.preparados}✓ {picking.progreso.faltantes > 0 ? `${picking.progreso.faltantes}✕ ` : ""}{picking.progreso.pendientes}⏳
                                </span>
                              </div>
                            )}
                          </div>
                          {/* Solo eliminar — sin 3 puntitos */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {pedido.total > 0 && (
                              <span className="text-sm font-bold text-gray-700">${pedido.total.toLocaleString("es-AR")}</span>
                            )}
                            {pedido.estado !== "eliminado" && (
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                                onClick={(e) => { e.stopPropagation(); setPedidoAEliminar(pedido) }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <Dialog
        open={modalDetalleAbierto}
        onOpenChange={(open) => {
          setModalDetalleAbierto(open);
          if (!open) {
            setTimeout(() => {
              document.body.style.pointerEvents = '';
            }, 100);
          }
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-[95vw] md:max-w-[95vw] w-full max-h-[95vh] overflow-y-auto">
          <DialogHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <DialogTitle>Detalle del Pedido {pedidoSeleccionado?.numero_pedido}</DialogTitle>
              <DialogDescription>Información completa del pedido y sus artículos</DialogDescription>
            </div>
            {pedidoSeleccionado && (
              <div className="flex gap-2 shrink-0 mt-0.5">
                {!tieneComprobantes(pedidoSeleccionado.id) && (
                  <Button
                    size="sm"
                    onClick={() => generarComprobantes(pedidoSeleccionado.id)}
                    disabled={generandoComprobante === pedidoSeleccionado.id}
                  >
                    {generandoComprobante === pedidoSeleccionado.id ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generando...</>
                    ) : (
                      <><Receipt className="h-4 w-4 mr-2" />Generar Comprobantes</>
                    )}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => imprimirPedido(pedidoSeleccionado)}
                >
                  <Printer className="h-4 w-4 mr-2" />Imprimir
                </Button>
              </div>
            )}
          </DialogHeader>

          {pedidoSeleccionado && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Información del Cliente</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div>
                      <Label className="text-muted-foreground">Cliente</Label>
                      <p className="font-medium">{pedidoSeleccionado.clientes?.nombre_razon_social}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Dirección</Label>
                      <p>{pedidoSeleccionado.clientes?.direccion || "—"}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Localidad</Label>
                      <p>{pedidoSeleccionado.clientes?.localidad || "—"}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Lista de Precios</Label>
                      <p>{pedidoSeleccionado.clientes?.listas_precio?.nombre || "Sin lista asignada"}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Forma de Facturación</Label>
                      <p className="font-medium">
                        {pedidoSeleccionado.metodo_facturacion_pedido
                          || pedidoSeleccionado.clientes?.metodo_facturacion
                          || "—"}
                        {pedidoSeleccionado.metodo_facturacion_pedido && pedidoSeleccionado.metodo_facturacion_pedido !== pedidoSeleccionado.clientes?.metodo_facturacion && (
                          <span className="text-xs text-orange-500 ml-2">(modificado en pedido)</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Vendedor</Label>
                      <p>{pedidoSeleccionado.vendedores?.nombre}</p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Estado y Logística</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div>
                      <Label className="text-muted-foreground">Estado Actual</Label>
                      <div className="mt-1">{getEstadoBadge(pedidoSeleccionado.estado)}</div>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Cambiar Estado</Label>
                      <Select
                        value={pedidoSeleccionado.estado}
                        onValueChange={(value) => cambiarEstadoPedido(pedidoSeleccionado.id, value)}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ESTADOS_PEDIDO.map((estado) => (
                            <SelectItem key={estado.value} value={estado.value}>
                              {estado.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {!pedidoSeleccionado.viaje_id && (
                      <div>
                        <Label className="text-muted-foreground">Asignar a Viaje</Label>
                        <div className="flex gap-2 mt-1">
                          <Select value={viajeAsignado} onValueChange={setViajeAsignado}>
                            <SelectTrigger>
                              <SelectValue placeholder="Seleccionar viaje" />
                            </SelectTrigger>
                            <SelectContent>
                              {viajes.map((viaje) => (
                                <SelectItem key={viaje.id} value={viaje.id}>
                                  {viaje.nombre} - {viaje.zonas?.nombre} ({new Date(viaje.fecha).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            onClick={() => asignarViaje(pedidoSeleccionado.id, viajeAsignado)}
                            disabled={!viajeAsignado}
                          >
                            <Truck className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                    <div>
                      <Label className="text-muted-foreground">Condición de Entrega</Label>
                      <div className="mt-1 text-sm">
                        {pedidoSeleccionado.condicion_entrega === "retira_mostrador" && "Retira en Mostrador"}
                        {pedidoSeleccionado.condicion_entrega === "transporte" && "Envío por Transporte"}
                        {pedidoSeleccionado.condicion_entrega === "entregamos_nosotros" && "Entregamos Nosotros"}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Comprobantes del pedido */}
              {comprobantesGenerados[pedidoSeleccionado.id]?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Comprobantes Generados</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {comprobantesGenerados[pedidoSeleccionado.id].map((comp) => (
                        <Button key={comp.id} variant="outline" size="sm" onClick={() => verComprobante(comp.id)}>
                          <FileText className="h-4 w-4 mr-2" />
                          {getTipoComprobanteLabel(comp.tipo_comprobante)} {comp.numero_comprobante}
                          <ExternalLink className="h-3 w-3 ml-2" />
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ═══ EDICIÓN DE ARTÍCULOS (solo pendiente, no eliminado) ═══ */}
              {pedidoSeleccionado.estado === "pendiente" && (
                <Card className="border-blue-200 bg-blue-50/40">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span>Editar Artículos</span>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                        setEditMode((prev: boolean) => !prev)
                        setAddProductQuery("")
                        setAddProductsFound([])
                        setAddProductQty(1)
                      }}>
                        {editMode ? <><X className="h-3 w-3 mr-1" />Cerrar</> : <><Plus className="h-3 w-3 mr-1" />Agregar artículo</>}
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  {editMode && (
                    <CardContent className="space-y-3">
                      {/* Add product search */}
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            placeholder="Buscar producto para agregar..."
                            className="h-8 text-sm"
                            value={addProductQuery}
                            onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                              setAddProductQuery(e.target.value)
                              if (e.target.value.length >= 2) {
                                const { searchProductos } = await import("@/lib/actions/productos")
                                const res = await searchProductos(e.target.value)
                                setAddProductsFound(res || [])
                              } else {
                                setAddProductsFound([])
                              }
                            }}
                          />
                          {addProductsFound.length > 0 && (
                            <div className="absolute top-full left-0 w-full bg-popover border rounded-md shadow-md mt-1 z-50 max-h-[200px] overflow-auto">
                              {addProductsFound.map((p: any) => (
                                <div
                                  key={p.id}
                                  className="px-3 py-2 hover:bg-muted cursor-pointer text-sm border-b last:border-0"
                                  onClick={async () => {
                                    setSavingItem(true)
                                    try {
                                      await agregarItemPedido(pedidoSeleccionado.id, p.id, addProductQty)
                                      await cargarDetallesPedido(pedidoSeleccionado.id)
                                      setAddProductQuery("")
                                      setAddProductsFound([])
                                      setAddProductQty(1)
                                    } catch (err: any) {
                                      alert(err.message || "Error al agregar artículo")
                                    } finally {
                                      setSavingItem(false)
                                    }
                                  }}
                                >
                                  <div className="font-medium">{p.descripcion}</div>
                                  <div className="text-[10px] text-muted-foreground">SKU: {p.sku}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <Input
                          type="number"
                          min={1}
                          className="h-8 w-20 text-center text-sm"
                          value={addProductQty}
                          onChange={(e) => setAddProductQty(parseInt(e.target.value) || 1)}
                          placeholder="Cant."
                        />
                        {savingItem && <Loader2 className="h-4 w-4 animate-spin self-center text-blue-600" />}
                      </div>

                      {/* Existing items with edit/remove controls */}
                      {detallesPedido.length > 0 && (
                        <div className="border rounded-md overflow-hidden bg-white">
                          <Table>
                            <TableHeader>
                              <TableRow className="text-xs">
                                <TableHead className="py-1.5 text-xs">SKU</TableHead>
                                <TableHead className="py-1.5 text-xs">Descripción</TableHead>
                                <TableHead className="text-center py-1.5 text-xs w-24">Cant.</TableHead>
                                <TableHead className="w-10" />
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {detallesPedido.map((detalle: PedidoDetalle) => (
                                <TableRow key={detalle.id} className="text-sm">
                                  <TableCell className="font-mono text-xs py-1.5">{detalle.articulos?.sku}</TableCell>
                                  <TableCell className="py-1.5 text-xs">{detalle.articulos?.descripcion}</TableCell>
                                  <TableCell className="text-center py-1">
                                    <Input
                                      type="number"
                                      min={1}
                                      className="h-7 w-16 mx-auto text-center text-xs"
                                      defaultValue={detalle.cantidad}
                                      onBlur={async (e: React.FocusEvent<HTMLInputElement>) => {
                                        const newQty = parseInt(e.target.value)
                                        if (newQty !== detalle.cantidad && newQty > 0) {
                                          try {
                                            await actualizarCantidadItem(detalle.id, pedidoSeleccionado.id, newQty)
                                            await cargarDetallesPedido(pedidoSeleccionado.id)
                                          } catch (err: any) {
                                            alert(err.message || "Error al actualizar cantidad")
                                          }
                                        }
                                      }}
                                    />
                                  </TableCell>
                                  <TableCell className="py-1 text-center">
                                    <button
                                      className="text-muted-foreground hover:text-destructive"
                                      onClick={async () => {
                                        if (!confirm(`¿Quitar ${detalle.articulos?.descripcion} del pedido?`)) return
                                        try {
                                          await eliminarItemPedido(detalle.id, pedidoSeleccionado.id)
                                          await cargarDetallesPedido(pedidoSeleccionado.id)
                                        } catch (err: any) {
                                          alert(err.message || "Error al eliminar artículo")
                                        }
                                      }}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              )}

              {/* Artículos agrupados por estado de preparación — tiempo real */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>Artículos del Pedido</span>
                    <span className="text-xs font-normal text-muted-foreground">{detallesPedido.length} artículos</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {(() => {
                    const pendientes = detallesPedido.filter(d => !d.estado_item || d.estado_item === "PENDIENTE")
                    const preparados = detallesPedido.filter(d => d.estado_item === "COMPLETO" || d.estado_item === "PARCIAL")
                    const faltantes = detallesPedido.filter(d => d.estado_item === "FALTANTE")

                    const grupos = [
                      { key: "pendientes", label: "Pendientes", count: pendientes.length, items: pendientes, dot: "bg-yellow-400", badge: "bg-yellow-50 text-yellow-700 border-yellow-200" },
                      { key: "preparados", label: "Preparados", count: preparados.length, items: preparados, dot: "bg-green-500", badge: "bg-green-50 text-green-700 border-green-200" },
                      { key: "faltantes", label: "Faltantes", count: faltantes.length, items: faltantes, dot: "bg-red-500", badge: "bg-red-50 text-red-700 border-red-200" },
                    ]

                    return (
                      <div className="divide-y">
                        {grupos.map(grupo => (
                          <div key={grupo.key}>
                            <button
                              onClick={() => setExpandedArticulosGroups(prev => ({ ...prev, [grupo.key]: !prev[grupo.key] }))}
                              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors text-left"
                            >
                              <div className="flex items-center gap-2.5">
                                <div className={`w-2.5 h-2.5 rounded-full ${grupo.dot}`} />
                                <span className="font-semibold text-sm">{grupo.label}</span>
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${grupo.badge}`}>{grupo.count}</span>
                              </div>
                              <span className={`text-sm transition-transform ${expandedArticulosGroups[grupo.key] ? "rotate-180" : ""}`}>▾</span>
                            </button>
                            {expandedArticulosGroups[grupo.key] && grupo.items.length > 0 && (
                              <div className="bg-muted/20">
                                <Table>
                                  <TableHeader>
                                    <TableRow className="text-xs">
                                      <TableHead className="py-1.5 text-xs">SKU</TableHead>
                                      <TableHead className="py-1.5 text-xs">Descripción</TableHead>
                                      <TableHead className="py-1.5 text-xs">Proveedor</TableHead>
                                      <TableHead className="text-right py-1.5 text-xs">Pedido</TableHead>
                                      <TableHead className="text-right py-1.5 text-xs">Preparado</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {grupo.items.map((detalle) => (
                                      <TableRow key={detalle.id} className="text-sm">
                                        <TableCell className="font-mono text-xs py-2">{detalle.articulos?.sku}</TableCell>
                                        <TableCell className="py-2">{detalle.articulos?.descripcion}</TableCell>
                                        <TableCell className="py-2 text-xs text-muted-foreground">{detalle.articulos?.proveedores?.nombre || "—"}</TableCell>
                                        <TableCell className="text-right py-2 font-medium">{detalle.cantidad}</TableCell>
                                        <TableCell className="text-right py-2">
                                          {detalle.estado_item === "FALTANTE" ? (
                                            <span className="text-red-600 font-semibold text-xs">FALTANTE</span>
                                          ) : detalle.cantidad_preparada != null && detalle.cantidad_preparada > 0 ? (
                                            <span className={detalle.cantidad_preparada >= detalle.cantidad ? "text-green-600 font-semibold" : "text-orange-600 font-semibold"}>
                                              {detalle.cantidad_preparada}
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground">—</span>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            )}
                            {expandedArticulosGroups[grupo.key] && grupo.items.length === 0 && (
                              <div className="px-4 py-3 text-xs text-muted-foreground">Sin artículos en este estado</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Resumen de Totales</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Subtotal:</span>
                      <span className="font-medium">${pedidoSeleccionado.subtotal?.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Descuento:</span>
                      <span>-${pedidoSeleccionado.descuento_general?.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Flete:</span>
                      <span>${pedidoSeleccionado.total_flete?.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Comisión:</span>
                      <span>${pedidoSeleccionado.total_comision?.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Impuestos:</span>
                      <span>${pedidoSeleccionado.total_impuestos?.toFixed(2)}</span>
                    </div>
                    <div className="border-t pt-2 flex justify-between text-lg font-bold">
                      <span>Total:</span>
                      <span>${pedidoSeleccionado.total?.toFixed(2)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {pedidoSeleccionado.observaciones && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Observaciones</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{pedidoSeleccionado.observaciones}</p>
                  </CardContent>
                </Card>
              )}

              {/* Botones de acción del modal */}
              <div className="flex justify-between">
                <div className="flex gap-2">
                  {pedidoSeleccionado.observaciones?.includes('Gmail') && (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        // Extract sender email from observaciones to find the ai_email
                        const obs = pedidoSeleccionado.observaciones || ''
                        const deMatch = obs.match(/De:\s*(\S+)/)
                        const asuntoMatch = obs.match(/Asunto:\s*"([^"]+)"/)
                        if (deMatch || asuntoMatch) {
                          const { data } = await supabase
                            .from('ai_emails')
                            .select('id')
                            .or([
                              deMatch ? `from_email.ilike.%${deMatch[1]}%` : null,
                              asuntoMatch ? `subject.ilike.%${asuntoMatch[1].substring(0, 30)}%` : null,
                            ].filter(Boolean).join(','))
                            .order('created_at', { ascending: false })
                            .limit(1)
                            .maybeSingle()
                          if (data?.id) setPreviewEmailId(data.id)
                        }
                      }}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Ver Email
                    </Button>
                  )}
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setModalDetalleAbierto(false);
                    // Force cleanup of potential radix ui overlay bugs that freeze the screen
                    setTimeout(() => {
                      document.body.style.pointerEvents = '';
                    }, 100);
                  }}
                >
                  Cerrar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
    </div>
  )
}


