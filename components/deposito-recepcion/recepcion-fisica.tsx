"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, Plus, Minus, ArrowRight, ScanBarcode, Package, Pencil } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"

interface RecepcionFisicaProps {
    recepcion: any
    onUpdate: () => void
    onNext: () => void
}

interface RecepcionItemProps {
    item: any
    onUpdateQuantity: (id: string, qty: number) => Promise<void>
}

function RecepcionItem({ item, onUpdateQuantity }: RecepcionItemProps) {
    const [localQty, setLocalQty] = useState<string>(item.cantidad_fisica?.toString() || "")
    const [isUpdating, setIsUpdating] = useState(false)
    // Track if user wants to input in packs or units (default: packs)
    const [inputMode, setInputMode] = useState<"bulto" | "unidad">("bulto")
    // Packaging editor
    const [showPackagingDialog, setShowPackagingDialog] = useState(false)
    const [newPackaging, setNewPackaging] = useState<string>(item.articulo?.unidades_por_bulto?.toString() || "1")
    const { toast } = useToast()

    const handlePackagingUpdate = async () => {
        const value = Number(newPackaging)
        if (value <= 0 || isNaN(value)) {
            toast({
                variant: "destructive",
                title: "Error",
                description: "Las unidades por bulto deben ser mayor a 0"
            })
            return
        }

        try {
            const response = await fetch(`/api/articulos/${item.articulo.id}/packaging`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ unidades_por_bulto: value })
            })

            if (!response.ok) throw new Error("Error actualizando packaging")

            toast({
                title: "Packaging actualizado",
                description: `El artículo ahora tiene ${value} unidades por bulto.`,
            })

            setShowPackagingDialog(false)
            // Force refresh (parent component should refetch)
            window.location.reload()
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo actualizar el packaging."
            })
        }
    }

    // Convert quantity when switching between modes
    const handleModeChange = (newMode: "bulto" | "unidad") => {
        if (newMode === inputMode || !item.articulo?.unidades_por_bulto) return

        const currentQty = Number(localQty) || 0
        if (currentQty === 0) {
            setInputMode(newMode)
            return
        }

        // Convert the quantity
        let convertedQty: number
        if (newMode === "unidad") {
            // Going from packs to units: multiply
            convertedQty = currentQty * item.articulo.unidades_por_bulto
        } else {
            // Going from units to packs: divide (round to 2 decimals)
            convertedQty = Math.round((currentQty / item.articulo.unidades_por_bulto) * 100) / 100
        }

        setLocalQty(convertedQty.toString())
        setInputMode(newMode)
    }

    // Sync local state when prop changes, ONLY if we are not currently editing
    // We can check document.activeElement but it's simpler to just update 
    // if the difference is external (e.g. from a re-fetch not triggered by us).
    // For simplicity, we just initialize. 
    // To properly support external updates while editing, we'd need more logic, 
    // but for this use case, trusting local state while user edits is better.

    const handleBlur = async () => {
        let qtyInPacks = Number(localQty) || 0

        // Convert to packs if currently in unit mode
        if (inputMode === "unidad" && item.articulo?.unidades_por_bulto) {
            qtyInPacks = qtyInPacks / item.articulo.unidades_por_bulto
        }

        // Round to 2 decimals
        qtyInPacks = Math.round(qtyInPacks * 100) / 100

        if (qtyInPacks !== item.cantidad_fisica) {
            setIsUpdating(true)
            await onUpdateQuantity(item.id, qtyInPacks)
            setIsUpdating(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleBlur()
        }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        // Allow empty string to handle deletion
        const val = e.target.value
        setLocalQty(val)
    }

    const increment = async () => {
        const qty = (Number(localQty) || 0) + 1
        setLocalQty(qty.toString())

        let qtyInPacks = qty
        if (inputMode === "unidad" && item.articulo?.unidades_por_bulto) {
            qtyInPacks = qty / item.articulo.unidades_por_bulto
        }
        qtyInPacks = Math.round(qtyInPacks * 100) / 100

        setIsUpdating(true)
        await onUpdateQuantity(item.id, qtyInPacks)
        setIsUpdating(false)
    }

    const decrement = async () => {
        const current = Number(localQty) || 0
        if (current <= 0) return
        const qty = current - 1
        setLocalQty(qty.toString())

        let qtyInPacks = qty
        if (inputMode === "unidad" && item.articulo?.unidades_por_bulto) {
            qtyInPacks = qty / item.articulo.unidades_por_bulto
        }
        qtyInPacks = Math.round(qtyInPacks * 100) / 100

        setIsUpdating(true)
        await onUpdateQuantity(item.id, qtyInPacks)
        setIsUpdating(false)
    }

    return (
        <Card className={`flex flex-col ${Number(localQty) > 0 ? 'border-primary/50 bg-primary/5' : ''}`}>
            <CardHeader className="p-4 pb-2">
                <div className="flex justify-between items-start">
                    <Badge variant="outline" className="font-mono text-xs">
                        {item.articulo?.sku}
                    </Badge>
                    {item.cantidad_oc > 0 && (
                        <span className="text-xs text-muted-foreground">
                            Esperado: {item.cantidad_oc} {item.tipo_cantidad === 'bulto' ? 'bultos' : 'unidades'}
                        </span>
                    )}
                </div>
                <CardTitle className="text-base leading-tight mt-1">
                    {item.articulo?.descripcion}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                    {item.articulo?.rubro} • {item.articulo?.categoria}
                </p>
            </CardHeader>
            <CardContent className="p-4 pt-2 mt-auto">
                {/* Unit Type Toggle (only show if article has packs) */}
                {item.articulo?.unidades_por_bulto > 1 && (
                    <div className="mb-2 flex items-center gap-2">
                        <ToggleGroup
                            type="single"
                            value={inputMode}
                            onValueChange={(value) => value && handleModeChange(value as "bulto" | "unidad")}
                            className="justify-start"
                            size="sm"
                        >
                            <ToggleGroupItem value="bulto" className="text-xs h-7 px-2">
                                <Package className="h-3 w-3 mr-1" />
                                Bultos
                            </ToggleGroupItem>
                            <ToggleGroupItem value="unidad" className="text-xs h-7 px-2">
                                Unidades
                            </ToggleGroupItem>
                        </ToggleGroup>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <span>{item.articulo.unidades_por_bulto}u/b</span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => setShowPackagingDialog(true)}
                            >
                                <Pencil className="h-3 w-3" />
                            </Button>
                        </div>
                    </div>
                )}

                <div className="flex items-center justify-between gap-2 bg-background p-1 rounded-lg border">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={decrement}
                        disabled={isUpdating}
                    >
                        <Minus className="h-4 w-4" />
                    </Button>

                    <div className="flex-1 min-w-[3rem] text-center">
                        <Input
                            type="number"
                            value={localQty}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            onKeyDown={handleKeyDown}
                            className="text-center text-lg font-bold border-none shadow-none h-8 p-0 focus-visible:ring-0"
                            placeholder="0"
                            disabled={isUpdating}
                        />
                        <span className="text-[10px] text-muted-foreground uppercase block -mt-1">
                            {inputMode === 'bulto' ? 'Bultos' : 'Unidades'}
                        </span>
                        {/* Show conversion hint if applicable */}
                        {item.articulo?.unidades_por_bulto > 1 && Number(localQty) > 0 && (
                            <span className="text-[9px] text-muted-foreground block">
                                {inputMode === 'bulto'
                                    ? `= ${Number(localQty) * item.articulo.unidades_por_bulto} un.`
                                    : `≈ ${(Number(localQty) / item.articulo.unidades_por_bulto).toFixed(2)} bultos`
                                }
                            </span>
                        )}
                    </div>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={increment}
                        disabled={isUpdating}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>
            </CardContent>

            {/* Packaging Editor Dialog */}
            <Dialog open={showPackagingDialog} onOpenChange={setShowPackagingDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Actualizar Packaging</DialogTitle>
                        <DialogDescription>
                            Modificá las unidades por bulto para <strong>{item.articulo?.descripcion}</strong>.
                            Este cambio se aplicará permanentemente al artículo.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="packaging" className="text-right">
                                Unidades/Bulto
                            </Label>
                            <Input
                                id="packaging"
                                type="number"
                                min="1"
                                value={newPackaging}
                                onChange={(e) => setNewPackaging(e.target.value)}
                                className="col-span-3"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowPackagingDialog(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handlePackagingUpdate}>
                            Guardar Cambios
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}

export function RecepcionFisica({ recepcion, onUpdate, onNext }: RecepcionFisicaProps) {
    const [searchTerm, setSearchTerm] = useState("")
    const { toast } = useToast()

    const items = useMemo(() => {
        if (!recepcion.items) return []
        return recepcion.items.filter((item: any) => {
            const term = searchTerm.toLowerCase()
            return (
                item.articulo?.descripcion?.toLowerCase().includes(term) ||
                item.articulo?.sku?.toLowerCase().includes(term) ||
                item.articulo?.rubro?.toLowerCase().includes(term)
            )
        })
    }, [recepcion.items, searchTerm])

    const handleUpdateQuantity = async (itemId: string, newQuantity: number) => {
        if (newQuantity < 0) return

        try {
            const response = await fetch(`/api/recepciones/${recepcion.id}/items`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    item_id: itemId,
                    cantidad_fisica: newQuantity
                })
            })

            if (!response.ok) throw new Error("Error actualizando cantidad")

            // We do NOT call onUpdate() immediately here if we want to avoid 
            // full re-renders interrupting typing. 
            // However, onUpdate might be needed to update sums elsewhere.
            // Since we use local state in components, re-renders won't break 
            // the input unless key changes or parent destroys component.
            // Let's call it to keep data consistent.
            onUpdate()
        } catch (error) {
            console.error(error)
            toast({
                variant: "destructive",
                title: "Error",
                description: "No se pudo actualizar la cantidad.",
            })
        }
    }

    return (
        <div className="flex flex-col h-full gap-4">
            {/* Search and Actions Bar */}
            <div className="flex gap-4 items-center bg-card p-4 rounded-lg border shadow-sm">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por nombre, SKU o rubro..."
                        className="pl-9"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <Button variant="outline" className="gap-2">
                    <ScanBarcode className="h-4 w-4" />
                    Escanear
                </Button>
                <Button variant="secondary" className="gap-2">
                    <Plus className="h-4 w-4" />
                    Nuevo Artículo
                </Button>
            </div>

            {/* Items List */}
            <div className="flex-1 overflow-auto grid gap-4 md:grid-cols-2 lg:grid-cols-3 content-start pb-20">
                {items.map((item: any) => (
                    <RecepcionItem
                        key={item.id}
                        item={item}
                        onUpdateQuantity={handleUpdateQuantity}
                    />
                ))}

                {items.length === 0 && (
                    <div className="col-span-full flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <p>No se encontraron artículos</p>
                    </div>
                )}
            </div>

            {/* Floating Footer */}
            <div className="fixed bottom-6 right-6 left-6 md:left-auto max-w-md w-full">
                <Card className="shadow-lg border-primary/20">
                    <div className="p-4 flex items-center justify-between gap-4">
                        <div className="text-sm">
                            <span className="font-bold">{items.filter((i: any) => i.cantidad_fisica > 0).length}</span>
                            <span className="text-muted-foreground"> artículos contados</span>
                        </div>
                        <Button onClick={onNext} className="gap-2">
                            Verificar y Cerrar
                            <ArrowRight className="h-4 w-4" />
                        </Button>
                    </div>
                </Card>
            </div>
        </div>
    )
}
