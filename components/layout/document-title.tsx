"use client"

/**
 * Ajusta el título de la pestaña del navegador según la pantalla actual
 * (ej. "Artículos — GM Distribuidora"), en vez de un título fijo.
 * Se monta una sola vez en el layout raíz. Como casi todas las páginas son
 * client components (no pueden exportar metadata), lo resolvemos por la ruta.
 */

import { useEffect } from "react"
import { usePathname } from "next/navigation"

const SUFIJO = "GM Distribuidora"

// Prefijo de ruta → nombre de la pantalla. El match toma el prefijo más largo.
const RUTAS: Record<string, string> = {
  "/": "Inicio",
  "/articulos": "Artículos",
  "/clientes-pedidos": "Pedidos",
  "/clientes": "Clientes",
  "/caja": "Caja del Día",
  "/proveedores": "Proveedores",
  "/finanzas": "Finanzas",
  "/deposito": "Depósito",
  "/warehouse": "Depósito",
  "/recepcion": "Recepción",
  "/viajes": "Viajes",
  "/viajantes": "Viajantes",
  "/comprobantes-venta": "Comprobantes de Venta",
  "/comprobantes": "Comprobantes",
  "/cuenta-corriente": "Cuenta Corriente",
  "/ordenes-compra": "Órdenes de Compra",
  "/ordenes-pago": "Órdenes de Pago",
  "/pagos-clientes": "Pagos de Clientes",
  "/cobranzas": "Cobranzas",
  "/vencimientos": "Vencimientos",
  "/devoluciones": "Devoluciones",
  "/revision-devoluciones": "Revisión de Devoluciones",
  "/revision-pagos": "Revisión de Pagos",
  "/validacion": "Validación",
  "/imports": "Importaciones",
  "/listas-proveedores": "Listas de Proveedores",
  "/tablas": "Tablas",
  "/playroom": "Reportes",
  "/chofer": "Chofer",
  "/vendedor": "Vendedor",
  "/viajante": "Viajante",
  "/admin": "Administración",
  "/usuarios-crm": "Usuarios",
  "/seleccionar-modulo": "Seleccionar Módulo",
  "/auth": "Ingresar",
}

function tituloPara(pathname: string): string {
  if (pathname === "/") return RUTAS["/"]
  // Prefijo más largo que matchee (ruta exacta o subruta)
  let mejor = ""
  for (const prefijo of Object.keys(RUTAS)) {
    if (prefijo === "/") continue
    if ((pathname === prefijo || pathname.startsWith(prefijo + "/")) && prefijo.length > mejor.length) {
      mejor = prefijo
    }
  }
  return mejor ? RUTAS[mejor] : SUFIJO
}

export function DocumentTitle() {
  const pathname = usePathname()
  useEffect(() => {
    const label = tituloPara(pathname || "/")
    document.title = label === SUFIJO ? SUFIJO : `${label} — ${SUFIJO}`
  }, [pathname])
  return null
}
