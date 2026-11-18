// Tanda 1-C — app Depósito, recepción: una línea con menos de lo pedido no es "completa"
// (E-92), el resumen que se muestra antes de finalizar con faltantes (E-93), el control de
// bultos que no se registra a medias, y el aviso de la barra cuando venció la sesión.
import { describe, expect, it } from "vitest"
import { lineaIncompleta, resumenCierre, textoFalta, unidadesFaltantes, vistaRecepcion } from "../../../apps/deposito/src/datos/overlay"
import { faltaParaRegistrarBultos } from "../../../apps/deposito/src/datos/borradorBultos"
import { lecturaDeDocumento, LIMITE_SUBIDA_BYTES, megas, motivoNoLeido, nombreTipoComprobante, revisarArchivo } from "../../../apps/deposito/src/datos/documentos"
import type { OrdenRecepcion } from "../../../apps/deposito/src/datasets"
import { avisoErrorSync } from "../src/ui/aviso-sync"

const art = (id: string, descripcion: string, upb: number | null) => ({ id, sku: id, descripcion, unidades_por_bulto: upb })
const orden = (): OrdenRecepcion => ({
  id: "oc1", numero_orden: "OC-000012", estado: "pendiente", fecha_orden: "2026-11-18", proveedores: { id: "p", nombre: "HORNAL" },
  ordenes_compra_detalle: [
    { id: "d1", cantidad_pedida: 2, tipo_cantidad: "bulto", articulo_id: "film", articulos: art("film", "ROLLO FILM", 36) },
    { id: "d2", cantidad_pedida: 10, tipo_cantidad: "unidad", articulo_id: "tapa", articulos: art("tapa", "TAPA", 6) },
    { id: "d3", cantidad_pedida: 1, tipo_cantidad: "bulto", articulo_id: "vaso", articulos: art("vaso", "VASO", 50) },
  ],
  recepcion: null,
})
const op = (payload: Record<string, unknown>) =>
  ({ idempotency_key: Math.random().toString(), tipo: "recepcion.item", payload: { orden_compra_id: "oc1", ...payload }, estado: "pendiente" }) as never
const vista = (...ops: Record<string, unknown>[]) => vistaRecepcion(orden(), ops.map(op), () => undefined)
const linea = (v: ReturnType<typeof vista>, id: string) => v.lineas.find((l) => l.articulo_id === id)!

describe("línea con menos de lo pedido (E-92)", () => {
  it("1 de 2 bultos de 36 u: incompleta, faltan 36 u = 1 bulto", () => {
    const l = linea(vista({ articulo_id: "film", cantidad_fisica: 1 }), "film")
    expect(l.estado_linea).toBe("ok") // el servidor la sigue llamando "ok": por eso se pintaba verde
    expect(lineaIncompleta(l)).toBe(true)
    expect(unidadesFaltantes(l)).toBe(36)
    expect(textoFalta(l)).toBe("1 bulto (36 u)")
  })

  it("completa, o con de más: no es incompleta", () => {
    expect(lineaIncompleta(linea(vista({ articulo_id: "film", cantidad_fisica: 2 }), "film"))).toBe(false)
    const deMas = linea(vista({ articulo_id: "film", cantidad_fisica: 3 }), "film")
    expect([lineaIncompleta(deMas), unidadesFaltantes(deMas)]).toEqual([false, 0])
  })

  it("contada en unidades sueltas contra una línea por bulto: falta lo que falta en unidades", () => {
    const l = linea(vista({ articulo_id: "film", cantidad_fisica: 50, unidad: "unidad" }), "film")
    expect([lineaIncompleta(l), unidadesFaltantes(l), textoFalta(l)]).toEqual([true, 22, "22 u"])
  })

  it("línea por unidad: 7 de 10", () => {
    const l = linea(vista({ articulo_id: "tapa", cantidad_fisica: 7 }), "tapa")
    expect([lineaIncompleta(l), textoFalta(l)]).toEqual([true, "3 u"])
  })

  it("marcada faltante: falta todo lo pedido; sin contar o no pedida: no falta nada", () => {
    const v = vista({ articulo_id: "vaso", cantidad_fisica: 0 }, { articulo_id: "otro", cantidad_fisica: 4 })
    expect([unidadesFaltantes(linea(v, "vaso")), textoFalta(linea(v, "vaso")), lineaIncompleta(linea(v, "vaso"))]).toEqual([50, "1 bulto (50 u)", false])
    expect(unidadesFaltantes(linea(v, "film"))).toBe(0) // pendiente
    expect([linea(v, "otro").fuera_de_oc, unidadesFaltantes(linea(v, "otro"))]).toEqual([true, 0])
  })
})

