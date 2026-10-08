"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Plus, Pencil, Trash2, ArrowLeft, Upload, Download, ShoppingCart, FileText, Search, History, ShieldCheck } from "lucide-react"
import { FichaFiscalDialog } from "@/components/proveedores/ficha-fiscal-dialog"
import { FichaProveedor } from "@/components/proveedores/ficha-proveedor"
import { ImportProveedoresDialog, proveedoresFieldLabel } from "@/components/proveedores/ImportProveedoresDialog"
import { HistorialImportacionesDialog } from "@/components/import/HistorialImportacionesDialog"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import type { Proveedor } from "@/lib/types"
import * as XLSX from "xlsx"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PROVINCIAS_ARGENTINA, TIPOS_IVA_DJ, CONDICIONES_PAGO } from "@/lib/constants"
import { useRealtime } from "@/lib/hooks/use-realtime"

export default function ProveedoresPage() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingProveedor, setEditingProveedor] = useState<Proveedor | null>(null)
  const [importing, setImporting] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [isHistorialOpen, setIsHistorialOpen] = useState(false)
  const [fichaFiscal, setFichaFiscal] = useState<{ id: string; nombre: string } | null>(null)
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
  // Motor unificado: el endpoint decide qué matchea (ids); filtramos el array cargado.
  const [searchIds, setSearchIds] = useState<Set<string> | null>(null)

  useEffect(() => {
    loadProveedores()
  }, [])
  // En vivo: altas/cambios de proveedores hechos desde otra PC
  useRealtime(["proveedores"], () => loadProveedores(), { esperaMs: 1500 })

  useEffect(() => {
    const q = searchTerm.trim()
    if (q.length < 2) { setSearchIds(null); return }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/proveedores/buscar?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        const data = res.ok ? await res.json() : []
        setSearchIds(new Set((Array.isArray(data) ? data : []).map((p: any) => p.id)))
      } catch (e: any) {
        if (e?.name !== "AbortError") setSearchIds(new Set())
      }
    }, 250)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [searchTerm])

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
      fetch("/api/embed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity: "proveedores", id: editingProveedor.id }) }).catch(() => {})
    } else {
      const { data: newProv, error } = await supabase.from("proveedores").insert(formData).select("id").single()

      if (error) {
        console.error("[v0] Error creating proveedor:", error)
        return
      }
      if (newProv?.id) fetch("/api/embed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity: "proveedores", id: newProv.id }) }).catch(() => {})
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


  const filteredProveedores = searchIds === null
    ? proveedores
    : proveedores.filter((proveedor) => searchIds.has(proveedor.id))

  return (
    <div className="min-h-screen">
      <main className="container mx-auto space-y-6 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azul-900 sm:text-3xl">Fichas de proveedores</h1>
          <p className="text-sm text-neutro-500">Datos, condiciones de compra, fiscal y cuenta corriente</p>
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
                <Button variant="outline" className="gap-2" onClick={() => setIsImportDialogOpen(true)}>
                  <Upload className="h-4 w-4" />
                  Importar
                </Button>
                <Button variant="outline" className="gap-2" onClick={() => setIsHistorialOpen(true)}>
                  <History className="h-4 w-4" />
                  Historial
                </Button>
                <ImportProveedoresDialog
                  open={isImportDialogOpen}
                  onOpenChange={setIsImportDialogOpen}
                  onImportComplete={loadProveedores}
                />
                <HistorialImportacionesDialog
                  open={isHistorialOpen}
                  onOpenChange={setIsHistorialOpen}
                  modulo="proveedores"
                  claveLabel="Código"
                  nombreLabel="Nombre"
                  statuses={["actualizado", "sin_cambios", "no_encontrado", "error"]}
                  fieldLabel={proveedoresFieldLabel}
                />
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
                  <DialogContent className="flex h-[min(92dvh,900px)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
                    {/* Ficha de proveedor: solo presentación, mismo formData y mismo handleSubmit */}
                    <FichaProveedor
                      formData={formData}
                      setFormData={setFormData}
                      editando={!!editingProveedor}
                      onSubmit={handleSubmit}
                      onCancelar={() => setIsDialogOpen(false)}
                      onFichaFiscal={editingProveedor ? () => setFichaFiscal({ id: editingProveedor.id, nombre: editingProveedor.nombre }) : undefined}
                    />
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
                              onClick={() => setFichaFiscal({ id: proveedor.id, nombre: proveedor.nombre })}
                              className="hover:bg-indigo-50 hover:text-indigo-600"
                              title="Ficha fiscal (RG 830, exclusiones, legajo)"
                            >
                              <ShieldCheck className="h-4 w-4" />
                            </Button>
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

      <FichaFiscalDialog
        proveedorId={fichaFiscal?.id ?? null}
        proveedorNombre={fichaFiscal?.nombre ?? ""}
        open={!!fichaFiscal}
        onOpenChange={(o) => { if (!o) setFichaFiscal(null) }}
      />
    </div>
  )
}


