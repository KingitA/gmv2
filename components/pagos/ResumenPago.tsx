"use client"

import type { MetodoPago } from "./MetodoPagoForm"
import type { Retencion } from "./RetencionForm"

const fmtARS = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2 })

interface Props {
  totalComprobantes: number
  metodos: MetodoPago[]
  retenciones: Retencion[]
  bonificacion?: number   // monto estimado del 10% dto pago contado
}

function calcTotalMetodos(metodos: MetodoPago[]): number {
  return metodos.reduce((sum, m) => {
    if (m.tipo === "deposito") {
      return sum + (m.items || []).reduce((s, it) => s + Number(it.monto), 0)
    }
    return sum + Number(m.monto)
  }, 0)
}

export function ResumenPago({ totalComprobantes, metodos, retenciones, bonificacion = 0 }: Props) {
  const totalMetodos = calcTotalMetodos(metodos)
  const totalRet = retenciones.reduce((s, r) => s + Number(r.monto), 0)
  const totalEfectivo = totalMetodos + totalRet
  // La bonificación es una NC que el sistema genera aparte — reduce la deuda real del cliente
  const totalReal = totalComprobantes - bonificacion
  const diferencia = totalReal - totalEfectivo

  const colorDif = diferencia === 0
    ? "text-green-700 bg-green-50 border-green-200"
    : diferencia > 0
    ? "text-orange-700 bg-orange-50 border-orange-200"
    : "text-red-700 bg-red-50 border-red-200"

  return (
    <div className="border rounded-xl p-4 bg-gray-50 space-y-2 text-sm">
      <h3 className="font-semibold text-sm mb-3">Resumen</h3>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Comprobantes seleccionados:</span>
        <span className="font-mono">${fmtARS(totalComprobantes)}</span>
      </div>
      {bonificacion > 0 && (
        <div className="flex justify-between text-green-700">
          <span>Dto. pago contado (10%):</span>
          <span className="font-mono">− ${fmtARS(bonificacion)}</span>
        </div>
      )}
      {bonificacion > 0 && (
        <div className="flex justify-between font-medium border-t pt-1">
          <span className="text-muted-foreground">Neto a cobrar:</span>
          <span className="font-mono">${fmtARS(totalReal)}</span>
        </div>
      )}
      <div className="flex justify-between">
        <span className="text-muted-foreground">Total métodos de pago:</span>
        <span className="font-mono">${fmtARS(totalMetodos)}</span>
      </div>
      {totalRet > 0 && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Retenciones:</span>
          <span className="font-mono text-amber-700">+ ${fmtARS(totalRet)}</span>
        </div>
      )}
      <div className="flex justify-between font-semibold border-t pt-2 mt-2">
        <span>Total a cobrar:</span>
        <span className="font-mono">${fmtARS(totalEfectivo)}</span>
      </div>
      <div className={`flex justify-between font-semibold border rounded-lg px-3 py-2 mt-1 ${colorDif}`}>
        <span>{diferencia === 0 ? "Cuadra perfectamente" : diferencia > 0 ? "Queda pendiente:" : "Excede en:"}</span>
        <span className="font-mono">
          {diferencia === 0 ? "✓" : `$${fmtARS(Math.abs(diferencia))}`}
        </span>
      </div>
    </div>
  )
}
