// Cheques contra el banco (Tanda 4 del plan de bancos, 27/11/2026). Los renglones son los de los
// extractos de octubre (Credicoop, Nación, Provincia) tal como quedan guardados después de leerlos.
import { describe, expect, it } from "vitest"
import {
  clasificarLinea, combinacionesQueSuman, comisionDe, decidirAcreditacion, decidirDebitoPropio, estaDemorado,
  mismoNumero, numeroDeLinea, posiblesRechazados, sumarDiasHabiles,
  type ChequeDepositado, type ChequePropio, type ChequeTercero, type LineaBanco,
} from "../../../../lib/bancos/cheques/reglas"

const CREDICOOP = "cta-credicoop"
const PROVINCIA = "cta-provincia"
const NACION = "cta-nacion"

let n = 0
const linea = (o: Partial<LineaBanco>): LineaBanco => ({ id: `m${++n}`, cuenta_bancaria_id: CREDICOOP, fecha: "2026-10-07", monto: 0, descripcion: "", ...o })
const dep = (o: Partial<ChequeDepositado>): ChequeDepositado => ({ id: `c${++n}`, numero: null, monto: 0, fecha_deposito: "2026-10-05", cuenta_banco_id: CREDICOOP, ...o })

describe("Qué renglón es de cheques", () => {
  it("acreditaciones de los tres bancos", () => {
    for (const d of [
      "Acreditacion de Valores − Camara — Dep:1305000002−SANTANDER−Ch:10800327",
      "ECHQ − Acreditac de Valores − Camara — Dep:1309916727−BANCO MACRO−Ch:68977284",
      "ECHEQ − Acreditac Valores − C. Interno",
      "ECHEQ − Acred Valores − Representados",
      "Acreditacion de Valores − Canje Interno",
      "DEP. CH. 48 HS. BNA",
      "CAM.FED.DIST.PZA. O/BCOS.",
      "DEPOSITO CHEQUE C/BANCOS NRO: 000000000 SUCURSAL: 6232",
    ]) expect(clasificarLinea(linea({ monto: 1000, descripcion: d }))).toBe("acreditacion")
  })

  it("comisiones de acreditación (las demás las clasifica la tanda 2)", () => {
    for (const d of ["CHEQUE−Com acred Camara sin Filial Bco", "ECHQ−Comis acred Camara sin Filial Bco", "ECHQ −Comis acred C Int con Filial Bco", "COM ECH CANJE O/BANCOS"]) {
      expect(clasificarLinea(linea({ monto: -1000, descripcion: d }))).toBe("comision")
    }
    expect(clasificarLinea(linea({ monto: -1200, descripcion: "Comision Cheque Pagado por Clearing" }))).toBeNull()
    expect(clasificarLinea(linea({ monto: -8362.88, descripcion: "COMISION GESTION DE COBRO DE CHEQUES DE FECHA 05-10-2026" }))).toBeNull()
  })

  it("rechazos, cheques propios pagados y lo que no es de cheques", () => {
    expect(clasificarLinea(linea({ monto: -50000, descripcion: "CHEQUE/O.E. RECHAZADO" }))).toBe("rechazo")
    expect(clasificarLinea(linea({ monto: -2620666.52, descripcion: "ECHEQ − Debito cheque rechazado" }))).toBe("rechazo")
    expect(clasificarLinea(linea({ monto: -142937.2, descripcion: "Pago de Cheque de Camara" }))).toBe("debito_propio")
    expect(clasificarLinea(linea({ monto: -3870728.08, descripcion: "ECHEQ − Pago cheque de camara" }))).toBe("debito_propio")
    expect(clasificarLinea(linea({ monto: -9000000, descripcion: "CHEQUE POR VENTANILLA 013079755" }))).toBe("debito_propio")
    expect(clasificarLinea(linea({ monto: -25000000, descripcion: "Pago Cheque por Caja−Titular de Cuenta" }))).toBeNull()
    expect(clasificarLinea(linea({ monto: 50000, descripcion: "CR DEBIN RED LINK" }))).toBeNull()
    expect(clasificarLinea(linea({ monto: -1246.28, descripcion: "Recaudacion SIRCREB CM − Condicion E" }))).toBeNull()
  })
})

