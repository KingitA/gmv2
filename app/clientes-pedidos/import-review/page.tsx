"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, ArrowLeft, Check, X, Search, AlertCircle, Eye, Plus, Trash2, RefreshCw, Edit2 } from "lucide-react"
import { toast } from "sonner"
import { getPendingImports, approveImport, rejectImport } from "@/lib/actions/import-review"
import { Input } from "@/components/ui/input"
import { searchClientes } from "@/lib/actions/clientes"
import { searchProductos } from "@/lib/actions/productos"
import { EmailPreviewModal } from "@/components/ai/EmailPreviewModal"

// ─── Types ──────────────────────────────────────────────
interface ReviewItem {
  id?: string
  originalText: string
  quantity: number
  matchedProduct: {
    id: string
    descripcion: string
    sku: string
    precio_base?: number
    precio_compra?: number
  } | null
  confidence: "HIGH" | "MEDIUM" | "LOW"
  manuallyMatched?: boolean
  isNew?: boolean // added manually by operator
}

// ─── Main Component ──────────────────────────────────────
export default function ImportReviewPage() {
  const [imports, setImports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedImport, setSelectedImport] = useState<any>(null)
  const [processing, setProcessing] = useState(false)

  // Items state
  const [items, setItems] = useState<ReviewItem[]>([])

  // Client state
  const [clienteId, setClienteId] = useState("")
  const [selectedClienteName, setSelectedClienteName] = useState("")
  const [clienteSearchTerm, setClienteSearchTerm] = useState("")
  const [clienteSearchOpen, setClienteSearchOpen] = useState(false)
  const [clientesEncontrados, setClientesEncontrados] = useState<any[]>([])

  // Per-item search state: index → { term, results, open }
  const [itemSearch, setItemSearch] = useState<Record<number, { term: string; results: any[]; loading: boolean; open: boolean }>>({})

  // Email preview
  const [previewEmailId, setPreviewEmailId] = useState<string | null>(null)

  useEffect(() => { loadImports() }, [])

  const loadImports = async () => {
    setLoading(true)
    try {
      const data = await getPendingImports()
      setImports(data || [])
    } catch {
      toast.error("Error al cargar importaciones")
    } finally {
      setLoading(false)
    }
  }

  // ── Select import ──
  const handleSelectImport = (imp: any) => {
    setSelectedImport(imp)
    setItemSearch({})

    const transformed: ReviewItem[] = (imp.import_items || []).map((ii: any) => {
      const hasLink = !!ii.linkedArticulo
      const isHighConfidence = ii.status === "matched" || ii.match_confidence >= 0.82
      return {
        id: ii.id,
        originalText: ii.raw_data?.description || "",
        quantity: ii.raw_data?.quantity || 1,
        matchedProduct: ii.linkedArticulo ? {
          id: ii.linkedArticulo.id,
          descripcion: ii.linkedArticulo.descripcion,
          sku: ii.linkedArticulo.sku,
          precio_compra: ii.linkedArticulo.precio_compra,
          precio_base: ii.linkedArticulo.precio_base,
        } : null,
        confidence: hasLink && isHighConfidence ? "HIGH" : ii.match_confidence > 0.6 ? "MEDIUM" : "LOW",
      }
    })

    setItems(transformed)
    setClienteId(imp.meta?.cliente_id || "")
    setSelectedClienteName(imp.meta?.cliente_nombre || "")
    setClienteSearchTerm(imp.meta?.cliente_nombre || "")
  }

  // ── Client search ──
  const handleClienteSearch = async (term: string) => {
    setClienteSearchTerm(term)
    setSelectedClienteName(term)
    setClienteId("") // Clear confirmed ID when typing
    if (term.length < 2) { setClienteSearchOpen(false); return }
    const res = await searchClientes(term)
    setClientesEncontrados(res || [])
    setClienteSearchOpen(true)
  }

  const handleSelectCliente = (c: any) => {
    setClienteId(c.id)
    const name = c.nombre_razon_social || c.razon_social || c.nombre || ""
    setSelectedClienteName(name)
    setClienteSearchTerm(name)
    setClienteSearchOpen(false)
  }

  // ── Item: update quantity ──
  const handleQuantityChange = (idx: number, val: string) => {
    const n = parseFloat(val)
    if (isNaN(n) || n < 0) return
    setItems(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], quantity: n }
      return next
    })
  }

  // ── Item: open search for a row ──
  const openItemSearch = (idx: number) => {
    setItemSearch(prev => ({
      ...prev,
      [idx]: { term: prev[idx]?.term || "", results: prev[idx]?.results || [], loading: false, open: true }
    }))
  }

  const closeItemSearch = (idx: number) => {
    setItemSearch(prev => ({ ...prev, [idx]: { ...prev[idx], open: false } }))
  }

  const handleItemSearchChange = useCallback(async (idx: number, term: string) => {
    setItemSearch(prev => ({ ...prev, [idx]: { ...prev[idx], term, open: true, loading: true } }))
    if (term.length < 2) {
      setItemSearch(prev => ({ ...prev, [idx]: { ...prev[idx], results: [], loading: false } }))
      return
    }
    try {
      const res = await searchProductos(term)
      setItemSearch(prev => ({ ...prev, [idx]: { ...prev[idx], results: res || [], loading: false } }))
    } catch {
      setItemSearch(prev => ({ ...prev, [idx]: { ...prev[idx], loading: false } }))
    }
  }, [])

  const handleAssignProduct = (idx: number, product: any) => {
    setItems(prev => {
      const next = [...prev]
      next[idx] = {
        ...next[idx],
        matchedProduct: {
          id: product.id,
          descripcion: product.descripcion || product.nombre,
          sku: product.sku,
          precio_compra: product.precio_compra,
          precio_base: product.precio_base,
        },
        confidence: "HIGH",
        manuallyMatched: true,
      }
      return next
    })
    closeItemSearch(idx)
  }

  // ── Item: remove ──
  const handleRemoveItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Item: add blank ──
  const handleAddItem = () => {
    setItems(prev => [...prev, {
      originalText: "",
      quantity: 1,
      matchedProduct: null,
      confidence: "LOW",
      isNew: true,
    }])
    // Open search for the new last item
    const newIdx = items.length
    setTimeout(() => openItemSearch(newIdx), 50)
  }

  // ── Approve ──
  const handleApprove = async () => {
    if (!clienteId) { toast.error("Seleccioná un cliente antes de aprobar"); return }

    const unlinked = items.filter(i => !i.matchedProduct)
    if (unlinked.length > 0) {
      toast.error(`Hay ${unlinked.length} artículo(s) sin vincular. Vinculá o eliminá antes de aprobar.`)
      return
    }
    if (items.length === 0) { toast.error("El pedido no tiene artículos"); return }

    setProcessing(true)
    try {
      const result = await approveImport(selectedImport.id, clienteId, items)
      toast.success("✅ Pedido creado correctamente")
      setSelectedImport(null)
      loadImports()
    } catch (err: any) {
      toast.error(`Error al crear pedido: ${err?.message || "Error desconocido"}`)
    } finally {
      setProcessing(false)
    }
  }

  // ── Reject ──
  const handleReject = async (id: string) => {
    if (!confirm("¿Descartás esta importación? No se creará ningún pedido.")) return
    try {
      await rejectImport(id)
      toast.success("Importación descartada")
      if (selectedImport?.id === id) setSelectedImport(null)
      loadImports()
    } catch {
      toast.error("Error al descartar")
    }
  }

  // ── Email preview ──
  const openEmailPreview = async (gmailId: string) => {
    try {
      const { createClient } = await import("@/lib/supabase/client")
      const supabase = createClient()
      const { data } = await supabase.from("ai_emails").select("id").eq("gmail_id", gmailId).limit(1).maybeSingle()
      if (data?.id) setPreviewEmailId(data.id)
      else toast.error("No se encontró el email original")
    } catch {
      toast.error("Error buscando email")
    }
  }

  // ─── Derived ──────────────────────────────────────────
  const unlinkedCount = items.filter(i => !i.matchedProduct).length
  const canApprove = !!clienteId && items.length > 0 && unlinkedCount === 0

  // ─── Render ───────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <a href="/clientes-pedidos"><ArrowLeft className="h-4 w-4 mr-2" />Volver</a>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Bandeja de Pedidos</h1>
          <p className="text-sm text-muted-foreground">Revisá, corregí y confirmá cada pedido antes de crearlo</p>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={loadImports}>
          <RefreshCw className="h-4 w-4 mr-1" />Actualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4" style={{ minHeight: "75vh" }}>

        {/* ── LEFT: Import list ── */}
        <div className="lg:col-span-4 xl:col-span-3">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Pendientes ({imports.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-auto" style={{ maxHeight: "calc(75vh - 60px)" }}>
              {imports.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  <Check className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  No hay pedidos pendientes
                </div>
              ) : (
                <div className="divide-y">
                  {imports.map((imp) => {
                    const itemCount = imp.import_items?.length || 0
                    const unmatched = imp.import_items?.filter((i: any) => !i.linkedArticulo).length || 0
                    const isSelected = selectedImport?.id === imp.id
                    return (
                      <div
                        key={imp.id}
                        onClick={() => handleSelectImport(imp)}
                        className={`p-4 cursor-pointer transition-colors hover:bg-muted/50 ${isSelected ? "bg-muted border-l-2 border-l-primary" : ""}`}
                      >
                        <div className="flex justify-between items-start mb-1.5">
                          <Badge variant="secondary" className="text-xs">
                            {imp.meta?.source?.toUpperCase() || "EMAIL"}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(imp.created_at).toLocaleString("es-AR", {
                              timeZone: "America/Argentina/Buenos_Aires",
                              day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
                            })}
                          </span>
                        </div>
                        <div className="font-medium text-sm truncate">
                          {imp.meta?.cliente_nombre || imp.meta?.sender || "Remitente desconocido"}
                        </div>
                        {imp.meta?.subject && (
                          <div className="text-xs text-muted-foreground truncate">{imp.meta.subject}</div>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-xs text-muted-foreground">{itemCount} artículos</span>
                          {unmatched > 0 && (
                            <Badge variant="destructive" className="text-xs h-4 px-1">
                              {unmatched} sin vincular
                            </Badge>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── RIGHT: Editor ── */}
        <div className="lg:col-span-8 xl:col-span-9">
          {!selectedImport ? (
            <Card className="h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium">Seleccioná un pedido de la lista</p>
                <p className="text-sm">para revisarlo y confirmarlo</p>
              </div>
            </Card>
          ) : (
            <Card className="h-full flex flex-col">
              {/* Card header */}
              <CardHeader className="border-b pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground mb-0.5">
                      {selectedImport.meta?.source?.toUpperCase() || "EMAIL"} ·{" "}
                      {new Date(selectedImport.created_at).toLocaleString("es-AR", {
                        timeZone: "America/Argentina/Buenos_Aires",
                        weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit"
                      })}
                    </div>
                    <div className="font-semibold truncate">
                      De: {selectedImport.meta?.sender || "Desconocido"}
                    </div>
                    {selectedImport.meta?.subject && (
                      <div className="text-sm text-muted-foreground truncate">
                        Asunto: {selectedImport.meta.subject}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {selectedImport.meta?.gmail_id && (
                      <Button variant="outline" size="sm" onClick={() => openEmailPreview(selectedImport.meta.gmail_id)}>
                        <Eye className="h-4 w-4 mr-1" />Ver email
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleReject(selectedImport.id)}>
                      <X className="h-4 w-4 mr-1" />Descartar
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleApprove}
                      disabled={processing || !canApprove}
                      className="min-w-[160px]"
                    >
                      {processing
                        ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Creando...</>
                        : <><Check className="h-4 w-4 mr-1" />Crear Pedido</>}
                    </Button>
                  </div>
                </div>

                {/* Validation banner */}
                {!canApprove && (
                  <div className="mt-3 flex items-center gap-2 text-sm bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2 text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {!clienteId
                      ? "Falta asignar el cliente"
                      : unlinkedCount > 0
                      ? `${unlinkedCount} artículo(s) sin vincular — vinculá o eliminá antes de crear`
                      : items.length === 0
                      ? "El pedido no tiene artículos"
                      : ""}
                  </div>
                )}
              </CardHeader>

              <CardContent className="flex-1 overflow-auto p-4 space-y-5">

                {/* ── Cliente ── */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold">Cliente *</label>
                  {selectedImport.meta?.cliente_nombre && !clienteId && (
                    <p className="text-xs text-amber-500 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      IA detectó: <strong>{selectedImport.meta.cliente_nombre}</strong> — confirmá o buscá el correcto
                    </p>
                  )}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Escribí el nombre del cliente..."
                      className="pl-8"
                      value={clienteSearchTerm}
                      onChange={(e) => handleClienteSearch(e.target.value)}
                      onBlur={() => setTimeout(() => setClienteSearchOpen(false), 150)}
                      onFocus={() => { if (clientesEncontrados.length > 0) setClienteSearchOpen(true) }}
                    />
                    {clienteId && (
                      <div className="absolute right-2.5 top-2.5 h-4 w-4 text-green-500">
                        <Check className="h-4 w-4" />
                      </div>
                    )}
                    {clienteSearchOpen && clientesEncontrados.length > 0 && (
                      <div className="absolute top-full left-0 w-full bg-popover border rounded-md shadow-lg mt-1 z-50 max-h-[220px] overflow-auto">
                        {clientesEncontrados.map((c) => (
                          <div
                            key={c.id}
                            className="px-3 py-2.5 hover:bg-muted cursor-pointer border-b last:border-0"
                            onMouseDown={() => handleSelectCliente(c)}
                          >
                            <div className="text-sm font-medium">
                              {c.nombre_razon_social || c.razon_social || c.nombre}
                            </div>
                            {(c.direccion || c.localidad) && (
                              <div className="text-xs text-muted-foreground">
                                {[c.direccion, c.localidad].filter(Boolean).join(" — ")}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Articles table ── */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold">
                      Artículos ({items.length})
                      {unlinkedCount > 0 && (
                        <Badge variant="destructive" className="ml-2 text-xs">{unlinkedCount} sin vincular</Badge>
                      )}
                    </label>
                    <Button variant="outline" size="sm" onClick={handleAddItem}>
                      <Plus className="h-4 w-4 mr-1" />Agregar artículo
                    </Button>
                  </div>

                  <div className="border rounded-md overflow-hidden">
                    {items.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">
                        No hay artículos. Agregá uno manualmente.
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs">Texto original (email)</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs">Artículo en sistema</th>
                            <th className="px-3 py-2 text-center font-medium text-muted-foreground text-xs w-20">Cantidad</th>
                            <th className="px-3 py-2 w-10"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {items.map((item, idx) => {
                            const search = itemSearch[idx]
                            const isSearchOpen = search?.open
                            const isUnlinked = !item.matchedProduct

                            return (
                              <tr key={idx} className={isUnlinked ? "bg-destructive/5" : ""}>
                                {/* Original text */}
                                <td className="px-3 py-2 align-top">
                                  <div className="text-xs text-muted-foreground max-w-[160px] break-words">
                                    {item.isNew ? <em>artículo nuevo</em> : item.originalText || "—"}
                                  </div>
                                </td>

                                {/* Matched product / search */}
                                <td className="px-3 py-2 align-top relative">
                                  {isSearchOpen ? (
                                    <div className="relative">
                                      <Input
                                        autoFocus
                                        placeholder="Buscar por nombre o SKU..."
                                        value={search?.term || ""}
                                        onChange={(e) => handleItemSearchChange(idx, e.target.value)}
                                        onBlur={() => setTimeout(() => closeItemSearch(idx), 200)}
                                        className="h-7 text-sm"
                                      />
                                      {(search?.results?.length > 0) && (
                                        <div className="absolute top-full left-0 w-[360px] max-w-[90vw] bg-background border rounded-md shadow-lg mt-1 z-50 max-h-[250px] overflow-auto">
                                          {search.results.map((p) => (
                                            <div
                                              key={p.id}
                                              className="px-3 py-2 hover:bg-muted cursor-pointer border-b last:border-0"
                                              onMouseDown={() => handleAssignProduct(idx, p)}
                                            >
                                              <div className="font-medium text-sm">{p.descripcion || p.nombre}</div>
                                              <div className="text-xs text-muted-foreground">SKU: {p.sku}</div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      {search?.loading && (
                                        <div className="absolute top-full left-0 w-full p-2 bg-background border rounded-md shadow mt-1 z-50 text-xs text-center text-muted-foreground">
                                          Buscando...
                                        </div>
                                      )}
                                    </div>
                                  ) : item.matchedProduct ? (
                                    <div
                                      className="group flex items-center gap-1.5 cursor-pointer"
                                      onClick={() => openItemSearch(idx)}
                                      title="Clic para cambiar"
                                    >
                                      <div className="min-w-0">
                                        <div className="font-medium text-sm leading-tight truncate max-w-[200px]">
                                          {item.matchedProduct.descripcion}
                                        </div>
                                        <div className="text-xs text-muted-foreground">SKU: {item.matchedProduct.sku}</div>
                                      </div>
                                      <Edit2 className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => openItemSearch(idx)}
                                      className="flex items-center gap-1.5 text-destructive text-sm font-medium hover:underline"
                                    >
                                      <Search className="h-3.5 w-3.5" />
                                      Sin vincular — clic para buscar
                                    </button>
                                  )}
                                </td>

                                {/* Quantity */}
                                <td className="px-3 py-2 align-top">
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={item.quantity}
                                    onChange={(e) => handleQuantityChange(idx, e.target.value)}
                                    className="h-7 text-sm text-center w-20"
                                  />
                                </td>

                                {/* Delete */}
                                <td className="px-2 py-2 align-top">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    onClick={() => handleRemoveItem(idx)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <EmailPreviewModal
        emailId={previewEmailId}
        open={!!previewEmailId}
        onClose={() => setPreviewEmailId(null)}
      />
    </div>
  )
}
