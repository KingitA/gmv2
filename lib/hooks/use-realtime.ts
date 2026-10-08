'use client'

// Actualización en vivo entre usuarios: cuando alguien cambia una de estas
// tablas (otra PC, el depósito, la app del vendedor…), se vuelve a leer la
// pantalla sola, sin refrescar. Usa Supabase Realtime: la tabla tiene que estar
// en la publicación "supabase_realtime" (migración 20261007_realtime_erp.sql).
//
// Además recarga al volver a la pestaña o al recuperar internet, por si se
// perdió algún aviso mientras la PC dormía o estaba sin conexión.

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Opciones {
  /** Espera antes de recargar, para juntar ráfagas de cambios (ms). */
  esperaMs?: number
  /** false = no suscribir (ej. mientras no hay datos cargados). */
  activo?: boolean
}

let contador = 0

export function useRealtime(tablas: string[], alCambiar: () => void, { esperaMs = 700, activo = true }: Opciones = {}) {
  const cb = useRef(alCambiar)
  cb.current = alCambiar
  const clave = tablas.join(',')

  useEffect(() => {
    if (!activo || tablas.length === 0) return
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const disparar = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => cb.current(), esperaMs)
    }

    let canal = supabase.channel(`erp-vivo-${clave}-${++contador}`)
    for (const t of tablas) {
      canal = canal.on('postgres_changes', { event: '*', schema: 'public', table: t }, disparar)
    }
    canal.subscribe()

    let ocultoDesde = 0
    const alVisibilidad = () => {
      if (document.visibilityState === 'hidden') ocultoDesde = Date.now()
      else if (ocultoDesde && Date.now() - ocultoDesde > 15_000) disparar()
    }
    document.addEventListener('visibilitychange', alVisibilidad)
    window.addEventListener('online', disparar)

    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', alVisibilidad)
      window.removeEventListener('online', disparar)
      supabase.removeChannel(canal)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, activo, esperaMs])
}
