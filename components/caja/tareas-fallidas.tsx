"use client"

// Panel "Pendientes de reproceso" — pasos accesorios del cobro que fallaron
// (posteo al libro, NC 10%, créditos, ajuste, comisiones) y esperan reintento.
// Nada falla en silencio: lo que quedó a medias grita acá hasta resolverse.

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

type Tarea = {
  id: string
  tipo: string
  referencia_tipo: string | null
  referencia_id: string | null
  error: string | null
  intentos: number
  creado_en: string
}

const TIPO_LABEL: Record<string, string> = {
  cc_postear: "Asiento en cta cte sin registrar",
  post_confirmacion: "Extras del cobro a medias (10% / créditos / comisiones)",
}

export function TareasFallidas() {
  const { toast } = useToast()
  const [tareas, setTareas] = useState<Tarea[]>([])
  const [reintentando, setReintentando] = useState<string | null>(null)

  const cargar = () =>
    fetch("/api/finanzas/tareas-fallidas")
      .then((r) => r.json())
      .then((d) => setTareas(d.tareas || []))
      .catch(() => {})

  useEffect(() => {
    cargar()
  }, [])

  if (!tareas.length) return null

  const reintentar = async (t: Tarea) => {
    setReintentando(t.id)
    try {
      const res = await fetch(`/api/finanzas/tareas-fallidas/${t.id}/reintentar`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "El reintento falló")
      toast({ title: "Resuelto", description: "La operación pendiente se completó." })
      cargar()
    } catch (e: any) {
      toast({ variant: "destructive", title: "Sigue fallando", description: e.message })
      cargar()
    } finally {
      setReintentando(null)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-red-200 bg-red-50/60 p-4">
      <div className="text-[12.5px] font-bold text-red-800">
        ⚠ Pendientes de reproceso ({tareas.length})
      </div>
      <p className="mt-0.5 text-[11px] text-red-700">
        Pasos de un cobro o factura que fallaron a mitad de camino. Reintentalos: la operación completa
        solo lo que faltó.
      </p>
      <div className="mt-2 space-y-2">
        {tareas.map((t) => (
          <div key={t.id} className="rounded-lg border border-red-200 bg-white p-2.5">
            <div className="text-xs font-semibold text-slate-800">{TIPO_LABEL[t.tipo] ?? t.tipo}</div>
            {t.error && <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{t.error}</div>}
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[10px] text-slate-400">
                {t.intentos} intento{t.intentos !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => reintentar(t)}
                disabled={reintentando === t.id}
                className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {reintentando === t.id && <Loader2 className="h-3 w-3 animate-spin" />}
                Reintentar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
