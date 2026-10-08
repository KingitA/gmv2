"use client"

// Vitrina: prueba de que useUrlParams (historial nativo) actualiza la pantalla y "atrás" funciona.
import { useUrlParams } from "@/lib/hooks/use-url-state"
import { Button } from "@/components/ui/button"

export function PruebaUrl() {
  const url = useUrlParams()
  return (
    <div id="prueba-url" className="flex items-center gap-2 rounded-xl border bg-white p-3 text-sm">
      <span>Valor en la URL: <b id="valor-url">{url.get("prueba", "(vacío)")}</b></span>
      <Button size="sm" variant="outline" onClick={() => url.set({ prueba: String(Number(url.get("prueba", "0")) + 1) }, "push")}>+1 (push)</Button>
      <Button size="sm" variant="outline" onClick={() => url.set({ prueba: "R" }, "replace")}>R (replace)</Button>
    </div>
  )
}
