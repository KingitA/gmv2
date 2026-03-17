"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Search, Upload } from "lucide-react"
import { ImportPriceListDialog } from "@/components/articulos/ImportPriceListDialog"
import {
  calcularPrecioBase,
  calcularPrecioFinal,
  obtenerRecargoLista,
  type DatosArticulo,
  type DatosLista,
  type MetodoFacturacion,
} from "@/lib/pricing/calculator"

interface ListaPrecio {
  id: string
  nombre: string
  codigo: string
  recargo_limpieza_bazar: number
  recargo_perfumeria_negro: number
  recargo_perfumeria_blanco: number
}

// Combinación de lista + facturación que el usuario puede activar
interface ColumnaActiva {
  id: string           // ej: "bahia_Factura"
  lista: ListaPrecio
  facturacion: MetodoFacturacion
  label: string        // ej: "Bahía - Factura"
}

export default function PreciosArticulosPage() {
  const supabase = createClient()
  const [articulos, setArticulos] = useState<any[]>([])
  const [proveedores, setProveedores] = useState<any[]>([])
  const [listas, setListas] = useState<ListaPrecio[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [proveedorFiltro, setProveedorFiltro] = useState("todos")
  const [loading, setLoading] = useState(true)

  // Columnas activas (combinaciones de lista + facturación)
  const [columnasActivas, setColumnasActivas] = useState<ColumnaActiva[]>([])
  const [selectorOpen, setSelectorOpen] = useState(false)

  useEffect(() => {
    loadData()
  }, [proveedorFiltro])

  const loadData = async () => {
    setLoading(true)
    const [{ data: provs }, { data: lists }] = await Promise.all([
      supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("listas_precio").select("*").eq("activo", true).order("nombre"),
    ])
    if (provs) setProveedores(provs)
    if (lists) {
      setListas(lists)
      // Default: mostrar Bahía Presupuesto si no hay columnas activas
      if (columnasActivas.length === 0 && lists.length > 0) {
        const bahia = lists.find(l => l.codigo === "bahia")
        if (bahia) {
          setColumnasActivas([{
            id: `${bahia.codigo}_Presupuesto`,
            lista: bahia,
            facturacion: "Presupuesto",
            label: `${bahia.nombre} - Presupuesto`,
          }])
        }
      }
    }

    let query = supabase
      .from("articulos")
      .select("*, proveedor:proveedores(nombre, tipo_descuento)")
      .eq("activo", true)

    if (proveedorFiltro !== "todos") {
      query = query.eq("proveedor_id", proveedorFiltro)
    }

    const { data: arts } = await query.order("descripcion")
    if (arts) setArticulos(arts)
    setLoading(false)
  }

  // Filtrar artículos por búsqueda
  const articulosFiltrados = useMemo(() => {
    if (!searchTerm.trim()) return articulos
    const term = searchTerm.toLowerCase()
    return articulos.filter(a =>
      a.descripcion?.toLowerCase().includes(term) ||
      a.sku?.toLowerCase().includes(term) ||
      a.ean13?.includes(term)
    )
  }, [articulos, searchTerm])

  // Toggle de columna
  const toggleColumna = (lista: ListaPrecio, facturacion: MetodoFacturacion) => {
    const id = `${lista.codigo}_${facturacion}`
    const existe = columnasActivas.find(c => c.id === id)
    if (existe) {
      setColumnasActivas(prev => prev.filter(c => c.id !== id))
    } else {
      setColumnasActivas(prev => [...prev, {
        id,
        lista,
        facturacion,
        label: `${lista.nombre} - ${facturacion}`,
      }])
    }
  }

  const isColumnaActiva = (codigo: string, facturacion: MetodoFacturacion) => {
    return columnasActivas.some(c => c.id === `${codigo}_${facturacion}`)
  }

  // Calcular precio base de un artículo
  const getPrecioBase = (art: any) => {
    const datos: DatosArticulo = {
      precio_compra: art.precio_compra || 0,
      descuento1: art.descuento1 || 0,
      descuento2: art.descuento2 || 0,
      descuento3: art.descuento3 || 0,
      descuento4: art.descuento4 || 0,
      tipo_descuento: art.proveedor?.tipo_descuento || "cascada",
      porcentaje_ganancia: art.porcentaje_ganancia || 0,
      categoria: art.categoria || art.rubro || "",
      iva_compras: art.iva_compras || "factura",
      iva_ventas: art.iva_ventas || "factura",
    }
    return calcularPrecioBase(datos)
  }

  // Calcular precio final para una columna
  const getPrecioColumna = (art: any, col: ColumnaActiva) => {
    const datos: DatosArticulo = {
      precio_compra: art.precio_compra || 0,
      descuento1: art.descuento1 || 0,
      descuento2: art.descuento2 || 0,
      descuento3: art.descuento3 || 0,
      descuento4: art.descuento4 || 0,
      tipo_descuento: art.proveedor?.tipo_descuento || "cascada",
      porcentaje_ganancia: art.porcentaje_ganancia || 0,
      categoria: art.categoria || art.rubro || "",
      iva_compras: art.iva_compras || "factura",
      iva_ventas: art.iva_ventas || "factura",
    }
    const listaDatos: DatosLista = {
      recargo_limpieza_bazar: col.lista.recargo_limpieza_bazar,
      recargo_perfumeria_negro: col.lista.recargo_perfumeria_negro,
      recargo_perfumeria_blanco: col.lista.recargo_perfumeria_blanco,
    }
    return calcularPrecioFinal(datos, listaDatos, col.facturacion, 0)
  }

  const fmt = (n: number) => n > 0 ? `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"
  const fmtPct = (n: number) => n > 0 ? `${n}%` : "—"

  const facturaciones: MetodoFacturacion[] = ["Presupuesto", "Factura", "Final"]

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Lista de Precios</h1>
          <p className="text-sm text-muted-foreground">
            {articulosFiltrados.length} artículos · {columnasActivas.length} lista{columnasActivas.length !== 1 ? "s" : ""} seleccionada{columnasActivas.length !== 1 ? "s" : ""}
          </p>
        </div>
        <ImportPriceListDialog proveedores={proveedores} onImportSuccess={loadData} />
      </div>

      {/* Filtros */}
      <div className="bg-white border rounded-xl p-4 mb-4">
        <div className="flex gap-4 items-end flex-wrap">
          <div className="w-[220px]">
            <div className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Proveedor</div>
            <Select value={proveedorFiltro} onValueChange={setProveedorFiltro}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los proveedores</SelectItem>
                {proveedores.map(p => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[250px]">
            <div className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Buscar Artículo</div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar por descripción, SKU o EAN13..."
                className="pl-9"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Selector de listas */}
      <div className="bg-white border rounded-xl p-4 mb-4">
        <div className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
          Seleccioná las listas que querés ver (click para activar/desactivar)
        </div>
        <div className="flex gap-3 flex-wrap">
          {listas.map(lista => (
            <div key={lista.id} className="space-y-1.5">
              <div className="text-xs font-bold text-center">{lista.nombre}</div>
              <div className="flex gap-1.5">
                {facturaciones.map(fac => {
                  const activa = isColumnaActiva(lista.codigo, fac)
                  return (
                    <button
                      key={`${lista.codigo}_${fac}`}
                      onClick={() => toggleColumna(lista, fac)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
                        ${activa
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400"
                        }`}
                    >
                      {fac === "Presupuesto" ? "Presup." : fac}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        {columnasActivas.length > 0 && (
          <div className="flex gap-2 mt-3 flex-wrap">
            {columnasActivas.map(col => (
              <Badge key={col.id} variant="secondary" className="gap-1 text-xs">
                {col.label}
                <button onClick={() => toggleColumna(col.lista, col.facturacion)} className="ml-1 hover:text-red-500">×</button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Tabla */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-neutral-50">
                {/* Columnas fijas */}
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide sticky left-0 bg-neutral-50 z-10 min-w-[250px]">Artículo</th>
                <th className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wide min-w-[120px]">Proveedor</th>
                <th className="text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide min-w-[100px]">Precio Lista</th>
                <th className="text-center px-3 py-3 font-semibold text-xs uppercase tracking-wide min-w-[100px]">Descuentos</th>
                <th className="text-center px-3 py-3 font-semibold text-xs uppercase tracking-wide min-w-[70px]">Margen</th>
                <th className="text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide min-w-[100px] border-r-2 border-neutral-300">Precio Base</th>
                {/* Columnas dinámicas */}
                {columnasActivas.map(col => (
                  <th key={col.id} className="text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide min-w-[110px] bg-blue-50">
                    <div className="leading-tight">
                      <div>{col.lista.nombre}</div>
                      <div className="text-[10px] font-normal text-blue-600 normal-case">
                        {col.facturacion === "Presupuesto" ? "Presupuesto" : col.facturacion}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6 + columnasActivas.length} className="text-center py-12 text-muted-foreground">Cargando artículos...</td></tr>
              ) : articulosFiltrados.length === 0 ? (
                <tr><td colSpan={6 + columnasActivas.length} className="text-center py-12 text-muted-foreground">No se encontraron artículos</td></tr>
              ) : articulosFiltrados.map(art => {
                const base = getPrecioBase(art)
                const tieneDescuentos = (art.descuento1 || 0) + (art.descuento2 || 0) + (art.descuento3 || 0) + (art.descuento4 || 0) > 0
                const descStr = [art.descuento1, art.descuento2, art.descuento3, art.descuento4]
                  .filter(d => d && d > 0)
                  .map(d => `${d}%`)
                  .join(" + ")

                return (
                  <tr key={art.id} className="border-b border-neutral-100 hover:bg-neutral-50/50">
                    {/* Artículo */}
                    <td className="px-4 py-2.5 sticky left-0 bg-white z-10">
                      <div className="font-medium text-sm leading-tight">{art.descripcion}</div>
                      <div className="flex gap-2 mt-0.5">
                        <span className="text-[11px] text-muted-foreground font-mono">{art.sku}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          art.iva_ventas === "presupuesto" ? "bg-neutral-100 text-neutral-600" : "bg-blue-50 text-blue-700"
                        }`}>
                          {art.iva_ventas === "presupuesto" ? "NEGRO" : "BLANCO"}
                        </span>
                        {(art.categoria || "").toUpperCase().includes("PERFUMERIA") && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">PERF</span>
                        )}
                      </div>
                    </td>
                    {/* Proveedor */}
                    <td className="px-3 py-2.5 text-sm text-muted-foreground">{art.proveedor?.nombre || "—"}</td>
                    {/* Precio Lista (proveedor) */}
                    <td className="px-3 py-2.5 text-right font-mono text-sm">{fmt(art.precio_compra || 0)}</td>
                    {/* Descuentos */}
                    <td className="px-3 py-2.5 text-center text-xs">
                      {tieneDescuentos ? (
                        <span className="text-orange-600 font-semibold">{descStr}</span>
                      ) : "—"}
                    </td>
                    {/* Margen */}
                    <td className="px-3 py-2.5 text-center text-xs font-semibold text-green-700">
                      {fmtPct(art.porcentaje_ganancia || 0)}
                    </td>
                    {/* Precio Base */}
                    <td className="px-3 py-2.5 text-right font-bold font-mono text-sm border-r-2 border-neutral-300">
                      {fmt(base.precioBase)}
                    </td>
                    {/* Columnas dinámicas */}
                    {columnasActivas.map(col => {
                      const resultado = getPrecioColumna(art, col)
                      return (
                        <td key={col.id} className="px-3 py-2.5 text-right bg-blue-50/30">
                          <div className="font-bold font-mono text-sm">{fmt(resultado.precioUnitarioFinal)}</div>
                          {resultado.montoIvaDiscriminado > 0 && (
                            <div className="text-[10px] text-blue-600">+IVA {fmt(resultado.montoIvaDiscriminado)}</div>
                          )}
                          {resultado.ivaIncluido && (
                            <div className="text-[10px] text-neutral-400">IVA incl.</div>
                          )}
                          {resultado.descuentoNegroEnFacturaPct > 0 && (
                            <div className="text-[10px] text-red-500">-10% negro</div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
