import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth, getUserRoles } from "@/lib/auth"
import type { User } from "@supabase/supabase-js"

// ─── Helper de sesión para API routes del módulo Vendedor ─────────────
// El backend SIEMPRE resuelve el vendedor desde la sesión (contrato
// docs/CONTRATO-API-VIAJANTES.md): la UI nunca envía vendedor_id.
// Un usuario puede tener VARIOS registros en `vendedores` (vendedores.usuario_id);
// sus clientes son la unión de los clientes de todos sus registros.

export interface VendedorRecord {
  id: string
  nombre: string
  comision_limpieza_bazar: number | null
  comision_perfumeria_0: number | null
  comision_perfumeria_plus: number | null
}

interface VendedorSuccess {
  user: User
  roles: string[]
  vendedores: VendedorRecord[]
  vendedorIds: string[]
  error: null
}

interface VendedorFailure {
  user: null
  roles: null
  vendedores: null
  vendedorIds: null
  error: NextResponse
}

export type VendedorSessionResult = VendedorSuccess | VendedorFailure

function fail(status: number, message: string): VendedorFailure {
  return {
    user: null,
    roles: null,
    vendedores: null,
    vendedorIds: null,
    error: NextResponse.json({ error: message }, { status }),
  }
}

/**
 * Verifica sesión + rol vendedor (o admin) y resuelve los registros de
 * `vendedores` vinculados al usuario autenticado.
 *
 * Uso en API routes:
 *   const session = await requireVendedor()
 *   if (session.error) return session.error
 *   // session.vendedorIds → filtrar clientes/pedidos/comisiones
 */
export async function requireVendedor(): Promise<VendedorSessionResult> {
  const auth = await requireAuth()
  if (auth.error) return fail(401, "No autorizado. Iniciá sesión para continuar.")

  const roles = await getUserRoles(auth.user.id)
  if (!roles.includes("vendedor") && !roles.includes("admin")) {
    return fail(403, "Acceso solo para vendedores.")
  }

  const supabase = await createClient()
  const { data: vendedores, error } = await supabase
    .from("vendedores")
    .select("id, nombre, comision_limpieza_bazar, comision_perfumeria_0, comision_perfumeria_plus")
    .eq("usuario_id", auth.user.id)
    .eq("activo", true)

  if (error) return fail(500, "Error al resolver el vendedor de la sesión.")
  if (!vendedores || vendedores.length === 0) {
    return fail(
      403,
      "Tu usuario no está vinculado a ningún vendedor. Pedile a administración que te vincule."
    )
  }

  return {
    user: auth.user,
    roles,
    vendedores,
    vendedorIds: vendedores.map((v) => v.id),
    error: null,
  }
}
