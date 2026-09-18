import type { RouteObject } from "react-router"
import { Inicio } from "./pantallas/Inicio"
import { Cola } from "./pantallas/picking/Cola"
import { Pedido, PedidoBuscar, PedidoFaltantes, PedidoItem } from "./pantallas/picking/Pedido"
import { Recepcion, RecepcionBuscar, RecepcionDocumentos, Recepciones, RecepcionFaltantes, RecepcionItem } from "./pantallas/recepcion/Recepcion"
import { DevolucionConfirmar, Devoluciones, DevolucionesArticulo, DevolucionesBuscar } from "./pantallas/devoluciones/Devoluciones"
import { ArticuloEditor, Articulos, ArticulosLista } from "./pantallas/articulos/Articulos"

// Convención (MOBILE.md §8): cada pantalla que el operario percibe como pantalla es
// una RUTA (entrada de historial). En la web /deposito eran vistas por useState.
// Overlays (?ver=): finalizar (bonificados), salir, prov/cat (filtros), inexistente;
// ?urgente=<id> (aviso de pedido urgente). Filtros/búsqueda/tabs: ?q= ?tab= ?plegados=
// ?prov= ?cat= (replace, sin historial).
export const rutas: RouteObject[] = [
  { path: "/", element: <Inicio /> },

  { path: "/preparar", element: <Cola /> },
  { path: "/preparar/:id", element: <Pedido /> },
  { path: "/preparar/:id/buscar", element: <PedidoBuscar /> },
  { path: "/preparar/:id/item/:detId", element: <PedidoItem /> },
  { path: "/preparar/:id/faltantes", element: <PedidoFaltantes /> },

  { path: "/recibir", element: <Recepciones /> },
  { path: "/recibir/:id", element: <Recepcion /> },
  { path: "/recibir/:id/buscar", element: <RecepcionBuscar /> },
  { path: "/recibir/:id/item/:articuloId", element: <RecepcionItem /> },
  { path: "/recibir/:id/faltantes", element: <RecepcionFaltantes /> },
  { path: "/recibir/:id/documentos", element: <RecepcionDocumentos /> },

  { path: "/devoluciones", element: <Devoluciones /> },
  { path: "/devoluciones/buscar", element: <DevolucionesBuscar /> },
  { path: "/devoluciones/articulo/:artId", element: <DevolucionesArticulo /> },
  { path: "/devoluciones/:id", element: <DevolucionConfirmar /> },

  { path: "/articulos", element: <Articulos /> },
  { path: "/articulos/lista", element: <ArticulosLista /> },
  { path: "/articulos/:id", element: <ArticuloEditor /> },
]
