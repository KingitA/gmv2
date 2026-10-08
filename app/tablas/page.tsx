export const dynamic = 'force-dynamic'
// AJUSTES: todas las tablas y configuraciones de la empresa en un solo lugar,
// agrupadas por tema (rediseño 2026-10). Cada tarjeta lleva a su pantalla de
// siempre (no se movió ni duplicó ninguna). Lo que es solo de admin se oculta
// para los demás (la ruta también lo protege, ver lib/role-utils.ts).
import Link from "next/link"
import { headers } from "next/headers"
import {
  Banknote, Boxes, Building2, CalendarClock, CarFront, ChevronRight, CreditCard, FileSpreadsheet, Globe2, Grid2x2,
  Layers, MapPin, MapPinned, PackageCheck, ShieldCheck, Tags, Truck, UserCheck, type LucideIcon,
} from "lucide-react"

type Item = { href: string; icon: LucideIcon; title: string; desc: string; soloAdmin?: boolean }
type Grupo = { titulo: string; desc: string; items: Item[] }

const GRUPOS: Grupo[] = [
  {
    titulo: "Personas",
    desc: "Quién usa el sistema y las apps",
    items: [
      { href: "/admin/usuarios", icon: ShieldCheck, title: "Usuarios y roles", desc: "Accesos al ERP y a las apps de depósito, chofer y vendedor", soloAdmin: true },
      { href: "/tablas/viajantes", icon: UserCheck, title: "Vendedores y viajantes", desc: "Datos, listas que pueden usar y comisiones" },
      { href: "/usuarios-crm", icon: Globe2, title: "Usuarios del portal", desc: "Clientes y vendedores del portal web: altas y aprobaciones" },
    ],
  },
  {
    titulo: "Logística",
    desc: "Repartos, zonas y cómo se entrega",
    items: [
      { href: "/tablas/zonas", icon: MapPin, title: "Zonas", desc: "Zonas de reparto que usan los viajes" },
      { href: "/tablas/localidades", icon: MapPinned, title: "Localidades", desc: "Cada localidad con su zona" },
      { href: "/tablas/vehiculos", icon: CarFront, title: "Vehículos", desc: "Camiones y utilitarios propios" },
      { href: "/tablas/transportes", icon: Truck, title: "Transportes", desc: "Empresas de transporte y sus destinos" },
      { href: "/tablas/condiciones-entrega", icon: PackageCheck, title: "Condiciones de entrega", desc: "Retira, transporte, entregamos nosotros" },
    ],
  },
  {
    titulo: "Comercial",
    desc: "Listas, condiciones y canales de venta",
    items: [
      { href: "/tablas/listas-precio", icon: Banknote, title: "Listas de precio", desc: "Bahía, Neco, Viajante y recargos por segmento", soloAdmin: true },
      { href: "/tablas/precios-programados", icon: CalendarClock, title: "Precios programados", desc: "Cambios de precio con fecha de vigencia" },
      { href: "/tablas/condiciones-pago", icon: CreditCard, title: "Condiciones de pago", desc: "Efectivo, cheque a 30 días, etc." },
      { href: "/tablas/tipos-canal", icon: Tags, title: "Tipos de canal", desc: "Mayorista, minorista, etc." },
    ],
  },
  {
    titulo: "Artículos",
    desc: "Catálogos que usa la ficha de artículo",
    items: [
      { href: "/tablas/marcas", icon: Layers, title: "Marcas", desc: "Marcas de artículos: código y descripción" },
      { href: "/tablas/categorias", icon: Grid2x2, title: "Rubros y categorías", desc: "Rubros, categorías y subcategorías" },
      { href: "/tablas/tipos-bulto", icon: Boxes, title: "Tipos de bulto", desc: "Unidad, bulto, caja, pack…" },
      { href: "/tablas/tipos-fraccion", icon: Boxes, title: "Tipos de fracción", desc: "Pack, blíster, docena…" },
    ],
  },
  {
    titulo: "Fiscal y bancos",
    desc: "Cuentas propias e impuestos",
    items: [
      { href: "/tablas/bancos", icon: Building2, title: "Bancos y cuentas", desc: "Cuentas propias y CBU/CVU para reconocer pagos" },
      { href: "/tablas/padron-iibb", icon: FileSpreadsheet, title: "Padrón de IIBB", desc: "Alícuotas de percepción por CUIT" },
    ],
  },
]

export default async function AjustesPage() {
  const h = await headers()
  const roles = h.get("x-user-roles")?.split(",").filter(Boolean) ?? []
  const esAdmin = roles.includes("admin")

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-azul-900 sm:text-3xl">Ajustes</h1>
        <p className="text-sm text-neutro-500">Tablas, usuarios y configuración de la empresa</p>
      </div>

      {GRUPOS.map((g) => {
        const items = g.items.filter((i) => esAdmin || !i.soloAdmin)
        if (!items.length) return null
        return (
          <section key={g.titulo}>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-lg font-bold text-azul-900">{g.titulo}</h2>
              <p className="text-[13px] text-neutro-500">{g.desc}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((i) => {
                const Icono = i.icon
                return (
                  <Link key={i.href} href={i.href}
                    className="group flex items-center gap-3 rounded-xl border bg-white px-4 py-3 transition-colors hover:border-azul-200 hover:bg-azul-50/40">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-azul-50 text-azul-600">
                      <Icono className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-azul-900">{i.title}</span>
                      <span className="block truncate text-[13px] text-neutro-500">{i.desc}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-neutro-300 group-hover:text-azul-600" />
                  </Link>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
