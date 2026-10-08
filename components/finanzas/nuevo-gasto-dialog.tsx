"use client"

// "Nuevo gasto o servicio" de /finanzas: ahora usa el formulario único de
// vencimientos (components/finanzas/form-vencimiento.tsx), arrancando como
// servicio que se repite todos los meses, como antes.
import { FormVencimientoDialog } from "@/components/finanzas/form-vencimiento"

export function NuevoGastoDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved?: () => void
}) {
  return <FormVencimientoDialog open={open} onOpenChange={onOpenChange} onSaved={onSaved} tipoInicial="servicios" recurrenciaInicial="mensual" />
}
