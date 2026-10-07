// Navegación principal del ERP: pestañas de arriba (CLIENTES, PROVEEDORES, …)
// y los accesos de cada una. Reemplaza al menú lateral (components/layout/sidebar.tsx).
// Pure data — sin imports de React para poder usarlo en server y client.

export interface Acceso {
  label: string
  href: string
  roles?: string[] // si está, solo lo ven esos roles
}

export interface Seccion {
  id: "clientes" | "proveedores" | "articulos" | "finanzas" | "playroom" | "ajustes"
  label: string
  /** A dónde lleva la pestaña. Puede depender del rol (ver hrefSeccion). */
  href: string
  /** Prefijos de ruta que pertenecen a esta pestaña (el más largo gana). */
  prefijos: string[]
  accesos: Acceso[]
  roles?: string[]
}

export const SECCIONES: Seccion[] = [
  {
    id: "clientes",
    label: "Clientes",
    href: "/clientes-pedidos",
    prefijos: [
      "/clientes-pedidos", "/clientes", "/viajes", "/comprobantes-venta", "/revision-devoluciones",
      "/revision-pagos", "/pagos-clientes", "/cobranzas", "/viajantes", "/transportes", "/mostrador", "/imports",
    ],
    accesos: [
      { label: "Pedidos y viajes", href: "/clientes-pedidos" },
      { label: "Viajes", href: "/viajes" },
      { label: "Fichas de clientes", href: "/clientes" },
      { label: "Comprobantes emitidos", href: "/comprobantes-venta" },
      { label: "Revisión de devoluciones", href: "/revision-devoluciones" },
      { label: "Caja (cobranzas y rendiciones)", href: "/caja" },
      { label: "Viajantes", href: "/viajantes", roles: ["admin"] },
      { label: "Transportes", href: "/transportes" },
    ],
  },
  {
    id: "proveedores",
    label: "Proveedores",
    href: "/vencimientos",
    prefijos: ["/vencimientos", "/proveedores", "/ordenes-pago", "/ordenes-compra", "/listas-proveedores"],
    accesos: [
      { label: "Pagos y vencimientos", href: "/vencimientos" },
      { label: "Fichas de proveedores", href: "/proveedores" },
      { label: "Órdenes de pago", href: "/ordenes-pago" },
      { label: "Órdenes de compra", href: "/ordenes-compra" },
      { label: "NC esperadas", href: "/ordenes-compra/nc-pendientes" },
      { label: "Listas de precios", href: "/listas-proveedores" },
    ],
  },
  {
    id: "articulos",
    label: "Artículos",
    href: "/articulos",
    prefijos: ["/articulos"],
    accesos: [],
  },
  {
    id: "finanzas",
    label: "Finanzas",
    href: "/finanzas",
    prefijos: ["/finanzas", "/caja"],
    accesos: [
      { label: "Panel", href: "/finanzas", roles: ["admin"] },
      { label: "Caja del día", href: "/caja" },
    ],
  },
  {
    id: "playroom",
    label: "Playroom",
    href: "/playroom",
    prefijos: ["/playroom"],
    accesos: [],
  },
  {
    id: "ajustes",
    label: "Ajustes",
    href: "/tablas",
    prefijos: ["/tablas", "/admin", "/usuarios-crm"],
    accesos: [
      { label: "Todos los ajustes", href: "/tablas" },
      { label: "Usuarios", href: "/admin/usuarios", roles: ["admin"] },
    ],
  },
]

/** Accesos a las apps de calle/depósito (menú del usuario). */
export const APPS: Acceso[] = [
  { label: "App Depósito", href: "/deposito", roles: ["admin", "deposito"] },
  { label: "App Vendedores", href: "/vendedor", roles: ["admin", "vendedor"] },
]

/** Rutas que NO llevan la barra del ERP (apps propias o login). */
export const RUTAS_SIN_NAV = ["/auth", "/deposito", "/warehouse", "/chofer", "/vendedor", "/seleccionar-modulo"]

export function esRutaSinNav(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return RUTAS_SIN_NAV.some(p => pathname === p || pathname.startsWith(p + "/"))
}

export function puedeVer(item: { roles?: string[] }, roles: string[]): boolean {
  return !item.roles || item.roles.some(r => roles.includes(r))
}

/** Href de la pestaña según rol (Finanzas sin admin → Caja del día). */
export function hrefSeccion(s: Seccion, roles: string[]): string {
  if (s.id === "finanzas" && !roles.includes("admin")) return "/caja"
  return s.href
}

function coincide(pathname: string, prefijo: string) {
  return pathname === prefijo || pathname.startsWith(prefijo + "/")
}

/** Pestaña activa para una ruta (prefijo más largo). "/" → Clientes. */
export function seccionDeRuta(pathname: string | null | undefined): Seccion {
  const p = pathname || "/"
  let mejor: { s: Seccion; largo: number } | null = null
  for (const s of SECCIONES) {
    for (const pref of s.prefijos) {
      if (coincide(p, pref) && (!mejor || pref.length > mejor.largo)) mejor = { s, largo: pref.length }
    }
  }
  return mejor?.s ?? SECCIONES[0]
}

/** Acceso activo dentro de la pestaña (prefijo más largo). */
export function accesoActivo(s: Seccion, pathname: string | null | undefined): string | null {
  const p = pathname || "/"
  let mejor: string | null = null
  for (const a of s.accesos) {
    if (coincide(p, a.href) && (!mejor || a.href.length > mejor.length)) mejor = a.href
  }
  return mejor
}
