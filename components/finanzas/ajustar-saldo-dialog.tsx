"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatCurrency } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

export interface CuentaAjustable {
    cuenta_tipo: string
    cuenta_id: string
    nombre: string
    saldos: { BLANCO: number; NEGRO: number }
}

/**
 * Edición manual del saldo de una cuenta (BLANCO y NEGRO por separado).
 * Registra la diferencia como AJUSTE_CAJA en el kardex vía
 * POST /api/finanzas/cajas/ajustar.
 */
export function AjustarSaldoDialog({
    cuenta,
    open,
    onOpenChange,
    onSaved,
}: {
    cuenta: CuentaAjustable | null
    open: boolean
    onOpenChange: (o: boolean) => void
    onSaved?: () => void
}) {
    const [blanco, setBlanco] = useState("")
    const [negro, setNegro] = useState("")
    const [motivo, setMotivo] = useState("")
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (cuenta && open) {
            setBlanco(String(cuenta.saldos.BLANCO ?? 0))
            setNegro(String(cuenta.saldos.NEGRO ?? 0))
            setMotivo("")
        }
    }, [cuenta, open])

    if (!cuenta) return null

    const parse = (s: string) => {
        const n = parseFloat(s.replace(/\./g, "").replace(",", "."))
        return isNaN(n) ? null : n
    }

    async function guardar(e: React.FormEvent) {
        e.preventDefault()
        if (!cuenta) return
        const nuevoBlanco = parse(blanco)
        const nuevoNegro = parse(negro)
        if (nuevoBlanco === null || nuevoNegro === null) {
            toast.error("Saldo inválido")
            return
        }
        const cambios: Array<{ color: string; nuevo_saldo: number }> = []
        if (nuevoBlanco !== Number(cuenta.saldos.BLANCO ?? 0)) cambios.push({ color: "BLANCO", nuevo_saldo: nuevoBlanco })
        if (nuevoNegro !== Number(cuenta.saldos.NEGRO ?? 0)) cambios.push({ color: "NEGRO", nuevo_saldo: nuevoNegro })
        if (!cambios.length) {
            onOpenChange(false)
            return
        }
        setSaving(true)
        try {
            for (const c of cambios) {
                const res = await fetch("/api/finanzas/cajas/ajustar", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        cuenta_tipo: cuenta.cuenta_tipo,
                        cuenta_id: cuenta.cuenta_id,
                        color: c.color,
                        nuevo_saldo: c.nuevo_saldo,
                        motivo: motivo || null,
                    }),
                })
                if (!res.ok) {
                    const err = await res.json()
                    throw new Error(err.error || `Error ajustando saldo ${c.color}`)
                }
            }
            toast.success(`Saldo de ${cuenta.nombre} actualizado`)
            onOpenChange(false)
            onSaved?.()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Ajustar saldo — {cuenta.nombre}</DialogTitle>
                </DialogHeader>
                <form onSubmit={guardar} className="space-y-4">
                    <div>
                        <Label>Saldo blanco</Label>
                        <Input inputMode="decimal" value={blanco} onChange={(e) => setBlanco(e.target.value)} />
                        <p className="mt-1 text-[11px] text-muted-foreground">
                            Actual: {formatCurrency(Number(cuenta.saldos.BLANCO ?? 0))}
                        </p>
                    </div>
                    <div>
                        <Label>Saldo negro</Label>
                        <Input inputMode="decimal" value={negro} onChange={(e) => setNegro(e.target.value)} />
                        <p className="mt-1 text-[11px] text-muted-foreground">
                            Actual: {formatCurrency(Number(cuenta.saldos.NEGRO ?? 0))}
                        </p>
                    </div>
                    <div>
                        <Label>Motivo (opcional)</Label>
                        <Input
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            placeholder="Ej: arqueo de caja, conciliación bancaria..."
                        />
                    </div>
                    <p className="rounded-md bg-slate-50 p-2 text-[11px] text-muted-foreground">
                        La diferencia queda registrada en el kardex como AJUSTE_CAJA (trazable en el historial).
                    </p>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                        <Button type="submit" disabled={saving}>
                            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Guardar
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
