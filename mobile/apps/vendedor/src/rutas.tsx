import { redirect, type RouteObject } from "react-router"
import { Inicio } from "./pantallas/Inicio"
import { Billetera, ComisionPedido } from "./pantallas/Billetera"
import { Rendiciones } from "./pantallas/Rendiciones"
import { Estadisticas } from "./pantallas/Estadisticas"
import { Precios } from "./pantallas/Precios"
import { Pedidos } from "./pantallas/pedidos/Pedidos"
import { PedidoDetalle } from "./pantallas/pedidos/PedidoDetalle"
import { MarcoPedido } from "./pantallas/pedido-nuevo/Marco"
import { Carrito, CatalogoHome, CategoriaArticulos, ElegirCliente, PedidoListo, Proveedores, RubroCategorias, VistaFiltro, VistaProveedor } from "./pantallas/pedido-nuevo/Pantallas"
import { Clientes, Pago } from "./pantallas/clientes/Clientes"
import { ClienteNuevo } from "./pantallas/clientes/ClienteNuevo"
import { ClienteFicha } from "./pantallas/clientes/ClienteFicha"
import { Cobrar } from "./pantallas/clientes/Cobrar"
import { Devolucion, DevolucionCatalogo } from "./pantallas/clientes/Devolucion"
import { ViajeDetalle, ViajeNuevo, Viajes } from "./pantallas/viajes/Viajes"

// Convención (MOBILE.md §8): cada pantalla que el vendedor percibe como pantalla es una
// RUTA (entrada de historial). En la web /vendedor muchas eran vistas por useState +
// useBackTrap dentro de una sola ruta.
//  - Hojas/modales/confirmaciones: ?ver=<nombre> (push) · foto grande: ?foto=<url> (push)
//  - Tabs, filtros, búsqueda, orden, acordeones: ?tab= ?q= ?estado= … (replace, sin historial)
// La matriz completa del botón atrás está en MOBILE.md → "Vendedor → Navegación".
export const rutas: RouteObject[] = [
  { path: "/", element: <Inicio /> },

  { path: "/billetera", element: <Billetera /> },
  // Padre lógico del detalle de comisión (si se abre sin historial, atrás NO va al inicio)
  { path: "/billetera/comisiones", loader: () => redirect("/billetera?tab=comisiones") },
  { path: "/billetera/comisiones/:pedidoId", element: <ComisionPedido /> },
  { path: "/rendiciones", element: <Rendiciones /> },
  { path: "/estadisticas", element: <Estadisticas /> },
  { path: "/precios", element: <Precios /> },
  { path: "/pago", element: <Pago /> },

  { path: "/pedidos", element: <Pedidos /> },
  { path: "/pedidos/:id", element: <PedidoDetalle /> },

  // Pedido en curso: el marco sostiene borrador + motor de precios + hojas comunes
  { path: "/pedido", loader: () => redirect("/pedido/nuevo") },
  { path: "/pedido/nuevo", element: <ElegirCliente /> },
  {
    path: "/pedido/nuevo/:clienteId",
    element: <MarcoPedido />,
    children: [
      { index: true, element: <CatalogoHome /> },
      { path: "proveedores", element: <Proveedores /> },
      { path: "proveedor", loader: ({ params }) => redirect(`/pedido/nuevo/${params.clienteId}/proveedores`) },
      { path: "proveedor/:provId", element: <VistaProveedor /> },
      { path: "filtro", loader: ({ params }) => redirect(`/pedido/nuevo/${params.clienteId}`) },
      { path: "filtro/:tipo", element: <VistaFiltro /> },
      { path: "rubro", loader: ({ params }) => redirect(`/pedido/nuevo/${params.clienteId}`) },
      { path: "rubro/:rubroId", element: <RubroCategorias /> },
      { path: "rubro/:rubroId/:catId", element: <CategoriaArticulos /> },
      { path: "carrito", element: <Carrito /> },
      { path: "listo", element: <PedidoListo /> },
    ],
  },

  { path: "/clientes", element: <Clientes /> },
  { path: "/clientes/nuevo", element: <ClienteNuevo /> },
  { path: "/clientes/:id", element: <ClienteFicha /> },
  { path: "/clientes/:id/cobrar", element: <Cobrar /> },
  { path: "/clientes/:id/devolucion", element: <Devolucion /> },
  { path: "/clientes/:id/devolucion/catalogo", element: <DevolucionCatalogo /> },

  { path: "/viajes", element: <Viajes /> },
  { path: "/viajes/nuevo", element: <ViajeNuevo /> },
  { path: "/viajes/:id", element: <ViajeDetalle /> },
]
