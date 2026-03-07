export const dynamic = 'force-dynamic'
"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card, CardContent } from "@/components/ui/card"
import { Search, FileText, Loader2, CheckCircle2, Plus } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Comprobante = {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  fecha: string
  cliente_id: string
  pedido_id: string | null
  total_factura: number
  saldo_pendiente: number
  estado_pago: string
  clientes?: {
    nombre_razon_social: string
    cuit: string
  }
  pedidos?: {
    numero_pedido: string
  }
}

type Pedido = {
  id: string
  numero_pedido: string
  fecha: string
  estado: string
  total: number
  clientes?: {
    nombre_razon_social: string
    cuit: string
    condicion_iva: string
  }
}

const TIPOS_COMPROBANTE_LABELS: Record<string, string> = {
  FA: "Factura A",
  FB: "Factura B",
  FC: "Factura C",
  NCA: "Nota de Crédito A",
  NCB: "Nota de Crédito B",
  NCC: "Nota de Crédito C",
  NDA: "Nota de Débito A",
  NDB: "Nota de Débito B",
  NDC: "Nota de Débito C",
  PRES: "Presupuesto",
  REM: "Remito",
  REV: "Reversa",
}

const ESTADOS_PAGO: Record<string, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "bg-yellow-500" },
  parcial: { label: "Parcial", color: "bg-blue-500" },
  pagado: { label: "Pagado", color: "bg-green-500" },
}

