// Control diario de bancos (Tanda 5 del plan de bancos, 27/11/2026): qué cargo del banco va al
// libro de fondos y con qué categoría, qué se propone registrar y qué falta explicar por cuenta.
// Datos inventados (nunca datos reales).
import { describe, expect, it } from "vitest"
import { CONCEPTOS_BANCO } from "../../../../lib/bancos/clasificacion"
import {
  armarControl, cargoDeConcepto, pendienteDe, proponerCargos, textoCargo, totalesControl,
  type EntradaControl, type MovControl,
} from "../../../../lib/bancos/control/reglas"

const CRED = "cta-credicoop"
const NAC = "cta-nacion"
let n = 0
const mov = (o: Partial<MovControl>): MovControl => ({
  id: `m${++n}`, cuenta_bancaria_id: CRED, fecha: "2026-11-26", monto: -100, descripcion: null,
  concepto_banco: null, concepto_id: null, estado_matching: "PENDIENTE", kardex_id: null, ...o,
})

describe("cargoDeConcepto", () => {
  it.each([
    ["ley25413_debitos", -1200, { tipo: "egreso", categoria: "IMPUESTOS" }],
    ["ley25413_creditos", -600, { tipo: "egreso", categoria: "IMPUESTOS" }],
    ["sircreb", -2400, { tipo: "egreso", categoria: "IMPUESTOS" }],
    ["percepcion_iibb", -3911.21, { tipo: "egreso", categoria: "IMPUESTOS" }],
    ["percepcion_iva", -2346.72, { tipo: "egreso", categoria: "IMPUESTOS" }],
    ["iva_comisiones", -126, { tipo: "egreso", categoria: "IMPUESTOS" }],
    ["comision_transferencias", -1200, { tipo: "egreso", categoria: "OPERATIVO" }],
    ["comision_cheques", -1000, { tipo: "egreso", categoria: "OPERATIVO" }],
    ["comision_mantenimiento", -74000, { tipo: "egreso", categoria: "OPERATIVO" }],
    ["honorarios_informes", -500, { tipo: "egreso", categoria: "OPERATIVO" }],
    ["comision_otros", -300, { tipo: "egreso", categoria: "OPERATIVO" }],
    ["debito_automatico", -15000, { tipo: "egreso", categoria: "OPERATIVO" }],
    ["pago_servicios", -8000, { tipo: "egreso", categoria: "OPERATIVO" }],
    ["pago_arca", -250000, { tipo: "egreso", categoria: "IMPUESTOS" }],
    ["intereses", -900, { tipo: "egreso", categoria: "CREDITO" }],
    // reversas, bonificaciones y rendimientos → ingreso
    ["ley25413_reverso", 1200, { tipo: "ingreso" }],
    ["sircreb_reverso", 2400, { tipo: "ingreso" }],
    ["percepcion_reverso", 50, { tipo: "ingreso" }],
    ["comision_otros", 300, { tipo: "ingreso" }],
    ["rendimientos", 1532.4, { tipo: "ingreso" }],
    ["intereses", 80, { tipo: "ingreso" }],
  ])("%s (%d)", (id, monto, esperado) => {
    expect(cargoDeConcepto(id, monto)).toEqual(esperado)
  })

  it.each([
    ["movimiento", -50000], ["movimiento", 50000], ["otro", -10], ["prestamo", -100000], ["prestamo", 100000],
    ["pago_arca", 500], ["debito_automatico", 300], ["rendimientos", -5], [null, -100], ["inexistente", -100], ["sircreb", 0],
  ])("%s (%d) no se registra solo", (id, monto) => {
    expect(cargoDeConcepto(id as string | null, monto as number)).toBeNull()
  })

  it("todo concepto del catálogo tiene una decisión (sin excepciones)", () => {
    for (const c of CONCEPTOS_BANCO) for (const m of [-100, 100]) expect(() => cargoDeConcepto(c.id, m)).not.toThrow()
  })

  it("texto del egreso: nombre del concepto y lo que dice el banco", () => {
    expect(textoCargo("sircreb", { concepto_banco: "Recaudacion SIRCREB CM - Condicion E" })).toBe("Banco: SIRCREB (recaudación IIBB) · Recaudacion SIRCREB CM - Condicion E")
    expect(textoCargo("sircreb", { concepto_banco: null, descripcion: null })).toBe("Banco: SIRCREB (recaudación IIBB)")
    expect(textoCargo("comision_otros", { descripcion: "x".repeat(300) }).length).toBeLessThanOrEqual(160)
  })
})

