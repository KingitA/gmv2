import { redirect, type RouteObject } from "react-router"
import { Inicio } from "./pantallas/Inicio"
import { Billetera } from "./pantallas/Billetera"
import { Viaje } from "./pantallas/Viaje"
import { Cliente } from "./pantallas/Cliente"
import { Cobrar } from "./pantallas/Cobrar"
import { Devolucion } from "./pantallas/Devolucion"

// Convención (MOBILE.md §8): cada pantalla que el chofer percibe como pantalla es una
// RUTA (entrada de historial). En la web /chofer eran vistas por useState + useBackTrap.
//  - Hojas/confirmaciones: ?ver=<nombre> (push) — atrás las cierra
//  - Tabs, filtros, búsqueda, acordeones: ?tab= ?q= ?abierto= (replace, sin historial)
// La jerarquía es profunda: inicio → viaje → cliente → (cobrar | devolución).
// La matriz completa del botón atrás está en MOBILE.md → "Chofer → Navegación".
export const rutas: RouteObject[] = [
  { path: "/", element: <Inicio /> },
  { path: "/billetera", element: <Billetera /> },
  { path: "/viajes", loader: () => redirect("/") },
  { path: "/viajes/:viajeId", element: <Viaje /> },
  // Padre lógico de la ficha (abierta sin historial, atrás vuelve al viaje, no al inicio)
  { path: "/viajes/:viajeId/clientes", loader: ({ params }) => redirect(`/viajes/${params.viajeId}`) },
  { path: "/viajes/:viajeId/clientes/:clienteId", element: <Cliente /> },
  { path: "/viajes/:viajeId/clientes/:clienteId/cobrar", element: <Cobrar /> },
  { path: "/viajes/:viajeId/clientes/:clienteId/devolucion", element: <Devolucion /> },
]
