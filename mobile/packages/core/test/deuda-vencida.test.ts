import { describe, expect, it } from "vitest"
import { repartirVencimientos } from "../../../../lib/cuenta-corriente/vencimientos"

// Condiciones de pago, fase 3: deuda vencida / a vencer (misma regla que cc_deuda_vencimiento).
const d = (id: string, fecha: string, venc: string | null, saldo: number) => ({ id, fecha, fecha_vencimiento: venc, saldo_pendiente: saldo })
const HOY = "2026-11-19"

describe("deuda vencida / a vencer", () => {
  it("cuenta corriente a 30 días: lo vencido antes de hoy, el resto a vencer", () => {
    const r = repartirVencimientos(300, [d("a", "2026-10-01", "2026-10-31", 100), d("b", "2026-11-10", "2026-12-10", 200)], HOY)
    expect(r).toMatchObject({ vencida: 100, a_vencer: 200, vencimiento_mas_viejo: "2026-10-31", proximo_vencimiento: "2026-12-10" })
  })

  it("sin fecha_vencimiento (antes de la fase 2): vence en su fecha; hoy no está vencido", () => {
    expect(repartirVencimientos(150, [d("a", "2026-11-01", null, 50), d("b", HOY, null, 100)], HOY)).toMatchObject({ vencida: 50, a_vencer: 100 })
  })

  it("crédito o pago a cuenta sin imputar: se come lo más viejo y vencida + a vencer = saldo", () => {
    // Débitos 300, saldo del libro 220 (80 a favor sin imputar)
    const r = repartirVencimientos(220, [d("a", "2026-10-01", "2026-10-31", 100), d("b", "2026-11-10", "2026-12-10", 200)], HOY)
    expect(r).toMatchObject({ vencida: 20, a_vencer: 200 })
    expect(r.vencida + r.a_vencer).toBe(220)
  })

  it("deuda sin comprobante (ajuste de la apertura) es exigible: vencida", () => {
    expect(repartirVencimientos(350, [d("a", "2026-11-10", "2026-12-10", 200)], HOY)).toMatchObject({ vencida: 150, a_vencer: 200 })
  })

  it("saldo al día o a favor: 0 y 0", () => {
    expect(repartirVencimientos(0, [], HOY)).toMatchObject({ vencida: 0, a_vencer: 0 })
    expect(repartirVencimientos(-500, [d("a", "2026-10-01", null, 100)], HOY)).toMatchObject({ vencida: 0, a_vencer: 0 })
  })

  it("suma exacta al centavo", () => {
    const r = repartirVencimientos(1000.01, [d("a", "2026-10-01", null, 333.33), d("b", "2026-11-01", "2026-12-01", 333.34), d("c", "2026-11-02", "2026-12-02", 333.34)], HOY)
    expect(Math.round((r.vencida + r.a_vencer) * 100)).toBe(100001)
  })
})
