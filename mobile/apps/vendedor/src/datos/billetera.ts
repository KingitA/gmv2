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

/**
 * Transferencia / depósito / echeq cobrado en la calle (#35, regla del dueño 26/10/2026):
 * NO va a la rendición ni a la mano; la oficina la confirma en /caja cuando entra al banco.
 */
export interface TransferenciaCalle {
  pago_id: string
  fecha: string
  cliente: string
  monto: number
  medio: string
  /** pendiente = a confirmar en oficina · confirmado = confirmada · sin_enviar = guardada en el equipo */
  estado: "pendiente" | "confirmado" | "sin_enviar"
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
  historial: Array<{ id: string; tipo: string; medio: string | null; monto: number; concepto: string | null; fecha: string; referencia_tipo?: string | null }>
  /** Últimos 30 días (servidor desde 26/10). Ausente = servidor viejo */
  transferencias?: TransferenciaCalle[]
}

export interface OpRetiro { monto: number; observaciones?: string | null }

const r2 = (n: number) => Math.round(n * 100) / 100

/** Retiros cargados acá que todavía no llegaron al servidor. */
export function retirosSinEnviar(ops: ItemOutbox[]): number {
  return r2(ops.filter((o) => o.tipo === "retiro.registrar" && o.estado !== "enviado" && o.estado !== "rechazado").reduce((s, o) => s + Number((o.payload as OpRetiro)?.monto || 0), 0))
}

/** Transferencias de cobros guardados en el equipo y todavía sin enviar (no suman a la mano). */
export function transferenciasSinEnviar(ops: ItemOutbox[]): TransferenciaCalle[] {
  const out: TransferenciaCalle[] = []
  for (const o of ops) {
    if (o.tipo !== "cobro.registrar" || o.estado === "enviado" || o.estado === "rechazado") continue
    const p = o.payload as { metodos?: Array<{ tipo: string; monto: number; es_echeq?: boolean }> }
    const dig = (p?.metodos || []).filter((m) => m.tipo === "transferencia" || m.tipo === "deposito" || (m.tipo === "cheque" && m.es_echeq))
    if (!dig.length) continue
    out.push({
      pago_id: `local:${o.key}`,
      fecha: o.capturadoAt,
      // etiqueta = "Cobro {cliente} $total"
      cliente: (o.etiqueta || "").replace(/^Cobro\s+/, "").replace(/\s+\$[\d.,]+$/, ""),
      monto: r2(dig.reduce((s, m) => s + Number(m.monto || 0), 0)),
      medio: [...new Set(dig.map((m) => (m.tipo === "cheque" ? "echeq" : m.tipo)))].join(" + "),
      estado: "sin_enviar",
    })
  }
  return out
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

/**
 * Efectivo que el vendedor tiene que llevar a la oficina: lo cobrado en efectivo menos lo que
 * ya retiró para sí (rendicion_crear v4 descuenta TODOS los retiros sin rendir). Proponer solo lo
 * cobrado hacía que, rindiendo sin tocar el número, el retiro quedara compensado "a su favor".
 */
export function efectivoARendir(efectivoCobrado: number, retirosSinRendir: number): number {
  return Math.max(0, r2(efectivoCobrado - Math.max(0, retirosSinRendir || 0)))
}

export function useBilletera() {
  const { fila, cargando } = useFilaBilletera<BilleteraData>("billetera")
  const ops = useNoEnviados()
  const sinEnviar = retirosSinEnviar(ops)
  const transfLocales = useMemo(() => transferenciasSinEnviar(ops), [ops])
  const data = useMemo(() => {
    const b = billeteraVisible(fila ?? null, sinEnviar)
    return b && transfLocales.length ? { ...b, transferencias: [...transfLocales, ...(b.transferencias || [])] } : b
  }, [fila, sinEnviar, transfLocales])
  return { data, cargando, retirosSinEnviar: sinEnviar }
}
