export const dynamic = 'force-dynamic'

import Link from "next/link"
import { createAdminClient } from "@/lib/supabase/admin"
import { todayArgentina, formatDateAR } from "@/lib/utils"

const ESTADOS_EN_PROCESO = [
  'en_preparacion',
  'impreso',
  'pendiente_facturacion',
  'listo_para_retirar',
  'listo_para_enviar',
  'en_viaje',
] as const

const ESTADOS_ACTIVOS = ['pendiente', ...ESTADOS_EN_PROCESO] as const

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  en_preparacion: 'En preparación',
  impreso: 'Impreso',
  pendiente_facturacion: 'Para facturar',
  listo_para_retirar: 'Listo p/retirar',
  listo_para_enviar: 'Listo p/enviar',
  en_viaje: 'En viaje',
}

const ESTADO_CLASSES: Record<string, string> = {
  pendiente: 'bg-amber-100 text-amber-800',
  en_preparacion: 'bg-blue-100 text-blue-800',
  impreso: 'bg-neutral-100 text-neutral-700',
  pendiente_facturacion: 'bg-pink-100 text-pink-800',
  listo_para_retirar: 'bg-cyan-100 text-cyan-800',
  listo_para_enviar: 'bg-teal-100 text-teal-800',
  en_viaje: 'bg-violet-100 text-violet-800',
}