describe("Número de cheque del renglón", () => {
  it("las formas conocidas, y nunca un número cualquiera", () => {
    expect(numeroDeLinea(linea({ descripcion: "ECHQ − Acreditac de Valores − Camara — Dep:1309916727−BANCO MACRO−Ch:68977284" }))).toBe("68977284")
    expect(numeroDeLinea(linea({ descripcion: "Pago de Cheque de Camara", referencia_externa: "bccl-pdf:2026-10-06|c988638|PAGODECHEQUEDECAMARA|-14293720" }))).toBe("988638")
    expect(numeroDeLinea(linea({ descripcion: "Pago de Cheque de Camara 988638" }))).toBe("988638")
    expect(numeroDeLinea(linea({ descripcion: "CHEQUE POR VENTANILLA 013079755" }))).toBe("013079755")
    expect(numeroDeLinea(linea({ descripcion: "Acreditacion de Valores − Camara — comp. 800327" }))).toBe("800327")
    expect(numeroDeLinea(linea({ descripcion: "DEPOSITO CHEQUE C/BANCOS NRO: 000000000 SUCURSAL: 6232" }))).toBeNull()
    expect(numeroDeLinea(linea({ descripcion: "DEP. CH. 48 HS. BNA", referencia_externa: "bna-pdf:2026-10-14|c2860001|DEPCH48HSBNA|555807400" }))).toBeNull()
  })

  it("mismo número: sin ceros a la izquierda o los últimos 6 dígitos de Credicoop", () => {
    expect(mismoNumero("68977284", "977284")).toBe(true)
    expect(mismoNumero("00017040", "017040")).toBe(true)
    expect(mismoNumero("17040", "017040")).toBe(true)
    expect(mismoNumero("13079755", "013079755")).toBe(true)
    expect(mismoNumero("68977285", "977284")).toBe(false)
    expect(mismoNumero("977284", "77284")).toBe(false) // menos de 6 dígitos: tiene que ser igual
    expect(mismoNumero("", "977284")).toBe(false)
    expect(mismoNumero("123", "000")).toBe(false)
  })
})

describe("Acreditación por número", () => {
  const credito = linea({ monto: 7822413, fecha: "2026-10-05", descripcion: "ECHQ − Acreditac de Valores − Camara — Dep:1309916727−BANCO MACRO−Ch:68977284" })

  it("el cheque de ese número e importe, aunque haya otro del mismo importe", () => {
    const a = dep({ numero: "68977284", monto: 7822413, fecha_deposito: "2026-10-02" })
    const b = dep({ numero: "11111111", monto: 7822413, fecha_deposito: "2026-10-02" })
    expect(decidirAcreditacion(credito, [b, a])).toEqual({ tipo: "unico", cheques: [a.id], por: "numero" })
  })

  it("número que coincide con otro importe, o número que no está: no se decide", () => {
    expect(decidirAcreditacion(credito, [dep({ numero: "68977284", monto: 7822400 })]).tipo).toBe("ninguno")
    expect(decidirAcreditacion(credito, [dep({ numero: "12345678", monto: 7822413 })]).tipo).toBe("ninguno")
  })

  it("solo cheques de esa cuenta y depositados antes del crédito", () => {
    expect(decidirAcreditacion(credito, [dep({ numero: "68977284", monto: 7822413, cuenta_banco_id: NACION })]).tipo).toBe("ninguno")
    expect(decidirAcreditacion(credito, [dep({ numero: "68977284", monto: 7822413, fecha_deposito: "2026-10-06" })]).tipo).toBe("ninguno")
  })
})

describe("Acreditación por importe", () => {
  const credito = linea({ cuenta_bancaria_id: NACION, monto: 5558074, fecha: "2026-10-14", descripcion: "DEP. CH. 48 HS. BNA" })

  it("un solo cheque con ese importe exacto", () => {
    const a = dep({ cuenta_banco_id: NACION, monto: 5558074, fecha_deposito: "2026-10-10" })
    expect(decidirAcreditacion(credito, [a, dep({ cuenta_banco_id: NACION, monto: 5558073.99 })])).toEqual({ tipo: "unico", cheques: [a.id], por: "importe" })
  })

  it("dos cheques con el mismo importe: no se decide", () => {
    const d = decidirAcreditacion(credito, [dep({ cuenta_banco_id: NACION, monto: 5558074 }), dep({ cuenta_banco_id: NACION, monto: 5558074, fecha_deposito: "2026-10-09" })])
    expect(d.tipo).toBe("ambiguo")
  })

  it("un cheque solo y otra combinación que también da: no se decide", () => {
    const d = decidirAcreditacion(credito, [
      dep({ cuenta_banco_id: NACION, monto: 5558074, fecha_deposito: "2026-10-09" }),
      dep({ cuenta_banco_id: NACION, monto: 5000000, fecha_deposito: "2026-10-10" }),
      dep({ cuenta_banco_id: NACION, monto: 558074, fecha_deposito: "2026-10-10" }),
    ])
    expect(d.tipo).toBe("ambiguo")
  })
})

