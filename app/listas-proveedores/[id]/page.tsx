"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, CheckCircle, Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react"
import Link from "next/link"
import { useToast } from "@/components/ui/use-toast"
import { formatCurrency } from "@/lib/utils"

export default function DetalleListaPage() {
    const params = useParams()
    const router = useRouter()
    const { toast } = useToast()
    const listaId = params.id as string
    const [lista, setLista] = useState<any>(null)
    const [items, setItems] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [aplicando, setAplicando] = useState(false)

    useEffect(() => {
        if (listaId) loadDetalle()
    }, [listaId])

    const loadDetalle = async () => {
        setLoading(true)
        const res = await fetch(`/api/listas-proveedores/${listaId}`)
        const data = await res.json()
        setLista(data.lista)
        setItems(data.items || [])
        setLoading(false)
    }

    const aplicarLista = async () => {
        if (!confirm('¿Aplicar esta lista de precios? Se actualizarán los precios de los artículos matcheados.')) return
        setAplicando(true)
        try {
            const res = await fetch(`/api/listas-proveedores/${listaId}/aplicar`, { method: 'POST' })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            toast({ title: 'Lista aplicada', description: `${data.aplicados} artículos actualizados` })
            loadDetalle()
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err.message })
        } finally {
            setAplicando(false)
        }
    }

    const getPriceChangeIcon = (item: any) => {
        if (!item.precio_anterior || !item.precio_compra) return <Minus className="h-4 w-4 text-muted-foreground" />
        if (item.precio_compra > item.precio_anterior) return <TrendingUp className="h-4 w-4 text-red-500" />
        if (item.precio_compra < item.precio_anterior) return <TrendingDown className="h-4 w-4 text-green-500" />
        return <Minus className="h-4 w-4 text-muted-foreground" />
    }

    const getVariacion = (item: any) => {
        if (!item.precio_anterior || !item.precio_compra || item.precio_anterior === 0) return null
        const pct = ((item.precio_compra - item.precio_anterior) / item.precio_anterior) * 100
        const color = pct > 0 ? 'text-red-600' : pct < 0 ? 'text-green-600' : 'text-muted-foreground'
        return <span className={`text-xs font-medium ${color}`}>{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</span>
    }

    if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>
    if (!lista) return <div className="p-6">Lista no encontrada</div>

    const itemsMatcheados = items.filter(i => i.articulo_id)
    const itemsSinMatch = items.filter(i => !i.articulo_id)
    const itemsAplicados = items.filter(i => i.estado_item === 'aplicado')

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="flex items-center gap-4">
                <Link href="/listas-proveedores">
                    <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
                </Link>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold">{lista.nombre || 'Lista de Precios'}</h1>
                    <p className="text-muted-foreground">
                        {(lista.proveedor as any)?.nombre || 'Sin proveedor'} — Vigencia: {lista.fecha_vigencia}
                        {lista.fecha_fin && ` hasta ${lista.fecha_fin}`}
                    </p>
                </div>
                {lista.estado === 'pendiente' && (
                    <Button onClick={aplicarLista} disabled={aplicando} className="gap-2 bg-green-600 hover:bg-green-700">
                        {aplicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                        Aplicar Lista
                    </Button>
                )}
                {lista.estado === 'aplicada' && (
                    <Badge className="bg-green-100 text-green-800 text-sm px-3 py-1">Lista aplicada</Badge>
                )}
            </div>

            <div className="grid grid-cols-4 gap-4">
                <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{items.length}</div><p className="text-sm text-muted-foreground">Total ítems</p></CardContent></Card>
                <Card><CardContent className="pt-4"><div className="text-2xl font-bold text-green-600">{itemsMatcheados.length}</div><p className="text-sm text-muted-foreground">Matcheados</p></CardContent></Card>
                <Card><CardContent className="pt-4"><div className="text-2xl font-bold text-amber-600">{itemsSinMatch.length}</div><p className="text-sm text-muted-foreground">Sin match</p></CardContent></Card>
                <Card><CardContent className="pt-4"><div className="text-2xl font-bold text-blue-600">{itemsAplicados.length}</div><p className="text-sm text-muted-foreground">Aplicados</p></CardContent></Card>
            </div>

            {lista.observaciones && (
                <Card><CardContent className="py-3 text-sm text-muted-foreground">{lista.observaciones}</CardContent></Card>
            )}

            <Card>
                <CardHeader><CardTitle>Artículos ({items.length})</CardTitle></CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Código proveedor</TableHead>
                                <TableHead>Descripción</TableHead>
                                <TableHead>Artículo catálogo</TableHead>
                                <TableHead className="text-right">Precio anterior</TableHead>
                                <TableHead className="text-right">Precio nuevo</TableHead>
                                <TableHead className="text-center">Variación</TableHead>
                                <TableHead className="text-center">D1% / D2%</TableHead>
                                <TableHead className="text-center">Estado</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.map((item: any) => {
                                const articulo = Array.isArray(item.articulo) ? item.articulo[0] : item.articulo
                                return (
                                    <TableRow key={item.id} className={!item.articulo_id ? 'opacity-50' : ''}>
                                        <TableCell className="font-mono text-xs">{item.codigo_proveedor || '—'}</TableCell>
                                        <TableCell className="text-sm">{item.descripcion_proveedor || '—'}</TableCell>
                                        <TableCell className="text-sm">
                                            {articulo ? (
                                                <div>
                                                    <div className="font-medium">{articulo.descripcion}</div>
                                                    <div className="text-xs text-muted-foreground">{articulo.sku}</div>
                                                </div>
                                            ) : (
                                                <span className="text-muted-foreground text-xs">Sin match</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-sm">
                                            {item.precio_anterior ? formatCurrency(item.precio_anterior) : '—'}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-sm font-medium">
                                            {item.precio_compra ? formatCurrency(item.precio_compra) : '—'}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                {getPriceChangeIcon(item)}
                                                {getVariacion(item)}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center text-xs">
                                            {item.descuento1 ? `${item.descuento1}%` : '—'} / {item.descuento2 ? `${item.descuento2}%` : '—'}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge className={
                                                item.estado_item === 'aplicado' ? 'bg-green-100 text-green-800' :
                                                item.estado_item === 'ignorado' ? 'bg-gray-100 text-gray-600' :
                                                'bg-blue-100 text-blue-800'
                                            }>
                                                {item.estado_item}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
