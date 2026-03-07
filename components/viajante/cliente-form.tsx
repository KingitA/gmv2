"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { Cliente } from "@/lib/types/database"
import { createCliente, updateCliente } from "@/lib/actions/clientes"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { AlertCircle, Save } from "lucide-react"

const ZONAS = [
  "Capital Federal",
  "GBA Norte",
  "GBA Sur",
  "GBA Oeste",
  "La Plata",
  "Interior Buenos Aires",
  "Córdoba",
  "Rosario",
  "Mendoza",
  "Tucumán",
  "Otra",
]

const CONDICIONES_IVA = [
  { value: "responsable_inscripto", label: "Responsable Inscripto" },
  { value: "monotributo", label: "Monotributo" },
  { value: "exento", label: "Exento" },
  { value: "consumidor_final", label: "Consumidor Final" },
]

export function ClienteForm({ cliente }: { cliente?: Cliente }) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    razon_social: cliente?.razon_social || "",
    cuit: cliente?.cuit || "",
    direccion: cliente?.direccion || "",
    zona: cliente?.zona || "",
    telefono: cliente?.telefono || "",
    email: cliente?.email || "",
    dias_credito: cliente?.dias_credito || 30,
    limite_credito: cliente?.limite_credito || 0,
    descuento_especial: cliente?.descuento_especial || 0,
    condicion_iva: cliente?.condicion_iva || "responsable_inscripto",
    aplica_percepciones: cliente?.aplica_percepciones ?? true,
    observaciones: cliente?.observaciones || "",
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      if (cliente) {
        // Update existing cliente
        await updateCliente(cliente.id, formData)
        router.push(`/crm/viajante/clientes/${cliente.id}`)
      } else {
        // Create new cliente
        const newCliente = await createCliente(formData)
        router.push(`/crm/viajante/clientes/${newCliente.id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar el cliente")
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Basic Information */}
      <Card>
        <CardHeader>
          <CardTitle>Información Básica</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="razon_social">
              Razón Social <span className="text-destructive">*</span>
            </Label>
            <Input
              id="razon_social"
              value={formData.razon_social}
              onChange={(e) => setFormData({ ...formData, razon_social: e.target.value })}
              required
              placeholder="Ej: Distribuidora San Martín S.A."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cuit">CUIT</Label>
            <Input
              id="cuit"
              value={formData.cuit}
              onChange={(e) => setFormData({ ...formData, cuit: e.target.value })}
              placeholder="Ej: 30-12345678-9"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="direccion">
              Dirección <span className="text-destructive">*</span>
            </Label>
            <Input
              id="direccion"
              value={formData.direccion}
              onChange={(e) => setFormData({ ...formData, direccion: e.target.value })}
              required
              placeholder="Ej: Av. Corrientes 1234, CABA"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="zona">
                Zona <span className="text-destructive">*</span>
              </Label>
              <Select value={formData.zona} onValueChange={(value) => setFormData({ ...formData, zona: value })}>
                <SelectTrigger id="zona">
                  <SelectValue placeholder="Seleccionar zona" />
                </SelectTrigger>
                <SelectContent>
                  {ZONAS.map((zona) => (
                    <SelectItem key={zona} value={zona}>
                      {zona}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="telefono">Teléfono</Label>
              <Input
                id="telefono"
                type="tel"
                value={formData.telefono}
                onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                placeholder="Ej: 11-1234-5678"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="Ej: contacto@empresa.com"
            />
          </div>
        </CardContent>
      </Card>

      {/* Commercial Conditions */}
      <Card>
        <CardHeader>
          <CardTitle>Condiciones Comerciales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dias_credito">Días de Crédito</Label>
              <Input
                id="dias_credito"
                type="number"
                min="0"
                value={formData.dias_credito}
                onChange={(e) => setFormData({ ...formData, dias_credito: Number.parseInt(e.target.value) || 0 })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="limite_credito">Límite de Crédito ($)</Label>
              <Input
                id="limite_credito"
                type="number"
                min="0"
                step="0.01"
                value={formData.limite_credito}
                onChange={(e) => setFormData({ ...formData, limite_credito: Number.parseFloat(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="descuento_especial">Descuento Especial (%)</Label>
              <Input
                id="descuento_especial"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={formData.descuento_especial}
                onChange={(e) =>
                  setFormData({ ...formData, descuento_especial: Number.parseFloat(e.target.value) || 0 })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="condicion_iva">Condición IVA</Label>
              <Select
                value={formData.condicion_iva}
                onValueChange={(value) => setFormData({ ...formData, condicion_iva: value })}
              >
                <SelectTrigger id="condicion_iva">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDICIONES_IVA.map((condicion) => (
                    <SelectItem key={condicion.value} value={condicion.value}>
                      {condicion.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="aplica_percepciones"
              checked={formData.aplica_percepciones}
              onCheckedChange={(checked) => setFormData({ ...formData, aplica_percepciones: checked as boolean })}
            />
            <Label htmlFor="aplica_percepciones" className="cursor-pointer font-normal">
              Aplica percepciones de IIBB
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Observations */}
      <Card>
        <CardHeader>
          <CardTitle>Observaciones</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            id="observaciones"
            value={formData.observaciones}
            onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
            placeholder="Notas adicionales sobre el cliente..."
            rows={4}
          />
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              {cliente ? "Guardar Cambios" : "Crear Cliente"}
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
          className="flex-1"
        >
          Cancelar
        </Button>
      </div>

      {cliente && (
        <p className="text-center text-sm text-muted-foreground">
          Los cambios serán enviados para aprobación del administrador
        </p>
      )}
    </form>
  )
}
