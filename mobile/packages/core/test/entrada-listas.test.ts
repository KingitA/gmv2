// Tanda 2-C — listas de precios de proveedor (E-20, E-22): vista previa, descuento 0, alertas y
// aviso de precio de venta.
import { describe, expect, it } from "vitest"
import { avisoPrecioVenta, cambioDeItem, descuentosDeLectura, esVigenciaFutura, filasDeListaExcel, precioBaseDesdeCosto, precioPorEnTitulos, TOPE_CAMBIO_PCT, valorDeCelda } from "../../../../lib/compras/lista-proveedor"

describe("celdas del archivo: vacío no es cero", () => {
  it("vacío = no tocar (null); 0 = cero", () => {
    expect(valorDeCelda("")).toBeNull()
    expect(valorDeCelda(null)).toBeNull()
    expect(valorDeCelda(undefined)).toBeNull()
    expect(valorDeCelda("  ")).toBeNull()
    expect(valorDeCelda(0)).toBe(0)
    expect(valorDeCelda("0")).toBe(0)
  })
  it("formato argentino y con signo", () => {
    expect(valorDeCelda("1.234,56")).toBe(1234.56)
    expect(valorDeCelda("$ 761,21")).toBe(761.21)
    expect(valorDeCelda("20 %")).toBe(20)
    expect(valorDeCelda(1234.5)).toBe(1234.5)
    expect(valorDeCelda("1234.56")).toBe(1234.56)
    expect(valorDeCelda("texto")).toBeNull()
  })
})

describe("qué cambia en el artículo al aplicar un renglón", () => {
  const art = { precio_compra: 1000, descuento1: 20, descuento2: 5, descuento3: 0, descuento4: 0 }
  it("precio nuevo, descuentos vacíos: los descuentos no se tocan", () => {
    const c = cambioDeItem({ precio_compra: 1100 }, art)
    expect(c.cambios).toEqual({ precio_compra: 1100 })
    expect(c.nuevo.descuentos).toEqual([20, 5, 0, 0])
    expect(c.actual.neto).toBe(760)
    expect(c.nuevo.neto).toBe(836)
    expect(c.variacion_pct).toBe(10)
    expect(c.alerta).toBeNull()
  })
  it("descuento 0 en el archivo: el descuento pasa a 0 (antes se ignoraba)", () => {
    const c = cambioDeItem({ precio_compra: null, descuento1: 0 }, art)
    expect(c.cambios).toEqual({ descuento1: 0 })
    expect(c.nuevo.neto).toBe(950)
    expect(c.variacion_pct).toBe(25)
    expect(c.alerta).toBe("suba")
  })
  it("baja grande: alerta; el umbral se puede cambiar", () => {
    expect(cambioDeItem({ precio_compra: 800 }, art).alerta).toBe("baja")
    expect(cambioDeItem({ precio_compra: 1100 }, art, "cascada", 5).alerta).toBe("suba")
    expect(cambioDeItem({ precio_compra: 1100 }, art, "cascada", 0).alerta).toBeNull() // umbral inválido = 15 %
  })
  it("descuentos sobre la lista (ficha del proveedor)", () => {
    const c = cambioDeItem({ precio_compra: 1000 }, art, "sobre_lista")
    expect(c.actual.neto).toBe(750)
  })
  it("igual a lo que ya tiene: nada para escribir", () => {
    const c = cambioDeItem({ precio_compra: 1000, descuento1: 20 }, art)
    expect(c.cambios).toEqual({})
    expect(c.variacion_pct).toBe(0)
  })
  it("renglón sin precio ni descuentos: vacío", () => {
    expect(cambioDeItem({ precio_compra: 0 }, art).vacio).toBe(true)
    expect(cambioDeItem({ descuento2: 0 }, art).vacio).toBe(false)
  })
  it("artículo sin costo cargado: no hay % de cambio ni alerta", () => {
    const c = cambioDeItem({ precio_compra: 500 }, { precio_compra: 0 })
    expect(c.variacion_pct).toBeNull()
    expect(c.alerta).toBeNull()
    expect(c.cambios).toEqual({ precio_compra: 500 })
  })
})

