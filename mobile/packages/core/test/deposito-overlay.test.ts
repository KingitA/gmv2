import { describe, expect, it } from "vitest"
import type { ItemOutbox } from "../src/db/idb"
import { calcularBonificados } from "@gm/deposito"
import { cmpOrdenDeposito, devolucionesVisibles, tomadoPorOtro, vistaArticulo, vistaPedido, vistaRecepcion } from "../../../apps/deposito/src/datos/overlay"
import { buscar, buscarPorCodigo, crearIndice } from "../../../apps/deposito/src/datos/busqueda"

// App Depósito: lo que ve el operario = réplica + operaciones sin enviar (overlay).
// Estas funciones son puras; acá se fijan las reglas que hacen que el picking
// offline sea fiel al servidor.

let seq = 0
const op = (tipo: string, payload: unknown, estado: ItemOutbox["estado"] = "pendiente", usuarioId = "yo"): ItemOutbox => ({
  key: `k${++seq}`, seq, tipo, payload, capturadoAt: "2026-09-18T12:00:00Z", estado, intentos: 0, proximoIntentoAt: 0,
  error: estado === "rechazado" ? "Ya lo preparó Ana." : null, resultado: null, enviadoAt: null, usuarioId, etiqueta: null,
})

const det = (id: string, cantidad: number, extra: Record<string, unknown> = {}) => ({
  id, articulo_id: `a-${id}`, cantidad, cantidad_preparada: 0, estado_item: "PENDIENTE" as const, es_bonificado: false, precio_base: 100, excluye_bonif: false,
  articulos: { id: `a-${id}`, sku: id, descripcion: `Art ${id}`, ean13: [`779000000000${id}`] }, ...extra,
})
const pedido = (extra: Record<string, unknown> = {}): any => ({
  id: "p1", numero_pedido: "001", estado: "en_preparacion", fecha: "2026-09-18", prioridad: 3, created_at: "2026-09-18T10:00:00Z",
  bonif_mercaderia_pct: 0, clientes: null, pedidos_detalle: [det("1", 10), det("2", 5), det("3", 2)], preparadores: {}, ...extra,
})
const YO = { id: "yo", nombre: "Juan" }

