"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Pencil, ArrowLeft, Upload, Download, DollarSign, Search, Filter, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, History, FileSpreadsheet, Eye } from "lucide-react"
import Link from "next/link"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { getSupabase } from "@/lib/supabase"
import type { Articulo, Proveedor } from "@/lib/types"
import * as XLSX from "xlsx"
import { ArticuloProveedoresDialog } from "@/components/articulos/articulo-proveedores-dialog"

export default function ArticulosPage() {
  const [articulos, setArticulos] = useState<Articulo[]>([])
  const [totalArticulos, setTotalArticulos] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingArticulo, setEditingArticulo] = useState<Articulo | null>(null)
  const [importing, setImporting] = useState(false)
  const [importReport, setImportReport] = useState<{
    isOpen: boolean;
    insertedCount: number;
    updatedCount: number;
    duplicadosCount: number;
    skippedSkus: string[];
  }>({ isOpen: false, insertedCount: 0, updatedCount: 0, duplicadosCount: 0, skippedSkus: [] })
  const [isHistorialOpen, setIsHistorialOpen] = useState(false)
  const [historialImportaciones, setHistorialImportaciones] = useState<any[]>([])
  const [isLoadingHistorial, setIsLoadingHistorial] = useState(false)
  const [selectedImportacion, setSelectedImportacion] = useState<any | null>(null)
  const [historialTab, setHistorialTab] = useState<'pendientes' | 'historial'>('pendientes')
  const [pendingCount, setPendingCount] = useState(0)

  // Paginación
  const [paginaActual, setPaginaActual] = useState(1)
  const itemsPorPagina = 50

  const [filtroProveedor, setFiltroProveedor] = useState("all")
  const [filtroRubro, setFiltroRubro] = useState("all")
  const [filtroCategoria, setFiltroCategoria] = useState("")
  const [busqueda, setBusqueda] = useState("")

  useEffect(() => {
    loadProveedores()
  }, [])

  // Cargar artículos cuando cambian los filtros o la página
  useEffect(() => {
    const timer = setTimeout(() => {
      loadArticulos()
    }, 300)
    return () => clearTimeout(timer)
  }, [paginaActual, busqueda, filtroProveedor, filtroRubro, filtroCategoria])

  async function loadProveedores() {
    const supabase = getSupabase()
    const { data, error } = await supabase.from("proveedores").select("*").eq("activo", true).order("nombre")

    if (error) {
      console.error("[v0] Error loading proveedores:", error)
      return
    }

    setProveedores(data || [])
  }

  async function loadArticulos() {
    setIsLoading(true)
    const supabase = getSupabase()

    let query = supabase
      .from("articulos")
      .select("*, proveedor:proveedores(*)", { count: "exact" })
      .eq("activo", true)

    if (filtroProveedor !== "all") {
      query = query.eq("proveedor_id", filtroProveedor)
    }

    if (filtroRubro !== "all") {
      query = query.eq("rubro", filtroRubro)
    }

    if (filtroCategoria) {
      query = query.ilike("categoria", `%${filtroCategoria}%`)
    }

    if (busqueda) {
      query = query.or(`sku.ilike.%${busqueda}%,descripcion.ilike.%${busqueda}%`)
    }

    // Paginación
    const rangeStart = (paginaActual - 1) * itemsPorPagina
    const rangeEnd = rangeStart + itemsPorPagina - 1
    query = query.range(rangeStart, rangeEnd).order("descripcion")

    const { data, count, error } = await query

    if (error) {
      console.error("[v0] Error loading articulos:", error)
      setIsLoading(false)
      return
    }

    setArticulos(data || [])
    setTotalArticulos(count || 0)
    setIsLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const supabase = getSupabase()

    const dataToSave = {
      ...formData,
      proveedor_id: formData.proveedor_id || null,
      rubro: formData.rubro || null,
      categoria: formData.categoria || null,
      subcategoria: formData.subcategoria || null,
      orden_deposito: formData.orden_deposito ? Number(formData.orden_deposito) : null,
    }

    if (editingArticulo) {
      const { error } = await supabase.from("articulos").update(dataToSave).eq("id", editingArticulo.id)

      if (error) {
        console.error("[v0] Error updating articulo:", error)
        alert("Error al actualizar artículo")
        return
      }
    } else {
      const { error } = await supabase.from("articulos").insert([dataToSave])

      if (error) {
        console.error("[v0] Error creating articulo:", error)
        alert("Error al crear artículo")
        return
      }
    }

    setIsDialogOpen(false)
    resetForm()
    loadArticulos()
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Está seguro de eliminar este artículo?")) return

    const supabase = getSupabase()
    const { error } = await supabase.from("articulos").update({ activo: false }).eq("id", id)

    if (error) {
      console.error("[v0] Error deleting articulo:", error)
      return
    }

    loadArticulos()
  }

  function resetForm() {
    setFormData({
      sku: "",
      sigla: "",
      ean13: "",
      descripcion: "",
      proveedor_id: "",
      rubro: "",
      categoria: "",
      subcategoria: "",
      unidad_medida: "unidad",
      unidades_por_bulto: 1,
      porcentaje_ganancia: 20,
      iva_compras: "factura",
      iva_ventas: "factura",
      orden_deposito: "",
    })
    setEditingArticulo(null)
  }

  function openEditDialog(articulo: Articulo) {
    setEditingArticulo(articulo)
    setFormData({
      sku: articulo.sku,
      sigla: articulo.sigla || "",
      ean13: articulo.ean13 || "",
      descripcion: articulo.descripcion,
      proveedor_id: articulo.proveedor_id || "",
      rubro: articulo.rubro || "",
      categoria: articulo.categoria || "",
      subcategoria: articulo.subcategoria || "",
      unidad_medida: articulo.unidad_medida || "unidad",
      unidades_por_bulto: articulo.unidades_por_bulto || 1,
      porcentaje_ganancia: (articulo as any).porcentaje_ganancia || 20,
      iva_compras: (articulo as any).iva_compras || "factura",
      iva_ventas: (articulo as any).iva_ventas || "factura",
      orden_deposito: articulo.orden_deposito || "",
    })
    setIsDialogOpen(true)
  }

  function downloadTemplate() {
    const template = [
      {
        sku: "123456",
        sigla: "AB",
        ean13: "7798123456789",
        descripcion: "Ejemplo Artículo",
        proveedor_codigo: "PROV01",
        rubro: "limpieza",
        categoria: "Limpieza General",
        subcategoria: "Trapos",
        unidad_medida: "bulto",
        unidades_por_bulto: 12,
        stock_actual: 0,
        porcentaje_ganancia: 20,
        iva_compras: "factura",
        iva_ventas: "factura",
      },
    ]

    const ws = XLSX.utils.json_to_sheet(template)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Articulos")

    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" })
    const blob = new Blob([wbout], { type: "application/octet-stream" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "plantilla_articulos.xlsx"
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
      const jsonData = XLSX.utils.sheet_to_json(worksheet) as Array<{
        sku: string
        sigla?: string
        ean13?: string
        descripcion: string
        proveedor_codigo?: string
        rubro?: string
        categoria?: string
        subcategoria?: string
        unidad_medida?: "unidad" | "bulto"
        stock_actual?: number
        unidades_por_bulto?: number
        porcentaje_ganancia?: number
        iva_compras?: "factura" | "adquisicion_stock" | "mixto"
        iva_ventas?: "factura" | "presupuesto"
      }>

      // Determine what columns came in the file
      const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : []
      let importTipo = "Actualización/Creación de Artículos"
      if (headers.includes("porcentaje_ganancia") || headers.includes("iva_ventas") || headers.includes("iva_compras")) {
        importTipo = "Actualización de Precios/Impuestos"
      } else if (headers.includes("stock_actual")) {
        importTipo = "Actualización de Stock"
      }

      const supabase = getSupabase()

      const proveedorCodigos = [...new Set(jsonData.map((row) => row.proveedor_codigo).filter(Boolean))]
      let proveedorMap: Record<string, string> = {}

      if (proveedorCodigos.length > 0) {
        const { data: proveedoresData } = await supabase
          .from("proveedores")
          .select("id, codigo_proveedor")
          .in("codigo_proveedor", proveedorCodigos)

        if (proveedoresData) {
          proveedorMap = Object.fromEntries(proveedoresData.map((p: any) => [p.codigo_proveedor, p.id]))
        }
      }

      const articulosData = jsonData
        .filter((row) => row.sku !== undefined && row.sku !== null && String(row.sku).trim() !== "")
        .map((row) => {
          const articulo: any = {
            sku: String(row.sku).trim(), // SKU siempre es obligatorio
          }

          // Solo agregar campos que tienen valor en el Excel
          if (row.sigla !== undefined && row.sigla !== null && row.sigla !== "") {
            articulo.sigla = String(row.sigla).toUpperCase()
          }
          if (row.ean13 !== undefined && row.ean13 !== null && row.ean13 !== "") {
            articulo.ean13 = String(row.ean13)
          }
          if (row.descripcion !== undefined && row.descripcion !== null && row.descripcion !== "") {
            articulo.descripcion = row.descripcion
          }
          if (row.proveedor_codigo && proveedorMap[row.proveedor_codigo]) {
            articulo.proveedor_id = proveedorMap[row.proveedor_codigo]
          }
          if (row.rubro !== undefined && row.rubro !== null && row.rubro !== "") {
            articulo.rubro = row.rubro
          }
          if (row.categoria !== undefined && row.categoria !== null && row.categoria !== "") {
            articulo.categoria = row.categoria
          }
          if (row.subcategoria !== undefined && row.subcategoria !== null && row.subcategoria !== "") {
            articulo.subcategoria = row.subcategoria
          }
          if (row.unidad_medida !== undefined && row.unidad_medida !== null) {
            articulo.unidad_medida = row.unidad_medida
          }
          if (row.unidades_por_bulto !== undefined && row.unidades_por_bulto !== null) {
            articulo.unidades_por_bulto = row.unidades_por_bulto
          }
          if (row.stock_actual !== undefined && row.stock_actual !== null) {
            articulo.stock_actual = row.stock_actual
          }
          if (row.porcentaje_ganancia !== undefined && row.porcentaje_ganancia !== null) {
            articulo.porcentaje_ganancia = row.porcentaje_ganancia
          }
          if (row.iva_compras !== undefined && row.iva_compras !== null) {
            articulo.iva_compras = row.iva_compras
          }
          if (row.iva_ventas !== undefined && row.iva_ventas !== null) {
            articulo.iva_ventas = row.iva_ventas
          }

          return articulo
        })

      const skuMap = new Map<string, (typeof articulosData)[0]>()
      articulosData.forEach((articulo) => {
        skuMap.set(articulo.sku, articulo)
      })
      const articulosUnicos = Array.from(skuMap.values())

      const duplicadosCount = articulosData.length - articulosUnicos.length
      if (duplicadosCount > 0) {
        console.log(
          `[v0] Se detectaron ${duplicadosCount} SKUs duplicados en el archivo, se mantendrá el último valor de cada uno`,
        )
      }

      // 1. Fetch existentes por lotes para evitar límites de URL
      const skus = articulosUnicos.map(a => a.sku)

      let existingArticulos: any[] = []
      const chunkSize = 500
      for (let i = 0; i < skus.length; i += chunkSize) {
        const chunk = skus.slice(i, i + chunkSize)
        const { data } = await supabase
          .from("articulos")
          .select("*")
          .in("sku", chunk)
        if (data) {
          existingArticulos = [...existingArticulos, ...data]
        }
      }

      const existingMap = new Map(existingArticulos.map(a => [a.sku, a]))

      const toUpdate: any[] = []
      const toInsert: any[] = []
      const skippedSkus: string[] = []

      articulosUnicos.forEach(excelArt => {
        const existing = existingMap.get(excelArt.sku)
        if (existing) {
          // Si existe, combinamos para no borrar campos requeridos
          toUpdate.push({ ...existing, ...excelArt })
        } else {
          // Si es nuevo, requiere descripción
          if (!excelArt.descripcion) {
            skippedSkus.push(excelArt.sku)
          } else {
            toInsert.push(excelArt)
          }
        }
      })

      let insertedCount = 0
      let updatedCount = 0

      // Insertar nuevos normalizando las keys
      if (toInsert.length > 0) {
        const allInsertKeys = new Set<string>()
        toInsert.forEach(item => Object.keys(item).forEach(k => allInsertKeys.add(k)))

        const normalizedInsert = toInsert.map(item => {
          const normalized: any = {}
          allInsertKeys.forEach(k => {
            normalized[k] = item[k] !== undefined ? item[k] : null
          })
          return normalized
        })

        const { error: insertError } = await supabase.from("articulos").insert(normalizedInsert)
        if (insertError) throw new Error(`Error al insertar nuevos: ${insertError.message}`)
        insertedCount = normalizedInsert.length
      }

      // Actualizar existentes mediante upsert en lotes
      if (toUpdate.length > 0) {
        const batchSize = 500
        for (let i = 0; i < toUpdate.length; i += batchSize) {
          const batch = toUpdate.slice(i, i + batchSize)
          const { error: updateError } = await supabase.from("articulos").upsert(batch, {
            onConflict: "sku",
            ignoreDuplicates: false,
          })
          if (updateError) throw new Error(`Error al actualizar existentes (lote ${i}): ${updateError.message}`)
          updatedCount += batch.length
        }
      }

      // Guardar el historial de importacion
      try {
        let finalImportTipo = "ACTUALIZACIÓN GENERAL"
        const relevantHeaders = headers.filter(h => h !== "sku") // Ignorar SKU para el reporte

        if (insertedCount > 0 && updatedCount === 0) {
          finalImportTipo = "IMPORTACIÓN DE ARTÍCULOS NUEVOS"
        } else if (insertedCount > 0 && updatedCount > 0) {
          finalImportTipo = "ACTUALIZACIÓN E IMPORTACIÓN DE ARTÍCULOS NUEVOS"
        } else if (relevantHeaders.length === 1) {
          // Si solo se actualizó una columna (además del SKU)
          finalImportTipo = `ACTUALIZACIÓN DE ${relevantHeaders[0].toUpperCase().replace(/_/g, " ")}`
        } else if (relevantHeaders.length > 1 && relevantHeaders.length <= 3) {
          // Si son 2 o 3 columnas, las listamos
          const cols = relevantHeaders.map(h => h.toUpperCase().replace(/_/g, " ")).join(", ")
          finalImportTipo = `ACTUALIZACIÓN DE ${cols}`
        }

        await supabase.from("importaciones_articulos").insert([
          {
            archivo_nombre: file.name,
            tipo: finalImportTipo,
            columnas_afectadas: headers,
            registros_nuevos: insertedCount,
            registros_actualizados: updatedCount,
            skus_omitidos: skippedSkus
          }
        ])
      } catch (historyErr) {
        console.error("Error saving import history:", historyErr)
        // We do not throw to avoid failing the whole import success message
      }

      setImportReport({
        isOpen: true,
        insertedCount,
        updatedCount,
        duplicadosCount,
        skippedSkus,
      })
      loadArticulos()
    } catch (error: any) {
      console.error("[v0] Error processing file:", error)
      alert(error.message || "Error al procesar el archivo. Verifique que sea un archivo Excel válido.")
    } finally {
      setImporting(false)
      e.target.value = ""
    }
  }

  // Resetear página al filtrar
  useEffect(() => {
    setPaginaActual(1)
  }, [busqueda, filtroProveedor, filtroRubro, filtroCategoria])

  const totalPaginas = Math.max(1, Math.ceil(totalArticulos / itemsPorPagina))
  const indicePrimerArticulo = (paginaActual - 1) * itemsPorPagina
  const indiceUltimoArticulo = Math.min(indicePrimerArticulo + itemsPorPagina, totalArticulos)

  const [formData, setFormData] = useState({
    sku: "",
    sigla: "",
    ean13: "",
    descripcion: "",
    proveedor_id: "",
    rubro: "",
    categoria: "",
    subcategoria: "",
    unidad_medida: "unidad" as "unidad" | "bulto",
    unidades_por_bulto: 1,
    porcentaje_ganancia: 20,
    iva_compras: "factura" as "factura" | "adquisicion_stock" | "mixto",
    iva_ventas: "factura" as "factura" | "presupuesto",
    orden_deposito: "" as string | number,
  })

  async function loadHistorialImportaciones() {
    setIsLoadingHistorial(true)
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from("importaciones_articulos")
      .select("*, proveedores:proveedor_id(id, nombre)")
      .order("created_at", { ascending: false })
      .limit(100)

    if (error) {
      console.error("Error loading history:", error)
      // Fallback without join if columns don't exist yet
      const { data: fallback } = await supabase
        .from("importaciones_articulos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100)
      setHistorialImportaciones(fallback || [])
    } else {
      setHistorialImportaciones(data || [])
    }

    // Count pending
    const pending = (data || []).filter((i: any) => i.estado === 'pendiente').length
    setPendingCount(pending)

    setIsLoadingHistorial(false)
  }

  // Load pending count on mount
  useEffect(() => {
    async function loadPendingCount() {
      const supabase = getSupabase()
      const { count } = await supabase
        .from('importaciones_articulos')
        .select('*', { count: 'exact', head: true })
        .eq('estado', 'pendiente')
      setPendingCount(count || 0)
    }
    loadPendingCount()
  }, [])

  function openHistorialModal() {
    loadHistorialImportaciones()
    setIsHistorialOpen(true)
    setSelectedImportacion(null)
    setHistorialTab(pendingCount > 0 ? 'pendientes' : 'historial')
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="icon" className="hover:bg-accent">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Artículos</h1>
                <p className="text-sm text-muted-foreground">Catálogo de productos</p>
              </div>
            </div>
            <Link href="/articulos/precios">
              <Button variant="outline" className="gap-2 bg-transparent">
                <DollarSign className="h-4 w-4" />
                Gestionar Precios
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Card className="shadow-sm">
          <CardHeader className="border-b bg-muted/30">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <CardTitle className="text-xl">Catálogo de Artículos</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {totalArticulos} artículo{totalArticulos !== 1 ? "s" : ""} encontrado
                  {totalArticulos !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={downloadTemplate} className="gap-2 bg-transparent">
                  <Download className="h-4 w-4" />
                  Plantilla
                </Button>
                <Button variant="outline" onClick={openHistorialModal} className="gap-2 bg-transparent text-blue-600 border-blue-200 hover:bg-blue-50 relative">
                  <History className="h-4 w-4" />
                  Importaciones
                  {pendingCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center">
                      {pendingCount}
                    </span>
                  )}
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
                      Nuevo Artículo
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{editingArticulo ? "Editar Artículo" : "Nuevo Artículo"}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="sku">SKU (6 dígitos) *</Label>
                          <Input
                            id="sku"
                            value={formData.sku}
                            onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                            maxLength={6}
                            required
                            disabled={!!editingArticulo}
                          />
                        </div>
                        <div>
                          <Label htmlFor="sigla">Sigla (2 dígitos) *</Label>
                          <Input
                            id="sigla"
                            value={formData.sigla}
                            onChange={(e) => setFormData({ ...formData, sigla: e.target.value.toUpperCase() })}
                            maxLength={2}
                            required
                            placeholder="AB"
                          />
                        </div>
                        <div>
                          <Label htmlFor="ean13">EAN13</Label>
                          <Input
                            id="ean13"
                            value={formData.ean13}
                            onChange={(e) => setFormData({ ...formData, ean13: e.target.value })}
                            maxLength={13}
                          />
                        </div>
                        <div>
                          <Label htmlFor="orden_deposito">Orden en Depósito</Label>
                          <Input
                            id="orden_deposito"
                            type="number"
                            value={formData.orden_deposito}
                            onChange={(e) => setFormData({ ...formData, orden_deposito: e.target.value })}
                            placeholder="Ej: 1"
                          />
                        </div>
                      </div>

                      <div>
                        <Label htmlFor="descripcion">Descripción *</Label>
                        <Input
                          id="descripcion"
                          value={formData.descripcion}
                          onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                          required
                        />
                      </div>

                      <div>
                        <Label htmlFor="proveedor">Proveedor</Label>
                        <Select
                          value={formData.proveedor_id}
                          onValueChange={(value) => setFormData({ ...formData, proveedor_id: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar proveedor" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sin proveedor</SelectItem>
                            {proveedores.map((prov) => (
                              <SelectItem key={prov.id} value={prov.id}>
                                {prov.nombre}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label htmlFor="rubro">Rubro</Label>
                        <Select
                          value={formData.rubro}
                          onValueChange={(value) => setFormData({ ...formData, rubro: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar rubro" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sin rubro</SelectItem>
                            <SelectItem value="limpieza">Limpieza</SelectItem>
                            <SelectItem value="perfumeria">Perfumería</SelectItem>
                            <SelectItem value="bazar">Bazar</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="categoria">Categoría</Label>
                          <Input
                            id="categoria"
                            value={formData.categoria}
                            onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                            placeholder="Ej: Limpieza General"
                          />
                        </div>
                        <div>
                          <Label htmlFor="subcategoria">Subcategoría</Label>
                          <Input
                            id="subcategoria"
                            value={formData.subcategoria}
                            onChange={(e) => setFormData({ ...formData, subcategoria: e.target.value })}
                            placeholder="Ej: Trapos"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="unidad_medida">Unidad de Medida *</Label>
                          <Select
                            value={formData.unidad_medida}
                            onValueChange={(value: "unidad" | "bulto") =>
                              setFormData({ ...formData, unidad_medida: value })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unidad">Unidad</SelectItem>
                              <SelectItem value="bulto">Bulto</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="unidades_por_bulto">Unidades por Bulto *</Label>
                          <Input
                            id="unidades_por_bulto"
                            type="number"
                            min="1"
                            value={formData.unidades_por_bulto || ""}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                unidades_por_bulto: e.target.value ? Number.parseInt(e.target.value) : 1,
                              })
                            }
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-4 pt-4 border-t">
                        <h3 className="font-semibold text-lg">Configuración de Precios</h3>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <Label htmlFor="porcentaje_ganancia">% Ganancia *</Label>
                            <Input
                              id="porcentaje_ganancia"
                              type="number"
                              step="0.01"
                              min="0"
                              value={formData.porcentaje_ganancia || ""}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  porcentaje_ganancia: Number.parseFloat(e.target.value) || 0,
                                })
                              }
                              required
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              Margen de ganancia sobre el costo bruto
                            </p>
                          </div>
                          <div>
                            <Label htmlFor="iva_compras">IVA en Compras *</Label>
                            <Select
                              value={formData.iva_compras}
                              onValueChange={(value: "factura" | "adquisicion_stock" | "mixto") =>
                                setFormData({ ...formData, iva_compras: value })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="factura">En Factura (21%)</SelectItem>
                                <SelectItem value="adquisicion_stock">Adquisición de Stock (0%)</SelectItem>
                                <SelectItem value="mixto">Mixto (10.5%)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor="iva_ventas">IVA en Ventas *</Label>
                            <Select
                              value={formData.iva_ventas}
                              onValueChange={(value: "factura" | "presupuesto") =>
                                setFormData({ ...formData, iva_ventas: value })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="factura">Factura (discriminado)</SelectItem>
                                <SelectItem value="presupuesto">Presupuesto (incluido)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                          <p className="text-xs text-blue-800">
                            <strong>Matriz de IVA:</strong> El sistema calculará automáticamente los impuestos según la
                            combinación de IVA en compras y ventas.
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-2 justify-end">
                        <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                          Cancelar
                        </Button>
                        <Button type="submit">{editingArticulo ? "Actualizar" : "Crear"}</Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>

                <Dialog open={importReport.isOpen} onOpenChange={(open) => setImportReport(prev => ({ ...prev, isOpen: open }))}>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Reporte de Importación</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="text-sm space-y-2">
                        <p className="font-medium text-emerald-600">
                          ✓ Se actualizaron {importReport.updatedCount} artículos existentes.
                        </p>
                        {importReport.insertedCount > 0 && (
                          <p className="font-medium text-blue-600">
                            ✓ Se importaron {importReport.insertedCount} nuevos artículos.
                          </p>
                        )}
                        {importReport.duplicadosCount > 0 && (
                          <p className="text-muted-foreground">
                            Se ignoraron {importReport.duplicadosCount} filas duplicadas en el archivo.
                          </p>
                        )}
                      </div>

                      {importReport.skippedSkus.length > 0 && (
                        <div className="mt-4 border-t pt-4">
                          <p className="text-sm font-medium text-amber-600 mb-2">
                            ⚠️ Se omitieron {importReport.skippedSkus.length} artículos
                          </p>
                          <p className="text-xs text-muted-foreground mb-3">
                            Estos códigos o SKUs no existen en la base de datos y no tenían descripción en el Excel para poder ser creados.
                          </p>
                          <textarea
                            readOnly
                            className="w-full h-32 p-2 text-xs font-mono border rounded-md bg-muted/30 focus:outline-none focus:ring-1 focus:ring-ring"
                            value={importReport.skippedSkus.join('\n')}
                          />
                        </div>
                      )}

                      <div className="flex justify-end pt-2">
                        <Button onClick={() => setImportReport(prev => ({ ...prev, isOpen: false }))}>
                          Cerrar Reporte
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* HISTORIAL MODAL */}
                <Dialog open={isHistorialOpen} onOpenChange={setIsHistorialOpen}>
                  <DialogContent className="sm:max-w-[95vw] max-w-[95vw] w-full max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <History className="h-5 w-5" />
                        Importaciones de Artículos
                      </DialogTitle>
                    </DialogHeader>

                    {selectedImportacion ? (
                      <div className="space-y-6 pt-4">
                        <Button variant="ghost" className="mb-2 -ml-3 gap-2" onClick={() => setSelectedImportacion(null)}>
                          <ArrowLeft className="h-4 w-4" /> Volver al listado
                        </Button>

                        <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-4 rounded-lg border">
                          <div><span className="font-semibold text-muted-foreground">Archivo:</span> {selectedImportacion.archivo_nombre}</div>
                          <div><span className="font-semibold text-muted-foreground">Fecha:</span> {format(new Date(selectedImportacion.created_at), "dd/MM/yyyy HH:mm", { locale: es })}</div>
                          <div><span className="font-semibold text-muted-foreground">Tipo:</span> <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold">{selectedImportacion.tipo}</span></div>
                          <div><span className="font-semibold text-muted-foreground">Fuente:</span> <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${selectedImportacion.source === 'gmail' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>{selectedImportacion.source === 'gmail' ? '📧 Gmail' : '📁 Manual'}</span></div>
                          {selectedImportacion.proveedores?.nombre && (
                            <div><span className="font-semibold text-muted-foreground">Proveedor:</span> {selectedImportacion.proveedores.nombre}</div>
                          )}
                          {selectedImportacion.fecha_vigencia && (
                            <div><span className="font-semibold text-muted-foreground">Fecha Vigencia:</span> {format(new Date(selectedImportacion.fecha_vigencia + 'T12:00:00'), "dd/MM/yyyy", { locale: es })}</div>
                          )}
                          <div><span className="font-semibold text-muted-foreground">Estado:</span> <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${selectedImportacion.estado === 'pendiente' ? 'bg-amber-100 text-amber-700' : selectedImportacion.estado === 'aplicada' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'}`}>{selectedImportacion.estado === 'pendiente' ? '⏳ Pendiente' : selectedImportacion.estado === 'aplicada' ? '✅ Aplicada' : selectedImportacion.estado || 'N/A'}</span></div>
                          {!selectedImportacion.source && (
                            <div><span className="font-semibold text-muted-foreground">Columnas Importadas:</span> {Array.isArray(selectedImportacion.columnas_afectadas) ? selectedImportacion.columnas_afectadas.length : 0}</div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <Card>
                            <CardContent className="pt-6">
                              <div className="text-2xl font-bold text-emerald-600">{selectedImportacion.registros_actualizados || 0}</div>
                              <p className="text-xs text-muted-foreground">Existentes Actualizados</p>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="pt-6">
                              <div className="text-2xl font-bold text-blue-600">{selectedImportacion.registros_nuevos || 0}</div>
                              <p className="text-xs text-muted-foreground">Nuevos Insertados</p>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="pt-6">
                              <div className="text-2xl font-bold text-amber-600">{selectedImportacion.skus_omitidos?.length || 0}</div>
                              <p className="text-xs text-muted-foreground">Artículos Omitidos</p>
                            </CardContent>
                          </Card>
                        </div>

                        {Array.isArray(selectedImportacion.columnas_afectadas) && (
                          <div>
                            <h3 className="font-semibold text-md mb-2">Columnas detectadas en el archivo</h3>
                            <div className="flex flex-wrap gap-2">
                              {selectedImportacion.columnas_afectadas.map((col: string) => (
                                <span key={col} className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium ring-1 ring-inset ring-gray-500/10">
                                  {col}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Gmail source metadata */}
                        {selectedImportacion.source === 'gmail' && selectedImportacion.columnas_afectadas?.subject && (
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <h3 className="font-semibold text-sm text-blue-800 mb-2">📧 Datos del Email</h3>
                            <div className="text-sm text-blue-700 space-y-1">
                              <p><span className="font-medium">Asunto:</span> {selectedImportacion.columnas_afectadas.subject}</p>
                              <p><span className="font-medium">De:</span> {selectedImportacion.columnas_afectadas.sender_name || selectedImportacion.columnas_afectadas.sender}</p>
                              {selectedImportacion.columnas_afectadas.attachments?.length > 0 && (
                                <p><span className="font-medium">Adjuntos:</span> {selectedImportacion.columnas_afectadas.attachments.join(', ')}</p>
                              )}
                            </div>
                          </div>
                        )}

                        {selectedImportacion.skus_omitidos && selectedImportacion.skus_omitidos.length > 0 && (
                          <div className="pt-4 border-t">
                            <p className="text-sm font-medium text-amber-600 mb-2">
                              Detalle de Artículos Omitidos (No existían y no tenían descripción)
                            </p>
                            <textarea
                              readOnly
                              className="w-full h-32 p-2 text-xs font-mono border rounded-md bg-muted/10 focus:outline-none"
                              value={selectedImportacion.skus_omitidos.join('\n')}
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="pt-4">
                        {/* Tabs */}
                        <div className="flex gap-1 mb-4 border-b">
                          <button
                            onClick={() => setHistorialTab('pendientes')}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${historialTab === 'pendientes' ? 'border-amber-500 text-amber-700' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                          >
                            ⏳ Pendientes
                            {pendingCount > 0 && (
                              <span className="ml-2 bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 text-xs font-bold">{pendingCount}</span>
                            )}
                          </button>
                          <button
                            onClick={() => setHistorialTab('historial')}
                            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${historialTab === 'historial' ? 'border-blue-500 text-blue-700' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                          >
                            📋 Historial Completo
                          </button>
                        </div>

                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Fecha</TableHead>
                              <TableHead>Proveedor</TableHead>
                              <TableHead>Archivo / Asunto</TableHead>
                              <TableHead>Tipo</TableHead>
                              <TableHead>Fuente</TableHead>
                              {historialTab === 'pendientes' && <TableHead>Vigencia</TableHead>}
                              <TableHead className="text-right">Actualizados</TableHead>
                              <TableHead className="text-right">Nuevos</TableHead>
                              <TableHead className="text-center">Acciones</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {isLoadingHistorial ? (
                              <TableRow>
                                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                                  Cargando...
                                </TableCell>
                              </TableRow>
                            ) : (() => {
                              const filtered = historialTab === 'pendientes'
                                ? historialImportaciones.filter(i => i.estado === 'pendiente')
                                : historialImportaciones
                              return filtered.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                                    <div className="flex flex-col items-center gap-2">
                                      <FileSpreadsheet className="h-8 w-8 text-muted-foreground/50" />
                                      <p>{historialTab === 'pendientes' ? 'No hay importaciones pendientes 🎉' : 'No hay importaciones registradas'}</p>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ) : (
                                filtered.map((imp) => (
                                  <TableRow key={imp.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onDoubleClick={() => setSelectedImportacion(imp)}>
                                    <TableCell className="font-medium whitespace-nowrap">
                                      {format(new Date(imp.created_at), "dd/MM/yyyy HH:mm", { locale: es })}
                                    </TableCell>
                                    <TableCell className="max-w-[150px] truncate">
                                      {imp.proveedores?.nombre || imp.columnas_afectadas?.proveedor_nombre || <span className="text-muted-foreground">—</span>}
                                    </TableCell>
                                    <TableCell className="max-w-[200px] truncate" title={imp.archivo_nombre}>{imp.archivo_nombre}</TableCell>
                                    <TableCell>
                                      <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-foreground">
                                        {imp.tipo}
                                      </span>
                                    </TableCell>
                                    <TableCell>
                                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${imp.source === 'gmail' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                                        {imp.source === 'gmail' ? '📧' : '📁'}
                                      </span>
                                    </TableCell>
                                    {historialTab === 'pendientes' && (
                                      <TableCell className="whitespace-nowrap">
                                        {imp.fecha_vigencia ? format(new Date(imp.fecha_vigencia + 'T12:00:00'), "dd/MM/yyyy", { locale: es }) : <span className="text-muted-foreground">—</span>}
                                      </TableCell>
                                    )}
                                    <TableCell className="text-right text-emerald-600 font-medium">{imp.registros_actualizados || 0}</TableCell>
                                    <TableCell className="text-right text-blue-600 font-medium">{imp.registros_nuevos || 0}</TableCell>
                                    <TableCell className="text-center">
                                      <Button variant="ghost" size="icon" onClick={() => setSelectedImportacion(imp)}>
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))
                              )
                            })()}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="space-y-4 mb-6">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Filter className="h-4 w-4" />
                Filtros
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por SKU o descripción..."
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={filtroProveedor} onValueChange={setFiltroProveedor}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todos los proveedores" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los proveedores</SelectItem>
                    {proveedores.map((prov) => (
                      <SelectItem key={prov.id} value={prov.id}>
                        {prov.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filtroRubro} onValueChange={setFiltroRubro}>
                  <SelectTrigger>
                    <SelectValue placeholder="Todos los rubros" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los rubros</SelectItem>
                    <SelectItem value="limpieza">Limpieza</SelectItem>
                    <SelectItem value="perfumeria">Perfumería</SelectItem>
                    <SelectItem value="bazar">Bazar</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Filtrar por categoría..."
                  value={filtroCategoria}
                  onChange={(e) => setFiltroCategoria(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">SKU</TableHead>
                    <TableHead className="font-semibold">Descripción</TableHead>
                    <TableHead className="font-semibold">Proveedor</TableHead>
                    <TableHead className="font-semibold text-right">Stock</TableHead>
                    <TableHead className="text-right font-semibold">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        Cargando artículos...
                      </TableCell>
                    </TableRow>
                  ) : articulos.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        {busqueda || filtroProveedor !== "all" || filtroRubro !== "all" || filtroCategoria
                          ? "No se encontraron artículos con los filtros aplicados"
                          : "No hay artículos registrados"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    articulos.map((articulo) => (
                      <TableRow key={articulo.id} className="hover:bg-muted/50 transition-colors">
                        <TableCell className="font-mono font-medium">{articulo.sku}</TableCell>
                        <TableCell>{articulo.descripcion}</TableCell>
                        <TableCell className="text-muted-foreground">{articulo.proveedor?.nombre || "-"}</TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`font-semibold ${(articulo.stock_actual ?? 0) <= 0
                              ? "text-red-600"
                              : (articulo.stock_actual ?? 0) < 10
                                ? "text-yellow-600"
                                : "text-green-600"
                              }`}
                          >
                            {articulo.stock_actual}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <ArticuloProveedoresDialog articulo={articulo} />
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(articulo)}
                              className="hover:bg-blue-50 hover:text-blue-600"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {totalPaginas > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between mt-4 gap-4">
                <div className="text-sm text-muted-foreground w-full sm:w-auto text-center sm:text-left">
                  Mostrando {indicePrimerArticulo + 1} a {indiceUltimoArticulo} de {totalArticulos} artículos
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setPaginaActual(1)}
                    disabled={paginaActual === 1}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setPaginaActual(p => Math.max(1, p - 1))}
                    disabled={paginaActual === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm font-medium mx-2 px-2">
                    Página {paginaActual} de {totalPaginas}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setPaginaActual(p => Math.min(totalPaginas, p + 1))}
                    disabled={paginaActual === totalPaginas}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setPaginaActual(totalPaginas)}
                    disabled={paginaActual === totalPaginas}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}