describe("aviso de precio de venta (no se toca: solo se avisa)", () => {
  it("con precio base guardado: queda desactualizado, y se dice cuánto", () => {
    const a = avisoPrecioVenta({ precio_base: 1140, porcentaje_ganancia: 50 }, 760, 836)
    expect(a).toEqual({ tipo: "desactualizado", precio_base_guardado: 1140, precio_base_segun_costo: 1254, diferencia_pct: 10 })
  })
  it("sin precio base guardado: el precio de venta cambia solo con el costo", () => {
    const a = avisoPrecioVenta({ precio_base: null, porcentaje_ganancia: 50 }, 760, 836)
    expect(a).toMatchObject({ tipo: "cambia_solo", precio_base_segun_costo: 1254 })
  })
  it("el costo no cambia, o el guardado ya acompaña (menos de 1 %): no hay aviso", () => {
    expect(avisoPrecioVenta({ precio_base: 1140, porcentaje_ganancia: 50 }, 760, 760)).toBeNull()
    expect(avisoPrecioVenta({ precio_base: 1250, porcentaje_ganancia: 50 }, 760, 836)).toBeNull()
  })
  it("margen y bonificación / recargo de la ficha", () => {
    expect(precioBaseDesdeCosto(100, { porcentaje_ganancia: 40, bonif_recargo: -10 })).toBe(126)
    expect(precioBaseDesdeCosto(100, {})).toBe(100)
  })
})

describe("lectura de una lista en Excel", () => {
  it("reconoce títulos, hasta 4 descuentos y deja vacío lo vacío", () => {
    const rows = [
      ["Lista de precios HORNAL — noviembre"],
      [],
      ["Código", "Descripción", "Precio lista", "Desc 1", "Desc 2"],
      ["190138", "ROLLO ALUMINIO", "761,21", 20, ""],
      ["190114", "ROLLO FILM", 950, 0, 5],
      ["", "LÍNEA COCINA", "", "", ""],
      ["190200", "BOLSA", "", "", 10],
    ]
    expect(filasDeListaExcel(rows)).toEqual([
      { codigo: "190138", descripcion: "ROLLO ALUMINIO", precio_compra: 761.21, descuento1: 20, descuento2: null, descuento3: null, descuento4: null },
      { codigo: "190114", descripcion: "ROLLO FILM", precio_compra: 950, descuento1: 0, descuento2: 5, descuento3: null, descuento4: null },
      { codigo: "190200", descripcion: "BOLSA", precio_compra: null, descuento1: null, descuento2: 10, descuento3: null, descuento4: null },
    ])
  })
  it("una sola columna 'Descuento' y la descripción no se confunde con descuento", () => {
    const rows = [["SKU", "Descripcion", "Costo", "Descuento"], ["A1", "Algo", 100, 15]]
    expect(filasDeListaExcel(rows)[0]).toMatchObject({ codigo: "A1", descripcion: "Algo", precio_compra: 100, descuento1: 15 })
  })
  it("planilla vacía", () => expect(filasDeListaExcel([])).toEqual([]))
})

describe("vigencia", () => {
  it("futura solo si es posterior a hoy", () => {
    expect(esVigenciaFutura("2026-12-01", "2026-11-19")).toBe(true)
    expect(esVigenciaFutura("2026-11-19", "2026-11-19")).toBe(false)
    expect(esVigenciaFutura("2026-11-01", "2026-11-19")).toBe(false)
    expect(esVigenciaFutura("", "2026-11-19")).toBe(false)
  })
})

