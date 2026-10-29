"use client"

// P2-46: cuando la sesión venció y el middleware no llegó a renovarla a tiempo
// (Supabase tardó más de 1,2 s), o no llegó a leer los roles, el usuario cae acá
// en vez de en el login. La renovación la hace el navegador (sin ese límite) y
// vuelve a la misma pantalla. Si la sesión de verdad se terminó, recién ahí va al
// login. Si el servidor no contesta varias veces seguidas, avisa en vez de dar
// vueltas.

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
const CLAVE_VUELTAS = "gm-renovar-vueltas"
const MAX_VUELTAS = 3
const VENTANA_MS = 60_000

// Solo rutas internas: nada de "//otro-sitio" ni URLs completas
function destinoSeguro(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/auth/")) return "/"
  return next
}

// Cuántas veces se pasó por acá en el último minuto (sessionStorage puede fallar)
function contarVuelta(): number {
  try {
    const ahora = Date.now()
    const previas = (JSON.parse(sessionStorage.getItem(CLAVE_VUELTAS) || "[]") as number[]).filter((t) => ahora - t < VENTANA_MS)
    previas.push(ahora)
    sessionStorage.setItem(CLAVE_VUELTAS, JSON.stringify(previas))
    return previas.length
  } catch {
    return 1
  }
}

export default function RenovarSesionPage() {
  const [sinConexion, setSinConexion] = useState(false)

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      const next = destinoSeguro(new URLSearchParams(window.location.search).get("next"))
      if (contarVuelta() > MAX_VUELTAS) { setSinConexion(true); return }
      const sb = createClient()
      for (let intento = 0; intento < 3 && !cancelado; intento++) {
        const { data, error } = await sb.auth.getSession()
        if (data.session) { window.location.replace(next); return }
        // Sin sesión y sin error de red: se terminó de verdad
        if (!error || (error.name !== "AuthRetryableFetchError" && error.status !== 0)) {
          window.location.replace("/auth/login")
          return
        }
        await esperar(1500 * (intento + 1))
      }
      if (!cancelado) setSinConexion(true)
    })()
    return () => { cancelado = true }
  }, [])

  if (sinConexion) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center text-sm">
        <p>No hay respuesta del servidor. Tu sesión sigue abierta: probá de nuevo en un momento.</p>
        <Button
          onClick={() => {
            try { sessionStorage.removeItem(CLAVE_VUELTAS) } catch {}
            window.location.replace(destinoSeguro(new URLSearchParams(window.location.search).get("next")))
          }}
        >
          Reintentar
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Reconectando…
    </div>
  )
}
