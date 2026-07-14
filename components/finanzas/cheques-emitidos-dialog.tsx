"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EntitySearchSelect } from "@/components/search/EntitySearchSelect"
import { formatCurrency } from "@/lib/utils"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

interface FilaCheque {
    banco: string
    numero: string
    monto: string
    fecha_vencimiento: string
    color: "BLANCO" | "NEGRO"
    es_echeq: boolean
}

export interface PrefillEmitidos {
    proveedor?: { id: string; nombre: string } | null
    vencimiento_id?: string
    monto?: number
    fecha?: string
}

const hoyISO = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const filaVacia = (fecha?: string): FilaCheque => ({
    banco: "",
    numero: "",
    monto: "",
    fecha_vencimiento: fecha || hoyISO(),
    color: "BLANCO",
    es_echeq: false,
})

/**
 * Registro de cheques propios entregados a un proveedor (uno o varios).
 * Se cargan con su fecha de pago: desde ahí y por 30 días pueden debitarse
 * de la cuenta, y hasta que se concilie el débito figuran como comprometidos.
 */
export function ChequesEmitidosDialog({
    open,
    onOpenChange,
    prefill,
    onSaved,
}: {
    open: boolean
    onOpenChange: (o: boolean) => void
    prefill?: PrefillEmitidos | null
    onSaved?: () => void
}) {
    const [proveedor, setProveedor] = useState<any>(null)
    const [filas, setFilas] = useState<FilaCheque[]>([filaVacia()])
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (open) {
            setProveedor(prefill?.proveedor ?? null)
            setFilas([{
                ...filaVacia(prefill?.fecha),
                monto: prefill?.monto ? String(prefill.monto) : "",
            }])
        }
    }, [open, prefill])

    const setFila = (i: number, patch: Partial<FilaCheque>) =>
        setFilas((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)))

    const parseMonto = (s: string) => {
        const n = parseFloat(s.replace(/\./g, "").replace(",", "."))
        return isNaN(n) ? 0 : n
    }
    const total = filas.reduce((a, f) => a + parseMonto(f.monto), 0)

    async function guardar(e: React.FormEvent) {
        e.preventDefault()
        const validas = filas.filter((f) => f.numero.trim() && parseMonto(f.monto) > 0 && f.fecha_vencimiento)
        if (!validas.length) {
            toast.error("Cargá al menos un cheque con número, monto y fecha de pago")
            return
        }
        setSaving(true)
        try {
            const res = await fetch("/api/cheques/emitidos", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    proveedor_id: proveedor?.id || null,
                    vencimiento_id: prefill?.vencimiento_id || null,
                    cheques: validas.map((f) => ({
                        banco: f.banco,
                        numero: f.numero,
                        monto: parseMonto(f.monto),
                        fecha_vencimiento: f.fecha_vencimiento,
                        color: f.color,
                        es_echeq: f.es_echeq,
                    })),
                }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error registrando cheques")
            toast.success(`${json.registrados} cheque(s) emitido(s) registrado(s)`)
            onOpenChange(false)
            onSaved?.()
        } catch (err: any) {
            toast.error(err.message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Registrar cheques emitidos</DialogTitle>
                </DialogHeader>
                <form onSubmit={guardar} className="space-y-4">
                    <div>
                        <Label>Proveedor (a quién se entregaron)</Label>
                        <EntitySearchSelect
                            entity="proveedores"
                            placeholder="Buscar proveedor..."
                            value={proveedor}
                            onSelect={setProveedor}
                        />
                    </div>

                    <div className="space-y-2">
                        {filas.map((f, i) => (
                            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_90px_32px] items-end gap-2 rounded-lg border p-2">
                                <div>
                                    <Label className="text-[10px]">Banco</Label>
                                    <Input className="h-8 text-xs" value={f.banco} placeholder="S/D"
                                        onChange={(e) => setFila(i, { banco: e.target.value })} />
                                </div>
                                <div>
                                    <Label className="text-[10px]">Número *</Label>
                                    <Input className="h-8 font-mono text-xs" value={f.numero}
                                        onChange={(e) => setFila(i, { numero: e.target.value })} />
                                </div>
                                <div>
                                    <Label className="text-[10px]">Monto *</Label>
                                    <Input className="h-8 font-mono text-xs" inputMode="decimal" value={f.monto} placeholder="0"
                                        onChange={(e) => setFila(i, { monto: e.target.value })} />
                                </div>
                                <div>
                                    <Label className="text-[10px]">Fecha de pago *</Label>
                                    <Input className="h-8 font-mono text-xs" type="date" value={f.fecha_vencimiento}
                                        onChange={(e) => setFila(i, { fecha_vencimiento: e.target.value })} />
                                </div>
                                <div>
                                    <Label className="text-[10px]">Tipo</Label>
                                    <Select
                                        value={f.es_echeq ? "ECHEQ" : f.color}
                                        onValueChange={(v) =>
                                            setFila(i, v === "ECHEQ"
                                                ? { color: "BLANCO", es_echeq: true }
                                                : { color: v as "BLANCO" | "NEGRO", es_echeq: false })
                                        }
                                    >
                                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="BLANCO">Blanco</SelectItem>
                                            <SelectItem value="NEGRO">Negro</SelectItem>
                                            <SelectItem value="ECHEQ">Echeq</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <Button
                                    type="button" variant="ghost" size="icon"
                                    className="h-8 w-8 text-red-500 hover:bg-red-50"
                                    disabled={filas.length === 1}
                                    onClick={() => setFilas((prev) => prev.filter((_, j) => j !== i))}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" className="gap-1 text-xs"
                            onClick={() => setFilas((prev) => [...prev, filaVacia(prev[prev.length - 1]?.fecha_vencimiento)])}>
                            <Plus className="h-3.5 w-3.5" /> Otro cheque
                        </Button>
                    </div>

                    <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">{filas.length} cheque(s)</span>
                        <span className="font-mono font-bold">{formatCurrency(total)}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        Cada cheque puede debitarse desde su fecha de pago y por 30 días. Hasta que marques el débito
                        (botón &quot;Se debitó&quot; en Finanzas), figura como plata comprometida.
                    </p>

                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                        <Button type="submit" disabled={saving}>
                            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Registrar
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
