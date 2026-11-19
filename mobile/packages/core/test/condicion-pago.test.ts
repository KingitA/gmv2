import { describe, it, expect } from "vitest"
import {
  desdeTextoViejo, fechasCheque, normalizarCondicion, textoCondicionPago, textoViejo, vencimientoDeuda,
} from "../../../../lib/clientes/condicion-pago"

// Condiciones de pago nuevas (Juan, 19/11/2026): condición (cuándo) + forma (cómo)
describe("condición de pago", () => {
  it("pasa el texto viejo como decidió Juan: todos contado", () => {
    expect(desdeTextoViejo("Efectivo")).toMatchObject({ condicion_pago_tipo: "contado", forma_pago: "efectivo", plazo_dias: 0 })
    expect(desdeTextoViejo("Transferencia")).toMatchObject({ condicion_pago_tipo: "contado", forma_pago: "transferencia" })
    expect(desdeTextoViejo("Cheque 30 días")).toMatchObject({ forma_pago: "cheque", cheque_dias_desde: 30, cheque_dias_hasta: 30 })
    expect(desdeTextoViejo("cheque al dia")).toMatchObject({ forma_pago: "cheque", cheque_dias_desde: 0, cheque_dias_hasta: 0 })
    expect(desdeTextoViejo("Cheque 30/60/90")).toMatchObject({ forma_pago: "cheque", cheque_dias_desde: 30, cheque_dias_hasta: 90 })
    expect(desdeTextoViejo("Cheque 45 días")).toMatchObject({ forma_pago: "cheque", cheque_dias_desde: 45, cheque_dias_hasta: 45 })
  })

  it("sin texto o texto desconocido = vacío (nunca un valor supuesto)", () => {
    expect(desdeTextoViejo(null).condicion_pago_tipo).toBeNull()
    expect(desdeTextoViejo("A convenir").forma_pago).toBeNull()
  })

  it("arma el texto que se muestra", () => {
    expect(textoCondicionPago(desdeTextoViejo("Efectivo"))).toBe("Contado · Efectivo")
    expect(textoCondicionPago(normalizarCondicion({ condicion_pago_tipo: "anticipado", forma_pago: "transferencia" }))).toBe("Anticipado · Transferencia")
    expect(textoCondicionPago(normalizarCondicion({ condicion_pago_tipo: "cuenta_corriente", plazo_dias: 30, forma_pago: "cheque", cheque_dias_desde: 60, cheque_dias_hasta: 90 })))
      .toBe("Cuenta corriente 30 días · Cheques de 60 a 90 días")
    expect(textoCondicionPago(desdeTextoViejo("Cheque al día"))).toBe("Contado · Cheque al día")
    expect(textoCondicionPago(desdeTextoViejo("Cheque 30 días"))).toBe("Contado · Cheque a 30 días")
  })

  it("acomoda sin rechazar: plazo solo en cuenta corriente, cheque al revés se da vuelta", () => {
    const c = normalizarCondicion({ condicion_pago_tipo: "contado", plazo_dias: 15, forma_pago: "efectivo", cheque_dias_desde: 30 })
    expect(c).toMatchObject({ plazo_dias: 0, cheque_dias_desde: null, cheque_dias_hasta: null })
    expect(normalizarCondicion({ forma_pago: "cheque", cheque_dias_desde: 90, cheque_dias_hasta: 60 })).toMatchObject({ cheque_dias_desde: 60, cheque_dias_hasta: 90 })
  })

  it("texto viejo para las APK: nombre viejo si es contado, si no el texto nuevo", () => {
    expect(textoViejo(desdeTextoViejo("Cheque 30/60/90"))).toBe("Cheque 30/60/90")
    expect(textoViejo(normalizarCondicion({ condicion_pago_tipo: "cuenta_corriente", plazo_dias: 30, forma_pago: "efectivo" }))).toBe("Cuenta corriente 30 días · Efectivo")
  })

  it("vencimiento = fecha + plazo; los cheques cuentan desde el vencimiento (ejemplo de Juan)", () => {
    const venc = vencimientoDeuda("2026-11-19", 30)
    expect(venc).toBe("2026-12-19")
    expect(vencimientoDeuda("2026-11-19", 0)).toBe("2026-11-19")
    expect(fechasCheque(venc, { forma_pago: "cheque", cheque_dias_desde: 60, cheque_dias_hasta: 60 })).toEqual({ desde: "2027-02-17", hasta: "2027-02-17" })
  })
})
