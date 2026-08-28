/**
 * Tipos de vencimiento / gasto que SOLO puede ver (y cargar / editar) un admin:
 * sueldos y socios. Para el resto de los usuarios estos vencimientos no existen:
 * no salen en el calendario, la lista, el panel de finanzas ni en los totales.
 *
 * Isomórfico (sin imports): se usa en API routes y en componentes cliente.
 */

export const TIPOS_SOLO_ADMIN = ["sueldos", "socios"] as const

export function esAdmin(roles: string[] | null | undefined): boolean {
  return !!roles?.includes("admin")
}

export function esTipoReservado(tipo: string | null | undefined): boolean {
  return !!tipo && (TIPOS_SOLO_ADMIN as readonly string[]).includes(tipo)
}

/** ¿Este usuario puede ver / tocar un vencimiento de este tipo? */
export function puedeVerTipo(roles: string[] | null | undefined, tipo: string | null | undefined): boolean {
  return esAdmin(roles) || !esTipoReservado(tipo)
}

/** Filtra un catálogo de tipos ({ value }) según el rol. */
export function tiposVisibles<T extends { value: string }>(lista: T[], roles: string[] | null | undefined): T[] {
  return esAdmin(roles) ? lista : lista.filter((t) => !esTipoReservado(t.value))
}

/** Filtra filas de vencimientos ({ tipo }) según el rol (defensa en la UI). */
export function vencimientosVisibles<T extends { tipo?: string | null }>(filas: T[], roles: string[] | null | undefined): T[] {
  return esAdmin(roles) ? filas : filas.filter((v) => !esTipoReservado(v.tipo))
}
