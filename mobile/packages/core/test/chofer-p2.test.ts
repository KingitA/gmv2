import { describe, expect, it } from "vitest"
import { comprobantesDeDevolucion, estadoCuentaVacio, etiquetaComprobante, resumenCuenta, type DatosCuenta } from "../../../apps/chofer/src/datos/cuenta-cobro"
import type { ComprobanteCobro } from "../../../apps/chofer/src/datasets"

// App Chofer — segunda prueba integral de salida (28-29/10/2026, docs/PENDIENTES-APPS-SALIDA.md,
// sección "Segunda prueba integral (28/10) — App Chofer").

const comp = (id: string, numero: string, total: number, extra: Partial<ComprobanteCobro> = {}): ComprobanteCobro => ({
  id, tipo_comprobante: "PRES", numero_comprobante: numero, fecha: "2026-10-28", total_neto: total, total_factura: total, saldo_pendiente: total, estado_pago: "pendiente", pedido_id: null, ...extra,
})
const dev = (id: string, valor: number, compIds: Array<string | null>) => ({
  id, numero_devolucion: "DEV-00001", monto_total: valor, valor_cobro: valor, aplica_10: false, estado: "pendiente",
  devoluciones_detalle: compIds.map((c) => ({ cantidad: 1, precio_venta_original: valor / compIds.length, comprobante_venta_id: c })),
})
const cuenta = (comps: ComprobanteCobro[], devs: DatosCuenta["devoluciones"]): DatosCuenta => ({ cobro: { comprobantes: comps, pedidos: [], pedidos_facturados: [], dtos_hechos: [] }, devoluciones: devs })

describe("P2-29 · la devolución resta solo del comprobante al que pertenece", () => {
  // CHEN: PRES 0026 $36.513,45 y PRES 0028; la devolución de $8.105,08 es del 0028
  const chen = cuenta([comp("p26", "0001-00000026", 36513.45), comp("p28", "0001-00000028", 40000)], [dev("d1", 8105.08, ["p28"])])

  it("cobrando SOLO el 0026, la devolución del 0028 no resta (antes pedía $28.408,37)", () => {
    const r = resumenCuenta(chen, { ...estadoCuentaVacio(), sel: { p26: 36513.45 } })
    expect(r.devTotal).toBe(0)
    expect(r.totalCobro).toBe(36513.45)
    expect(r.devolucion_ids).toEqual([])
    expect(r.devNoAplicadas).toBe(1)
  })

  it("cobrando el 0028, resta", () => {
    const r = resumenCuenta(chen, { ...estadoCuentaVacio(), sel: { p28: 40000 } })
    expect(r.devTotal).toBe(8105.08)
    expect(r.totalCobro).toBe(31894.92)
    expect(r.devolucion_ids).toEqual(["d1"])
  })

  it("una devolución contra dos comprobantes resta solo si se cobran los dos", () => {
    const d = cuenta(chen.cobro.comprobantes, [dev("d2", 1000, ["p26", "p28"])])
    expect(resumenCuenta(d, { ...estadoCuentaVacio(), sel: { p26: 36513.45 } }).devTotal).toBe(0)
    expect(resumenCuenta(d, { ...estadoCuentaVacio(), sel: { p26: 36513.45, p28: 40000 } }).devTotal).toBe(1000)
  })

  it("sin origen por renglón (réplica vieja), resta como antes", () => {
    const d = cuenta(chen.cobro.comprobantes, [dev("d3", 500, [null])])
    expect(comprobantesDeDevolucion(d.devoluciones[0]!)).toEqual([])
    expect(resumenCuenta(d, { ...estadoCuentaVacio(), sel: { p26: 36513.45 } }).devTotal).toBe(500)
  })

  it("los renglones rechazados no cuentan como origen", () => {
    const d = dev("d4", 1000, ["p28"])
    d.devoluciones_detalle.push({ cantidad: 1, precio_venta_original: 1, comprobante_venta_id: "p26", estado_renglon: "rechazado" } as never)
    expect(comprobantesDeDevolucion(d)).toEqual(["p28"])
  })

  it("la pantalla dice contra qué comprobante va", () => {
    expect(etiquetaComprobante(chen.cobro, "p28")).toBe("PRES 0001-00000028")
    expect(etiquetaComprobante(chen.cobro, "nada")).toBe("un comprobante ya pagado")
  })
})
