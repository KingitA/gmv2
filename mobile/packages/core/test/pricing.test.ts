import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  aplicarProgramados,
  precioArticuloParaCliente,
  prepararMotorCliente,
  proximaVigencia,
  reconstruirAFecha,
  type ArticuloMotor,
  type CambioProgramado,
  type InsumosCliente,
  type VersionHistorial,
} from "@gm/pricing"

// Insumos de ejemplo (formas iguales a las que devuelve /api/mobile/sync/precios_*)
const LISTA_NECO = { id: "L-neco", codigo: "neco", recargo_limpieza_bazar: 20, recargo_perfumeria_negro: 10, recargo_perfumeria_blanco: 15 }
const LISTA_VIAJ = { id: "L-viaj", codigo: "viajante", recargo_limpieza_bazar: 30, recargo_perfumeria_negro: 0, recargo_perfumeria_blanco: 0 }
const LISTA_ESP = { id: "L-esp", codigo: "especial", recargo_limpieza_bazar: 0, recargo_perfumeria_negro: 0, recargo_perfumeria_blanco: 0 }

const insumos = (extra: Partial<InsumosCliente> = {}): InsumosCliente => ({
  cliente: { lista_precio_id: "L-neco", metodo_facturacion: "Factura" },
  listas: [LISTA_NECO, LISTA_VIAJ, LISTA_ESP],
  reglas: [],
  condicionesProveedor: [],
  condicionesMarca: [],
  bonificaciones: [],
  ...extra,
})

const art = (extra: Partial<ArticuloMotor> = {}): ArticuloMotor => ({
  id: "A1",
  precio_compra: 0,
  precio_base: 1000,
  categoria: "LIMPIEZA",
  iva_compras: "factura",
  iva_ventas: "factura",
  descuentos: [],
  proveedor_id: "P1",
  marca_id: "M1",
  ...extra,
})

describe("Motor de precios isomórfico", () => {
  it("lista + método Factura: neto con recargo + IVA 21%", () => {
    const p = precioArticuloParaCliente(insumos(), art())
    expect(p.precioNeto).toBe(1200)
    expect(p.precio).toBe(1452)
    expect(p.contado).toBe(1306.8)
    expect(p.listaId).toBe("L-neco")
    expect(p.vaEnComprobante).toBe("factura")
  })

  it("bonificación general y viajante escalonadas sobre el neto", () => {
    const p = precioArticuloParaCliente(
      insumos({ bonificaciones: [{ tipo: "general", segmento: null, porcentaje: 10 }, { tipo: "viajante", segmento: "limpieza_bazar", porcentaje: 5 }] }),
      art(),
    )
    expect(p.precioNeto).toBe(1026) // 1200 × 0,9 × 0,95
    expect(p.precio).toBe(1241.46)
    expect(p.bonifViajantePct).toBe(5)
  })

  it("override 'solo este pedido' pisa la ficha por segmento", () => {
    const base = insumos({ bonificaciones: [{ tipo: "viajante", segmento: null, porcentaje: 5 }] })
    const p = precioArticuloParaCliente(base, art(), { bonif_pedido: { viajante: { limpieza_bazar: 0 } } })
    expect(p.precioNeto).toBe(1200)
  })

  it("condición por MARCA gana sobre PROVEEDOR", () => {
    const c = (lista: string, gen: number) => ({ lista_precio_id: lista, metodo_facturacion: "Factura", dto_general_pct: gen, dto_viajante_pct: null, dto_mercaderia_pct: null })
    const p = precioArticuloParaCliente(
      insumos({ condicionesProveedor: [{ ...c("L-neco", 50), proveedor_id: "P1" }], condicionesMarca: [{ ...c("L-viaj", 0), marca_id: "M1" }] }),
      art(),
    )
    expect(p.listaId).toBe("L-viaj")
    expect(p.precioNeto).toBe(1300)
  })

  it("centinela 'por segmento' no llega como lista concreta", () => {
    const p = precioArticuloParaCliente(
      insumos({ cliente: { lista_precio_id: "L-neco", lista_limpieza_id: "L-viaj", metodo_facturacion: "Factura" } }),
      art(),
      { lista_precio_pedido_id: "__por_segmento__" },
    )
    expect(p.listaId).toBe("L-viaj")
  })

  it("Lista Especial: neto fijo + IVA, sin contado ni bonificaciones", () => {
    const p = precioArticuloParaCliente(
      insumos({ cliente: { lista_precio_id: "L-esp", metodo_facturacion: "Final" }, bonificaciones: [{ tipo: "general", segmento: null, porcentaje: 10 }] }),
      art({ precio_lista_especial: 800, oferta_lista_especial: 20 }),
    )
    expect(p.precioNeto).toBe(800)
    expect(p.precio).toBe(968)
    expect(p.contado).toBe(968)
    expect(p.especial).toEqual({ bruto: 1000, oferta_pct: 20 })
  })

  it("fórmulas configurables (listas_precio_reglas) tienen prioridad sobre el recargo", () => {
    const p = precioArticuloParaCliente(
      insumos({ reglas: [{ grupo_precio: "LIMPIEZA_BAZAR", iva_compras: "factura", iva_ventas: "factura", formulas: { neco_con_iva: "Base*1.21*1.5" } }] }),
      art(),
    )
    expect(p.precio).toBe(1815) // 1000×1,21×1,5 = 1815 (con IVA); neto = 1500
    expect(p.precioNeto).toBe(1500)
  })

  it("prepararMotorCliente y precioArticuloParaCliente dan exactamente lo mismo", () => {
    const ins = insumos({ bonificaciones: [{ tipo: "general", segmento: null, porcentaje: 7.5 }] })
    const motor = prepararMotorCliente(ins)
    for (const a of [art(), art({ id: "A2", precio_base: 1234.56, categoria: "PERFUMERIA", iva_ventas: "presupuesto" })]) {
      expect(motor.precio(a)).toEqual(precioArticuloParaCliente(ins, a))
    }
  })
})

