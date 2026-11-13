// Juan 14/11/2026: "en revisión" es SOLO para el primer pedido de un cliente que el
// vendedor dio de alta en la calle. Antes caía cualquier cliente sin pedidos vivos en el
// sistema (002151, LI LIJUAN: su historial era "sistema viejo" eliminado).
import { describe, expect, it } from "vitest"
import { estadoInicialPedidoVendedor } from "../../../../lib/pedidos/estados"

describe("estado inicial del pedido del vendedor", () => {
  it("cliente dado de alta en la calle, primer pedido → en revisión", () => {
    expect(estadoInicialPedidoVendedor({ altaDesdeLaApp: true, pedidosPrevios: 0 })).toBe("en_revision")
  })
  it("cliente dado de alta en la calle, segundo pedido → pendiente", () => {
    expect(estadoInicialPedidoVendedor({ altaDesdeLaApp: true, pedidosPrevios: 1 })).toBe("pendiente")
  })
  it("cliente de la cartera sin pedidos en el sistema (caso LI LIJUAN) → pendiente", () => {
    expect(estadoInicialPedidoVendedor({ altaDesdeLaApp: false, pedidosPrevios: 0 })).toBe("pendiente")
  })
})
