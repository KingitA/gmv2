import { getAllViajes } from "@/lib/actions/admin"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Plus, Calendar, MapPin } from "lucide-react"

// Force dynamic rendering to avoid build-time prerendering
export const dynamic = "force-dynamic"

export default async function AdminViajesPage() {
  const viajes = await getAllViajes()

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Gestión de Viajes</h1>
              <p className="text-muted-foreground mt-1">Crear y asignar viajes a los viajantes</p>
            </div>
            <div className="flex gap-3">
              <Button asChild variant="outline">
                <Link href="/admin">Volver al Panel</Link>
              </Button>
              <Button asChild>
                <Link href="/admin/viajes/nuevo">
                  <Plus className="h-4 w-4 mr-2" />
                  Nuevo Viaje
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {viajes.map((viaje: any) => (
            <Card key={viaje.id} className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-lg">{viaje.usuarios?.nombre}</h3>
                  <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    {viaje.zona}
                  </div>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${viaje.estado === "programado"
                      ? "bg-blue-100 text-blue-700"
                      : viaje.estado === "en_curso"
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-700"
                    }`}
                >
                  {viaje.estado}
                </span>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {new Date(viaje.fecha_inicio).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })} -{" "}
                    {new Date(viaje.fecha_fin).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                  </span>
                </div>
                {viaje.descripcion && <p className="text-sm text-muted-foreground">{viaje.descripcion}</p>}
              </div>

              <Button variant="outline" size="sm" className="w-full bg-transparent" asChild>
                <Link href={`/admin/viajes/${viaje.id}`}>Ver Detalles</Link>
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