describe("Vigencia de precios", () => {
  const prog = (id: string, registro_id: string, cambios: Record<string, unknown>, vigencia: string): CambioProgramado => ({
    id, tabla: "articulos", registro_id, cambios, vigencia_desde: vigencia, estado: "pendiente",
  })

  it("aplica los programados solo al llegar la vigencia, en orden cronológico", () => {
    const filas = [art()]
    const ps = [prog("p2", "A1", { precio_base: 1300 }, "2026-09-20T11:00:00Z"), prog("p1", "A1", { precio_base: 1100 }, "2026-09-20T10:00:00Z")]
    expect(aplicarProgramados(filas, ps, "articulos", "2026-09-20T09:59:59Z")[0].precio_base).toBe(1000)
    expect(aplicarProgramados(filas, ps, "articulos", "2026-09-20T10:00:00Z")[0].precio_base).toBe(1100)
    expect(aplicarProgramados(filas, ps, "articulos", "2026-09-20T12:00:00Z")[0].precio_base).toBe(1300)
    expect(proximaVigencia(ps, new Date("2026-09-20T10:30:00Z"))?.toISOString()).toBe("2026-09-20T11:00:00.000Z")
  })

  it("reconstruye filas vigentes a una fecha desde el historial", () => {
    const actuales = [{ id: "A1", precio_base: 1300 }, { id: "A3", precio_base: 50 }]
    const hist: VersionHistorial<any>[] = [
      { tabla: "articulos", registro_id: "A1", datos: { id: "A1", precio_base: 1000 }, vigente_desde: "2000-01-01T00:00:00Z", vigente_hasta: "2026-09-20T10:00:00Z" },
      { tabla: "articulos", registro_id: "A1", datos: { id: "A1", precio_base: 1300 }, vigente_desde: "2026-09-20T10:00:00Z", vigente_hasta: null },
      { tabla: "articulos", registro_id: "A2", datos: { id: "A2", precio_base: 77 }, vigente_desde: "2000-01-01T00:00:00Z", vigente_hasta: "2026-09-20T12:00:00Z" },
      { tabla: "articulos", registro_id: "A3", datos: { id: "A3", precio_base: 50 }, vigente_desde: "2026-09-20T11:00:00Z", vigente_hasta: null },
    ]
    const a = (f: string) => Object.fromEntries(reconstruirAFecha(actuales, hist, f).map((r: any) => [r.id, r.precio_base]))
    expect(a("2026-09-20T09:00:00Z")).toEqual({ A1: 1000, A2: 77 }) // A3 no existía; A2 existía (borrado después)
    expect(a("2026-09-20T11:30:00Z")).toEqual({ A1: 1300, A2: 77, A3: 50 })
    expect(a("2026-09-20T13:00:00Z")).toEqual({ A1: 1300, A3: 50 })
  })

  it("dispositivo offline con programado = servidor tras materializar (mismo precio a la fecha de captura)", () => {
    const captura = "2026-09-20T10:05:00Z"
    // Dispositivo: réplica vieja (precio_base 1000) + programado descargado de antemano
    const dispositivoArt = aplicarProgramados([art()], [prog("p1", "A1", { precio_base: 1100 }, "2026-09-20T10:00:00Z")], "articulos", captura)[0]
    const enDispositivo = precioArticuloParaCliente(insumos(), dispositivoArt)
    // Servidor: ya materializó (tabla = 1100) y el historial registra la vigencia programada
    const hist: VersionHistorial<any>[] = [
      { tabla: "articulos", registro_id: "A1", datos: { id: "A1", precio_base: 1000 }, vigente_desde: "2000-01-01T00:00:00Z", vigente_hasta: "2026-09-20T10:00:00Z" },
      { tabla: "articulos", registro_id: "A1", datos: { id: "A1", precio_base: 1100 }, vigente_desde: "2026-09-20T10:00:00Z", vigente_hasta: null },
    ]
    const servidorArt = reconstruirAFecha([art({ precio_base: 1100 })], hist, captura)[0]
    const enServidor = precioArticuloParaCliente(insumos(), servidorArt)
    expect(enServidor).toEqual(enDispositivo)
    expect(enDispositivo.precioNeto).toBe(1320)
  })
})

describe("Frontera del paquete de precios", () => {
  it("lib/pricing/isomorfico.ts y sus dependencias solo importan archivos de lib/pricing (sin DB/Next/React)", () => {
    const aqui = dirname(fileURLToPath(import.meta.url))
    const raiz = resolve(aqui, "../../../../lib/pricing")
    const vistos = new Set<string>()
    const visitar = (archivo: string) => {
      if (vistos.has(archivo)) return
      vistos.add(archivo)
      const src = readFileSync(archivo, "utf8")
      for (const m of src.matchAll(/(?:import|export)[^'"]*from\s+["']([^"']+)["']/g)) {
        const spec = m[1]
        expect(spec.startsWith("./"), `${archivo} importa "${spec}"`).toBe(true)
        visitar(resolve(dirname(archivo), spec.endsWith(".ts") ? spec : `${spec}.ts`))
      }
    }
    visitar(resolve(raiz, "isomorfico.ts"))
    expect(vistos.size).toBeGreaterThanOrEqual(7)
  })
})
