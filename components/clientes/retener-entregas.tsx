"use client"

// "Retener entregas" en la ficha del cliente (P2-08). Va por su propia ruta
// (POST /api/clientes/[id]/retencion → lib/viajes/retencion.ts), no por el
// Guardar de la ficha: además de marcar al cliente bloquea o destraba sus
// paradas en los viajes ya armados.

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

export function RetenerEntregas({
  clienteId,
  retenido: retenidoInicial,
  motivo: motivoInicial,
}: {
  clienteId: string
  retenido: boolean
  motivo: string | null
}) {
  const [retenido, setRetenido] = useState(retenidoInicial)
  const [motivoActual, setMotivoActual] = useState(motivoInicial)
  const [editando, setEditando] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [guardando, setGuardando] = useState(false)

  const cambiar = async (retener: boolean) => {
    setGuardando(true)
    try {
      const r = await fetch(`/api/clientes/${clienteId}/retencion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retener, motivo }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "No se pudo cambiar la retención")
      setRetenido(retener)
      setMotivoActual(retener ? motivo.trim() : null)
      setEditando(false); setMotivo("")
      const paradas = j.paradas ? ` (${j.paradas} ${j.paradas === 1 ? "parada" : "paradas"} de viajes armados)` : ""
      toast.success(retener ? `Entregas retenidas${paradas}` : `Entregas liberadas${paradas}`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setGuardando(false)
    }
  }

  if (retenido) {
    return (
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate rounded-md border border-error-200 bg-error-50 px-3 py-2 text-sm font-medium text-error-700"
          title="Mientras esté retenido, el chofer no baja mercadería sin cobrar">
          Retenido: {motivoActual || "deuda vencida"}
        </span>
        <Button type="button" variant="outline" size="sm" disabled={guardando} onClick={() => cambiar(false)}>
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Liberar"}
        </Button>
      </div>
    )
  }

  if (editando) {
    return (
      <div className="flex items-center gap-2">
        <Input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (ej.: deuda vencida)" maxLength={200}
          onKeyDown={(e) => { if (e.key === "Enter" && motivo.trim()) { e.preventDefault(); cambiar(true) } }} />
        <Button type="button" size="sm" variant="destructive" disabled={guardando || !motivo.trim()} onClick={() => cambiar(true)}>
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Retener"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={guardando} onClick={() => { setEditando(false); setMotivo("") }}>Cancelar</Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-sm text-neutro-500">Entrega normal</span>
      <Button type="button" variant="outline" size="sm" onClick={() => setEditando(true)}
        title="El chofer no baja mercadería sin cobrar; bloquea también las paradas de viajes ya armados">
        Retener entregas
      </Button>
    </div>
  )
}