async function getDashboardData() {
  const supabase = createAdminClient()
  const fechaHoy = todayArgentina()

  const [
    { count: pedidosPendientes },
    { count: pedidosEnProceso },
    { data: clientesActivosRaw },
    { data: pedidosRecientes },
    { data: viajes },
    { data: estadosRaw },
  ] = await Promise.all([
    // KPI: pendientes
    supabase
      .from("pedidos")
      .select("id", { count: "exact", head: true })
      .eq("estado", "pendiente"),

    // KPI: en proceso
    supabase
      .from("pedidos")
      .select("id", { count: "exact", head: true })
      .in("estado", [...ESTADOS_EN_PROCESO]),

    // KPI: clientes activos (distinct) últimos 30 días
    supabase
      .from("pedidos")
      .select("cliente_id")
      .gte("fecha", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
      .not("estado", "eq", "eliminado"),

    // Últimos pedidos activos
    supabase
      .from("pedidos")
      .select("id, numero_pedido, fecha, estado, total, clientes(nombre_fantasia, razon_social)")
      .in("estado", [...ESTADOS_ACTIVOS])
      .order("fecha", { ascending: false })
      .limit(15),

    // Viajes próximos
    supabase
      .from("viajes")
      .select("id, nombre, fecha, estado, chofer")
      .gte("fecha", fechaHoy)
      .lte("fecha", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
      .in("estado", ["programado", "en_preparacion", "pendiente"])
      .order("fecha", { ascending: true })
      .limit(5),

    // Conteo por estado (para distribución)
    supabase
      .from("pedidos")
      .select("estado")
      .in("estado", [...ESTADOS_ACTIVOS]),
  ])

  const clientesActivos = new Set((clientesActivosRaw || []).map(p => p.cliente_id)).size

  const countByEstado: Record<string, number> = {}
  for (const p of estadosRaw || []) {
    countByEstado[p.estado] = (countByEstado[p.estado] || 0) + 1
  }
  const totalActivos = Object.values(countByEstado).reduce((a, b) => a + b, 0)

  return {
    pedidosPendientes: pedidosPendientes || 0,
    pedidosEnProceso: pedidosEnProceso || 0,
    clientesActivos,
    pedidosRecientes: pedidosRecientes || [],
    viajes: viajes || [],
    countByEstado,
    totalActivos,
  }
}

export default async function HomePage() {
  const data = await getDashboardData()

  const hoy = new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  })

  return (
    <div className="p-6 lg:p-8 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Panel de Control</h1>
          <p className="text-sm text-neutral-500 capitalize">{hoy}</p>
        </div>
        <Link
          href="/clientes-pedidos"
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          + Nuevo Pedido
        </Link>
      </div>

      {/* KPI Cards — 3 métricas operativas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-7">
        <Link href="/clientes-pedidos">
          <div className="bg-white border border-neutral-200 border-t-[3px] border-t-amber-500 rounded-xl px-5 py-4 hover:shadow-md transition-shadow cursor-pointer">
            <div className="text-[11px] text-neutral-500 font-semibold uppercase tracking-wide">Pendientes</div>
            <div className="text-[36px] font-bold mt-1 leading-none text-amber-600">{data.pedidosPendientes}</div>
            <div className="text-xs text-neutral-400 mt-1.5">Sin iniciar preparación</div>
          </div>
        </Link>
        <Link href="/clientes-pedidos">
          <div className="bg-white border border-neutral-200 border-t-[3px] border-t-blue-500 rounded-xl px-5 py-4 hover:shadow-md transition-shadow cursor-pointer">
            <div className="text-[11px] text-neutral-500 font-semibold uppercase tracking-wide">En Proceso</div>
            <div className="text-[36px] font-bold mt-1 leading-none text-blue-600">{data.pedidosEnProceso}</div>
            <div className="text-xs text-neutral-400 mt-1.5">Preparación · Facturación · Viaje</div>
          </div>
        </Link>
        <div className="bg-white border border-neutral-200 border-t-[3px] border-t-emerald-500 rounded-xl px-5 py-4">
          <div className="text-[11px] text-neutral-500 font-semibold uppercase tracking-wide">Clientes Activos</div>
          <div className="text-[36px] font-bold mt-1 leading-none text-emerald-600">{data.clientesActivos}</div>
          <div className="text-xs text-neutral-400 mt-1.5">Clientes únicos — últimos 30 días</div>
        </div>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">

        {/* Left: Recent orders table */}
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-neutral-100 flex items-center justify-between">
            <span className="font-bold text-sm">Pedidos activos</span>
            <Link href="/clientes-pedidos" className="text-xs text-blue-600 hover:underline font-medium">
              Ver todos →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-100">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">#</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Cliente</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Estado</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Total</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {data.pedidosRecientes.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-10 text-neutral-400 text-sm">
                      No hay pedidos activos
                    </td>
                  </tr>
                ) : (
                  data.pedidosRecientes.map((p: any) => {
                    const cliente = p.clientes
                    const nombreCliente = cliente?.nombre_fantasia || cliente?.razon_social || '—'
                    const estadoClass = ESTADO_CLASSES[p.estado] || 'bg-neutral-100 text-neutral-600'
                    const estadoLabel = ESTADO_LABEL[p.estado] || p.estado
                    const num = p.numero_pedido ? `P-${p.numero_pedido}` : p.id.slice(0, 8)
                    return (
                      <tr key={p.id} className="border-b border-neutral-50 hover:bg-neutral-50/60 transition-colors">
                        <td className="px-4 py-3 font-bold text-neutral-400 text-xs">{num}</td>
                        <td className="px-4 py-3 font-semibold text-neutral-800">{nombreCliente}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${estadoClass}`}>
                            {estadoLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-bold">
                          {p.total != null
                            ? `$${Number(p.total).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
                            : '—'
                          }
                        </td>
                        <td className="px-4 py-3 text-right text-neutral-400 text-xs">
                          {p.fecha ? formatDateAR(p.fecha) : '—'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Panel */}
        <div className="flex flex-col gap-5">

          {/* Status distribution */}
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-100 flex items-center justify-between">
              <span className="font-bold text-sm">Distribución por estado</span>
              <span className="text-xs text-neutral-400">{data.totalActivos} activos</span>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              {ESTADOS_ACTIVOS.filter(e => (data.countByEstado[e] || 0) > 0).map(estado => {
                const count = data.countByEstado[estado] || 0
                const pct = data.totalActivos > 0 ? Math.round((count / data.totalActivos) * 100) : 0
                const barColor = {
                  pendiente: 'bg-amber-400',
                  en_preparacion: 'bg-blue-400',
                  impreso: 'bg-neutral-400',
                  pendiente_facturacion: 'bg-pink-400',
                  listo_para_retirar: 'bg-cyan-400',
                  listo_para_enviar: 'bg-teal-400',
                  en_viaje: 'bg-violet-400',
                }[estado] || 'bg-neutral-300'
                return (
                  <Link key={estado} href="/clientes-pedidos" className="group">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[12px] font-medium text-neutral-700 group-hover:text-blue-600 transition-colors">
                        {ESTADO_LABEL[estado]}
                      </span>
                      <span className="text-[12px] font-bold text-neutral-800">{count}</span>
                    </div>
                    <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                )
              })}
              {data.totalActivos === 0 && (
                <p className="text-sm text-neutral-400 text-center py-2">Sin pedidos activos</p>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-100 font-bold text-sm">
              Acciones Rápidas
            </div>
            <QuickAction icon="📦" label="Nuevo Pedido" desc="Carga manual" href="/clientes-pedidos" bg="bg-blue-50" />
            <QuickAction icon="🚚" label="Nuevo Viaje" desc="Asignar pedidos" href="/viajes/nuevo" bg="bg-green-50" />
            <QuickAction icon="🧾" label="Comprobantes" desc="Facturas emitidas" href="/comprobantes-venta" bg="bg-amber-50" />
            <QuickAction icon="👥" label="Clientes" desc="Gestión de clientes" href="/clientes" bg="bg-purple-50" />
          </div>

          {/* Upcoming Trips */}
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-100 flex items-center justify-between">
              <span className="font-bold text-sm">Próximos Viajes</span>
              <Link href="/viajes" className="text-xs text-blue-600 hover:underline font-medium">
                Ver todos →
              </Link>
            </div>
            {data.viajes.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-neutral-400">
                No hay viajes programados
              </div>
            ) : (
              data.viajes.map((viaje: any) => (
                <Link
                  key={viaje.id}
                  href={`/viajes/${viaje.id}`}
                  className="block px-5 py-3 border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors"
                >
                  <div className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">
                    {formatDateAR(viaje.fecha)}
                  </div>
                  <div className="text-[13px] font-semibold mt-0.5">{viaje.nombre}</div>
                  {viaje.chofer && (
                    <div className="text-xs text-neutral-500">Chofer: {viaje.chofer}</div>
                  )}
                </Link>
              ))
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Quick Action ──
function QuickAction({ icon, label, desc, href, bg }: {
  icon: string; label: string; desc: string; href: string; bg: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors"
    >
      <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center text-base flex-shrink-0`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold">{label}</div>
        <div className="text-[11.5px] text-neutral-500">{desc}</div>
      </div>
      <span className="text-neutral-300 text-sm">→</span>
    </Link>
  )
}
