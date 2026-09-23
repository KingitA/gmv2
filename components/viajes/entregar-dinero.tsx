"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { formatCurrency } from "@/lib/utils"
import type { HojaRuta } from "@/lib/viajes/hoja-ruta"

// "Entregar dinero a chofer": monto a mano, de qué caja/banco sale y quién lo
// retira. Sale en una transacción a la billetera del titular y en /caja queda
// como "A cuenta viaje <NOMBRE> — retiró <QUIEN>".

type Cuenta = { cuenta_tipo: string; cuenta_id: string; nombre: string; saldos?: { BLANCO: number } }

export function EntregarDinero({ hoja, abierto, onClose, onHecho }: { hoja: HojaRuta; abierto: boolean; onClose: () => void; onHecho: () => void }) {
  const { viaje, totales, dinero } = hoja
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [origen, setOrigen] = useState("")
  const [monto, setMonto] = useState("")
  const [retira, setRetira] = useState(viaje.titular_id || "")
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    if (!abierto) return
    setRetira(viaje.titular_id || "")
    setMonto("")
    fetch("/api/finanzas/cajas")
      .then((r) => r.json())
      .then((d) => {
        const movibles: Cuenta[] = (d.cuentas || []).filter((c: Cuenta) => c.cuenta_tipo === "CAJA" || c.cuenta_tipo === "BANCO")
        setCuentas(movibles)
        const chica = movibles.find((c) => c.nombre.toLowerCase().includes("chica")) || movibles.find((c) => c.cuenta_tipo === "CAJA")
        if (chica) setOrigen(`${chica.cuenta_tipo}:${chica.cuenta_id}`)
      })
      .catch(() => {})
  }, [abierto, viaje.titular_id])

  const entregar = async () => {
    const montoNum = Number(String(monto).replace(",", "."))
    if (!origen || !montoNum || montoNum <= 0) { toast.error("Elegí de dónde sale la plata y un monto mayor a 0"); return }
    const [origen_tipo, origen_id] = origen.split(":")
    setOcupado(true)
    try {
      const res = await fetch(`/api/viajes/${viaje.id}/fondo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origen_tipo, origen_id, monto: montoNum, retirado_por: retira || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success("Plata entregada: quedó asentada en la caja y en la billetera del chofer")
      onHecho()
      onClose()
    } catch (e: any) {
      toast.error(e?.message || "No se pudo entregar la plata")
    } finally {
      setOcupado(false)
    }
  }

  const grupos = [
    { titulo: "Cajas", items: cuentas.filter((c) => c.cuenta_tipo === "CAJA") },
    { titulo: "Bancos", items: cuentas.filter((c) => c.cuenta_tipo === "BANCO") },
  ]

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Entregar dinero a chofer</DialogTitle>
          <DialogDescription>
            A cuenta del viaje {viaje.nombre}. Total del viaje {formatCurrency(totales.total_viaje)} · 3 % = {formatCurrency(Math.round(totales.total_viaje * 0.03))}
            {dinero.fondo_entregado > 0 && <> · ya entregado {formatCurrency(dinero.fondo_entregado)}</>}
            {" · "}billetera del titular hoy {formatCurrency(dinero.saldo_billetera_titular)}
          </DialogDescription>
        </DialogHeader>
        {!viaje.titular_id ? (
          <p className="text-sm text-amber-700">Primero asigná el chofer titular (Editar viaje).</p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>Monto</Label>
              <Input type="number" min="0" autoFocus value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Ej: 300000" className="text-lg" />
            </div>
            <div>
              <Label>Sale de</Label>
              <Select value={origen} onValueChange={setOrigen}>
                <SelectTrigger><SelectValue placeholder="Elegí la caja o banco" /></SelectTrigger>
                <SelectContent>
                  {grupos.filter((g) => g.items.length).map((g) => (
                    <SelectGroup key={g.titulo}>
                      <SelectLabel>{g.titulo}</SelectLabel>
                      {g.items.map((c) => (
                        <SelectItem key={c.cuenta_id} value={`${c.cuenta_tipo}:${c.cuenta_id}`}>
                          {c.nombre} · {formatCurrency(c.saldos?.BLANCO ?? 0)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Quién retira</Label>
              <Select value={retira} onValueChange={setRetira}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {viaje.choferes.map((c) => (
                    <SelectItem key={c.usuario_id} value={c.usuario_id}>{c.nombre}{c.rol === "titular" ? " (titular)" : " (acompañante)"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={entregar} disabled={ocupado}>{ocupado ? "Entregando…" : "Entregar"}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
