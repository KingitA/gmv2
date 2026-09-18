import "@gm/core/styles.css"
import { useState } from "react"
import { esQrOUrl, lecturaError, lecturaOk, montarApp, useLector } from "@gm/core"
import { Encabezado } from "@gm/core/ui"

// SHELL de la fundación: la sesión de la app depósito porta recibir-mercadería,
// preparar-pedidos (picking), devoluciones y ajustar-stock. Esta pantalla sirve
// para validar el lector del NuStar (wedge y broadcast) en el equipo real.
function Inicio() {
  const [lecturas, setLecturas] = useState<Array<{ c: string; o: string; t: string }>>([])
  useLector({
    onCodigo: (c, origen) => {
      if (esQrOUrl(c)) lecturaError()
      else lecturaOk()
      setLecturas((l) => [{ c, o: origen, t: new Date().toLocaleTimeString("es-AR") }, ...l].slice(0, 20))
    },
  })
  return (
    <div className="min-h-dvh bg-slate-50">
      <Encabezado titulo="Depósito" atras={false} />
      <main className="space-y-3 p-4 text-sm">
        <p>App en construcción (fundación v{__APP_VERSION__}). Probá el gatillo del lector:</p>
        <ul className="divide-y rounded-xl border bg-white">
          {lecturas.length === 0 && <li className="p-3 text-slate-500">Sin lecturas todavía.</li>}
          {lecturas.map((l, i) => (
            <li key={i} className="flex gap-2 p-3 font-mono">
              <span className="flex-1 break-all">{l.c}</span>
              <span className="text-xs text-slate-500">{l.o} {l.t}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}

void montarApp({
  config: { app: "deposito", apiBase: __API_BASE__, version: __APP_VERSION__, datasets: [] },
  nombreApp: "Depósito",
  rutas: [{ path: "/", element: <Inicio /> }],
})
