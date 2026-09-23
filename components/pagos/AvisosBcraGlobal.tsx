"use client"

import { AvisosBcra, useConsultasBcra } from "./BcraDeudorChip"

// Veredictos del BCRA que llegaron DESPUÉS de registrar el cobro (o de cerrar el
// formulario). Va en el layout de /vendedor y /chofer: el operario puede haber
// cambiado de pantalla y el aviso lo sigue. Mismo patrón que el aviso persistente
// de la app vendedor (dejarAviso/useAvisoEntrante).
export function AvisosBcraGlobal() {
  const { avisos, pendientes, quitar } = useConsultasBcra()
  if (!avisos.length && !pendientes.length) return null
  return (
    <div className="sticky top-0 z-40 px-4 pt-3">
      <AvisosBcra avisos={avisos} pendientes={pendientes} onVisto={quitar} />
    </div>
  )
}
