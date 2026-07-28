"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Check, Loader2, Link2 } from "lucide-react"
import { EntitySearchSelect } from "@/components/search/EntitySearchSelect"
import { ArticuloResultRow } from "@/components/search/ArticuloResultRow"

// Líneas de comprobantes cuyo OCR no matcheó (o matcheó con dudas) contra el
// catálogo. Confirmar una línea enseña la equivalencia al sistema
// (articulos_proveedores + articulos_alias): la próxima factura del mismo
// proveedor matchea sola.
export function RevisarMatches({
    comprobantes,
    onResolved,
}: {
    comprobantes: any[]
    onResolved?: () => void
}) {
    const [pendientes, setPendientes] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [resolviendo, setResolviendo] = useState<string | null>(null)
    const [seleccion, setSeleccion] = useState<Record<string, any>>({})
    const [error, setError] = useState<string | null>(null)

    const cargar = useCallback(async () => {
        if (comprobantes.length === 0) {
            setPendientes([])
            return
        }
        setLoading(true)
        try {
            const listas = await Promise.all(
                comprobantes.map(async (comp) => {
                    const res = await fetch(`/api/comprobantes-compra/${comp.id}/detalle`)
                    if (!res.ok) return []
                    const rows = await res.json()
                    return rows
                        .filter((r: any) => r.match_estado === "sugerido" || r.match_estado === "sin_match")
                        .map((r: any) => ({ ...r, comprobante: comp }))
                })
            )
            setPendientes(listas.flat())
        } finally {
            setLoading(false)
        }
    }, [comprobantes])

    useEffect(() => {
        cargar()
    }, [cargar])

    const confirmar = async (row: any, articuloId: string) => {
        setResolviendo(row.id)
        setError(null)
        try {
            const res = await fetch(`/api/comprobantes-compra/${row.comprobante.id}/detalle`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ detalle_id: row.id, articulo_id: articuloId }),
            })
            const data = await res.json()
            if (!res.ok) {
                setError(data.error || "Error al confirmar el match")
                return
            }
            setPendientes((prev) => prev.filter((p) => p.id !== row.id))
            onResolved?.()
        } catch {
            setError("Error de conexión")
        } finally {
            setResolviendo(null)
        }
    }

    if (loading && pendientes.length === 0) return null
    if (pendientes.length === 0) return null

    return (
        <Card className="border-amber-300">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-700">
                    <Link2 className="h-5 w-5" />
                    Revisar matches
                    <Badge variant="destructive">{pendientes.length} sin vincular</Badge>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                    Artículos de la factura que no se pudieron vincular al catálogo. Al confirmarlos, el
                    sistema aprende la equivalencia para las próximas facturas de este proveedor.
                </p>
            </CardHeader>
            <CardContent className="space-y-3">
                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}
                {pendientes.map((row) => {
                    const sugerido = row.sugerido
                    const elegido = seleccion[row.id]
                    return (
                        <div key={row.id} className="border rounded-lg p-3 space-y-2 bg-amber-50/40">
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium">{row.descripcion_proveedor || "(sin descripción)"}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {row.codigo_proveedor && <>Cód. proveedor: {row.codigo_proveedor} · </>}
                                        Cant: {Number(row.cantidad_facturada || 0)} · ${Number(row.precio_unitario || 0).toFixed(2)} ·{" "}
                                        {row.comprobante.tipo_comprobante} {row.comprobante.numero_comprobante}
                                    </p>
                                </div>
                                {row.match_estado === "sugerido" && row.match_score != null && (
                                    <Badge variant="outline" className="shrink-0">
                                        Sugerencia {(Number(row.match_score) * 100).toFixed(0)}%
                                    </Badge>
                                )}
                            </div>

                            {sugerido && (
                                <div className="flex items-center justify-between gap-2 border rounded-md p-2 bg-white">
                                    <div className="min-w-0">
                                        <p className="text-sm truncate">{sugerido.descripcion}</p>
                                        <p className="text-xs text-muted-foreground">SKU {sugerido.sku}</p>
                                    </div>
                                    <Button
                                        size="sm"
                                        disabled={resolviendo === row.id}
                                        onClick={() => confirmar(row, sugerido.id)}
                                    >
                                        {resolviendo === row.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <>
                                                <Check className="h-4 w-4 mr-1" /> Confirmar sugerencia
                                            </>
                                        )}
                                    </Button>
                                </div>
                            )}

                            <div className="flex items-center gap-2 flex-wrap">
                                <div className="flex-1 min-w-56">
                                    <EntitySearchSelect
                                        entity="articulos"
                                        compact
                                        value={elegido || null}
                                        onSelect={(item: any) => setSeleccion((prev) => ({ ...prev, [row.id]: item }))}
                                        placeholder={sugerido ? "O buscar otro artículo…" : "Buscar artículo del catálogo…"}
                                        renderItem={(item: any) => <ArticuloResultRow articulo={item} size="sm" />}
                                    />
                                </div>
                                {elegido && (
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={resolviendo === row.id}
                                        onClick={() => confirmar(row, elegido.id)}
                                    >
                                        {resolviendo === row.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <>
                                                <Check className="h-4 w-4 mr-1" /> Vincular
                                            </>
                                        )}
                                    </Button>
                                )}
                            </div>
                        </div>
                    )
                })}
            </CardContent>
        </Card>
    )
}
