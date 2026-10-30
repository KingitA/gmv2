import { describe, expect, it } from "vitest"
import { deudaCuentaCorriente, plataEnManoDeMovimientos, type MovimientoCC } from "../../../../lib/cobranzas/billetera-cc"

// P2-38: la diferencia de rendición es un renglón "vehículo" a la cuenta personal; la migración
// 20261030 le agrega su traspaso (importe opuesto). Plata en mano y deuda no cambian; los
// renglones suman lo mismo que el saldo.
describe("billetera: traspaso a la cuenta personal", () => {
  // Chofer, rendición 4a774e9b de la 2ª prueba (resumido): fondo, cobros, gastos, rendición
  const base: MovimientoCC[] = [
    { monto: 50000, referencia_tipo: "viaje_fondo" },
    { monto: 171600, referencia_tipo: "pago_cliente" },
    { monto: -35000, referencia_tipo: "viaje" },
    { monto: -171600, referencia_tipo: "rendicion" },
    { monto: -15000, referencia_tipo: "viaje_fondo_liquidado" },
    { monto: 1000, referencia_tipo: "rendicion_saldo_declarado" },
  ]
  const conTraspaso: MovimientoCC[] = [...base, { monto: -1000, referencia_tipo: "traspaso_cuenta_personal" }]
  const suma = (ms: MovimientoCC[]) => Math.round(ms.reduce((s, m) => s + Number(m.monto), 0) * 100) / 100

  it("antes: los renglones sumaban $1.000 con la plata en mano en $0", () => {
    expect(suma(base)).toBe(1000)
    expect(plataEnManoDeMovimientos(base)).toBe(0)
  })

  it("con el traspaso: renglones $0 = plata en mano $0, y la deuda en la cuenta sigue en $1.000", () => {
    expect(suma(conTraspaso)).toBe(0)
    expect(plataEnManoDeMovimientos(conTraspaso)).toBe(0)
    expect(deudaCuentaCorriente(conTraspaso)).toBe(deudaCuentaCorriente(base))
  })
})
