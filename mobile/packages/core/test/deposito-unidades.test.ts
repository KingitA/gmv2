// E-30 — bultos y unidades en la recepción: el stock sube SIEMPRE en unidades base.
// Regla pura compartida por el servidor (finalizarRecepcion), la oficina y la app.
import { describe, expect, it } from "vitest"
import { aUnidadesBase, bultosParaCubrir, cant, cantidadConUnidad, conversionLinea, desdeUnidadesBase, textoCantidad, unidadLineaOC, unidadesPorBultoDe } from "@gm/deposito"
import { vistaRecepcion } from "../../../apps/deposito/src/datos/overlay"
import type { OrdenRecepcion } from "../../../apps/deposito/src/datasets"

describe("conversión de una línea de recepción", () => {
  it("OC-000010: 2 bultos de 24 u contados como 2 ⇒ 48 unidades al stock (APK vieja, sin unidad)", () => {
    const c = conversionLinea({ enOC: true, tipoCantidadOC: "bulto", unidadesPorBulto: 24 })
    expect(c.unidadConteo).toBe("bulto")
    expect(aUnidadesBase(2, c.factorConteo)).toBe(48)
    expect(aUnidadesBase(2, c.factorOC)).toBe(48)
  })

  it("línea pedida por unidad: lo contado es lo que suma", () => {
    const c = conversionLinea({ enOC: true, tipoCantidadOC: "unidad", unidadesPorBulto: 24 })
    expect(c.factorConteo).toBe(1)
    expect(aUnidadesBase(30, c.factorConteo)).toBe(30)
  })

  it("tipo_cantidad vacío = bulto (valor por defecto de la base)", () => {
    expect(unidadLineaOC(null)).toBe("bulto")
    expect(unidadLineaOC(undefined)).toBe("bulto")
    expect(unidadLineaOC("unidad")).toBe("unidad")
  })

  it("fuera de la OC: unidades, salvo que el operario elija bultos", () => {
    expect(conversionLinea({ enOC: false, unidadesPorBulto: 12 }).factorConteo).toBe(1)
    expect(conversionLinea({ enOC: false, unidadElegida: "bulto", unidadesPorBulto: 12 }).factorConteo).toBe(12)
  })

  it("el operario cuenta unidades sueltas en una línea pedida por bulto", () => {
    const c = conversionLinea({ enOC: true, tipoCantidadOC: "bulto", unidadElegida: "unidad", unidadesPorBulto: 24 })
    expect(c.unidadOC).toBe("bulto")
    expect(c.unidadConteo).toBe("unidad")
    expect(aUnidadesBase(29, c.factorConteo)).toBe(29)
    expect(aUnidadesBase(2, c.factorOC)).toBe(48)
  })

  it("una unidad elegida inválida se ignora", () => {
    expect(conversionLinea({ enOC: true, tipoCantidadOC: "bulto", unidadElegida: "caja", unidadesPorBulto: 6 }).unidadConteo).toBe("bulto")
  })

  it("por bulto sin unidades por bulto cargadas: factor 1 y aviso", () => {
    for (const upb of [null, undefined, 0, 1, "", "x", -5]) {
      const c = conversionLinea({ enOC: true, tipoCantidadOC: "bulto", unidadesPorBulto: upb })
      expect(c.factorConteo).toBe(1)
      expect(c.sinUnidadesPorBulto).toBe(true)
    }
    expect(conversionLinea({ enOC: true, tipoCantidadOC: "unidad", unidadesPorBulto: null }).sinUnidadesPorBulto).toBe(false)
  })

  it("unidades por bulto como texto de la base ('24')", () => {
    expect(unidadesPorBultoDe("24")).toBe(24)
  })

  it("aUnidadesBase: nunca negativo ni NaN, sin basura de coma flotante", () => {
    expect(aUnidadesBase(-1, 24)).toBe(0)
    expect(aUnidadesBase("x", 24)).toBe(0)
    expect(aUnidadesBase(0.1, 3)).toBe(0.3)
    expect(aUnidadesBase(1.5, 12)).toBe(18)
    expect(aUnidadesBase(5, 0)).toBe(5)
  })

  it("ida y vuelta y bultos enteros para cubrir", () => {
    expect(desdeUnidadesBase(48, 24)).toBe(2)
    expect(bultosParaCubrir(48, 24)).toBe(2)
    expect(bultosParaCubrir(49, 24)).toBe(3)
    expect(bultosParaCubrir(1, 24)).toBe(1)
    expect(bultosParaCubrir(0, 24)).toBe(0)
    expect(bultosParaCubrir(7, null)).toBe(7)
  })

  it("textos sin ambigüedad", () => {
    expect(textoCantidad(2, "bulto", 24)).toBe("2 bultos × 24 u = 48 u")
    expect(textoCantidad(1, "bulto", 24)).toBe("1 bulto × 24 u = 24 u")
    expect(textoCantidad(48, "unidad", 24)).toBe("48 u")
    expect(textoCantidad(2, "bulto", null)).toBe("2 bultos (sin unidades por bulto cargadas)")
    expect(cantidadConUnidad(1, "bulto")).toBe("1 bulto")
    expect(cantidadConUnidad(1200, "unidad")).toBe("1.200 u")
    expect(cant(1.5)).toBe("1,5")
  })
})

