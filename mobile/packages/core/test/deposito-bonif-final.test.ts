import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import type { ItemOutbox } from "../src/db/idb"
import { estadoBonificadoPicking } from "@gm/deposito"
import { normalesSinResolver, renglonDeArticulo, vistaPedido } from "../../../apps/deposito/src/datos/overlay"

// Mercadería bonificada AL FINAL (pedido de Juan, 03/11/2026): no se marca sola; aparece
// cuando todo lo demás está resuelto, se escanea y se carga la cantidad como cualquier
// artículo, y sin eso el pedido no se puede finalizar.

vi.mock("@/lib/deposito/bonificados", async () => await import("../../../../lib/deposito/bonificados"))
// Ruta en variable: el typecheck de mobile/ no entra a lib/pedidos (alias del ERP)
const RUTA = fileURLToPath(new URL("../../../../lib/pedidos/mercaderia-bonificada.ts", import.meta.url))
const { recalcularBonificadosPedido } = (await import(/* @vite-ignore */ RUTA)) as any

describe("estadoBonificadoPicking (regla compartida servidor / app)", () => {
  const b = (cantidad: number, cantidad_preparada = 0, estado_item: string | null = "PENDIENTE") => ({ cantidad, cantidad_preparada, estado_item })
  it("pedido en preparación y nadie lo marcó: PENDIENTE (no se prepara solo)", () => {
    expect(estadoBonificadoPicking(b(3), { tomado: false, preparando: true })).toEqual({ cantidad_preparada: 0, estado_item: "PENDIENTE" })
  })
  it("lo marcó un operario: se respeta lo que separó; el estado sigue a la cantidad a entregar", () => {
    expect(estadoBonificadoPicking(b(3, 3, "COMPLETO"), { tomado: true, preparando: true })).toEqual({ cantidad_preparada: 3, estado_item: "COMPLETO" })
    expect(estadoBonificadoPicking(b(4, 3, "COMPLETO"), { tomado: true, preparando: true })).toEqual({ cantidad_preparada: 3, estado_item: "PARCIAL" })
    expect(estadoBonificadoPicking(b(4, 0, "FALTANTE"), { tomado: true, preparando: true })).toEqual({ cantidad_preparada: 0, estado_item: "FALTANTE" })
  })
  it("sin unidades para regalar: resuelto solo (no hay nada que juntar)", () => {
    expect(estadoBonificadoPicking(b(0), { tomado: false, preparando: true })).toEqual({ cantidad_preparada: 0, estado_item: "COMPLETO" })
  })
  it("pedido ya cerrado antes de esta regla y nunca marcado: queda como antes", () => {
    expect(estadoBonificadoPicking(b(3), { tomado: false, preparando: false })).toEqual({ cantidad_preparada: 3, estado_item: "COMPLETO" })
  })
})

// ─── App: overlay ────────────────────────────────────────────────────────────

let seq = 0
const op = (pedido_detalle_id: string, cantidad_preparada: number, es_faltante = false): ItemOutbox => ({
  key: `k${++seq}`, seq, tipo: "picking.item", payload: { pedido_id: "p1", pedido_detalle_id, cantidad_preparada, es_faltante, operario: "Juan" },
  capturadoAt: "2026-11-03T12:00:00Z", estado: "pendiente", intentos: 0, proximoIntentoAt: 0, error: null, resultado: null, enviadoAt: null, usuarioId: "yo", etiqueta: null,
})
const det = (id: string, articulo: string, cantidad: number, extra: Record<string, unknown> = {}) => ({
  id, articulo_id: articulo, cantidad, cantidad_preparada: 0, estado_item: "PENDIENTE" as const, es_bonificado: false, precio_base: 100, excluye_bonif: false,
  articulos: { id: articulo, sku: id, descripcion: `Art ${id}`, ean13: [] }, ...extra,
})
// 10 % del renglón 1 (10 × 100; el 2 es de lista especial, no entra) = 100 → 100 / 50 = 2 unidades del artículo "a1" (mismo artículo, bonificado)
const pedido = (): any => ({
  id: "p1", numero_pedido: "001", estado: "en_preparacion", fecha: "2026-11-03", prioridad: 3, created_at: "2026-11-03T10:00:00Z",
  bonif_mercaderia_pct: 10, clientes: null, preparadores: {},
  pedidos_detalle: [det("1", "a1", 10), det("2", "a2", 5, { precio_base: 200, excluye_bonif: true }), det("b", "a1", 0, { es_bonificado: true, precio_base: 50 })],
})

