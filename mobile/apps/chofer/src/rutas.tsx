import type { RouteObject } from "react-router"
import { Inicio } from "./pantallas/Inicio"
import { Viaje } from "./pantallas/Viaje"
import { ClienteViaje } from "./pantallas/ClienteViaje"

// Convención (MOBILE.md → "Navegación"): cada pantalla es una ruta.
//   /                               home del módulo (atrás ⇒ minimiza)
//   /viajes/:viajeId                listado de clientes del viaje
//   /viajes/:viajeId/pedidos/:id    detalle (sheets vía ?ver=)
export const rutas: RouteObject[] = [
  { path: "/", element: <Inicio /> },
  { path: "/viajes/:viajeId", element: <Viaje /> },
  { path: "/viajes/:viajeId/pedidos/:pedidoId", element: <ClienteViaje /> },
]