export default function ComprobantesVentaPage() {
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([])
  const [pedidosSinFacturar, setPedidosSinFacturar] = useState<Pedido[]>([])
  const [busqueda, setBusqueda] = useState("")
  const [filtroTipo, setFiltroTipo] = useState<string>("todos")
  const [filtroEstado, setFiltroEstado] = useState<string>("todos")
  const [cargando, setCargando] = useState(true)
  const [generandoComprobante, setGenerandoComprobante] = useState<string | null>(null)
  const [descargandoPDF, setDescargandoPDF] = useState<string | null>(null)
  const [modalPedidosAbierto, setModalPedidosAbierto] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    cargarComprobantes()
  }, [])

  const cargarComprobantes = async () => {
    try {
      setCargando(true)
      const { data, error } = await supabase
        .from("comprobantes_venta")
        .select(
          `
          *,
          clientes (nombre_razon_social, cuit),
          pedidos (numero_pedido)
        `,
        )
        .order("fecha", { ascending: false })
        .order("numero_comprobante", { ascending: false })

      if (error) throw error
      setComprobantes(data || [])
    } catch (error) {
      console.error("[v0] Error cargando comprobantes:", error)
      alert("Error al cargar comprobantes")
    } finally {
      setCargando(false)
    }
  }

  const cargarPedidosSinFacturar = async () => {
    try {
      // Obtener pedidos en estado 'entregado' o 'listo' que no tengan comprobantes generados
      const { data, error } = await supabase
        .from("pedidos")
        .select(
          `
          *,
          clientes (nombre_razon_social, cuit, condicion_iva)
        `,
        )
        .in("estado", ["entregado", "listo", "en_viaje"])
        .order("fecha", { ascending: false })

      if (error) throw error

      // Filtrar solo los que no tienen comprobantes
      const pedidosIds = data?.map((p: any) => p.id) || []
      const { data: comprobantesExistentes } = await supabase
        .from("comprobantes_venta")
        .select("pedido_id")
        .in("pedido_id", pedidosIds)

      const pedidosConComprobante = new Set(comprobantesExistentes?.map((c: any) => c.pedido_id) || [])
      const pedidosSinComprobante = data?.filter((p: any) => !pedidosConComprobante.has(p.id)) || []

      setPedidosSinFacturar(pedidosSinComprobante)
      setModalPedidosAbierto(true)
    } catch (error) {
      console.error("[v0] Error cargando pedidos sin facturar:", error)
      alert("Error al cargar pedidos")
    }
  }

  const generarComprobantesDesdePedido = async (pedidoId: string) => {
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
        `Comprobantes generados exitosamente:\n${result.comprobantes.map((c: any) => `- ${c.tipo_comprobante} ${c.numero}`).join("\n")}`,
      )

      // Actualizar estado del pedido a 'facturado'
      await supabase.from("pedidos").update({ estado: "facturado" }).eq("id", pedidoId)

      await cargarComprobantes()
      await cargarPedidosSinFacturar()
    } catch (error: any) {
      console.error("[v0] Error generando comprobantes:", error)
      alert(error.message || "Error al generar comprobantes")
    } finally {
      setGenerandoComprobante(null)
    }
  }

  const descargarPDF = async (comprobanteId: string) => {
    setDescargandoPDF(comprobanteId)
    try {
      window.open(`/api/comprobantes-venta/${comprobanteId}/imagen`, "_blank")
    } catch (error) {
      console.error("[v0] Error abriendo comprobante:", error)
      alert("Error al abrir comprobante")
    } finally {
      setDescargandoPDF(null)
    }
  }

  const comprobantesFiltrados = comprobantes.filter((comp) => {
    const coincideBusqueda =
      comp.numero_comprobante?.toLowerCase().includes(busqueda.toLowerCase()) ||
      comp.clientes?.nombre_razon_social?.toLowerCase().includes(busqueda.toLowerCase()) ||
      comp.clientes?.cuit?.includes(busqueda) ||
      comp.pedidos?.numero_pedido?.includes(busqueda)

    const coincideTipo = filtroTipo === "todos" || comp.tipo_comprobante === filtroTipo
    const coincideEstado = filtroEstado === "todos" || comp.estado_pago === filtroEstado

    return coincideBusqueda && coincideTipo && coincideEstado
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Comprobantes de Venta</h1>
          <p className="text-muted-foreground">Administra facturas, presupuestos, remitos y notas de crédito</p>
        </div>
        <Button onClick={cargarPedidosSinFacturar}>
          <Plus className="h-4 w-4 mr-2" />
          Generar Comprobantes
        </Button>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Buscar por número, cliente, CUIT o pedido..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filtroTipo} onValueChange={setFiltroTipo}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los tipos</SelectItem>
            {Object.entries(TIPOS_COMPROBANTE_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtroEstado} onValueChange={setFiltroEstado}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Estado de pago" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="parcial">Parcial</SelectItem>
            <SelectItem value="pagado">Pagado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Número</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Pedido</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cargando ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : comprobantesFiltrados.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    No se encontraron comprobantes
                  </TableCell>
                </TableRow>
              ) : (
                comprobantesFiltrados.map((comp) => (
                  <TableRow key={comp.id}>
                    <TableCell>
                      <Badge variant="outline">{TIPOS_COMPROBANTE_LABELS[comp.tipo_comprobante]}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{comp.numero_comprobante}</TableCell>
                    <TableCell>{new Date(comp.fecha).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{comp.clientes?.nombre_razon_social}</div>
                        <div className="text-sm text-muted-foreground">{comp.clientes?.cuit}</div>
                      </div>
                    </TableCell>
                    <TableCell>{comp.pedidos?.numero_pedido || "-"}</TableCell>
                    <TableCell className="text-right font-medium">${comp.total_factura?.toFixed(2)}</TableCell>
                    <TableCell className="text-right">${comp.saldo_pendiente?.toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge className={`${ESTADOS_PAGO[comp.estado_pago]?.color} text-white`}>
                        {ESTADOS_PAGO[comp.estado_pago]?.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => descargarPDF(comp.id)}
                        disabled={descargandoPDF === comp.id}
                      >
                        {descargandoPDF === comp.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Modal de Pedidos Sin Facturar */}
      <Dialog open={modalPedidosAbierto} onOpenChange={setModalPedidosAbierto}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pedidos Sin Facturar</DialogTitle>
            <DialogDescription>
              Selecciona un pedido para generar automáticamente sus comprobantes correspondientes
            </DialogDescription>
          </DialogHeader>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº Pedido</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Condición IVA</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidosSinFacturar.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
                    <p className="font-medium">No hay pedidos pendientes de facturación</p>
                  </TableCell>
                </TableRow>
              ) : (
                pedidosSinFacturar.map((pedido) => (
                  <TableRow key={pedido.id}>
                    <TableCell className="font-medium">{pedido.numero_pedido}</TableCell>
                    <TableCell>{new Date(pedido.fecha).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{pedido.clientes?.nombre_razon_social}</div>
                        <div className="text-sm text-muted-foreground">{pedido.clientes?.cuit}</div>
                      </div>
                    </TableCell>
                    <TableCell>{pedido.clientes?.condicion_iva}</TableCell>
                    <TableCell className="text-right font-medium">${pedido.total?.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => generarComprobantesDesdePedido(pedido.id)}
                        disabled={generandoComprobante === pedido.id}
                      >
                        {generandoComprobante === pedido.id ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Generando...
                          </>
                        ) : (
                          <>
                            <FileText className="h-4 w-4 mr-2" />
                            Generar
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </div>
  )
}