describe("proponerCargos", () => {
  const ctx = { desde: "2026-11-01", tomados: new Set<string>() }

  it("propone impuestos y gastos pendientes; no lo operativo ni lo ya registrado", () => {
    const movs = [
      mov({ id: "imp", concepto_id: "ley25413_debitos", monto: -1200 }),
      mov({ id: "rev", concepto_id: "sircreb_reverso", monto: 2400 }),
      mov({ id: "tr", concepto_id: "movimiento", monto: 50000 }),
      mov({ id: "conc", concepto_id: "sircreb", monto: -100, estado_matching: "CONCILIADO" }),
      mov({ id: "reg", concepto_id: "sircreb", monto: -100, estado_matching: "REGISTRADO_EGRESO" }),
      mov({ id: "sug", concepto_id: "sircreb", monto: -100, estado_matching: "SUGERIDO" }),
      mov({ id: "kar", concepto_id: "sircreb", monto: -100, kardex_id: "k1" }),
      mov({ id: "sin", concepto_id: null, monto: -100 }),
    ]
    const p = proponerCargos(movs, ctx)
    expect(p.map((x) => x.movimiento_id).sort()).toEqual(["imp", "rev"])
    expect(p.find((x) => x.movimiento_id === "rev")!.cargo).toEqual({ tipo: "ingreso" })
  })

  it("nunca un movimiento tomado por otra tanda", () => {
    const movs = [mov({ id: "a", concepto_id: "sircreb" }), mov({ id: "b", concepto_id: "sircreb" })]
    expect(proponerCargos(movs, { ...ctx, tomados: new Set(["a"]) }).map((x) => x.movimiento_id)).toEqual(["b"])
  })

  it("nada anterior a `desde`", () => {
    const movs = [mov({ id: "viejo", fecha: "2026-10-31", concepto_id: "sircreb" }), mov({ id: "nuevo", fecha: "2026-11-01", concepto_id: "sircreb" })]
    expect(proponerCargos(movs, ctx).map((x) => x.movimiento_id)).toEqual(["nuevo"])
  })

  it("la comisión de acreditación de un cheque espera mientras la acreditación del día siga pendiente", () => {
    const com = mov({ id: "com", concepto_id: "comision_cheques", monto: -700, concepto_banco: "CHEQUE-Com acred Camara sin Filial Bco" })
    const acred = mov({ id: "acr", concepto_id: "movimiento", monto: 100000, concepto_banco: "Acreditacion de Valores - Camara Ch:12345678" })
    expect(proponerCargos([com, acred], ctx)).toEqual([])
    // Otro día / otra cuenta: se propone
    expect(proponerCargos([com, { ...acred, fecha: "2026-11-25" }], ctx).map((x) => x.movimiento_id)).toEqual(["com"])
    expect(proponerCargos([com, { ...acred, cuenta_bancaria_id: NAC }], ctx).map((x) => x.movimiento_id)).toEqual(["com"])
    // Acreditación ya conciliada por la tanda 4: la comisión suelta se registra
    expect(proponerCargos([com, { ...acred, estado_matching: "CONCILIADO" }], ctx).map((x) => x.movimiento_id)).toEqual(["com"])
  })

  it("una comisión de transferencia no espera a los cheques", () => {
    const com = mov({ id: "ct", concepto_id: "comision_transferencias", monto: -1200, concepto_banco: "Comision Transferencias]Inmediatas!COM" })
    const acred = mov({ id: "acr2", concepto_id: "movimiento", monto: 100000, concepto_banco: "Acreditacion de Valores - Camara Ch:12345678" })
    expect(proponerCargos([com, acred], ctx).map((x) => x.movimiento_id)).toEqual(["ct"])
  })
})

