import { describe, expect, it } from "vitest"
import { comprobantesDeDevolucion, estadoCuentaVacio, etiquetaComprobante, resumenCuenta, type DatosCuenta } from "../../../apps/chofer/src/datos/cuenta-cobro"
import { textoReparto } from "../../../apps/chofer/src/datos/devolucion-tope"
import { datasetsViejos, MINUTOS_DATO_VIEJO } from "../../../apps/chofer/src/datos/frescura"
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

  it("lo que fue al respaldo \"sistema viejo\" o a un comprobante ya pagado no frena el descuento", () => {
    const d = cuenta(chen.cobro.comprobantes, [dev("d5", 3000, ["p28", "resp"])])
    expect(resumenCuenta(d, { ...estadoCuentaVacio(), sel: { p28: 40000 } }).devTotal).toBe(3000)
    expect(resumenCuenta(d, { ...estadoCuentaVacio(), sel: { p26: 36513.45 } }).devTotal).toBe(0)
  })

  it("la pantalla dice contra qué comprobante va", () => {
    expect(etiquetaComprobante(chen.cobro, "resp", [{ id: "resp", tipo_comprobante: "PRES", numero_comprobante: "0002-00000001" }])).toContain("sistema viejo")
    expect(etiquetaComprobante(chen.cobro, "p30", [{ id: "p30", tipo_comprobante: "PRES", numero_comprobante: "0001-00000030" }])).toBe("PRES 0001-00000030 (ya pagado)")
    expect(etiquetaComprobante(chen.cobro, "p28")).toBe("PRES 0001-00000028")
    expect(etiquetaComprobante(chen.cobro, "nada")).toBe("un comprobante ya pagado")
  })
})

describe("P2-47 / P2-32 · datos al día sin molestar", () => {
  const ahora = Date.parse("2026-10-29T14:20:00Z")
  const hace = (min: number) => ({ syncedAt: new Date(ahora - min * 60_000).toISOString() })
  it("se pide lo que tiene más de 5 minutos o nunca se bajó; lo fresco no", () => {
    expect(datasetsViejos([{ nombre: "me", meta: hace(2) }, { nombre: "billetera", meta: hace(21 * 60) }, { nombre: "viajes", meta: null }, { nombre: "x", meta: { syncedAt: null } }], ahora)).toEqual(["billetera", "viajes", "x"])
  })
  it("el cartel de desactualizado aparece recién a los 15 minutos (como la app vendedor)", () => {
    expect(MINUTOS_DATO_VIEJO).toBe(15)
  })
})

describe("P2-31 · devolución de más en un PRES: la pantalla dice cómo se repartió", () => {
  const refs = [{ id: "p27", tipo_comprobante: "PRES", numero_comprobante: "0001-00000027" }, { id: "resp", tipo_comprobante: "PRES", numero_comprobante: "0002-00000001" }]
  const art = { descripcion: "ACEITE BABY" }
  it("URQUIZA: 36 devueltas de 24 → 24 contra el PRES y 12 al sistema viejo", () => {
    const r = [{ articulo_id: "a", cantidad: 24, comprobante_venta_id: "p27", articulos: art }, { articulo_id: "a", cantidad: 12, comprobante_venta_id: "resp", articulos: art }]
    expect(textoReparto(r, refs)).toEqual(["ACEITE BABY: 24 contra el PRES 0001-00000027; 12 de más van como devolución del sistema viejo, la revisa la oficina."])
  })
  it("sin nada al respaldo, no dice nada; sin refs (réplica vieja), tampoco", () => {
    expect(textoReparto([{ articulo_id: "a", cantidad: 2, comprobante_venta_id: "p27", articulos: art }], refs)).toEqual([])
    expect(textoReparto([{ articulo_id: "a", cantidad: 12, comprobante_venta_id: "resp", articulos: art }], null)).toEqual([])
  })
  it("todo al respaldo: solo la parte de más", () => {
    expect(textoReparto([{ articulo_id: "a", cantidad: 1, comprobante_venta_id: "resp", articulos: art }], refs)).toEqual(["ACEITE BABY: 1 de más va como devolución del sistema viejo, la revisa la oficina."])
  })
})
