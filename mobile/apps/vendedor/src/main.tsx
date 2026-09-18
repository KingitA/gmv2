import "@gm/core/styles.css"
import { montarApp, useDataset, type DefDataset } from "@gm/core"
import { Encabezado, Frescura } from "@gm/core/ui"

// SHELL de la fundación: la sesión de la app vendedor porta los módulos reales
// (pedido/nuevo, clientes, cobrar, billetera, precios...). Ya replica los
// insumos del motor de precios isomórfico (ver MOBILE.md → "Precios").
const DATASETS: DefDataset[] = [
  { nombre: "precios_listas", prioridad: 1, invalidable: true, cadaMs: 5 * 60_000 },
  { nombre: "precios_reglas", prioridad: 1, invalidable: true, cadaMs: 5 * 60_000 },
  { nombre: "precios_programados", prioridad: 1, invalidable: true, cadaMs: 5 * 60_000 },
  { nombre: "precios_articulos", prioridad: 2, invalidable: true, cadaMs: 10 * 60_000 },
  { nombre: "precios_clientes", prioridad: 3, invalidable: true, cadaMs: 10 * 60_000 },
]

function Inicio() {
  const arts = useDataset("precios_articulos")
  const clis = useDataset("precios_clientes")
  return (
    <div className="min-h-dvh bg-slate-50">
      <Encabezado titulo="Vendedor" atras={false} />
      <Frescura dataset="precios_articulos" etiqueta="Precios al" viejoTrasMin={30} />
      <main className="space-y-2 p-4 text-sm">
        <p>App en construcción (fundación v{__APP_VERSION__}).</p>
        <p>Artículos en el equipo: <b>{arts.filas.length}</b></p>
        <p>Clientes con condiciones: <b>{clis.filas.length}</b></p>
      </main>
    </div>
  )
}

void montarApp({
  config: { app: "vendedor", apiBase: __API_BASE__, version: __APP_VERSION__, datasets: DATASETS },
  nombreApp: "Vendedor",
  rutas: [{ path: "/", element: <Inicio /> }],
})
