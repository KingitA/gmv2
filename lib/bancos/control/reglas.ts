/**
 * Control diario de bancos (Tanda 5 del plan de bancos, 27/11/2026) — reglas PURAS.
 * Pruebas: mobile/packages/core/test/bancos-control.test.ts.
 *
 *  - cargoDeConcepto(): qué hacer en el libro de fondos con un renglón clasificado por la tanda 2
 *    (impuesto, comisión, débito automático, servicio, ARCA → egreso con su categoría; reversas,
 *    bonificaciones y rendimientos → ingreso). Préstamos, operativos y "otro" no: los mira una persona.
 *  - proponerCargos(): de los renglones PENDIENTES, cuáles se registrarían (nunca uno ya tomado por
 *    otra tanda, ni la comisión de un cheque que la tanda 4 todavía puede usar).
 *  - armarControl(): por cuenta, saldo del banco contra el del sistema y qué falta explicar.
 */
import { conceptoBanco } from "../clasificacion"
import { clasificarLinea } from "../cheques/reglas"
import { fechaISO, redondear } from "../../formato"

// ─── Concepto → libro de fondos ───────────────────────────────────────────────

/** Categorías de egresos_generales (enum expense_category) que usa esta tanda. */
export type CategoriaEgreso = "OPERATIVO" | "IMPUESTOS" | "CREDITO" | "OTROS"
export type Cargo = { tipo: "egreso"; categoria: CategoriaEgreso } | { tipo: "ingreso" }

/**
 * `monto` con signo (débito −, crédito +). null = no es un cargo del banco que se registre solo.
 */
export function cargoDeConcepto(conceptoId: string | null | undefined, monto: number): Cargo | null {
  const c = conceptoBanco(conceptoId)
  if (!c || !monto) return null
  const debito = monto < 0
  switch (c.tipo) {
    case "impuesto":
      // Ley 25.413, SIRCREB, percepciones, IVA de comisiones; a favor = reversa
      return debito ? { tipo: "egreso", categoria: "IMPUESTOS" } : { tipo: "ingreso" }
    case "gasto":
      // Comisiones y cargos; a favor = bonificación / devolución de la comisión
      return debito ? { tipo: "egreso", categoria: "OPERATIVO" } : { tipo: "ingreso" }
    case "pago":
      if (!debito) return null
      return { tipo: "egreso", categoria: c.id === "pago_arca" ? "IMPUESTOS" : "OPERATIVO" }
    case "financiero":
      if (c.id === "rendimientos") return debito ? null : { tipo: "ingreso" }
      if (c.id === "intereses") return debito ? { tipo: "egreso", categoria: "CREDITO" } : { tipo: "ingreso" }
      return null // préstamos: capital + intereses, lo registra una persona
    default:
      return null // operativo (transferencias, cheques, DEBIN) y "otro"
  }
}

/** Concepto del egreso / ingreso: "Banco: SIRCREB (recaudación IIBB) · Recaudacion SIRCREB CM". */
export function textoCargo(conceptoId: string | null | undefined, m: { concepto_banco?: string | null; descripcion?: string | null }): string {
  const nombre = conceptoBanco(conceptoId)?.nombre ?? "Cargo del banco"
  const banco = ((m.concepto_banco && m.concepto_banco.trim()) || m.descripcion || "").replace(/\s+/g, " ").trim()
  const t = banco && banco.toLowerCase() !== nombre.toLowerCase() ? `Banco: ${nombre} · ${banco}` : `Banco: ${nombre}`
  return t.length > 160 ? t.slice(0, 157) + "…" : t
}

// ─── Qué se registraría ───────────────────────────────────────────────────────

export interface MovControl {
  id: string
  cuenta_bancaria_id: string
  fecha: string // AAAA-MM-DD
  monto: number
  descripcion: string | null
  concepto_banco?: string | null
  concepto_id: string | null
  estado_matching: string
  kardex_id?: string | null
}

export interface PropuestaCargo {
  movimiento_id: string
  cuenta_bancaria_id: string
  fecha: string
  monto: number
  concepto_id: string
  concepto: string
  texto: string
  cargo: Cargo
}

export interface ContextoCargos {
  /** No se registra nada anterior a este día */
  desde: string
  /** Movimientos ya tomados: vinculados por las tandas 3/4, reservados en una propuesta de cheques, ya registrados */
  tomados: ReadonlySet<string>
}

/**
 * Los renglones que se registrarían. `movs` = los PENDIENTES de la ventana (incluye las
 * acreditaciones de cheques del día, para no quitarle a la tanda 4 su comisión).
 */
