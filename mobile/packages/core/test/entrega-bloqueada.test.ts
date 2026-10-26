import { describe, expect, it } from "vitest"
import { cierreDeParadaPorCobro, cobroCumple, CODIGO_ENTREGA_BLOQUEADA, TEXTO_ENTREGA_BLOQUEADA } from "@gm/cobro"

// Prueba integral de salida (25/10/2026):
//  #23 FITTERER tenía "NO ENTREGAR SIN COBRAR" y "cobrar sí o sí $3.784.286": se marcó entregado
//      sin cobrar. Regla de Juan: bloqueada y sin cumplir ⇒ no se cierra como entregada.
//  #27 CHEN: "Cobró $100.000 de $154.329,05 exigidos" cuando con devoluciones y 10 % contado
//      había sobrado plata. Lo exigido es neto y el 10 % / ajuste cubren.

const base = { estado: "pendiente", bultos: 4, tienePedidos: true }

describe("#23 entrega bloqueada", () => {
  it("bloqueada y sin cumplir: cobrar NO cierra la parada", () => {
    expect(cierreDeParadaPorCobro({ ...base, minimoExigido: 3_784_286, cobrado: 20_000, bloqueada: true })).toBeNull()
  })
  it("bloqueada y cumplida: cierra como entregado sin motivo", () => {
    expect(cierreDeParadaPorCobro({ ...base, minimoExigido: 100_000, cobrado: 100_000, bloqueada: true })).toEqual({
      estado: "entregado", bultos_entregados: 4, motivo_no_cobro: null,
    })
  })
  it("sin bloqueo y sin cumplir: cierra igual y deja constancia (como antes)", () => {
    const c = cierreDeParadaPorCobro({ ...base, minimoExigido: 100_000, cobrado: 60_000 })
    expect(c?.estado).toBe("entregado")
    expect(c?.motivo_no_cobro).toContain("$60.000,00 de $100.000,00")
  })
  it("APK vieja (sin `bloqueada`): mismo comportamiento de antes", () => {
    expect(cierreDeParadaPorCobro({ ...base, minimoExigido: 100_000, cobrado: 0 })?.estado).toBe("entregado")
  })
  it("texto y código acordados con la app", () => {
    expect(TEXTO_ENTREGA_BLOQUEADA).toBe("Si no salda lo solicitado, retirar el pedido")
    expect(CODIGO_ENTREGA_BLOQUEADA).toBe("ENTREGA_BLOQUEADA")
  })
})

describe("#27 lo exigido neto: el 10 % contado y el ajuste también cubren", () => {
  // PRES $100.000, devolución $10.000 ⇒ exigido neto $90.000; cobra contado: $81.000 + 10 % $9.000
  it("contado: plata + 10 % llega a lo exigido neto", () => {
    expect(cobroCumple({ minimoExigido: 90_000, cobrado: 81_000, descuentos: 9_000 })).toBe(true)
    expect(cierreDeParadaPorCobro({ ...base, minimoExigido: 90_000, cobrado: 81_000, descuentos: 9_000, bloqueada: true })?.motivo_no_cobro).toBeNull()
  })
  it("si falta, el texto muestra el 10 % aparte", () => {
    const c = cierreDeParadaPorCobro({ ...base, minimoExigido: 90_000, cobrado: 70_000, descuentos: 9_000 })
    expect(c?.motivo_no_cobro).toBe("Cobró $70.000,00 (+ $9.000,00 de 10 % contado / ajuste) de $90.000,00 exigidos (parada cerrada al registrar el cobro)")
  })
  it("nada exigido: siempre cumple", () => {
    expect(cobroCumple({ minimoExigido: 0, cobrado: 0 })).toBe(true)
  })
})
