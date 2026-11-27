// Transferencias de clientes ↔ créditos del banco (Tanda 3 del plan de bancos, 27/11/2026).
// Reglas de Juan: monto exacto (centavos < $1), misma cuenta, fecha informada → +3 días hábiles,
// UNA sola candidata (o una sola después de mirar quién pagó). Pagadores muchos a muchos; nunca por
// el nombre del cliente. Nada se usa dos veces.
import { describe, expect, it } from "vitest"
import {
  candidatasPara, decidirCredito, emparejar, enVentana, esCreditoDeCliente, mismoMonto, noAparecio,
  normalizarNombrePagador, pagaPorElCliente, sugerirClientes, sumarDiasHabiles,
  type CreditoBanco, type Pagador, type TransferenciaInformada,
} from "../../../../lib/bancos/transferencias/matching"

const NACION = "cta-nacion"
const CREDICOOP = "cta-credicoop"

const credito = (o: Partial<CreditoBanco> = {}): CreditoBanco => ({
  id: "m-1", cuenta_bancaria_id: NACION, fecha: "2026-11-25", monto: 150000, concepto_banco: "CR DEBIN RED LINK",
  contraparte_nombre: "PEREZ JUAN CARLOS", contraparte_cuit: "20-38919789-1", ...o,
})
const informada = (o: Partial<TransferenciaInformada> = {}): TransferenciaInformada => ({
  pago_id: "p-1", detalle_id: "d-1", cliente_id: "c-1", cliente_cuit: null, cuenta_bancaria_id: NACION,
  monto: 150000, fecha: "2026-11-25", solo_este_medio: true, ...o,
})

describe("monto, cuenta y fecha", () => {
  it("monto exacto: coincide; con centavos de redondeo (< $1) también; $1 o más, no", () => {
    expect(mismoMonto(150000, 150000)).toBe(true)
    expect(mismoMonto(150000, 150000.4)).toBe(true)
    expect(mismoMonto(150000.99, 150000)).toBe(true)
    expect(mismoMonto(150000, 150001)).toBe(false)
    expect(mismoMonto(150000, 149990)).toBe(false)   // "el cliente descontó $10" no existe
    expect(decidirCredito(credito({ monto: 150000.32 }), [informada()], []).accion).toBe("confirmar")
    expect(decidirCredito(credito({ monto: 150010 }), [informada()], [])).toMatchObject({ accion: "nada", motivo: "sin_candidato" })
  })

  it("la cuenta tiene que ser la informada", () => {
    expect(decidirCredito(credito({ cuenta_bancaria_id: CREDICOOP }), [informada()], [])).toMatchObject({ accion: "nada", motivo: "sin_candidato" })
    expect(decidirCredito(credito(), [informada({ cuenta_bancaria_id: null })], []).accion).toBe("nada")
  })

  it("fecha: desde la informada hasta 3 días hábiles después (sin fines de semana ni feriados)", () => {
    // Miércoles 25/11 + 3 hábiles = lunes 30/11
    expect(sumarDiasHabiles("2026-11-25", 3)).toBe("2026-11-30")
    expect(enVentana("2026-11-30", "2026-11-25")).toBe(true)
    expect(enVentana("2026-12-01", "2026-11-25")).toBe(false)
    expect(enVentana("2026-11-24", "2026-11-25")).toBe(false) // antes de informada, no
    // Con feriado el lunes 30/11 la ventana llega al martes 01/12
    expect(enVentana("2026-12-01", "2026-11-25", new Set(["2026-11-30"]))).toBe(true)
    // Informada un sábado: cuenta desde el lunes (lunes + 3 hábiles = jueves)
    expect(sumarDiasHabiles("2026-11-28", 3)).toBe("2026-12-03")
  })
})