describe("Depósitos sumados (Provincia)", () => {
  const credito = linea({ cuenta_bancaria_id: PROVINCIA, monto: 8362887.95, fecha: "2026-10-05", descripcion: "DEPOSITO CHEQUE C/BANCOS NRO: 000000000 SUCURSAL: 6232" })
  const p = (monto: number, fecha_deposito = "2026-10-01") => dep({ cuenta_banco_id: PROVINCIA, monto, fecha_deposito })

  it("la única combinación de los depositados ese día que suma exacto", () => {
    const a = p(5000000), b = p(3000000), c = p(362887.95), x = p(1234.56)
    const d = decidirAcreditacion(credito, [a, b, c, x])
    expect(d.tipo).toBe("unico")
    if (d.tipo === "unico") { expect(d.por).toBe("suma"); expect([...d.cheques].sort()).toEqual([a.id, b.id, c.id].sort()) }
  })

  it("cheques de días distintos no se mezclan", () => {
    expect(decidirAcreditacion(credito, [p(5000000, "2026-10-01"), p(3362887.95, "2026-10-02")]).tipo).toBe("ninguno")
  })

  it("más de una combinación que da: no se decide", () => {
    const d = decidirAcreditacion(credito, [p(5000000), p(3362887.95), p(4000000), p(1000000), p(3362887.95)])
    expect(d.tipo).toBe("ambiguo")
  })

  it("dos cheques iguales que se pueden intercambiar también es ambiguo", () => {
    expect(decidirAcreditacion(credito, [p(5000000), p(3362887.95), p(3362887.95)]).tipo).toBe("ambiguo")
  })

  it("búsqueda de sumas: exacta al centavo y con tope", () => {
    expect(combinacionesQueSuman([{ id: "a", c: 100 }, { id: "b", c: 200 }, { id: "c", c: 300 }], 300)).toEqual([["b", "a"]])
    expect(combinacionesQueSuman([{ id: "a", c: 100 }, { id: "b", c: 200 }], 301)).toEqual([])
    expect(combinacionesQueSuman(Array.from({ length: 31 }, (_, i) => ({ id: `x${i}`, c: 100 })), 300)).toBeNull()
  })
})

describe("Comisión de la acreditación", () => {
  it("por la tasa, cuando ninguna otra acreditación del día podría tener esa comisión", () => {
    const c1 = linea({ monto: 698408, descripcion: "Acreditacion de Valores − Camara" })
    const f1 = linea({ monto: -9777.71, descripcion: "CHEQUE−Com acred Camara sin Filial Bco" })
    const c2 = linea({ monto: 500000, descripcion: "Acreditacion de Valores − Camara" })
    const f2 = linea({ monto: -3500, descripcion: "CHEQUE−Com Acred Camara con Filial Bco" })
    expect(comisionDe(c1, [f1, f2], [c1, c2])).toBe(f1.id)
    expect(comisionDe(c2, [f1, f2], [c1, c2])).toBe(f2.id)
  })

  it("dos acreditaciones iguales del día: la comisión no se asigna (la registra la tanda 2)", () => {
    const c1 = linea({ monto: 1500000 }), c2 = linea({ monto: 1500000 })
    const f1 = linea({ monto: -10500 }), f2 = linea({ monto: -21000 })
    expect(comisionDe(c1, [f1, f2], [c1, c2])).toBeNull()
  })

  it("por el saldo corrido, o la única del día", () => {
    const c = linea({ cuenta_bancaria_id: NACION, fecha: "2026-10-26", monto: 18591094.84, saldo_banco: 18688933.4 })
    const f = linea({ cuenta_bancaria_id: NACION, fecha: "2026-10-26", monto: -130137.66, saldo_banco: 18558795.74 })
    expect(comisionDe(c, [f], [c])).toBe(f.id)
    const sola = linea({ monto: 70000 }), fs = linea({ monto: -1000 })
    expect(comisionDe(sola, [fs], [sola])).toBe(fs.id)
    expect(comisionDe(sola, [linea({ monto: -1000, fecha: "2026-10-08" })], [sola])).toBeNull()
  })
})

