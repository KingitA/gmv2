// Arreglos de la revisión de la 1ª entrega de T1-B (17/11).
import { describe, expect, it } from "vitest"
import { calcularDiferencia, combinarLineasOC, cuentaSobrante, TOPE_DIFERENCIA_PESOS } from "../../../../lib/compras/diferencias"
import { armarVerificacion } from "../../../../lib/compras/verificacion"
import { faltaLaFuncion } from "../../../../lib/utils/migracion-pendiente"

describe("faltante Y diferencia de precio en el mismo artículo: no se reclama dos veces", () => {
  // pedido 200 a $100; facturado 200 a $110; llegaron 150
  const d = calcularDiferencia({
    oc: { cantidad_pedida: 200, factor: 1, precio_unitario: 100, descuentos: [] },
    factura: [{ cantidad_facturada: 200, factor: 1, precio_unitario: 110, descuentos: [], iva_porcentaje: 21 }],
    recibido_unidades: 150,
  })
  it("la diferencia de precio va sobre las 150 recibidas: $1.500", () => {
    expect(d.precio).toMatchObject({ unidades: 150, por_unidad: 10, neto: 1500 })
  })
  it("el faltante, por las 50 que no llegaron al precio facturado: $5.500", () => {
    expect(d.cantidad).toMatchObject({ tipo: "faltante", unidades: 50, neto: 5500 })
  })
  it("entre los dos, lo que de verdad se pagó de más: 200 × 110 − 150 × 100 = $7.000", () => {
    expect(d.precio!.neto + d.cantidad!.neto).toBe(200 * 110 - 150 * 100)
  })
  it("si no llegó nada, todo es faltante y no hay diferencia de precio", () => {
    const n = calcularDiferencia({
      oc: { cantidad_pedida: 10, factor: 1, precio_unitario: 100, descuentos: [] },
      factura: [{ cantidad_facturada: 10, factor: 1, precio_unitario: 110, descuentos: [], iva_porcentaje: 21 }],
      recibido_unidades: 0,
    })
    expect(n.precio).toBeNull()
    expect(n.cantidad).toMatchObject({ unidades: 10, neto: 1100 })
  })
})

describe("tolerancia de precio: 0,5 % por unidad con tope en pesos", () => {
  const caso = (unidades: number) => calcularDiferencia({
    oc: { cantidad_pedida: unidades, factor: 1, precio_unitario: 1000, descuentos: [] },
    factura: [{ cantidad_facturada: unidades, factor: 1, precio_unitario: 1004, descuentos: [], iva_porcentaje: 21 }],
    recibido_unidades: unidades,
  })
  it("0,4 % en pocas unidades: es redondeo, no se muestra", () => {
    expect(caso(10).precio).toBeNull()
  })
  it("el mismo 0,4 % en 300 unidades son $1.200: supera el tope y se muestra", () => {
    expect(TOPE_DIFERENCIA_PESOS).toBe(1000)
    expect(caso(300).precio).toMatchObject({ neto: 1200 })
  })
})

describe("el artículo en renglones con precios distintos", () => {
  it("se avisa: no hay UNA lista para copiar al artículo", () => {
    const d = calcularDiferencia({
      oc: null,
      factura: [
        { cantidad_facturada: 10, factor: 1, precio_unitario: 100, descuentos: [], iva_porcentaje: 21 },
        { cantidad_facturada: 10, factor: 1, precio_unitario: 120, descuentos: [], iva_porcentaje: 21 },
      ],
      recibido_unidades: 20,
    })
    expect(d.factura).toMatchObject({ precios_distintos: true, neto_unidad: 110 })
  })
  it("mismo precio en dos renglones, o uno bonificado: no", () => {
    const d = calcularDiferencia({
      oc: null,
      factura: [
        { cantidad_facturada: 10, factor: 1, precio_unitario: 100, descuentos: [], iva_porcentaje: 21 },
        { cantidad_facturada: 2, factor: 1, precio_unitario: 100, descuentos: [100], iva_porcentaje: 21 },
      ],
      recibido_unidades: 12,
    })
    expect(d.factura!.precios_distintos).toBe(false)
  })
})

describe("el mismo artículo en dos renglones de la orden", () => {
  it("se suman las unidades", () => {
    expect(combinarLineasOC([
      { cantidad_pedida: 2, factor: 24, precio_unitario: 100, descuentos: [10] },
      { cantidad_pedida: 12, factor: 1, precio_unitario: 100, descuentos: [10] },
    ])).toEqual({ cantidad_pedida: 60, factor: 1, precio_unitario: 100, descuentos: [10] })
    expect(combinarLineasOC([])).toBeNull()
  })
  it("la verificación muestra una sola fila con el total pedido", () => {
    const v = armarVerificacion({
      ocItems: [
        { articulo_id: "a", cantidad_pedida: 2, tipo_cantidad: "bulto", precio_unitario: 100 },
        { articulo_id: "a", cantidad_pedida: 12, tipo_cantidad: "unidad", precio_unitario: 100 },
      ],
      articulos: [{ id: "a", sku: "A", descripcion: "Art", unidades_por_bulto: 24 }],
      comprobantes: [], detalle: [], recItems: [], resoluciones: [],
    })
    expect(v.filas).toHaveLength(1)
    expect(v.filas[0]!.dif.oc!.unidades).toBe(60)
    expect(v.resumen.total_oc).toBe(6000)
  })
})

