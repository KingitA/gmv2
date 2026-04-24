"use client"

import { useState, useEffect, useRef } from "react"
import { Search, Package, Pencil, X, Minus, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { buscarArticulosDeposito, actualizarDatosArticulo, ajustarStock } from "@/lib/actions/deposito"
import { toast } from "sonner"

type Articulo = {
  id: string
  sku: string
  ean13: string[] | null
  descripcion: string
  unidades_por_bulto: number | null
  unidad_de_medida: string | null
  orden_deposito: number | null
  cantidad_stock: number | null
  imagen_url: string | null
  proveedor: { nombre: string } | null
  marca: { descripcion: string } | null
}

type TipoAjuste = "correccion" | "entrada" | "salida"

export default function DepositoPage() {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Articulo[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Articulo | null>(null)
  const [editMode, setEditMode] = useState<"datos" | "stock" | null>(null)

  const [editDatos, setEditDatos] = useState({ ean13: "", unidades_por_bulto: 1, unidad_de_medida: "", orden_deposito: 0 })
  const [savingDatos, setSavingDatos] = useState(false)

  const [ajusteCantidad, setAjusteCantidad] = useState(0)
  const [ajusteTipo, setAjusteTipo] = useState<TipoAjuste>("correccion")
  const [ajusteMotivo, setAjusteMotivo] = useState("")
  const [savingStock, setSavingStock] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      const data = await buscarArticulosDeposito(query)
      setResults(data as Articulo[])
      setLoading(false)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const openArticulo = (art: Articulo) => {
    setSelected(art)
    setEditMode(null)
    setEditDatos({
      ean13: Array.isArray(art.ean13) ? art.ean13.join(', ') : (art.ean13 || ""),
      unidades_por_bulto: art.unidades_por_bulto || 1,
      unidad_de_medida: art.unidad_de_medida || "",
      orden_deposito: art.orden_deposito || 0,
    })
    setAjusteCantidad(art.cantidad_stock ?? 0)
    setAjusteTipo("correccion")
    setAjusteMotivo("")
  }

  const guardarDatos = async () => {
    if (!selected) return
    setSavingDatos(true)
    try {
      const datosParaGuardar = {
        ...editDatos,
        ean13: editDatos.ean13
          ? editDatos.ean13.split(',').map(s => s.trim()).filter(Boolean)
          : undefined,
      }
      await actualizarDatosArticulo(selected.id, datosParaGuardar)
      const ean13Array = datosParaGuardar.ean13 || null
      setSelected(p => p ? { ...p, ...editDatos, ean13: ean13Array } : p)
      setResults(p => p.map(a => a.id === selected.id ? { ...a, ...editDatos, ean13: ean13Array } : a))
      toast.success("Datos actualizados")
      setEditMode(null)
    } catch (e: any) {
      toast.error(e.message)
    }
    setSavingDatos(false)
  }

  const aplicarAjuste = async () => {
    if (!selected) return
    setSavingStock(true)
    try {
      const res = await ajustarStock(selected.id, ajusteCantidad, ajusteTipo, ajusteMotivo)
      setSelected(p => p ? { ...p, cantidad_stock: res.nuevoStock } : p)
      setResults(p => p.map(a => a.id === selected.id ? { ...a, cantidad_stock: res.nuevoStock } : a))
      toast.success(`Stock actualizado: ${res.nuevoStock} unidades`)
      setEditMode(null)
    } catch (e: any) {
      toast.error(e.message)
    }
    setSavingStock(false)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-4 sticky top-0 z-10 shadow-sm">
        <h1 className="text-lg font-bold text-slate-800 mb-3">Depósito</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400"/>
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por EAN13, descripción o SKU..."
            className="pl-10 h-12 text-base rounded-xl border-slate-200 focus:border-indigo-400"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4"/>
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-3 space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <div className="w-5 h-5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mr-2"/>
            Buscando...
          </div>
        )}

        {!loading && results.length === 0 && query && (
          <div className="text-center py-12 text-slate-400">
            <Package className="h-12 w-12 mx-auto mb-2 opacity-30"/>
            <p>Sin resultados para &quot;{query}&quot;</p>
          </div>
        )}

        {!loading && results.length === 0 && !query && (
          <div className="text-center py-12 text-slate-300">
            <Search className="h-12 w-12 mx-auto mb-2"/>
            <p className="text-sm">Escribí para buscar artículos</p>
          </div>
        )}

        {!loading && results.map(art => (
          <div
            key={art.id}
            className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all ${selected?.id === art.id ? "border-indigo-300 shadow-md" : "border-slate-100"}`}
          >
            <div className="flex items-center gap-3 p-4">
              {art.imagen_url
                ? <img src={art.imagen_url} alt="" className="w-14 h-14 object-cover rounded-lg border border-slate-100 flex-shrink-0"/>
                : <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0"><Package className="h-6 w-6 text-slate-300"/></div>
              }
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-slate-800 leading-tight truncate">{art.descripcion}</p>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">{art.sku}{art.ean13?.length ? ` · ${art.ean13.join(', ')}` : ""}</p>
                {art.proveedor && <p className="text-[11px] text-slate-400 truncate">{art.proveedor.nombre}</p>}
                <div className="flex items-center gap-3 mt-1.5">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${(art.cantidad_stock ?? 0) > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    Stock: {art.cantidad_stock ?? "—"} {art.unidad_de_medida || "UN"}
                  </span>
                  {art.unidades_por_bulto && <span className="text-[11px] text-slate-400">×{art.unidades_por_bulto}/bulto</span>}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-10 w-10 p-0 flex-shrink-0"
                onClick={() => selected?.id === art.id ? setSelected(null) : openArticulo(art)}
              >
                {selected?.id === art.id ? <X className="h-4 w-4"/> : <Pencil className="h-4 w-4"/>}
              </Button>
            </div>

            {selected?.id === art.id && (
              <div className="border-t border-slate-100 bg-slate-50">
                <div className="flex border-b border-slate-100">
                  <button
                    onClick={() => setEditMode(editMode === "datos" ? null : "datos")}
                    className={`flex-1 py-3 text-xs font-semibold transition-colors ${editMode === "datos" ? "bg-white text-indigo-700 border-b-2 border-indigo-500" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    Datos del artículo
                  </button>
                  <button
                    onClick={() => setEditMode(editMode === "stock" ? null : "stock")}
                    className={`flex-1 py-3 text-xs font-semibold transition-colors ${editMode === "stock" ? "bg-white text-emerald-700 border-b-2 border-emerald-500" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    Modificar artículos
                  </button>
                </div>

                {editMode === "datos" && (
                  <div className="p-4 bg-white space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-medium text-slate-600">EAN 13</Label>
                        <Input className="h-11 text-sm mt-1" value={editDatos.ean13} onChange={e => setEditDatos(p => ({ ...p, ean13: e.target.value }))}/>
                      </div>
                      <div>
                        <Label className="text-xs font-medium text-slate-600">Unidad de medida</Label>
                        <Input className="h-11 text-sm mt-1 uppercase" placeholder="UN" value={editDatos.unidad_de_medida} onChange={e => setEditDatos(p => ({ ...p, unidad_de_medida: e.target.value.toUpperCase() }))}/>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-medium text-slate-600">Unidades por bulto</Label>
                        <Input type="number" className="h-11 text-sm mt-1" value={editDatos.unidades_por_bulto || ""} onChange={e => setEditDatos(p => ({ ...p, unidades_por_bulto: parseInt(e.target.value) || 1 }))}/>
                      </div>
                      <div>
                        <Label className="text-xs font-medium text-slate-600">Orden depósito</Label>
                        <Input type="number" className="h-11 text-sm mt-1" value={editDatos.orden_deposito || ""} onChange={e => setEditDatos(p => ({ ...p, orden_deposito: parseInt(e.target.value) || 0 }))}/>
                      </div>
                    </div>
                    <Button onClick={guardarDatos} disabled={savingDatos} className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-sm font-semibold">
                      {savingDatos ? "Guardando..." : "Guardar cambios"}
                    </Button>
                  </div>
                )}

                {editMode === "stock" && (
                  <div className="p-4 bg-white space-y-4">
                    <div className="text-center text-slate-500 text-sm">
                      Stock actual: <span className="font-bold text-slate-800">{selected.cantidad_stock ?? 0} {selected.unidad_de_medida || "UN"}</span>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-slate-600 mb-2 block">Tipo de ajuste</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {(["correccion", "entrada", "salida"] as TipoAjuste[]).map(t => (
                          <button
                            key={t}
                            onClick={() => setAjusteTipo(t)}
                            className={`py-3 px-2 rounded-lg text-xs font-semibold border-2 transition-all ${
                              ajusteTipo === t
                                ? t === "correccion" ? "bg-blue-600 border-blue-600 text-white"
                                  : t === "entrada" ? "bg-emerald-600 border-emerald-600 text-white"
                                  : "bg-red-500 border-red-500 text-white"
                                : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                            }`}
                          >
                            {t === "correccion" ? "Corrección" : t === "entrada" ? "Entrada" : "Salida"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-slate-600 mb-2 block">
                        {ajusteTipo === "correccion" ? "Nuevo stock total" : ajusteTipo === "entrada" ? "Cantidad a ingresar" : "Cantidad a retirar"}
                      </Label>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setAjusteCantidad(p => Math.max(0, p - 1))}
                          className="w-12 h-12 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 active:scale-95 transition-all"
                        >
                          <Minus className="h-5 w-5"/>
                        </button>
                        <Input
                          type="number"
                          className="flex-1 h-12 text-center text-xl font-bold"
                          value={ajusteCantidad}
                          onChange={e => setAjusteCantidad(parseFloat(e.target.value) || 0)}
                        />
                        <button
                          onClick={() => setAjusteCantidad(p => p + 1)}
                          className="w-12 h-12 rounded-xl border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 active:scale-95 transition-all"
                        >
                          <Plus className="h-5 w-5"/>
                        </button>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-slate-600 mb-2 block">Motivo (opcional)</Label>
                      <textarea
                        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        rows={2}
                        placeholder="Ej: inventario físico, devolución cliente..."
                        value={ajusteMotivo}
                        onChange={e => setAjusteMotivo(e.target.value)}
                      />
                    </div>

                    <Button
                      onClick={aplicarAjuste}
                      disabled={savingStock}
                      className={`w-full h-11 text-sm font-semibold ${
                        ajusteTipo === "correccion" ? "bg-blue-600 hover:bg-blue-700"
                          : ajusteTipo === "entrada" ? "bg-emerald-600 hover:bg-emerald-700"
                          : "bg-red-500 hover:bg-red-600"
                      }`}
                    >
                      {savingStock ? "Aplicando..." : ajusteTipo === "correccion" ? "Aplicar corrección" : ajusteTipo === "entrada" ? "Registrar entrada" : "Registrar salida"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
