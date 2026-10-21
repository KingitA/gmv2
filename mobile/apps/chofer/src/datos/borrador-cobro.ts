// Borrador del COBRO en curso (localStorage, por viaje y cliente). En la pasada del 21/10/2026
// Android mató la app mientras la cámara estaba abierta para la foto del cheque y el chofer volvió a
// una pantalla vacía: perdió la selección, el cliente agregado y los medios cargados. El borrador se
// guarda en cada cambio y se restaura al volver a entrar; se borra al registrar o al descartar.
// localStorage (no sessionStorage): tiene que sobrevivir a que el proceso muera.
//
// Lo que NO sobrevive: las fotos todavía no subidas (viven en memoria como blob). Una fila que estaba
// "leyendo" o con foto solo local vuelve marcada para que el chofer la saque de nuevo.

import type { EstadoCuenta } from "./cuenta-cobro"
import type { ClienteBusqueda } from "../datasets"

export interface BorradorCobro<M = unknown> {
  cuenta: EstadoCuenta
  agregados: Array<{ cliente: ClienteBusqueda; estado: EstadoCuenta }>
  metodosPago: M[]
  guardadoAt: string
}

const clave = (viajeId: string, clienteId: string) => `gm.chofer.cobro.${viajeId}:${clienteId}`

/** Más de 12 h: es de otro día de trabajo, no se restaura (la cuenta del cliente ya cambió). */
const VIGENCIA_MS = 12 * 3600_000

export function leerBorradorCobro<M = unknown>(viajeId: string | undefined, clienteId: string | undefined, ahora = Date.now()): BorradorCobro<M> | null {
  if (!viajeId || !clienteId) return null
  try {
    const b = JSON.parse(localStorage.getItem(clave(viajeId, clienteId)) || "null") as BorradorCobro<M> | null
    if (!b || !b.cuenta || !Array.isArray(b.metodosPago)) return null
    if (ahora - Date.parse(b.guardadoAt) > VIGENCIA_MS) { borrarBorradorCobro(viajeId, clienteId); return null }
    return b
  } catch {
    return null
  }
}

export function guardarBorradorCobro<M>(viajeId: string, clienteId: string, b: Omit<BorradorCobro<M>, "guardadoAt">) {
  try {
    localStorage.setItem(clave(viajeId, clienteId), JSON.stringify({ ...b, guardadoAt: new Date().toISOString() }))
  } catch { /* sin espacio: se sigue sin borrador */ }
}

export function borrarBorradorCobro(viajeId: string, clienteId: string) {
  try { localStorage.removeItem(clave(viajeId, clienteId)) } catch { /* noop */ }
}

/** ¿Hay algo cargado que valga la pena guardar? (lo mismo que hace "sucia" a la pantalla) */
export function borradorVacio(b: Pick<BorradorCobro<{ tipo: string; monto: number }>, "cuenta" | "agregados" | "metodosPago">): boolean {
  const sel = Object.keys(b.cuenta.sel).length === 0 && !b.cuenta.contadoGeneral && b.cuenta.aCuenta <= 0
  return sel && b.agregados.length === 0 && b.metodosPago.every((m) => m.tipo === "efectivo" && !(m.monto > 0))
}

/**
 * Métodos de pago restaurados: una foto que no llegó al bucket se perdió con el proceso. La fila
 * queda con sus datos (banco, número, importe…) y un aviso para volver a sacar la foto.
 */
export function sanearMetodosRestaurados<M extends { tipo: string; ocr?: { estado: string; foto_url: string | null; foto_local: string | null; detalle: string | null } }>(metodos: M[]): M[] {
  return metodos.map((m) => {
    if (!m.ocr) return m
    const perdida = !m.ocr.foto_url && (m.ocr.estado === "leyendo" || !!m.ocr.foto_local)
    return {
      ...m,
      ocr: {
        ...m.ocr,
        foto_local: null,
        ...(perdida ? { estado: "fallo", detalle: "La foto se perdió al reiniciarse la app: sacala de nuevo (los datos cargados quedaron)." } : {}),
      },
    }
  })
}
