// Pure utility — no imports, works in Edge Runtime, browser, and Node.js

export const ERP_ROLES = ['admin', 'administrativo'] as const
export const ALL_ROLES = ['admin', 'administrativo', 'deposito', 'chofer', 'viajante'] as const

/**
 * Devuelve la URL de inicio según los roles del usuario.
 * Null si el usuario no tiene módulo activo aún (ej: viajante-only).
 */
export function getHomeForRoles(roles: string[]): string | null {
  if (roles.includes('admin') || roles.includes('administrativo')) return '/'
  if (roles.includes('deposito') && roles.includes('chofer')) return '/seleccionar-modulo'
  if (roles.includes('deposito')) return '/deposito'
  if (roles.includes('chofer')) return '/chofer'
  return null
}

/**
 * Reglas de acceso por prefijo de ruta.
 * Orden importa: más específico primero.
 * Si ninguna regla aplica → ruta accesible para admin + administrativo.
 */
export const ROUTE_RULES: [string, string[]][] = [
  ['/admin',                ['admin']],
  ['/deposito',             ['admin', 'deposito']],
  ['/chofer',               ['admin', 'chofer']],
  ['/seleccionar-modulo',   ['admin', 'deposito', 'chofer']],
  ['/viajantes',            ['admin']],
  ['/finanzas',             ['admin']],
  ['/tablas/listas-precio', ['admin']],
]

/**
 * Chequea si los roles del usuario tienen acceso a un pathname.
 * Rutas públicas y API se manejan antes de llamar a esto.
 */
export function canAccess(pathname: string, roles: string[]): boolean {
  if (roles.includes('admin')) return true

  for (const [prefix, allowed] of ROUTE_RULES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/') || pathname.startsWith(prefix + '?')) {
      return allowed.some(r => roles.includes(r))
    }
  }

  // Resto del ERP: admin + administrativo
  return roles.includes('administrativo')
}