describe("Cheque propio pagado por el banco", () => {
  const propio = (o: Partial<ChequePropio>): ChequePropio => ({ id: `p${++n}`, numero: null, monto: 0, cuenta_banco_id: CREDICOOP, ...o })

  it("por número e importe (Credicoop por el comprobante, Provincia por ventanilla)", () => {
    const a = propio({ numero: "00988638", monto: 142937.2 })
    const l = linea({ monto: -142937.2, descripcion: "Pago de Cheque de Camara", referencia_externa: "bccl-pdf:2026-10-06|c988638|PAGODECHEQUEDECAMARA|-14293720" })
    expect(decidirDebitoPropio(l, [a, propio({ numero: "988639", monto: 142937.2 })])).toEqual({ tipo: "unico", cheques: [a.id], por: "numero" })
    const v = propio({ numero: "13079755", monto: 9000000, cuenta_banco_id: null })
    expect(decidirDebitoPropio(linea({ cuenta_bancaria_id: PROVINCIA, monto: -9000000, descripcion: "CHEQUE POR VENTANILLA 013079755" }), [v]).tipo).toBe("unico")
  })

  it("mismo número con otro importe, u otra cuenta: no", () => {
    const l = linea({ monto: -142937.2, descripcion: "Pago de Cheque de Camara 988638" })
    expect(decidirDebitoPropio(l, [propio({ numero: "988638", monto: 142937 })]).tipo).toBe("ninguno")
    expect(decidirDebitoPropio(l, [propio({ numero: "988638", monto: 142937.2, cuenta_banco_id: NACION })]).tipo).toBe("ninguno")
  })

  it("sin número: único por importe en esa cuenta; dos iguales → no", () => {
    const l = linea({ monto: -3870728.08, descripcion: "ECHEQ − Pago cheque de camara" })
    const a = propio({ monto: 3870728.08 })
    expect(decidirDebitoPropio(l, [a, propio({ monto: 3870728.08, cuenta_banco_id: null })])).toEqual({ tipo: "unico", cheques: [a.id], por: "importe" })
    expect(decidirDebitoPropio(l, [a, propio({ monto: 3870728.08 })]).tipo).toBe("ambiguo")
  })
})

describe("Rechazo: la lista para que confirme el dueño", () => {
  const t = (o: Partial<ChequeTercero>): ChequeTercero => ({ ...dep({}), estado: "DEPOSITADO", ...o })

  it("por número e importe (aunque ya estuviera acreditado)", () => {
    const a = t({ numero: "20055514", monto: 2620666.52, estado: "COBRADO" })
    const b = t({ numero: "99999999", monto: 2620666.52 })
    const l = linea({ fecha: "2026-10-14", monto: -2620666.52, descripcion: "ECHEQ − Debito cheque rechazado", referencia_externa: "bccl-pdf:2026-10-14|c055514|ECHEQDEBITOCHEQUERECHAZADO|-262066652" })
    expect(posiblesRechazados(l, [a, b])).toEqual([a.id])
  })

  it("sin número: todos los de ese importe en la cuenta (el dueño elige)", () => {
    const a = t({ cuenta_banco_id: PROVINCIA, monto: 50000 }), b = t({ cuenta_banco_id: PROVINCIA, monto: 50000, estado: "COBRADO" })
    const otro = t({ cuenta_banco_id: PROVINCIA, monto: 50000, estado: "RECHAZADO" })
    const l = linea({ cuenta_bancaria_id: PROVINCIA, monto: -50000, descripcion: "CHEQUE/O.E. RECHAZADO" })
    expect(posiblesRechazados(l, [a, b, otro, t({ monto: 50000 })])).toEqual([a.id, b.id])
    expect(posiblesRechazados(linea({ cuenta_bancaria_id: PROVINCIA, monto: -1, descripcion: "CHEQUE/O.E. RECHAZADO" }), [a])).toEqual([])
  })
})

describe("48 h y 96 h hábiles", () => {
  const FERIADOS = new Set(["2026-11-23"]) // lunes feriado

  it("fecha esperada: salta fin de semana y feriados", () => {
    expect(sumarDiasHabiles("2026-11-18", 2)).toBe("2026-11-20") // miércoles → viernes
    expect(sumarDiasHabiles("2026-11-19", 2)).toBe("2026-11-23") // jueves → lunes
    expect(sumarDiasHabiles("2026-11-19", 2, FERIADOS)).toBe("2026-11-24") // con el lunes feriado → martes
  })

  it("alerta a las 96 h hábiles sin acreditar", () => {
    expect(estaDemorado("2026-11-16", "2026-11-19")).toBe(false) // lunes → jueves: 3 días hábiles
    expect(estaDemorado("2026-11-16", "2026-11-20")).toBe(true) // viernes: 4 días hábiles = 96 h
    expect(estaDemorado("2026-11-19", "2026-11-25", FERIADOS)).toBe(false) // jue → mié con feriado: 3
    expect(estaDemorado("2026-11-19", "2026-11-26", FERIADOS)).toBe(true)
    expect(estaDemorado(null, "2026-11-26")).toBe(false)
  })
})
