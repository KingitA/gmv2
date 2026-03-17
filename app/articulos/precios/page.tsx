"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Search, Save, ChevronLeft, ChevronRight } from "lucide-react"
import { ImportPriceListDialog } from "@/components/articulos/ImportPriceListDialog"
import {
  calcularPrecioBase,
  calcularPrecioFinal,
  type DatosArticulo,
  type DatosLista,
  type MetodoFacturacion,
} from "@/lib/pricing/calculator"

interface ListaPrecio {
  id: string; nombre: string; codigo: string
  recargo_limpieza_bazar: number; recargo_perfumeria_negro: number; recargo_perfumeria_blanco: number
}

interface ColumnaActiva {
  id: string; lista: ListaPrecio; facturacion: MetodoFacturacion; label: string
}

const PAGE_SIZE = 50

export default function PreciosArticulosPage() {
  const supabase = createClient()
  const [articulos, setArticulos] = useState<any[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [proveedores, setProveedores] = useState<any[]>([])
  const [listas, setListas] = useState<ListaPrecio[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [searchDebounced, setSearchDebounced] = useState("")
  const [proveedorFiltro, setProveedorFiltro] = useState("todos")
  const [loading, setLoading] = useState(true)
  const [columnasActivas, setColumnasActivas] = useState<ColumnaActiva[]>([])
  const [editados, setEditados] = useState<Map<string, Record<string, number>>>(new Map())
  const [guardando, setGuardando] = useState(false)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setSearchDebounced(searchTerm); setPage(0) }, 400)
    return () => clearTimeout(t)
  }, [searchTerm])

  // Load proveedores y listas una vez
  useEffect(() => {
    (async () => {
      const [{ data: provs }, { data: lists }] = await Promise.all([
        supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre"),
        supabase.from("listas_precio").select("*").eq("activo", true).order("nombre"),
      ])
      if (provs) setProveedores(provs)
      if (lists) {
        setListas(lists)
        const bahia = lists.find((l: any) => l.codigo === "bahia")
        if (bahia) setColumnasActivas([{ id: `${bahia.codigo}_Presupuesto`, lista: bahia, facturacion: "Presupuesto", label: `${bahia.nombre} - Presupuesto` }])
      }
    })()
  }, [])

  // Load articulos con paginación
  useEffect(() => { loadArticulos() }, [proveedorFiltro, searchDebounced, page])

  const loadArticulos = async () => {
    setLoading(true)
    let query = supabase
      .from("articulos")
      .select("*, proveedor:proveedores(nombre, tipo_descuento)", { count: "exact" })
      .eq("activo", true)

    if (proveedorFiltro !== "todos") query = query.eq("proveedor_id", proveedorFiltro)
    if (searchDebounced.trim()) {
      const term = searchDebounced.trim()
      query = query.or(`descripcion.ilike.%${term}%,sku.ilike.%${term}%,ean13.ilike.%${term}%`)
    }

    const { data, count } = await query
      .order("descripcion")
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    setArticulos(data || [])
    setTotalCount(count || 0)
    setLoading(false)
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  // Editar campo de un artículo
  const editarCampo = (artId: string, campo: string, valor: number) => {
    setEditados(prev => {
      const next = new Map(prev)
      const existing = next.get(artId) || {}
      next.set(artId, { ...existing, [campo]: valor })
      return next
    })
    setArticulos(prev => prev.map(a => a.id === artId ? { ...a, [campo]: valor } : a))
  }

  // Guardar cambios
  const guardarCambios = async () => {
    if (editados.size === 0) return
    setGuardando(true)
    let errores = 0
    for (const [artId, campos] of editados.entries()) {
      const { error } = await supabase.from("articulos").update(campos).eq("id", artId)
      if (error) errores++
    }
    setGuardando(false)
    if (errores > 0) alert(`${errores} error(es) al guardar`)
    else {
      setEditados(new Map())
      alert(`${editados.size} artículo(s) actualizados`)
    }
  }

  const toggleColumna = (lista: ListaPrecio, facturacion: MetodoFacturacion) => {
    const id = `${lista.codigo}_${facturacion}`
    setColumnasActivas(prev => prev.find(c => c.id === id)
      ? prev.filter(c => c.id !== id)
      : [...prev, { id, lista, facturacion, label: `${lista.nombre} - ${facturacion}` }])
  }

  const isColumnaActiva = (codigo: string, fac: MetodoFacturacion) => columnasActivas.some(c => c.id === `${codigo}_${fac}`)

  const getDatosArticulo = (art: any): DatosArticulo => ({
    precio_compra: art.precio_compra || 0,
    descuento1: art.descuento1 || 0, descuento2: art.descuento2 || 0,
    descuento3: art.descuento3 || 0, descuento4: art.descuento4 || 0,
    tipo_descuento: art.proveedor?.tipo_descuento || "cascada",
    porcentaje_ganancia: art.porcentaje_ganancia || 0,
    categoria: art.categoria || art.rubro || "",
    iva_compras: art.iva_compras || "factura",
    iva_ventas: art.iva_ventas || "factura",
  })

  const fmt = (n: number) => n > 0 ? `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"
  const facturaciones: MetodoFacturacion[] = ["Presupuesto", "Factura", "Final"]

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold">Lista de Precios</h1>
          <p className="text-sm text-muted-foreground">{totalCount} artículos · Página {page + 1} de {totalPages || 1}</p>
        </div>
        <div className="flex gap-2">
          <ImportPriceListDialog proveedores={proveedores} onImportSuccess={loadArticulos} />
          {editados.size > 0 && (
            <Button onClick={guardarCambios} disabled={guardando} className="gap-2 bg-green-600 hover:bg-green-700">
              <Save className="h-4 w-4" />
              Guardar ({editados.size})
            </Button>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border rounded-xl p-4 mb-4 flex gap-4 items-end flex-wrap">
        <div className="w-[220px]">
          <div className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Proveedor</div>
          <Select value={proveedorFiltro} onValueChange={v => { setProveedorFiltro(v); setPage(0) }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los proveedores</SelectItem>
              {proveedores.map(p => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[250px]">
          <div className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Buscar</div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Descripción, SKU o EAN13..." className="pl-9" />
          </div>
        </div>
      </div>

      {/* Selector listas */}
      <div className="bg-white border rounded-xl p-4 mb-4">
        <div className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Listas a comparar</div>
        <div className="flex gap-4 flex-wrap">
          {listas.map(lista => (
            <div key={lista.id} className="space-y-1.5">
              <div className="text-xs font-bold text-center">{lista.nombre}</div>
              <div className="flex gap-1.5">
                {facturaciones.map(fac => (
                  <button key={`${lista.codigo}_${fac}`} onClick={() => toggleColumna(lista, fac)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${isColumnaActiva(lista.codigo, fac) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400"}`}>
                    {fac === "Presupuesto" ? "Presup." : fac}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-neutral-50">
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide sticky left-0 bg-neutral-50 z-10 min-w-[220px]">Artículo</th>
                <th className="text-left px-2 py-3 font-semibold text-xs uppercase tracking-wide min-w-[100px]">Proveedor</th>
                <th className="text-right px-2 py-3 font-semibold text-xs uppercase tracking-wide min-w-[110px]">Precio Lista</th>
                <th className="text-center px-2 py-3 font-semibold text-xs uppercase tracking-wide min-w-[180px]">Descuentos</th>
                <th className="text-center px-2 py-3 font-semibold text-xs uppercase tracking-wide min-w-[80px]">Margen</th>
                <th className="text-right px-2 py-3 font-semibold text-xs uppercase tracking-wide min-w-[100px] border-r-2 border-neutral-300">Precio Base</th>
                {columnasActivas.map(col => (
                  <th key={col.id} className="text-right px-3 py-3 font-semibold text-xs uppercase tracking-wide min-w-[110px] bg-blue-50">
                    <div className="leading-tight"><div>{col.lista.nombre}</div><div className="text-[10px] font-normal text-blue-600 normal-case">{col.facturacion}</div></div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6 + columnasActivas.length} className="text-center py-12 text-muted-foreground">Cargando...</td></tr>
              ) : articulos.length === 0 ? (
                <tr><td colSpan={6 + columnasActivas.length} className="text-center py-12 text-muted-foreground">No se encontraron artículos</td></tr>
              ) : articulos.map(art => {
                const datos = getDatosArticulo(art)
                const base = calcularPrecioBase(datos)
                const isEdited = editados.has(art.id)

                return (
                  <tr key={art.id} className={`border-b border-neutral-100 hover:bg-neutral-50/50 ${isEdited ? "bg-yellow-50/50" : ""}`}>
                    <td className="px-4 py-2 sticky left-0 bg-white z-10">
                      <div className="font-medium text-[13px] leading-tight">{art.descripcion}</div>
                      <div className="flex gap-1.5 mt-0.5">
                        <span className="text-[11px] text-muted-foreground font-mono">{art.sku}</span>
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${art.iva_ventas === "presupuesto" ? "bg-neutral-100 text-neutral-500" : "bg-blue-50 text-blue-600"}`}>
                          {art.iva_ventas === "presupuesto" ? "NEG" : "BLA"}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">{art.proveedor?.nombre || "—"}</td>
                    {/* Precio Lista — editable */}
                    <td className="px-2 py-2">
                      <input type="number" step="0.01"
                        className="w-full text-right text-sm font-mono bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-blue-500 focus:outline-none py-0.5 px-1 rounded"
                        value={art.precio_compra || ""}
                        onChange={e => editarCampo(art.id, "precio_compra", parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    {/* Descuentos — editables */}
                    <td className="px-1 py-2">
                      <div className="flex gap-0.5 justify-center">
                        {["descuento1", "descuento2", "descuento3", "descuento4"].map(d => (
                          <input key={d} type="number" step="0.1"
                            className="w-[42px] text-center text-xs font-mono bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-blue-500 focus:outline-none py-0.5 rounded"
                            value={(art as any)[d] || ""}
                            placeholder="—"
                            onChange={e => editarCampo(art.id, d, parseFloat(e.target.value) || 0)}
                          />
                        ))}
                      </div>
                    </td>
                    {/* Margen — editable */}
                    <td className="px-2 py-2">
                      <input type="number" step="0.1"
                        className="w-full text-center text-xs font-semibold text-green-700 bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-blue-500 focus:outline-none py-0.5 rounded"
                        value={art.porcentaje_ganancia || ""}
                        placeholder="—"
                        onChange={e => editarCampo(art.id, "porcentaje_ganancia", parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    {/* Precio Base — calculado */}
                    <td className="px-2 py-2 text-right font-bold font-mono text-sm border-r-2 border-neutral-300">{fmt(base.precioBase)}</td>
                    {/* Columnas dinámicas */}
                    {columnasActivas.map(col => {
                      const listaDatos: DatosLista = { recargo_limpieza_bazar: col.lista.recargo_limpieza_bazar, recargo_perfumeria_negro: col.lista.recargo_perfumeria_negro, recargo_perfumeria_blanco: col.lista.recargo_perfumeria_blanco }
                      const r = calcularPrecioFinal(datos, listaDatos, col.facturacion, 0)
                      return (
                        <td key={col.id} className="px-3 py-2 text-right bg-blue-50/30">
                          <div className="font-bold font-mono text-sm">{fmt(r.precioUnitarioFinal)}</div>
                          {r.montoIvaDiscriminado > 0 && <div className="text-[10px] text-blue-600">+IVA {fmt(r.montoIvaDiscriminado)}</div>}
                          {r.ivaIncluido && <div className="text-[10px] text-neutral-400">IVA incl.</div>}
                          {r.descuentoNegroEnFacturaPct > 0 && <div className="text-[10px] text-red-500">-10%</div>}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-neutral-50">
            <div className="text-xs text-muted-foreground">
              Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} de {totalCount}
            </div>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number
                if (totalPages <= 7) pageNum = i
                else if (page < 3) pageNum = i
                else if (page > totalPages - 4) pageNum = totalPages - 7 + i
                else pageNum = page - 3 + i
                return (
                  <Button key={pageNum} variant={pageNum === page ? "default" : "outline"} size="sm"
                    className="w-8 h-8 p-0 text-xs" onClick={() => setPage(pageNum)}>
                    {pageNum + 1}
                  </Button>
                )
              })}
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
