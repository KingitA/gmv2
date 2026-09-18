import { Link, useParams } from "react-router"
import { useFila, useParamEstado } from "@gm/core"
import { Encabezado, Frescura, ListaVirtual, moneda } from "@gm/core/ui"
import type { PedidoViaje, ViajeDetalle } from "../datasets"

const ESTADO: Record<PedidoViaje["estado_entrega"], string> = {
  pendiente: "bg-amber-100 text-amber-900",
  cobrado: "bg-emerald-100 text-emerald-900",
  devolucion_registrada: "bg-sky-100 text-sky-900",
}

export function Viaje() {
  const { viajeId } = useParams()
  const { fila: v, cargando } = useFila<ViajeDetalle>("chofer_viajes", viajeId)
  // Filtro: estado en la URL SIN entrada de historial (convención: filtros = replace)
  const [filtro, setFiltro] = useParamEstado("filtro", "todos")

  const pedidos = (v?.pedidos || []).filter((p) => filtro === "todos" || p.estado_entrega === filtro)

  return (
    <div className="flex h-dvh flex-col bg-slate-50">
      <Encabezado titulo={v?.viaje?.nombre || "Viaje"} />
      <Frescura dataset="chofer_viajes" />
      {!cargando && !v ? (
        <p className="p-6 text-center text-slate-500">Este viaje no está descargado en el equipo.</p>
      ) : (
        <>
          <div className="flex gap-2 p-2">
            {[
              ["todos", "Todos"],
              ["pendiente", "Pendientes"],
              ["cobrado", "Cobrados"],
            ].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setFiltro(k)}
                className={`h-10 flex-1 rounded-lg text-sm font-semibold ${filtro === k ? "bg-slate-900 text-white" : "border bg-white"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <ListaVirtual
            items={pedidos}
            alto={76}
            clave={(p) => p.id}
            vacio="No hay pedidos en este filtro."
            render={(p) => (
              <Link to={`/viajes/${viajeId}/pedidos/${p.id}`} className="flex h-[76px] items-center gap-3 border-b bg-white px-3 active:bg-slate-100">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.cliente_nombre}</div>
                  <div className="truncate text-xs text-slate-500">
                    {p.direccion} {p.localidad ? `· ${p.localidad}` : ""}
                  </div>
                  <div className="text-xs text-slate-600">
                    Pedido {p.numero} · {moneda(p.total_a_cobrar)}
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO[p.estado_entrega]}`}>{p.estado_entrega.replace("_", " ")}</span>
              </Link>
            )}
          />
        </>
      )}
    </div>
  )
}
