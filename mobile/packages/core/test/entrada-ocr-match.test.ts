// Prueba en producción del 18/11 (OC-000012, HORNAL): un renglón leído que no se guardó, un
// artículo sugerido de otro proveedor y un número de comprobante con un cero de más.
import { describe, expect, it } from "vitest"
import { avisoRenglonesContraTotal, listasDeRenglones, renglonesDeLectura, renglonesSueltos } from "../../../../lib/services/lectura-renglones"
import { cuentaRenglon, faltaEnRenglon } from "../../../../lib/compras/renglon-manual"
import { codigoComparable, elegirCandidatoCompra, elegirPorCodigo, parecidoPorPalabras } from "../../../../lib/matching/compra"
import { formatearNumeroComprobante, normalizarNumeroComprobante } from "../../../../lib/services/numero-comprobante"

const ALU = { descripcion: "ROLLO ALUMINIO", codigo: "190138", cantidad: 36, precio_unitario: 761.21, descuento: 20, total_linea: 21922.85 }
const FILM = { descripcion: "ROLLO FILM", codigo: "190114", cantidad: 36, precio_unitario: 950, descuento: 20, total_linea: 27360 }

describe("ningún renglón leído se pierde en silencio", () => {
  it("lectura normal: los dos renglones, sin avisos", () => {
    const texto = JSON.stringify({ comprobante: { numero_comprobante: "0003-00045711" }, items: [ALU, FILM] })
    const r = renglonesDeLectura(texto, JSON.parse(texto).items)
    expect(r.items).toHaveLength(2)
    expect(r.avisos).toEqual([])
  })
  it("la IA repite la clave 'items': al interpretar queda solo la última lista; se juntan las dos", () => {
    const texto = `{"comprobante":{"numero_comprobante":"0003-00045711"},"items":[${JSON.stringify(ALU)}],"items":[${JSON.stringify(FILM)}]}`
    const interpretado = JSON.parse(texto)
    expect(interpretado.items).toHaveLength(1) // así se perdía el rollo aluminio
    const r = renglonesDeLectura(texto, interpretado.items)
    expect(r.items.map((i) => i.codigo).sort()).toEqual(["190114", "190138"])
    expect(r.avisos[0]).toMatch(/repartidos en más de una lista/)
  })
  it("una lista adentro del encabezado y otra afuera: también se juntan", () => {
    const texto = `{"comprobante":{"numero_comprobante":"1-1","items":[${JSON.stringify(ALU)}]},"items":[${JSON.stringify(FILM)}]}`
    const r = renglonesDeLectura(texto, JSON.parse(texto).items)
    expect(r.items).toHaveLength(2)
  })
  it("dos renglones iguales de verdad (mismo artículo dos veces) no se toman por duplicado", () => {
    const texto = JSON.stringify({ items: [ALU, ALU] })
    expect(renglonesDeLectura(texto, JSON.parse(texto).items).items).toHaveLength(2)
  })
  it("el texto menciona más renglones de los que quedaron: avisa cuántos", () => {
    const texto = `{"items":[${JSON.stringify(FILM)}], "nota": {"descripcion": "ROLLO ALUMINIO"}}`
    const r = renglonesDeLectura(texto, [FILM])
    expect(r.items).toHaveLength(1)
    expect(r.avisos[0]).toMatch(/menciona 2 renglones y se cargaron 1/)
  })
  it("corchetes y llaves adentro de un texto no confunden", () => {
    const raro = { ...ALU, descripcion: 'ROLLO "ALU" [30 cm] {x36}' }
    expect(listasDeRenglones(JSON.stringify({ items: [raro, FILM] }))[0]).toHaveLength(2)
  })
  it("nunca devuelve menos que lo interpretado", () => {
    expect(renglonesDeLectura("texto que no es JSON", [ALU, FILM]).items).toHaveLength(2)
  })
})

