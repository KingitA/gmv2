"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Plus, Pencil, Trash2, ArrowLeft, ShoppingBag, Truck, FileText, Search } from "lucide-react"
import Link from "next/link"
import { getSupabase } from "@/lib/supabase"
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
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [formData, setFormData] = useState({
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
  })

  useEffect(() => {
    loadClientes()
    loadVendedores()
    loadLocalidades()
  }, [])

  async function loadClientes() {
    const supabase = getSupabase()
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
    const supabase = getSupabase()
    const { data, error } = await supabase.from("vendedores").select("id, nombre").eq("activo", true).order("nombre")

    if (error) {
      console.error("[v0] Error loading vendedores:", error)
      return
    }

    setVendedores(data || [])
  }

  async function loadLocalidades() {
    const supabase = getSupabase()
    const { data, error } = await supabase.from("localidades").select("*, zonas(nombre)").order("provincia, nombre")

    if (error) {
      console.error("[v0] Error loading localidades:", error)
      return
    }

    setLocalidades(data || [])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const supabase = getSupabase()

    const dataToSave = {
      ...formData,
      nombre: formData.nombre_razon_social,
      razon_social: formData.nombre_razon_social,
      vendedor_id: formData.vendedor_id && formData.vendedor_id !== "none" ? formData.vendedor_id : null,
      localidad_id: formData.localidad_id || null,
    }

    if (editingCliente) {
      const { error } = await supabase.from("clientes").update(dataToSave).eq("id", editingCliente.id)

      if (error) {
        console.error("[v0] Error updating cliente:", error)
        alert(`Error al actualizar: ${error.message}`)
        return
      }
    } else {
      const { error } = await supabase.from("clientes").insert([dataToSave])

      if (error) {
        console.error("[v0] Error creating cliente:", error)
        alert(`Error al crear: ${error.message}`)
        return
      }
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

    const supabase = getSupabase()
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
    })
    setEditingCliente(null)
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
    })
    setIsDialogOpen(true)
  }

  function handleLocalidadChange(localidadId: string) {
    const localidad = localidades.find((l) => l.id === localidadId)
    setFormData({
      ...formData,
      localidad_id: localidadId,
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
                  <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{editingCliente ? "Editar Cliente" : "Nuevo Cliente"}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-6">
                      <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Datos Básicos</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="codigo_cliente">Código de Cliente</Label>
                            <Input
                              id="codigo_cliente"
                              value={formData.codigo_cliente}
                              onChange={(e) => setFormData({ ...formData, codigo_cliente: e.target.value })}
                              placeholder="Ej: CL-001"
                            />
                          </div>
                          <div className="col-span-1">
                            <Label htmlFor="nombre_razon_social">Nombre / Razón Social *</Label>
                            <Input
                              id="nombre_razon_social"
                              value={formData.nombre_razon_social}
                              onChange={(e) => setFormData({ ...formData, nombre_razon_social: e.target.value })}
                              required
                            />
                          </div>
                          <div>
                            <Label htmlFor="cuit">CUIT</Label>
                            <Input
                              id="cuit"
                              value={formData.cuit}
                              onChange={(e) => setFormData({ ...formData, cuit: e.target.value })}
                              placeholder="20-12345678-9"
                            />
                          </div>
                          <div>
                            <Label htmlFor="tipo_canal">Tipo de Canal *</Label>
                            <Select
                              value={formData.tipo_canal}
                              onValueChange={(value) => setFormData({ ...formData, tipo_canal: value })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Mayorista">Mayorista</SelectItem>
                                <SelectItem value="Minorista">Minorista</SelectItem>
                                <SelectItem value="Consumidor Final">Consumidor Final</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Dirección</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="col-span-2">
                            <Label htmlFor="direccion">Dirección</Label>
                            <Input
                              id="direccion"
                              value={formData.direccion}
                              onChange={(e) => setFormData({ ...formData, direccion: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="localidad_id">Localidad</Label>
                            <Select value={formData.localidad_id} onValueChange={handleLocalidadChange}>
                              <SelectTrigger>
                                <SelectValue placeholder="Seleccionar localidad" />
                              </SelectTrigger>
                              <SelectContent>
                                {localidades.map((loc) => (
                                  <SelectItem key={loc.id} value={loc.id}>
                                    {loc.nombre} - {loc.provincia}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor="provincia">Provincia</Label>
                            <Input id="provincia" value={formData.provincia} disabled className="bg-muted" />
                          </div>
                          {zonaAsignada && (
                            <div className="col-span-2">
                              <Label>Zona Asignada</Label>
                              <div className="px-3 py-2 bg-blue-50 text-blue-700 rounded-md border border-blue-200">
                                {zonaAsignada}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Contacto</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="telefono">Teléfono</Label>
                            <Input
                              id="telefono"
                              value={formData.telefono}
                              onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="mail">Email</Label>
                            <Input
                              id="mail"
                              type="email"
                              value={formData.mail}
                              onChange={(e) => setFormData({ ...formData, mail: e.target.value })}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Datos Fiscales</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="condicion_iva">Condición de IVA *</Label>
                            <Select
                              value={formData.condicion_iva}
                              onValueChange={(value) => setFormData({ ...formData, condicion_iva: value })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
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
                            <Label htmlFor="metodo_facturacion">Método de Facturación *</Label>
                            <Select
                              value={formData.metodo_facturacion}
                              onValueChange={(value) => setFormData({ ...formData, metodo_facturacion: value })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Factura">Factura (21% IVA)</SelectItem>
                                <SelectItem value="Final">Final (Mixto)</SelectItem>
                                <SelectItem value="Presupuesto">Presupuesto</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor="nro_iibb">N° IIBB</Label>
                            <Input
                              id="nro_iibb"
                              value={formData.nro_iibb}
                              onChange={(e) => setFormData({ ...formData, nro_iibb: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="percepcion_iibb">% Percepción IIBB</Label>
                            <Input
                              id="percepcion_iibb"
                              type="number"
                              step="0.01"
                              value={formData.percepcion_iibb}
                              onChange={(e) =>
                                setFormData({ ...formData, percepcion_iibb: Number.parseFloat(e.target.value) || 0 })
                              }
                            />
                          </div>
                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id="exento_iibb"
                              checked={formData.exento_iibb}
                              onChange={(e) => setFormData({ ...formData, exento_iibb: e.target.checked })}
                              className="h-4 w-4"
                            />
                            <Label htmlFor="exento_iibb">Exento IIBB</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id="exento_iva"
                              checked={formData.exento_iva}
                              onChange={(e) => setFormData({ ...formData, exento_iva: e.target.checked })}
                              className="h-4 w-4"
                            />
                            <Label htmlFor="exento_iva">Exento IVA</Label>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Datos Comerciales</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="condicion_pago">Condición de Pago *</Label>
                            <Select
                              value={formData.condicion_pago}
                              onValueChange={(value) => setFormData({ ...formData, condicion_pago: value })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
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
                            <Label htmlFor="vendedor_id">Vendedor</Label>
                            <Select
                              value={formData.vendedor_id}
                              onValueChange={(value) => setFormData({ ...formData, vendedor_id: value })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Seleccionar vendedor" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Sin vendedor</SelectItem>
                                {vendedores.map((v) => (
                                  <SelectItem key={v.id} value={v.id}>
                                    {v.nombre}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-2">
                            <Label htmlFor="condicion_entrega">Condición de Entrega *</Label>
                            <Select
                              value={formData.condicion_entrega}
                              onValueChange={(value) => setFormData({ ...formData, condicion_entrega: value })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="retira_mostrador">Retira en Mostrador</SelectItem>
                                <SelectItem value="transporte">Envío por Transporte</SelectItem>
                                <SelectItem value="entregamos_nosotros">Entregamos Nosotros</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2 justify-end">
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
                    <TableHead className="font-semibold">Cuenta Corriente</TableHead>
                    <TableHead className="text-right font-semibold">Acciones</TableHead>
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
                      <TableRow key={cliente.id} className="hover:bg-muted/50 transition-colors">
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
                        <TableCell>
                          <Link href={`/clientes/${cliente.id}/cuenta-corriente`}>
                            <Button variant="outline" size="sm" className="hover:bg-primary/10">
                              Ver Cuenta
                            </Button>
                          </Link>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-2 justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(cliente)}
                              className="hover:bg-blue-50 hover:text-blue-600"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
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
    </div>
  )
}