export function proponerCargos(movs: readonly MovControl[], ctx: ContextoCargos): PropuestaCargo[] {
  const acreditacionesPendientes = new Set(
    movs.filter((m) => m.estado_matching === "PENDIENTE" && !ctx.tomados.has(m.id) && clasificarLinea(aLinea(m)) === "acreditacion")
      .map((m) => `${m.cuenta_bancaria_id}|${m.fecha}`),
  )
  const out: PropuestaCargo[] = []
  for (const m of movs) {
    if (m.estado_matching !== "PENDIENTE" || m.kardex_id || ctx.tomados.has(m.id)) continue
    if (m.fecha < ctx.desde) continue
    const cargo = cargoDeConcepto(m.concepto_id, Number(m.monto))
    if (!cargo) continue
    // Comisión de acreditación de un cheque: la usa la tanda 4 mientras la acreditación siga pendiente
    if (clasificarLinea(aLinea(m)) === "comision" && acreditacionesPendientes.has(`${m.cuenta_bancaria_id}|${m.fecha}`)) continue
    out.push({
      movimiento_id: m.id, cuenta_bancaria_id: m.cuenta_bancaria_id, fecha: m.fecha, monto: redondear(Number(m.monto)),
      concepto_id: m.concepto_id!, concepto: conceptoBanco(m.concepto_id)!.nombre, texto: textoCargo(m.concepto_id, m), cargo,
    })
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.cuenta_bancaria_id.localeCompare(b.cuenta_bancaria_id))
}

const aLinea = (m: MovControl) => ({
  id: m.id, cuenta_bancaria_id: m.cuenta_bancaria_id, fecha: m.fecha, monto: Number(m.monto),
  descripcion: m.descripcion, concepto_banco: m.concepto_banco ?? null,
})

// ─── Qué falta explicar ───────────────────────────────────────────────────────

export type Pendiente =
  | "cargo"                    // impuesto / gasto que se registraría (tanda 5)
  | "propuesta_transferencia"  // crédito con una transferencia informada para confirmar (tanda 3)
  | "sin_identificar"          // crédito de un cliente sin identificar (tanda 3)
  | "propuesta_cheque"         // acreditación / débito de cheque propuesto (tanda 4)
  | "rechazo"                  // rechazo de cheque para confirmar (tanda 4)
  | "sugerido"                 // conciliación sugerida contra el libro, falta confirmarla
  | "debito"                   // débito sin registrar ni conciliar
  | "credito"                  // crédito sin conciliar (no es de un cliente)

export const PENDIENTES: readonly Pendiente[] = [
  "cargo", "propuesta_transferencia", "sin_identificar", "propuesta_cheque", "rechazo", "sugerido", "debito", "credito",
]

export interface EntradaControl {
  hoy: string
  cuentas: readonly { id: string; nombre: string }[]
  saldos: readonly { cuenta_bancaria_id: string; saldo_banco: number | null; saldo_banco_al: string | null; saldo_sistema: number }[]
  /** Última vez que entró algo del banco (instante ISO): extracto, captura o saldo leído */
  actualizado: Readonly<Record<string, string | null | undefined>>
  /** PENDIENTES y SUGERIDOS de la ventana */
  movs: readonly MovControl[]
  cargos: readonly PropuestaCargo[]
  sinIdentificar: readonly { movimiento_id: string; con_propuesta: boolean }[]
  avisosCheques: readonly { movimiento_id: string; tipo: string; comision_movimiento_id?: string | null }[]
  demorados: readonly { cuenta_bancaria_id: string | null; monto: number }[]
  noAparecieron: readonly { cuenta_bancaria_id: string | null; monto: number }[]
}

export interface Cuenta { cantidad: number; monto: number }

export interface ControlCuenta {
  id: string
  nombre: string
  saldo_banco: number | null
  saldo_banco_al: string | null
  saldo_sistema: number
  /** banco − sistema (null si nunca se leyó el saldo del banco) */
  diferencia: number | null
  actualizado_at: string | null
  actualizado_hoy: boolean
  pendientes: Record<Pendiente, Cuenta>
  demorados: Cuenta
  no_aparecieron: Cuenta
  /** Cantidad de cosas sin explicar (renglones + cheques demorados + transferencias que no aparecieron) */
  total: number
  al_dia: boolean
  /** Renglones sin explicar, más nuevos primero */
  movimientos: { id: string; fecha: string; monto: number; texto: string; pendiente: Pendiente }[]
}

const vacio = (): Cuenta => ({ cantidad: 0, monto: 0 })
const sumar = (c: Cuenta, monto: number) => { c.cantidad++; c.monto = redondear(c.monto + Math.abs(monto)) }

/** Cuál es el pendiente de un renglón (el primero que lo explica). */
export function pendienteDe(
  m: MovControl,
  idx: { cargos: ReadonlySet<string>; propTransf: ReadonlySet<string>; sinId: ReadonlySet<string>; propCheque: ReadonlySet<string>; rechazos: ReadonlySet<string> },
): Pendiente | null {
  if (m.estado_matching !== "PENDIENTE" && m.estado_matching !== "SUGERIDO") return null
  if (idx.rechazos.has(m.id)) return "rechazo"
  if (idx.propCheque.has(m.id)) return "propuesta_cheque"
  if (idx.cargos.has(m.id)) return "cargo"
  if (idx.propTransf.has(m.id)) return "propuesta_transferencia"
  if (idx.sinId.has(m.id)) return "sin_identificar"
  if (m.estado_matching === "SUGERIDO") return "sugerido"
  return Number(m.monto) < 0 ? "debito" : "credito"
}

