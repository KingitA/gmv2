"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, GripVertical, Calendar, Package, AlertTriangle, Check, X, Loader2, ArrowUpDown } from "lucide-react"
import Link from "next/link"

interface Importacion {
  id: string
  archivo_nombre: string
  tipo: string
  estado: string
  fecha_vigencia: string | null
  proveedor_id: string | null
  proveedores: { nombre: string } | null
  registros_nuevos: number
  registros_actualizados: number
  source: string
  created_at: string
  columnas_afectadas: any
}

interface LinkedItem {
  desc: string
  code?: string
  brand?: string
  price?: number
  prev_price?: number
  unit?: string
  is_offer?: boolean
  offer_until?: string
  articulo_id?: string
  articulo_desc?: string
  articulo_sku?: string
  confidence: string
}

interface ArticuloProveedor {
  id: string
  sku: string
  descripcion: string
  precio_compra: number
  ean13: string | null
  unidades_por_bulto: number
  porcentaje_ganancia: number
  categoria: string
  rubro: string
  iva_compras: string
  iva_ventas: string
  descuento1: number
  descuento2: number
  descuento3: number
  descuento4: number
  descuentos_tipados: Array<{ tipo: string; porcentaje: number; orden: number }>
}

export default function ActualizacionesPage() {
  const [importaciones, setImportaciones] = useState<Importacion[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<"pendientes" | "aplicadas">("pendientes")

  // Detail view
  const [selectedImport, setSelectedImport] = useState<Importacion | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [articulosProveedor, setArticulosProveedor] = useState<ArticuloProveedor[]>([])
  const [linkedItems, setLinkedItems] = useState<LinkedItem[]>([])

  // Apply modal
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [fechaEfectiva, setFechaEfectiva] = useState("")
  const [aplicarMode, setAplicarMode] = useState<"vigencia" | "ahora">("vigencia")
  const [applying, setApplying] = useState(false)

  // Drag & drop
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // ─── Load importaciones ─────────────────────────
  const loadImportaciones = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/articulos/actualizaciones?estado=all")
      if (res.ok) {
        const data = await res.json()
        setImportaciones(data)
      }
    } catch (e) {
      console.error("Error loading:", e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadImportaciones() }, [loadImportaciones])

  const pendientes = importaciones.filter(i => i.estado === "pendiente").sort((a, b) => {
    // Sort by prioridad if available, otherwise by fecha_vigencia then created_at
    const va = a.fecha_vigencia || "9999"
    const vb = b.fecha_vigencia || "9999"
    return va.localeCompare(vb)
  })
  const aplicadas = importaciones.filter(i => i.estado === "aplicada")

  // ─── Drag & drop handlers ──────────────────────
  const handleDragStart = (idx: number) => setDragIdx(idx)
  const handleDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx) }
  const handleDrop = async (idx: number) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return }
    const reordered = [...pendientes]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(idx, 0, moved)

    // Update local state immediately
    const newImportaciones = [...importaciones.filter(i => i.estado !== "pendiente"), ...reordered]
    setImportaciones(newImportaciones)
    setDragIdx(null)
    setDragOverIdx(null)

    // Persist order
    try {
      await fetch("/api/articulos/actualizaciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorder", ordered_ids: reordered.map(i => i.id) }),
      })
    } catch { /* silent */ }
  }
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null) }

  // ─── Open detail view ──────────────────────────
  const openDetail = async (imp: Importacion) => {
    setSelectedImport(imp)
    setDetailLoading(true)
    setLinkedItems([])
    setArticulosProveedor([])

    try {
      const res = await fetch(`/api/articulos/actualizaciones?id=${imp.id}`)
      if (res.ok) {
        const data = await res.json()
        const items = data.importacion?.columnas_afectadas?.linked_items || []
        setLinkedItems(items)
        setArticulosProveedor(data.articulosProveedor || [])
      }
    } catch (e) {
      console.error("Error loading detail:", e)
    }
    setDetailLoading(false)
  }

  // ─── Build change map: articulo_id → changes ───
  const buildChangeMap = () => {
    const changes = new Map<string, { field: string; oldValue: any; newValue: any }[]>()
    for (const item of linkedItems) {
      if (!item.articulo_id || item.confidence === "NONE") continue
      const art = articulosProveedor.find(a => a.id === item.articulo_id)
      if (!art) continue

      const artChanges: { field: string; oldValue: any; newValue: any }[] = []

      // Price change
      if (item.price && item.price > 0 && Math.abs(item.price - art.precio_compra) > 0.01) {
        artChanges.push({ field: "precio_compra", oldValue: art.precio_compra, newValue: item.price })
      }

      // EAN change (if item has code that looks like EAN)
      if (item.code && item.code.length >= 8 && /^\d+$/.test(item.code) && item.code !== art.ean13) {
        artChanges.push({ field: "ean13", oldValue: art.ean13, newValue: item.code })
      }

      if (artChanges.length > 0) {
        changes.set(item.articulo_id, artChanges)
      }
    }
    return changes
  }

  const changeMap = selectedImport ? buildChangeMap() : new Map()

  // ─── Apply import ──────────────────────────────
  const handleApply = async () => {
    if (!selectedImport) return
    setApplying(true)

    const fecha = aplicarMode === "ahora"
      ? new Date().toISOString()
      : (selectedImport.fecha_vigencia || new Date().toISOString())

    // Build cambios array from changeMap
    const cambios = Array.from(changeMap.entries()).map(([articulo_id, changes]) => {
      const updates: Record<string, any> = {}
      for (const c of changes) {
        updates[c.field] = c.newValue
      }
      return { articulo_id, updates }
    })

    if (cambios.length === 0) {
      alert("No hay cambios para aplicar. Verificá que los artículos estén correctamente vinculados.")
      setApplying(false)
      return
    }

    try {
      const res = await fetch("/api/articulos/actualizaciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "aplicar",
          importacion_id: selectedImport.id,
          fecha_efectiva: fecha,
          cambios,
        }),
      })

      const result = await res.json()
      if (result.success) {
        alert(`Importación aplicada: ${result.updated} artículo(s) actualizados.${result.errors?.length > 0 ? `\n\nErrores: ${result.errors.join(", ")}` : ""}`)
        setShowApplyModal(false)
        setSelectedImport(null)
        loadImportaciones()
      } else {
        alert(`Error: ${result.error}`)
      }
    } catch (e) {
      alert("Error aplicando importación")
    }
    setApplying(false)
  }

  // ─── Format helpers ────────────────────────────
  const fmtDate = (d: string | null) => {
    if (!d) return "—"
    try { return new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) }
    catch { return d }
  }
  const fmtPrice = (n: number | null | undefined) => {
    if (n == null || n === 0) return "—"
    return `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  const pctChange = (old: number, nuevo: number) => {
    if (!old || old === 0) return ""
    const pct = ((nuevo - old) / old) * 100
    return pct > 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`
  }

  const getItemCount = (imp: Importacion) => {
    const items = imp.columnas_afectadas?.linked_items || []
    return items.length
  }

  // ─── Render ────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/articulos/precios">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Actualizaciones de Artículos</h1>
              <p className="text-sm text-muted-foreground">Importaciones de precios, descuentos y datos desde Gmail y manuales</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 border-b">
          <button
            onClick={() => setTab("pendientes")}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === "pendientes" ? "border-amber-500 text-amber-700" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Pendientes
            {pendientes.length > 0 && (
              <span className="ml-2 bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 text-xs font-bold">{pendientes.length}</span>
            )}
          </button>
          <button
            onClick={() => setTab("aplicadas")}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === "aplicadas" ? "border-green-500 text-green-700" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Aplicadas
            {aplicadas.length > 0 && (
              <span className="ml-2 bg-green-100 text-green-700 rounded-full px-2 py-0.5 text-xs font-bold">{aplicadas.length}</span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* ═══ PENDIENTES ═══ */}
            {tab === "pendientes" && (
              <div className="space-y-2">
                {pendientes.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No hay actualizaciones pendientes</p>
                    <p className="text-xs mt-1">Cuando llegue un mail con cambio de precios, oferta o actualización de datos, aparecerá acá</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground mb-3">Arrastrá para cambiar la prioridad. Hacé clic para ver el detalle.</p>
                    {pendientes.map((imp, idx) => {
                      const itemCount = getItemCount(imp)
                      const isOverdue = imp.fecha_vigencia && new Date(imp.fecha_vigencia) <= new Date()
                      return (
                        <div
                          key={imp.id}
                          draggable
                          onDragStart={() => handleDragStart(idx)}
                          onDragOver={(e) => handleDragOver(e, idx)}
                          onDrop={() => handleDrop(idx)}
                          onDragEnd={handleDragEnd}
                          onClick={() => openDetail(imp)}
                          className={`flex items-center gap-3 border rounded-lg p-3 cursor-pointer transition-all hover:shadow-sm hover:border-amber-300 ${dragOverIdx === idx ? "border-amber-400 bg-amber-50" : "bg-card"} ${dragIdx === idx ? "opacity-50" : ""}`}
                        >
                          <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                            <GripVertical className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold truncate">{imp.archivo_nombre}</span>
                              {imp.source === "gmail" && <Badge variant="outline" className="text-[10px] px-1.5 py-0">📧 Gmail</Badge>}
                              {imp.tipo?.includes("oferta") && <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-purple-50 text-purple-700 border-purple-200">Oferta</Badge>}
                            </div>
                            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                              <span>{imp.proveedores?.nombre || "Proveedor sin vincular"}</span>
                              <span>{itemCount > 0 ? `${itemCount} artículos` : "Sin items detectados"}</span>
                              <span>{fmtDate(imp.created_at)}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            {imp.fecha_vigencia ? (
                              <div className={`flex items-center gap-1.5 text-xs font-medium ${isOverdue ? "text-red-600" : "text-amber-600"}`}>
                                <Calendar className="h-3.5 w-3.5" />
                                {fmtDate(imp.fecha_vigencia)}
                                {isOverdue && <AlertTriangle className="h-3.5 w-3.5" />}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">Sin fecha</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ═══ APLICADAS ═══ */}
            {tab === "aplicadas" && (
              <div className="space-y-2">
                {aplicadas.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Check className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No hay importaciones aplicadas todavía</p>
                  </div>
                ) : (
                  aplicadas.map(imp => (
                    <div
                      key={imp.id}
                      onClick={() => openDetail(imp)}
                      className="flex items-center gap-3 border rounded-lg p-3 cursor-pointer hover:shadow-sm hover:border-green-300 bg-card transition-all"
                    >
                      <Check className="h-4 w-4 text-green-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate">{imp.archivo_nombre}</span>
                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                          <span>{imp.proveedores?.nombre || "—"}</span>
                          <span>{imp.registros_actualizados} actualizados</span>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">{fmtDate(imp.created_at)}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* ═══ DETAIL DIALOG ═══ */}
      <Dialog open={!!selectedImport} onOpenChange={(open) => { if (!open) setSelectedImport(null) }}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              {selectedImport?.archivo_nombre}
              {selectedImport?.estado === "aplicada" && <Badge className="bg-green-100 text-green-700 text-[10px]">Aplicada</Badge>}
            </DialogTitle>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Proveedor: <strong>{selectedImport?.proveedores?.nombre || "Sin vincular"}</strong></span>
              {selectedImport?.fecha_vigencia && <span>Vigencia: <strong>{fmtDate(selectedImport.fecha_vigencia)}</strong></span>}
              <span>Fuente: {selectedImport?.source === "gmail" ? "📧 Gmail" : "Manual"}</span>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            {detailLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : linkedItems.length === 0 && articulosProveedor.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <AlertTriangle className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No se detectaron artículos en esta importación</p>
                <p className="text-xs mt-1">Puede ser que el archivo adjunto no se pudo leer o el proveedor no está vinculado</p>
              </div>
            ) : (
              <div className="border rounded-lg overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs bg-muted/50">
                      <TableHead className="w-[60px] py-2">SKU</TableHead>
                      <TableHead className="py-2">Descripción</TableHead>
                      <TableHead className="w-[90px] py-2 text-right">EAN</TableHead>
                      <TableHead className="w-[80px] py-2 text-right">Precio Actual</TableHead>
                      <TableHead className="w-[80px] py-2 text-right">Precio Nuevo</TableHead>
                      <TableHead className="w-[60px] py-2 text-right">Cambio</TableHead>
                      <TableHead className="w-[80px] py-2">Desc. Comercial</TableHead>
                      <TableHead className="w-[80px] py-2">Desc. Financiero</TableHead>
                      <TableHead className="w-[60px] py-2 text-center">Match</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Show ALL articles of the provider, highlighting those that change */}
                    {articulosProveedor.length > 0 ? (
                      articulosProveedor.map(art => {
                        const changes = changeMap.get(art.id)
                        const linked = linkedItems.find(li => li.articulo_id === art.id)
                        const hasChange = !!changes
                        const priceChange = changes?.find(c => c.field === "precio_compra")
                        const eanChange = changes?.find(c => c.field === "ean13")
                        const descComercial = art.descuentos_tipados?.filter(d => d.tipo === "comercial").map(d => d.porcentaje).join("+") || (art.descuento1 ? [art.descuento1, art.descuento2, art.descuento3, art.descuento4].filter(Boolean).join("+") : "—")
                        const descFinanciero = art.descuentos_tipados?.filter(d => d.tipo === "financiero").map(d => d.porcentaje).join("+") || "—"

                        return (
                          <TableRow key={art.id} className={`text-xs ${hasChange ? "bg-amber-50 font-medium" : ""}`}>
                            <TableCell className="font-mono py-1.5">{art.sku}</TableCell>
                            <TableCell className="py-1.5">{art.descripcion}</TableCell>
                            <TableCell className="text-right py-1.5 font-mono">
                              {eanChange ? (
                                <span className="text-blue-600 font-bold">{String(eanChange.newValue)}</span>
                              ) : (
                                <span className="text-muted-foreground">{art.ean13 || "—"}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right py-1.5">
                              {priceChange ? (
                                <span className="line-through text-muted-foreground">{fmtPrice(priceChange.oldValue)}</span>
                              ) : (
                                fmtPrice(art.precio_compra)
                              )}
                            </TableCell>
                            <TableCell className="text-right py-1.5">
                              {priceChange ? (
                                <span className={`font-bold ${priceChange.newValue > priceChange.oldValue ? "text-red-600" : "text-green-600"}`}>
                                  {fmtPrice(priceChange.newValue)}
                                </span>
                              ) : ""}
                            </TableCell>
                            <TableCell className="text-right py-1.5">
                              {priceChange ? (
                                <span className={`text-[10px] font-bold ${priceChange.newValue > priceChange.oldValue ? "text-red-600" : "text-green-600"}`}>
                                  {pctChange(priceChange.oldValue, priceChange.newValue)}
                                </span>
                              ) : ""}
                            </TableCell>
                            <TableCell className="py-1.5 text-muted-foreground">{descComercial}</TableCell>
                            <TableCell className="py-1.5 text-muted-foreground">{descFinanciero}</TableCell>
                            <TableCell className="text-center py-1.5">
                              {linked ? (
                                <span className={`inline-block w-2 h-2 rounded-full ${linked.confidence === "HIGH" ? "bg-green-500" : linked.confidence === "MEDIUM" ? "bg-yellow-500" : "bg-red-400"}`} title={linked.confidence} />
                              ) : ""}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    ) : (
                      /* No provider linked — show raw linked items */
                      linkedItems.map((item, idx) => (
                        <TableRow key={idx} className="text-xs">
                          <TableCell className="font-mono py-1.5">{item.code || "—"}</TableCell>
                          <TableCell className="py-1.5">{item.desc}</TableCell>
                          <TableCell className="text-right py-1.5">—</TableCell>
                          <TableCell className="text-right py-1.5">—</TableCell>
                          <TableCell className="text-right py-1.5 font-bold">{fmtPrice(item.price)}</TableCell>
                          <TableCell className="text-right py-1.5">—</TableCell>
                          <TableCell className="py-1.5">—</TableCell>
                          <TableCell className="py-1.5">—</TableCell>
                          <TableCell className="text-center py-1.5">
                            <span className={`inline-block w-2 h-2 rounded-full ${item.confidence === "HIGH" ? "bg-green-500" : item.confidence === "MEDIUM" ? "bg-yellow-500" : item.confidence === "LOW" ? "bg-red-400" : "bg-gray-300"}`} title={item.confidence} />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Footer with action buttons */}
          {selectedImport?.estado === "pendiente" && changeMap.size > 0 && (
            <div className="border-t pt-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {changeMap.size} artículo(s) con cambios detectados
              </p>
              <Button onClick={() => { setShowApplyModal(true); setFechaEfectiva(selectedImport.fecha_vigencia || new Date().toISOString().split("T")[0]) }}>
                Importar Cambios
              </Button>
            </div>
          )}

          {selectedImport?.estado === "pendiente" && changeMap.size === 0 && linkedItems.length > 0 && (
            <div className="border-t pt-3">
              <p className="text-xs text-amber-600">
                Se detectaron {linkedItems.length} artículos pero ninguno tiene cambios respecto a los datos actuales, o no están vinculados al proveedor.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══ APPLY MODAL ═══ */}
      <Dialog open={showApplyModal} onOpenChange={setShowApplyModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Aplicar Importación</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Se van a actualizar <strong>{changeMap.size}</strong> artículo(s) del proveedor <strong>{selectedImport?.proveedores?.nombre || "—"}</strong>.
            </p>

            <div className="space-y-2">
              <Label className="text-xs font-medium">¿Cuándo aplicar los cambios?</Label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="modo" checked={aplicarMode === "vigencia"} onChange={() => setAplicarMode("vigencia")} />
                  Usar fecha de vigencia: <strong>{fmtDate(selectedImport?.fecha_vigencia || null)}</strong>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="modo" checked={aplicarMode === "ahora"} onChange={() => setAplicarMode("ahora")} />
                  Aplicar ahora
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowApplyModal(false)} disabled={applying}>Cancelar</Button>
              <Button size="sm" onClick={handleApply} disabled={applying}>
                {applying ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Aplicando...</> : "Confirmar e Importar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
