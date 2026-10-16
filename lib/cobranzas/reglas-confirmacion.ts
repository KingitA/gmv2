import { tienePermiso } from "@/lib/auth"

/**
 * ¿Un cobro cargado en la oficina se confirma en el acto o queda pendiente?
 * Regla del dueño (16/10/2026), una sola para todas las entradas de la oficina:
 *  - Solo un admin confirma (la caja es solo admin). Administrativo y mostrador
 *    cargan, y el cobro queda pendiente hasta que un admin lo confirma en /caja.
 *  - Efectivo y cheque físico entran en el acto (la plata está en la mano).
 *  - Transferencias, depósitos y echeqs quedan pendientes hasta controlar el banco.
 *  - Si la pantalla pidió dejarlo pendiente (confirmar:false), queda pendiente.
 */
export function confirmaAlCargar(args: {
  confirmar: boolean | undefined
  metodos: any[]
  roles: string[]
  /** Hay un cheque sin color (a cuenta, sin imputar): el color se elige al confirmar en Caja */
  chequeSinColor?: boolean
}): { confirmar: boolean; motivo: string | null } {
  if (args.confirmar === false) return { confirmar: false, motivo: null }
  if (!tienePermiso(args.roles, "caja")) {
    return { confirmar: false, motivo: "Quedó pendiente: lo confirma un admin en Caja." }
  }
  const requiereBanco = (args.metodos || []).some(
    (m: any) =>
      m?.tipo === "transferencia" ||
      m?.tipo === "deposito" ||
      (m?.tipo === "cheque" && (m.color_cheque === "ECHEQ" || Boolean(m.es_echeq))),
  )
  if (requiereBanco) {
    return { confirmar: false, motivo: "Quedó pendiente: las transferencias y los echeqs se confirman al ver el banco." }
  }
  if (args.chequeSinColor) {
    return { confirmar: false, motivo: "Quedó pendiente: el cheque a cuenta necesita color (blanco o negro) al confirmarlo en Caja." }
  }
  return { confirmar: true, motivo: null }
}
