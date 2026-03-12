export const dynamic = 'force-dynamic'
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import {
  Truck,
  UserCheck,
  MapPin,
  MapPinned,
  CreditCard,
  Tags,
  PackageCheck,
} from "lucide-react"

const TABLAS = [
  {
    href: "/tablas/viajantes",
    icon: UserCheck,
    color: "blue",
    title: "Viajantes",
    desc: "Vendedores y comisiones",
  },
  {
    href: "/tablas/transportes",
    icon: Truck,
    color: "orange",
    title: "Transportes",
    desc: "Empresas de transporte",
  },
  {
    href: "/tablas/zonas",
    icon: MapPin,
    color: "green",
    title: "Zonas",
    desc: "Zonas de reparto",
  },
  {
    href: "/tablas/localidades",
    icon: MapPinned,
    color: "purple",
    title: "Localidades",
    desc: "Localidades y zonas asignadas",
  },
  {
    href: "/tablas/tipos-canal",
    icon: Tags,
    color: "teal",
    title: "Tipos de Canal",
    desc: "Mayorista, Minorista, etc.",
  },
  {
    href: "/tablas/condiciones-pago",
    icon: CreditCard,
    color: "amber",
    title: "Condiciones de Pago",
    desc: "Efectivo, Cheque 30 días, etc.",
  },
  {
    href: "/tablas/condiciones-entrega",
    icon: PackageCheck,
    color: "rose",
    title: "Condiciones de Entrega",
    desc: "Retira, Transporte, Entregamos",
  },
]

const colorMap: Record<string, { border: string; bg: string; text: string }> = {
  blue: { border: "border-l-blue-500", bg: "bg-blue-50 group-hover:bg-blue-100", text: "text-blue-600" },
  orange: { border: "border-l-orange-500", bg: "bg-orange-50 group-hover:bg-orange-100", text: "text-orange-600" },
  green: { border: "border-l-green-500", bg: "bg-green-50 group-hover:bg-green-100", text: "text-green-600" },
  purple: { border: "border-l-purple-500", bg: "bg-purple-50 group-hover:bg-purple-100", text: "text-purple-600" },
  teal: { border: "border-l-teal-500", bg: "bg-teal-50 group-hover:bg-teal-100", text: "text-teal-600" },
  amber: { border: "border-l-amber-500", bg: "bg-amber-50 group-hover:bg-amber-100", text: "text-amber-600" },
  rose: { border: "border-l-rose-500", bg: "bg-rose-50 group-hover:bg-rose-100", text: "text-rose-600" },
}

export default function TablasPage() {
  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Tablas</h1>
        <p className="text-sm text-muted-foreground">Configuración de datos maestros del sistema</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {TABLAS.map((tabla) => {
          const c = colorMap[tabla.color]
          const Icon = tabla.icon
          return (
            <Link key={tabla.href} href={tabla.href} className="group">
              <Card className={`duration-200 hover:shadow-lg cursor-pointer border-l-4 ${c.border} h-full`}>
                <CardContent className="p-5">
                  <div className="flex flex-col gap-3">
                    <div className={`p-2.5 rounded-lg transition-colors w-fit ${c.bg}`}>
                      <Icon className={`h-5 w-5 ${c.text}`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm mb-0.5">{tabla.title}</h3>
                      <p className="text-xs text-muted-foreground">{tabla.desc}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