describe("qué créditos son de clientes", () => {
  it("transferencias y DEBIN sí; cheques, reversas, intereses y cuentas propias no", () => {
    expect(esCreditoDeCliente(credito())).toBe(true)
    expect(esCreditoDeCliente(credito({ concepto_banco: "TRANSF.INT.DIST-LINKLAR", contraparte_nombre: null, contraparte_cuit: null }))).toBe(true)
    expect(esCreditoDeCliente(credito({ concepto_banco: "Acreditación de Valores - Cámara Ch: 123", contraparte_nombre: null, contraparte_cuit: null }))).toBe(false)
    expect(esCreditoDeCliente(credito({ concepto_banco: "REV. IMP.DEBITO" }))).toBe(false)
    expect(esCreditoDeCliente(credito({ concepto_banco: "REVERSA INGRESOS BRUTO SIRCREB" }))).toBe(false)
    expect(esCreditoDeCliente(credito({ concepto_banco: "Rendimientos" }))).toBe(false)
    expect(esCreditoDeCliente(credito({ monto: -5000 }))).toBe(false)
    expect(esCreditoDeCliente(credito({ contraparte_cuit: "30-71234567-1" }), { cuitPropio: "30712345671" })).toBe(false)
  })
})

describe("varias transferencias iguales: decide quién pagó", () => {
  const dos = [
    informada({ pago_id: "p-1", detalle_id: "d-1", cliente_id: "c-1" }),
    informada({ pago_id: "p-2", detalle_id: "d-2", cliente_id: "c-2" }),
  ]

  it("dos montos iguales el mismo día: sin pagador conocido no se confirma ninguna", () => {
    const d = decidirCredito(credito(), dos, [])
    expect(d).toMatchObject({ accion: "nada", motivo: "varias" })
    if (d.accion === "nada") expect(d.candidatas.map((c) => c.pago_id)).toEqual(["p-1", "p-2"])
  })

  it("…con el CUIT del que transfirió entre los pagadores de uno de los clientes, se confirma ese", () => {
    const pagadores: Pagador[] = [{ cliente_id: "c-2", pagador_cuit: "20-38919789-1" }]
    const d = decidirCredito(credito(), dos, pagadores)
    expect(d).toMatchObject({ accion: "confirmar", por: "pagador" })
    if (d.accion === "confirmar") expect(d.transferencia.pago_id).toBe("p-2")
  })

  it("…el CUIT del propio cliente cuenta como pagador", () => {
    const conCuit = [dos[0], { ...dos[1], cliente_cuit: "20389197891" }]
    const d = decidirCredito(credito(), conCuit, [])
    expect(d.accion === "confirmar" && d.transferencia.pago_id).toBe("p-2")
  })

  it("…si el pagador paga por los DOS clientes, sigue habiendo dos: no se confirma", () => {
    const pagadores: Pagador[] = [
      { cliente_id: "c-1", pagador_cuit: "20-38919789-1" },
      { cliente_id: "c-2", pagador_cuit: "20-38919789-1" },
    ]
    expect(decidirCredito(credito(), dos, pagadores)).toMatchObject({ accion: "nada", motivo: "varias" })
  })

  it("una persona que paga por 2 clientes (él y el primo): cada crédito va con su transferencia informada", () => {
    // Juan Pérez paga lo suyo (c-1, $80.000) y lo del primo de otro pueblo (c-2, $45.500)
    const pagadores: Pagador[] = [
      { cliente_id: "c-1", pagador_cuit: "20-38919789-1" },
      { cliente_id: "c-2", pagador_cuit: "20-38919789-1" },
    ]
    const informadas = [
      informada({ pago_id: "p-1", detalle_id: "d-1", cliente_id: "c-1", monto: 80000 }),
      informada({ pago_id: "p-2", detalle_id: "d-2", cliente_id: "c-2", monto: 45500 }),
    ]
    const r = emparejar([credito({ id: "m-1", monto: 80000 }), credito({ id: "m-2", monto: 45500 })], informadas, pagadores)
    expect(r.map((d) => d.accion === "confirmar" && d.transferencia.pago_id)).toEqual(["p-1", "p-2"])
    // Sugerencias para un crédito sin informar del mismo pagador: los DOS clientes, ninguno elegido solo
    const s = sugerirClientes(credito({ monto: 9999 }), pagadores, [])
    expect(s.map((x) => x.cliente_id).sort()).toEqual(["c-1", "c-2"])
  })

  it("clientes con el mismo nombre: el nombre del CLIENTE nunca decide", () => {
    // Dos clientes "PEREZ JUAN CARLOS" (pueblos distintos) y el que transfirió se llama igual
    const iguales = [
      informada({ pago_id: "p-1", detalle_id: "d-1", cliente_id: "perez-tandil" }),
      informada({ pago_id: "p-2", detalle_id: "d-2", cliente_id: "perez-azul" }),
    ]
    expect(decidirCredito(credito({ contraparte_cuit: null }), iguales, [])).toMatchObject({ accion: "nada", motivo: "varias" })
    // Con el nombre del PAGADOR aprendido de uno solo de ellos, sí
    const aprendido: Pagador[] = [{ cliente_id: "perez-azul", pagador_nombre_normalizado: normalizarNombrePagador("Pérez, Juan Carlos") }]
    const d = decidirCredito(credito({ contraparte_cuit: null }), iguales, aprendido)
    expect(d.accion === "confirmar" && d.transferencia.cliente_id).toBe("perez-azul")
  })

  it("CUIT distinto al del pagador aprendido: el nombre igual no alcanza", () => {
    const pagadores: Pagador[] = [{ cliente_id: "c-1", pagador_cuit: "27-12345678-0", pagador_nombre_normalizado: normalizarNombrePagador("PEREZ JUAN CARLOS") }]
    expect(pagaPorElCliente(credito(), "c-1", null, pagadores)).toBe(false)
  })
})

