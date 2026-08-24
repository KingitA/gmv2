"use client"

import { useEffect, useRef } from "react"

// Botón "atrás" físico (Android/gesto) dentro de pantallas con navegación
// interna (catálogo, sheets, búsquedas): sin esto, el navegador saca al
// usuario de la página entera y pierde el pedido a medio armar.
//
// Cómo funciona: al montar se apila una entrada centinela en el history.
// El "atrás" físico consume esa entrada y dispara popstate; ahí `onBack()`
// intenta desarmar UN paso interno (cerrar sheet, limpiar búsqueda, subir
// un nivel del catálogo). Si desarmó algo devuelve true y se re-apila el
// centinela (listo para el próximo "atrás"); si ya no queda nada que
// desarmar devuelve false y se deja salir de verdad.
export function useBackTrap(onBack: () => boolean) {
  const ref = useRef(onBack)
  ref.current = onBack

  useEffect(() => {
    window.history.pushState({ backTrap: true }, "")
    const onPop = () => {
      if (ref.current()) {
        window.history.pushState({ backTrap: true }, "")
      } else {
        // Nada interno que cerrar: salir de la página de verdad
        window.history.back()
      }
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
