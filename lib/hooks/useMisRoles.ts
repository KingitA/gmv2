"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

/**
 * Roles del usuario logueado (tabla usuarios_roles → roles.nombre), para
 * decisiones de UI (ocultar opciones). La regla de verdad vive en el servidor:
 * las API routes vuelven a chequear el rol.
 */
export function useMisRoles() {
  const [roles, setRoles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let vivo = true
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }: { data: { user: { id: string } | null } }) => {
      if (!user) { if (vivo) { setRoles([]); setLoading(false) } ; return }
      const { data } = await supabase.from("usuarios_roles").select("roles(nombre)").eq("usuario_id", user.id)
      if (!vivo) return
      setRoles((data || []).map((r: any) => r.roles?.nombre).filter(Boolean))
      setLoading(false)
    }).catch(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [])

  return { roles, esAdmin: roles.includes("admin"), loading }
}
