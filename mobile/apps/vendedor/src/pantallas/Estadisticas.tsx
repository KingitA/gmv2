import { useNavigate } from "react-router"
import { DS } from "../datasets"
import { useFilaBilletera, useRefrescarAlEntrar } from "../datos/hooks"
import { formatCurrency, Pantalla, SinDescargar } from "../ui"

// Estadísticas del viajante (= app/vendedor/estadisticas/page.tsx).
// Dato: fila "estadisticas" de vendedor_billetera (= GET /api/vendedor/estadisticas).

interface Stats {
  ventas_por_mes: { mes: string; total: number; pedidos: number }[]
  top_clientes: { cliente_id: string; nombre: string; total: number; pedidos: number }[]
  comisiones: { pendientes: number; generadas_mes: number }
  cartera: { deuda_total: number; clientes_con_deuda: number }
}

const MES_LABEL = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

function labelMes(mes: string) {
  const m = mes.split("-")[1] ?? ""
  return MES_LABEL[parseInt(m) - 1] || mes
}

export function Estadisticas() {
  const navigate = useNavigate()
  useRefrescarAlEntrar(DS.billetera)
  const { fila: data, cargando } = useFilaBilletera<Stats>("estadisticas")

  if (cargando || !data) {
    return (
      <Pantalla titulo="Mis Estadísticas" dataset={DS.billetera}>
        {cargando ? null : <SinDescargar que="las estadísticas" />}
      </Pantalla>
    )
  }

  const meses = data.ventas_por_mes || []
  const mesActual = meses[meses.length - 1]
  const mesAnterior = meses[meses.length - 2]
  const maxMes = Math.max(...meses.map((m) => m.total), 1)
  const variacion = mesActual && mesAnterior && mesAnterior.total > 0 ? ((mesActual.total - mesAnterior.total) / mesAnterior.total) * 100 : null

  return (
    <Pantalla titulo="Mis Estadísticas" dataset={DS.billetera}>
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        {/* Mes actual */}
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">Ventas este mes</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(mesActual?.total || 0)}</p>
            {variacion !== null && (
              <p className={`text-sm font-medium ${variacion >= 0 ? "text-green-600" : "text-red-600"}`}>
                {variacion >= 0 ? "▲" : "▼"} {Math.abs(variacion).toFixed(0)}% vs mes anterior
              </p>
            )}
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">Pedidos este mes</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{mesActual?.pedidos || 0}</p>
          </div>
          <button onClick={() => navigate("/billetera?tab=comisiones")} className="rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm active:bg-gray-50">
            <p className="text-sm text-gray-500">Comisiones del mes</p>
            <p className="mt-1 text-xl font-bold text-emerald-700">{formatCurrency(data.comisiones?.generadas_mes)}</p>
            <p className="text-xs text-gray-400">Pend. retiro: {formatCurrency(data.comisiones?.pendientes)}</p>
            <p className="mt-1 text-xs font-bold text-emerald-700">Ver detalle →</p>
          </button>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">Deuda de cartera</p>
            <p className="mt-1 text-xl font-bold text-red-600">{formatCurrency(data.cartera?.deuda_total)}</p>
            <p className="text-xs text-gray-400">{data.cartera?.clientes_con_deuda ?? 0} clientes con deuda</p>
          </div>
        </section>

        {/* Ventas últimos 6 meses */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-bold text-gray-700">Ventas últimos 6 meses</h2>
          <div className="space-y-2">
            {meses.map((m) => (
              <div key={m.mes} className="flex items-center gap-3">
                <span className="w-8 shrink-0 text-sm font-medium text-gray-500">{labelMes(m.mes)}</span>
                <div className="h-6 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(2, (m.total / maxMes) * 100)}%` }} />
                </div>
                <span className="w-28 shrink-0 text-right text-sm font-bold text-gray-900">{formatCurrency(m.total)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Top clientes */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-bold text-gray-700">Top clientes (90 días)</h2>
          {data.top_clientes?.length ? (
            <div className="space-y-2">
              {data.top_clientes.map((c, i) => (
                <button
                  key={c.cliente_id}
                  onClick={() => navigate(`/clientes/${c.cliente_id}`)}
                  className="flex min-h-11 w-full items-center justify-between border-b border-gray-100 py-2 text-left last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-5 shrink-0 font-bold text-gray-400">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900">{c.nombre}</p>
                      <p className="text-xs text-gray-400">{c.pedidos} pedidos</p>
                    </div>
                  </div>
                  <p className="ml-2 shrink-0 font-bold text-gray-900">{formatCurrency(c.total)}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-gray-500">Sin ventas en los últimos 90 días.</p>
          )}
        </section>
      </div>
    </Pantalla>
  )
}
