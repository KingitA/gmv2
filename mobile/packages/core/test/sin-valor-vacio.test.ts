// Juan 13/11/2026: "No hay valor = vacío". Un cliente sin método de facturación (o sin
// lista) no puede verse como si lo tuviera ni tomar pedidos con un valor supuesto:
// antes la ficha mostraba "Factura" y los pedidos se calculaban como "Final"
// (002164/65/66/70, importados).
import { describe, expect, it } from "vitest"
import { faltaLista, formDesdeFicha, metodoEfectivo } from "../../../../lib/pedidos/condiciones-form"
import { resolverListaMetodoDefinido, resolverListaSegmentoDefinido } from "../../../../lib/pricing/resolver"

const ficha = (cliente: Record<string, unknown>) => ({ cliente, bonificaciones: [], proveedor: [], marca: [] })
const VIAJANTE = "27380687-109c-49c8-b505-3800e040ce57"

describe("ficha sin método (caso SHI MING FENG, cliente 288)", () => {
  const form = formDesdeFicha(ficha({ lista_precio_id: VIAJANTE, metodo_facturacion: null }))

  it("el método queda vacío: no se supone Final ni Factura", () => {
    expect(form.metodo).toBe("")
    expect(metodoEfectivo(form, "limpieza_bazar")).toBe("")
  })

  it("no se puede tomar el pedido: falta el método", () => {
    expect(faltaLista(form)).toBe("El cliente no tiene método de facturación asignado: elegí uno antes de tomar el pedido.")
  })

  it("eligiendo el método para el pedido, se puede", () => {
    expect(faltaLista({ ...form, metodo: "Factura" })).toBeNull()
  })

  it("el servidor tampoco lo supone: método null", () => {
    expect(resolverListaSegmentoDefinido("limpieza", {}, { lista_precio_id: VIAJANTE, metodo_facturacion: null })).toEqual({ listaId: VIAJANTE, metodoRaw: null })
    expect(resolverListaMetodoDefinido("perf0", null, {}, { lista_precio_id: VIAJANTE }).metodoRaw).toBeNull()
  })
})

describe("faltantes por segmento", () => {
  it("método solo para limpieza: avisa los segmentos que no tienen", () => {
    const form = formDesdeFicha(ficha({ lista_precio_id: VIAJANTE, metodo_limpieza: "Presupuesto" }))
    expect(faltaLista(form)).toBe("Falta el método de facturación de: Perfumería 0, Perfumería plus.")
  })

  it("sin lista ni método: avisa las dos cosas", () => {
    const msg = faltaLista(formDesdeFicha(ficha({})))
    expect(msg).toMatch(/no tiene lista de precios/)
    expect(msg).toMatch(/no tiene método de facturación/)
  })

  it("con lista y método generales: OK", () => {
    expect(faltaLista(formDesdeFicha(ficha({ lista_precio_id: VIAJANTE, metodo_facturacion: "Final" })))).toBeNull()
  })
})
