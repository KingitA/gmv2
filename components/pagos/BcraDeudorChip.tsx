"use client"

import { useEffect, useState } from "react"

// Chequeo del CUIT del emisor de un cheque contra la Central de Deudores del
// BCRA (proxy Edge /api/bcra/deudor/[cuit]). Reutilizable en oficina
// (MetodoPagoForm), cobro del vendedor y chofer: se le pasa el CUIT y muestra
// el semáforo (situación 1 = normal; 2+ = con deuda en el sistema financiero).

export interface BcraResultado {
  situacion_max: number
  denominacion: string | null
  apto: boolean
  sin_antecedentes: boolean
  error?: string
}

const SITUACION_LABEL: Record<number, string> = {
  1: "Situación 1 — normal",
  2: "Situación 2 — riesgo bajo",
  3: "Situación 3 — riesgo medio",
  4: "Situación 4 — riesgo alto",
  5: "Situación 5 — irrecuperable",
  6: "Situación 6 — irrecuperable (disp. técnica)",
}

export function useBcraDeudor(cuit: string | null | undefined) {
  const [resultado, setResultado] = useState<BcraResultado | null>(null)
  const [consultando, setConsultando] = useState(false)

  useEffect(() => {
    const limpio = (cuit || "").replace(/\D/g, "")
    if (limpio.length < 10) {
      setResultado(null)
      return
    }
    const timer = setTimeout(async () => {
      setConsultando(true)
      setResultado(null)
      try {
        const res = await fetch(`/api/bcra/deudor/${limpio}`)
        const d = await res.json()
        if (d.error) setResultado({ situacion_max: 0, denominacion: null, apto: false, sin_antecedentes: false, error: d.error })
        else setResultado(d)
      } catch {
        setResultado({ situacion_max: 0, denominacion: null, apto: false, sin_antecedentes: false, error: "Sin conexión con el BCRA" })
      } finally {
        setConsultando(false)
      }
    }, 700)
    return () => clearTimeout(timer)
  }, [cuit])

  return { resultado, consultando }
}

export function BcraDeudorChip({ cuit }: { cuit: string | null | undefined }) {
  const { resultado, consultando } = useBcraDeudor(cuit)

  if (consultando) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-xl border border-gray-200 text-sm text-gray-500">
        <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin shrink-0" />
        Consultando Central de Deudores (BCRA)...
      </div>
    )
  }
  if (!resultado) return null

  if (resultado.error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-xl border border-amber-300 text-sm text-amber-800">
        ⚠️ No se pudo consultar el BCRA — verificá el cheque a mano. <span className="text-amber-600">{resultado.error}</span>
      </div>
    )
  }

  if (resultado.apto) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-green-50 rounded-xl border border-green-300 text-sm text-green-800">
        ✅ BCRA: {resultado.sin_antecedentes ? "sin antecedentes" : "situación 1 — normal"}
        {resultado.denominacion && <span className="text-green-600 truncate">· {resultado.denominacion}</span>}
      </div>
    )
  }

  return (
    <div className="px-3 py-2 bg-red-50 rounded-xl border-2 border-red-400 text-sm">
      <p className="font-bold text-red-700">
        ⛔ BCRA: {SITUACION_LABEL[resultado.situacion_max] || `situación ${resultado.situacion_max}`}
      </p>
      {resultado.denominacion && <p className="text-red-600 truncate">{resultado.denominacion}</p>}
      <p className="text-red-500 text-xs mt-0.5">El emisor registra deuda en el sistema financiero — evaluá si aceptás el cheque.</p>
    </div>
  )
}
