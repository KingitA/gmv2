"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { CuentaAjustable } from "@/components/finanzas/ajustar-saldo-dialog"

const fmt = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Rutina diaria de saldos a mano: todas las cuentas en una sola pantalla.
 * Cada saldo que cambies se registra vía caja_ajustar (AJUSTE_CAJA en el
 * kardex, con tu firma). El punto delimita centavos (1000.5 = $1.000,50).
 * Cuando entren las APIs bancarias esta rutina desaparece.
 */
export function ActualizarSaldosDialog({
  cuentas,
  open,
  onOpenChange,
  onSaved,
}: {
  cuentas: (CuentaAjustable & { updated_at?: string | null })[]
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved?: () => void
}) {
  const [valores, setValores] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      const v: Record<string, string> = {}
      for (const c of cuentas) v[c.cuenta_id] = String(Number(c.saldos.BLANCO ?? 0))
      setValores(v)
    }
  }, [open, cuentas])

  const parse = (s: string) => {
    const t = s.trim().replace(",", ".")
    if (!t || !/^-?\d+(\.\d{0,2})?$/.test(t)) return null
    return Number(t)
  }

  const ultimaAct = (iso?: string | null) => {
    if (!iso) return "sin datos"
    const d = new Date(iso)
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
    const dia = d.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
    const hora = d.toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" })
    if (dia === hoy) return `hoy ${hora}`
    return `${d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })} ${hora}`
  }

  const guardar = async () => {
    const cambios: { cuenta: CuentaAjustable; nuevo: number }[] = []
    for (const c of cuentas) {
      const raw = valores[c.cuenta_id]
      if (raw === undefined) continue
      const n = parse(raw)
      if (n === null) {
        toast.error(`Saldo inválido en ${c.nombre} — el punto son centavos (1000.5 = $1.000,50)`)
        return
      }
      if (n !== Number(c.saldos.BLANCO ?? 0)) cambios.push({ cuenta: c, nuevo: n })
    }
    if (!cambios.length) {
      toast.info("No cambiaste ningún saldo")
      onOpenChange(false)
      return
    }
    setSaving(true)
    try {
      for (const ch of cambios) {
        const res = await fetch("/api/finanzas/cajas/ajustar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cuenta_tipo: ch.cuenta.cuenta_tipo,
            cuenta_id: ch.cuenta.cuenta_id,
            color: "BLANCO",
            nuevo_saldo: ch.nuevo,
            motivo: "Actualización diaria de saldos",
          }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(`${ch.cuenta.nombre}: ${err.error}`)
        }
      }
      toast.success(`${cambios.length} saldo${cambios.length > 1 ? "s" : ""} actualizado${cambios.length > 1 ? "s" : ""}`)
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
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Actualizar saldos de hoy</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Cargá lo que ves en cada homebanking. Solo se registran los que cambies (quedan en el kardex como ajuste con tu firma). El punto son centavos.
        </p>
        <div className="space-y-2">
          {cuentas.map((c) => (
            <div key={c.cuenta_id} className="flex items-center gap-3">
              <div className="w-40 shrink-0">
                <p className="text-sm font-medium leading-tight">{c.nombre}</p>
                <p className="text-[11px] text-muted-foreground">últ. act.: {ultimaAct(c.updated_at)}</p>
              </div>
              <Input
                inputMode="decimal"
                className="tabular-nums"
                value={valores[c.cuenta_id] ?? ""}
                onChange={(e) => setValores((p) => ({ ...p, [c.cuenta_id]: e.target.value }))}
              />
              <span className="text-[11px] text-muted-foreground w-28 text-right shrink-0">{fmt(Number(c.saldos.BLANCO ?? 0))}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" disabled={saving} onClick={guardar}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Guardar los que cambié
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