describe("sin candidata y sin duplicar", () => {
  it("ninguna transferencia informada: queda sin identificar", () => {
    expect(decidirCredito(credito(), [], [])).toMatchObject({ accion: "nada", motivo: "sin_candidato" })
    expect(candidatasPara(credito(), [informada({ fecha: "2026-11-30" })])).toEqual([]) // informada después del crédito
  })

  it("un crédito ya vinculado no se vuelve a usar", () => {
    expect(decidirCredito(credito({ vinculado: true }), [informada()], [])).toMatchObject({ accion: "nada", motivo: "ya_vinculado" })
  })

  it("una transferencia ya vinculada no se vuelve a usar", () => {
    expect(decidirCredito(credito(), [informada({ vinculada: true })], [])).toMatchObject({ accion: "nada", motivo: "sin_candidato" })
  })

  it("dos créditos iguales y una sola transferencia informada: no se confirma ninguno", () => {
    const r = emparejar([credito({ id: "m-1" }), credito({ id: "m-2", contraparte_cuit: "27-12345678-0" })], [informada()], [])
    expect(r.map((d) => d.accion)).toEqual(["nada", "nada"])
    expect(r[0]).toMatchObject({ motivo: "compartida" })
  })

  it("el cobro con otros medios (efectivo + transferencia) no se confirma solo", () => {
    expect(decidirCredito(credito(), [informada({ solo_este_medio: false })], [])).toMatchObject({ accion: "nada", motivo: "otros_medios" })
  })
})

describe("no apareció en el banco", () => {
  const t = informada({ fecha: "2026-11-20" }) // viernes → límite martes 24/11
  it("a los 2 días hábiles, si del banco ya se leyó algo posterior", () => {
    expect(noAparecio(t, "2026-11-25", "2026-11-25")).toBe(true)
    expect(noAparecio(t, "2026-11-24", "2026-11-25")).toBe(false)   // todavía en plazo
    expect(noAparecio(t, "2026-11-27", "2026-11-23")).toBe(false)   // la cuenta no se cargó: no se sabe
    expect(noAparecio(t, "2026-11-27", null)).toBe(false)
    expect(noAparecio({ ...t, vinculada: true }, "2026-11-27", "2026-11-27")).toBe(false)
  })
})

describe("nombre del pagador", () => {
  it("mayúsculas, sin acentos ni signos y en cualquier orden", () => {
    expect(normalizarNombrePagador("Pérez, Juan Carlos")).toBe(normalizarNombrePagador("JUAN CARLOS PEREZ"))
    expect(normalizarNombrePagador("Distribuidora Norte S.R.L.")).toBe(normalizarNombrePagador("DISTRIBUIDORA NORTE SRL"))
    expect(normalizarNombrePagador("  ")).toBeNull()
  })
})
