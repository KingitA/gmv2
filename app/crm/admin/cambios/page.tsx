import { getPendingChanges } from "@/lib/actions/admin"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ApproveChangeButton } from "@/components/admin/approve-change-button"
import { RejectChangeButton } from "@/components/admin/reject-change-button"
import { AlertCircle } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function AdminCambiosPage() {
  const changes = await getPendingChanges()

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Solicitudes de Cambio</h1>
              <p className="text-muted-foreground mt-1">Aprobar o rechazar cambios propuestos por viajantes</p>
            </div>
            <Button asChild variant="outline">
              <Link href="/admin">Volver al Panel</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {changes.length === 0 ? (
          <Card className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No hay solicitudes pendientes</h3>
            <p className="text-muted-foreground">Todas las solicitudes de cambio han sido procesadas</p>
          </Card>
        ) : (
          <div className="space-y-6">
            {changes.map((change: any) => (
              <Card key={change.id} className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-lg">{change.clientes?.razon_social}</h3>
                    <p className="text-sm text-muted-foreground mt-1">Solicitado por: {change.usuarios?.nombre}</p>
                    <p className="text-sm text-muted-foreground">
                      Fecha: {new Date(change.created_at).toLocaleDateString("es-AR", { timeZone: 'America/Argentina/Buenos_Aires' })}
                    </p>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                    Pendiente
                  </span>
                </div>

                <div className="bg-muted/50 rounded-lg p-4 mb-4">
                  <h4 className="font-medium mb-3">Cambios Propuestos:</h4>
                  <div className="space-y-2">
                    {Object.entries(change.cambios_propuestos).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}:</span>
                        <span className="font-medium">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3">
                  <ApproveChangeButton solicitudId={change.id} />
                  <RejectChangeButton solicitudId={change.id} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
