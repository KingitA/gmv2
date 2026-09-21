import { useMemo } from "react"
import { useNavigate } from "react-router"
import { useParamEstado } from "@gm/core"
import { ListaVirtual } from "@gm/core/ui"
import { localMatch } from "@gm/vendedor"
import { DS, type Cliente } from "../../datasets"
import { useClientes } from "../../datos/hooks"
import { Pantalla, SinDescargar, SinEnviar, formatCurrency, useAvisoEntrante, useToast, useBusqueda } from "../../ui"

// Port de app/vendedor/clientes/page.tsx y app/vendedor/pago/page.tsx.
// El filtro que la web resolvía en GET /api/vendedor/clientes se resuelve LOCAL sobre
// la cartera replicada, con el mismo criterio: q sobre nombre, razón social, CUIT,
// código, dirección y localidad; con_deuda = saldo real > 0; sin_rendir = pagos > 0.

const FILTROS = [
  { key: "todos", label: "Todos" },
  { key: "con_deuda", label: "Con deuda" },
  { key: "sin_rendir", label: "Sin rendir" },
] as const

/** = filtro de GET /api/vendedor/clientes (q + localidad + filtro). */
function filtrarClientes(clientes: Cliente[], q: string, filtro: string, localidad: string): Cliente[] {
  const texto = q.trim()
  return clientes.filter((c) => {
    if (texto && !localMatch(texto, c.nombre, c.razon_social, c.cuit, c.codigo_cliente, c.direccion, c.localidad)) return false
    if (localidad && c.localidad !== localidad) return false
    if (filtro === "con_deuda" && !(c.saldo_actual > 0)) return false
    if (filtro === "sin_rendir" && !(c.pagos_sin_rendir > 0)) return false
    return true
  })
}

const Tarjetas = ({ children }: { children: React.ReactNode }) => (
  <div className="mx-auto w-full max-w-2xl p-4">{children}</div>
)

// ─── /clientes ───────────────────────────────────────────────────────────────

export function Clientes() {
  const navigate = useNavigate()
  const { clientes, cargando, meta } = useClientes()
  const [q, setQ] = useBusqueda("q")
  const [filtro, setFiltro] = useParamEstado("filtro", "todos")
  const [localidad, setLocalidad] = useParamEstado("localidad")
  const { toast, mostrar } = useToast()
  useAvisoEntrante(mostrar)

  // Localidades disponibles para el filtro (sobre el total sin filtrar)
  const localidades = useMemo(() => [...new Set(clientes.map((c) => c.localidad).filter((l): l is string => !!l))].sort(), [clientes])
  const visibles = useMemo(() => filtrarClientes(clientes, q, filtro, localidad), [clientes, q, filtro, localidad])

  return (
    <Pantalla
      titulo="Mis Clientes"
      dataset={DS.clientes}
      derecha={
        <>
          <span className="text-sm text-slate-300">{visibles.length}</span>
          <button onClick={() => navigate("/clientes/nuevo")} className="mx-1 min-h-11 rounded-xl bg-white px-3.5 text-sm font-bold text-emerald-700">
            + NUEVO
          </button>
        </>
      }
    >
      {toast}
      <div className="space-y-2 bg-emerald-700 px-4 py-3 text-white shadow-md">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o CUIT..."
          className="w-full rounded-xl bg-white px-4 py-3 text-lg text-gray-900 outline-none"
        />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTROS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFiltro(f.key)}
              className={`min-h-11 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${filtro === f.key ? "bg-white text-emerald-700" : "bg-emerald-600 text-emerald-100"}`}
            >
              {f.label}
            </button>
          ))}
          <select
            value={localidad}
            onChange={(e) => setLocalidad(e.target.value)}
            className={`min-h-11 rounded-full px-3 py-2 text-sm font-medium outline-none ${localidad ? "bg-white text-emerald-700" : "bg-emerald-600 text-emerald-100"}`}
          >
            <option value="">Localidad: todas</option>
            {localidades.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      {cargando ? null : clientes.length === 0 && !meta?.generadoAt ? (
        <SinDescargar que="tu cartera de clientes" />
      ) : (
        <ListaVirtual
          items={visibles}
          alto={96}
          clave={(c) => c.id}
          vacio={
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
              <p className="mb-3 text-4xl">🔍</p>
              <p className="text-lg text-gray-500">No se encontraron clientes.</p>
            </div>
          }
          render={(c) => (
            <div className="mx-auto h-full w-full max-w-2xl px-4 pt-3">
              <button onClick={() => navigate(`/clientes/${c.id}`)} className="h-full w-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-bold text-gray-900">
                      <span className="truncate">{c.nombre}</span>
                      {c.sinEnviar && <SinEnviar />}
                    </p>
                    <p className="truncate text-sm text-gray-500">{[c.direccion, c.localidad, c.condicion_pago].filter(Boolean).join(" · ") || "—"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`font-bold ${c.saldo_actual > 0 ? "text-red-600" : "text-green-600"}`}>{formatCurrency(c.saldo_actual)}</p>
                    {c.pagos_sin_rendir > 0 && (
                      <span className="mt-1 inline-block rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-bold text-yellow-700">🟡 {c.pagos_sin_rendir} sin rendir</span>
                    )}
                  </div>
                </div>
              </button>
            </div>
          )}
        />
      )}
    </Pantalla>
  )
}

