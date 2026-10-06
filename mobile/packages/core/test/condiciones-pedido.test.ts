// Reglas comerciales del 06/10/2026 (dueño): precedencia de lo "solo este pedido",
// condición por proveedor/marca que hereda, contado y mercadería por cupo,
// comisión con descuento de viajante, y la compatibilidad con la APK instalada.
import { describe, expect, it } from "vitest"
import {
  normalizarBonifPedido,
  precioArticuloParaCliente,
  resolverContadoItem,
  resolverListaSegmento,
  resolverMercaderiaItem,
  type ArticuloMotor,
  type InsumosCliente,
} from "@gm/pricing"
import { calcularBonificadosPorCupo, cantidadQueVa } from "@gm/deposito"
import { calcularComisionMonto } from "../../../../lib/comisiones/calcular"
import { compatOverridesApkVieja, esApkVendedorVieja } from "../../../../lib/vendedor/compat-apk"

const NECO = { id: "L-neco", codigo: "neco", recargo_limpieza_bazar: 20, recargo_perfumeria_negro: 10, recargo_perfumeria_blanco: 15 }
const BAHIA = { id: "L-bahia", codigo: "bahia", recargo_limpieza_bazar: 0, recargo_perfumeria_negro: 0, recargo_perfumeria_blanco: 0 }

const insumos = (extra: Partial<InsumosCliente> = {}): InsumosCliente => ({
  cliente: { lista_precio_id: "L-neco", metodo_facturacion: "Final" },
  listas: [NECO, BAHIA],
  reglas: [],
  condicionesProveedor: [],
  condicionesMarca: [],
  bonificaciones: [],
  ...extra,
})
const art = (extra: Partial<ArticuloMotor> = {}): ArticuloMotor => ({
  id: "A1", precio_compra: 0, precio_base: 1000, categoria: "LIMPIEZA",
  iva_compras: "factura", iva_ventas: "factura", descuentos: [], proveedor_id: "P1", marca_id: "M1",
  ...extra,
})

describe("lista y método: lo 'solo este pedido' gana sobre la ficha", () => {
  const cliente = { lista_precio_id: "L-neco", metodo_facturacion: "Final", metodo_perf0: "Presupuesto", lista_perf0_id: "L-bahia" }

  it("el método general del pedido le gana a la ficha por segmento", () => {
    expect(resolverListaSegmento("perf0", { metodo_facturacion_pedido: "Factura" }, cliente).metodoRaw).toBe("Factura")
    expect(resolverListaSegmento("perf0", { lista_precio_pedido_id: "L-neco" }, cliente).listaId).toBe("L-neco")
  })
  it("el override del pedido por segmento le gana al general del pedido", () => {
    expect(resolverListaSegmento("perf0", { metodo_facturacion_pedido: "Factura", metodo_perf0_pedido: "Final" }, cliente).metodoRaw).toBe("Final")
  })
  it("sin override del pedido rige la ficha por segmento, después la general", () => {
    expect(resolverListaSegmento("perf0", {}, cliente)).toEqual({ listaId: "L-bahia", metodoRaw: "Presupuesto" })
    expect(resolverListaSegmento("limpieza", {}, cliente)).toEqual({ listaId: "L-neco", metodoRaw: "Final" })
  })
})

describe("APK vendedor instalada (≤ 0.2.3): conserva la regla vieja", () => {
  it("detecta la versión", () => {
    expect(esApkVendedorVieja("0.2.3")).toBe(true)
    expect(esApkVendedorVieja("0.2.2")).toBe(true)
    expect(esApkVendedorVieja(undefined)).toBe(true)
    expect(esApkVendedorVieja("0.3.0")).toBe(false)
    expect(esApkVendedorVieja("1.0.0")).toBe(false)
  })
  it("con la compatibilidad, la ficha por segmento vuelve a ganar (igual que en el equipo)", () => {
    const cliente = { lista_precio_id: "L-neco", metodo_facturacion: "Final", metodo_perf0: "Presupuesto" }
    const ov = compatOverridesApkVieja({ metodo_facturacion_pedido: "Factura" }, cliente)
    expect(resolverListaSegmento("perf0", ov, cliente).metodoRaw).toBe("Presupuesto")
    expect(resolverListaSegmento("limpieza", ov, cliente).metodoRaw).toBe("Factura")
  })
})