describe("resumen antes de finalizar (E-93)", () => {
  it("con faltantes: dice qué llegó y qué falta de cada artículo", () => {
    const r = resumenCierre(vista(
      { articulo_id: "film", cantidad_fisica: 1 },
      { articulo_id: "tapa", cantidad_fisica: 10 },
      { articulo_id: "vaso", cantidad_fisica: 0 },
      { articulo_id: "otro", cantidad_fisica: 4 },
    ))
    expect(r).toMatchObject({ completas: 1, fueraDeOC: 1, pendientes: 0, hayFaltantes: true })
    expect(r.incompletas).toEqual([{ articulo_id: "film", descripcion: "ROLLO FILM", llego: "1 bulto", falta: "1 bulto (36 u)" }])
    expect(r.noLlegaron).toEqual([{ articulo_id: "vaso", descripcion: "VASO", llego: "nada", falta: "1 bulto (50 u)" }])
  })

  it("todo completo: sin faltantes (finaliza sin preguntar)", () => {
    const r = resumenCierre(vista({ articulo_id: "film", cantidad_fisica: 2 }, { articulo_id: "tapa", cantidad_fisica: 12 }, { articulo_id: "vaso", cantidad_fisica: 1 }))
    expect(r).toMatchObject({ completas: 3, hayFaltantes: false, pendientes: 0 })
    expect([r.incompletas, r.noLlegaron]).toEqual([[], []])
  })

  it("con líneas sin contar: las informa (no se puede finalizar)", () => {
    expect(resumenCierre(vista({ articulo_id: "film", cantidad_fisica: 2 })).pendientes).toBe(2)
  })
})

describe("control de bultos: no se registra a medias", () => {
  it("hacen falta los dos números", () => {
    expect(faltaParaRegistrarBultos({ declarados: "", recibidos: "", obs: "" })).toMatch(/remito y los que contaste/)
    expect(faltaParaRegistrarBultos({ declarados: "20", recibidos: "", obs: "" })).toMatch(/contaste/)
    expect(faltaParaRegistrarBultos({ declarados: "", recibidos: "20", obs: "" })).toMatch(/remito/)
    expect(faltaParaRegistrarBultos({ declarados: "0", recibidos: "0", obs: "" })).toMatch(/más de cero/)
  })
  it("coinciden: listo. No coinciden: pide la observación", () => {
    expect(faltaParaRegistrarBultos({ declarados: "20", recibidos: "20", obs: "" })).toBeNull()
    expect(faltaParaRegistrarBultos({ declarados: "20", recibidos: "18", obs: "  " })).toMatch(/qué pasó/)
    expect(faltaParaRegistrarBultos({ declarados: "20", recibidos: "18", obs: "faltan 2 cajas" })).toBeNull()
    expect(faltaParaRegistrarBultos({ declarados: "20", recibidos: "0", obs: "no llegó nada" })).toBeNull()
  })
})

