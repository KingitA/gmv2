"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CheckCircle, AlertTriangle, Loader2 } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

interface RecepcionCotejoProps {
    recepcion: any
    onUpdate: () => void
}

interface ItemDecision {
    tipo?: 'precio' | 'mercaderia'
    accion?: 'A' | 'B' | 'C'
    transporte_id?: string
    valor_real?: number
    descripcion?: string
}

export function RecepcionCotejo({ recepcion, onUpdate }: RecepcionCotejoProps) {
    const { toast } = useToast()
    const router = useRouter()
    const supabase = createClient()
    const [isFinalizing, setIsFinalizing] = useState(false)
    const [transportes, setTransportes] = useState<any[]>([])
    const [decisions, setDecisions] = useState<Record<string, ItemDecision>>({})

    useEffect(() => {
        supabase.from('transportes').select('id, nombre').eq('activo', true).order('nombre')
            .then(({ data }) => setTransportes(data || []))
    }, [])

    const setDecision = (itemId: string, patch: Partial<ItemDecision>) => {
        setDecisions(prev => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }))
    }

    const getFisicoUnidades = (item: any) => {
        const fisica = Number(item.cantidad_fisica || 0)
        if (item.tipo_cantidad === 'bulto') return fisica * (item.articulo?.unidades_por_bulto || 1)
        return fisica
    }

    const hasPriceDiff = (item: any) => {
        const pOC = Number(item.precio_oc || 0)
        const pDoc = Number(item.precio_documentado || 0)
        return pOC > 0 && Math.abs((pDoc - pOC) / pOC) > 0.005
    }

    const hasQtyDiff = (item: any) => {
        const fisico = getFisicoUnidades(item)
        const doc = Number(item.cantidad_documentada || 0)
        return Math.abs(fisico - doc) >= 0.01
    }

    const itemsConDiferencia = (recepcion.items || []).filter((i: any) => hasPriceDiff(i) || hasQtyDiff(i))
    const itemsOk = (recepcion.items || []).filter((i: any) => !hasPriceDiff(i) && !hasQtyDiff(i))

    const handleApplyDecisions = async () => {
        const decisionList = Object.entries(decisions).map(([item_id, d]) => ({
            item_id, ...d
        })).filter(d => d.accion)

        if (decisionList.length > 0) {
            const res = await fetch(`/api/recepciones/${recepcion.id}/cerrar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decisions: decisionList }),
            })
            if (!res.ok) {
                const err = await res.json()
                toast({ variant: 'destructive', title: 'Error aplicando decisiones', description: err.error })
                return false
            }
        }
        return true
    }

    const handleFinalize = async () => {
        // Check all items with differences have decisions
        const pendientes = itemsConDiferencia.filter((i: any) => !decisions[i.id]?.accion && !i.precio_verificado && !i.cantidad_diferencia_destino)
        if (pendientes.length > 0) {
            toast({ variant: 'destructive', title: 'Faltan decisiones', description: `${pendientes.length} ítem(s) con diferencias sin resolver` })
            return
        }

        setIsFinalizing(true)
        try {
            const ok = await handleApplyDecisions()
            if (!ok) return

            const response = await fetch(`/api/recepciones/${recepcion.id}/finalizar`, { method: 'POST' })
            if (!response.ok) throw new Error('Error al finalizar')

            toast({ title: 'Recepción Finalizada', description: 'El stock fue actualizado correctamente.' })
            router.push('/deposito/recepcion')
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo finalizar la recepción.' })
        } finally {
            setIsFinalizing(false)
        }
    }

    return (
        <div className="flex flex-col gap-6 pb-20">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
                <Card>
                    <CardContent className="pt-4">
                        <div className="text-2xl font-bold text-green-600">{itemsOk.length}</div>
                        <p className="text-sm text-muted-foreground">Ítems sin diferencias</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4">
                        <div className="text-2xl font-bold text-amber-600">{itemsConDiferencia.length}</div>
                        <p className="text-sm text-muted-foreground">Con diferencias</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4">
                        <div className="text-2xl font-bold text-blue-600">
                            {Object.values(decisions).filter(d => d.accion).length}
                        </div>
                        <p className="text-sm text-muted-foreground">Decisiones tomadas</p>
                    </CardContent>
                </Card>
            </div>

            {/* Items without differences */}
            {itemsOk.length > 0 && (
                <Card>
                    <CardHeader><CardTitle className="text-green-700">Ítems correctos ({itemsOk.length})</CardTitle></CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Artículo</TableHead>
                                    <TableHead className="text-center">OC</TableHead>
                                    <TableHead className="text-center">Comprobante</TableHead>
                                    <TableHead className="text-center">Físico</TableHead>
                                    <TableHead className="text-center">Estado</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {itemsOk.map((item: any) => (
                                    <TableRow key={item.id}>
                                        <TableCell>
                                            <div className="font-medium">{item.articulo?.descripcion}</div>
                                            <div className="text-xs text-muted-foreground">{item.articulo?.sku}</div>
                                        </TableCell>
                                        <TableCell className="text-center font-mono">{item.cantidad_oc}</TableCell>
                                        <TableCell className="text-center font-mono">{item.cantidad_documentada || '-'}</TableCell>
                                        <TableCell className="text-center font-mono font-bold">{getFisicoUnidades(item)}</TableCell>
                                        <TableCell className="text-center">
                                            <Badge className="bg-green-100 text-green-800 border-green-200">OK</Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {/* Items with differences */}
            {itemsConDiferencia.length > 0 && (
                <Card>
                    <CardHeader><CardTitle className="text-amber-700">Diferencias a resolver ({itemsConDiferencia.length})</CardTitle></CardHeader>
                    <CardContent className="p-0">
                        <div className="space-y-4 p-4">
                            {itemsConDiferencia.map((item: any) => {
                                const fisico = getFisicoUnidades(item)
                                const pOC = Number(item.precio_oc || 0)
                                const pDoc = Number(item.precio_documentado || 0)
                                const pDiffPct = pOC > 0 ? ((pDoc - pOC) / pOC * 100) : 0
                                const qDiff = fisico - Number(item.cantidad_documentada || 0)
                                const dec = decisions[item.id] || {}
                                const resolved = item.precio_verificado || item.cantidad_diferencia_destino || dec.accion

                                return (
                                    <div key={item.id} className={`border rounded-lg p-4 space-y-3 ${resolved ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <div className="font-medium">{item.articulo?.descripcion}</div>
                                                <div className="text-xs text-muted-foreground">{item.articulo?.sku}</div>
                                            </div>
                                            {resolved ? (
                                                <Badge className="bg-green-100 text-green-700">Resuelto</Badge>
                                            ) : (
                                                <Badge className="bg-amber-100 text-amber-700"><AlertTriangle className="h-3 w-3 mr-1" />Pendiente</Badge>
                                            )}
                                        </div>

                                        {/* Columns: OC | Comprobante | Físico */}
                                        <div className="grid grid-cols-3 gap-2 text-sm">
                                            <div className="text-center">
                                                <div className="text-xs text-muted-foreground mb-1">Orden de Compra</div>
                                                <div className="font-mono font-medium">{item.cantidad_oc} u</div>
                                                <div className="font-mono text-xs text-muted-foreground">${pOC.toFixed(2)}/u</div>
                                            </div>
                                            <div className="text-center">
                                                <div className="text-xs text-muted-foreground mb-1">Comprobante</div>
                                                <div className={`font-mono font-medium ${Math.abs(qDiff) > 0.01 ? 'text-amber-700' : ''}`}>{item.cantidad_documentada || '—'} u</div>
                                                <div className={`font-mono text-xs ${Math.abs(pDiffPct) > 0.5 ? 'text-amber-700 font-medium' : 'text-muted-foreground'}`}>
                                                    ${pDoc.toFixed(2)}/u {Math.abs(pDiffPct) > 0.5 && `(${pDiffPct > 0 ? '+' : ''}${pDiffPct.toFixed(1)}%)`}
                                                </div>
                                            </div>
                                            <div className="text-center">
                                                <div className="text-xs text-muted-foreground mb-1">Físico</div>
                                                <div className="font-mono font-bold text-lg">{fisico} u</div>
                                                {qDiff !== 0 && (
                                                    <div className={`text-xs font-medium ${qDiff < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                                                        {qDiff > 0 ? '+' : ''}{qDiff} vs comprobante
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Price difference actions */}
                                        {hasPriceDiff(item) && !item.precio_verificado && (
                                            <div className="border-t pt-3">
                                                <div className="text-xs font-medium mb-2 text-amber-800">Diferencia de precio — elegí una acción:</div>
                                                <div className="flex gap-2 flex-wrap">
                                                    <Button
                                                        size="sm"
                                                        variant={dec.tipo === 'precio' && dec.accion === 'A' ? 'default' : 'outline'}
                                                        onClick={() => setDecision(item.id, { tipo: 'precio', accion: 'A', valor_real: pDoc })}
                                                        className="text-xs"
                                                    >
                                                        A - Asumir (actualizar costo a ${pDoc.toFixed(2)})
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant={dec.tipo === 'precio' && dec.accion === 'B' ? 'default' : 'outline'}
                                                        onClick={() => setDecision(item.id, { tipo: 'precio', accion: 'B', valor_real: pDoc })}
                                                        className="text-xs"
                                                    >
                                                        B - NC al proveedor (no asumir diferencia)
                                                    </Button>
                                                </div>
                                            </div>
                                        )}

                                        {/* Quantity difference actions */}
                                        {hasQtyDiff(item) && !item.cantidad_diferencia_destino && (
                                            <div className="border-t pt-3">
                                                <div className="text-xs font-medium mb-2 text-amber-800">
                                                    Diferencia de mercadería ({Math.abs(qDiff)} u {qDiff < 0 ? 'faltante' : 'sobrante'}) — destino:
                                                </div>
                                                <div className="flex gap-2 flex-wrap items-center">
                                                    <Button
                                                        size="sm"
                                                        variant={dec.tipo === 'mercaderia' && dec.accion === 'A' ? 'default' : 'outline'}
                                                        onClick={() => setDecision(item.id, { tipo: 'mercaderia', accion: 'A', valor_real: Math.abs(qDiff) })}
                                                        className="text-xs"
                                                    >
                                                        A - Empresa absorbe
                                                    </Button>
                                                    <div className="flex items-center gap-1">
                                                        <Button
                                                            size="sm"
                                                            variant={dec.tipo === 'mercaderia' && dec.accion === 'B' ? 'default' : 'outline'}
                                                            onClick={() => setDecision(item.id, { tipo: 'mercaderia', accion: 'B', valor_real: Math.abs(qDiff) })}
                                                            className="text-xs"
                                                            disabled={!dec.transporte_id && dec.accion !== 'B'}
                                                        >
                                                            B - Transporte
                                                        </Button>
                                                        {(dec.tipo === 'mercaderia' && dec.accion === 'B') && (
                                                            <Select value={dec.transporte_id || ''} onValueChange={v => setDecision(item.id, { transporte_id: v })}>
                                                                <SelectTrigger className="w-40 h-7 text-xs"><SelectValue placeholder="Elegir transporte" /></SelectTrigger>
                                                                <SelectContent>
                                                                    {transportes.map((t: any) => (
                                                                        <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        )}
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        variant={dec.tipo === 'mercaderia' && dec.accion === 'C' ? 'default' : 'outline'}
                                                        onClick={() => setDecision(item.id, { tipo: 'mercaderia', accion: 'C', valor_real: Math.abs(qDiff) })}
                                                        className="text-xs"
                                                    >
                                                        C - Proveedor (devolucion kardex)
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="flex justify-end gap-4">
                <Button
                    size="lg"
                    className="gap-2"
                    onClick={handleFinalize}
                    disabled={isFinalizing}
                >
                    {isFinalizing ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
                    Finalizar Recepción
                </Button>
            </div>
        </div>
    )
}
