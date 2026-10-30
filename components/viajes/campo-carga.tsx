"use client"

import { useEffect, useState } from "react"
import { InputMonto } from "@/components/ui/input-monto"

/**
 * Bultos o pallets de un pedido: entero ≥ 0 que se guarda al salir del campo
 * (o con Enter). Sin carga el campo queda VACÍO, no "0" (P2-26: con 0, tipear
 * 36 daba "036").
 */
export function CampoCarga({
  valor, onGuardar, etiqueta, className = "h-7 w-14 text-right",
}: {
  valor: number
  onGuardar: (n: number) => void
  etiqueta: string
  className?: string
}) {
  const [texto, setTexto] = useState<number | null>(valor || null)
  useEffect(() => { setTexto(valor || null) }, [valor])
  const guardar = () => {
    const n = Math.max(0, Math.trunc(texto ?? 0))
    if (n !== (valor || 0)) onGuardar(n)
  }
  return (
    <InputMonto
      decimales={0}
      soloPositivos
      value={texto}
      onChange={setTexto}
      onBlur={guardar}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
      placeholder=""
      aria-label={etiqueta}
      title={etiqueta}
      className={className}
    />
  )
}
