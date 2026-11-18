// Verificación de una orden de compra: pedido / recibido / facturado (T1-B).
import { describe, expect, it } from "vitest"
import { armarVerificacion, type DatosVerificacion } from "../../../../lib/compras/verificacion"

const base = (): DatosVerificacion => ({
  ocItems: [
    { articulo_id: "a", cantidad_pedida: 4, tipo_cantidad: "bulto", precio_unitario: 100, descuento1: 0 },
    { articulo_id: "b", cantidad_pedida: 48, tipo_cantidad: "unidad", precio_unitario: 1768.81, descuento1: 20 },
  ],
  articulos: [
    { id: "a", sku: "A", descripcion: "Art A", unidades_por_bulto: 24 },
    { id: "b", sku: "B", descripcion: "Art B", unidades_por_bulto: 12 },
    { id: "x", sku: "X", descripcion: "No pedido", unidades_por_bulto: 1 },
  ],
  comprobantes: [],
  detalle: [],
  recItems: [],
  resoluciones: [],
})
const rec = (id: string, articulo_id: string, unidades: number, extra: Record<string, unknown> = {}) =>
  ({ id, recepcion_id: "r1", articulo_id, cantidad_fisica: unidades, unidades, ...extra })
const fa = (estado = "pendiente_recepcion") => ({ id: "fa", tipo_comprobante: "FA", numero_comprobante: "0003-00045678", estado, total_factura_declarado: 121000 })
const ren = (id: string, articulo_id: string | null, cantidad: number, precio: number, extra: Record<string, unknown> = {}) =>
  ({ id, comprobante_id: "fa", articulo_id, cantidad_facturada: cantidad, precio_unitario: precio, tipo_cantidad: "unidad", iva_porcentaje: 21, ...extra })

describe("E-92: un faltante no es OK", () => {
  it("pedido 4 bultos (96 u), recibido y facturado 3 (72 u): 'Falta recibir 24', cuenta como diferencia", () => {
    const d = base()
    d.comprobantes = [fa()]
    d.detalle = [ren("1", "a", 3, 2400, { tipo_cantidad: "bulto" }), ren("2", "b", 48, 1768.81, { descuento1: 20 })]
    d.recItems = [rec("i1", "a", 72), rec("i2", "b", 48)]
    const v = armarVerificacion(d)
    const a = v.filas.find((f) => f.articulo_id === "a")!
    expect(a.banderas).toEqual(["pendiente"])
    expect(a.dif.pendiente_oc).toBe(24)
    expect(v.resumen).toMatchObject({ articulos: 2, ok: 1, con_diferencias: 1 })
  })
  it("nada recibido ni facturado: falta recibir todo", () => {
    const v = armarVerificacion(base())
    expect(v.filas.map((f) => f.banderas)).toEqual([["pendiente"], ["pendiente"]])
    expect(v.resumen.ok).toBe(0)
  })
})