describe("App · bonificado al final", () => {
  it("pickear el primer artículo NO deja el bonificado preparado (el caso que vio Juan)", () => {
    const v = vistaPedido(pedido(), [op("1", 10)])
    expect(v.pedidos_detalle.find((d) => d.id === "b")).toMatchObject({ cantidad: 2, estado_item: "PENDIENTE" })
    expect(normalesSinResolver(v)).toBe(1)
  })

  it("con todo lo demás resuelto aparece; sin marcarlo el pedido no se puede finalizar", () => {
    const v = vistaPedido(pedido(), [op("1", 10), op("2", 5)])
    expect(normalesSinResolver(v)).toBe(0)
    expect(v.progreso.pendientes).toBe(1) // el botón Finalizar sigue apagado
  })

  it("se marca como cualquier artículo: cantidad escrita → resuelto y se puede finalizar", () => {
    const v = vistaPedido(pedido(), [op("1", 10), op("2", 5), op("b", 2)])
    expect(v.pedidos_detalle.find((d) => d.id === "b")).toMatchObject({ cantidad: 2, cantidad_preparada: 2, estado_item: "COMPLETO" })
    expect(v.progreso.pendientes).toBe(0)
  })

  it("si después cambia lo preparado, lo separado del bonificado no se pisa", () => {
    const v = vistaPedido(pedido(), [op("1", 10), op("2", 5), op("b", 2), op("1", 20)]) // ahora corresponden 4
    expect(v.pedidos_detalle.find((d) => d.id === "b")).toMatchObject({ cantidad: 4, cantidad_preparada: 2, estado_item: "PARCIAL" })
  })

  it("escanear un artículo que está normal y bonificado abre primero el normal", () => {
    const v = vistaPedido(pedido(), [])
    expect(renglonDeArticulo(v, (id) => id === "a1")?.id).toBe("1")
    const v2 = vistaPedido(pedido(), [op("1", 10)])
    expect(renglonDeArticulo(v2, (id) => id === "a1")?.id).toBe("b")
  })
})

// ─── Servidor: recalcularBonificadosPedido ───────────────────────────────────

function baseFalsa(t: Record<string, any[]>) {
  return {
    from(tabla: string) {
      const filtros: Array<(f: any) => boolean> = []
      let upd: any = null
      const q: any = {
        select: () => q,
        update: (d: any) => ((upd = d), q),
        eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), q),
        in: (c: string, v: unknown[]) => (filtros.push((f) => v.includes(f[c])), q),
        maybeSingle: async () => ({ data: (t[tabla] || []).filter((f) => filtros.every((x) => x(f)))[0] ?? null, error: null }),
        then: (ok: any, mal: any) => {
          const filas = (t[tabla] || []).filter((f) => filtros.every((x) => x(f)))
          if (upd) filas.forEach((f) => Object.assign(f, upd))
          return Promise.resolve({ data: filas.map((f) => ({ ...f })), error: null }).then(ok, mal)
        },
      }
      return q
    },
  }
}
const tablas = (estado: string, items: any[] = []) => ({
  pedidos: [{ id: "p1", estado, bonif_mercaderia_pct: 10 }],
  pedidos_detalle: [
    { id: "1", pedido_id: "p1", articulo_id: "a1", cantidad: 10, cantidad_preparada: 10, estado_item: "COMPLETO", precio_base: 100, es_bonificado: false },
    { id: "b", pedido_id: "p1", articulo_id: "a1", cantidad: 0, cantidad_preparada: 0, estado_item: "PENDIENTE", precio_base: 50, es_bonificado: true },
  ],
  picking_items: items,
  listas_precio: [],
})

describe("Servidor · el bonificado se prepara al final", () => {
  it("en preparación: fija la cantidad pero lo deja PENDIENTE (cerrarPicking no deja finalizar)", async () => {
    const t = tablas("en_preparacion")
    await recalcularBonificadosPedido(baseFalsa(t), "p1", { enPicking: true })
    expect(t.pedidos_detalle[1]).toMatchObject({ cantidad: 2, cantidad_preparada: 0, estado_item: "PENDIENTE" })
  })

  it("lo marcó el operario: no se pisa lo que separó (tampoco al facturar)", async () => {
    const t = tablas("pendiente_facturacion", [{ pedido_detalle_id: "b" }])
    Object.assign(t.pedidos_detalle[1]!, { cantidad: 2, cantidad_preparada: 1, estado_item: "PARCIAL" })
    await recalcularBonificadosPedido(baseFalsa(t), "p1") // como lo llama generar comprobantes
    expect(t.pedidos_detalle[1]).toMatchObject({ cantidad: 2, cantidad_preparada: 1, estado_item: "PARCIAL" })
  })

  it("pedido cerrado antes de la regla, nunca marcado: queda preparado como siempre", async () => {
    const t = tablas("pendiente_facturacion")
    await recalcularBonificadosPedido(baseFalsa(t), "p1")
    expect(t.pedidos_detalle[1]).toMatchObject({ cantidad: 2, cantidad_preparada: 2, estado_item: "COMPLETO" })
  })
})