describe("qué falta explicar", () => {
  const base = (o: Partial<EntradaControl> = {}): EntradaControl => ({
    hoy: "2026-11-27",
    cuentas: [{ id: CRED, nombre: "Credicoop" }, { id: NAC, nombre: "Nación" }],
    saldos: [
      { cuenta_bancaria_id: CRED, saldo_banco: 1000, saldo_banco_al: "2026-11-27T12:00:00Z", saldo_sistema: 1000 },
      { cuenta_bancaria_id: NAC, saldo_banco: 500, saldo_banco_al: "2026-11-26T12:00:00Z", saldo_sistema: 700 },
    ],
    actualizado: { [CRED]: "2026-11-27T12:00:00Z", [NAC]: "2026-11-26T23:30:00Z" },
    movs: [], cargos: [], sinIdentificar: [], avisosCheques: [], demorados: [], noAparecieron: [],
    ...o,
  })

  it("cuenta al día: actualizada hoy, sin diferencia y nada pendiente", () => {
    const [cred, nac] = armarControl(base())
    expect(cred.al_dia).toBe(true)
    expect(cred.diferencia).toBe(0)
    expect(nac.al_dia).toBe(false)
    expect(nac.diferencia).toBe(-200)
    expect(nac.actualizado_hoy).toBe(false) // 23:30 UTC del 26 = 20:30 en Argentina del 26
  })

  it("actualizado hoy según la hora argentina", () => {
    const [cred] = armarControl(base({ hoy: "2026-11-27", actualizado: { [CRED]: "2026-11-28T02:00:00Z" } })) // 23:00 del 27 en AR
    expect(cred.actualizado_hoy).toBe(true)
  })

  it("sin saldo del banco: diferencia desconocida, nunca al día", () => {
    const [cred] = armarControl(base({ saldos: [{ cuenta_bancaria_id: CRED, saldo_banco: null, saldo_banco_al: null, saldo_sistema: 0 }] }))
    expect(cred.diferencia).toBeNull()
    expect(cred.al_dia).toBe(false)
  })

  it("cada renglón cae en un solo pendiente, con prioridad", () => {
    const movs = [
      mov({ id: "cargo", monto: -50 }),
      mov({ id: "sinid", monto: 3000 }),
      mov({ id: "prop", monto: 4000 }),
      mov({ id: "chq", monto: 100000 }),
      mov({ id: "com", monto: -700 }),
      mov({ id: "rech", monto: -20000 }),
      mov({ id: "sug", monto: 9000, estado_matching: "SUGERIDO" }),
      mov({ id: "deb", monto: -80000 }),
      mov({ id: "cre", monto: 120 }),
      mov({ id: "ok", monto: -10, estado_matching: "CONCILIADO" }),
      mov({ id: "reg", monto: -10, estado_matching: "REGISTRADO_EGRESO" }),
      mov({ id: "ign", monto: -10, estado_matching: "IGNORADO" }),
      mov({ id: "nac", cuenta_bancaria_id: NAC, monto: -5 }),
    ]
    const [cred, nac] = armarControl(base({
      movs,
      cargos: [{ movimiento_id: "cargo", cuenta_bancaria_id: CRED, fecha: "2026-11-26", monto: -50, concepto_id: "sircreb", concepto: "SIRCREB", texto: "", cargo: { tipo: "egreso", categoria: "IMPUESTOS" } }],
      sinIdentificar: [{ movimiento_id: "sinid", con_propuesta: false }, { movimiento_id: "prop", con_propuesta: true }],
      avisosCheques: [{ movimiento_id: "chq", tipo: "acreditar", comision_movimiento_id: "com" }, { movimiento_id: "rech", tipo: "rechazo" }],
      demorados: [{ cuenta_bancaria_id: CRED, monto: 5000 }, { cuenta_bancaria_id: NAC, monto: -1000 }],
      noAparecieron: [{ cuenta_bancaria_id: CRED, monto: 777 }, { cuenta_bancaria_id: null, monto: 1 }],
    }))
    const p = cred.pendientes
    expect(p.cargo).toEqual({ cantidad: 1, monto: 50 })
    expect(p.sin_identificar).toEqual({ cantidad: 1, monto: 3000 })
    expect(p.propuesta_transferencia).toEqual({ cantidad: 1, monto: 4000 })
    expect(p.propuesta_cheque).toEqual({ cantidad: 2, monto: 100700 })
    expect(p.rechazo).toEqual({ cantidad: 1, monto: 20000 })
    expect(p.sugerido).toEqual({ cantidad: 1, monto: 9000 })
    expect(p.debito).toEqual({ cantidad: 1, monto: 80000 })
    expect(p.credito).toEqual({ cantidad: 1, monto: 120 })
    expect(cred.demorados).toEqual({ cantidad: 1, monto: 5000 })
    expect(cred.no_aparecieron).toEqual({ cantidad: 1, monto: 777 })
    expect(cred.total).toBe(11)
    expect(cred.movimientos).toHaveLength(9)
    expect(cred.al_dia).toBe(false)
    expect(nac.pendientes.debito.cantidad).toBe(1)
    expect(nac.demorados.monto).toBe(1000)

    const t = totalesControl([cred, nac])
    expect(t.total).toBe(cred.total + nac.total)
    expect(t.pendientes.debito).toEqual({ cantidad: 2, monto: 80005 })
    expect(t.sin_actualizar).toEqual(["Nación"])
    expect(t.con_diferencia).toEqual([{ nombre: "Nación", diferencia: -200 }])
  })

  it("una diferencia de centavos no cuenta", () => {
    const [cred] = armarControl(base({ saldos: [{ cuenta_bancaria_id: CRED, saldo_banco: 1000.4, saldo_banco_al: null, saldo_sistema: 1000 }] }))
    expect(cred.al_dia).toBe(true)
    expect(totalesControl([cred]).con_diferencia).toEqual([])
  })

  it("lo ya explicado no es pendiente", () => {
    const idx = { cargos: new Set<string>(), propTransf: new Set<string>(), sinId: new Set<string>(), propCheque: new Set<string>(), rechazos: new Set<string>() }
    for (const e of ["CONCILIADO", "REGISTRADO_EGRESO", "REGISTRADO_INGRESO", "IGNORADO"]) expect(pendienteDe(mov({ estado_matching: e }), idx)).toBeNull()
  })
})