export const TOLERANCIA_DIFERENCIA = 1 // centavos de redondeo

export function armarControl(e: EntradaControl, maxMovimientos = 50): ControlCuenta[] {
  const idx = {
    cargos: new Set(e.cargos.map((c) => c.movimiento_id)),
    propTransf: new Set(e.sinIdentificar.filter((s) => s.con_propuesta).map((s) => s.movimiento_id)),
    sinId: new Set(e.sinIdentificar.filter((s) => !s.con_propuesta).map((s) => s.movimiento_id)),
    propCheque: new Set(e.avisosCheques.filter((a) => a.tipo !== "rechazo").flatMap((a) => [a.movimiento_id, a.comision_movimiento_id].filter((x): x is string => !!x))),
    rechazos: new Set(e.avisosCheques.filter((a) => a.tipo === "rechazo").map((a) => a.movimiento_id)),
  }
  const saldo = new Map(e.saldos.map((s) => [s.cuenta_bancaria_id, s]))
  return e.cuentas.map((c): ControlCuenta => {
    const s = saldo.get(c.id)
    const pendientes = Object.fromEntries(PENDIENTES.map((p) => [p, vacio()])) as Record<Pendiente, Cuenta>
    const movimientos: ControlCuenta["movimientos"] = []
    for (const m of e.movs) {
      if (m.cuenta_bancaria_id !== c.id) continue
      const p = pendienteDe(m, idx)
      if (!p) continue
      sumar(pendientes[p], Number(m.monto))
      movimientos.push({ id: m.id, fecha: m.fecha, monto: redondear(Number(m.monto)), texto: (m.concepto_banco || m.descripcion || "").trim(), pendiente: p })
    }
    const demorados = vacio()
    for (const d of e.demorados) if (d.cuenta_bancaria_id === c.id) sumar(demorados, d.monto)
    const no_aparecieron = vacio()
    for (const t of e.noAparecieron) if (t.cuenta_bancaria_id === c.id) sumar(no_aparecieron, t.monto)

    const saldoBanco = s?.saldo_banco ?? null
    const saldoSistema = redondear(s?.saldo_sistema ?? 0)
    const diferencia = saldoBanco == null ? null : redondear(saldoBanco - saldoSistema)
    const actualizado = e.actualizado[c.id] ?? null
    const actualizado_hoy = !!actualizado && fechaISO(actualizado) === e.hoy
    const total = PENDIENTES.reduce((t, p) => t + pendientes[p].cantidad, 0) + demorados.cantidad + no_aparecieron.cantidad
    movimientos.sort((a, b) => b.fecha.localeCompare(a.fecha))
    return {
      id: c.id, nombre: c.nombre, saldo_banco: saldoBanco, saldo_banco_al: s?.saldo_banco_al ?? null, saldo_sistema: saldoSistema,
      diferencia, actualizado_at: actualizado, actualizado_hoy, pendientes, demorados, no_aparecieron, total,
      al_dia: actualizado_hoy && total === 0 && diferencia != null && Math.abs(diferencia) < TOLERANCIA_DIFERENCIA,
      movimientos: movimientos.slice(0, maxMovimientos),
    }
  })
}

/** Totales de todas las cuentas (para el vigía y el encabezado). */
export function totalesControl(cs: readonly ControlCuenta[]) {
  const pendientes = Object.fromEntries(PENDIENTES.map((p) => [p, vacio()])) as Record<Pendiente, Cuenta>
  const demorados = vacio(), no_aparecieron = vacio()
  for (const c of cs) {
    for (const p of PENDIENTES) { pendientes[p].cantidad += c.pendientes[p].cantidad; pendientes[p].monto = redondear(pendientes[p].monto + c.pendientes[p].monto) }
    demorados.cantidad += c.demorados.cantidad; demorados.monto = redondear(demorados.monto + c.demorados.monto)
    no_aparecieron.cantidad += c.no_aparecieron.cantidad; no_aparecieron.monto = redondear(no_aparecieron.monto + c.no_aparecieron.monto)
  }
  return {
    pendientes, demorados, no_aparecieron,
    sin_actualizar: cs.filter((c) => !c.actualizado_hoy).map((c) => c.nombre),
    con_diferencia: cs.filter((c) => c.diferencia != null && Math.abs(c.diferencia) >= TOLERANCIA_DIFERENCIA).map((c) => ({ nombre: c.nombre, diferencia: c.diferencia! })),
    total: cs.reduce((t, c) => t + c.total, 0),
  }
}
