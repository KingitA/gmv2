export const dynamic = 'force-dynamic'
"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Camera, Search, Trash2 } from "lucide-react"
import type { OrdenCompra, Proveedor } from "@/lib/types"
import { nowArgentina, todayArgentina } from "@/lib/utils"

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

export default function ComprobantesPage() {
  const [comprobantes, setComprobantes] = useState<any[]>([])
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  // Form state
  const [selectedOrden, setSelectedOrden] = useState<string>("none")
  const [selectedProveedor, setSelectedProveedor] = useState<string>("none")
  const [tipoComprobante, setTipoComprobante] = useState<string>("none")
  const [numeroComprobante, setNumeroComprobante] = useState("")
  const [fechaComprobante, setFechaComprobante] = useState(todayArgentina())
  const [totalFacturaDeclarado, setTotalFacturaDeclarado] = useState<number>(0)
  const [descuentoFueraFactura, setDescuentoFueraFactura] = useState<number>(0)
  const [fotoUrl, setFotoUrl] = useState<string>("")

  useEffect(() => {
    loadComprobantes()
    loadOrdenes()
    loadProveedores()
  }, [])

  const loadComprobantes = async () => {
    const { data, error } = await supabase
      .from("comprobantes_compra")
      .select(`
        *,
        proveedor:proveedores(nombre),
        orden:ordenes_compra(numero_orden)
      `)
      .order("fecha_comprobante", { ascending: false })

    if (!error && data) {
      setComprobantes(data)
    }
  }

  const loadOrdenes = async () => {
    const { data } = await supabase
      .from("ordenes_compra")
      .select("*")
      .in("estado", ["pendiente", "recibida_parcial"])
      .order("fecha_orden", { ascending: false })
    if (data) setOrdenes(data)
  }

  const loadProveedores = async () => {
    const { data } = await supabase.from("proveedores").select("*").eq("activo", true).order("nombre")
    if (data) setProveedores(data)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "application/pdf",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]

    if (!allowedTypes.includes(file.type)) {
      alert("Tipo de archivo no permitido. Usá JPG, PNG, PDF o Excel.")
      return
    }

    // Aquí se subiría la imagen a Vercel Blob o similar
    // Por ahora simulamos con un placeholder
    const reader = new FileReader()
    reader.onloadend = () => {
      setFotoUrl(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const crearComprobante = async () => {
    if (tipoComprobante === "none") {
      alert("Seleccioná un tipo de comprobante")
      return
    }

    if (selectedProveedor === "none") {
      alert("Seleccioná un proveedor")
      return
    }

    if (!numeroComprobante.trim()) {
      alert("Ingresá el número de comprobante")
      return
    }

    if (totalFacturaDeclarado <= 0) {
      alert("Ingresá el total de la factura")
      return
    }

    console.log("[v0] Creando comprobante con datos:", {
      orden_compra_id: selectedOrden === "none" ? null : selectedOrden,
      tipo_comprobante: tipoComprobante,
      numero_comprobante: numeroComprobante,
      proveedor_id: selectedProveedor,
      total_factura_declarado: totalFacturaDeclarado,
    })

    const { data, error } = await supabase
      .from("comprobantes_compra")
      .insert({
        orden_compra_id: selectedOrden === "none" ? null : selectedOrden,
        tipo_comprobante: tipoComprobante,
        numero_comprobante: numeroComprobante,
        fecha_comprobante: fechaComprobante,
        proveedor_id: selectedProveedor,
        total_factura_declarado: totalFacturaDeclarado,
        total_calculado: 0,
        descuento_fuera_factura: descuentoFueraFactura,
        foto_url: fotoUrl,
        estado: "pendiente_recepcion",
        diferencia_centavos: 0,
      })
      .select()
      .single()

    if (error) {
      console.error("[v0] Error al crear comprobante:", error)
      alert(`Error al crear el comprobante: ${error.message}`)
      return
    }

    console.log("[v0] Comprobante creado exitosamente:", data)
    alert("Comprobante creado. Ahora podés ir a Recepción para escanear los productos.")
    resetForm()
    setIsCreating(false)
    loadComprobantes()
  }

  const resetForm = () => {
    setSelectedOrden("none")
    setSelectedProveedor("none")
    setTipoComprobante("none")
    setNumeroComprobante("")
    setFechaComprobante(todayArgentina())
    setTotalFacturaDeclarado(0)
    setDescuentoFueraFactura(0)
    setFotoUrl("")
  }

  const eliminarComprobante = async (comprobanteId: string, numeroComprobante: string) => {
    if (!confirm(`¿Estás seguro de eliminar el comprobante ${numeroComprobante}?`)) return

    console.log("[v0] Eliminando comprobante:", comprobanteId)

    const { error } = await supabase.from("comprobantes_compra").delete().eq("id", comprobanteId)

    if (error) {
      console.error("[v0] Error al eliminar comprobante:", error)
      alert(`Error al eliminar: ${error.message}`)
      return
    }

    console.log("[v0] Comprobante eliminado exitosamente")
    alert("Comprobante eliminado correctamente")
    loadComprobantes()
  }

  const filteredComprobantes = comprobantes.filter(
    (comp) =>
      comp.numero_comprobante.toLowerCase().includes(searchTerm.toLowerCase()) ||
      comp.proveedor?.nombre.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Comprobantes de Compra</h1>
        <Dialog open={isCreating} onOpenChange={setIsCreating}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Comprobante
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Cargar Comprobante de Compra</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Orden de Compra (opcional)</Label>
                <Select value={selectedOrden} onValueChange={setSelectedOrden}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sin orden de compra" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin orden de compra</SelectItem>
                    {ordenes.map((orden) => (
                      <SelectItem key={orden.id} value={orden.id}>
                        {orden.numero_orden}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Proveedor *</Label>
                <Select value={selectedProveedor} onValueChange={setSelectedProveedor}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar proveedor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Seleccionar proveedor</SelectItem>
                    {proveedores.map((prov) => (
                      <SelectItem key={prov.id} value={prov.id}>
                        {prov.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

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

              <div>
                <Label>Foto del Comprobante</Label>
                <div className="flex gap-2">
                  <Input type="file" accept="image/*,.pdf,.xls,.xlsx" onChange={handleFileUpload} className="flex-1" />
                  <Button variant="outline" size="icon">
                    <Camera className="h-4 w-4" />
                  </Button>
                </div>
                {fotoUrl && (
                  <div className="mt-2">
                    <img src={fotoUrl || "/placeholder.svg"} alt="Preview" className="max-h-48 rounded border" />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsCreating(false)}>
                  Cancelar
                </Button>
                <Button onClick={crearComprobante}>Crear Comprobante</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Buscar por número o proveedor..."
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
                <TableHead>Tipo</TableHead>
                <TableHead>Número</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Total Declarado</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredComprobantes.map((comp) => (
                <TableRow key={comp.id}>
                  <TableCell>{comp.tipo_comprobante}</TableCell>
                  <TableCell className="font-medium">{comp.numero_comprobante}</TableCell>
                  <TableCell>{new Date(comp.fecha_comprobante).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</TableCell>
                  <TableCell>{comp.proveedor?.nombre}</TableCell>
                  <TableCell>${comp.total_factura_declarado.toFixed(2)}</TableCell>
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
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => eliminarComprobante(comp.id, comp.numero_comprobante)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