describe("condición por proveedor/marca con lista o método vacío: hereda", () => {
  it("lista y método vacíos toman los del pedido / ficha (antes: sin lista y 'Final')", () => {
    const cond = { proveedor_id: "P1", lista_precio_id: null, metodo_facturacion: null, dto_general_pct: 5, dto_viajante_pct: null, dto_mercaderia_pct: null }
    const p = precioArticuloParaCliente(insumos({ cliente: { lista_precio_id: "L-neco", metodo_facturacion: "Factura" }, condicionesProveedor: [cond] }), art())
    expect(p.listaId).toBe("L-neco")
    expect(p.metodoRaw).toBe("Factura")
    expect(p.bonifGeneralPct).toBe(5)
  })
})

describe("contado como condición", () => {
  const ficha = [{ tipo: "contado", segmento: null, porcentaje: 10 }]
  it("ficha 'todos' → contado", () => {
    expect(resolverContadoItem(null, null, ficha, "limpieza")).toBe(true)
  })
  it("'solo este pedido' en 0 lo saca para ese segmento", () => {
    expect(resolverContadoItem(null, { contado: { limpieza_bazar: 0 } }, ficha, "limpieza")).toBe(false)
    expect(resolverContadoItem(null, { contado: { limpieza_bazar: 0 } }, ficha, "perf0")).toBe(true)
  })
  it("la condición por proveedor/marca manda; la lista Especial nunca va de contado", () => {
    const cond = { lista_precio_id: null, metodo_facturacion: null, dto_general_pct: null, dto_viajante_pct: null, dto_mercaderia_pct: null, contado: true }
    expect(resolverContadoItem(cond, null, [], "limpieza")).toBe(true)
    expect(resolverContadoItem({ ...cond, contado: false }, null, ficha, "limpieza")).toBe(false)
    expect(resolverContadoItem(null, null, ficha, "limpieza", true)).toBe(false)
  })
  it("el contado del pedido siempre vale 10%", () => {
    expect(normalizarBonifPedido({ contado: { perf0: 1, perf_plus: 0 } })).toEqual({ contado: { perf0: 10, perf_plus: 0 } })
  })
  it("un 0 explícito se conserva; vacío/null hereda", () => {
    expect(normalizarBonifPedido({ viajante: { limpieza_bazar: 0, perf0: null } })).toEqual({ viajante: { limpieza_bazar: 0 } })
  })
})

describe("mercadería bonificada: cupo de cada renglón", () => {
  const sin = { lista_precio_id: null, metodo_facturacion: null, dto_general_pct: null, dto_viajante_pct: null }
  it("condición por proveedor con % → cupo del proveedor", () => {
    expect(resolverMercaderiaItem({ ...sin, dto_mercaderia_pct: 5 }, "prov:P1", null, null, [], "limpieza")).toEqual({ origen: "prov:P1", pct: 5 })
  })
  it("pedido por segmento > pedido 'todo' > ficha por segmento > ficha 'todos'", () => {
    const ficha = [{ tipo: "mercaderia", segmento: "perf0", porcentaje: 4 }, { tipo: "mercaderia", segmento: null, porcentaje: 2 }]
    expect(resolverMercaderiaItem(null, null, { mercaderia: { perf0: 0 } }, 7, ficha, "perf0")).toEqual({ origen: null, pct: 0 })
    expect(resolverMercaderiaItem(null, null, null, 7, ficha, "perf0")).toEqual({ origen: "todo", pct: 7 })
    expect(resolverMercaderiaItem(null, null, null, null, ficha, "perf0")).toEqual({ origen: "seg:perf0", pct: 4 })
    expect(resolverMercaderiaItem(null, null, null, null, ficha, "limpieza")).toEqual({ origen: "todo", pct: 2 })
  })
  it("la lista Especial no bonifica", () => {
    expect(resolverMercaderiaItem(null, null, null, 10, [], "limpieza", true)).toEqual({ origen: null, pct: 0 })
  })
})

