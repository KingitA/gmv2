// Cargar pedido desde depósito (Juan 05/11/2026): reglas puras del servidor
// (lib/pedidos/origen-deposito.ts) y estado al facturar (lib/pedidos/estados.ts).
import { describe, expect, it } from "vitest"
import {
  articulosSinPrecio,
  esCargadoEnDeposito,
  facturableEnLote,
  juntarItems,
  mensajeSinPrecio,
  validarPayloadPedidoDeposito,
} from "../../../../lib/pedidos/origen-deposito"
import { estadoAlFacturar } from "../../../../lib/pedidos/estados"

const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const C = "33333333-3333-4333-8333-333333333333"

describe("payload de pedido.cargar_deposito", () => {
  it("para mí: sin cliente", () => {
    expect(validarPayloadPedidoDeposito({ local_id: A, modo: "propio", items: [{ articulo_id: B, cantidad: 2 }] })).toBeNull()
  })
  it("para un cliente: el cliente es obligatorio", () => {
    expect(validarPayloadPedidoDeposito({ local_id: A, modo: "cliente", items: [{ articulo_id: B, cantidad: 1 }] })).toBe("Elegí el cliente del pedido")
    expect(validarPayloadPedidoDeposito({ local_id: A, modo: "cliente", cliente_id: C, items: [{ articulo_id: B, cantidad: 1 }] })).toBeNull()
  })
  it("rechaza modo, artículos y cantidades inválidos", () => {
    expect(validarPayloadPedidoDeposito({ local_id: A, modo: "otro", items: [] })).toMatch(/modo/)
    expect(validarPayloadPedidoDeposito({ local_id: "x", modo: "propio", items: [] })).toMatch(/local_id/)
    expect(validarPayloadPedidoDeposito({ local_id: A, modo: "propio", items: [{ articulo_id: "nope", cantidad: 1 }] })).toMatch(/artículo/)
    expect(validarPayloadPedidoDeposito({ local_id: A, modo: "propio", items: [{ articulo_id: B, cantidad: 0 }] })).toMatch(/cantidad/)
  })
  it("la lista vacía no es error de forma: el handler la rechaza como sin_items", () => {
    expect(validarPayloadPedidoDeposito({ local_id: A, modo: "propio", items: [] })).toBeNull()
  })
  it("el mismo artículo escaneado dos veces va en un renglón", () => {
    expect(juntarItems([{ articulo_id: B, cantidad: 2 }, { articulo_id: C, cantidad: 1 }, { articulo_id: B, cantidad: 3 }])).toEqual([
      { articulo_id: B, cantidad: 5 },
      { articulo_id: C, cantidad: 1 },
    ])
  })
})

describe("sin precio en la lista del cliente", () => {
  it("sin lista para su segmento, precio 0 o sin cotizar → se avisan todos juntos", () => {
    const precios: Record<string, { precio: number; sinLista: boolean } | null> = {
      [A]: { precio: 120, sinLista: false },
      [B]: { precio: 0, sinLista: false },
      [C]: { precio: 50, sinLista: true },
    }
    expect(articulosSinPrecio([A, B, C, "falta"], (id) => precios[id] ?? null)).toEqual([B, C, "falta"])
    expect(mensajeSinPrecio(["TRAPO", "ESPONJA"])).toMatch(/^Estos artículos no tienen precio en la lista del cliente: TRAPO, ESPONJA/)
  })
})

describe("cargado en depósito en el ERP", () => {
  it("solo los dos orígenes de depósito", () => {
    expect(esCargadoEnDeposito({ origen: "deposito_propio" })).toBe(true)
    expect(esCargadoEnDeposito({ origen: "deposito_cliente" })).toBe(true)
    expect(esCargadoEnDeposito({ origen: null })).toBe(false)
    expect(esCargadoEnDeposito({})).toBe(false)
  })
  it("Facturar varios: preparados y cargados en depósito pendientes; un pendiente común no", () => {
    expect(facturableEnLote({ estado: "pendiente_facturacion" })).toBe(true)
    expect(facturableEnLote({ estado: "pendiente", origen: "deposito_cliente" })).toBe(true)
    expect(facturableEnLote({ estado: "pendiente", origen: null })).toBe(false)
    expect(facturableEnLote({ estado: "impreso", origen: "deposito_propio" })).toBe(false)
  })
  it("al facturar pasa directo a entregado; un pedido común a facturado", () => {
    expect(estadoAlFacturar("pendiente", { cargadoEnDeposito: true })).toBe("entregado")
    expect(estadoAlFacturar("pendiente")).toBe("facturado")
    expect(estadoAlFacturar("pendiente_facturacion")).toBe("facturado")
    // Refacturado después de anular: la logística no cambia
    expect(estadoAlFacturar("entregado", { cargadoEnDeposito: true })).toBe("entregado")
  })
})