describe("aviso de la barra de datos", () => {
  it("sesión vencida: dice que hay que volver a ingresar", () => {
    expect(avisoErrorSync("La sesión expiró. Volvé a ingresar.", { sinSesion: false, online: true })).toBe(" · Sesión vencida: volvé a ingresar")
    expect(avisoErrorSync("HTTP 401", { sinSesion: false, online: true })).toBe(" · Sesión vencida: volvé a ingresar")
    expect(avisoErrorSync(null, { sinSesion: true, online: true })).toBe(" · Sesión vencida: volvé a ingresar")
  })
  it("otros errores: sin señal o intento fallido; sin error, nada", () => {
    expect(avisoErrorSync("Failed to fetch", { sinSesion: false, online: false })).toMatch(/sin señal/)
    expect(avisoErrorSync("HTTP 500", { sinSesion: false, online: true })).toBe(" · último intento falló")
    expect(avisoErrorSync(undefined, { sinSesion: false, online: true })).toBe("")
  })
})

describe("documentos de la recepción (E-38)", () => {
  it("lo que leyó el sistema: tipo, número, total y renglones", () => {
    const l = lecturaDeDocumento({ id: "d", procesado: true, datos_ocr: { comprobante: { tipo_comprobante: "FA", numero_comprobante: "0003-00045711", total_factura: 218969.34 }, items: [{}, {}, {}] } })
    expect(l).toEqual({ estado: "leido", tipo: "Factura A", numero: "0003-00045711", total: 218969.34, renglones: 3, motivo: null })
  })
  it("no leído: lo dice en castellano, nunca el error crudo del lector", () => {
    const l = lecturaDeDocumento({ id: "d", procesado: false, datos_ocr: { no_leido: true, motivo: "[GoogleGenerativeAI Error]: 402 Payment Required: quota exceeded" } })
    expect(l.estado).toBe("no_leido")
    expect(l.motivo).toMatch(/lector automático no está disponible/)
    expect(l.motivo).not.toMatch(/Google|quota|402/)
    expect(motivoNoLeido("Sin renglones")).toMatch(/Sacala de nuevo/)
    expect(motivoNoLeido("fetch failed: timeout")).toMatch(/tardó demasiado/)
    expect(motivoNoLeido(null)).toMatch(/No se pudo leer/)
  })
  it("foto de respaldo: adjunta, sin lectura", () => {
    expect(lecturaDeDocumento({ id: "d", procesado: true, datos_ocr: null }).estado).toBe("adjunto")
    expect(lecturaDeDocumento({ id: "d", procesado: true, datos_ocr: { items: [] } }).estado).toBe("adjunto")
  })
  it("nombres de tipo de comprobante", () => {
    expect([nombreTipoComprobante("Remito"), nombreTipoComprobante("Adquisicion"), nombreTipoComprobante("NCA"), nombreTipoComprobante("otro"), nombreTipoComprobante("")]).toEqual(["Remito", "Adquisición", "Nota de crédito A", "otro", null])
  })
  it("qué archivos se aceptan: fotos (se achican después) y PDF de hasta 4 MB", () => {
    expect(revisarArchivo({ type: "image/jpeg", name: "f.jpg", size: 6_000_000 })).toEqual({ ok: true, esImagen: true, esPdf: false })
    expect(revisarArchivo({ type: "application/pdf", name: "factura.pdf", size: 900_000 })).toEqual({ ok: true, esImagen: false, esPdf: true })
    expect(revisarArchivo({ type: "", name: "FACTURA.PDF", size: 900_000 })).toMatchObject({ ok: true, esPdf: true })
    const grande = revisarArchivo({ type: "application/pdf", name: "f.pdf", size: LIMITE_SUBIDA_BYTES + 1 })
    expect(grande.ok).toBe(false)
    expect((grande as { motivo: string }).motivo).toMatch(/máximo es 4 MB/)
    expect(revisarArchivo({ type: "application/zip", name: "x.zip", size: 10 })).toMatchObject({ ok: false })
    expect(revisarArchivo({ type: "image/png", name: "x.png", size: 0 })).toMatchObject({ ok: false })
    expect(megas(3_355_443)).toBe("3,2 MB")
  })
})