describe("precio por bulto o por unidad (revisión de la Tanda 2-C)", () => {
  const art = { precio_compra: 1000, descuento1: 0, descuento2: 0, descuento3: 0, descuento4: 0 }
  it("una caja de 12 a $12.000 es $1.000 por unidad: no cambia nada", () => {
    const c = cambioDeItem({ precio_compra: 12000 }, art, "cascada", 15, { precio_por: "bulto", unidades_por_bulto: 12 })
    expect(c.factor).toBe(12)
    expect(c.nuevo.precio).toBe(1000)
    expect(c.cambios).toEqual({})
    expect(c.frena).toBeNull()
  })
  it("si se tomara como precio por unidad sería +1.100 %: se frena", () => {
    const c = cambioDeItem({ precio_compra: 12000 }, art)
    expect(c.variacion_pct).toBe(1100)
    expect(c.frena).toMatch(/sube 1\.100 %: supera el tope de 50 %/)
  })
  it("lista por bulto y artículo sin unidades por bulto: no se puede saber el precio por unidad", () => {
    const c = cambioDeItem({ precio_compra: 12000 }, art, "cascada", 15, { precio_por: "bulto", unidades_por_bulto: 1 })
    expect(c.frena).toMatch(/no tiene unidades por bulto/)
  })
  it("los títulos de la planilla dicen en qué viene el precio", () => {
    expect(precioPorEnTitulos([["Código", "Descripción", "Precio x bulto"]])).toBe("bulto")
    expect(precioPorEnTitulos([["Cod", "Detalle", "Costo caja"]])).toBe("bulto")
    expect(precioPorEnTitulos([["Cod", "Detalle", "Precio unitario"]])).toBe("unidad")
    expect(precioPorEnTitulos([["Cod", "Detalle", "Precio lista"]])).toBeNull()
    expect(precioPorEnTitulos([["Cod", "Detalle", "Bultos", "Precio"]])).toBeNull() // "bultos" está en otra columna
  })
})

describe("tope de cambio: no se aplica sin confirmar", () => {
  const art = { precio_compra: 1000 }
  it("el tope por defecto es 50 %", () => expect(TOPE_CAMBIO_PCT).toBe(50))
  it("+60 % frena; confirmado, pasa", () => {
    expect(cambioDeItem({ precio_compra: 1600 }, art).frena).toMatch(/sube 60 %/)
    expect(cambioDeItem({ precio_compra: 1600 }, art, "cascada", 15, { confirmado: true }).frena).toBeNull()
  })
  it("una baja de más del tope también frena", () => {
    expect(cambioDeItem({ precio_compra: 400 }, art).frena).toMatch(/baja 60 %/)
  })
  it("+40 % no frena (pero alerta); el tope se puede cambiar", () => {
    const c = cambioDeItem({ precio_compra: 1400 }, art)
    expect(c.frena).toBeNull()
    expect(c.alerta).toBe("suba")
    expect(cambioDeItem({ precio_compra: 1400 }, art, "cascada", 15, { tope_pct: 30 }).frena).toMatch(/tope de 30 %/)
  })
  it("artículo sin costo previo: no hay con qué comparar, no frena", () => {
    expect(cambioDeItem({ precio_compra: 99999 }, { precio_compra: 0 }).frena).toBeNull()
  })
})

describe("descuento único leído de una foto o un PDF", () => {
  it("es el descuento completo: va en el 1 y los demás en 0 (no 'sin tocar')", () => {
    expect(descuentosDeLectura(14.5)).toEqual([14.5, 0, 0, 0])
    // un artículo que tenía 10 + 5 queda con 14,5 y nada más (antes quedaba 14,5 + 5)
    const c = cambioDeItem({ precio_compra: 1000, descuento1: 14.5, descuento2: 0, descuento3: 0, descuento4: 0 }, { precio_compra: 1000, descuento1: 10, descuento2: 5 })
    expect(c.nuevo.descuentos).toEqual([14.5, 0, 0, 0])
    expect(c.variacion_pct).toBe(0)
  })
  it("0 es cero; sin descuento leído no se toca ninguno", () => {
    expect(descuentosDeLectura(0)).toEqual([0, 0, 0, 0])
    expect(descuentosDeLectura(null)).toEqual([null, null, null, null])
    expect(descuentosDeLectura(undefined)).toEqual([null, null, null, null])
  })
})
