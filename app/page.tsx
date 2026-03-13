export const dynamic = 'force-dynamic'

import Link from "next/link"
import { createAdminClient } from "@/lib/supabase/admin"
import { todayArgentina, formatDateAR } from "@/lib/utils"
import { DashboardFeed } from "@/components/layout/dashboard-feed"

async function getDashboardData() {
  const supabase = createAdminClient()
  const fechaHoy = todayArgentina()

  // Pedidos pendientes
  const { count: pedidosPendientes } = await supabase
    .from("pedidos")
    .select("id", { count: "exact", head: true })
    .in("estado", ["pendiente", "en_preparacion"])

  // Pedidos hoy
  const { count: pedidosHoy } = await supabase
    .from("pedidos")
    .select("id", { count: "exact", head: true })
    .eq("fecha", fechaHoy)

  // Viajes próximos (7 días)
  const fecha7Dias = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  const { data: viajes } = await supabase
    .from("viajes")
    .select("id, nombre, fecha, estado, chofer")
    .gte("fecha", fechaHoy)
    .lte("fecha", fecha7Dias)
    .in("estado", ["programado", "en_preparacion", "pendiente"])
    .order("fecha", { ascending: true })
    .limit(5)

  // Facturas vencidas (proveedores)
  const { count: facturasVencidas } = await supabase
    .from("comprobantes_compra")
    .select("id", { count: "exact", head: true })
    .gt("saldo_pendiente", 0)
    .lt("fecha_vencimiento", fechaHoy)

  // Imports pendientes de revisión (IA)
  const { count: importsPendientes } = await supabase
    .from("imports")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")

  return {
    pedidosPendientes: pedidosPendientes || 0,
    pedidosHoy: pedidosHoy || 0,
    viajes: viajes || [],
    facturasVencidas: facturasVencidas || 0,
    importsPendientes: importsPendientes || 0,
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
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-7">
        <KpiCard
          label="Pedidos Pendientes"
          value={data.pedidosPendientes}
          color="blue"
          href="/clientes-pedidos"
        />
        <KpiCard
          label="Pedidos Hoy"
          value={data.pedidosHoy}
          color="green"
        />
        <KpiCard
          label="Viajes Próximos"
          value={data.viajes.length}
          sub={data.viajes[0] ? `Próximo: ${formatDateAR(data.viajes[0].fecha)}` : undefined}
          color="amber"
          href="/viajes"
        />
        <KpiCard
          label="Fact. Vencidas"
          value={data.facturasVencidas}
          color="red"
        />
        <KpiCard
          label="Por Revisar (IA)"
          value={data.importsPendientes}
          color="purple"
          href="/clientes-pedidos/import-review"
        />
      </div>

      {/* Content Grid: Feed + Right Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
        {/* Activity Feed */}
        <DashboardFeed />

        {/* Right Panel */}
        <div className="flex flex-col gap-5">
          {/* Quick Actions */}
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-100 font-bold text-sm">
              Acciones Rápidas
            </div>
            <QuickAction
              icon="📦"
              label="Crear Pedido"
              desc="Manual o desde archivo"
              href="/clientes-pedidos"
              bg="bg-blue-50"
            />
            <QuickAction
              icon="🚚"
              label="Crear Viaje"
              desc="Asignar pedidos a viaje"
              href="/viajes/nuevo"
              bg="bg-green-50"
            />
            <QuickAction
              icon="📄"
              label="Importar Lista Precios"
              desc="Excel de proveedor"
              href="/articulos/precios"
              bg="bg-amber-50"
            />
            <QuickAction
              icon="👥"
              label="Importar Clientes"
              desc="Alta masiva desde Excel"
              href="/clientes"
              bg="bg-purple-50"
            />
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
              data.viajes.map((viaje) => (
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

// ── KPI Card ──
function KpiCard({ label, value, sub, color, href }: {
  label: string
  value: number
  sub?: string
  color: 'blue' | 'green' | 'amber' | 'red' | 'purple'
  href?: string
}) {
  const colorMap = {
    blue: 'border-t-blue-500',
    green: 'border-t-emerald-500',
    amber: 'border-t-amber-500',
    red: 'border-t-red-500',
    purple: 'border-t-violet-500',
  }

  const content = (
    <div className={`bg-white border border-neutral-200 border-t-[3px] ${colorMap[color]} rounded-xl px-5 py-4 ${href ? 'hover:shadow-md transition-shadow cursor-pointer' : ''}`}>
      <div className="text-[11px] text-neutral-500 font-medium uppercase tracking-wide">{label}</div>
      <div className="text-[28px] font-bold mt-1 leading-none">{value}</div>
      {sub && <div className="text-xs text-neutral-400 mt-1">{sub}</div>}
    </div>
  )

  if (href) return <Link href={href}>{content}</Link>
  return content
}

// ── Quick Action ──
function QuickAction({ icon, label, desc, href, bg }: {
  icon: string
  label: string
  desc: string
  href: string
  bg: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors"
    >
      <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center text-base`}>
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
