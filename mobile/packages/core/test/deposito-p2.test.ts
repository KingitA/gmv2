import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import type { ItemOutbox } from "../src/db/idb"
import { vistaPedido } from "../../../apps/deposito/src/datos/overlay"
import { leerCantidad, marcaPicking } from "../../../apps/deposito/src/datos/cantidad"

// 2ª prueba integral de salida — App Depósito: P2-18 (reiniciar / soltar) y P2-19
// (bultos al finalizar). El servidor se prueba contra una base en memoria.

// picking.ts usa alias "@/" del ERP: acá se reemplazan por lo mínimo
vi.mock("@/lib/utils", () => ({ nowArgentina: () => "2026-10-29T12:00:00-03:00" }))
vi.mock("@/lib/pedidos/mercaderia-bonificada", () => ({ recalcularBonificadosPedido: async () => [] }))

// Ruta en variable: el typecheck de mobile/ no entra a lib/deposito (usa los alias del ERP,
// que se chequea con el tsc del repo); vitest la resuelve igual.
const RUTA_PICKING = fileURLToPath(new URL("../../../../lib/deposito/picking.ts", import.meta.url))
const { cerrarPicking, reiniciarPreparacion, soltarPedido, abrirPicking } = (await import(/* @vite-ignore */ RUTA_PICKING)) as any

// ─── Base en memoria (lo justo que usa lib/deposito/picking.ts) ──────────────

type Fila = Record<string, any>
function baseFalsa(tablas: Record<string, Fila[]>, opts: { sinColumnas?: string[] } = {}) {
  let ids = 0
  const sinCol = (fila: Fila) => (opts.sinColumnas || []).find((c) => c in fila)
  function consulta(tabla: string) {
    const filtros: Array<(f: Fila) => boolean> = []
    let op: { tipo: "select" | "update" | "delete" | "insert"; datos?: Fila } = { tipo: "select" }
    const filas = () => (tablas[tabla] ||= [])
    const vista = (f: Fila) => (tabla === "picking_items" ? { ...f, pedidos_detalle: tablas.pedidos_detalle!.find((d) => d.id === f.pedido_detalle_id) } : f)
    const campo = (f: Fila, c: string) => c.split(".").reduce((o: any, k) => o?.[k], vista(f))
    const ejecutar = () => {
      const elegidas = filas().filter((f) => filtros.every((fn) => fn(f)))
      if (op.tipo === "update") {
        const falta = sinCol(op.datos!)
        if (falta) return { data: null, error: { message: `Could not find the '${falta}' column of '${tabla}' in the schema cache` } }
        elegidas.forEach((f) => Object.assign(f, op.datos))
      }
      if (op.tipo === "delete") tablas[tabla] = filas().filter((f) => !elegidas.includes(f))
      if (op.tipo === "insert") {
        const nueva = { id: `n${++ids}`, ...op.datos }
        filas().push(nueva)
        return { data: [nueva], error: null }
      }
      return { data: elegidas.map((f) => ({ ...f })), error: null }
    }
    const q: any = {
      select: () => q,
      update: (datos: Fila) => ((op = { tipo: "update", datos }), q),
      delete: () => ((op = { tipo: "delete" }), q),
      insert: (datos: Fila) => ((op = { tipo: "insert", datos }), q),
      eq: (c: string, v: unknown) => (filtros.push((f) => campo(f, c) === v), q),
      in: (c: string, v: unknown[]) => (filtros.push((f) => v.includes(campo(f, c))), q),
      limit: () => q,
      maybeSingle: async () => { const r = ejecutar(); return { data: r.data?.[0] ?? null, error: r.error } },
      single: async () => { const r = ejecutar(); return { data: r.data?.[0] ?? null, error: r.error ?? (r.data?.[0] ? null : { message: "sin filas" }) } },
      then: (ok: any, mal: any) => Promise.resolve(ejecutar()).then(ok, mal),
    }
    return q
  }
  return { from: consulta, auth: { getUser: async () => ({ data: { user: null } }) } }
}

const JUAN = { id: "u-juan", nombre: "Juan Cruz", email: "juan@gm.com" }
const ANA = { id: "u-ana", nombre: "Ana", email: "ana@gm.com" }