describe("diferencias de precio y cantidad", () => {
  it("caso real: precio 1.450,00 facturado contra 1.415,05 pedido", () => {
    const d = base()
    d.comprobantes = [fa()]
    d.detalle = [ren("2", "b", 48, 1812.5, { descuento1: 20 })]
    d.recItems = [rec("i2", "b", 48)]
    const b = armarVerificacion(d).filas.find((f) => f.articulo_id === "b")!
    expect(b.banderas).toEqual(["precio"])
    expect(b.dif.precio).toMatchObject({ neto: 1677.7, total: 2030.02 })
    expect(b.por_comprobante.fa).toEqual({ unidades: 48, neto_unidad: 1450 })
    expect(b.recepcion_item_id).toBe("i2")
  })
  it("resuelta (tabla de resoluciones o marca vieja de la línea): deja de ser diferencia", () => {
    const d = base()
    d.comprobantes = [fa()]
    d.detalle = [ren("2", "b", 48, 1812.5, { descuento1: 20 })]
    d.recItems = [rec("i2", "b", 48)]
    d.resoluciones = [{ recepcion_item_id: "i2", articulo_id: "b", tipo: "precio", destino: "proveedor" }]
    expect(armarVerificacion(d).filas.find((f) => f.articulo_id === "b")!.banderas).toEqual([])
    d.resoluciones = []
    d.recItems = [rec("i2", "b", 48, { precio_verificado: true })]
    const b = armarVerificacion(d).filas.find((f) => f.articulo_id === "b")!
    expect(b.banderas).toEqual([])
    expect(b.resuelto.precio).toBe("resuelto")
  })
  it("E-42 bonificados: 48 cobradas + 12 sin cargo no es diferencia de precio; si llegaron las 60, tampoco de cantidad", () => {
    const d = base()
    d.ocItems[1]!.cantidad_pedida = 60
    d.comprobantes = [fa()]
    d.detalle = [ren("2", "b", 48, 1768.81, { descuento1: 20 }), ren("3", "b", 12, 1768.81, { descuento1: 100 })]
    d.recItems = [rec("i2", "b", 60)]
    const b = armarVerificacion(d).filas.find((f) => f.articulo_id === "b")!
    expect(b.banderas).toEqual([])
    expect(b.dif.factura).toMatchObject({ unidades: 60, bonificadas: 12 })
  })
  it("faltante facturado: 'cantidad', no 'pendiente'", () => {
    const d = base()
    d.comprobantes = [fa()]
    d.detalle = [ren("2", "b", 48, 1768.81, { descuento1: 20 })]
    d.recItems = [rec("i2", "b", 40)]
    expect(armarVerificacion(d).filas.find((f) => f.articulo_id === "b")!.banderas).toEqual(["cantidad"])
  })
  it("recibido y ningún comprobante lo trae (habiendo comprobantes con renglones): sin documentar", () => {
    const d = base()
    d.comprobantes = [fa()]
    d.detalle = [ren("1", "a", 4, 2400, { tipo_cantidad: "bulto" })]
    d.recItems = [rec("i1", "a", 96), rec("i2", "b", 48)]
    expect(armarVerificacion(d).filas.find((f) => f.articulo_id === "b")!.banderas).toEqual(["sin_documentar"])
  })
})

describe("E-43 no pedido", () => {
  it("llegó algo que la orden no pedía: fila 'no pedido' hasta aceptarlo o devolverlo", () => {
    const d = base()
    d.recItems = [rec("ix", "x", 5, { fuera_de_oc: true })]
    const v = armarVerificacion(d)
    const x = v.filas.find((f) => f.articulo_id === "x")!
    expect(x.no_pedido).toBe(true)
    expect(x.banderas).toEqual(["no_pedido"])
    d.recItems = [rec("ix", "x", 5, { fuera_de_oc: true, cantidad_diferencia_destino: "empresa" })]
    expect(armarVerificacion(d).filas.find((f) => f.articulo_id === "x")!.banderas).toEqual([])
  })
  it("una fila fuera_de_oc de un artículo que SÍ está en la orden no duplica lo recibido", () => {
    const d = base()
    d.recItems = [rec("i2", "b", 48), rec("i2b", "b", 48, { fuera_de_oc: true })]
    expect(armarVerificacion(d).filas.find((f) => f.articulo_id === "b")!.dif.recibido_unidades).toBe(48)
  })
})

