"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Search, Save, ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react"
import { ImportPriceListDialog } from "@/components/articulos/ImportPriceListDialog"
import {
  calcularPrecioBase,
  calcularPrecioFinal,
  articuloToDatosArticulo,
  resumirDescuentos,
  type DatosLista,
  type MetodoFacturacion,
  type DescuentoTipado,
} from "@/lib/pricing/calculator"

interface ListaPrecio {
  id: string; nombre: string; codigo: string
  recargo_limpieza_bazar: number; recargo_perfumeria_negro: number; recargo_perfumeria_blanco: number
}
interface ColumnaActiva {
  id: string; lista: ListaPrecio; facturacion: MetodoFacturacion; label: string
}

const PAGE_SIZE = 50
const TIPO_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  comercial: { bg: "bg-blue-100", text: "text-blue-700", label: "COM" },
  financiero: { bg: "bg-green-100", text: "text-green-700", label: "FIN" },
  promocional: { bg: "bg-purple-100", text: "text-purple-700", label: "PRO" },
}

export default function PreciosArticulosPage() {
  const supabase = createClient()
  const [articulos, setArticulos] = useState<any[]>([])
  const [descuentosMap, setDescuentosMap] = useState<Record<string, DescuentoTipado[]>>({})
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

  // Modal descuentos
  const [descModalArt, setDescModalArt] = useState<any>(null)
  const [descModalItems, setDescModalItems] = useState<DescuentoTipado[]>([])
  const [descModalSaving, setDescModalSaving] = useState(false)

  // Modal ficha artículo
  const [fichaArt, setFichaArt] = useState<any>(null)
  const [fichaForm, setFichaForm] = useState<Record<string, any>>({})
  const [fichaSaving, setFichaSaving] = useState(false)

  // Columnas visibles
  const [colsVisibles, setColsVisibles] = useState<Record<string, boolean>>({
    proveedor: true, iva_c: true, iva_v: true, precio_lista: true,
    descuentos: true, margen: true, bonif_rec: true, precio_base: true,
  })

  useEffect(() => {
    const t = setTimeout(() => { setSearchDebounced(searchTerm); setPage(0) }, 400)
    return () => clearTimeout(t)
  }, [searchTerm])

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

  useEffect(() => { loadArticulos() }, [proveedorFiltro, searchDebounced, page])

  const loadArticulos = async () => {
    setLoading(true)
    let query = supabase.from("articulos")
      .select("*, proveedor:proveedores(nombre, tipo_descuento)", { count: "exact" })
      .eq("activo", true)
    if (proveedorFiltro !== "todos") query = query.eq("proveedor_id", proveedorFiltro)
    if (searchDebounced.trim()) query = query.or(`descripcion.ilike.%${searchDebounced.trim()}%,sku.ilike.%${searchDebounced.trim()}%,ean13.ilike.%${searchDebounced.trim()}%`)

    const { data, count } = await query.order("descripcion").range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    const arts = data || []
    setArticulos(arts)
    setTotalCount(count || 0)

    // Cargar descuentos para estos artículos
    if (arts.length > 0) {
      const ids = arts.map((a: any) => a.id)
      const { data: descs } = await supabase.from("articulos_descuentos").select("*").in("articulo_id", ids).order("orden")
      const map: Record<string, DescuentoTipado[]> = {}
      for (const d of (descs || [])) {
        if (!map[d.articulo_id]) map[d.articulo_id] = []
        map[d.articulo_id].push({ tipo: d.tipo, porcentaje: d.porcentaje, orden: d.orden })
      }
      setDescuentosMap(map)
    }
    setLoading(false)
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  const editarCampo = (artId: string, campo: string, valor: number) => {
    setEditados(prev => { const n = new Map(prev); n.set(artId, { ...(n.get(artId) || {}), [campo]: valor }); return n })
    setArticulos(prev => prev.map(a => a.id === artId ? { ...a, [campo]: valor } : a))
  }

  const guardarCambios = async () => {
    if (editados.size === 0) return
    setGuardando(true)
    let ok = 0
    for (const [artId, campos] of editados.entries()) {
      const { error } = await supabase.from("articulos").update(campos).eq("id", artId)
      if (!error) ok++
    }
    setGuardando(false)
    setEditados(new Map())
    alert(`${ok} artículo(s) actualizados`)
  }

  // ─── Modal descuentos ───
  const openDescModal = (art: any) => {
    setDescModalArt(art)
    setDescModalItems([...(descuentosMap[art.id] || [])])
  }

  const addDescuento = (tipo: "comercial" | "financiero" | "promocional") => {
    const maxOrden = descModalItems.length > 0 ? Math.max(...descModalItems.map(d => d.orden)) : 0
    setDescModalItems(prev => [...prev, { tipo, porcentaje: 0, orden: maxOrden + 1 }])
  }

  const removeDescuento = (idx: number) => {
    setDescModalItems(prev => prev.filter((_, i) => i !== idx))
  }

  const updateDescuento = (idx: number, porcentaje: number) => {
    setDescModalItems(prev => prev.map((d, i) => i === idx ? { ...d, porcentaje } : d))
  }

  const saveDescuentos = async () => {
    if (!descModalArt) return
    setDescModalSaving(true)
    // Borrar existentes
    await supabase.from("articulos_descuentos").delete().eq("articulo_id", descModalArt.id)
    // Insertar nuevos
    const validItems = descModalItems.filter(d => d.porcentaje > 0)
    if (validItems.length > 0) {
      await supabase.from("articulos_descuentos").insert(
        validItems.map((d, i) => ({ articulo_id: descModalArt.id, tipo: d.tipo, porcentaje: d.porcentaje, orden: i + 1 }))
      )
    }
    // Actualizar mapa local
    setDescuentosMap(prev => ({ ...prev, [descModalArt.id]: validItems.map((d, i) => ({ ...d, orden: i + 1 })) }))
    setDescModalSaving(false)
    setDescModalArt(null)
  }

  // Ficha artículo
  const openFicha = (art: any) => {
    setFichaArt(art)
    setFichaForm({
      descripcion: art.descripcion || "",
      sku: art.sku || "",
      precio_compra: art.precio_compra || 0,
      porcentaje_ganancia: art.porcentaje_ganancia || 0,
      bonif_recargo: art.bonif_recargo || 0,
      iva_compras: art.iva_compras || "factura",
      iva_ventas: art.iva_ventas || "factura",
      categoria: art.categoria || "",
    })
  }

  const saveFicha = async () => {
    if (!fichaArt) return
    setFichaSaving(true)
    const { error } = await supabase.from("articulos").update(fichaForm).eq("id", fichaArt.id)
    if (error) alert(`Error: ${error.message}`)
    else {
      setArticulos(prev => prev.map(a => a.id === fichaArt.id ? { ...a, ...fichaForm } : a))
      setFichaArt(null)
    }
    setFichaSaving(false)
  }

  const COL_NAMES: Record<string, string> = {
    proveedor: "Proveedor", iva_c: "IVA C.", iva_v: "IVA V.", precio_lista: "P. Lista",
    descuentos: "Descuentos", margen: "Margen", bonif_rec: "Bonif/Rec", precio_base: "P. Base",
  }

  const toggleColumna = (lista: ListaPrecio, fac: MetodoFacturacion) => {
    const id = `${lista.codigo}_${fac}`
    setColumnasActivas(prev => prev.find(c => c.id === id) ? prev.filter(c => c.id !== id) : [...prev, { id, lista, facturacion: fac, label: `${lista.nombre} - ${fac}` }])
  }
  const isColumnaActiva = (cod: string, fac: MetodoFacturacion) => columnasActivas.some(c => c.id === `${cod}_${fac}`)

  const fmt = (n: number) => n > 0 ? `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"
  const facturaciones: MetodoFacturacion[] = ["Presupuesto", "Factura", "Final"]
  const ivaIconCompras = (v: string) => v === "factura" ? "+" : v === "adquisicion_stock" ? "0" : v === "mixto" ? "½" : "0"
  const ivaIconVentas = (v: string) => v === "factura" ? "+" : "0"
  const ivaColorCompras = (v: string) => v === "factura" ? "bg-blue-100 text-blue-700" : v === "adquisicion_stock" ? "bg-neutral-200 text-neutral-600" : v === "mixto" ? "bg-amber-100 text-amber-700" : "bg-neutral-200 text-neutral-600"
  const ivaColorVentas = (v: string) => v === "factura" ? "bg-blue-100 text-blue-700" : "bg-neutral-200 text-neutral-600"

  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold">Lista de Precios</h1>
          <p className="text-sm text-muted-foreground">{totalCount} artículos · Página {page + 1}/{totalPages || 1}</p>
        </div>
        <div className="flex gap-2">
          <ImportPriceListDialog proveedores={proveedores} onImportSuccess={loadArticulos} />
          {editados.size > 0 && (
            <Button onClick={guardarCambios} disabled={guardando} className="gap-2 bg-green-600 hover:bg-green-700">
              <Save className="h-4 w-4" /> Guardar ({editados.size})
            </Button>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border rounded-xl p-4 mb-4 flex gap-4 items-end flex-wrap">
        <div className="w-[220px]">
          <div className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase">Proveedor</div>
          <Select value={proveedorFiltro} onValueChange={v => { setProveedorFiltro(v); setPage(0) }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {proveedores.map(p => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[250px]">
          <div className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase">Buscar</div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Descripción, SKU o EAN13..." className="pl-9" />
          </div>
        </div>
      </div>

      {/* Selector listas + columnas visibles */}
      <div className="bg-white border rounded-xl p-4 mb-4">
        <div className="flex gap-6 flex-wrap">
          <div className="flex-1">
            <div className="text-xs font-semibold text-muted-foreground mb-3 uppercase">Listas a comparar</div>
            <div className="flex gap-4 flex-wrap">
              {listas.map(l => (
                <div key={l.id} className="space-y-1.5">
                  <div className="text-xs font-bold text-center">{l.nombre}</div>
                  <div className="flex gap-1.5">
                    {facturaciones.map(fac => (
                      <button key={`${l.codigo}_${fac}`} onClick={() => toggleColumna(l, fac)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${isColumnaActiva(l.codigo, fac) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400"}`}>
                        {fac === "Presupuesto" ? "Presup." : fac}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-3 uppercase">Columnas</div>
            <div className="flex gap-1.5 flex-wrap">
              {Object.entries(COL_NAMES).map(([key, label]) => (
                <button key={key} onClick={() => setColsVisibles(prev => ({ ...prev, [key]: !prev[key] }))}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-all ${colsVisibles[key] ? "bg-neutral-800 text-white border-neutral-800" : "bg-white text-neutral-400 border-neutral-200 line-through"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-neutral-50">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase sticky left-0 bg-neutral-50 z-10 min-w-[200px]">Artículo</th>
                {colsVisibles.proveedor && <th className="text-left px-2 py-3 text-xs font-semibold uppercase min-w-[90px]">Proveedor</th>}
                {colsVisibles.iva_c && <th className="text-center px-2 py-3 text-xs font-semibold uppercase w-[50px]">IVA C.</th>}
                {colsVisibles.iva_v && <th className="text-center px-2 py-3 text-xs font-semibold uppercase w-[50px]">IVA V.</th>}
                {colsVisibles.precio_lista && <th className="text-right px-2 py-3 text-xs font-semibold uppercase min-w-[100px]">P. Lista</th>}
                {colsVisibles.descuentos && <th className="text-center px-2 py-3 text-xs font-semibold uppercase min-w-[80px]">Descuentos</th>}
                {colsVisibles.margen && <th className="text-center px-2 py-3 text-xs font-semibold uppercase w-[70px]">Margen</th>}
                {colsVisibles.bonif_rec && <th className="text-center px-2 py-3 text-xs font-semibold uppercase w-[80px]">Bonif/Rec</th>}
                {colsVisibles.precio_base && <th className="text-right px-2 py-3 text-xs font-semibold uppercase min-w-[100px] border-r-2 border-neutral-300">P. Base</th>}
                {columnasActivas.map(col => (
                  <th key={col.id} className="text-right px-3 py-3 text-xs font-semibold uppercase min-w-[110px] bg-blue-50">
                    <div className="leading-tight"><div>{col.lista.nombre}</div><div className="text-[10px] font-normal text-blue-600 normal-case">{col.facturacion}</div></div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={99} className="text-center py-12 text-muted-foreground">Cargando...</td></tr>
              ) : articulos.length === 0 ? (
                <tr><td colSpan={99} className="text-center py-12 text-muted-foreground">No se encontraron artículos</td></tr>
              ) : articulos.map(art => {
                const descs = descuentosMap[art.id] || []
                const datos = articuloToDatosArticulo(art, descs)
                const base = calcularPrecioBase(datos)
                const resumen = resumirDescuentos(descs)
                const totalDesc = resumen.totalComercial + resumen.totalFinanciero + resumen.totalPromocional
                const isEdited = editados.has(art.id)

                return (
                  <tr key={art.id} className={`border-b border-neutral-100 hover:bg-neutral-50/50 ${isEdited ? "bg-yellow-50/40" : ""}`}>
                    {/* Artículo — click abre ficha */}
                    <td className="px-4 py-2 sticky left-0 bg-white z-10">
                      <button onClick={() => openFicha(art)} className="text-left hover:text-blue-600 transition-colors">
                        <div className="font-medium text-[13px] leading-tight">{art.descripcion}</div>
                        <span className="text-[11px] text-muted-foreground font-mono">{art.sku}</span>
                      </button>
                    </td>
                    {/* Proveedor — click abre ficha */}
                    {colsVisibles.proveedor && (
                      <td className="px-2 py-2">
                        <button onClick={() => openFicha(art)} className="text-xs text-muted-foreground hover:text-blue-600 transition-colors">{art.proveedor?.nombre || "—"}</button>
                      </td>
                    )}
                    {/* IVA Compras */}
                    {colsVisibles.iva_c && (
                      <td className="px-2 py-2 text-center">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold ${ivaColorCompras(art.iva_compras || "factura")}`}>
                          {ivaIconCompras(art.iva_compras || "factura")}
                        </span>
                      </td>
                    )}
                    {/* IVA Ventas */}
                    {colsVisibles.iva_v && (
                      <td className="px-2 py-2 text-center">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold ${ivaColorVentas(art.iva_ventas || "factura")}`}>
                          {ivaIconVentas(art.iva_ventas || "factura")}
                        </span>
                      </td>
                    )}
                    {/* Precio Lista — editable */}
                    {colsVisibles.precio_lista && (
                      <td className="px-2 py-2">
                        <input type="number" step="0.01"
                          className="w-full text-right text-sm font-mono bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-blue-500 focus:outline-none py-0.5 px-1 rounded"
                          value={art.precio_compra || ""} onChange={e => editarCampo(art.id, "precio_compra", parseFloat(e.target.value) || 0)} />
                      </td>
                    )}
                    {/* Descuentos — clickeable */}
                    {colsVisibles.descuentos && (
                      <td className="px-2 py-2 text-center">
                        <button onClick={() => openDescModal(art)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-neutral-100 transition-colors group" title="Click para editar descuentos">
                          {descs.length === 0 ? (
                            <span className="text-xs text-muted-foreground group-hover:text-blue-600">+</span>
                          ) : (
                            <div className="flex gap-0.5">
                              {resumen.totalComercial > 0 && <span className={`inline-flex items-center justify-center min-w-[22px] h-[22px] rounded text-[10px] font-bold ${TIPO_COLORS.comercial.bg} ${TIPO_COLORS.comercial.text}`}>{resumen.totalComercial}</span>}
                              {resumen.totalFinanciero > 0 && <span className={`inline-flex items-center justify-center min-w-[22px] h-[22px] rounded text-[10px] font-bold ${TIPO_COLORS.financiero.bg} ${TIPO_COLORS.financiero.text}`}>{resumen.totalFinanciero}</span>}
                              {resumen.totalPromocional > 0 && <span className={`inline-flex items-center justify-center min-w-[22px] h-[22px] rounded text-[10px] font-bold ${TIPO_COLORS.promocional.bg} ${TIPO_COLORS.promocional.text}`}>{resumen.totalPromocional}</span>}
                            </div>
                          )}
                        </button>
                      </td>
                    )}
                    {/* Margen — editable */}
                    {colsVisibles.margen && (
                      <td className="px-2 py-2">
                        <input type="number" step="0.1"
                          className="w-full text-center text-xs font-semibold text-green-700 bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-blue-500 focus:outline-none py-0.5 rounded"
                          value={art.porcentaje_ganancia || ""} placeholder="—" onChange={e => editarCampo(art.id, "porcentaje_ganancia", parseFloat(e.target.value) || 0)} />
                      </td>
                    )}
                    {/* Bonif/Recargo — editable */}
                    {colsVisibles.bonif_rec && (
                      <td className="px-2 py-2">
                        <input type="number" step="0.1"
                          className={`w-full text-center text-xs font-semibold bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-blue-500 focus:outline-none py-0.5 rounded ${(art.bonif_recargo || 0) < 0 ? "text-red-600" : (art.bonif_recargo || 0) > 0 ? "text-amber-600" : "text-neutral-400"}`}
                          value={art.bonif_recargo || ""} placeholder="—" onChange={e => editarCampo(art.id, "bonif_recargo", parseFloat(e.target.value) || 0)} />
                      </td>
                    )}
                    {/* Precio Base */}
                    {colsVisibles.precio_base && <td className="px-2 py-2 text-right font-bold font-mono text-sm border-r-2 border-neutral-300">{fmt(base.precioBase)}</td>}
                    {/* Columnas dinámicas */}
                    {columnasActivas.map(col => {
                      const ld: DatosLista = { recargo_limpieza_bazar: col.lista.recargo_limpieza_bazar, recargo_perfumeria_negro: col.lista.recargo_perfumeria_negro, recargo_perfumeria_blanco: col.lista.recargo_perfumeria_blanco }
                      const r = calcularPrecioFinal(datos, ld, col.facturacion, 0)
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
            <div className="text-xs text-muted-foreground">Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} de {totalCount}</div>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pn = totalPages <= 7 ? i : page < 3 ? i : page > totalPages - 4 ? totalPages - 7 + i : page - 3 + i
                return <Button key={pn} variant={pn === page ? "default" : "outline"} size="sm" className="w-8 h-8 p-0 text-xs" onClick={() => setPage(pn)}>{pn + 1}</Button>
              })}
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Modal Descuentos ─── */}
      <Dialog open={!!descModalArt} onOpenChange={open => { if (!open) setDescModalArt(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Descuentos — {descModalArt?.descripcion}</DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground mb-2 font-mono">{descModalArt?.sku}</div>

          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {descModalItems.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">No hay descuentos. Agregá uno abajo.</p>
            )}
            {descModalItems.map((d, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${TIPO_COLORS[d.tipo]?.bg} ${TIPO_COLORS[d.tipo]?.text}`}>
                  {d.tipo.slice(0, 3)}
                </span>
                <span className="text-xs text-muted-foreground w-[80px]">{d.tipo}</span>
                <Input
                  type="number" step="0.1" className="w-[100px] text-center"
                  value={d.porcentaje || ""} onChange={e => updateDescuento(idx, parseFloat(e.target.value) || 0)}
                />
                <span className="text-xs text-muted-foreground">%</span>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => removeDescuento(idx)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {/* Agregar descuento */}
          <div className="border-t pt-3 mt-3">
            <div className="text-xs text-muted-foreground mb-2">Agregar descuento:</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => addDescuento("comercial")} className="gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500" /> Comercial
              </Button>
              <Button size="sm" variant="outline" onClick={() => addDescuento("financiero")} className="gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" /> Financiero
              </Button>
              <Button size="sm" variant="outline" onClick={() => addDescuento("promocional")} className="gap-1">
                <span className="w-2 h-2 rounded-full bg-purple-500" /> Promocional
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDescModalArt(null)}>Cancelar</Button>
            <Button onClick={saveDescuentos} disabled={descModalSaving}>
              {descModalSaving ? "Guardando..." : "Guardar Descuentos"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Modal Ficha Artículo ─── */}
      <Dialog open={!!fichaArt} onOpenChange={open => { if (!open) setFichaArt(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ficha del Artículo</DialogTitle>
          </DialogHeader>
          {fichaArt && (
            <div className="space-y-4">
              <div>
                <Label>Descripción</Label>
                <Input value={fichaForm.descripcion} onChange={e => setFichaForm(p => ({ ...p, descripcion: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>SKU</Label>
                  <Input value={fichaForm.sku} onChange={e => setFichaForm(p => ({ ...p, sku: e.target.value }))} />
                </div>
                <div>
                  <Label>Categoría</Label>
                  <Input value={fichaForm.categoria} onChange={e => setFichaForm(p => ({ ...p, categoria: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>IVA Compras</Label>
                  <Select value={fichaForm.iva_compras} onValueChange={v => setFichaForm(p => ({ ...p, iva_compras: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="factura">Blanco (factura)</SelectItem>
                      <SelectItem value="adquisicion_stock">Negro (adquisición)</SelectItem>
                      <SelectItem value="mixto">Mixto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>IVA Ventas</Label>
                  <Select value={fichaForm.iva_ventas} onValueChange={v => setFichaForm(p => ({ ...p, iva_ventas: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="factura">Blanco (factura)</SelectItem>
                      <SelectItem value="presupuesto">Negro (presupuesto)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Precio Compra</Label>
                  <Input type="number" step="0.01" value={fichaForm.precio_compra} onChange={e => setFichaForm(p => ({ ...p, precio_compra: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div>
                  <Label>Margen %</Label>
                  <Input type="number" step="0.1" value={fichaForm.porcentaje_ganancia} onChange={e => setFichaForm(p => ({ ...p, porcentaje_ganancia: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div>
                  <Label>Bonif/Recargo %</Label>
                  <Input type="number" step="0.1" value={fichaForm.bonif_recargo} onChange={e => setFichaForm(p => ({ ...p, bonif_recargo: parseFloat(e.target.value) || 0 }))} />
                </div>
              </div>
              <div className="text-xs text-muted-foreground">Proveedor: {fichaArt.proveedor?.nombre || "—"}</div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setFichaArt(null)}>Cancelar</Button>
                <Button onClick={saveFicha} disabled={fichaSaving}>{fichaSaving ? "Guardando..." : "Guardar"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
