export const dynamic = 'force-dynamic'
"use client"

import type React from "react"

import { useState, useEffect } from "react"
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
  GripVertical,
  Loader2,
  FileText,
  MoreHorizontal,
  Pencil,
  Receipt,
  ExternalLink,
  Printer,
  Trash2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ImportOrderDialog } from "@/components/pedidos/ImportOrderDialog"
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
  clientes?: {
    nombre_razon_social: string
    cuit: string
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
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [guardandoCambios, setGuardandoCambios] = useState(false)
  const [generandoComprobante, setGenerandoComprobante] = useState<string | null>(null)
  const [comprobantesGenerados, setComprobantesGenerados] = useState<{ [pedidoId: string]: Comprobante[] }>({})
  const [modalDetalleAbierto, setModalDetalleAbierto] = useState(false)
  const [pedidoAEliminar, setPedidoAEliminar] = useState<Pedido | null>(null)
  const [eliminando, setEliminando] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    cargarPedidos()
    cargarViajes()
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
          clientes (nombre_razon_social, cuit),
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
                <div class="value">${pedido.clientes?.nombre_razon_social}</div>
                <div class="label" style="margin-top: 8px;">CUIT</div>
                <div class="value">${pedido.clientes?.cuit}</div>
              </div>
              <div class="info-box">
                <div class="label">Vendedor</div>
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

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = "move"
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()

    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null)
      return
    }

    const reordenados = [...pedidosFiltrados]
    const [pedidoArrastrado] = reordenados.splice(draggedIndex, 1)
    reordenados.splice(dropIndex, 0, pedidoArrastrado)

    try {
      const updates = reordenados.map((pedido, index) => ({
        id: pedido.id,
        prioridad: index + 1,
      }))

      for (const update of updates) {
        await supabase.from("pedidos").update({ prioridad: update.prioridad }).eq("id", update.id)
      }

      await cargarPedidos()
    } catch (error) {
      console.error("Error actualizando prioridades:", error)
    }

    setDraggedIndex(null)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

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
          <Button variant="outline" className="gap-2" asChild>
            <a href="/clientes-pedidos/import-review">
              <FileText className="h-4 w-4" />
              Revisar Automáticos
            </a>
          </Button>
          <ImportOrderDialog onOrderCreated={cargarPedidos} />
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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">Orden</TableHead>
                <TableHead>Nº Pedido</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Vendedor</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Viaje</TableHead>
                <TableHead>Comprobantes</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cargando ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8">
                    Cargando pedidos...
                  </TableCell>
                </TableRow>
              ) : pedidosFiltrados.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8">
                    No se encontraron pedidos
                  </TableCell>
                </TableRow>
              ) : (
                pedidosFiltrados.map((pedido, index) => (
                  <TableRow
                    key={pedido.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`cursor-move ${draggedIndex === index ? "opacity-50" : ""}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground font-medium">{index + 1}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{pedido.numero_pedido}</TableCell>
                    <TableCell>{formatDateAR(pedido.fecha)}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{pedido.clientes?.nombre_razon_social}</div>
                        <div className="text-sm text-muted-foreground">{pedido.clientes?.cuit}</div>
                      </div>
                    </TableCell>
                    <TableCell>{pedido.vendedores?.nombre}</TableCell>
                    <TableCell>{getEstadoBadge(pedido.estado)}</TableCell>
                    <TableCell>
                      {pedido.viajes ? (
                        <div className="text-sm">
                          <div className="font-medium">{pedido.viajes.nombre}</div>
                          <div className="text-muted-foreground">
                            {formatDateAR(pedido.viajes.fecha)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Sin asignar</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {comprobantesGenerados[pedido.id]?.length > 0 ? (
                        <div className="space-y-1">
                          {comprobantesGenerados[pedido.id].map((comp) => (
                            <button
                              key={comp.id}
                              onClick={() => verComprobante(comp.id)}
                              className="flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <FileText className="h-3 w-3" />
                              {comp.numero_comprobante}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">${pedido.total?.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {pedido.estado === "pendiente" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setPedidoAEliminar(pedido)}
                            title="Eliminar pedido"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                        {pedido.estado === "eliminado" && (pedido as any).eliminado_at && (
                          <span className="text-xs text-muted-foreground mr-2" title="Días restantes antes de la purga definitiva">
                            {getDiasRestantes((pedido as any).eliminado_at)}d
                          </span>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setPedidoSeleccionado(pedido)
                                cargarDetallesPedido(pedido.id)
                                setModalDetalleAbierto(true)
                              }}
                            >
                              <Pencil className="h-4 w-4 mr-2" />
                              Editar / Ver Detalle
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {!tieneComprobantes(pedido.id) ? (
                              <DropdownMenuItem
                                onClick={() => generarComprobantes(pedido.id)}
                                disabled={generandoComprobante === pedido.id}
                              >
                                {generandoComprobante === pedido.id ? (
                                  <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Generando...
                                  </>
                                ) : (
                                  <>
                                    <Receipt className="h-4 w-4 mr-2" />
                                    Generar Comprobantes
                                  </>
                                )}
                              </DropdownMenuItem>
                            ) : (
                              <>
                                {comprobantesGenerados[pedido.id]?.map((comp) => (
                                  <DropdownMenuItem key={comp.id} onClick={() => verComprobante(comp.id)}>
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                    Ver {getTipoComprobanteLabel(comp.tipo_comprobante)}
                                  </DropdownMenuItem>
                                ))}
                              </>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => imprimirPedido(pedido)}>
                              <Printer className="h-4 w-4 mr-2" />
                              Imprimir Pedido
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
          <DialogHeader>
            <DialogTitle>Detalle del Pedido {pedidoSeleccionado?.numero_pedido}</DialogTitle>
            <DialogDescription>Información completa del pedido y sus artículos</DialogDescription>
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
                      <Label className="text-muted-foreground">CUIT</Label>
                      <p>{pedidoSeleccionado.clientes?.cuit}</p>
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

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Artículos del Pedido</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Descripción</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead className="text-right">Precio Unit.</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detallesPedido.map((detalle) => (
                        <TableRow key={detalle.id}>
                          <TableCell className="font-mono text-sm">{detalle.articulos?.sku}</TableCell>
                          <TableCell>{detalle.articulos?.descripcion}</TableCell>
                          <TableCell className="text-right">{detalle.cantidad}</TableCell>
                          <TableCell className="text-right">${detalle.precio_final?.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium">${detalle.subtotal?.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
                <div>
                  {!tieneComprobantes(pedidoSeleccionado.id) && (
                    <Button
                      onClick={() => generarComprobantes(pedidoSeleccionado.id)}
                      disabled={generandoComprobante === pedidoSeleccionado.id}
                    >
                      {generandoComprobante === pedidoSeleccionado.id ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Generando...
                        </>
                      ) : (
                        <>
                          <Receipt className="h-4 w-4 mr-2" />
                          Generar Comprobantes
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="ml-2"
                    onClick={() => imprimirPedido(pedidoSeleccionado)}
                  >
                    <Printer className="h-4 w-4 mr-2" />
                    Imprimir
                  </Button>
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
    </div >
  )
}

