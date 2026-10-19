// Billetera del vendedor en DOS cajitas (regla del dueño 19/10/2026, cuentas corrientes etapa 3):
//  - "Plata de la empresa en tu mano": efectivo cobrado − retiros sin rendir (`balance`) y los
//    cheques como CANTIDAD de papeles (nunca como monto).
//  - "Tu cuenta": la cuenta personal del vendedor (comisiones ganadas, retiros, diferencias de
//    rendición, mercadería). `cuenta_personal: null` = la oficina todavía no la vinculó.
// Un solo lugar para el inicio y la pantalla Billetera. Los retiros hechos acá y todavía sin
// enviar ya se ven descontados (igual que hará el servidor al recibirlos).

import { useMemo } from "react"
import { useNoEnviados, type ItemOutbox } from "@gm/core"
import { useFilaBilletera } from "./hooks"

export interface CuentaPersonal {
  cliente_id: string
  saldo_real: number
  saldo_proyectado: number
  /** Lo que tiene a favor en su cuenta (negativo = debe) */
  a_favor: number
  comisiones_ganadas: number
  retiros: number
}

export interface BilleteraData {
  /** Plata de la EMPRESA en la mano: efectivo cobrado − retiros sin rendir */
  balance: number
  /** balance + cuenta (compatibilidad con APK viejas: NO se muestra como número único) */
  saldo?: number
  desglose: { efectivo: number; cheques: number; transferencias: number }
  cheques_cantidad?: number
  pagos_sin_rendir: number
  en_viaje: { total: number; cantidad: number }
  deuda_rendiciones?: number
  retiros_sin_rendir?: number
  cuenta_personal?: CuentaPersonal | null
  faltante_declarado?: number
  comisiones_pendientes: unknown[]
  total_pendiente_comisiones: number
  historial: Array<{ id: string; tipo: string; medio: string | null; monto: number; concepto: string | null; fecha: string }>
}

export interface OpRetiro { monto: number; observaciones?: string | null }

const r2 = (n: number) => Math.round(n * 100) / 100

/** Retiros cargados acá que todavía no llegaron al servidor. */
export function retirosSinEnviar(ops: ItemOutbox[]): number {
  return r2(ops.filter((o) => o.tipo === "retiro.registrar" && o.estado !== "enviado" && o.estado !== "rechazado").reduce((s, o) => s + Number((o.payload as OpRetiro)?.monto || 0), 0))
}

/** Aplica los retiros sin enviar a la fila de la billetera (puro: lo prueban los tests). */
export function billeteraVisible(b: BilleteraData | null, sinEnviar: number): BilleteraData | null {
  if (!b || !(sinEnviar > 0)) return b
  return {
    ...b,
    balance: r2(b.balance - sinEnviar),
    retiros_sin_rendir: r2((b.retiros_sin_rendir || 0) + sinEnviar),
    cuenta_personal: b.cuenta_personal
      ? { ...b.cuenta_personal, a_favor: r2(b.cuenta_personal.a_favor - sinEnviar), retiros: r2(b.cuenta_personal.retiros + sinEnviar) }
      : b.cuenta_personal,
  }
}

export function useBilletera() {
  const { fila, cargando } = useFilaBilletera<BilleteraData>("billetera")
  const ops = useNoEnviados()
  const sinEnviar = retirosSinEnviar(ops)
  const data = useMemo(() => billeteraVisible(fila ?? null, sinEnviar), [fila, sinEnviar])
  return { data, cargando, retirosSinEnviar: sinEnviar }
}