// ─── /pago — acceso rápido para cobrar: buscás el cliente, ves cuánto debe y entrás al cobro ─

export function Pago() {
  const navigate = useNavigate()
  const { clientes, cargando, meta } = useClientes()
  const [q, setQ] = useBusqueda("q")
  // "Solo con deuda" arranca tildado (igual que la web): ?deuda=0 lo destilda
  const [deuda, setDeuda] = useParamEstado("deuda", "1")
  const soloDeuda = deuda !== "0"

  const visibles = useMemo(() => filtrarClientes(clientes, q, soloDeuda ? "con_deuda" : "todos", ""), [clientes, q, soloDeuda])

  return (
    <Pantalla titulo="💵 Pago" dataset={DS.clientes}>
      <div className="space-y-2 bg-emerald-700 px-4 py-3 text-white shadow-md">
        <p className="text-xs text-emerald-200">Buscá el cliente y cobrale</p>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar cliente..."
          autoFocus
          className="w-full rounded-xl bg-white px-4 py-3 text-lg text-gray-900 outline-none"
        />
        <button
          onClick={() => setDeuda(soloDeuda ? "0" : "1")}
          className={`min-h-11 rounded-full border px-3.5 py-1.5 text-xs font-bold ${soloDeuda ? "border-emerald-500 bg-emerald-900/60 text-white" : "border-emerald-500/50 bg-white/10 text-emerald-100"}`}
        >
          {soloDeuda ? "☑" : "☐"} Solo con deuda
        </button>
      </div>

      {cargando ? null : clientes.length === 0 && !meta?.generadoAt ? (
        <SinDescargar que="tu cartera de clientes" />
      ) : visibles.length === 0 ? (
        <Tarjetas>
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-gray-500">
            {q ? `Sin resultados para “${q}”.` : "No hay clientes con deuda. 🎉"}
          </div>
        </Tarjetas>
      ) : (
        <ListaVirtual
          items={visibles}
          alto={92}
          clave={(c) => c.id}
          render={(c) => {
            const proy = c.saldo_proyectado ?? c.saldo_actual
            return (
              <div className="mx-auto h-full w-full max-w-2xl px-4 pt-2">
                <button
                  onClick={() => navigate(`/clientes/${c.id}/cobrar`)}
                  className="flex h-full w-full items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-bold text-gray-900">
                      <span className="truncate">{c.nombre}</span>
                      {c.sinEnviar && <SinEnviar />}
                    </p>
                    <p className="truncate text-sm text-gray-500">{c.localidad || "—"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {proy > 0.01 ? (
                      <>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-red-400">Debe</p>
                        <p className="font-bold text-red-600">{formatCurrency(proy)}</p>
                        {Math.abs(c.saldo_actual - proy) > 0.01 && <p className="text-[10px] text-gray-400">real {formatCurrency(c.saldo_actual)}</p>}
                      </>
                    ) : (
                      <p className="text-sm font-bold text-green-600">$ 0,00</p>
                    )}
                  </div>
                </button>
              </div>
            )
          }}
        />
      )}
    </Pantalla>
  )
}
