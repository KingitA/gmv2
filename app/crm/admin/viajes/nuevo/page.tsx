export const dynamic = 'force-dynamic'
import { ViajeForm } from "@/components/admin/viaje-form"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function NuevoViajePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Nuevo Viaje</h1>
              <p className="text-muted-foreground mt-1">Crear y asignar un nuevo viaje a un viajante</p>
            </div>
            <Button asChild variant="outline">
              <Link href="/admin/viajes">Cancelar</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <ViajeForm />
      </div>
    </div>
  )
}

