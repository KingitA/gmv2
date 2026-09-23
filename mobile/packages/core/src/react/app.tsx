import { StrictMode, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, redirect, RouterProvider, type RouteObject } from "react-router"
import { instalarBotonAtras } from "../nav/atras"
import { crearRuntime, type ConfigApp, type Runtime } from "../runtime"
import { PantallaLogin, PantallaPendientes } from "../ui/pantallas"
import { GmProvider, useSesion } from "./contexto"

export interface OpcionesMontar {
  config: ConfigApp
  nombreApp: string
  /** Rutas del módulo. "/" es la raíz (home del módulo). */
  rutas: RouteObject[]
}

function Puerta({ nombreApp, router }: { nombreApp: string; router: ReturnType<typeof createBrowserRouter> }) {
  const { estado } = useSesion()
  if (estado === "cargando") return null
  if (estado === "anonimo") return <PantallaLogin nombreApp={nombreApp} />
  return <RouterProvider router={router} />
}

function ErrorRuta() {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Algo salió mal en esta pantalla</h1>
      <p className="mt-2 text-sm text-slate-600">Los datos cargados y las operaciones pendientes están a salvo.</p>
      <button className="mt-4 h-12 rounded-lg bg-barra px-4 font-semibold text-white" onClick={() => location.replace("/")}>
        Volver al inicio
      </button>
    </div>
  )
}

function Atras({ router }: { router: ReturnType<typeof createBrowserRouter> }) {
  useEffect(() => instalarBotonAtras(router), [router])
  return null
}

/**
 * Arranque de una app. No hace NINGÚN request antes de pintar: sesión, réplica
 * y outbox salen del dispositivo. La red se usa después, en segundo plano.
 */
export async function montarApp(opts: OpcionesMontar): Promise<Runtime> {
  const runtime = await crearRuntime(opts.config)
  const router = createBrowserRouter([
    ...opts.rutas.map((r) => ({ ...r, errorElement: r.errorElement ?? <ErrorRuta /> })),
    { path: "/pendientes", element: <PantallaPendientes />, errorElement: <ErrorRuta /> },
    // Cualquier otra URL (nunca debería pasar): a la raíz del módulo, jamás al ERP
    { path: "*", loader: () => redirect("/") },
  ])
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <GmProvider runtime={runtime}>
        <Atras router={router} />
        <Puerta nombreApp={opts.nombreApp} router={router} />
      </GmProvider>
    </StrictMode>,
  )
  return runtime
}
