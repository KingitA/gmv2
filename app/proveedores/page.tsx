"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Plus, Pencil, Trash2, ArrowLeft, Upload, Download, ShoppingCart, FileText, Search } from "lucide-react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import type { Proveedor } from "@/lib/types"
import * as XLSX from "xlsx"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PROVINCIAS_ARGENTINA, TIPOS_IVA_DJ, CONDICIONES_PAGO } from "@/lib/constants"

export default function ProveedoresPage() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingProveedor, setEditingProveedor] = useState<Proveedor | null>(null)
  const [importing, setImporting] = useState(false)
  const [formData, setFormData] = useState({
    nombre: "",
    sigla: "",
    codigo_proveedor: "",
    email: "",
    telefono: "",
    direccion: "",
    codigo_postal: "",
    localidad: "",
    provincia: "",
    codigo_provincia_dj: 1,
    telefono_oficina: "",
    telefono_vendedor: "",
    mail_vendedor: "",
    mail_oficina: "",
    cuit: "",
    tipo_iva: 2,
    condicion_pago_tipo: "cuenta_corriente" as "cuenta_corriente" | "contado" | "anticipado",
    plazo_dias: 30,
    plazo_desde: "fecha_factura" as "fecha_factura" | "fecha_recepcion",
    tipo_proveedor: "mercaderia_general" as "mercaderia_general" | "servicios" | "transporte",
    banco_nombre: "",
    banco_cuenta: "",
    banco_numero_cuenta: "",
    banco_tipo_cuenta: "",
    tipo_pago: [] as string[],
    retencion_iibb: 0,
    retencion_ganancias: 0,
    percepcion_iva: 0,
    percepcion_iibb: 0,
    tipo_descuento: "cascada" as "cascada" | "sobre_lista",
    default_unidad_factura: "UNIDAD" as "UNIDAD" | "BULTO" | "CAJA" | "PACK" | "DOCENA",
  })
  const [searchTerm, setSearchTerm] = useState("")

  useEffect(() => {
    loadProveedores()
  }, [])

  async function loadProveedores() {
    const supabase = createClient()
    const { data, error } = await supabase.from("proveedores").select("*").order("activo", { ascending: false }).order("nombre")

    if (error) {
      console.error("[v0] Error loading proveedores:", error)
      return
    }

    setProveedores(data || [])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const supabase = createClient()

    if (editingProveedor) {
      const { error } = await supabase.from("proveedores").update(formData).eq("id", editingProveedor.id)

      if (error) {
        console.error("[v0] Error updating proveedor:", error)
        return
      }
    } else {
      const { error } = await supabase.from("proveedores").insert([formData])

      if (error) {
        console.error("[v0] Error creating proveedor:", error)
        return
      }
    }

    setIsDialogOpen(false)
    resetForm()
    loadProveedores()
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Está seguro de eliminar este proveedor?")) return

    const supabase = createClient()
    const { error } = await supabase.from("proveedores").update({ activo: false }).eq("id", id)

    if (error) {
      console.error("[v0] Error deleting proveedor:", error)
      return
    }

    loadProveedores()
  }

  function resetForm() {
    setFormData({
      nombre: "",
      sigla: "",
      codigo_proveedor: "",
      email: "",
      telefono: "",
      direccion: "",
      codigo_postal: "",
      localidad: "",
      provincia: "",
      codigo_provincia_dj: 1,
      telefono_oficina: "",
      telefono_vendedor: "",
      mail_vendedor: "",
      mail_oficina: "",
      cuit: "",
      tipo_iva: 2,
      condicion_pago_tipo: "cuenta_corriente",
      plazo_dias: 30,
      plazo_desde: "fecha_factura",
      tipo_proveedor: "mercaderia_general",
      banco_nombre: "",
      banco_cuenta: "",
      banco_numero_cuenta: "",
      banco_tipo_cuenta: "",
      tipo_pago: [],
      retencion_iibb: 0,
      retencion_ganancias: 0,
      percepcion_iva: 0,
      percepcion_iibb: 0,
      tipo_descuento: "cascada",
      default_unidad_factura: "UNIDAD",
    })
    setEditingProveedor(null)
  }

  function openEditDialog(proveedor: Proveedor) {
    setEditingProveedor(proveedor)
    setFormData({
      nombre: proveedor.nombre,
      sigla: proveedor.sigla || "",
      codigo_proveedor: proveedor.codigo_proveedor || "",
      email: proveedor.email || "",
      telefono: proveedor.telefono || "",
      direccion: proveedor.direccion || "",
      codigo_postal: proveedor.codigo_postal || "",
      localidad: proveedor.localidad || "",
      provincia: proveedor.provincia || "",
      codigo_provincia_dj: proveedor.codigo_provincia_dj || 1,
      telefono_oficina: proveedor.telefono_oficina || "",
      telefono_vendedor: proveedor.telefono_vendedor || "",
      mail_vendedor: proveedor.mail_vendedor || "",
      mail_oficina: proveedor.mail_oficina || "",
      cuit: proveedor.cuit || "",
      tipo_iva: proveedor.tipo_iva || 2,
      condicion_pago_tipo: proveedor.condicion_pago_tipo || "cuenta_corriente",
      plazo_dias: proveedor.plazo_dias || 30,
      plazo_desde: proveedor.plazo_desde || "fecha_factura",
      tipo_proveedor: proveedor.tipo_proveedor || "mercaderia_general",
      banco_nombre: proveedor.banco_nombre || "",
      banco_cuenta: proveedor.banco_cuenta || "",
      banco_numero_cuenta: proveedor.banco_numero_cuenta || "",
      banco_tipo_cuenta: proveedor.banco_tipo_cuenta || "",
      tipo_pago: proveedor.tipo_pago || [],
      retencion_iibb: proveedor.retencion_iibb || 0,
      retencion_ganancias: proveedor.retencion_ganancias || 0,
      percepcion_iva: proveedor.percepcion_iva || 0,
      percepcion_iibb: proveedor.percepcion_iibb || 0,
      tipo_descuento: (proveedor as any).tipo_descuento || "cascada",
      default_unidad_factura: (proveedor as any).default_unidad_factura || "UNIDAD",
    })
    setIsDialogOpen(true)
  }

  function downloadTemplate() {
    const template = [
      {
        nombre: "Ejemplo Proveedor SA",
        sigla: "EJPROV",
        codigo_proveedor: "PROV001",
        cuit: "20-12345678-9",
        email: "contacto@ejemplo.com",
        telefono: "011-4444-5555",
        direccion: "Av. Ejemplo 1234",
        codigo_postal: "1234",
        localidad: "CABA",
        provincia: "Buenos Aires",
        codigo_provincia_dj: 1,
        telefono_oficina: "011-4444-5555",
        telefono_vendedor: "011-5555-6666",
        mail_vendedor: "vendedor@ejemplo.com",
        mail_oficina: "oficina@ejemplo.com",
        tipo_iva: 2,
        condicion_pago_tipo: "cuenta_corriente",
        plazo_dias: 30,
        plazo_desde: "fecha_factura",
        tipo_proveedor: "mercaderia_general",
        banco_nombre: "Banco Ejemplo",
        banco_cuenta: "Cuenta Corriente",
        banco_numero_cuenta: "123456789",
        banco_tipo_cuenta: "CC",
        tipo_pago: "transferencia,cheque",
        retencion_iibb: 3.5,
        retencion_ganancias: 2.0,
        percepcion_iva: 0,
        percepcion_iibb: 0,
        tipo_descuento: "cascada",
      },
    ]

    const ws = XLSX.utils.json_to_sheet(template)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Proveedores")

    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" })
    const blob = new Blob([wbout], { type: "application/octet-stream" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "plantilla_proveedores.xlsx"
    link.click()
    URL.revokeObjectURL(url)
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setImporting(true)

    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data)
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]
      const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[]

      const supabase = createClient()
      const proveedoresData = jsonData.map((row) => ({
        nombre: row.nombre,
        sigla: row.sigla || null,
        codigo_proveedor: row.codigo_proveedor || null,
        cuit: row.cuit || null,
        email: row.email || null,
        telefono: row.telefono || null,
        direccion: row.direccion || null,
        codigo_postal: row.codigo_postal || null,
        localidad: row.localidad || null,
        provincia: row.provincia || "",
        codigo_provincia_dj: row.codigo_provincia_dj ? Number.parseInt(row.codigo_provincia_dj) : 1,
        telefono_oficina: row.telefono_oficina || null,
        telefono_vendedor: row.telefono_vendedor || null,
        mail_vendedor: row.mail_vendedor || null,
        mail_oficina: row.mail_oficina || null,
        tipo_iva: row.tipo_iva ? Number.parseInt(row.tipo_iva) : 2,
        condicion_pago_tipo: row.condicion_pago_tipo || "cuenta_corriente",
        plazo_dias: row.plazo_dias ? Number.parseInt(row.plazo_dias) : 30,
        plazo_desde: row.plazo_desde || "fecha_factura",
        tipo_proveedor: row.tipo_proveedor || "mercaderia_general",
        banco_nombre: row.banco_nombre || null,
        banco_cuenta: row.banco_cuenta || null,
        banco_numero_cuenta: row.banco_numero_cuenta || null,
        banco_tipo_cuenta: row.banco_tipo_cuenta || null,
        tipo_pago: row.tipo_pago ? row.tipo_pago.split(",").map((t: string) => t.trim()) : null,
        retencion_iibb: row.retencion_iibb || 0,
        retencion_ganancias: row.retencion_ganancias || 0,
        percepcion_iva: row.percepcion_iva || 0,
        percepcion_iibb: row.percepcion_iibb || 0,
        tipo_descuento: row.tipo_descuento || "cascada",
      }))

      const { error } = await supabase.from("proveedores").insert(proveedoresData)

      if (error) {
        console.error("[v0] Error importing proveedores:", error)
        alert("Error al importar proveedores. Verifique el formato del archivo.")
      } else {
        alert(`Se importaron ${proveedoresData.length} proveedores correctamente`)
        loadProveedores()
      }
    } catch (error) {
      console.error("[v0] Error processing file:", error)
      alert("Error al procesar el archivo. Verifique que sea un archivo Excel válido.")
    } finally {
      setImporting(false)
      e.target.value = ""
    }
  }

  const filteredProveedores = proveedores.filter(
    (proveedor) =>
      proveedor.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      proveedor.cuit?.includes(searchTerm) ||
      proveedor.mail_oficina?.toLowerCase().includes(searchTerm.toLowerCase()),
  )

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
              <h1 className="text-2xl font-bold text-foreground">Proveedores</h1>
              <p className="text-sm text-muted-foreground">Gestión de proveedores y compras</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/ordenes-compra" className="group">
            <Card className="transition-all duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-blue-500 hover:border-l-blue-600">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
                    <ShoppingCart className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Órdenes de Compra</h3>
                    <p className="text-sm text-muted-foreground">Pedidos a proveedores</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/comprobantes" className="group">
            <Card className="transition-all duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-green-500 hover:border-l-green-600">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-green-50 rounded-lg group-hover:bg-green-100 transition-colors">
                    <FileText className="h-6 w-6 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Comprobantes</h3>
                    <p className="text-sm text-muted-foreground">Facturas y comprobantes</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/ordenes-pago" className="group">
            <Card className="transition-all duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-purple-500 hover:border-l-purple-600">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-purple-50 rounded-lg group-hover:bg-purple-100 transition-colors">
                    <Search className="h-6 w-6 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Órdenes de Pago</h3>
                    <p className="text-sm text-muted-foreground">Pagos a proveedores</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/vencimientos" className="group">
            <Card className="transition-all duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-orange-500 hover:border-l-orange-600">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-orange-50 rounded-lg group-hover:bg-orange-100 transition-colors">
                    <Search className="h-6 w-6 text-orange-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Vencimientos</h3>
                    <p className="text-sm text-muted-foreground">Agenda de pagos</p>
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
                <CardTitle className="text-xl">Lista de Proveedores</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {filteredProveedores.length} proveedor{filteredProveedores.length !== 1 ? "es" : ""} registrado
                  {filteredProveedores.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={downloadTemplate} className="gap-2 bg-transparent">
                  <Download className="h-4 w-4" />
                  Plantilla
                </Button>
                <Button variant="outline" disabled={importing} asChild>
                  <label className="cursor-pointer gap-2">
                    <Upload className="h-4 w-4" />
                    {importing ? "Importando..." : "Importar"}
                    <input type="file" accept=".xlsx,.xls" onChange={handleImport} className="hidden" />
                  </label>
                </Button>
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
                      Nuevo Proveedor
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{editingProveedor ? "Editar Proveedor" : "Nuevo Proveedor"}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-6">
                      <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Datos Básicos</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="nombre">Nombre *</Label>
                            <Input
                              id="nombre"
                              value={formData.nombre}
                              onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                              required
                            />
                          </div>
                          <div>
                            <Label htmlFor="sigla">Sigla</Label>
                            <Input
                              id="sigla"
                              value={formData.sigla}
                              onChange={(e) => setFormData({ ...formData, sigla: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="codigo_proveedor">Código Proveedor</Label>
                            <Input
                              id="codigo_proveedor"
                              value={formData.codigo_proveedor}
                              onChange={(e) => setFormData({ ...formData, codigo_proveedor: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="cuit">CUIT *</Label>
                            <Input
                              id="cuit"
                              value={formData.cuit}
                              onChange={(e) => setFormData({ ...formData, cuit: e.target.value })}
                              placeholder="20-12345678-9"
                              required
                            />
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
                            <Label htmlFor="localidad">Localidad</Label>
                            <Input
                              id="localidad"
                              value={formData.localidad}
                              onChange={(e) => setFormData({ ...formData, localidad: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="codigo_postal">Código Postal</Label>
                            <Input
                              id="codigo_postal"
                              value={formData.codigo_postal}
                              onChange={(e) => setFormData({ ...formData, codigo_postal: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="provincia">Provincia *</Label>
                            <Select
                              value={formData.provincia}
                              onValueChange={(value) => {
                                const prov = PROVINCIAS_ARGENTINA.find((p) => p.nombre === value)
                                setFormData({
                                  ...formData,
                                  provincia: value,
                                  codigo_provincia_dj: prov?.codigo || 1,
                                })
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Seleccionar provincia" />
                              </SelectTrigger>
                              <SelectContent>
                                {PROVINCIAS_ARGENTINA.map((prov) => (
                                  <SelectItem key={prov.codigo} value={prov.nombre}>
                                    {prov.nombre}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>Código Provincia (DJ)</Label>
                            <Input value={formData.codigo_provincia_dj} disabled className="bg-muted" />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Contacto</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="telefono_oficina">Teléfono Oficina</Label>
                            <Input
                              id="telefono_oficina"
                              value={formData.telefono_oficina}
                              onChange={(e) => setFormData({ ...formData, telefono_oficina: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="mail_oficina">Email Oficina</Label>
                            <Input
                              id="mail_oficina"
                              type="email"
                              value={formData.mail_oficina}
                              onChange={(e) => setFormData({ ...formData, mail_oficina: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="telefono_vendedor">Teléfono Vendedor</Label>
                            <Input
                              id="telefono_vendedor"
                              value={formData.telefono_vendedor}
                              onChange={(e) => setFormData({ ...formData, telefono_vendedor: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="mail_vendedor">Email Vendedor</Label>
                            <Input
                              id="mail_vendedor"
                              type="email"
                              value={formData.mail_vendedor}
                              onChange={(e) => setFormData({ ...formData, mail_vendedor: e.target.value })}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Datos Fiscales y Comerciales</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="tipo_descuento">Tipo de Descuento *</Label>
                            <Select
                              value={formData.tipo_descuento}
                              onValueChange={(value: "cascada" | "sobre_lista") =>
                                setFormData({ ...formData, tipo_descuento: value })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cascada">En Cascada (uno sobre otro)</SelectItem>
                                <SelectItem value="sobre_lista">
                                  Sobre Precio Lista (todos sobre el precio base)
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-1">
                              Define cómo se aplican los descuentos en los artículos de este proveedor
                            </p>
                          </div>

                          <div>
                            <Label htmlFor="default_unidad_factura">Unidad de Facturación (Default) *</Label>
                            <Select
                              value={formData.default_unidad_factura}
                              onValueChange={(value: "UNIDAD" | "BULTO" | "CAJA" | "PACK" | "DOCENA") =>
                                setFormData({ ...formData, default_unidad_factura: value })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="UNIDAD">UNIDAD (Cantidad exacta)</SelectItem>
                                <SelectItem value="BULTO">BULTO (Multiplica por un/bulto)</SelectItem>
                                <SelectItem value="CAJA">CAJA (Multiplica por un/bulto)</SelectItem>
                                <SelectItem value="PACK">PACK (Multiplica por un/bulto)</SelectItem>
                                <SelectItem value="DOCENA">DOCENA (Multiplica por 12)</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-1">
                              Se usa si el artículo no tiene configuración específica
                            </p>
                          </div>

                          <div>
                            <Label htmlFor="tipo_iva">Tipo de IVA (DJ GESTION) *</Label>
                            <Select
                              value={String(formData.tipo_iva)}
                              onValueChange={(value) => setFormData({ ...formData, tipo_iva: Number.parseInt(value) })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TIPOS_IVA_DJ.map((tipo) => (
                                  <SelectItem key={tipo.codigo} value={String(tipo.codigo)}>
                                    {tipo.codigo} - {tipo.nombre}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <Label htmlFor="condicion_pago_tipo">Condición de Pago *</Label>
                            <Select
                              value={formData.condicion_pago_tipo}
                              onValueChange={(value: "cuenta_corriente" | "contado" | "anticipado") =>
                                setFormData({ ...formData, condicion_pago_tipo: value })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CONDICIONES_PAGO.map((cond) => (
                                  <SelectItem key={cond.valor} value={cond.valor}>
                                    {cond.nombre} ({cond.codigo})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {formData.condicion_pago_tipo !== "anticipado" && (
                            <>
                              <div>
                                <Label htmlFor="plazo_dias">Días de Plazo *</Label>
                                <Input
                                  id="plazo_dias"
                                  type="number"
                                  value={formData.plazo_dias}
                                  onChange={(e) =>
                                    setFormData({ ...formData, plazo_dias: Number.parseInt(e.target.value) })
                                  }
                                  placeholder="30"
                                  required
                                />
                              </div>
                              <div>
                                <Label htmlFor="plazo_desde">Plazo desde *</Label>
                                <Select
                                  value={formData.plazo_desde}
                                  onValueChange={(value: "fecha_factura" | "fecha_recepcion") =>
                                    setFormData({ ...formData, plazo_desde: value })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="fecha_factura">Fecha de Factura</SelectItem>
                                    <SelectItem value="fecha_recepcion">Fecha de Recepción</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </>
                          )}

                          <div>
                            <Label htmlFor="tipo_proveedor">Tipo de Proveedor</Label>
                            <Select
                              value={formData.tipo_proveedor}
                              onValueChange={(value: "mercaderia_general" | "servicios" | "transporte") =>
                                setFormData({ ...formData, tipo_proveedor: value })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="mercaderia_general">Mercadería General</SelectItem>
                                <SelectItem value="servicios">Servicios</SelectItem>
                                <SelectItem value="transporte">Transporte</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="space-y-2 pt-4 border-t">
                          <h4 className="font-medium text-sm text-muted-foreground">
                            Retenciones y Percepciones (solo aplican a comprobantes con IVA)
                          </h4>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label htmlFor="retencion_ganancias">% Retención Ganancias</Label>
                              <Input
                                id="retencion_ganancias"
                                type="number"
                                step="0.01"
                                value={formData.retencion_ganancias}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    retencion_ganancias: Number.parseFloat(e.target.value) || 0,
                                  })
                                }
                                placeholder="0.00"
                              />
                            </div>
                            <div>
                              <Label htmlFor="percepcion_iva">% Percepción IVA</Label>
                              <Input
                                id="percepcion_iva"
                                type="number"
                                step="0.01"
                                value={formData.percepcion_iva}
                                onChange={(e) =>
                                  setFormData({ ...formData, percepcion_iva: Number.parseFloat(e.target.value) || 0 })
                                }
                                placeholder="0.00"
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
                                placeholder="0.00"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Datos Bancarios</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="banco_nombre">Banco</Label>
                            <Input
                              id="banco_nombre"
                              value={formData.banco_nombre}
                              onChange={(e) => setFormData({ ...formData, banco_nombre: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="banco_tipo_cuenta">Tipo de Cuenta</Label>
                            <Input
                              id="banco_tipo_cuenta"
                              value={formData.banco_tipo_cuenta}
                              onChange={(e) => setFormData({ ...formData, banco_tipo_cuenta: e.target.value })}
                              placeholder="Ej: CC, CA"
                            />
                          </div>
                          <div>
                            <Label htmlFor="banco_numero_cuenta">Número de Cuenta</Label>
                            <Input
                              id="banco_numero_cuenta"
                              value={formData.banco_numero_cuenta}
                              onChange={(e) => setFormData({ ...formData, banco_numero_cuenta: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="banco_cuenta">CBU/Alias</Label>
                            <Input
                              id="banco_cuenta"
                              value={formData.banco_cuenta}
                              onChange={(e) => setFormData({ ...formData, banco_cuenta: e.target.value })}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2 justify-end">
                        <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                          Cancelar
                        </Button>
                        <Button type="submit">{editingProveedor ? "Actualizar" : "Crear"}</Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="mb-6">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre, CUIT o email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">Nombre</TableHead>
                    <TableHead className="font-semibold">CUIT</TableHead>
                    <TableHead className="font-semibold">Email</TableHead>
                    <TableHead className="font-semibold">Teléfono</TableHead>
                    <TableHead className="text-right font-semibold">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProveedores.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        {searchTerm ? "No se encontraron proveedores" : "No hay proveedores registrados"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredProveedores.map((proveedor) => (
                      <TableRow key={proveedor.id} className="hover:bg-muted/50 transition-colors">
                        <TableCell className="font-medium">{proveedor.nombre}</TableCell>
                        <TableCell className="text-muted-foreground">{proveedor.cuit || "-"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {proveedor.mail_oficina || proveedor.email || "-"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {proveedor.telefono_oficina || proveedor.telefono || "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-2 justify-end">
                            <Link href={`/proveedores/${proveedor.id}/cuenta-corriente`}>
                              <Button variant="outline" size="sm" className="gap-2 bg-transparent">
                                <FileText className="h-4 w-4" />
                                Cta Cte
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(proveedor)}
                              className="hover:bg-blue-50 hover:text-blue-600"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(proveedor.id)}
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


