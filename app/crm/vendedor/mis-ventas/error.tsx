"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertCircle } from "lucide-react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[v0] MisVentas Error Boundary:", error)
  }, [error])

  return (
    <div className="container mx-auto py-8 px-4">
      <Card className="border-destructive">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <div>
              <CardTitle>Error en Mis Ventas</CardTitle>
              <CardDescription>Ocurrió un error al cargar tus ventas</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{error.message || "Error desconocido"}</p>
          <div className="flex gap-2">
            <Button onClick={() => reset()}>Reintentar</Button>
            <Button variant="outline" onClick={() => (window.location.href = "/vendedor")}>
              Volver al Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
