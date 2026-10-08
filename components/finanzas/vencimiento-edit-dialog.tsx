"use client"

// "Editar pago" de /finanzas: ahora usa el formulario único de vencimientos
// (components/finanzas/form-vencimiento.tsx), con Eliminar, Recalcular desde
// ficha, Generar OP y Marcar pagado como antes.
import { FormVencimientoDialog, type VencimientoForm } from "@/components/finanzas/form-vencimiento"

export type VencimientoEditable = VencimientoForm

export function VencimientoEditDialog({
  venc,
  open,
  onOpenChange,
  onSaved,
}: {
  venc: VencimientoEditable | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved?: () => void
}) {
  if (!venc) return null
  return <FormVencimientoDialog open={open} onOpenChange={onOpenChange} venc={venc} onSaved={onSaved} />
}
