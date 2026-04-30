"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet"
import { Label } from "@/components/ui/label"
import { Plus, Pencil, Trash2, ArrowLeft, ShoppingBag, Truck, FileText, Search, X, ExternalLink } from "lucide-react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Cliente {
  id: string
  codigo_cliente?: string | null
  nombre_razon_social: string
  direccion: string | null
  cuit: string | null
  condicion_iva: string
  metodo_facturacion: string
  localidad_id: string | null
  provincia: string | null
  telefono: string | null
  mail: string | null
  condicion_pago: string
  nro_iibb: string | null
  exento_iibb: boolean
  exento_iva: boolean
  percepcion_iibb: number
  tipo_canal: string
  puntaje: number
  nivel_puntaje: string
  porcentaje_ajuste: number
  vendedor_id: string | null
  activo: boolean
  condicion_entrega: string | null
  localidades?: { nombre: string; zonas?: { nombre: string } }
}

interface Vendedor {
  id: string
  nombre: string
}

interface Localidad {
  id: string
  nombre: string
  provincia: string
  zona_id: string | null
  zonas?: { nombre: string }
}

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [localidades, setLocalidades] = useState<Localidad[]>([])
  const [listasPrecio, setListasPrecio] = useState<any[]>([])
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null)
  const [sheetBonifs, setSheetBonifs] = useState<any[]>([])
  const [sheetCC, setSheetCC] = useState<number | null>(null)
  const [sheetPedidos, setSheetPedidos] = useState<any[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [bonificaciones, setBonificaciones] = useState<any[]>([])
  const [proveedores, setProveedores] = useState<any[]>([])
  const [newBonif, setNewBonif] = useState({ tipo: "general", porcentaje: "", segmento: "", proveedor_id: "", observaciones: "" })
  const [formData, setFormData] = useState({
    codigo_cliente: "",
    nombre_razon_social: "",
    direccion: "",
    cuit: "",
    condicion_iva: "Consumidor Final",
    metodo_facturacion: "Factura",
    localidad_id: "",
    localidad: "",
    provincia: "",
    telefono: "",
    mail: "",
    condicion_pago: "Efectivo",
    nro_iibb: "",
    exento_iibb: false,
    exento_iva: false,
    percepcion_iibb: 0,
    tipo_canal: "Minorista",
    vendedor_id: "",
    condicion_entrega: "entregamos_nosotros",
    lista_precio_id: "",
    descuento_especial: 0,
    lista_limpieza_id: "",
    metodo_limpieza: "",
    lista_perf0_id: "",
    metodo_perf0: "",
    lista_perf_plus_id: "",
    metodo_perf_plus: "",
  })

  useEffect(() => {
    loadClientes()
    loadVendedores()
    loadLocalidades()
    loadListasPrecio()
    loadProveedores()
  }, [])

  async function loadClientes() {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("clientes")
      .select("*, localidades(nombre, zonas(nombre))")
      .eq("activo", true)
      .order("nombre_razon_social")

    if (error) {
      console.error("[v0] Error loading clientes:", error)
      return
    }

    setClientes(data || [])
  }

  async function loadVendedores() {
    const supabase = createClient()
    const { data, error } = await supabase.from("vendedores").select("id, nombre").eq("activo", true).order("nombre")

    if (error) {
      console.error("[v0] Error loading vendedores:", error)
      return
    }

    setVendedores(data || [])
  }

  async function loadLocalidades() {
    const supabase = createClient()
    const { data, error } = await supabase.from("localidades").select("*, zonas(nombre)").order("provincia, nombre")

    if (error) {
      console.error("[v0] Error loading localidades:", error)
      return
    }

    setLocalidades(data || [])
  }

  async function loadListasPrecio() {
    const supabase = createClient()
    const { data } = await supabase.from("listas_precio").select("id, nombre, codigo").eq("activo", true).order("nombre")
    setListasPrecio(data || [])
  }

  async function loadProveedores() {
    const supabase = createClient()
    const { data } = await supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre")
    setProveedores(data || [])
  }

  async function loadBonificaciones(clienteId: string) {
    const supabase = createClient()
    const { data } = await supabase.from("bonificaciones").select("*, proveedores(nombre)").eq("cliente_id", clienteId).order("created_at")
    setBonificaciones(data || [])
  }

  async function addBonificacion(clienteId: string) {
    if (!newBonif.porcentaje || isNaN(parseFloat(newBonif.porcentaje))) return
    const supabase = createClient()
    await supabase.from("bonificaciones").insert({
      cliente_id: clienteId,
      tipo: newBonif.tipo,
      porcentaje: parseFloat(newBonif.porcentaje),
      segmento: newBonif.segmento || null,
      proveedor_id: newBonif.proveedor_id || null,
      observaciones: newBonif.observaciones || null,
    })
    setNewBonif({ tipo: "general", porcentaje: "", segmento: "", proveedor_id: "", observaciones: "" })
    loadBonificaciones(clienteId)
  }

  async function toggleBonificacion(id: string, activo: boolean, clienteId: string) {
    const supabase = createClient()
    await supabase.from("bonificaciones").update({ activo }).eq("id", id)
    loadBonificaciones(clienteId)
  }

  async function deleteBonificacion(id: string, clienteId: string) {
    const supabase = createClient()
    await supabase.from("bonificaciones").delete().eq("id", id)
    loadBonificaciones(clienteId)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const supabase = createClient()

    const dataToSave = {
      ...formData,
      nombre: formData.nombre_razon_social,
      razon_social: formData.nombre_razon_social,
      vendedor_id: formData.vendedor_id && formData.vendedor_id !== "none" ? formData.vendedor_id : null,
      localidad_id: formData.localidad_id || null,
      lista_precio_id: formData.lista_precio_id && formData.lista_precio_id !== "none" ? formData.lista_precio_id : null,
      descuento_especial: formData.descuento_especial || 0,
      lista_limpieza_id: formData.lista_limpieza_id || null,
      metodo_limpieza: formData.metodo_limpieza || null,
      lista_perf0_id: formData.lista_perf0_id || null,
      metodo_perf0: formData.metodo_perf0 || null,
      lista_perf_plus_id: formData.lista_perf_plus_id || null,
      metodo_perf_plus: formData.metodo_perf_plus || null,
    }

    if (editingCliente) {
      const { error } = await supabase.from("clientes").update(dataToSave).eq("id", editingCliente.id)

      if (error) {
        console.error("[v0] Error updating cliente:", error)
        alert(`Error al actualizar: ${error.message}`)
        return
      }
      fetch("/api/embed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity: "clientes", id: editingCliente.id }) }).catch(() => {})
    } else {
      const { data: newCliente, error } = await supabase.from("clientes").insert(dataToSave).select("id").single()

      if (error) {
        console.error("[v0] Error creating cliente:", error)
        alert(`Error al crear: ${error.message}`)
        return
      }
      if (newCliente?.id) fetch("/api/embed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity: "clientes", id: newCliente.id }) }).catch(() => {})
    }

    setIsDialogOpen(false)
    resetForm()
    loadClientes()
  }

  async function handleImport() {
    if (!importFile) {
      alert("Por favor seleccione un archivo para importar.")
      return
    }

    setIsImporting(true)
    try {
      const formData = new FormData()
      formData.append("file", importFile)

      const response = await fetch("/api/clientes/import", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Error en la importación.")
      }

      alert(`Importación exitosa. Se importaron ${data.count} clientes.`)
      setIsImportDialogOpen(false)
      setImportFile(null)
      loadClientes()
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setIsImporting(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Está seguro de eliminar este cliente?")) return

    const supabase = createClient()
    const { error } = await supabase.from("clientes").update({ activo: false }).eq("id", id)

    if (error) {
      console.error("[v0] Error deleting cliente:", error)
      alert(`Error al eliminar: ${error.message}`)
      return
    }

    loadClientes()
  }

  function resetForm() {
    setFormData({
      codigo_cliente: "",
      nombre_razon_social: "",
      direccion: "",
      cuit: "",
      condicion_iva: "Consumidor Final",
      metodo_facturacion: "Factura",
      localidad_id: "",
      provincia: "",
      telefono: "",
      mail: "",
      condicion_pago: "Efectivo",
      nro_iibb: "",
      exento_iibb: false,
      exento_iva: false,
      percepcion_iibb: 0,
      tipo_canal: "Minorista",
      vendedor_id: "",
      condicion_entrega: "entregamos_nosotros",
      lista_precio_id: "",
      descuento_especial: 0,
      lista_limpieza_id: "",
      metodo_limpieza: "",
      lista_perf0_id: "",
      metodo_perf0: "",
      lista_perf_plus_id: "",
      metodo_perf_plus: "",
    })
    setEditingCliente(null)
  }

  async function openClienteSheet(cliente: Cliente) {
    setSelectedCliente(cliente)
    setSheetBonifs([])
    setSheetCC(null)
    setSheetPedidos([])
    const sb = createClient()
    const [bonifRes, ccRes, pedidosRes] = await Promise.all([
      sb.from("bonificaciones").select("*").eq("cliente_id", cliente.id).eq("activo", true),
      sb.from("comprobantes_venta").select("saldo_pendiente").eq("cliente_id", cliente.id).neq("estado_pago", "pagado"),
      sb.from("pedidos").select("id, numero_pedido, fecha, estado, total").eq("cliente_id", cliente.id).neq("estado", "eliminado").order("fecha", { ascending: false }).limit(5),
    ])
    setSheetBonifs(bonifRes.data || [])
    const saldo = (ccRes.data || []).reduce((sum: number, c: any) => sum + (c.saldo_pendiente || 0), 0)
    setSheetCC(saldo)
    setSheetPedidos(pedidosRes.data || [])
  }

  function openEditDialog(cliente: Cliente) {
    setEditingCliente(cliente)
    setFormData({
      codigo_cliente: cliente.codigo_cliente || "",
      nombre_razon_social: cliente.nombre_razon_social,
      direccion: cliente.direccion || "",
      cuit: cliente.cuit || "",
      condicion_iva: cliente.condicion_iva,
      metodo_facturacion: cliente.metodo_facturacion,
      localidad_id: cliente.localidad_id || "",
      localidad: (cliente as any).localidad || cliente.localidades?.nombre || "",
      provincia: cliente.provincia || "",
      telefono: cliente.telefono || "",
      mail: cliente.mail || "",
      condicion_pago: cliente.condicion_pago,
      nro_iibb: cliente.nro_iibb || "",
      exento_iibb: cliente.exento_iibb,
      exento_iva: cliente.exento_iva,
      percepcion_iibb: cliente.percepcion_iibb,
      tipo_canal: cliente.tipo_canal,
      vendedor_id: cliente.vendedor_id || "",
      condicion_entrega: cliente.condicion_entrega || "entregamos_nosotros",
      lista_precio_id: (cliente as any).lista_precio_id || "",
      descuento_especial: (cliente as any).descuento_especial || 0,
      lista_limpieza_id: (cliente as any).lista_limpieza_id || "",
      metodo_limpieza: (cliente as any).metodo_limpieza || "",
      lista_perf0_id: (cliente as any).lista_perf0_id || "",
      metodo_perf0: (cliente as any).metodo_perf0 || "",
      lista_perf_plus_id: (cliente as any).lista_perf_plus_id || "",
      metodo_perf_plus: (cliente as any).metodo_perf_plus || "",
    })
    setBonificaciones([])
    loadBonificaciones(cliente.id)
    setIsDialogOpen(true)
  }

  function handleLocalidadChange(localidadId: string) {
    const localidad = localidades.find((l) => l.id === localidadId)
    setFormData({
      ...formData,
      localidad_id: localidadId,
      localidad: localidad?.nombre || "",
      provincia: localidad?.provincia || "",
    })
  }

  const filteredClientes = clientes.filter(
    (cliente) => {
      const searchLower = searchTerm.toLowerCase()
      return (
        cliente.nombre_razon_social.toLowerCase().includes(searchLower) ||
        cliente.localidades?.nombre?.toLowerCase().includes(searchLower) ||
        cliente.cuit?.includes(searchLower) ||
        cliente.codigo_cliente?.toLowerCase().includes(searchLower) ||
        cliente.direccion?.toLowerCase().includes(searchLower)
      )
    }
  )

  const selectedLocalidad = localidades.find((l) => l.id === formData.localidad_id)
  const zonaAsignada = selectedLocalidad?.zonas?.nombre

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" className="hover:bg-accent">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Clientes</h1>
              <p className="text-sm text-muted-foreground">Gestión de clientes y ventas</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/clientes-pedidos" className="group">
            <Card className="transition-all duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-purple-500 hover:border-l-purple-600">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-purple-50 rounded-lg group-hover:bg-purple-100 transition-colors">
                    <ShoppingBag className="h-6 w-6 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Pedidos</h3>
                    <p className="text-sm text-muted-foreground">Gestionar pedidos de clientes</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/viajes" className="group">
            <Card className="transition-all duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-orange-500 hover:border-l-orange-600">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-orange-50 rounded-lg group-hover:bg-orange-100 transition-colors">
                    <Truck className="h-6 w-6 text-orange-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Viajes</h3>
                    <p className="text-sm text-muted-foreground">Organizar entregas y rutas</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/comprobantes-venta" className="group">
            <Card className="transition-all duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-green-500 hover:border-l-green-600">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-green-50 rounded-lg group-hover:bg-green-100 transition-colors">
                    <FileText className="h-6 w-6 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Comprobantes</h3>
                    <p className="text-sm text-muted-foreground">Ver facturas de venta</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        <Card className="shadow-sm">
          <CardHeader className="border-b bg-muted/30">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <CardTitle className="text-xl">Lista de Clientes</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {filteredClientes.length} cliente{filteredClientes.length !== 1 ? "s" : ""} registrado
                  {filteredClientes.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar cliente..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-64"
                  />
                </div>
                <Dialog
                  open={isImportDialogOpen}
                  onOpenChange={(open) => {
                    setIsImportDialogOpen(open)
                    if (!open) setImportFile(null)
                  }}
                >
                  <DialogTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      <FileText className="h-4 w-4" />
                      Importar Clientes
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Importar Clientes</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-6 py-4">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm">1. Descargue la plantilla</h4>
                        <p className="text-sm text-muted-foreground">Utilice la plantilla oficial para asegurar que los datos estén en el formato correcto.</p>
                        <Button variant="secondary" onClick={() => window.open('/api/clientes/template', '_blank')}>Descargar Plantilla</Button>
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm">2. Suba el archivo con los datos</h4>
                        <p className="text-sm text-muted-foreground">El sistema procesará la lista y agregará los clientes. Las columnas requeridas no pueden estar vacías.</p>
                        <Input
                          type="file"
                          accept=".xlsx, .xls, .csv"
                          onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>Cancelar</Button>
                      <Button onClick={handleImport} disabled={!importFile || isImporting}>
                        {isImporting ? "Importando..." : "Importar"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>

                <Dialog
                  open={isDialogOpen}
                  onOpenChange={(open) => {
                    setIsDialogOpen(open)
                    if (!open) resetForm()
                  }}
                >
                  <DialogTrigger asChild>
                    <Button className="gap-2 bg-primary hover:bg-primary/90">
                      <Plus className="h-4 w-4" />
                      Nuevo Cliente
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-[95vw] w-full max-h-[95vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{editingCliente ? "Editar Cliente" : "Nuevo Cliente"}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-5">
                      {/* ── Fila 1: Identificación ── */}
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs text-slate-500">Código</Label>
                          <Input value={formData.codigo_cliente} onChange={(e) => setFormData({ ...formData, codigo_cliente: e.target.value })} placeholder="CL-001" className="h-9" />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-xs text-slate-500">Nombre / Razón Social *</Label>
                          <Input value={formData.nombre_razon_social} onChange={(e) => setFormData({ ...formData, nombre_razon_social: e.target.value })} required className="h-9" />
                        </div>
                      </div>

                      {/* ── Fila 2: Fiscal + Contacto ── */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-slate-500">CUIT</Label>
                          <Input value={formData.cuit} onChange={(e) => setFormData({ ...formData, cuit: e.target.value })} placeholder="20-12345678-9" className="h-9" />
                        </div>
                        <div>
                          <Label className="text-xs text-slate-500">Condición IVA *</Label>
                          <Select value={formData.condicion_iva} onValueChange={(v) => setFormData({ ...formData, condicion_iva: v })}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Responsable Inscripto">Responsable Inscripto</SelectItem>
                              <SelectItem value="Monotributo">Monotributo</SelectItem>
                              <SelectItem value="Consumidor Final">Consumidor Final</SelectItem>
                              <SelectItem value="Sujeto Exento">Sujeto Exento</SelectItem>
                              <SelectItem value="No Categorizado">No Categorizado</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs text-slate-500">Teléfono</Label>
                          <Input value={formData.telefono} onChange={(e) => setFormData({ ...formData, telefono: e.target.value })} className="h-9" />
                        </div>
                        <div>
                          <Label className="text-xs text-slate-500">Email</Label>
                          <Input type="email" value={formData.mail} onChange={(e) => setFormData({ ...formData, mail: e.target.value })} className="h-9" />
                        </div>
                      </div>

                      {/* ── Fila 3: Dirección ── */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <Label className="text-xs text-slate-500">Dirección</Label>
                          <Input value={formData.direccion} onChange={(e) => setFormData({ ...formData, direccion: e.target.value })} className="h-9" />
                        </div>
                        <div>
                          <Label className="text-xs text-slate-500">Localidad</Label>
                          <Select value={formData.localidad_id} onValueChange={handleLocalidadChange}>
                            <SelectTrigger className="h-9"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                            <SelectContent>
                              {localidades.map((loc) => (
                                <SelectItem key={loc.id} value={loc.id}>{loc.nombre} - {loc.provincia}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* ── Fila 4: Comercial ── */}
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs text-slate-500">Facturación *</Label>
                          <Select value={formData.metodo_facturacion} onValueChange={(v) => setFormData({ ...formData, metodo_facturacion: v })}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Factura">Factura (21% IVA)</SelectItem>
                              <SelectItem value="Final">Final (Mixto)</SelectItem>
                              <SelectItem value="Presupuesto">Presupuesto</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs text-slate-500">Lista de Precio</Label>
                          <Select value={formData.lista_precio_id || "__none__"} onValueChange={(v) => setFormData({ ...formData, lista_precio_id: v === "__none__" ? "" : v })}>
                            <SelectTrigger className="h-9"><SelectValue placeholder="Sin lista" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Sin lista</SelectItem>
                              {listasPrecio.map((lp) => <SelectItem key={lp.id} value={lp.id}>{lp.nombre}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs text-slate-500">Vendedor</Label>
                          <Select value={formData.vendedor_id || "none"} onValueChange={(v) => setFormData({ ...formData, vendedor_id: v === "none" ? "" : v })}>
                            <SelectTrigger className="h-9"><SelectValue placeholder="Sin vendedor" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Sin vendedor</SelectItem>
                              {vendedores.map((v) => <SelectItem key={v.id} value={v.id}>{v.nombre}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs text-slate-500">Condición de Pago *</Label>
                          <Select value={formData.condicion_pago} onValueChange={(v) => setFormData({ ...formData, condicion_pago: v })}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Efectivo">Efectivo</SelectItem>
                              <SelectItem value="Transferencia">Transferencia</SelectItem>
                              <SelectItem value="Cheque al día">Cheque al día</SelectItem>
                              <SelectItem value="Cheque 30 días">Cheque 30 días</SelectItem>
                              <SelectItem value="Cheque 30/60/90">Cheque 30/60/90</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs text-slate-500">Condición de Entrega *</Label>
                          <Select value={formData.condicion_entrega} onValueChange={(v) => setFormData({ ...formData, condicion_entrega: v })}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="retira_mostrador">Retira en Mostrador</SelectItem>
                              <SelectItem value="transporte">Envío por Transporte</SelectItem>
                              <SelectItem value="entregamos_nosotros">Entregamos Nosotros</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs text-slate-500">Descuento Especial (%)</Label>
                          <Input type="number" step="0.01" min="0" max="100" value={formData.descuento_especial} onChange={(e) => setFormData({ ...formData, descuento_especial: parseFloat(e.target.value) || 0 })} placeholder="0" className="h-9" />
                        </div>
                      </div>

                      {/* ── Fila 5: Fiscal extra ── */}
                      <div className="grid grid-cols-4 gap-3 items-end">
                        <div>
                          <Label className="text-xs text-slate-500">Tipo de Canal</Label>
                          <Select value={formData.tipo_canal} onValueChange={(v) => setFormData({ ...formData, tipo_canal: v })}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Mayorista">Mayorista</SelectItem>
                              <SelectItem value="Minorista">Minorista</SelectItem>
                              <SelectItem value="Consumidor Final">Consumidor Final</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs text-slate-500">N° IIBB</Label>
                          <Input value={formData.nro_iibb} onChange={(e) => setFormData({ ...formData, nro_iibb: e.target.value })} className="h-9" />
                        </div>
                        <div>
                          <Label className="text-xs text-slate-500">% Percepción IIBB</Label>
                          <Input type="number" step="0.01" value={formData.percepcion_iibb} onChange={(e) => setFormData({ ...formData, percepcion_iibb: parseFloat(e.target.value) || 0 })} className="h-9" />
                        </div>
                        <div className="flex gap-4 pb-1">
                          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                            <input type="checkbox" checked={formData.exento_iibb} onChange={(e) => setFormData({ ...formData, exento_iibb: e.target.checked })} className="h-4 w-4 rounded" />
                            Exento IIBB
                          </label>
                          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                            <input type="checkbox" checked={formData.exento_iva} onChange={(e) => setFormData({ ...formData, exento_iva: e.target.checked })} className="h-4 w-4 rounded" />
                            Exento IVA
                          </label>
                        </div>
                      </div>

                      {/* ── Segmentos ── */}
                      <div>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Condiciones por Segmento</p>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: "Limpieza / Bazar", listaKey: "lista_limpieza_id", metodoKey: "metodo_limpieza" },
                            { label: "Perfumería Perf0", listaKey: "lista_perf0_id", metodoKey: "metodo_perf0" },
                            { label: "Perfumería Plus", listaKey: "lista_perf_plus_id", metodoKey: "metodo_perf_plus" },
                          ].map(({ label, listaKey, metodoKey }) => (
                            <div key={listaKey} className="border rounded-md p-2.5 bg-slate-50 space-y-1.5">
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{label}</p>
                              <Select value={(formData as any)[metodoKey] || "__none__"} onValueChange={(v) => setFormData({ ...formData, [metodoKey]: v === "__none__" ? "" : v })}>
                                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Heredar" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">Heredar general</SelectItem>
                                  <SelectItem value="Factura (21% IVA)">Factura</SelectItem>
                                  <SelectItem value="Final (Mixto)">Final</SelectItem>
                                  <SelectItem value="Presupuesto">Presupuesto</SelectItem>
                                </SelectContent>
                              </Select>
                              <Select value={(formData as any)[listaKey] || "__none__"} onValueChange={(v) => setFormData({ ...formData, [listaKey]: v === "__none__" ? "" : v })}>
                                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Heredar lista" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">Heredar lista</SelectItem>
                                  {listasPrecio.map((lp) => <SelectItem key={lp.id} value={lp.id}>{lp.nombre}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* ── Bonificaciones (solo en edición) ── */}
                      {editingCliente && (
                        <div>
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Bonificaciones</p>

                          {/* Lista de bonificaciones existentes */}
                          {bonificaciones.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-3">
                              {bonificaciones.map((b: any) => (
                                <div key={b.id} className={`flex items-center gap-1.5 border rounded-full px-3 py-1 text-sm font-medium ${!b.activo ? "opacity-40" : ""} ${
                                  b.tipo === "mercaderia" ? "border-green-300 bg-green-50 text-green-800" :
                                  b.tipo === "general"   ? "border-blue-300 bg-blue-50 text-blue-800" :
                                                           "border-orange-300 bg-orange-50 text-orange-800"
                                }`}>
                                  <span className="capitalize">{b.tipo}</span>
                                  <span className="font-bold">{b.porcentaje}%</span>
                                  {b.segmento && <span className="text-xs opacity-70">· {b.segmento}</span>}
                                  {b.proveedores?.nombre && <span className="text-xs opacity-70 truncate max-w-[80px]">· {b.proveedores.nombre}</span>}
                                  <button type="button" onClick={() => toggleBonificacion(b.id, !b.activo, editingCliente.id)} className="ml-0.5 opacity-60 hover:opacity-100 text-xs">
                                    {b.activo ? "●" : "○"}
                                  </button>
                                  <button type="button" onClick={() => deleteBonificacion(b.id, editingCliente.id)} className="opacity-50 hover:opacity-100 hover:text-red-600">
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Nueva bonificación */}
                          <div className="flex items-end gap-2">
                            <div className="w-28">
                              <Label className="text-xs text-slate-500">Tipo</Label>
                              <Select value={newBonif.tipo} onValueChange={(v) => setNewBonif({ ...newBonif, tipo: v })}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="mercaderia">Mercadería</SelectItem>
                                  <SelectItem value="general">General</SelectItem>
                                  <SelectItem value="viajante">Viajante</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="w-20">
                              <Label className="text-xs text-slate-500">% *</Label>
                              <Input className="h-8 text-xs" type="number" step="0.01" min="0.01" max="100" placeholder="5" value={newBonif.porcentaje} onChange={(e) => setNewBonif({ ...newBonif, porcentaje: e.target.value })} />
                            </div>
                            <div className="w-36">
                              <Label className="text-xs text-slate-500">Segmento</Label>
                              <Select value={newBonif.segmento || "__none__"} onValueChange={(v) => setNewBonif({ ...newBonif, segmento: v === "__none__" ? "" : v })}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">Todos</SelectItem>
                                  <SelectItem value="limpieza_bazar">Limpieza / Bazar</SelectItem>
                                  <SelectItem value="perfumeria">Perfumería</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="w-36">
                              <Label className="text-xs text-slate-500">Proveedor</Label>
                              <Select value={newBonif.proveedor_id || "__none__"} onValueChange={(v) => setNewBonif({ ...newBonif, proveedor_id: v === "__none__" ? "" : v })}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">Todos</SelectItem>
                                  {proveedores.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex-1">
                              <Label className="text-xs text-slate-500">Obs.</Label>
                              <Input className="h-8 text-xs" placeholder="opcional" value={newBonif.observaciones} onChange={(e) => setNewBonif({ ...newBonif, observaciones: e.target.value })} />
                            </div>
                            <Button type="button" size="sm" className="h-8 px-3 shrink-0" onClick={() => addBonificacion(editingCliente.id)} disabled={!newBonif.porcentaje}>
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2 justify-end pt-2 border-t">
                        <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                          Cancelar
                        </Button>
                        <Button type="submit">{editingCliente ? "Actualizar" : "Crear"}</Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">Código</TableHead>
                    <TableHead className="font-semibold">Nombre</TableHead>
                    <TableHead className="font-semibold">Dirección</TableHead>
                    <TableHead className="font-semibold">Localidad</TableHead>
                    <TableHead className="font-semibold">Puntaje</TableHead>
                    <TableHead className="font-semibold">Nivel</TableHead>
                    <TableHead className="font-semibold">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClientes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        {searchTerm ? "No se encontraron clientes" : "No hay clientes registrados"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredClientes.map((cliente) => (
                      <TableRow
                        key={cliente.id}
                        className="hover:bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => openClienteSheet(cliente)}
                      >
                        <TableCell className="font-medium">{cliente.codigo_cliente || "-"}</TableCell>
                        <TableCell className="font-medium">{cliente.nombre_razon_social}</TableCell>
                        <TableCell className="text-muted-foreground">{cliente.direccion || "-"}</TableCell>
                        <TableCell className="text-muted-foreground">{cliente.localidades?.nombre || "-"}</TableCell>
                        <TableCell>
                          <span className="font-semibold">{cliente.puntaje.toFixed(0)}</span>
                          <span className="text-muted-foreground text-sm">/100</span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-semibold ${cliente.nivel_puntaje === "Premium"
                              ? "bg-green-100 text-green-800"
                              : cliente.nivel_puntaje === "Regular"
                                ? "bg-blue-100 text-blue-800"
                                : cliente.nivel_puntaje === "Riesgo"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                          >
                            {cliente.nivel_puntaje}
                          </span>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-2">
                            <Link href={`/clientes/${cliente.id}`}>
                              <Button variant="ghost" size="icon" className="hover:bg-blue-50 hover:text-blue-600">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Link href={`/clientes/${cliente.id}/cuenta-corriente`}>
                              <Button variant="outline" size="sm" className="hover:bg-primary/10">CC</Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(cliente.id)}
                              className="hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* ── Sheet de vista rápida ── */}
      <Sheet open={!!selectedCliente} onOpenChange={(open) => !open && setSelectedCliente(null)}>
        <SheetContent side="right" className="w-[500px] max-w-[500px] p-0 flex flex-col overflow-hidden">

          {/* ── Gradient Header ── */}
          <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-violet-700 text-white pt-12 pb-5 px-5 pr-12 shrink-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${(selectedCliente as any)?.activo ? "bg-green-400 shadow-sm" : "bg-red-400"}`} />
              <span className="text-white/60 text-xs font-semibold uppercase tracking-wider">{selectedCliente?.tipo_canal}</span>
            </div>
            <SheetTitle className="text-white text-xl font-bold leading-tight">{selectedCliente?.nombre_razon_social}</SheetTitle>
            <SheetDescription className="text-white/60 text-xs mt-0.5">
              CUIT: {selectedCliente?.cuit || "—"} · Cód: {selectedCliente?.codigo_cliente || "—"}
            </SheetDescription>
            {(selectedCliente?.direccion || selectedCliente?.localidades?.nombre) && (
              <p className="text-white/50 text-xs mt-1">
                {selectedCliente?.direccion}{selectedCliente?.localidades?.nombre ? ` · ${selectedCliente.localidades.nombre}` : ""}
              </p>
            )}

            {/* CC Balance */}
            <div className={`mt-4 rounded-xl p-3.5 border ${
              sheetCC === null ? "bg-white/10 border-white/20" :
              sheetCC > 0 ? "bg-red-500/25 border-red-400/40" :
              sheetCC < 0 ? "bg-green-500/25 border-green-400/40" :
              "bg-white/10 border-white/20"
            }`}>
              <p className="text-white/50 text-[10px] uppercase tracking-wider font-bold">Cuenta Corriente</p>
              <div className="flex items-end justify-between mt-1">
                <p className={`text-2xl font-bold ${
                  sheetCC === null ? "text-white/30" :
                  sheetCC > 0 ? "text-red-200" :
                  sheetCC < 0 ? "text-green-200" : "text-white/40"
                }`}>
                  {sheetCC === null ? "—" : `$${Math.abs(sheetCC).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`}
                </p>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  sheetCC === null ? "text-white/40 bg-white/10" :
                  sheetCC > 0 ? "text-red-100 bg-red-500/40" :
                  sheetCC < 0 ? "text-green-100 bg-green-500/40" :
                  "text-white/40 bg-white/10"
                }`}>
                  {sheetCC === null ? "cargando" : sheetCC > 0 ? "debe" : sheetCC < 0 ? "a favor" : "al día ✓"}
                </span>
              </div>
            </div>
          </div>

          {/* ── Scrollable body ── */}
          <div className="flex-1 overflow-y-auto">

            {/* Comercial grid */}
            <div className="p-4 grid grid-cols-2 gap-2.5">
              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Lista de precios</p>
                <p className="font-bold text-sm text-slate-800">
                  {listasPrecio.find((l) => l.id === (selectedCliente as any)?.lista_precio_id)?.nombre || <span className="text-slate-400 font-normal italic">Sin lista</span>}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{(selectedCliente as any)?.metodo_facturacion || "—"}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Condición de pago</p>
                <p className="font-bold text-sm text-slate-800">{selectedCliente?.condicion_pago}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedCliente?.condicion_entrega === "entregamos_nosotros" ? "Entregamos nosotros" :
                   selectedCliente?.condicion_entrega === "retira_mostrador" ? "Retira en mostrador" : "Transporte"}
                </p>
              </div>
              {selectedCliente?.vendedor_id && (
                <div className="col-span-2 bg-indigo-50 rounded-xl p-3.5 border border-indigo-100">
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-1">Vendedor asignado</p>
                  <p className="font-bold text-sm text-indigo-800">👤 {vendedores.find((v) => v.id === selectedCliente?.vendedor_id)?.nombre || "—"}</p>
                </div>
              )}
            </div>

            {/* Segmentos */}
            {((selectedCliente as any)?.lista_limpieza_id || (selectedCliente as any)?.lista_perf0_id || (selectedCliente as any)?.lista_perf_plus_id) && (
              <div className="px-4 pb-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Segmentos configurados</p>
                <div className="space-y-1.5">
                  {(selectedCliente as any)?.lista_limpieza_id && (
                    <div className="flex justify-between items-center bg-emerald-50 rounded-xl px-3.5 py-2.5 border border-emerald-100">
                      <span className="text-xs text-emerald-700 font-semibold">🧹 Limpieza / Bazar</span>
                      <span className="text-xs font-bold text-emerald-800">{listasPrecio.find((l) => l.id === (selectedCliente as any)?.lista_limpieza_id)?.nombre || "—"}</span>
                    </div>
                  )}
                  {(selectedCliente as any)?.lista_perf0_id && (
                    <div className="flex justify-between items-center bg-pink-50 rounded-xl px-3.5 py-2.5 border border-pink-100">
                      <span className="text-xs text-pink-700 font-semibold">🌸 Perfumería Perf0</span>
                      <span className="text-xs font-bold text-pink-800">{listasPrecio.find((l) => l.id === (selectedCliente as any)?.lista_perf0_id)?.nombre || "—"}</span>
                    </div>
                  )}
                  {(selectedCliente as any)?.lista_perf_plus_id && (
                    <div className="flex justify-between items-center bg-violet-50 rounded-xl px-3.5 py-2.5 border border-violet-100">
                      <span className="text-xs text-violet-700 font-semibold">✨ Perfumería Plus</span>
                      <span className="text-xs font-bold text-violet-800">{listasPrecio.find((l) => l.id === (selectedCliente as any)?.lista_perf_plus_id)?.nombre || "—"}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Bonificaciones */}
            {sheetBonifs.length > 0 && (
              <div className="px-4 pb-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Bonificaciones activas</p>
                <div className="flex flex-wrap gap-1.5">
                  {sheetBonifs.map((b: any) => (
                    <span key={b.id} className={`text-xs px-3 py-1.5 rounded-full border font-semibold ${
                      b.tipo === "mercaderia" ? "border-green-300 bg-green-50 text-green-800" :
                      b.tipo === "general" ? "border-blue-300 bg-blue-50 text-blue-800" :
                      "border-orange-300 bg-orange-50 text-orange-800"
                    }`}>
                      {b.tipo} {b.porcentaje}%{b.segmento ? ` · ${b.segmento}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Pedidos recientes */}
            {sheetPedidos.length > 0 && (
              <div className="px-4 pb-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Pedidos recientes</p>
                <div className="space-y-1.5">
                  {sheetPedidos.map((p: any) => {
                    const estadoColors: Record<string, string> = {
                      pendiente: "bg-yellow-100 text-yellow-700 border-yellow-200",
                      facturado: "bg-emerald-100 text-emerald-700 border-emerald-200",
                      entregado: "bg-green-100 text-green-700 border-green-200",
                      en_viaje: "bg-purple-100 text-purple-700 border-purple-200",
                      en_preparacion: "bg-blue-100 text-blue-700 border-blue-200",
                    }
                    const colorClass = estadoColors[p.estado] || "bg-slate-100 text-slate-600 border-slate-200"
                    return (
                      <div key={p.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-3.5 py-2.5 border border-slate-100 hover:border-slate-200 transition-colors">
                        <div>
                          <span className="text-sm font-bold text-slate-800">#{p.numero_pedido}</span>
                          <span className="text-xs text-slate-400 ml-2">{new Date(p.fecha).toLocaleDateString("es-AR")}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-700">${(p.total || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 })}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colorClass}`}>{p.estado}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Fiscal */}
            <div className="px-4 pb-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Fiscal</p>
              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Condición IVA</span>
                  <span className="font-medium text-slate-700">{selectedCliente?.condicion_iva}</span>
                </div>
                {selectedCliente?.nro_iibb && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">N° IIBB</span>
                    <span className="font-medium text-slate-700">{selectedCliente.nro_iibb}</span>
                  </div>
                )}
                {(selectedCliente?.exento_iva || selectedCliente?.exento_iibb) && (
                  <div className="flex gap-1.5 mt-1">
                    {selectedCliente?.exento_iva && <span className="text-xs bg-yellow-50 border border-yellow-200 text-yellow-700 px-2 py-0.5 rounded-full font-medium">Exento IVA</span>}
                    {selectedCliente?.exento_iibb && <span className="text-xs bg-yellow-50 border border-yellow-200 text-yellow-700 px-2 py-0.5 rounded-full font-medium">Exento IIBB</span>}
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* ── Footer ── */}
          <div className="border-t p-4 flex gap-2 shrink-0 bg-background">
            <Link href={`/clientes/${selectedCliente?.id}`} className="flex-1">
              <Button className="w-full gap-2 bg-indigo-600 hover:bg-indigo-700">
                <Pencil className="h-4 w-4" />
                Editar Ficha
              </Button>
            </Link>
            <Link href={`/clientes/${selectedCliente?.id}/cuenta-corriente`}>
              <Button variant="outline" className="gap-1.5 border-slate-300">
                <ExternalLink className="h-4 w-4" />
                CC
              </Button>
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}


