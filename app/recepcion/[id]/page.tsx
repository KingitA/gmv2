"use client"

import { useState, useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Label } from "@/components/ui/label"
import { Scan, Save, ArrowLeft, Search, AlertCircle, CheckCircle2 } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import type { Articulo } from "@/lib/types"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { nowArgentina, todayArgentina } from "@/lib/utils"

export default function RecepcionPage() {
  const supabase = createClient()
  const params = useParams()
  const router = useRouter()
  const comprobanteId = params.id as string

  const [comprobantes, setComprobantes] = useState<any[]>([])
  const [ordenCompraId, setOrdenCompraId] = useState<string | null>(null)
  const [articulos, setArticulos] = useState<Articulo[]>([])
  const [detalleItems, setDetalleItems] = useState<any[]>([])
  const [codigoEscaneado, setCodigoEscaneado] = useState("")
  const [cantidadActual, setCantidadActual] = useState<number>(1)
  const [mostrarScanner, setMostrarScanner] = useState(false)
  const [mostrarBusqueda, setMostrarBusqueda] = useState(false)
  const [busquedaDescripcion, setBusquedaDescripcion] = useState("")
  const [articulosFiltrados, setArticulosFiltrados] = useState<Articulo[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadComprobante()
    loadArticulos()
  }, [comprobanteId])

  useEffect(() => {
    if (ordenCompraId) {
      loadTodosLosComprobantes()
      loadDetalle()
    }
  }, [ordenCompraId])

  useEffect(() => {
    if (busquedaDescripcion.length > 2) {
      const filtrados = articulos.filter(
        (art) =>
          art.descripcion.toLowerCase().includes(busquedaDescripcion.toLowerCase()) ||
          art.sku.includes(busquedaDescripcion) ||
          (art.ean13 && art.ean13.includes(busquedaDescripcion)),
      )
      setArticulosFiltrados(filtrados)
    } else {
      setArticulosFiltrados([])
    }
  }, [busquedaDescripcion, articulos])

  const loadComprobante = async () => {
    const { data } = await supabase
      .from("comprobantes_compra")
      .select("*, proveedor:proveedores(nombre)")
      .eq("id", comprobanteId)
      .single()

    if (data) {
      setOrdenCompraId(data.orden_compra_id)
    }
  }

  const loadTodosLosComprobantes = async () => {
    if (!ordenCompraId) return

    const { data } = await supabase
      .from("comprobantes_compra")
      .select("*, proveedor:proveedores(nombre)")
      .eq("orden_compra_id", ordenCompraId)
      .order("fecha_comprobante", { ascending: true })

    if (data) {
      setComprobantes(data)
    }
  }

  const loadArticulos = async () => {
    const { data } = await supabase.from("articulos").select("*").eq("activo", true)
    if (data) setArticulos(data)
  }

  const loadDetalle = async () => {
    if (!ordenCompraId) return

    // Solo carga artículos que YA fueron agregados manualmente en la recepción
    // NO precarga desde la orden de compra
    const { data } = await supabase
      .from("comprobantes_compra_detalle")
      .select("*, articulo:articulos(*)")
      .eq("comprobante_id", comprobanteId)

    if (data) {
      setDetalleItems(data)
      console.log("[v0] Artículos cargados en recepción:", data.length)
    } else {
      // Si no hay artículos previamente cargados, lista VACÍA
      setDetalleItems([])
      console.log("[v0] Recepción vacía - esperando que agregues artículos manualmente")
    }
  }

  const buscarArticuloPorCodigo = (codigo: string) => {
    return articulos.find((art) => art.sku === codigo || art.ean13 === codigo)
  }

  const handleEscaneo = () => {
    if (!codigoEscaneado) return

    const articulo = buscarArticuloPorCodigo(codigoEscaneado)

    if (!articulo) {
      alert("Artículo no encontrado")
      setCodigoEscaneado("")
      return
    }

    agregarArticulo(articulo)
  }

  const agregarArticulo = (articulo: Articulo) => {
    const itemExistente = detalleItems.find((item) => item.articulo_id === articulo.id)

    if (itemExistente) {
      actualizarCantidad(itemExistente.id, itemExistente.cantidad_recibida + cantidadActual)
    } else {
      agregarNuevoItem(articulo)
    }

    setCodigoEscaneado("")
    setBusquedaDescripcion("")
    setCantidadActual(1)
    setMostrarBusqueda(false)
    inputRef.current?.focus()
  }

  const agregarNuevoItem = async (articulo: Articulo) => {
    const { data, error } = await supabase
      .from("comprobantes_compra_detalle")
      .insert({
        comprobante_id: comprobanteId,
        articulo_id: articulo.id,
        cantidad_facturada: 0, // No importa para recepción
        cantidad_recibida: cantidadActual,
        precio_unitario: 0, // Se llenará con el precio del artículo
        descuento1: 0,
        descuento2: 0,
        descuento3: 0,
        descuento4: 0,
        iva_porcentaje: 0, // No se cuenta IVA en recepción
        sector: "GENERAL",
      })
      .select("*, articulo:articulos(*)")
      .single()

    if (!error && data) {
      setDetalleItems([...detalleItems, data])
    }
  }

  const actualizarCantidad = async (detalleId: string, nuevaCantidad: number) => {
    const { error } = await supabase
      .from("comprobantes_compra_detalle")
      .update({ cantidad_recibida: nuevaCantidad })
      .eq("id", detalleId)

    if (!error) {
      loadDetalle()
    }
  }

  const actualizarPrecio = async (detalleId: string, nuevoPrecio: number) => {
    const { error } = await supabase
      .from("comprobantes_compra_detalle")
      .update({ precio_unitario: nuevoPrecio })
      .eq("id", detalleId)

    if (!error) {
      loadDetalle()
    }
  }

  const actualizarDescuento = async (detalleId: string, campo: string, valor: number) => {
    const { error } = await supabase
      .from("comprobantes_compra_detalle")
      .update({ [campo]: valor })
      .eq("id", detalleId)

    if (!error) {
      loadDetalle()
    }
  }

  const calcularTotalNetoComprobantes = () => {
    return comprobantes.reduce((sum, comp) => {
      // Asumimos que el total declarado incluye IVA, lo quitamos
      // Si el comprobante es ADQ o REV (0% IVA), el total ya es neto
      const esIvaCero = comp.tipo_comprobante === "ADQ" || comp.tipo_comprobante === "REV"
      if (esIvaCero) {
        return sum + comp.total_factura_declarado
      }
      // Para otros comprobantes, asumimos 21% IVA (ajustar según necesidad)
      return sum + comp.total_factura_declarado / 1.21
    }, 0)
  }

  const calcularTotalNetoRecepcion = () => {
    return detalleItems.reduce((sum, item) => {
      let precio = item.precio_unitario
      precio = precio * (1 - item.descuento1 / 100)
      precio = precio * (1 - item.descuento2 / 100)
      precio = precio * (1 - item.descuento3 / 100)
      precio = precio * (1 - item.descuento4 / 100)
      const subtotal = precio * item.cantidad_recibida
      return sum + subtotal
    }, 0)
  }

  const totalNetoComprobantes = calcularTotalNetoComprobantes()
  const totalNetoRecepcion = calcularTotalNetoRecepcion()
  const diferenciaNeta = totalNetoRecepcion - totalNetoComprobantes
  const coincide = Math.abs(diferenciaNeta) < 0.01

  const finalizarRecepcion = async () => {
    if (!coincide) {
      const confirmar = confirm(
        `Hay una diferencia de $${diferenciaNeta.toFixed(2)} entre comprobantes y recepción. ¿Querés continuar igual?`,
      )
      if (!confirmar) return
    }

    for (const comp of comprobantes) {
      await supabase
        .from("comprobantes_compra")
        .update({
          total_calculado: totalNetoRecepcion,
          diferencia_centavos: diferenciaNeta,
          estado: "recibido",
        })
        .eq("id", comp.id)
    }

    for (const item of detalleItems) {
      if (item.cantidad_recibida > 0) {
        console.log("[v0] Incrementando stock y actualizando precios:", {
          articulo_id: item.articulo_id,
          descripcion: item.articulo?.descripcion,
          cantidad: item.cantidad_recibida,
          precio_nuevo: item.precio_unitario,
          descuentos: [item.descuento1, item.descuento2, item.descuento3, item.descuento4],
        })

        // Incrementar stock del artículo
        const { error: stockError } = await supabase.rpc("incrementar_stock", {
          p_articulo_id: item.articulo_id,
          p_cantidad: item.cantidad_recibida,
        })

        if (stockError) {
          console.error("[v0] Error incrementando stock:", stockError)
          alert(`Error al actualizar stock del artículo ${item.articulo?.descripcion}: ${stockError.message}`)
          return
        }

        const { error: precioError } = await supabase
          .from("articulos")
          .update({
            precio_compra: item.precio_unitario,
            descuento1: item.descuento1 || 0,
            descuento2: item.descuento2 || 0,
            descuento3: item.descuento3 || 0,
            descuento4: item.descuento4 || 0,
            updated_at: nowArgentina(),
          })
          .eq("id", item.articulo_id)

        if (precioError) {
          console.error("[v0] Error actualizando precios:", precioError)
          alert(`Error al actualizar precios del artículo ${item.articulo?.descripcion}: ${precioError.message}`)
          return
        }

        // Registrar movimiento de stock
        await supabase.from("movimientos_stock").insert({
          articulo_id: item.articulo_id,
          comprobante_detalle_id: item.id,
          tipo_movimiento: "entrada",
          cantidad: item.cantidad_recibida,
          precio_unitario: item.precio_unitario,
          fecha_movimiento: nowArgentina(),
          usuario: "sistema",
          observaciones: `Recepción de comprobante ${comprobantes[0]?.numero_comprobante}`,
        })

        console.log("[v0] Stock y precios actualizados exitosamente para:", item.articulo?.descripcion)
      }
    }

    alert("Recepción finalizada exitosamente. Stock y precios actualizados.")
    router.push("/ordenes-compra")
  }

  if (comprobantes.length === 0) return <div>Cargando...</div>

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Recepción de Mercadería</h1>
          <p className="text-sm md:text-base text-muted-foreground">
            {comprobantes[0]?.proveedor?.nombre} - {comprobantes.length} comprobante(s)
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>1. Comprobantes Cargados (Datos del Proveedor)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Número</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Total Declarado</TableHead>
                <TableHead>IVA</TableHead>
                <TableHead>Total NETO</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comprobantes.map((comp) => {
                const esIvaCero = comp.tipo_comprobante === "ADQ" || comp.tipo_comprobante === "REV"
                const totalNeto = esIvaCero ? comp.total_factura_declarado : comp.total_factura_declarado / 1.21
                return (
                  <TableRow key={comp.id}>
                    <TableCell>{comp.tipo_comprobante}</TableCell>
                    <TableCell className="font-medium">{comp.numero_comprobante}</TableCell>
                    <TableCell>{new Date(comp.fecha_comprobante).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>
                    <TableCell>${comp.total_factura_declarado.toFixed(2)}</TableCell>
                    <TableCell>{esIvaCero ? "0%" : "21%"}</TableCell>
                    <TableCell className="font-bold">${totalNeto.toFixed(2)}</TableCell>
                  </TableRow>
                )
              })}
              <TableRow className="bg-muted/50">
                <TableCell colSpan={5} className="text-right font-bold">
                  Total NETO Comprobantes:
                </TableCell>
                <TableCell className="font-bold text-lg">${totalNetoComprobantes.toFixed(2)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Separator className="my-6" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>2. Recepción de Mercadería (Nuestros Datos)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <Label>Código de Barras (SKU o EAN13)</Label>
                <Input
                  ref={inputRef}
                  placeholder="Escaneá o ingresá el código..."
                  value={codigoEscaneado}
                  onChange={(e) => setCodigoEscaneado(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleEscaneo()}
                  autoFocus
                />
              </div>
              <div className="w-full md:w-32">
                <Label>Cantidad</Label>
                <Input
                  type="number"
                  min="1"
                  value={cantidadActual}
                  onChange={(e) => setCantidadActual(Number.parseInt(e.target.value))}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Button onClick={handleEscaneo} className="w-full">
                <Scan className="mr-2 h-4 w-4" />
                Agregar
              </Button>
              <Button onClick={() => setMostrarBusqueda(true)} variant="outline" className="w-full">
                <Search className="mr-2 h-4 w-4" />
                Buscar por Descripción
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artículo</TableHead>
                  <TableHead>Cant.</TableHead>
                  <TableHead>Precio Unit.</TableHead>
                  <TableHead>D1%</TableHead>
                  <TableHead>D2%</TableHead>
                  <TableHead>D3%</TableHead>
                  <TableHead>D4%</TableHead>
                  <TableHead>Subtotal NETO</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detalleItems.map((item) => {
                  let precioNeto = item.precio_unitario
                  precioNeto = precioNeto * (1 - item.descuento1 / 100)
                  precioNeto = precioNeto * (1 - item.descuento2 / 100)
                  precioNeto = precioNeto * (1 - item.descuento3 / 100)
                  precioNeto = precioNeto * (1 - item.descuento4 / 100)
                  const subtotal = precioNeto * item.cantidad_recibida

                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium">{item.articulo?.descripcion}</div>
                        <div className="text-sm text-muted-foreground">SKU: {item.articulo?.sku}</div>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          value={item.cantidad_recibida}
                          onChange={(e) => actualizarCantidad(item.id, Number.parseInt(e.target.value))}
                          className="w-20"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.precio_unitario}
                          onChange={(e) => actualizarPrecio(item.id, Number.parseFloat(e.target.value))}
                          className="w-24"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.descuento1}
                          onChange={(e) =>
                            actualizarDescuento(item.id, "descuento1", Number.parseFloat(e.target.value))
                          }
                          className="w-16"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.descuento2}
                          onChange={(e) =>
                            actualizarDescuento(item.id, "descuento2", Number.parseFloat(e.target.value))
                          }
                          className="w-16"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.descuento3}
                          onChange={(e) =>
                            actualizarDescuento(item.id, "descuento3", Number.parseFloat(e.target.value))
                          }
                          className="w-16"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.descuento4}
                          onChange={(e) =>
                            actualizarDescuento(item.id, "descuento4", Number.parseFloat(e.target.value))
                          }
                          className="w-16"
                        />
                      </TableCell>
                      <TableCell className="font-bold">${subtotal.toFixed(2)}</TableCell>
                    </TableRow>
                  )
                })}
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={7} className="text-right font-bold">
                    Total NETO Recepción:
                  </TableCell>
                  <TableCell className="font-bold text-lg">${totalNetoRecepcion.toFixed(2)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Alert variant={coincide ? "default" : "destructive"}>
        {coincide ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
        <AlertTitle>{coincide ? "Totales Coinciden" : "Diferencia Detectada"}</AlertTitle>
        <AlertDescription>
          <div className="space-y-1">
            <div>Total NETO Comprobantes: ${totalNetoComprobantes.toFixed(2)}</div>
            <div>Total NETO Recepción: ${totalNetoRecepcion.toFixed(2)}</div>
            <div className="font-bold">
              Diferencia: ${diferenciaNeta.toFixed(2)} {coincide && "✓"}
            </div>
          </div>
        </AlertDescription>
      </Alert>

      <div className="flex justify-end">
        <Button onClick={finalizarRecepcion} size="lg" disabled={detalleItems.length === 0}>
          <Save className="mr-2 h-4 w-4" />
          Finalizar Recepción
        </Button>
      </div>

      {/* Dialogs */}
      <Dialog open={mostrarBusqueda} onOpenChange={setMostrarBusqueda}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Buscar Artículo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Ingresá descripción, SKU o EAN13..."
              value={busquedaDescripcion}
              onChange={(e) => setBusquedaDescripcion(e.target.value)}
              autoFocus
            />
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {articulosFiltrados.map((articulo) => (
                <Card
                  key={articulo.id}
                  className="cursor-pointer hover:bg-accent transition-colors"
                  onClick={() => agregarArticulo(articulo)}
                >
                  <CardContent className="p-4">
                    <div className="font-medium">{articulo.descripcion}</div>
                    <div className="text-sm text-muted-foreground">SKU: {articulo.sku}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
