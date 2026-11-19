"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { InputMonto } from "@/components/ui/input-monto"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Pencil } from "lucide-react"
import { toast } from "sonner"
import { cant } from "@/lib/deposito/unidades"
import type { FilaVerificacion } from "@/lib/compras/verificacion"

// Corregir desde la oficina lo que contó el depósito (E-44). Siempre en UNIDADES.
// Queda registrado quién lo cambió, cuándo, de cuánto a cuánto y por qué; si la recepción ya
// se había finalizado, el servidor ajusta el stock por la diferencia en la misma operación.
export function CorregirRecibido({ fila, onCerrar, onHecho }: { fila: FilaVerificacion; onCerrar: () => void; onHecho: () => void }) {
    const actual = fila.dif.recibido_unidades
    const [unidades, setUnidades] = useState<number | null>(actual)
    const [motivo, setMotivo] = useState("")
    const [guardando, setGuardando] = useState(false)
    const delta = unidades == null ? 0 : Math.round((unidades - actual) * 10000) / 10000

    async function guardar() {
        if (unidades == null || !fila.recepcion_id || !fila.recepcion_item_id) return
        setGuardando(true)
        try {
            const res = await fetch(`/api/recepciones/${fila.recepcion_id}/corregir`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ item_id: fila.recepcion_item_id, unidades, motivo }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) { toast.error(data.error || `No se corrigió (error ${res.status})`, { duration: 12000 }); return }
            // El stock se movió pero el kardex no se anotó: aviso que no se va solo
            if (data.aviso_kardex) toast.warning(data.mensaje, { duration: 30000 })
            else toast.success(data.mensaje || "Cantidad recibida corregida", { duration: 8000 })
            onHecho()
        } finally {
            setGuardando(false)
        }
    }

    return (
        <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" /> Corregir lo recibido</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="p-3 bg-muted rounded-lg text-sm">
                        <p className="font-semibold">{fila.descripcion}</p>
                        <p className="text-muted-foreground font-mono text-xs">{fila.sku}</p>
                        <p className="mt-1 text-xs">El depósito contó <strong>{cant(actual)} unidades</strong>{fila.unidades_por_bulto > 1 ? ` (${cant(actual / fila.unidades_por_bulto)} bultos de ${cant(fila.unidades_por_bulto)})` : ""}.</p>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Cantidad que realmente llegó, en UNIDADES</Label>
                        <InputMonto decimales={2} soloPositivos value={unidades} onChange={setUnidades} />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">Motivo (obligatorio: queda en el registro)</Label>
                        <Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: se recontó el pallet y había un bulto más" />
                    </div>
                    {delta !== 0 && (
                        <div className="p-3 border border-sky-300 bg-sky-50 rounded-lg text-sm text-sky-900">
                            Lo recibido pasa de {cant(actual)} a {cant(unidades ?? 0)} unidades. Si la recepción ya se finalizó, el stock
                            {delta > 0 ? ` SUBE ${cant(delta)}` : ` BAJA ${cant(-delta)}`} unidades; si todavía está abierta, solo cambia el conteo.
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
                    <Button onClick={guardar} disabled={guardando || unidades == null || delta === 0 || motivo.trim().length < 3}>
                        {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Corregir"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
