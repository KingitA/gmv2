"use client"

// Depósito: el código buscado/escaneado no está entre los activos pero es de un artículo
// DADO DE BAJA. Se ofrece reactivarlo (decisión del dueño 20/10/2026); el servidor
// registra quién lo hizo (historial de altas y bajas, origen "deposito").

import { useState } from "react"
import { toast } from "sonner"
import { reactivarArticuloDeposito } from "@/lib/actions/deposito"

export interface ArticuloDadoDeBaja {
  id: string
  sku: string | null
  descripcion: string | null
}

export function AvisoDadoDeBaja({ articulo, onReactivado }: { articulo: ArticuloDadoDeBaja | null | undefined; onReactivado: () => void }) {
  const [trabajando, setTrabajando] = useState(false)
  if (!articulo) return null
  const reactivar = async () => {
    setTrabajando(true)
    const r = await reactivarArticuloDeposito(articulo.id)
    setTrabajando(false)
    if (!r.ok) { toast.error(r.error || "No se pudo reactivar"); return }
    toast.success(`${articulo.sku ?? ""} ${articulo.descripcion ?? ""} reactivado`)
    onReactivado()
  }
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p>
        Este artículo está <b>dado de baja</b>: <span className="font-mono">{articulo.sku}</span> {articulo.descripcion}.
      </p>
      <p className="mt-0.5">¿Reactivarlo? Vuelve a aparecer en búsquedas, pedidos y en las apps.</p>
      <button
        type="button"
        onClick={reactivar}
        disabled={trabajando}
        className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
      >
        {trabajando ? "Reactivando…" : "Reactivar"}
      </button>
    </div>
  )
}
