import { describe, expect, it } from "vitest"
import { deudaCuentaCorriente, TIPOS_CC_BILLETERA, type MovimientoCC } from "../../../../lib/cobranzas/billetera-cc"

// Caso FREIJE (05/10/2026): la app del vendedor mostraba −$674.500 y
// /viajantes $0. El saldo de cuenta corriente de la billetera debe incluir
// las compensaciones ('rendicion_devuelta', 'manual'); sin ellas, una
// rendición cancelada por oficina o un ajuste del admin dejan a la app
// sumando distinto que /viajantes para siempre.

const m = (referencia_tipo: string | null, monto: number): MovimientoCC => ({ referencia_tipo, monto })

// Los movimientos reales de la billetera de FREIJE al 05/10 (por tipo)
const FREIJE: MovimientoCC[] = [
  m("manual", 674500),
  m("manual", -674500),
  m("manual", 0),
  m("pago_anulacion", -674970.28),
  m("pago_cliente", 17560057.28),
  m("pago_rechazado", -16861027),
  m("rechazo_revertido", 16186057),
  m("rendicion", -16210117),
  m("rendicion_devuelta", 674500),
  m("rendicion_saldo_declarado", -674500),
]

describe("deudaCuentaCorriente — billetera vendedor/chofer", () => {
  it("caso real FREIJE: la CC da $0 (como /viajantes), no −$674.500", () => {
    expect(deudaCuentaCorriente(FREIJE)).toBe(0)
  })

  it("sin 'rendicion_devuelta' el saldo declarado quedaba como fantasma (el bug)", () => {
    const sinCompensacion = FREIJE.filter((x) => x.referencia_tipo !== "rendicion_devuelta")
    expect(deudaCuentaCorriente(sinCompensacion)).toBe(-674500)
  })

  it("un ajuste manual del admin entra en la CC (coincide con /viajantes)", () => {
    expect(deudaCuentaCorriente([m("manual", 50000)])).toBe(50000)
  })

  it("el par pago_rechazado/rechazo_revertido NO entra (sigue al estado del pago)", () => {
    expect(TIPOS_CC_BILLETERA).not.toContain("pago_rechazado")
    expect(TIPOS_CC_BILLETERA).not.toContain("rechazo_revertido")
    expect(deudaCuentaCorriente([m("pago_rechazado", -100), m("rechazo_revertido", 100)])).toBe(0)
  })

  it("extras del chofer: viaje_gasto_rechazado suma solo si se pide", () => {
    const movs = [m("viaje_gasto_rechazado", 12345.67), m("rendicion_diferencia", -0.5)]
    expect(deudaCuentaCorriente(movs)).toBe(-0.5)
    expect(deudaCuentaCorriente(movs, ["viaje_gasto_rechazado"])).toBe(12345.17)
  })

  it("referencia_tipo null o desconocida no suma", () => {
    expect(deudaCuentaCorriente([m(null, 999), m("otracosa", 999)])).toBe(0)
  })
})
