export const dynamic = 'force-dynamic'
import Link from "next/link"
import { Card, CardDescription, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { DashboardAgenda } from "@/components/ai/dashboard-agenda"
import {
  Package,
  Users,
  ShoppingBag,
  Table2,
  FileText,
  ClipboardList,
  DollarSign,
  CreditCard,
  RotateCcw,
} from "lucide-react"
import { createClient } from "@supabase/supabase-js"
import { nowArgentina, todayArgentina } from "@/lib/utils"

// Función para obtener datos del resumen
async function getResumenData() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("Supabase credentials not found. Using mock data.")
    const { mockDashboardData } = await import("@/lib/mock-data")
    return mockDashboardData
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const fechaHoy = todayArgentina()
  const fecha7Dias = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

  const { data: viajes } = await supabase
    .from("viajes")
    .select(`id, fecha, estado, chofer, nombre, zona:zonas(nombre)`)
    .gte("fecha", fechaHoy)
    .lte("fecha", fecha7Dias)
    .in("estado", ["programado", "en_preparacion", "pendiente"])
    .order("fecha", { ascending: true })
    .limit(5)

  const { count: totalPedidosPendientes } = await supabase
    .from("pedidos")
    .select("id", { count: "exact", head: true })
    .in("estado", ["pendiente", "en_preparacion"])

  const { count: saldosCount } = await supabase
    .from("comprobantes_compra")
    .select("id", { count: "exact", head: true })
    .gt("saldo_pendiente", 0)
    .not("fecha_vencimiento", "is", null)

  return {
    viajes: viajes || [],
    totalPedidosPendientes: totalPedidosPendientes || 0,
    saldosCount: saldosCount || 0,
  }
}

export default async function HomePage() {
  const { viajes, totalPedidosPendientes, saldosCount } = await getResumenData()

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-neutral-900 mb-2">PANEL DE CONTROL</h1>
        <p className="text-neutral-600">Tu inventario, compras y ventas desde un solo lugar</p>
      </div>

      {/* Tarjetas principales: Proveedores, Clientes, Artículos, Tablas */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Link href="/proveedores" className="group">
          <Card className="transition-all duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-blue-500 h-full">
            <CardHeader>
              <div className="flex items-start justify-between mb-3">
                <div className="p-3 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
                  <ShoppingBag className="h-6 w-6 text-blue-600" />
                </div>
              </div>
              <CardTitle className="text-xl mb-2">PROVEEDORES</CardTitle>
              <CardDescription className="text-sm">
                Gestiona proveedores, órdenes de compra y comprobantes
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/clientes" className="group">
          <Card className="transition-all duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-green-500 h-full">
            <CardHeader>
              <div className="flex items-start justify-between mb-3">
                <div className="p-3 bg-green-50 rounded-lg group-hover:bg-green-100 transition-colors">
                  <Users className="h-6 w-6 text-green-600" />
                </div>
              </div>
              <CardTitle className="text-xl mb-2">CLIENTES</CardTitle>
              <CardDescription className="text-sm">Administra clientes, pedidos, viajes y facturación</CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/articulos" className="group">
          <Card className="transition-all duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-purple-500 h-full">
            <CardHeader>
              <div className="flex items-start justify-between mb-3">
                <div className="p-3 bg-purple-50 rounded-lg group-hover:bg-purple-100 transition-colors">
                  <Package className="h-6 w-6 text-purple-600" />
                </div>
              </div>
              <CardTitle className="text-xl mb-2">ARTÍCULOS</CardTitle>
              <CardDescription className="text-sm">Catálogo de productos, stock y precios</CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/tablas" className="group">
          <Card className="transition-all duration-200 hover:shadow-lg hover:scale-105 cursor-pointer border-l-4 border-l-orange-500 h-full">
            <CardHeader>
              <div className="flex items-start justify-between mb-3">
                <div className="p-3 bg-orange-50 rounded-lg group-hover:bg-orange-100 transition-colors">
                  <Table2 className="h-6 w-6 text-orange-600" />
                </div>
              </div>
              <CardTitle className="text-xl mb-2">TABLAS</CardTitle>
              <CardDescription className="text-sm">Viajantes, transportes, zonas y localidades</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {/* Accesos Rápidos: Órdenes de compra, Pedidos, $Precios, Revisión pagos, Revisión devoluciones */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-neutral-900 mb-4">ACCESOS RÁPIDOS</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <Link href="/ordenes-compra" className="group">
            <Card className="hover:shadow-md transition-shadow border-neutral-200">
              <CardHeader className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors">
                    <FileText className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">ÓRDENES DE COMPRA</CardTitle>
                    <CardDescription className="text-xs">Gestionar compras</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/clientes-pedidos" className="group">
            <Card className="hover:shadow-md transition-shadow border-neutral-200">
              <CardHeader className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg group-hover:bg-green-200 transition-colors">
                    <ClipboardList className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">PEDIDOS</CardTitle>
                    <CardDescription className="text-xs">Gestionar pedidos</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/articulos/consulta-precios" className="group">
            <Card className="hover:shadow-md transition-shadow border-neutral-200">
              <CardHeader className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-100 rounded-lg group-hover:bg-amber-200 transition-colors">
                    <DollarSign className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">PRECIOS</CardTitle>
                    <CardDescription className="text-xs">Consultar precios</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/revision-pagos" className="group">
            <Card className="hover:shadow-md transition-shadow border-neutral-200">
              <CardHeader className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg group-hover:bg-purple-200 transition-colors">
                    <CreditCard className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">REVISIÓN PAGOS</CardTitle>
                    <CardDescription className="text-xs">Confirmar pagos</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/revision-devoluciones" className="group">
            <Card className="hover:shadow-md transition-shadow border-neutral-200">
              <CardHeader className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-100 rounded-lg group-hover:bg-red-200 transition-colors">
                    <RotateCcw className="h-5 w-5 text-red-600" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">REVISIÓN DEVOLUCIONES</CardTitle>
                    <CardDescription className="text-xs">Confirmar devoluciones</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </div>

      {/* Agenda unificada (reemplaza los 3 cuadros de resumen) */}
      <DashboardAgenda
        initialViajes={viajes}
        totalPedidosPendientes={totalPedidosPendientes}
        saldosCount={saldosCount}
      />
    </div>
  )
}