describe("vistaRecepcion: unidades de cada línea", () => {
  const art = (id: string, upb: number | null) => ({ id, sku: id, descripcion: `Art ${id}`, unidades_por_bulto: upb })
  const orden = (recepcion: OrdenRecepcion["recepcion"]): OrdenRecepcion => ({
    id: "oc1", numero_orden: "OC-000010", estado: "pendiente", fecha_orden: "2026-11-13", proveedores: { id: "p", nombre: "HORNAL" },
    ordenes_compra_detalle: [
      { id: "d1", cantidad_pedida: 2, tipo_cantidad: "bulto", articulo_id: "a1", articulos: art("a1", 24) },
      { id: "d2", cantidad_pedida: 10, tipo_cantidad: "unidad", articulo_id: "a2", articulos: art("a2", 6) },
    ],
    recepcion,
  })
  const op = (payload: Record<string, unknown>) =>
    ({ idempotency_key: Math.random().toString(), tipo: "recepcion.item", payload: { orden_compra_id: "oc1", ...payload }, estado: "pendiente" }) as never

  it("sin recepción en el servidor: sale de la OC con su unidad", () => {
    const v = vistaRecepcion(orden(null), [], () => undefined)
    const [l1, l2] = v.lineas
    expect([l1.unidadOC, l1.ocUnidades, l1.unidadesPorBulto]).toEqual(["bulto", 48, 24])
    expect([l2.unidadOC, l2.ocUnidades]).toEqual(["unidad", 10])
  })

  it("conteo de la app vieja (sin unidad) sobre línea por bulto: 2 ⇒ 48 u", () => {
    const v = vistaRecepcion(orden(null), [op({ articulo_id: "a1", cantidad_fisica: 2 })], () => undefined)
    const l = v.lineas[0]
    expect([l.cantidad_fisica, l.unidadConteo, l.fisicaUnidades]).toEqual([2, "bulto", 48])
  })

  it("conteo en unidades sueltas sobre línea por bulto, y un reconteo sin unidad vuelve a bultos", () => {
    const v = vistaRecepcion(orden(null), [op({ articulo_id: "a1", cantidad_fisica: 29, unidad: "unidad" })], () => undefined)
    expect([v.lineas[0].unidadConteo, v.lineas[0].fisicaUnidades]).toEqual(["unidad", 29])
    const v2 = vistaRecepcion(orden(null), [op({ articulo_id: "a1", cantidad_fisica: 29, unidad: "unidad" }), op({ articulo_id: "a1", cantidad_fisica: 2 })], () => undefined)
    expect([v2.lineas[0].unidadConteo, v2.lineas[0].fisicaUnidades]).toEqual(["bulto", 48])
  })

  it("lo que vino del servidor con unidad_conteo se respeta", () => {
    const v = vistaRecepcion(
      orden({ id: "r1", estado: "en_proceso", numero_tanda: 1, conformidad_transporte: "conforme", recepciones_documentos: [],
        recepciones_items: [{ id: "i1", articulo_id: "a1", cantidad_oc: 2, cantidad_fisica: 30, estado_linea: "ok", unidad_conteo: "unidad" }] }),
      [], () => undefined)
    expect([v.lineas[0].unidadConteo, v.lineas[0].fisicaUnidades, v.lineas[0].ocUnidades]).toEqual(["unidad", 30, 48])
  })

  it("artículo fuera de la OC: unidades por defecto, bultos si el operario lo elige", () => {
    const cat = (id: string) => (id === "x" ? (art("x", 12) as never) : undefined)
    const v = vistaRecepcion(orden(null), [op({ articulo_id: "x", cantidad_fisica: 3 })], cat)
    const l = v.lineas.find((x) => x.articulo_id === "x")!
    expect([l.fuera_de_oc, l.unidadConteo, l.fisicaUnidades]).toEqual([true, "unidad", 3])
    const v2 = vistaRecepcion(orden(null), [op({ articulo_id: "x", cantidad_fisica: 3, unidad: "bulto" })], cat)
    expect(v2.lineas.find((x) => x.articulo_id === "x")!.fisicaUnidades).toBe(36)
  })
})