describe("faltaLaFuncion: firma distinta o caché vieja NO es 'falta la migración'", () => {
  const F = "recepcion_resolver_diferencia"
  it("PostgREST no la encuentra y no sugiere ninguna: falta la migración", () => {
    expect(faltaLaFuncion({ code: "PGRST202", message: `Could not find the function public.${F}(p_datos, p_destino) in the schema cache`, hint: null }, F)).toBe(true)
  })
  it("PostgREST sugiere ESA misma función (existe con otros parámetros): es un error, se propaga", () => {
    expect(faltaLaFuncion({ code: "PGRST202", message: `Could not find the function public.${F}(p_datos, p_destino) in the schema cache`, hint: `Perhaps you meant to call the function public.${F}` }, F)).toBe(false)
  })
  it("si sugiere OTRA función, sigue siendo que falta la nuestra", () => {
    expect(faltaLaFuncion({ code: "PGRST202", message: `Could not find the function public.${F}(p_x) in the schema cache`, hint: "Perhaps you meant to call the function public.recepcion_aplicar_stock" }, F)).toBe(true)
  })
})

describe("sobrante: llegó más mercadería que la facturada (decisión de Juan, 17/11)", () => {
  // pedido 100 a $50 neto; facturado 100 a $50; llegaron 110
  const d = calcularDiferencia({
    oc: { cantidad_pedida: 100, factor: 1, precio_unitario: 50, descuentos: [] },
    factura: [{ cantidad_facturada: 100, factor: 1, precio_unitario: 50, descuentos: [], iva_porcentaje: 21 }],
    recibido_unidades: 110,
  })
  const s = cuentaSobrante(d)!
  it("son 10 unidades de más", () => {
    expect(d.cantidad).toMatchObject({ tipo: "sobrante", unidades: 10 })
    expect(s.unidades).toBe(10)
  })
  it("se recibe y esperamos la factura: 10 u al precio neto de la orden + IVA", () => {
    expect(s.espera_factura).toEqual({ neto: 500, iva: 105, total: 605 })
  })
  it("se recibe sin cargo (bonificado): lo pagado se reparte entre las 110 ⇒ último costo $45,4545", () => {
    expect(s.ultimo_costo_bonificado).toBe(45.4545)
  })
  it("la factura vino más cara que la orden: lo esperado se valúa al precio de la ORDEN", () => {
    const x = cuentaSobrante(calcularDiferencia({
      oc: { cantidad_pedida: 100, factor: 1, precio_unitario: 50, descuentos: [] },
      factura: [{ cantidad_facturada: 100, factor: 1, precio_unitario: 60, descuentos: [], iva_porcentaje: 21 }],
      recibido_unidades: 104,
    }))!
    expect(x.espera_factura.neto).toBe(200)
  })
  it("artículo que no estaba en la orden: al precio facturado", () => {
    const x = cuentaSobrante(calcularDiferencia({ oc: null, factura: [{ cantidad_facturada: 10, factor: 1, precio_unitario: 80, descuentos: [], iva_porcentaje: 21 }], recibido_unidades: 12 }))!
    expect(x.espera_factura).toEqual({ neto: 160, iva: 33.6, total: 193.6 })
  })
  it("sin sobrante no hay cuenta", () => {
    expect(cuentaSobrante(calcularDiferencia({ oc: null, factura: [{ cantidad_facturada: 10, factor: 1, precio_unitario: 80, descuentos: [], iva_porcentaje: 21 }], recibido_unidades: 10 }))).toBeNull()
    expect(cuentaSobrante(calcularDiferencia({ oc: null, factura: [], recibido_unidades: 10 }))).toBeNull()
  })
  it("ya había unidades bonificadas en la factura: solo las cobradas cuentan como pagadas", () => {
    const x = cuentaSobrante(calcularDiferencia({
      oc: null,
      factura: [
        { cantidad_facturada: 10, factor: 1, precio_unitario: 100, descuentos: [], iva_porcentaje: 21 },
        { cantidad_facturada: 2, factor: 1, precio_unitario: 100, descuentos: [100], iva_porcentaje: 21 },
      ],
      recibido_unidades: 20,
    }))!
    expect(x.unidades).toBe(8)
    expect(x.ultimo_costo_bonificado).toBe(50) // $1.000 pagados ÷ 20 recibidas
  })
})

describe("las notas de débito esperadas no se mezclan con las de crédito", () => {
  it("la verificación las informa aparte y ninguna cambia el total facturado", () => {
    const v = armarVerificacion({
      ocItems: [], articulos: [], detalle: [], recItems: [], resoluciones: [],
      comprobantes: [
        { id: "fa", tipo_comprobante: "FA", numero_comprobante: "1-1", estado: "validado", total_factura_declarado: 1000 },
        { id: "nc", tipo_comprobante: "NC", numero_comprobante: "ESPERADA-1", estado: "esperada", total_factura_declarado: 100 },
        { id: "nd", tipo_comprobante: "ND", numero_comprobante: "ESPERADA-2", estado: "esperada", total_factura_declarado: 605 },
      ],
    })
    expect(v.resumen).toMatchObject({ total_facturado: 1000, nc_esperadas: 100, nd_esperadas: 605 })
  })
})
