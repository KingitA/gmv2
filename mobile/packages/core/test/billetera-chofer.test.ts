import { describe, expect, it } from "vitest"
import { necesitaCompensacionLegada, REF_ANULACION, REF_PAGO, type MovimientoBilletera } from "../../../../lib/cobranzas/billetera-chofer"

// Bug encontrado en el checklist contra producción (30/09/2026): el cobro del chofer se asentaba
// en la billetera con la referencia al VIAJE y cobranza_anular revierte por la referencia al PAGO:
// anular un cobro dejaba su plata en la billetera. Caso real: pago bdc82e00 de $ 50.000 anulado,
// billetera +50.000 de más. Los cobros nuevos se asientan por pago; los viejos se compensan al anular.

const PAGO = "bdc82e00-0000-4000-8000-000000000001"
const VIAJE = "c594f64b-0000-4000-8000-000000000002"
const mov = (tipo: string, monto: number, referencia_tipo: string, referencia_id: string): MovimientoBilletera => ({ tipo, monto, referencia_tipo, referencia_id })

describe("billetera del chofer · anular un cobro la revierte", () => {
  it("cobro viejo (asentado contra el viaje) anulado: hay que compensar", () => {
    const movs = [mov("credito", 100000, "viaje_fondo", VIAJE), mov("cobro_cliente", 50000, "viaje", VIAJE), mov("cobro_cliente", 20000, "viaje", VIAJE)]
    expect(necesitaCompensacionLegada(movs, PAGO, VIAJE, 50000)).toBe(true)
  })

  it("cobro nuevo (asentado contra el pago): lo revierte cobranza_anular, acá no se duplica", () => {
    const movs = [mov("cobro_cliente", 50000, REF_PAGO, PAGO), mov("debito", -50000, REF_ANULACION, PAGO)]
    expect(necesitaCompensacionLegada(movs, PAGO, VIAJE, 50000)).toBe(false)
    // aunque en el mismo viaje haya un cobro viejo por el mismo monto
    expect(necesitaCompensacionLegada([...movs, mov("cobro_cliente", 50000, "viaje", VIAJE)], PAGO, VIAJE, 50000)).toBe(false)
  })

  it("idempotente: una vez compensado no se compensa de nuevo", () => {
    const movs = [mov("cobro_cliente", 50000, "viaje", VIAJE), mov("debito", -50000, REF_ANULACION, PAGO)]
    expect(necesitaCompensacionLegada(movs, PAGO, VIAJE, 50000)).toBe(false)
  })

  it("sin un cobro del viaje por ese monto no se inventa una reversa", () => {
    expect(necesitaCompensacionLegada([mov("cobro_cliente", 20000, "viaje", VIAJE)], PAGO, VIAJE, 50000)).toBe(false)
    expect(necesitaCompensacionLegada([mov("debito", -50000, "viaje", VIAJE)], PAGO, VIAJE, 50000)).toBe(false) // un gasto no es un cobro
    expect(necesitaCompensacionLegada([], PAGO, VIAJE, 50000)).toBe(false)
  })
})
