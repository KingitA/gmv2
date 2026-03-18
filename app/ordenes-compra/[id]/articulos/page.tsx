"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Search, Plus, Trash2, Save, AlertTriangle } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
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

export default function CargarArticulosPage() {
  const supabase = createClient()
  const params = useParams()
  const router = useRouter()
  const ordenId = params.id as string

  const [orden, setOrden] = useState<any>(null)
  const [comprobantes, setComprobantes] = useState<any[]>([])
  const [articulosIngresados, setArticulosIngresados] = useState<any[]>([])
  const [busqueda, setBusqueda] = useState("")
  const [resultadosBusqueda, setResultadosBusqueda] = useState<any[]>([])
  const [mostrarCrearArticulo, setMostrarCrearArticulo] = useState(false)
  const [articuloSeleccionado, setArticuloSeleccionado] = useState<any>(null)
  const [cantidadModal, setCantidadModal] = useState<number>(1)
  const [tipoModal, setTipoModal] = useState<"unidad" | "bulto">("bulto")
  const [mostrarConfirmacionGuardar, setMostrarConfirmacionGuardar] = useState(false)
  const [guardando, setGuardando] = useState(false)

  // Formulario nuevo artículo
  const [nuevoSku, setNuevoSku] = useState("")
  const [nuevoEan13, setNuevoEan13] = useState("")
  const [nuevaDescripcion, setNuevaDescripcion] = useState("")
  const [nuevoPrecio, setNuevoPrecio] = useState<number>(0)
  const [nuevoUnidadesPorBulto, setNuevoUnidadesPorBulto] = useState<number>(1)
  const [nuevoDescuento1, setNuevoDescuento1] = useState<number>(0)
  const [nuevoDescuento2, setNuevoDescuento2] = useState<number>(0)
  const [nuevoDescuento3, setNuevoDescuento3] = useState<number>(0)
  const [nuevoDescuento4, setNuevoDescuento4] = useState<number>(0)

  useEffect(() => {
    loadOrden()
    loadComprobantes()
    loadArticulosExistentes()
  }, [ordenId])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (busqueda.trim().length >= 2) {
        buscarArticulo()
      } else {
        setResultadosBusqueda([])
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [busqueda])

  const loadOrden = async () => {
    const { data } = await supabase
      .from("ordenes_compra")
      .select("*, proveedor:proveedores(nombre)")
      .eq("id", ordenId)
      .single()

    if (data) setOrden(data)
  }

  const loadComprobantes = async () => {
    const { data } = await supabase.from("comprobantes_compra").select("*").eq("orden_compra_id", ordenId)

    if (data) {
      setComprobantes(data)
    }
  }

  const loadArticulosExistentes = async () => {
    const { data } = await supabase
      .from("ordenes_compra_detalle")
      .select("*, articulo:articulos(id, sku, ean13, descripcion, precio_compra, unidades_por_bulto)")
      .eq("orden_compra_id", ordenId)

    if (data && data.length > 0) {
      setArticulosIngresados(data.map((item: any) => ({
        id: item.id,
        articulo_id: item.articulo_id,
        articulo: item.articulo || { descripcion: "—", sku: "—" },
        cantidad: item.cantidad_pedida,
        cantidad_pedida: item.cantidad_pedida,
        tipo_cantidad: item.tipo_cantidad || "bulto",
        precio_unitario: item.precio_unitario || 0,
        descuento1: item.descuento1 || 0,
        descuento2: item.descuento2 || 0,
        descuento3: item.descuento3 || 0,
        descuento4: item.descuento4 || 0,
      })))
    }
  }

  const buscarArticulo = async () => {
    if (!busqueda.trim()) {
      setResultadosBusqueda([])
      return
    }

    const { data } = await supabase
      .from("articulos")
      .select("*")
      .or(`sku.ilike.%${busqueda}%,ean13.ilike.%${busqueda}%,descripcion.ilike.%${busqueda}%`)
      .eq("activo", true)
      .limit(10)

    if (data) {
      setResultadosBusqueda(data)
    }
  }

  const seleccionarArticulo = (articulo: any) => {
    // Verificar si ya está en la lista
    if (articulosIngresados.find((a) => a.articulo_id === articulo.id)) {
      alert("Este artículo ya está en la lista")
      return
    }

    setArticuloSeleccionado(articulo)
    setCantidadModal(1)
    setTipoModal("bulto")
  }

  const confirmarAgregarArticulo = () => {
    if (!articuloSeleccionado || cantidadModal <= 0) return

    setArticulosIngresados([
      ...articulosIngresados,
      {
        articulo_id: articuloSeleccionado.id,
        articulo: articuloSeleccionado,
        cantidad: cantidadModal,
        tipo_cantidad: tipoModal,
        precio_unitario: articuloSeleccionado.precio_compra || 0,
        descuento1: articuloSeleccionado.descuento1 || 0,
        descuento2: articuloSeleccionado.descuento2 || 0,
        descuento3: articuloSeleccionado.descuento3 || 0,
        descuento4: articuloSeleccionado.descuento4 || 0,
      },
    ])

    // Limpiar y cerrar
    setBusqueda("")
    setResultadosBusqueda([])
    setArticuloSeleccionado(null)
    setCantidadModal(1)
    setTipoModal("bulto")
  }

  const actualizarArticulo = (index: number, campo: string, valor: any) => {
    const nuevos = [...articulosIngresados]
    nuevos[index][campo] = valor
    setArticulosIngresados(nuevos)
  }

  const eliminarArticulo = (index: number) => {
    setArticulosIngresados(articulosIngresados.filter((_, i) => i !== index))
  }

  const calcularPrecioNeto = (item: any) => {
    let precio = item.precio_unitario
    precio = precio * (1 - item.descuento1 / 100)
    precio = precio * (1 - item.descuento2 / 100)
    precio = precio * (1 - item.descuento3 / 100)
    precio = precio * (1 - item.descuento4 / 100)

    const cantidadReal =
      item.tipo_cantidad === "bulto" ? item.cantidad * (item.articulo.unidades_por_bulto || 1) : item.cantidad

    return precio * cantidadReal
  }

  const totalNeto = articulosIngresados.reduce((sum, item) => sum + calcularPrecioNeto(item), 0)

  const totalNetoComprobantes = comprobantes.reduce((sum, comp) => {
    // Usar el total_neto guardado en la base de datos si existe
    if (comp.total_neto != null) {
      return sum + comp.total_neto
    }
    // Fallback: calcular si no existe (para comprobantes antiguos)
    const iva = comp.tipo_comprobante === "Adquisicion" || comp.tipo_comprobante === "Reversa" ? 0 : 0.21
    return sum + comp.total_factura_declarado / (1 + iva)
  }, 0)

  const diferencia = totalNeto - totalNetoComprobantes
  const coincide = Math.abs(diferencia) < 0.01
  const diferenciaSignificativa = Math.abs(diferencia) > 10

  const guardarArticulos = async () => {
    setGuardando(true)

    try {
      // Eliminar artículos existentes de esta orden
      await supabase.from("ordenes_compra_detalle").delete().eq("orden_compra_id", ordenId)

      // Insertar nuevos artículos
      const articulosParaGuardar = articulosIngresados.map((item) => ({
        orden_compra_id: ordenId,
        articulo_id: item.articulo_id,
        cantidad_pedida: item.cantidad,
        tipo_cantidad: item.tipo_cantidad,
        precio_unitario: item.precio_unitario,
        descuento1: item.descuento1,
        descuento2: item.descuento2,
        descuento3: item.descuento3,
        descuento4: item.descuento4,
      }))

      const { error } = await supabase.from("ordenes_compra_detalle").insert(articulosParaGuardar)

      if (error) throw error

      console.log("[v0] Actualizando stock de artículos...")
      for (const item of articulosIngresados) {
        const cantidadUnidades =
          item.tipo_cantidad === "bulto" ? item.cantidad * item.articulo.unidades_por_bulto : item.cantidad

        console.log(`[v0] Incrementando stock del artículo ${item.articulo.sku} en ${cantidadUnidades} unidades`)

        const { error: stockError } = await supabase.rpc("incrementar_stock", {
          p_articulo_id: item.articulo_id,
          p_cantidad: cantidadUnidades,
        })

        if (stockError) {
          console.error(`[v0] Error actualizando stock de ${item.articulo.sku}:`, stockError)
          throw new Error(`Error actualizando stock de ${item.articulo.sku}: ${stockError.message}`)
        }
      }
      console.log("[v0] Stock actualizado exitosamente")

      alert("Artículos guardados y stock actualizado exitosamente")
      setMostrarConfirmacionGuardar(false)
    } catch (error: any) {
      alert(`Error al guardar: ${error.message}`)
    } finally {
      setGuardando(false)
    }
  }

  const handleGuardar = () => {
    if (diferenciaSignificativa) {
      // Si la diferencia es significativa, mostrar confirmación
      setMostrarConfirmacionGuardar(true)
    } else {
      // Si la diferencia es pequeña, guardar directamente
      guardarArticulos()
    }
  }

  const crearNuevoArticulo = async () => {
    if (!nuevoSku || !nuevaDescripcion) {
      alert("Completá SKU y descripción")
      return
    }

    const { data, error } = await supabase
      .from("articulos")
      .insert({
        sku: nuevoSku,
        ean13: nuevoEan13 || null,
        descripcion: nuevaDescripcion,
        unidad_medida: "bulto",
        unidades_por_bulto: nuevoUnidadesPorBulto,
        precio_compra: nuevoPrecio,
        descuento1: nuevoDescuento1,
        descuento2: nuevoDescuento2,
        descuento3: nuevoDescuento3,
        descuento4: nuevoDescuento4,
        stock_actual: 0,
        activo: true,
      })
      .select()
      .single()

    if (error) {
      alert(`Error: ${error.message}`)
      return
    }

    alert("Artículo creado exitosamente")
    seleccionarArticulo(data)
    setMostrarCrearArticulo(false)
    setNuevoSku("")
    setNuevoEan13("")
    setNuevaDescripcion("")
    setNuevoPrecio(0)
    setNuevoUnidadesPorBulto(1)
    setNuevoDescuento1(0)
    setNuevoDescuento2(0)
    setNuevoDescuento3(0)
    setNuevoDescuento4(0)
  }

  if (!orden) return <div>Cargando...</div>

  // Solo se pueden agregar artículos si la OC está pendiente o enviada (aún no recibida)
  const esEditable = ['pendiente', 'enviada', 'confirmada', 'borrador'].includes(orden.estado)

  // Si la OC ya fue recibida/finalizada, redirigir a verificación
  if (!esEditable && (orden.estado === 'recibida' || orden.estado === 'recibida_completa' || orden.estado === 'recibida_parcial' || orden.estado === 'finalizada')) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Artículos — {orden.numero_orden}</h1>
            <p className="text-muted-foreground">
              {orden.proveedor?.nombre} — Estado: {orden.estado}
            </p>
          </div>
          <div className="ml-auto">
            <Button onClick={() => router.push(`/ordenes-compra/${ordenId}/verificacion`)}>
              <AlertTriangle className="h-4 w-4 mr-2" /> Ir a Verificación
            </Button>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Artículos de la Orden ({articulosIngresados.length})</CardTitle>
            <p className="text-sm text-muted-foreground">
              Esta orden ya fue recibida. No se pueden agregar ni modificar artículos.
              Usá la pantalla de verificación para comparar con la factura y recepción.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artículo</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Precio Unit.</TableHead>
                  <TableHead>D1%</TableHead>
                  <TableHead>D2%</TableHead>
                  <TableHead>D3%</TableHead>
                  <TableHead>D4%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {articulosIngresados.map((item) => (
                  <TableRow key={item.id || item.articulo_id}>
                    <TableCell>
                      <div className="font-medium">{item.articulo?.descripcion || "—"}</div>
                      <div className="text-xs text-muted-foreground">SKU: {item.articulo?.sku}</div>
                    </TableCell>
                    <TableCell>{item.cantidad_pedida || item.cantidad} {item.tipo_cantidad}</TableCell>
                    <TableCell>${(item.precio_unitario || 0).toFixed(2)}</TableCell>
                    <TableCell>{item.descuento1 || 0}%</TableCell>
                    <TableCell>{item.descuento2 || 0}%</TableCell>
                    <TableCell>{item.descuento3 || 0}%</TableCell>
                    <TableCell>{item.descuento4 || 0}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Cargar Artículos</h1>
            <p className="text-muted-foreground">
              Orden: {orden.numero_orden} - Proveedor: {orden.proveedor?.nombre}
            </p>
          </div>
        </div>
        <Button onClick={handleGuardar} disabled={guardando || articulosIngresados.length === 0} size="lg">
          <Save className="h-4 w-4 mr-2" />
          {guardando ? "Guardando..." : "Guardar Carga"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Buscar Artículo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Escanear EAN13, buscar por SKU o nombre..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="pl-10"
                autoFocus
              />
            </div>
            <Button variant="outline" onClick={() => setMostrarCrearArticulo(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Crear Nuevo
            </Button>
          </div>

          {resultadosBusqueda.length > 0 && (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[250px]">SKU</TableHead>
                    <TableHead>EAN13</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Unid/Bulto</TableHead>
                    <TableHead>Precio</TableHead>
                    <TableHead>Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultadosBusqueda.map((art) => (
                    <TableRow key={art.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell className="font-medium">{art.sku}</TableCell>
                      <TableCell>{art.ean13 || "-"}</TableCell>
                      <TableCell>{art.descripcion}</TableCell>
                      <TableCell>{art.unidades_por_bulto}</TableCell>
                      <TableCell>${(art.precio_compra || 0).toFixed(2)}</TableCell>
                      <TableCell>
                        <Button size="sm" onClick={() => seleccionarArticulo(art)}>
                          Seleccionar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {busqueda.trim().length >= 2 && resultadosBusqueda.length === 0 && (
            <div className="text-center py-4 text-muted-foreground">
              No se encontraron artículos. Podés crear uno nuevo.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Artículos Ingresados ({articulosIngresados.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[250px]">Artículo</TableHead>
                <TableHead className="w-32">Tipo</TableHead>
                <TableHead className="w-32">Cantidad</TableHead>
                <TableHead className="w-40">Precio Unit.</TableHead>
                <TableHead className="w-32">D1%</TableHead>
                <TableHead className="w-32">D2%</TableHead>
                <TableHead className="w-32">D3%</TableHead>
                <TableHead className="w-32">D4%</TableHead>
                <TableHead className="w-40">Precio NETO</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {articulosIngresados.map((item) => (
                <TableRow key={item.id || `temp-${item.articulo_id}`}>
                  <TableCell className="min-w-[250px]">
                    <div className="font-medium">{item.articulo.descripcion}</div>
                    <div className="text-sm text-muted-foreground">
                      SKU: {item.articulo.sku} | {item.articulo.unidades_por_bulto} unid/bulto
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={item.tipo_cantidad}
                      onValueChange={(value) =>
                        actualizarArticulo(articulosIngresados.indexOf(item), "tipo_cantidad", value)
                      }
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
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      value={item.cantidad}
                      onChange={(e) =>
                        actualizarArticulo(
                          articulosIngresados.indexOf(item),
                          "cantidad",
                          Number.parseFloat(e.target.value) || 0,
                        )
                      }
                      className="w-full"
                    />
                    {item.tipo_cantidad === "bulto" && item.cantidad > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        = {item.cantidad * item.articulo.unidades_por_bulto} unidades
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.precio_unitario}
                      onChange={(e) =>
                        actualizarArticulo(
                          articulosIngresados.indexOf(item),
                          "precio_unitario",
                          Number.parseFloat(e.target.value) || 0,
                        )
                      }
                      className="w-full"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.descuento1}
                      onChange={(e) =>
                        actualizarArticulo(
                          articulosIngresados.indexOf(item),
                          "descuento1",
                          Number.parseFloat(e.target.value) || 0,
                        )
                      }
                      className="w-full"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.descuento2}
                      onChange={(e) =>
                        actualizarArticulo(
                          articulosIngresados.indexOf(item),
                          "descuento2",
                          Number.parseFloat(e.target.value) || 0,
                        )
                      }
                      className="w-full"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.descuento3}
                      onChange={(e) =>
                        actualizarArticulo(
                          articulosIngresados.indexOf(item),
                          "descuento3",
                          Number.parseFloat(e.target.value) || 0,
                        )
                      }
                      className="w-full"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.descuento4}
                      onChange={(e) =>
                        actualizarArticulo(
                          articulosIngresados.indexOf(item),
                          "descuento4",
                          Number.parseFloat(e.target.value) || 0,
                        )
                      }
                      className="w-full"
                    />
                  </TableCell>
                  <TableCell className="font-bold text-primary">${calcularPrecioNeto(item).toFixed(2)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => eliminarArticulo(articulosIngresados.indexOf(item))}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="border-t pt-4 space-y-2">
            <div className="flex justify-between text-lg">
              <span>Total NETO Comprobantes:</span>
              <span className="font-bold">${totalNetoComprobantes.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg">
              <span>Total NETO Artículos:</span>
              <span className="font-bold">${totalNeto.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xl font-bold">
              <span>Diferencia:</span>
              <span className={coincide ? "text-green-600" : "text-amber-600"}>${diferencia.toFixed(2)}</span>
            </div>
            {coincide && (
              <div className="bg-green-50 border border-green-200 p-3 rounded-md text-green-800 text-center">
                ✓ Los totales coinciden perfectamente
              </div>
            )}
            {!coincide && !diferenciaSignificativa && (
              <div className="bg-blue-50 border border-blue-200 p-3 rounded-md text-blue-800 text-center">
                ℹ️ Diferencia de redondeo: ${Math.abs(diferencia).toFixed(2)} - Podés guardar y ajustar después si es
                necesario
              </div>
            )}
            {!coincide && diferenciaSignificativa && (
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-md text-amber-800 text-center flex items-center justify-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Diferencia significativa: ${Math.abs(diferencia).toFixed(2)} - Revisá los valores antes de guardar
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!articuloSeleccionado} onOpenChange={() => setArticuloSeleccionado(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ingresar Cantidad</DialogTitle>
          </DialogHeader>
          {articuloSeleccionado && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-md">
                <div className="font-medium">{articuloSeleccionado.descripcion}</div>
                <div className="text-sm text-muted-foreground">
                  SKU: {articuloSeleccionado.sku} | {articuloSeleccionado.unidades_por_bulto} unid/bulto
                </div>
                <div className="text-sm font-medium mt-2">
                  Precio: ${(articuloSeleccionado.precio_compra || 0).toFixed(2)}
                </div>
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={tipoModal} onValueChange={(value: "unidad" | "bulto") => setTipoModal(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bulto">Bulto</SelectItem>
                    <SelectItem value="unidad">Unidad</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Cantidad</Label>
                <Input
                  type="number"
                  min="1"
                  value={cantidadModal}
                  onChange={(e) => setCantidadModal(Number.parseInt(e.target.value) || 1)}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && confirmarAgregarArticulo()}
                />
                {tipoModal === "bulto" && (
                  <div className="text-xs text-muted-foreground mt-1">
                    = {cantidadModal * articuloSeleccionado.unidades_por_bulto} unidades
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setArticuloSeleccionado(null)}>
                  Cancelar
                </Button>
                <Button onClick={confirmarAgregarArticulo}>Agregar a la Tabla</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={mostrarCrearArticulo} onOpenChange={setMostrarCrearArticulo}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Crear Nuevo Artículo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>SKU *</Label>
                <Input placeholder="Ej: ABC123" value={nuevoSku} onChange={(e) => setNuevoSku(e.target.value)} />
              </div>
              <div>
                <Label>EAN13</Label>
                <Input
                  placeholder="Código de barras"
                  value={nuevoEan13}
                  onChange={(e) => setNuevoEan13(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Descripción *</Label>
              <Input
                placeholder="Nombre del producto"
                value={nuevaDescripcion}
                onChange={(e) => setNuevaDescripcion(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Unidades por Bulto</Label>
                <Input
                  type="number"
                  min="1"
                  value={nuevoUnidadesPorBulto}
                  onChange={(e) => setNuevoUnidadesPorBulto(Number.parseInt(e.target.value) || 1)}
                />
              </div>
              <div>
                <Label>Precio de Compra</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={nuevoPrecio}
                  onChange={(e) => setNuevoPrecio(Number.parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <Label>Descuento 1 (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={nuevoDescuento1}
                  onChange={(e) => setNuevoDescuento1(Number.parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Descuento 2 (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={nuevoDescuento2}
                  onChange={(e) => setNuevoDescuento2(Number.parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Descuento 3 (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={nuevoDescuento3}
                  onChange={(e) => setNuevoDescuento3(Number.parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label>Descuento 4 (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={nuevoDescuento4}
                  onChange={(e) => setNuevoDescuento4(Number.parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMostrarCrearArticulo(false)}>
                Cancelar
              </Button>
              <Button onClick={crearNuevoArticulo}>Crear Artículo</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={mostrarConfirmacionGuardar} onOpenChange={setMostrarConfirmacionGuardar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Guardado con Diferencia</AlertDialogTitle>
            <AlertDialogDescription>
              Hay una diferencia de <strong>${Math.abs(diferencia).toFixed(2)}</strong> entre el total de comprobantes y
              el total de artículos.
              <br />
              <br />
              ¿Querés guardar de todas formas? Podés ajustar los valores después desde esta misma pantalla.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={guardarArticulos}>Guardar de Todas Formas</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