function escenario(extra: { estado?: string; estado_antes_preparacion?: string | null; items?: Fila[]; sesiones?: Fila[] } = {}) {
  return {
    pedidos: [{ id: "p1", numero_pedido: "001945", estado: extra.estado ?? "en_preparacion", estado_antes_preparacion: extra.estado_antes_preparacion ?? "impreso", bultos: 0, pallets: 0 }],
    pedidos_detalle: [
      { id: "d1", pedido_id: "p1", articulo_id: "a1", cantidad: 10, cantidad_preparada: 10, estado_item: "COMPLETO" },
      { id: "d2", pedido_id: "p1", articulo_id: "a2", cantidad: 5, cantidad_preparada: 0, estado_item: "FALTANTE" },
    ],
    picking_items: extra.items ?? [
      { id: "i1", pedido_detalle_id: "d1", usuario_id: JUAN.id, usuario_nombre: JUAN.nombre },
      { id: "i2", pedido_detalle_id: "d2", usuario_id: JUAN.id, usuario_nombre: JUAN.nombre },
    ],
    picking_sesiones: extra.sesiones ?? [{ id: "s1", pedido_id: "p1", usuario_id: JUAN.id, usuario_email: JUAN.email, estado: "EN_PROGRESO" }],
    kardex: [],
  } as Record<string, Fila[]>
}

// ─── P2-16: la cantidad separada arranca vacía ──────────────────────────────

describe("P2-16 · Cantidad que separaste", () => {
  it("vacía no confirma nada en picking (nadie confirma lo pedido sin contar)", () => {
    expect(leerCantidad("", true)).toBe("vacia")
    expect(leerCantidad("   ", true)).toBe("vacia")
    expect(leerCantidad("", false)).toBe(0) // recepción: como siempre
  })
  it("lo escrito vale tal cual, en formato argentino; un código leído en el campo no", () => {
    expect(leerCantidad("12", true)).toBe(12)
    expect(leerCantidad("1.500", true)).toBe(1500)
    expect(leerCantidad("0", true)).toBe(0)
    expect(leerCantidad("7790001234567", true)).toBe("invalida")
    expect(leerCantidad("-3", true)).toBe("invalida")
  })
  it("escribir 0 es faltante; el botón Faltante también", () => {
    expect(marcaPicking(0, false)).toEqual({ cantidad: 0, esFaltante: true })
    expect(marcaPicking(7, false)).toEqual({ cantidad: 7, esFaltante: false })
    expect(marcaPicking(7, true)).toEqual({ cantidad: 0, esFaltante: true })
  })
})

// ─── P2-18: servidor ─────────────────────────────────────────────────────────

