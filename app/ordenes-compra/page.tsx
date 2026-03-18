"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Search, Send, FileText, CheckCircle2, AlertCircle, Clock, Trash2, Pencil } from "lucide-react"
import type { Proveedor, OrdenCompra } from "@/lib/types"
import { ImportOrderDialog } from "@/components/ordenes/ImportOrderDialog"
import { nowArgentina, todayArgentina } from "@/lib/utils"
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

function CargarComprobanteForm({
  ordenId,
  proveedorId,
  onSuccess,
}: { ordenId: string; proveedorId: string; onSuccess: () => void }) {
  const [tipoComprobante, setTipoComprobante] = useState<string>("none")
  const [numeroComprobante, setNumeroComprobante] = useState("")
  const [fechaComprobante, setFechaComprobante] = useState(todayArgentina())
  const [totalFacturaDeclarado, setTotalFacturaDeclarado] = useState<number>(0)
  const [descuentoFueraFactura, setDescuentoFueraFactura] = useState<number>(0)

  const TIPOS_COMPROBANTE = [
    { value: "FA", label: "Factura A" },
    { value: "FB", label: "Factura B" },
    { value: "FC", label: "Factura C" },
    { value: "NCA", label: "Nota de Crédito A" },
    { value: "NCB", label: "Nota de Crédito B" },
    { value: "NCC", label: "Nota de Crédito C" },
    { value: "NDA", label: "Nota de Débito A" },
    { value: "NDB", label: "Nota de Débito B" },
    { value: "NDC", label: "Nota de Débito C" },
    { value: "ADQ", label: "Adquisición (IVA 0%)" },
    { value: "REV", label: "Reversa (IVA 0%)" },
  ]

  const crearComprobante = async () => {
    if (tipoComprobante === "none" || !numeroComprobante.trim() || totalFacturaDeclarado <= 0) {
      alert("Completá todos los campos obligatorios")
      return
    }

    const { data, error } = await supabase
      .from("comprobantes_compra")
      .insert({
        orden_compra_id: ordenId,
        tipo_comprobante: tipoComprobante,
        numero_comprobante: numeroComprobante,
        fecha_comprobante: fechaComprobante,
        proveedor_id: proveedorId,
        total_factura_declarado: totalFacturaDeclarado,
        total_calculado: 0,
        descuento_fuera_factura: descuentoFueraFactura,
        estado: "pendiente_recepcion",
        diferencia_centavos: 0,
      })
      .select()
      .single()

    if (error) {
      alert(`Error al crear el comprobante: ${error.message}`)
      return
    }

    alert("Comprobante creado exitosamente")
    onSuccess()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Tipo de Comprobante *</Label>
          <Select value={tipoComprobante} onValueChange={setTipoComprobante}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Seleccionar tipo</SelectItem>
              {TIPOS_COMPROBANTE.map((tipo) => (
                <SelectItem key={tipo.value} value={tipo.value}>
                  {tipo.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Número de Comprobante *</Label>
          <Input
            placeholder="0001-00000001"
            value={numeroComprobante}
            onChange={(e) => setNumeroComprobante(e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label>Fecha del Comprobante *</Label>
        <Input type="date" value={fechaComprobante} onChange={(e) => setFechaComprobante(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Total de la Factura (según papel) *</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="0.00"
            value={totalFacturaDeclarado || ""}
            onChange={(e) => setTotalFacturaDeclarado(Number.parseFloat(e.target.value))}
          />
        </div>

        <div>
          <Label>Descuento Fuera de Factura (%)</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="0.00"
            value={descuentoFueraFactura || ""}
            onChange={(e) => setDescuentoFueraFactura(Number.parseFloat(e.target.value))}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button onClick={crearComprobante}>Crear Comprobante</Button>
      </div>
    </div>
  )
}

function DetalleOrdenDialog({ orden, onClose }: { orden: OrdenCompra; onClose: () => void }) {
  const [comprobantes, setComprobantes] = useState<any[]>([])

  useEffect(() => {
    loadComprobantes()
  }, [orden.id])

  const loadComprobantes = async () => {
    const { data } = await supabase
      .from("comprobantes_compra")
      .select(`
        *,
        detalle:comprobantes_compra_detalle(
          *,
          articulo:articulos(descripcion, sku, unidades_por_bulto)
        )
      `)
      .eq("orden_compra_id", orden.id)
      .order("fecha_comprobante", { ascending: false })

    if (data) setComprobantes(data)
  }

  const totalFacturado = comprobantes.reduce((sum, comp) => sum + comp.total_factura_declarado, 0)
  const totalCalculado = comprobantes.reduce((sum, comp) => sum + comp.total_calculado, 0)

  // Calcular cantidades por artículo
  const cantidadesPorArticulo = new Map()
  comprobantes.forEach((comp) => {
    comp.detalle?.forEach((item: any) => {
      const key = item.articulo_id
      const cantidadActual = cantidadesPorArticulo.get(key) || {
        articulo: item.articulo,
        facturada: 0,
        recibida: 0,
      }
      cantidadActual.facturada += item.cantidad_facturada
      cantidadActual.recibida += item.cantidad_recibida
      cantidadesPorArticulo.set(key, cantidadActual)
    })
  })

  return (
    <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Detalle de Orden {orden.numero_orden}</DialogTitle>
      </DialogHeader>

      <div className="space-y-6">
        {/* Resumen de comprobantes */}
        <Card>
          <CardHeader>
            <CardTitle>Comprobantes Asociados ({comprobantes.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Número</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Total Declarado</TableHead>
                  <TableHead>Total Calculado</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comprobantes.map((comp) => (
                  <TableRow key={comp.id}>
                    <TableCell>{comp.tipo_comprobante}</TableCell>
                    <TableCell className="font-medium">{comp.numero_comprobante}</TableCell>
                    <TableCell>{new Date(comp.fecha_comprobante).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>
                    <TableCell>${comp.total_factura_declarado.toFixed(2)}</TableCell>
                    <TableCell>${comp.total_calculado.toFixed(2)}</TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded-full text-xs ${comp.estado === "pendiente_recepcion"
                          ? "bg-yellow-100 text-yellow-800"
                          : comp.estado === "recibido"
                            ? "bg-blue-100 text-blue-800"
                            : comp.estado === "validado"
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                      >
                        {comp.estado}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => (window.location.href = `/recepcion/${comp.id}`)}
                      >
                        Recepcionar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-4 space-y-2 border-t pt-4">
              <div className="flex justify-between text-lg">
                <span>Total Facturado (todos los comprobantes):</span>
                <span className="font-bold">${totalFacturado.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg">
                <span>Total Calculado (todos los comprobantes):</span>
                <span className="font-bold">${totalCalculado.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xl font-bold">
                <span>Diferencia:</span>
                <span className={Math.abs(totalFacturado - totalCalculado) < 0.01 ? "text-green-600" : "text-red-600"}>
                  ${(totalFacturado - totalCalculado).toFixed(2)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Resumen de cantidades por artículo */}
        <Card>
          <CardHeader>
            <CardTitle>Cantidades Totales por Artículo</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artículo</TableHead>
                  <TableHead>Cant. Facturada (Total)</TableHead>
                  <TableHead>Cant. Recibida (Total)</TableHead>
                  <TableHead>Diferencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(cantidadesPorArticulo.values()).map((item: any, index) => {
                  const diferencia = item.facturada - item.recibida
                  return (
                    <TableRow key={index}>
                      <TableCell>
                        <div className="font-medium">{item.articulo.descripcion}</div>
                        <div className="text-sm text-muted-foreground">
                          SKU: {item.articulo.sku} | {item.articulo.unidades_por_bulto} unid/bulto
                        </div>
                      </TableCell>
                      <TableCell>{item.facturada} bultos</TableCell>
                      <TableCell>{item.recibida} bultos</TableCell>
                      <TableCell>
                        <span className={diferencia === 0 ? "text-green-600" : "text-red-600"}>
                          {diferencia > 0 ? `+${diferencia}` : diferencia} bultos
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </DialogContent>
  )
}

export default function OrdenesCompraPage() {
  const supabase = createClient()
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [selectedProveedor, setSelectedProveedor] = useState<string>("")
  const [articulosTabla, setArticulosTabla] = useState<any[]>([])
  const [observaciones, setObservaciones] = useState("")
  const [searchArticulo, setSearchArticulo] = useState("")
  const [ordenSeleccionada, setOrdenSeleccionada] = useState<OrdenCompra | null>(null)
  const [mostrarCargarComprobante, setMostrarCargarComprobante] = useState(false)
  const [ordenParaDetalle, setOrdenParaDetalle] = useState<OrdenCompra | null>(null)
  const [ordenParaEliminar, setOrdenParaEliminar] = useState<OrdenCompra | null>(null)
  const [ordenParaEditar, setOrdenParaEditar] = useState<OrdenCompra | null>(null)

  useEffect(() => {
    loadOrdenes()
    loadProveedores()
  }, [])

  const loadOrdenes = async () => {
    const { data, error } = await supabase
      .from("ordenes_compra")
      .select(`
        *,
        proveedor:proveedores(nombre, email),
        detalle:ordenes_compra_detalle(
          *,
          articulo:articulos(descripcion, sku, unidades_por_bulto)
        ),
        comprobantes:comprobantes_compra(id, estado, total_factura_declarado)
      `)
      .order("fecha_orden", { ascending: false })

    if (!error && data) {
      setOrdenes(data)
    }
  }

  const loadProveedores = async () => {
    const { data } = await supabase.from("proveedores").select("*").eq("activo", true).order("nombre")
    if (data) setProveedores(data)
  }

  const handleProveedorChange = async (proveedorId: string) => {
    setSelectedProveedor(proveedorId)

    if (!proveedorId) {
      setArticulosTabla([])
      return
    }

    const { data } = await supabase
      .from("articulos")
      .select("*")
      .eq("activo", true)
      .eq("proveedor_id", proveedorId)
      .order("descripcion")

    if (data) {
      const articulosConCantidad = data.map((art: any) => ({
        articulo_id: art.id,
        articulo: art,
        cantidad_pedida: 0,
        tipo_cantidad: "bulto",
        precio_unitario: art.precio_compra || 0,
        descuento1: art.descuento1 || 0,
        descuento2: art.descuento2 || 0,
        descuento3: art.descuento3 || 0,
        descuento4: art.descuento4 || 0,
      }))
      setArticulosTabla(articulosConCantidad)
    }
  }

  const actualizarArticulo = (index: number, campo: string, valor: any) => {
    const nuevosArticulos = [...articulosTabla]
    nuevosArticulos[index][campo] = valor
    setArticulosTabla(nuevosArticulos)
  }

  const calcularSubtotal = (item: any) => {
    if (item.cantidad_pedida === 0) return 0

    let precio = item.precio_unitario
    precio = precio * (1 - item.descuento1 / 100)
    precio = precio * (1 - item.descuento2 / 100)
    precio = precio * (1 - item.descuento3 / 100)
    precio = precio * (1 - item.descuento4 / 100)

    const cantidadReal =
      item.tipo_cantidad === "bulto"
        ? item.cantidad_pedida * (item.articulo.unidades_por_bulto || 1)
        : item.cantidad_pedida

    return precio * cantidadReal
  }

  const crearOrden = async () => {
    const articulosConCantidad = articulosTabla.filter((item) => item.cantidad_pedida > 0)

    if (!selectedProveedor || articulosConCantidad.length === 0) {
      alert("Seleccioná un proveedor y agregá cantidades a al menos un artículo")
      return
    }

    const { data: ultimaOrden } = await supabase
      .from("ordenes_compra")
      .select("numero_orden")
      .order("numero_orden", { ascending: false })
      .limit(1)

    const numeroOrden =
      ultimaOrden && ultimaOrden[0]
        ? `OC-${String(Number.parseInt(ultimaOrden[0].numero_orden.split("-")[1]) + 1).padStart(6, "0")}`
        : "OC-000001"

    const { data: orden, error: errorOrden } = await supabase
      .from("ordenes_compra")
      .insert({
        numero_orden: numeroOrden,
        proveedor_id: selectedProveedor,
        fecha_orden: nowArgentina(),
        estado: "pendiente",
        observaciones: observaciones,
        usuario_creador: "admin",
      })
      .select()
      .single()

    if (errorOrden || !orden) {
      alert("Error al crear la orden")
      return
    }

    const detalleParaInsertar = articulosConCantidad.map((item) => ({
      orden_compra_id: orden.id,
      articulo_id: item.articulo_id,
      cantidad_pedida: item.cantidad_pedida,
      tipo_cantidad: item.tipo_cantidad,
      precio_unitario: item.precio_unitario,
      descuento1: item.descuento1,
      descuento2: item.descuento2,
      descuento3: item.descuento3,
      descuento4: item.descuento4,
    }))

    const { error: errorDetalle } = await supabase.from("ordenes_compra_detalle").insert(detalleParaInsertar)

    if (errorDetalle) {
      alert("Error al crear el detalle de la orden")
      return
    }

    // --- AGREGAR A CUENTA CORRIENTE ---
    await supabase.from("cuenta_corriente_proveedores").insert({
      proveedor_id: selectedProveedor,
      tipo_movimiento: "orden_compra",
      monto: totalOrden,
      descripcion: `Provisión OC: ${numeroOrden}`,
      referencia_id: orden.id,
      referencia_tipo: "orden_compra",
      fecha: nowArgentina(),
    })
    // ----------------------------------

    for (const item of articulosConCantidad) {
      await supabase
        .from("articulos")
        .update({
          precio_compra: item.precio_unitario,
          descuento1: item.descuento1,
          descuento2: item.descuento2,
          descuento3: item.descuento3,
          descuento4: item.descuento4,
        })
        .eq("id", item.articulo_id)
    }

    alert(`Orden ${numeroOrden} creada exitosamente`)
    setIsCreating(false)
    setSelectedProveedor("")
    setArticulosTabla([])
    setObservaciones("")
    loadOrdenes()
  }

  const abrirEditarOrden = async (orden: OrdenCompra) => {
    const { data: detalles } = await supabase
      .from("ordenes_compra_detalle")
      .select(`
        *,
        articulo:articulos(*)
      `)
      .eq("orden_compra_id", orden.id)

    if (detalles) {
      const articulosConDatos = detalles.map((det: any) => ({
        articulo_id: det.articulo_id,
        articulo: det.articulo,
        cantidad_pedida: det.cantidad_pedida,
        tipo_cantidad: det.tipo_cantidad || "bulto",
        precio_unitario: det.precio_unitario,
        descuento1: det.descuento1 || 0,
        descuento2: det.descuento2 || 0,
        descuento3: det.descuento3 || 0,
        descuento4: det.descuento4 || 0,
      }))
      setArticulosTabla(articulosConDatos)
      setSelectedProveedor(orden.proveedor_id)
      setObservaciones(orden.observaciones || "")
      setOrdenParaEditar(orden)
      setIsCreating(true)
    }
  }

  const actualizarOrden = async () => {
    if (!ordenParaEditar) return

    const articulosConCantidad = articulosTabla.filter((item) => item.cantidad_pedida > 0)

    if (!selectedProveedor || articulosConCantidad.length === 0) {
      alert("Seleccioná un proveedor y agregá cantidades a al menos un artículo")
      return
    }

    const { error: errorOrden } = await supabase
      .from("ordenes_compra")
      .update({
        proveedor_id: selectedProveedor,
        observaciones: observaciones,
        updated_at: nowArgentina(),
      })
      .eq("id", ordenParaEditar.id)

    if (errorOrden) {
      alert("Error al actualizar la orden")
      return
    }

    await supabase.from("ordenes_compra_detalle").delete().eq("orden_compra_id", ordenParaEditar.id)

    const detalleParaInsertar = articulosConCantidad.map((item) => ({
      orden_compra_id: ordenParaEditar.id,
      articulo_id: item.articulo_id,
      cantidad_pedida: item.cantidad_pedida,
      tipo_cantidad: item.tipo_cantidad,
      precio_unitario: item.precio_unitario,
      descuento1: item.descuento1,
      descuento2: item.descuento2,
      descuento3: item.descuento3,
      descuento4: item.descuento4,
    }))

    const { error: errorDetalle } = await supabase.from("ordenes_compra_detalle").insert(detalleParaInsertar)

    if (errorDetalle) {
      alert("Error al actualizar el detalle de la orden")
      return
    }

    // --- ACTUALIZAR EN CUENTA CORRIENTE ---
    await supabase
      .from("cuenta_corriente_proveedores")
      .delete()
      .eq("referencia_id", ordenParaEditar.id)
      .eq("referencia_tipo", "orden_compra")
    await supabase.from("cuenta_corriente_proveedores").insert({
      proveedor_id: selectedProveedor,
      tipo_movimiento: "orden_compra",
      monto: totalOrden,
      descripcion: `Provisión OC: ${ordenParaEditar.numero_orden}`,
      referencia_id: ordenParaEditar.id,
      referencia_tipo: "orden_compra",
      fecha: nowArgentina(),
    })
    // --------------------------------------

    for (const item of articulosConCantidad) {
      await supabase
        .from("articulos")
        .update({
          precio_compra: item.precio_unitario,
          descuento1: item.descuento1,
          descuento2: item.descuento2,
          descuento3: item.descuento3,
          descuento4: item.descuento4,
        })
        .eq("id", item.articulo_id)
    }

    alert(`Orden ${ordenParaEditar.numero_orden} actualizada exitosamente`)
    setIsCreating(false)
    setOrdenParaEditar(null)
    setSelectedProveedor("")
    setArticulosTabla([])
    setObservaciones("")
    loadOrdenes()
  }

  const enviarPorEmail = async (orden: OrdenCompra) => {
    alert(`Funcionalidad de envío por email para orden ${orden.numero_orden} (próximamente)`)
  }

  const eliminarOrden = async (orden: OrdenCompra) => {
    const { error } = await supabase.from("ordenes_compra").delete().eq("id", orden.id)

    if (error) {
      alert(`Error al eliminar la orden: ${error.message}`)
      return
    }

    // --- ELIMINAR DE CUENTA CORRIENTE ---
    await supabase
      .from("cuenta_corriente_proveedores")
      .delete()
      .eq("referencia_id", orden.id)
      .eq("referencia_tipo", "orden_compra")
    // ------------------------------------

    alert(`Orden ${orden.numero_orden} eliminada exitosamente`)
    setOrdenParaEliminar(null)
    loadOrdenes()
  }

  const calcularEstadoFactura = (orden: OrdenCompra) => {
    const comprobantes = orden.comprobantes || []
    if (comprobantes.length === 0) return "sin_factura"

    const tieneValidado = comprobantes.some((c: any) => c.estado === "validado" || c.estado === "cerrado")
    const tienePendiente = comprobantes.some((c: any) => c.estado === "pendiente_recepcion" || c.estado === "recibido")

    if (tieneValidado && !tienePendiente) return "completo"
    if (comprobantes.length > 0) return "parcial"
    return "sin_factura"
  }

  const calcularEstadoRecepcion = (orden: OrdenCompra) => {
    const comprobantes = orden.comprobantes || []
    if (comprobantes.length === 0) return "sin_recepcion"

    const tieneRecibido = comprobantes.some(
      (c: any) => c.estado === "recibido" || c.estado === "validado" || c.estado === "cerrado",
    )
    const tienePendiente = comprobantes.some((c: any) => c.estado === "pendiente_recepcion")

    if (tieneRecibido && !tienePendiente) return "completo"
    if (tieneRecibido) return "parcial"
    return "sin_recepcion"
  }

  const EstadoIndicador = ({ estado }: { estado: string }) => {
    if (estado === "completo") {
      return <CheckCircle2 className="h-5 w-5 text-green-600" />
    }
    if (estado === "parcial") {
      return <Clock className="h-5 w-5 text-yellow-600" />
    }
    return <AlertCircle className="h-5 w-5 text-red-600" />
  }

  const abrirCargarComprobante = (orden: OrdenCompra) => {
    setOrdenSeleccionada(orden)
    setMostrarCargarComprobante(true)
  }

  const irARecepcion = (orden: OrdenCompra) => {
    // Si ya tiene comprobantes, ir al último
    if (orden.comprobantes && orden.comprobantes.length > 0) {
      const ultimoComprobante = orden.comprobantes[orden.comprobantes.length - 1]
      window.location.href = `/recepcion/${ultimoComprobante.id}`
    } else {
      alert("Primero debés cargar un comprobante para esta orden")
    }
  }

  const handleImportSuccess = (items: any[], proveedorId: string) => {
    setSelectedProveedor(proveedorId)
    // Map items to table format
    const tableItems = items.map(item => ({
      articulo_id: item.articulo_id, // Might be undefined/null if new
      articulo: item.articulo, // Partial article object
      cantidad_pedida: item.cantidad_pedida,
      tipo_cantidad: "bulto", // Defaulting to bulto as requested in logic
      precio_unitario: item.precio_unitario,
      descuento1: item.descuento1,
      descuento2: item.descuento2,
      descuento3: item.descuento3,
      descuento4: item.descuento4,
    }))
    setArticulosTabla(tableItems)
    setIsCreating(true)
  }

  const filteredOrdenes = ordenes.filter(
    (orden) =>
      orden.numero_orden?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      orden.proveedor?.nombre.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const articulosFiltrados = searchArticulo
    ? articulosTabla.filter(
      (item) =>
        item.articulo.descripcion.toLowerCase().includes(searchArticulo.toLowerCase()) ||
        item.articulo.sku.includes(searchArticulo) ||
        (item.articulo.ean13 && item.articulo.ean13.includes(searchArticulo)),
    )
    : articulosTabla

  const totalOrden = articulosTabla.reduce((sum, item) => sum + calcularSubtotal(item), 0)
  const articulosConCantidad = articulosTabla.filter((item) => item.cantidad_pedida > 0).length

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Órdenes de Compra</h1>
        <div className="flex gap-2">
          <ImportOrderDialog proveedores={proveedores} onImportSuccess={handleImportSuccess} />
          <Dialog
            open={isCreating}
            onOpenChange={(open) => {
              setIsCreating(open)
              if (!open) {
                setOrdenParaEditar(null)
                setSelectedProveedor("")
                setArticulosTabla([])
                setObservaciones("")
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nueva Orden
              </Button>
            </DialogTrigger>
            <DialogContent className="w-full sm:max-w-[98vw] h-[95vh] flex flex-col p-0 bg-white dark:bg-slate-900 shadow-2xl z-[100]">
              <DialogHeader className="px-6 pt-6 pb-4 border-b">
                <DialogTitle>
                  {ordenParaEditar ? `Editar Orden ${ordenParaEditar.numero_orden}` : "Crear Orden de Compra"}
                </DialogTitle>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="space-y-4">
                  <div>
                    <Label>Proveedor</Label>
                    <Select value={selectedProveedor} onValueChange={handleProveedorChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar proveedor" />
                      </SelectTrigger>
                      <SelectContent>
                        {proveedores.map((prov) => (
                          <SelectItem key={prov.id} value={prov.id}>
                            {prov.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedProveedor && articulosTabla.length > 0 && (
                    <>
                      <div className="bg-muted p-3 rounded-md flex items-center justify-between sticky top-0 z-10">
                        <div className="text-sm">
                          <strong>{articulosTabla.length}</strong> artículos disponibles |
                          <strong className="ml-2 text-primary">{articulosConCantidad}</strong> con cantidad asignada
                        </div>
                        <div className="flex gap-4 items-center">
                          <div className="text-lg font-bold">Total: ${totalOrden.toFixed(2)}</div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => alert("Próximamente: buscar artículo fuera del proveedor")}
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Buscar artículo fuera del proveedor
                          </Button>
                        </div>
                      </div>

                      <div>
                        <Label>Buscar en la tabla</Label>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                          <Input
                            placeholder="Filtrar por descripción, SKU o EAN13..."
                            value={searchArticulo}
                            onChange={(e) => setSearchArticulo(e.target.value)}
                            className="pl-10"
                          />
                        </div>
                      </div>

                      <div className="border rounded-md">
                        <div className="max-h-[calc(95vh-400px)] overflow-y-auto">
                          <Table>
                            <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                              <TableRow>
                                <TableHead className="min-w-[300px]">Artículo</TableHead>
                                <TableHead className="w-36">Tipo</TableHead>
                                <TableHead className="w-36">Cantidad</TableHead>
                                <TableHead className="w-28">Precio Unit.</TableHead>
                                <TableHead className="w-24">D1%</TableHead>
                                <TableHead className="w-24">D2%</TableHead>
                                <TableHead className="w-24">D3%</TableHead>
                                <TableHead className="w-24">D4%</TableHead>
                                <TableHead className="w-36">Subtotal</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {articulosFiltrados.map((item, index) => {
                                const indexReal = articulosTabla.findIndex((a) => a.articulo_id === item.articulo_id)
                                return (
                                  <TableRow key={item.articulo_id} className={item.cantidad_pedida > 0 ? "bg-accent/50" : ""}>
                                    <TableCell className="min-w-[300px]">
                                      <div className="font-medium">{item.articulo.descripcion}</div>
                                      <div className="text-sm text-muted-foreground">
                                        SKU: {item.articulo.sku} | {item.articulo.unidades_por_bulto} unid/bulto
                                        {item.articulo.ean13 && ` | EAN: ${item.articulo.ean13}`}
                                      </div>
                                    </TableCell>
                                    <TableCell className="w-36">
                                      <Select
                                        value={item.tipo_cantidad}
                                        onValueChange={(value) => actualizarArticulo(indexReal, "tipo_cantidad", value)}
                                      >
                                        <SelectTrigger className="w-full">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="bulto">Bulto</SelectItem>
                                          <SelectItem value="unidad">Unidad</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </TableCell>
                                    <TableCell className="w-36">
                                      <Input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={item.cantidad_pedida || ""}
                                        onChange={(e) =>
                                          actualizarArticulo(
                                            indexReal,
                                            "cantidad_pedida",
                                            Number.parseFloat(e.target.value) || 0,
                                          )
                                        }
                                        className={`w-full ${item.cantidad_pedida > 0 ? "border-primary" : ""}`}
                                      />
                                      {item.tipo_cantidad === "bulto" && item.cantidad_pedida > 0 && (
                                        <div className="text-xs text-muted-foreground mt-1">
                                          = {item.cantidad_pedida * item.articulo.unidades_por_bulto} unidades
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="w-28">
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={item.precio_unitario || ""}
                                        onChange={(e) =>
                                          actualizarArticulo(
                                            indexReal,
                                            "precio_unitario",
                                            Number.parseFloat(e.target.value) || 0,
                                          )
                                        }
                                        className="w-full"
                                      />
                                    </TableCell>
                                    <TableCell className="w-24">
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="100"
                                        value={item.descuento1 || ""}
                                        onChange={(e) =>
                                          actualizarArticulo(indexReal, "descuento1", Number.parseFloat(e.target.value) || 0)
                                        }
                                        className="w-full"
                                      />
                                    </TableCell>
                                    <TableCell className="w-24">
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="100"
                                        value={item.descuento2 || ""}
                                        onChange={(e) =>
                                          actualizarArticulo(indexReal, "descuento2", Number.parseFloat(e.target.value) || 0)
                                        }
                                        className="w-full"
                                      />
                                    </TableCell>
                                    <TableCell className="w-24">
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="100"
                                        value={item.descuento3 || ""}
                                        onChange={(e) =>
                                          actualizarArticulo(indexReal, "descuento3", Number.parseFloat(e.target.value) || 0)
                                        }
                                        className="w-full"
                                      />
                                    </TableCell>
                                    <TableCell className="w-24">
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="100"
                                        value={item.descuento4 || ""}
                                        onChange={(e) =>
                                          actualizarArticulo(indexReal, "descuento4", Number.parseFloat(e.target.value) || 0)
                                        }
                                        className="w-full"
                                      />
                                    </TableCell>
                                    <TableCell className="w-36 font-medium">
                                      {item.cantidad_pedida > 0 ? `$${calcularSubtotal(item).toFixed(2)}` : "-"}
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </>
                  )}

                  {selectedProveedor && articulosTabla.length === 0 && (
                    <div className="bg-amber-50 border border-amber-200 p-4 rounded-md text-center">
                      <p className="text-amber-800">
                        No hay artículos asignados a este proveedor. Asigná artículos al proveedor desde la sección de
                        Artículos.
                      </p>
                    </div>
                  )}

                  <div>
                    <Label>Observaciones</Label>
                    <Input
                      placeholder="Observaciones adicionales..."
                      value={observaciones}
                      onChange={(e) => setObservaciones(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t bg-background flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsCreating(false)
                    setOrdenParaEditar(null)
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={ordenParaEditar ? actualizarOrden : crearOrden}
                  disabled={!selectedProveedor || articulosConCantidad === 0}
                >
                  {ordenParaEditar ? "Actualizar Orden" : `Crear Orden (${articulosConCantidad} artículos)`}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Buscar por número de orden o proveedor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proveedor</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>N° Orden</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrdenes.map((orden) => {
                const estadoFactura = calcularEstadoFactura(orden)
                const estadoRecepcion = calcularEstadoRecepcion(orden)
                const cantidadComprobantes = orden.comprobantes?.length || 0

                return (
                  <TableRow key={orden.id}>
                    <TableCell className="font-medium">{orden.proveedor?.nombre}</TableCell>
                    <TableCell>{new Date(orden.fecha_orden ?? orden.fecha_emision).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        orden.estado === "pendiente" ? "bg-yellow-100 text-yellow-800" 
                        : orden.estado === "enviada" || orden.estado === "confirmada" ? "bg-blue-100 text-blue-800"
                        : orden.estado === "en_camino" ? "bg-purple-100 text-purple-800"
                        : orden.estado === "recibida" || orden.estado === "recibida_completa" ? "bg-orange-100 text-orange-800"
                        : orden.estado === "recibida_parcial" ? "bg-orange-100 text-orange-700"
                        : orden.estado === "finalizada" ? "bg-green-100 text-green-800"
                        : orden.estado === "cancelada" ? "bg-red-100 text-red-800"
                        : "bg-gray-100 text-gray-800"
                      }`}>
                        {orden.estado === "pendiente" ? "Pendiente"
                          : orden.estado === "enviada" ? "Enviada"
                          : orden.estado === "confirmada" ? "Confirmada"
                          : orden.estado === "en_camino" ? "En camino"
                          : orden.estado === "recibida" || orden.estado === "recibida_completa" ? "Recibida"
                          : orden.estado === "recibida_parcial" ? "Recibida parcial"
                          : orden.estado === "finalizada" ? "Finalizada"
                          : orden.estado === "cancelada" ? "Cancelada"
                          : orden.estado}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {orden.numero_orden && (
                          <span className="text-xs font-mono text-muted-foreground self-center mr-2">{orden.numero_orden}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2 flex-wrap">
                        {/* PENDIENTE: editar artículos + enviar */}
                        {orden.estado === "pendiente" && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => abrirEditarOrden(orden)}>
                              <Pencil className="h-4 w-4 mr-1" /> Editar
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => enviarPorEmail(orden)}>
                              <Send className="h-4 w-4 mr-1" /> Enviar
                            </Button>
                          </>
                        )}

                        {/* ENVIADA / EN CAMINO: cargar comprobantes */}
                        {(orden.estado === "enviada" || orden.estado === "confirmada" || orden.estado === "en_camino") && (
                          <>
                            <Button variant="outline" size="sm"
                              onClick={() => (window.location.href = `/ordenes-compra/${orden.id}/comprobantes`)}>
                              <FileText className="h-4 w-4 mr-1" /> Cargar comprobante
                            </Button>
                          </>
                        )}

                        {/* RECIBIDA: ver verificación triple (artículos vs factura vs depósito) */}
                        {(orden.estado === "recibida" || orden.estado === "recibida_completa" || orden.estado === "recibida_parcial") && (
                          <>
                            <Button variant="default" size="sm"
                              onClick={() => (window.location.href = `/ordenes-compra/${orden.id}/verificacion`)}>
                              <CheckCircle2 className="h-4 w-4 mr-1" /> Verificar
                            </Button>
                            <Button variant="outline" size="sm"
                              onClick={() => (window.location.href = `/ordenes-compra/${orden.id}/comprobantes`)}>
                              <FileText className="h-4 w-4 mr-1" /> Comprobantes
                            </Button>
                          </>
                        )}

                        {/* SIEMPRE: ver artículos (solo lectura si no es pendiente) */}
                        {orden.estado !== "pendiente" && orden.estado !== "cancelada" && (
                          <Button variant="ghost" size="sm"
                            onClick={() => (window.location.href = `/ordenes-compra/${orden.id}/articulos`)}>
                            <Plus className="h-4 w-4 mr-1" /> Artículos
                          </Button>
                        )}

                        {/* Eliminar solo si pendiente */}
                        {orden.estado === "pendiente" && (
                          <Button variant="outline" size="sm"
                            onClick={() => setOrdenParaEliminar(orden)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!ordenParaDetalle} onOpenChange={() => setOrdenParaDetalle(null)}>
        {ordenParaDetalle && <DetalleOrdenDialog orden={ordenParaDetalle} onClose={() => setOrdenParaDetalle(null)} />}
      </Dialog>

      <AlertDialog open={!!ordenParaEliminar} onOpenChange={() => setOrdenParaEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar orden de compra?</AlertDialogTitle>
            <AlertDialogDescription>
              Estás por eliminar la orden <strong>{ordenParaEliminar?.numero_orden}</strong>. Esta acción:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Eliminará la orden y todos sus artículos asociados</li>
                <li>Los comprobantes cargados se mantendrán pero se desvincularan de esta orden</li>
                <li>Esta acción no se puede deshacer</li>
              </ul>
              <p className="mt-3 text-amber-600 font-medium">
                Nota: El email de cancelación al proveedor debe enviarse manualmente.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => ordenParaEliminar && eliminarOrden(ordenParaEliminar)}
              className="bg-red-600 hover:bg-red-700"
            >
              Eliminar Orden
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}