describe("Depósito · overlay de picking", () => {
  it("un renglón marcado sin señal se ve al instante, con su preparador y la marca 'sin enviar'", () => {
    const v = vistaPedido(pedido(), [
      op("picking.item", { pedido_id: "p1", pedido_detalle_id: "1", cantidad_preparada: 10, es_faltante: false, operario: "Juan" }),
      op("picking.item", { pedido_id: "p1", pedido_detalle_id: "2", cantidad_preparada: 3, es_faltante: false, operario: "Juan" }),
      op("picking.item", { pedido_id: "p1", pedido_detalle_id: "3", cantidad_preparada: 0, es_faltante: true, operario: "Juan" }),
      op("picking.item", { pedido_id: "OTRO", pedido_detalle_id: "1", cantidad_preparada: 1, es_faltante: false }),
    ])
    expect(v.pedidos_detalle.map((d) => [d.estado_item, d.cantidad_preparada])).toEqual([["COMPLETO", 10], ["PARCIAL", 3], ["FALTANTE", 0]])
    expect(v.progreso).toEqual({ total: 3, resueltos: 3, pendientes: 0, completos: 2, faltantes: 1 })
    expect([...v.sinEnviar].sort()).toEqual(["1", "2", "3"])
    expect(v.preparadores["1"]).toEqual({ usuario_id: "yo", usuario_nombre: "Juan" })
    expect(tomadoPorOtro(v, "1", YO)).toBeNull()
  })

  it("la última operación de un renglón gana, y devolver a pendiente lo libera", () => {
    const v = vistaPedido(pedido(), [
      op("picking.item", { pedido_id: "p1", pedido_detalle_id: "1", cantidad_preparada: 10, es_faltante: false, operario: "Juan" }),
      op("picking.item", { pedido_id: "p1", pedido_detalle_id: "1", cantidad_preparada: 0, es_faltante: false, operario: "Juan" }),
    ])
    expect(v.pedidos_detalle[0]!.estado_item).toBe("PENDIENTE")
    expect(v.preparadores["1"]).toBeUndefined()
  })

  it("renglón tomado por otro operario: bloqueado; un rechazo NO se superpone y queda a la vista", () => {
    const p = pedido({ preparadores: { "1": { usuario_id: "ana", usuario_nombre: "Ana" } } })
    const rechazo = op("picking.item", { pedido_id: "p1", pedido_detalle_id: "1", cantidad_preparada: 10, es_faltante: false }, "rechazado")
    const v = vistaPedido(p, [rechazo])
    expect(tomadoPorOtro(v, "1", YO)).toBe("Ana")
    expect(v.pedidos_detalle[0]!.estado_item).toBe("PENDIENTE") // manda el servidor
    expect(v.rechazos).toEqual([rechazo])
    expect(v.sinEnviar.size).toBe(0)
  })

  it("lo que dejó pendiente OTRO usuario del mismo equipo (sesión aparcada) me bloquea ese renglón", () => {
    const v = vistaPedido(pedido(), [op("picking.item", { pedido_id: "p1", pedido_detalle_id: "2", cantidad_preparada: 5, es_faltante: false, operario: "Ana" }, "pendiente", "ana")])
    expect(tomadoPorOtro(v, "2", YO)).toBe("Ana")
  })

  it("cierre encolado: el pedido sale de la cola aunque todavía no se haya enviado", () => {
    expect(vistaPedido(pedido(), [op("picking.cerrar", { pedido_id: "p1" })]).cierrePendiente).toBe(true)
    expect(vistaPedido(pedido(), [op("picking.cerrar", { pedido_id: "p1" }, "rechazado")]).cierrePendiente).toBe(false)
  })

  it("bonificados: offline se recalculan con la MISMA cuenta que el servidor", () => {
    const p = pedido({
      bonif_mercaderia_pct: 10,
      pedidos_detalle: [det("1", 10, { precio_base: 100 }), det("2", 5, { precio_base: 200, excluye_bonif: true }), det("b", 0, { es_bonificado: true, precio_base: 50 })],
    })
    const v = vistaPedido(p, [
      op("picking.item", { pedido_id: "p1", pedido_detalle_id: "1", cantidad_preparada: 10, es_faltante: false }),
      op("picking.item", { pedido_id: "p1", pedido_detalle_id: "2", cantidad_preparada: 5, es_faltante: false }),
    ])
    // base = 10 × 100 (la lista especial no entra) → 10 % = 100 → 100 / 50 = 2 unidades
    const b = v.pedidos_detalle.find((d) => d.id === "b")!
    expect([b.cantidad, b.cantidad_preparada, b.estado_item]).toEqual([2, 2, "COMPLETO"])
    expect(v.progreso.pendientes).toBe(0)
    expect(calcularBonificados(10, v.pedidos_detalle).find((x) => x.id === "b")).toEqual({ id: "b", cantidad: 2, cambia: false })
  })

  it("sin % de bonificación no se toca lo que cargó el usuario", () => {
    const p = pedido({ pedidos_detalle: [det("1", 10), det("b", 3, { es_bonificado: true })] })
    const v = vistaPedido(p, [op("picking.item", { pedido_id: "p1", pedido_detalle_id: "1", cantidad_preparada: 10, es_faltante: false })])
    expect(v.pedidos_detalle[1]).toMatchObject({ cantidad: 3, estado_item: "PENDIENTE" })
  })
})