describe("P2-18 · Soltar pedido (servidor)", () => {
  it("vuelve a la cola con el estado de antes, renglones a cero, sin dueño y sin sesiones", async () => {
    const t = escenario()
    const r = await soltarPedido(baseFalsa(t), "p1", { usuario: JUAN })
    expect(r).toMatchObject({ ok: true, estado: "impreso" })
    expect(t.pedidos![0]).toMatchObject({ estado: "impreso", estado_antes_preparacion: null })
    expect(t.pedidos_detalle!.map((d) => [d.cantidad_preparada, d.estado_item])).toEqual([[0, "PENDIENTE"], [0, "PENDIENTE"]])
    expect(t.picking_items).toEqual([])
    expect(t.picking_sesiones!.every((s) => s.estado === "TERMINADO")).toBe(true)
  })

  it("el caso 001945: abierto sin nada escaneado → se suelta; reenviar la operación no hace nada", async () => {
    const t = escenario({ items: [] })
    const db = baseFalsa(t)
    await soltarPedido(db, "p1", { usuario: JUAN })
    expect(t.pedidos![0]!.estado).toBe("impreso")
    expect(await soltarPedido(db, "p1", { usuario: JUAN })).toMatchObject({ ok: true, ya_estaba: true })
  })

  it("sin la migración aplicada (no existe estado_antes_preparacion) vuelve a 'pendiente'", async () => {
    const t = escenario()
    delete t.pedidos![0]!.estado_antes_preparacion
    await soltarPedido(baseFalsa(t, { sinColumnas: ["estado_antes_preparacion"] }), "p1", { usuario: JUAN })
    expect(t.pedidos![0]!.estado).toBe("pendiente")
  })

  it("otro operario sin sesión en el pedido: rechazo; un admin sí puede", async () => {
    const t = escenario()
    await expect(soltarPedido(baseFalsa(t), "p1", { usuario: ANA })).rejects.toMatchObject({ status: 409, extra: { codigo: "sin_sesion" } })
    expect(t.pedidos![0]!.estado).toBe("en_preparacion") // no tocó nada
    await soltarPedido(baseFalsa(t), "p1", { usuario: ANA, esAdmin: true })
    expect(t.pedidos![0]!.estado).toBe("impreso")
  })

  it("renglones preparados por otra persona: solo un admin", async () => {
    const t = escenario({
      items: [{ id: "i1", pedido_detalle_id: "d1", usuario_id: ANA.id, usuario_nombre: ANA.nombre }],
      sesiones: [
        { id: "s1", pedido_id: "p1", usuario_id: JUAN.id, usuario_email: JUAN.email, estado: "EN_PROGRESO" },
        { id: "s2", pedido_id: "p1", usuario_id: ANA.id, usuario_email: ANA.email, estado: "EN_PROGRESO" },
      ],
    })
    await expect(soltarPedido(baseFalsa(t), "p1", { usuario: JUAN })).rejects.toMatchObject({ extra: { codigo: "renglones_de_otro" } })
    await expect(reiniciarPreparacion(baseFalsa(t), "p1", { usuario: JUAN })).rejects.toMatchObject({ extra: { codigo: "renglones_de_otro" } })
  })

  it("un pedido ya finalizado no se suelta", async () => {
    const t = escenario({ estado: "pendiente_facturacion" })
    await expect(soltarPedido(baseFalsa(t), "p1", { usuario: JUAN })).rejects.toMatchObject({ extra: { codigo: "pedido_cerrado" } })
  })

  it("abrir guarda de dónde venía el pedido (impreso) para poder soltarlo así", async () => {
    const t = escenario({ estado: "impreso", estado_antes_preparacion: null, sesiones: [], items: [] })
    t.pedidos![0]!.clientes = null
    await abrirPicking(baseFalsa(t), "p1", JUAN)
    expect(t.pedidos![0]).toMatchObject({ estado: "en_preparacion", estado_antes_preparacion: "impreso" })
  })
})

describe("P2-18 · Reiniciar preparación (servidor)", () => {
  it("todo a cero y sin dueño, la sesión sigue abierta y el pedido en preparación; idempotente", async () => {
    const t = escenario()
    const db = baseFalsa(t)
    await reiniciarPreparacion(db, "p1", { usuario: JUAN })
    await reiniciarPreparacion(db, "p1", { usuario: JUAN })
    expect(t.pedidos_detalle!.every((d) => d.cantidad_preparada === 0 && d.estado_item === "PENDIENTE")).toBe(true)
    expect(t.picking_items).toEqual([])
    expect(t.picking_sesiones!.filter((s) => s.estado === "EN_PROGRESO")).toHaveLength(1)
    expect(t.pedidos![0]!.estado).toBe("en_preparacion")
  })
})

// ─── P2-19: bultos al finalizar ──────────────────────────────────────────────

describe("P2-19 · Finalizar con o sin bultos (servidor)", () => {
  const listo = () => {
    const t = escenario()
    t.pedidos_detalle!.forEach((d) => (d.estado_item = "COMPLETO"))
    return t
  }

  it("con bultos: se graban junto con el estado", async () => {
    const t = listo()
    await cerrarPicking(baseFalsa(t), "p1", { bultos: 3, pallets: 1 })
    expect(t.pedidos![0]).toMatchObject({ estado: "pendiente_facturacion", bultos: 3, pallets: 1 })
  })

  it("'dejar para después del control': cierra sin tocar bultos (la oficina los carga en el viaje)", async () => {
    const t = listo()
    t.pedidos![0]!.bultos = 7 // si ya había algo cargado, no se pisa
    await cerrarPicking(baseFalsa(t), "p1")
    expect(t.pedidos![0]).toMatchObject({ estado: "pendiente_facturacion", bultos: 7 })
  })

  it("sin la columna pallets (20261026 sin aplicar) graba estado y bultos igual", async () => {
    const t = listo()
    delete t.pedidos![0]!.pallets
    await cerrarPicking(baseFalsa(t, { sinColumnas: ["pallets"] }), "p1", { bultos: 2, pallets: 1 })
    expect(t.pedidos![0]).toMatchObject({ estado: "pendiente_facturacion", bultos: 2 })
    expect(t.pedidos![0]!.pallets).toBeUndefined()
  })

  it("lo cerró otro equipo sin bultos y este los trae: se guardan", async () => {
    const t = listo()
    t.pedidos![0]!.estado = "pendiente_facturacion"
    const r = await cerrarPicking(baseFalsa(t), "p1", { bultos: 4 })
    expect(r).toMatchObject({ ya_cerrado: true })
    expect(t.pedidos![0]!.bultos).toBe(4)
  })
})