describe("matching de compra: el código exacto gana y el proveedor manda", () => {
  const HORNAL = "prov-hornal", YASH = "prov-yash"
  const catalogo = [
    { id: "a-hornal", sku: "190138", proveedor_id: HORNAL },
    { id: "a-yash", sku: "961950", proveedor_id: YASH },
  ]
  it("el código del renglón es el SKU del artículo del proveedor", () => {
    expect(elegirPorCodigo("190138", catalogo, HORNAL)?.id).toBe("a-hornal")
    expect(elegirPorCodigo(" 0190138 ", catalogo, HORNAL)?.id).toBe("a-hornal")
  })
  it("el mismo SKU en otro proveedor NO es coincidencia exacta", () => {
    expect(elegirPorCodigo("961950", catalogo, HORNAL)).toBeNull()
  })
  it("si está en la orden, vale aunque el artículo sea de otro proveedor", () => {
    expect(elegirPorCodigo("961950", catalogo, HORNAL, { ordenArticuloIds: ["a-yash"] })?.id).toBe("a-yash")
  })
  it("dos artículos del proveedor con el mismo código: no se adivina", () => {
    expect(elegirPorCodigo("5", [{ id: "x", sku: "5", proveedor_id: HORNAL }, { id: "y", sku: "005", proveedor_id: HORNAL }], HORNAL)).toBeNull()
  })
  it("códigos comparables", () => {
    expect(codigoComparable("00-190.138 ")).toBe("190138")
    expect(codigoComparable("ab-12")).toBe("AB12")
    expect(codigoComparable("")).toBe("")
  })
  it("por parecido: el de la orden le gana a uno de otro proveedor con más puntaje", () => {
    const r = elegirCandidatoCompra([
      { sku_id: "a-yash", score: 0.9, proveedor_id: YASH },
      { sku_id: "a-hornal", score: 0.8, proveedor_id: HORNAL },
    ], HORNAL, { ordenArticuloIds: ["a-hornal"] })!
    expect(r).toMatchObject({ otro_proveedor: false, en_orden: true })
    expect(r.candidato.sku_id).toBe("a-hornal")
  })
  it("sin orden: el del proveedor le gana al de otro", () => {
    const r = elegirCandidatoCompra([{ sku_id: "a-yash", score: 0.95, proveedor_id: YASH }, { sku_id: "a-hornal", score: 0.76, proveedor_id: HORNAL }], HORNAL)!
    expect(r.candidato.sku_id).toBe("a-hornal")
    expect(r.otro_proveedor).toBe(false)
  })
  it("solo hay de otro proveedor: último recurso, marcado", () => {
    const r = elegirCandidatoCompra([{ sku_id: "a-yash", score: 0.9, proveedor_id: YASH }], HORNAL)!
    expect(r).toMatchObject({ otro_proveedor: true, en_orden: false })
  })
  it("el del proveedor es flojo y el de otro llega a sugerencia: va el de otro, marcado", () => {
    const r = elegirCandidatoCompra([{ sku_id: "a-yash", score: 0.9, proveedor_id: YASH }, { sku_id: "a-hornal", score: 0.5, proveedor_id: HORNAL }], HORNAL)!
    expect(r.candidato.sku_id).toBe("a-yash")
    expect(r.otro_proveedor).toBe(true)
  })
  it("sin candidatos", () => expect(elegirCandidatoCompra([], HORNAL)).toBeNull())
  it("parecido por palabras", () => {
    expect(parecidoPorPalabras("ROLLO ALUMINIO", "Rollo Aluminio 30 cm")).toBeCloseTo(0.5, 6)
    expect(parecidoPorPalabras("ROLLO ALUMINIO", "ROLLO FILM")).toBeCloseTo(1 / 3, 6)
    expect(parecidoPorPalabras("", "x")).toBe(0)
  })
})

describe("número de comprobante con el formato del papel", () => {
  it("un cero de más leído por la IA: 0001-000008821 → 0001-00008821", () => {
    expect(formatearNumeroComprobante("0001-000008821")).toBe("0001-00008821")
  })
  it("sin ceros, con letra, con espacios, pegado", () => {
    expect(formatearNumeroComprobante("1-8821")).toBe("0001-00008821")
    expect(formatearNumeroComprobante("A 0003 - 00045711")).toBe("0003-00045711")
    expect(formatearNumeroComprobante("000300045711")).toBe("0003-00045711")
    expect(formatearNumeroComprobante("00012-00000007")).toBe("0012-00000007")
    expect(formatearNumeroComprobante("12345-7")).toBe("12345-00000007")
  })
  it("lo que no se reconoce queda como está", () => {
    expect(formatearNumeroComprobante("8821")).toBe("8821")
    expect(formatearNumeroComprobante("PENDIENTE-123")).toBe("PENDIENTE-123")
    expect(formatearNumeroComprobante("0001-123456789")).toBe("0001-123456789")
    expect(formatearNumeroComprobante("")).toBe("")
  })
  it("sigue siendo el mismo comprobante para detectar duplicados", () => {
    expect(normalizarNumeroComprobante(formatearNumeroComprobante("0001-000008821"))).toBe(normalizarNumeroComprobante("0001-00008821"))
  })
})

