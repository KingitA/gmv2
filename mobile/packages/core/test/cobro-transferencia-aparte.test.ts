import { describe, expect, it } from "vitest"
import { crearCobranza, esDetalleDigital } from "../../../../lib/cobranzas/crear"

// Regla del dueño (26/10, prueba de salida #35): las transferencias no pasan por
// la rendición. Un cobro de la calle con efectivo + transferencia se parte en dos
// pagos: el físico (pendiente_rendicion) y el digital (pendiente, a confirmar en /caja).

function fakeSupabase() {
  const llamadas: any[] = []
  return {
    llamadas,
    rpc: async (_fn: string, args: any) => {
      llamadas.push(args.p_payload)
      return { data: { pago_id: `pago-${llamadas.length}`, dedup: false }, error: null }
    },
  } as any
}

const base = {
  idempotency_key: "0f8c2d3e-1111-4222-8333-944455556666",
  cliente_id: "cli",
  cobrador_tipo: "viajante",
  creado_por: "u",
}

describe("cobro de la calle con transferencia", () => {
  it("URQUIZA: $1.000.000 efectivo + $784.600 transferencia → dos pagos, imputaciones repartidas", async () => {
    const sb = fakeSupabase()
    const r = await crearCobranza(sb, {
      ...base,
      monto: 1784600,
      estado: "pendiente_rendicion",
      observaciones: "[10% CONTADO] · [CREDITOS:[]]",
      detalles: [
        { tipo_pago: "efectivo", monto: 1000000 },
        { tipo_pago: "transferencia", monto: 784600 },
      ],
      imputaciones: [
        { comprobante_id: "pres-19", monto_imputado: 500000 },
        { comprobante_id: "pres-20", monto_imputado: 1284600 },
      ],
    })
    expect(r.partes.map((p) => [p.estado, p.monto, p.digital])).toEqual([
      ["pendiente_rendicion", 1000000, false],
      ["pendiente", 784600, true],
    ])
    expect(r.pago_id).toBe("pago-1") // la parte física: billetera, fotos, devoluciones
    const [fisico, digital] = sb.llamadas
    expect(digital.imputaciones).toEqual([
      { comprobante_id: "pres-19", monto_imputado: 500000 },
      { comprobante_id: "pres-20", monto_imputado: 284600 },
    ])
    expect(fisico.imputaciones).toEqual([{ comprobante_id: "pres-20", monto_imputado: 1000000 }])
    // Las marcas de la confirmación van con la parte física; el contado, con las dos
    expect(fisico.observaciones).toContain("[CREDITOS:")
    expect(digital.observaciones).toContain("[10% CONTADO]")
    expect(digital.observaciones).not.toContain("[CREDITOS:")
    // R6 (27/10): las dos partes llevan la MISMA marca de par; el 10 % sale cuando se confirman las dos
    const par = String(fisico.observaciones).match(/\[CONTADO_PAR:([0-9a-f-]{36})\]/)?.[1]
    expect(par).toBeTruthy()
    expect(digital.observaciones).toContain(`[CONTADO_PAR:${par}]`)
    // Idempotencia: la parte digital tiene su propia clave, estable
    expect(digital.idempotency_key).not.toBe(base.idempotency_key)
    expect(digital.idempotency_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it("solo transferencia → un pago 'pendiente' (no va a la rendición)", async () => {
    const sb = fakeSupabase()
    const r = await crearCobranza(sb, { ...base, monto: 50000, estado: "pendiente_rendicion", detalles: [{ tipo_pago: "transferencia", monto: 50000 }] })
    expect(r.partes).toHaveLength(1)
    expect(sb.llamadas[0].estado).toBe("pendiente")
    expect(r.partes[0].digital).toBe(true)
  })

  it("solo efectivo y cheque papel, o cobro de oficina: no se parte", async () => {
    const sb = fakeSupabase()
    await crearCobranza(sb, { ...base, monto: 300, estado: "pendiente_rendicion", detalles: [{ tipo_pago: "efectivo", monto: 100 }, { tipo_pago: "cheque", monto: 200 }] })
    await crearCobranza(sb, { ...base, monto: 300, estado: "pendiente", detalles: [{ tipo_pago: "efectivo", monto: 100 }, { tipo_pago: "transferencia", monto: 200 }] })
    expect(sb.llamadas.map((l: any) => l.estado)).toEqual(["pendiente_rendicion", "pendiente"])
    expect(esDetalleDigital({ tipo_pago: "cheque", color_cheque: "ECHEQ" })).toBe(true)
    expect(esDetalleDigital({ tipo_pago: "cheque", color_cheque: "BLANCO" })).toBe(false)
  })
})