// ─── P2-18: lo que ve el operario (overlay) ──────────────────────────────────

let seq = 0
const op = (tipo: string, payload: unknown): ItemOutbox => ({
  key: `k${++seq}`, seq, tipo, payload, capturadoAt: "2026-10-29T12:00:00Z", estado: "pendiente", intentos: 0, proximoIntentoAt: 0,
  error: null, resultado: null, enviadoAt: null, usuarioId: "yo", etiqueta: null,
})
const detalle = (id: string, cantidad: number, extra: Record<string, unknown> = {}) => ({
  id, articulo_id: `a-${id}`, cantidad, cantidad_preparada: 0, estado_item: "PENDIENTE" as const, es_bonificado: false, precio_base: 100, excluye_bonif: false,
  articulos: { id: `a-${id}`, sku: id, descripcion: `Art ${id}`, ean13: [] }, ...extra,
})
const pedidoReplica = (): any => ({
  id: "p1", numero_pedido: "001", estado: "en_preparacion", fecha: "2026-10-29", prioridad: 3, created_at: "2026-10-29T10:00:00Z",
  bonif_mercaderia_pct: 0, clientes: null, preparadores: { "2": { usuario_id: "yo", usuario_nombre: "Juan" } },
  pedidos_detalle: [detalle("1", 10), detalle("2", 5, { cantidad_preparada: 5, estado_item: "COMPLETO" })],
})

describe("P2-18 · Reiniciar / soltar sin señal (overlay)", () => {
  it("reiniciar deja todo pendiente al instante (lo del servidor y lo sin enviar)", () => {
    const v = vistaPedido(pedidoReplica(), [
      op("picking.item", { pedido_id: "p1", pedido_detalle_id: "1", cantidad_preparada: 10, es_faltante: false, operario: "Juan" }),
      op("picking.reiniciar", { pedido_id: "p1" }),
    ])
    expect(v.pedidos_detalle.map((d) => [d.estado_item, d.cantidad_preparada])).toEqual([["PENDIENTE", 0], ["PENDIENTE", 0]])
    expect(v.preparadores).toEqual({})
    expect(v.progreso).toMatchObject({ resueltos: 0, pendientes: 2 })
  })

  it("lo que se marca DESPUÉS de reiniciar cuenta", () => {
    const v = vistaPedido(pedidoReplica(), [
      op("picking.reiniciar", { pedido_id: "p1" }),
      op("picking.item", { pedido_id: "p1", pedido_detalle_id: "1", cantidad_preparada: 4, es_faltante: false, operario: "Juan" }),
    ])
    expect(v.pedidos_detalle[0]).toMatchObject({ estado_item: "PARCIAL", cantidad_preparada: 4 })
    expect(v.pedidos_detalle[1]).toMatchObject({ estado_item: "PENDIENTE" })
  })

  it("soltar también lo deja todo pendiente; no toca otros pedidos", () => {
    const v = vistaPedido(pedidoReplica(), [op("picking.soltar", { pedido_id: "p1" }), op("picking.soltar", { pedido_id: "OTRO" })])
    expect(v.progreso.resueltos).toBe(0)
    expect(vistaPedido(pedidoReplica(), [op("picking.soltar", { pedido_id: "OTRO" })]).progreso.resueltos).toBe(1)
  })
})
