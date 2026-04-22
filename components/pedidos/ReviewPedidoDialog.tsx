"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2, CheckCircle, AlertTriangle, Search, AlertCircle, X } from "lucide-react"
import type { ParseResult, ParsedItem } from "@/lib/actions/ai-order-import"
import { toast } from "sonner"

interface ReviewPedidoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  queueItemId: string
  clienteNombre: string
  clienteId: string
  parseResult: ParseResult
  onConfirm: (itemId: string, items: ParseResult["items"], clienteId: string) => Promise<void>
}

const getConfidenceColor = (conf: string) => {
  switch (conf) {
    case "HIGH": return "bg-green-500"
    case "MEDIUM": return "bg-yellow-500"
    case "LOW": return "bg-red-500"
    default: return "bg-gray-500"
  }
}

export function ReviewPedidoDialog({
  open,
  onOpenChange,
  queueItemId,
  clienteNombre,
  clienteId,
  parseResult,
  onConfirm,
}: ReviewPedidoDialogProps) {
  const [items, setItems] = useState<ParsedItem[]>(parseResult.items)
  const [searchingIdx, setSearchingIdx] = useState<number | null>(null)
  const [productQuery, setProductQuery] = useState("")
  const [productsFound, setProductsFound] = useState<any[]>([])
  const [creating, setCreating] = useState(false)

  const handleSearchProducts = async (term: string) => {
    if (term.length < 2) return
    const { searchProductos } = await import("@/lib/actions/productos")
    const results = await searchProductos(term)
    setProductsFound(results || [])
  }

  const linkProduct = (idx: number, product: any) => {
    setItems(prev => prev.map((item, i) => i === idx
      ? { ...item, matchedProduct: product, confidence: "HIGH" }
      : item
    ))
    setSearchingIdx(null)
    setProductQuery("")
    setProductsFound([])
  }

  const handleConfirm = async () => {
    const validItems = items.filter(i => i.matchedProduct)
    if (validItems.length === 0) {
      toast.error("No hay artículos vinculados")
      return
    }
    setCreating(true)
    try {
      await onConfirm(queueItemId, items, clienteId)
      toast.success("Pedido creado exitosamente")
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message || "Error al crear el pedido")
    } finally {
      setCreating(false)
    }
  }

  const allHigh = items.every(i => i.confidence === "HIGH")
  const needsAttention = items.filter(i => i.confidence !== "HIGH")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[95vw] !max-w-[1100px] h-[90vh] flex flex-col p-4 md:p-6 overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Revisar Pedido — {clienteNombre}</DialogTitle>
          <DialogDescription>
            Revisá los artículos detectados. Los marcados en rojo necesitan vinculación manual.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col flex-1 gap-4 min-h-0">
          {/* Errors */}
          {parseResult.errors && parseResult.errors.length > 0 && (
            <div className="bg-destructive/15 p-3 rounded-md text-sm text-destructive flex flex-col gap-1 shrink-0">
              <div className="font-semibold flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                Algunos archivos no se pudieron procesar:
              </div>
              <ul className="list-disc list-inside px-2">
                {parseResult.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}

          {/* Summary */}
          <div className="flex items-center gap-3 bg-muted/30 p-3 rounded-lg border shrink-0">
            <div className={`p-2 rounded-full ${allHigh ? "bg-green-100 text-green-600" : "bg-orange-100 text-orange-600"}`}>
              {allHigh ? <CheckCircle className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
            </div>
            <div>
              <p className="font-medium text-sm">
                {items.length} artículos detectados
                {!allHigh && ` — ${needsAttention.length} requieren atención`}
              </p>
              <p className="text-xs text-muted-foreground">Cliente: {clienteNombre}</p>
            </div>
          </div>

          {/* Items table */}
          <ScrollArea className="flex-1 border rounded-md min-h-0 bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[55%]">Artículo</TableHead>
                  <TableHead className="w-[100px] text-center">Cant.</TableHead>
                  <TableHead className="w-[100px] text-center">Confianza</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, idx) => (
                  <TableRow key={idx} className={item.confidence !== "HIGH" ? "bg-red-50/50" : ""}>
                    <TableCell>
                      {searchingIdx === idx ? (
                        <div className="relative">
                          <Input
                            autoFocus
                            placeholder="Buscar producto..."
                            className="h-8 text-sm"
                            value={productQuery}
                            onChange={(e) => {
                              setProductQuery(e.target.value)
                              handleSearchProducts(e.target.value)
                            }}
                          />
                          {productsFound.length > 0 && (
                            <div className="absolute top-full left-0 w-full bg-popover border rounded-md shadow-md mt-1 z-[60] max-h-[420px] overflow-auto">
                              {productsFound.map(p => (
                                <div
                                  key={p.id}
                                  className="px-3 py-2 hover:bg-muted cursor-pointer text-sm border-b last:border-0"
                                  onClick={() => linkProduct(idx, p)}
                                >
                                  <div className="font-medium">{p.descripcion}</div>
                                  <div className="text-[10px] text-muted-foreground flex gap-2">
                                    <span>SKU: {p.sku}</span>
                                    <span>${p.precio_venta || p.precio_base}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <button
                            className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground"
                            onClick={() => setSearchingIdx(null)}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div
                          className="flex items-center justify-between group cursor-pointer hover:bg-muted/50 p-2 rounded-md"
                          onClick={() => {
                            setSearchingIdx(idx)
                            setProductQuery(item.matchedProduct?.descripcion || item.originalText)
                            handleSearchProducts(item.matchedProduct?.descripcion || item.originalText)
                          }}
                        >
                          {item.matchedProduct ? (
                            <div className="space-y-0.5">
                              <div className="font-semibold text-sm text-primary">{item.matchedProduct.descripcion || item.matchedProduct.nombre}</div>
                              <div className="text-xs text-muted-foreground flex gap-3">
                                <span>SKU: {item.matchedProduct.sku}</span>
                                <span>Original: {item.originalText}</span>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="h-4 w-4 text-destructive" />
                              <span className="text-destructive font-bold text-sm underline underline-offset-4">
                                {item.originalText}
                              </span>
                              <span className="text-xs text-destructive/80">(Clic para vincular)</span>
                            </div>
                          )}
                          <Search className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Input
                        type="number"
                        className="h-8 w-20 mx-auto text-center"
                        value={item.quantity}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0
                          setItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: val } : it))
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className={`${getConfidenceColor(item.confidence)} text-white border-0`}>
                        {item.confidence}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>

          <div className="flex justify-end gap-2 shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={creating || items.filter(i => i.matchedProduct).length === 0} className="gap-2">
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Crear Pedido ({items.filter(i => i.matchedProduct).length} artículos)
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
