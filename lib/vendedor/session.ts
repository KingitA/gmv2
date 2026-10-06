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
  puede_cambiar_lista?: boolean | null
  /** Lista que impone este viajante a sus clientes (null = no impone) */
  lista_precio_id?: string | null
}

interface VendedorSuccess {
  user: User
  roles: string[]
  vendedores: VendedorRecord[]
  vendedorIds: string[]
  /** Permiso para cambiar la lista de precios de sus clientes (flag en
   *  vendedores.puede_cambiar_lista; alcanza con que un viajante del usuario
   *  lo tenga). Admin siempre puede. */
  puedeCambiarLista: boolean
  /** Listas que el vendedor puede usar desde la app: Neco + la que impone cada
   *  uno de sus viajantes (ej. Freije: Neco + Viajante). Regla del dueño
   *  (06/10/2026): aunque el usuario sea admin, cualquier otra lista se asigna
   *  desde el ERP, no desde la app. */
  listasPermitidas: string[]
  error: null
}

interface VendedorFailure {
  user: null
  roles: null
  vendedores: null
  vendedorIds: null
  puedeCambiarLista: false
  listasPermitidas: null
  error: NextResponse
}

export type VendedorSessionResult = VendedorSuccess | VendedorFailure

function fail(status: number, message: string): VendedorFailure {
  return {
    user: null,
    roles: null,
    vendedores: null,
    vendedorIds: null,
    puedeCambiarLista: false,
    listasPermitidas: null,
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
    .select("id, nombre, comision_limpieza_bazar, comision_perfumeria_0, comision_perfumeria_plus, puede_cambiar_lista, lista_precio_id")
    .eq("usuario_id", auth.user.id)
    .eq("activo", true)

  if (error) return fail(500, "Error al resolver el vendedor de la sesión.")
  if (!vendedores || vendedores.length === 0) {
    return fail(
      403,
      "Tu usuario no está vinculado a ningún vendedor. Pedile a administración que te vincule."
    )
  }

  const { data: neco } = await supabase.from("listas_precio").select("id").eq("codigo", "neco").maybeSingle()

  return {
    user: auth.user,
    roles,
    vendedores,
    vendedorIds: vendedores.map((v) => v.id),
    puedeCambiarLista: roles.includes("admin") || vendedores.some((v) => v.puede_cambiar_lista === true),
    listasPermitidas: listasPermitidasDe(neco?.id ?? null, vendedores),
    error: null,
  }
}

/** Neco + las listas que imponen los viajantes del usuario (sin repetir). */
export function listasPermitidasDe(necoId: string | null, vendedores: Array<{ lista_precio_id?: string | null }>): string[] {
  return [...new Set([necoId, ...vendedores.map((v) => v.lista_precio_id)].filter((x): x is string => !!x))]
}

/** Lista que impone un viajante (vendedores.lista_precio_id), o null. */
export function listaDelViajante(session: VendedorSuccess, vendedorId: string | null | undefined): string | null {
  return session.vendedores.find((v) => v.id === vendedorId)?.lista_precio_id || null
}
