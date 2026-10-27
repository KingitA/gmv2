"use client"

// 10 % contado de la vista previa del cobro, pedido al servidor (R5, 27/10): la
// misma base que usa la nota (comprobante COMPLETO menos lo ya devuelto, una
// sola vez). Mientras carga, `listo` es false y la pantalla usa su cálculo de siempre.

import { useEffect, useState } from "react"

export interface VistaContado {
  listo: boolean
  /** comprobante_id → 10 % que le corresponde (no figura si ya lo tiene o no bonifica) */
  bonif: Record<string, number>
  /** créditos (NC/REV) que son de devolución */
  devolucion: Set<string>
}

const VACIA: VistaContado = { listo: false, bonif: {}, devolucion: new Set() }

export function useVistaContado(
  clienteId: string | null | undefined,
  comprobanteIds: string[],
  creditoIds: string[],
  activo: boolean,
): VistaContado {
  const [vista, setVista] = useState<VistaContado>(VACIA)
  const claveComps = [...comprobanteIds].sort().join(",")
  const claveCreds = [...creditoIds].sort().join(",")

  useEffect(() => {
    setVista(VACIA)
    if (!activo || !clienteId || !claveComps) return
    let vigente = true
    fetch("/api/cobranzas/vista-contado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cliente_id: clienteId,
        comprobante_ids: claveComps.split(","),
        credito_ids: claveCreds ? claveCreds.split(",") : [],
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vigente && d) setVista({ listo: true, bonif: d.bonif || {}, devolucion: new Set(d.devolucion || []) })
      })
      .catch(() => {})
    return () => { vigente = false }
  }, [clienteId, claveComps, claveCreds, activo])

  return vista
}