describe("Depósito · overlay de recepción, stock y devoluciones", () => {
  const orden = (recepcion: any = null): any => ({
    id: "oc1", numero_orden: "OC-1", estado: "pendiente", fecha_orden: "2026-09-18", proveedores: { id: "pr", nombre: "Prov" },
    ordenes_compra_detalle: [{ id: "d1", cantidad_pedida: 12, articulo_id: "a1", articulos: { id: "a1", sku: "S1", descripcion: "Uno" } }],
    recepcion,
  })

  it("sin recepción en el servidor las líneas salen de la OC; lo no pedido entra como fuera de OC", () => {
    const v = vistaRecepcion(orden(), [
      op("recepcion.conformidad", { orden_compra_id: "oc1", conformidad: { estado: "conforme" } }),
      op("recepcion.item", { orden_compra_id: "oc1", articulo_id: "a1", cantidad_fisica: 12 }),
      op("recepcion.item", { orden_compra_id: "oc1", articulo_id: "zz", cantidad_fisica: 4 }),
    ], (id) => (id === "zz" ? ({ id: "zz", sku: "Z", descripcion: "Extra" } as any) : undefined))
    expect(v.conformidad).toBe("conforme")
    expect(v.recepcionId).toBeNull()
    expect(v.lineas.map((l) => [l.articulo_id, l.estado_linea, l.cantidad_fisica, l.fuera_de_oc])).toEqual([["a1", "ok", 12, false], ["zz", "ok", 4, true]])
    expect(v.lineas[1]!.articulo?.descripcion).toBe("Extra")
  })

  it("0 = faltante, -1 = vuelve a pendiente (misma regla que el servidor)", () => {
    const base = orden({ id: "r1", estado: "en_proceso", numero_tanda: 1, conformidad_transporte: "omitida", recepciones_documentos: [], recepciones_items: [{ id: "i1", articulo_id: "a1", cantidad_oc: 12, cantidad_fisica: 12, estado_linea: "ok" }] })
    expect(vistaRecepcion(base, [op("recepcion.item", { orden_compra_id: "oc1", articulo_id: "a1", cantidad_fisica: 0 })], () => undefined).lineas[0]!.estado_linea).toBe("faltante")
    expect(vistaRecepcion(base, [op("recepcion.item", { orden_compra_id: "oc1", articulo_id: "a1", cantidad_fisica: -1 })], () => undefined).lineas[0]!.estado_linea).toBe("pendiente")
  })

  it("stock: los ajustes sin enviar se encadenan sobre el stock replicado", () => {
    const a: any = { id: "a1", sku: "S", descripcion: "Uno", ean13: null, codigo_bulto: null, stock_actual: 10, orden_deposito: null, marca: null }
    const v = vistaArticulo(a, [
      op("stock.ajustar", { articulo_id: "a1", tipo: "entrada", cantidad: 5, stock_visto: 10 }),
      op("stock.ajustar", { articulo_id: "a1", tipo: "salida", cantidad: 2, stock_visto: 15 }),
      op("stock.ajustar", { articulo_id: "OTRO", tipo: "correccion", cantidad: 99, stock_visto: 1 }),
      op("articulo.datos", { articulo_id: "a1", cambios: { ean13: { antes: null, despues: ["7790000000017"] } } }),
      op("stock.ajustar", { articulo_id: "a1", tipo: "correccion", cantidad: 1, stock_visto: 13 }, "rechazado"),
    ])
    expect(v.stock_actual).toBe(13)
    expect(v.ean13).toEqual(["7790000000017"])
    expect([v.stockSinEnviar, v.datosSinEnviar, v.descartado]).toEqual([true, true, false])
  })

  it("orden de depósito: con orden primero, sin orden al final, desempate por descripción", () => {
    const arts: any[] = [{ id: "3", descripcion: "B", orden_deposito: null }, { id: "1", descripcion: "Z", orden_deposito: 2 }, { id: "2", descripcion: "A", orden_deposito: 2 }, { id: "4", descripcion: "A", orden_deposito: null }]
    expect(arts.sort(cmpOrdenDeposito).map((a) => a.id)).toEqual(["2", "1", "4", "3"])
  })

  it("una devolución confirmada en el equipo sale de la lista", () => {
    const devs: any[] = [{ id: "d1", created_at: "2" }, { id: "d2", created_at: "1" }]
    expect(devolucionesVisibles(devs, [op("devolucion.recibir", { devolucion_id: "d1", items_confirmados: [] })]).map((d) => d.id)).toEqual(["d2"])
  })
})

describe("Depósito · búsqueda local", () => {
  const ix = crearIndice([
    { id: "1", sku: "100651", descripcion: "Lavandina Ayudín 1L", ean13: ["7790001000018"], codigo_bulto: "17790001000015", marca: "Ayudín" },
    { id: "2", sku: "200", descripcion: "Jabón líquido Ala 800ml", ean13: ["0000012345678"], codigo_bulto: null, marca: "Ala" },
    { id: "3", sku: "300", descripcion: "Ala jabón en polvo", ean13: null, codigo_bulto: null, marca: null },
  ])
  it("código exacto: EAN, código de bulto y lectores que se comen los ceros", () => {
    expect(buscarPorCodigo(ix, "7790001000018").map((a) => a.id)).toEqual(["1"])
    expect(buscarPorCodigo(ix, "17790001000015").map((a) => a.id)).toEqual(["1"])
    expect(buscarPorCodigo(ix, "12345678").map((a) => a.id)).toEqual(["2"])
    expect(buscarPorCodigo(ix, "999")).toEqual([])
  })
  it("texto: todas las palabras, sin acentos, en cualquier orden; primero lo que empieza así", () => {
    expect(buscar(ix, "jabon ala").map((a) => a.id)).toEqual(["2", "3"])
    expect(buscar(ix, "ala").map((a) => a.id)).toEqual(["3", "2"])
    expect(buscar(ix, "100651").map((a) => a.id)).toEqual(["1"])
    expect(buscar(ix, "a")).toEqual([])
  })
})
