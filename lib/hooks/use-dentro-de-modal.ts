'use client'

// ¿Este elemento está adentro de un modal o panel lateral?
// Los modales tienen scroll propio (components/ui/dialog.tsx), así que una lista
// desplegable "flotante" (position:absolute) queda recortada por el borde del modal.
// Las listas de búsqueda usan esto para mostrarse como parte del contenido cuando
// están dentro de un modal (el modal crece/scrollea y se ven todas las opciones).

import { useLayoutEffect, useState, type RefObject } from 'react'

const MODALES = '[data-slot="dialog-content"],[data-slot="sheet-content"],[data-slot="alert-dialog-content"]'

export function useDentroDeModal(ref: RefObject<HTMLElement | null>, activo = true) {
  const [dentro, setDentro] = useState(false)
  useLayoutEffect(() => {
    if (activo) setDentro(!!ref.current?.closest(MODALES))
  }, [activo, ref])
  return dentro
}