describe("E-97 encabezados, totales y avisos", () => {
  it("las NC esperadas no son columnas y se informan aparte; el total facturado no las resta", () => {
    const d = base()
    d.comprobantes = [fa("validado"), { id: "nc", tipo_comprobante: "NC", numero_comprobante: "ESPERADA-261117101500123", estado: "esperada", total_factura_declarado: 2029.9 }]
    d.detalle = [ren("2", "b", 48, 1812.5, { descuento1: 20 })]
    const v = armarVerificacion(d)
    expect(v.columnas.map((c) => c.id)).toEqual(["fa"])
    expect(v.resumen.total_facturado).toBe(121000)
    expect(v.resumen.nc_esperadas).toBe(2029.9)
  })
  it("una NC real sí resta, con su total (con IVA); el remito no suma", () => {
    const d = base()
    d.comprobantes = [fa("validado"), { id: "nc", tipo_comprobante: "NCA", numero_comprobante: "0001-00000009", estado: "validado", total_factura_declarado: 1000 }, { id: "re", tipo_comprobante: "Remito", numero_comprobante: "R-1", estado: "pendiente_recepcion", total_factura_declarado: 0 }]
    expect(armarVerificacion(d).resumen.total_facturado).toBe(120000)
  })
  it("total de la orden igual que al crearla: netos sin redondear, redondeo al final", () => {
    const d = base()
    // 4 bultos × 24 × 100 + 48 × 1768,81 × 0,8 = 9.600 + 67.922,304
    expect(armarVerificacion(d).resumen.total_oc).toBe(77522.3)
  })
  it("sin comprobantes no queda ningún 'renglón sin vincular' colgado; el flete marcado no cuenta y se lista aparte", () => {
    const d = base()
    expect(armarVerificacion(d).resumen.sin_vincular).toBe(0)
    d.comprobantes = [fa()]
    d.detalle = [ren("9", null, 1, 3000, { match_estado: "no_mercaderia", descripcion_proveedor: "Flete" }), ren("8", null, 1, 50, { match_estado: "sin_match" })]
    const v = armarVerificacion(d)
    expect(v.resumen.sin_vincular).toBe(1)
    expect(v.otros_conceptos).toEqual([{ comprobante: "FA 0003-00045678", descripcion: "Flete", importe: 3000 }])
    // el renglón de un comprobante que ya no existe no cuenta
    d.comprobantes = []
    expect(armarVerificacion(d).resumen.sin_vincular).toBe(0)
  })
  it("el remito es una columna de cantidades, sin precio", () => {
    const d = base()
    d.comprobantes = [{ id: "fa", tipo_comprobante: "Remito", numero_comprobante: "R-1", estado: "pendiente_recepcion" }]
    d.detalle = [ren("1", "a", 4, 0, { tipo_cantidad: "bulto" })]
    d.recItems = [rec("i1", "a", 96)]
    const v = armarVerificacion(d)
    expect(v.columnas[0]).toMatchObject({ es_remito: true, con_precios: false })
    const a = v.filas.find((f) => f.articulo_id === "a")!
    expect(a.por_comprobante.fa!.unidades).toBe(96)
    expect(a.dif.factura).toBeNull() // el remito no es factura: no hay diferencia de precio ni reclamo
    expect(a.banderas).toEqual([])
  })
})

describe("cableado con la orden de compra: el total de la orden", async () => {
  const { armarVerificacion: armar } = await import("../../../../lib/compras/verificacion")
  const base = {
    ocItems: [{ articulo_id: "a", cantidad_pedida: 600, tipo_cantidad: "unidad", precio_unitario: 1572.276, descuento1: 10 }],
    articulos: [{ id: "a", sku: "A", descripcion: "Art", unidades_por_bulto: 1 }],
    comprobantes: [], detalle: [], recItems: [], resoluciones: [],
  }
  it("usa el total que la orden tiene guardado", () => {
    expect(armar({ ...base, total_oc_guardado: 849029.04 }).resumen.total_oc).toBe(849029.04)
  })
  it("sin total guardado: la misma cuenta que la orden (neto sin redondear por unidades, a centavos)", () => {
    expect(armar(base).resumen.total_oc).toBe(849029.04)
  })
  it("con descuentos sobre la lista", () => {
    const v = armar({ ...base, tipo_descuento: "sobre_lista", ocItems: [{ articulo_id: "a", cantidad_pedida: 10, tipo_cantidad: "unidad", precio_unitario: 1000, descuento1: 10, descuento2: 5 }] })
    expect(v.resumen.total_oc).toBe(8500)
  })
})

describe("una sola función de neto de compra", async () => {
  const dif = await import("../../../../lib/compras/diferencias")
  const neto = await import("../../../../lib/compras/neto-compra")
  it("la de diferencias ES la de neto-compra", () => {
    expect(dif.netoCompra).toBe(neto.netoCompra)
    expect(dif.tipoDescuentoDe).toBe(neto.tipoDescuentoDe)
  })
})
