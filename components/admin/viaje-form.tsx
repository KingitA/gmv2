"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { createViaje } from "@/lib/actions/admin"
import { useRouter } from "next/navigation"

export function ViajeForm() {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const data = {
      viajante_id: formData.get("viajante_id") as string,
      zona: formData.get("zona") as string,
      fecha_salida: formData.get("fecha_inicio") as string,
      fecha_retorno: formData.get("fecha_fin") as string,
      descripcion: formData.get("descripcion") as string,
    }

    try {
      await createViaje(data)
      router.push("/admin/viajes")
    } catch (error) {
      console.error("Error creating viaje:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="viajante_id">ID del Viajante</Label>
          <Input id="viajante_id" name="viajante_id" required placeholder="UUID del viajante" />
          <p className="text-sm text-muted-foreground">Ingresa el ID del viajante desde la lista de usuarios</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="zona">Zona</Label>
          <Input id="zona" name="zona" required placeholder="Ej: CABA, GBA Norte, Córdoba Capital" />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="fecha_inicio">Fecha de Inicio</Label>
            <Input id="fecha_inicio" name="fecha_inicio" type="date" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fecha_fin">Fecha de Fin</Label>
            <Input id="fecha_fin" name="fecha_fin" type="date" required />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="descripcion">Descripción (Opcional)</Label>
          <Textarea id="descripcion" name="descripcion" placeholder="Detalles adicionales del viaje..." rows={4} />
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Creando..." : "Crear Viaje"}
        </Button>
      </form>
    </Card>
  )
}