describe("mercadería bonificada: unidades por cupo sobre lo que realmente va", () => {
  const linea = (id: string, extra: Record<string, unknown>) => ({ id, cantidad: 0, cantidad_preparada: 0, precio_base: 0, es_bonificado: false, ...extra })

  it("cada cupo se calcula con su base y su %; lo preparado manda sobre lo vendido", () => {
    const lineas = [
      // cupo limpieza 10%: vendió 10 × $100, preparó 8 → base $800 → $80
      linea("a", { cantidad: 10, cantidad_preparada: 8, estado_item: "PARCIAL", precio_base: 100, bonif_merc_origen: "seg:limpieza_bazar", bonif_merc_pct: 10 }),
      // cupo marca 5%: todavía sin preparar → usa lo vendido: 20 × $50 = $1000 → $50
      linea("b", { cantidad: 20, estado_item: "PENDIENTE", precio_base: 50, bonif_merc_origen: "marca:M1", bonif_merc_pct: 5 }),
      linea("ba", { es_bonificado: true, precio_base: 20, bonif_merc_origen: "seg:limpieza_bazar" }),
      linea("bb", { es_bonificado: true, precio_base: 40, bonif_merc_origen: "marca:M1" }),
    ]
    const r = calcularBonificadosPorCupo(lineas as any)
    expect(r.calculados.find((c) => c.id === "ba")!.cantidad).toBe(4)        // 80 / 20
    expect(r.calculados.find((c) => c.id === "bb")!.cantidad).toBe(1)        // 50 / 40 = 1,25 → 1
    expect(r.pendientes).toEqual([])
  })
  it("redondeo: menos de 0,5 baja, 0,5 o más sube", () => {
    const base = (precio: number) => [
      linea("a", { cantidad: 1, precio_base: 1000, bonif_merc_origen: "todo", bonif_merc_pct: 10 }),  // $100
      linea("b", { es_bonificado: true, precio_base: precio, bonif_merc_origen: "todo" }),
    ]
    expect(calcularBonificadosPorCupo(base(40) as any).calculados[0].cantidad).toBe(3)   // 2,5 → 3
    expect(calcularBonificadosPorCupo(base(45) as any).calculados[0].cantidad).toBe(2)   // 2,22 → 2
    expect(calcularBonificadosPorCupo(base(300) as any).calculados[0].cantidad).toBe(0)  // 0,33 → 0
  })
  it("un cupo sin artículos elegidos queda pendiente", () => {
    const r = calcularBonificadosPorCupo([linea("a", { cantidad: 5, precio_base: 10, bonif_merc_origen: "seg:perf0", bonif_merc_pct: 5 })] as any)
    expect(r.pendientes).toEqual(["seg:perf0"])
  })
  it("un faltante no suma a la base", () => {
    expect(cantidadQueVa({ cantidad: 10, cantidad_preparada: 0, estado_item: "FALTANTE" })).toBe(0)
  })
})

describe("comisión con descuento de viajante (regla del dueño)", () => {
  it("20% de comisión y 5% de viajante: cobra 15% sobre el precio sin el viajante", () => {
    // Renglón: lista $100, viajante 5% → neto guardado $95
    const r = calcularComisionMonto({ precioNetoUnitario: 95, cantidad: 1, metodoFacturacion: "Factura", ivaVentas: "factura", comisionPct: 20, viajantePct: 5 })
    expect(r.tasaEfectivaPct).toBe(15)
    expect(r.monto).toBe(15)
  })
  it("con general 10%: la base es el precio después del general ($90)", () => {
    // lista 100 · general 10% → 90 · viajante 5% → 85,50 guardado
    const r = calcularComisionMonto({ precioNetoUnitario: 85.5, cantidad: 1, metodoFacturacion: "Factura", ivaVentas: "factura", comisionPct: 20, viajantePct: 5 })
    expect(r.monto).toBe(13.5)
  })
  it("si el viajante supera la comisión, la comisión es 0 (nunca negativa)", () => {
    const r = calcularComisionMonto({ precioNetoUnitario: 97, cantidad: 1, metodoFacturacion: "Factura", ivaVentas: "factura", comisionPct: 2, viajantePct: 3 })
    expect(r.tasaEfectivaPct).toBe(0)
    expect(r.monto).toBe(0)
  })
  it("mercadería regalada: su neto no tiene el viajante aplicado", () => {
    const r = calcularComisionMonto({ precioNetoUnitario: 100, cantidad: 1, metodoFacturacion: "Factura", ivaVentas: "factura", comisionPct: 6, viajantePct: 3, netoIncluyeViajante: false })
    expect(r.monto).toBe(3)
  })
})
