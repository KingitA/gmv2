"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ArrowLeft, TrendingUp, TrendingDown, Minus, Plus, Truck } from "lucide-react"
import { formatCurrency } from "@/lib/utils"

const TIPO_LABELS: Record<string, { label: string; color: string; sign: number }> = {
    faltante_mercaderia: { label: 'Faltante de mercadería', color: 'bg-orange-100 text-orange-800', sign: 1 },
    pago: { label: 'Pago recibido', color: 'bg-green-100 text-green-800', sign: -1 },
    ajuste: { label: 'Ajuste manual', color: 'bg-blue-100 text-blue-800', sign: 1 },
}

export default function TransporteCCPage() {
    const { id: transporteId } = useParams<{ id: string }>()
    const router = useRouter()

    const [loading, setLoading] = useState(true)
    const [transporte, setTransporte] = useState<any>(null)
    const [movimientos, setMovimientos] = useState<any[]>([])
    const [saldo, setSaldo] = useState(0)

    // New movement form
    const [mostrando, setMostrando] = useState(false)
    const [tipo, setTipo] = useState('pago')
    const [monto, setMonto] = useState('')
    const [descripcion, setDescripcion] = useState('')
    const [nroComp, setNroComp] = useState('')
    const [guardando, setGuardando] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => { loadData() }, [transporteId])

    async function loadData() {
        setLoading(true)
        try {
            const res = await fetch(`/api/transportes/${transporteId}/cuenta-corriente`)
            if (res.ok) {
                const data = await res.json()
                setTransporte(data.transporte)
                setMovimientos(data.movimientos)
                setSaldo(data.saldo)
            }
        } finally {
            setLoading(false)
        }
    }

    async function guardarMovimiento() {
        if (!monto || Number(monto) <= 0) { setError('Ingresá un monto válido'); return }
        setGuardando(true); setError(null)
        try {
            const res = await fetch(`/api/transportes/${transporteId}/cuenta-corriente`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tipo_movimiento: tipo, monto: Number(monto), descripcion, numero_comprobante: nroComp }),
            })
            const data = await res.json()
            if (!res.ok) { setError(data.error || 'Error al guardar'); return }
            setMostrando(false)
            setMonto(''); setDescripcion(''); setNroComp(''); setTipo('pago')
            loadData()
        } finally {
            setGuardando(false)
        }
    }

    if (loading) return <div className="p-6 text-muted-foreground">Cargando...</div>
    if (!transporte) return <div className="p-6 text-muted-foreground">Transporte no encontrado</div>

    return (
        <div className="container mx-auto p-6 space-y-6 max-w-4xl">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-3 flex-1">
                    <Truck className="h-6 w-6 text-muted-foreground" />
                    <div>
                        <h1 className="text-2xl font-bold">{transporte.nombre}</h1>
                        <p className="text-muted-foreground text-sm">Cuenta Corriente{transporte.cuit && ` · CUIT: ${transporte.cuit}`}</p>
                    </div>
                </div>
                <Button onClick={() => setMostrando(!mostrando)} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Registrar movimiento
                </Button>
            </div>

            {/* Saldo card */}
            <Card className={`border-l-4 ${saldo > 0 ? 'border-l-orange-500' : saldo < 0 ? 'border-l-green-500' : 'border-l-gray-300'}`}>
                <CardContent className="py-5 flex items-center justify-between">
                    <div>
                        <p className="text-sm text-muted-foreground font-medium">Saldo actual</p>
                        <p className={`text-3xl font-bold mt-1 ${saldo > 0 ? 'text-orange-600' : saldo < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                            {formatCurrency(Math.abs(saldo))}
                        </p>
                    </div>
                    <div className="text-right">
                        {saldo > 0 ? (
                            <div className="flex items-center gap-2 text-orange-600">
                                <TrendingUp className="h-5 w-5" />
                                <span className="font-semibold">El transporte nos debe</span>
                            </div>
                        ) : saldo < 0 ? (
                            <div className="flex items-center gap-2 text-green-600">
                                <TrendingDown className="h-5 w-5" />
                                <span className="font-semibold">Saldo a favor del transporte</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Minus className="h-4 w-4" />
                                <span>Sin saldo</span>
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">{movimientos.length} movimiento{movimientos.length !== 1 ? 's' : ''}</p>
                    </div>
                </CardContent>
            </Card>

            {/* New movement form */}
            {mostrando && (
                <Card>
                    <CardHeader><CardTitle className="text-base">Nuevo movimiento</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        {error && <p className="text-sm text-destructive">{error}</p>}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Tipo de movimiento</Label>
                                <Select value={tipo} onValueChange={setTipo}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="pago">Pago recibido</SelectItem>
                                        <SelectItem value="faltante_mercaderia">Faltante de mercadería</SelectItem>
                                        <SelectItem value="ajuste">Ajuste manual</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Monto</Label>
                                <Input type="number" step="0.01" placeholder="0.00" value={monto} onChange={e => setMonto(e.target.value)} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>N° Comprobante (opcional)</Label>
                            <Input placeholder="0001-00000001" value={nroComp} onChange={e => setNroComp(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Descripción</Label>
                            <Textarea placeholder="Detalle del movimiento..." rows={2} value={descripcion} onChange={e => setDescripcion(e.target.value)} />
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => { setMostrando(false); setError(null) }}>Cancelar</Button>
                            <Button onClick={guardarMovimiento} disabled={guardando}>
                                {guardando ? 'Guardando...' : 'Guardar movimiento'}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Movements list */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Movimientos</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {movimientos.length === 0 ? (
                        <div className="py-12 text-center text-muted-foreground">
                            <Truck className="h-10 w-10 mx-auto mb-3 opacity-30" />
                            <p>Sin movimientos registrados</p>
                        </div>
                    ) : (
                        <div className="divide-y">
                            {movimientos.map(m => {
                                const config = TIPO_LABELS[m.tipo_movimiento] || { label: m.tipo_movimiento, color: 'bg-gray-100 text-gray-800', sign: 1 }
                                const esPago = m.tipo_movimiento === 'pago'
                                return (
                                    <div key={m.id} className="flex items-start gap-4 px-6 py-4">
                                        <div className="pt-0.5">
                                            {esPago ? (
                                                <TrendingDown className="h-4 w-4 text-green-500" />
                                            ) : (
                                                <TrendingUp className="h-4 w-4 text-orange-500" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <Badge variant="secondary" className={`text-xs ${config.color}`}>
                                                    {config.label}
                                                </Badge>
                                                {m.numero_comprobante && (
                                                    <span className="text-xs text-muted-foreground font-mono">{m.numero_comprobante}</span>
                                                )}
                                            </div>
                                            {m.descripcion && (
                                                <p className="text-sm text-muted-foreground mt-1 truncate">{m.descripcion}</p>
                                            )}
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {new Date(m.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                            </p>
                                        </div>
                                        <div className={`text-right font-semibold ${esPago ? 'text-green-600' : 'text-orange-600'}`}>
                                            {esPago ? '-' : '+'}{formatCurrency(Math.abs(Number(m.monto)))}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