describe("renglones fuera de la lista principal y control contra el subtotal", () => {
  it("un renglón en otra lista del JSON se agrega y se avisa", () => {
    const json = { comprobante: { numero_comprobante: "1-1" }, items: [FILM], otros_items: [ALU] }
    expect(renglonesSueltos(json, json.items)).toEqual([ALU])
    const r = renglonesDeLectura(JSON.stringify(json), json.items, json)
    expect(r.items).toHaveLength(2)
    expect(r.avisos[0]).toMatch(/fuera de la lista principal/)
  })
  it("los de la lista principal no se cuentan dos veces", () => {
    const json = { items: [ALU, FILM] }
    expect(renglonesSueltos(json, json.items)).toEqual([])
  })
  it("falta un renglón: los leídos no suman el neto del comprobante", () => {
    const aviso = avisoRenglonesContraTotal([FILM], { subtotal_neto: 49282.85, total_factura: 59632.25 })
    expect(aviso).toMatch(/suman .*27\.360,00.* y el comprobante dice .*49\.282,85.* de neto/)
  })
  it("están los dos: no avisa", () => {
    expect(avisoRenglonesContraTotal([ALU, FILM], { subtotal_neto: 49282.85, total_factura: 59632.25 })).toBeNull()
  })
  it("sin importes de renglón o sin totales no se puede saber: no avisa", () => {
    expect(avisoRenglonesContraTotal([{ ...FILM, total_linea: null }], { subtotal_neto: 100 })).toBeNull()
    expect(avisoRenglonesContraTotal([FILM], {})).toBeNull()
  })
})

describe("renglón cargado a mano: se elige la unidad y se ve el importe", () => {
  // Lo que pasó el 18/11: 36 a $608,97 pensando en unidades; el sistema lo tomó en bultos de 36
  it("36 unidades a $608,97 = $21.922,92 (y son 36 unidades, no 1.296)", () => {
    const c = cuentaRenglon({ cantidad: 36, unidad: "unidad", precio_unitario: 608.97, descuentos: [] }, 36)
    expect(c).toMatchObject({ unidades: 36, importe: 21922.92 })
  })
  it("como en la factura: 36 a $761,21 de lista con 20 % = $21.922,85", () => {
    expect(cuentaRenglon({ cantidad: 36, unidad: "unidad", precio_unitario: 761.21, descuentos: [20] }, 36).importe).toBe(21922.85)
  })
  it("1 bulto de 36 a $27.403,56 con 20 %: 36 unidades, $608,968 por unidad", () => {
    const c = cuentaRenglon({ cantidad: 1, unidad: "bulto", precio_unitario: 27403.56, descuentos: [20] }, 36)
    expect(c.unidades).toBe(36)
    expect(c.importe).toBe(21922.85)
    expect(c.neto_por_unidad).toBeCloseTo(608.968, 6)
  })
  it("descuentos sobre la lista", () => {
    expect(cuentaRenglon({ cantidad: 10, unidad: "unidad", precio_unitario: 1000, descuentos: [10, 5] }, null, "sobre_lista").importe).toBe(8500)
  })
  it("lo que falta se dice", () => {
    expect(faltaEnRenglon({ cantidad: 0 }, 36)).toMatch(/cantidad/)
    expect(faltaEnRenglon({ cantidad: 1, precio_unitario: 1, descuentos: [] }, 36)).toMatch(/unidades o bultos/)
    expect(faltaEnRenglon({ cantidad: 1, unidad: "bulto", precio_unitario: 1, descuentos: [] }, 1)).toMatch(/no tiene unidades por bulto/)
    expect(faltaEnRenglon({ cantidad: 1, unidad: "unidad", precio_unitario: 1, descuentos: [120] }, 36)).toMatch(/0 a 100/)
    expect(faltaEnRenglon({ cantidad: 1, unidad: "unidad", precio_unitario: 1, descuentos: [20] }, 36)).toBeNull()
  })
})
