// Tanda 1-C — app Depósito, recepción: una línea con menos de lo pedido no es "completa"
// (E-92), el resumen que se muestra antes de finalizar con faltantes (E-93), el control de
// bultos que no se registra a medias, y el aviso de la barra cuando venció la sesión.
import { describe, expect, it } from "vitest"
import { lineaIncompleta, resumenCierre, textoFalta, unidadesFaltantes, vistaRecepcion } from "../../../apps/deposito/src/datos/overlay"
import { faltaParaRegistrarBultos } from "../../../apps/deposito/src/datos/borradorBultos"
import { documentoCompleto, documentosEnCola, enviosDeDocumento, lecturaDeDocumento, LIMITE_SUBIDA_BYTES, megas, motivoNoLeido, nombreTipoComprobante, repartirEnEnvios, revisarArchivo, type HojaLocal } from "../../../apps/deposito/src/datos/documentos"
import { documentoCompleto as completoServidor, documentoParaApp, hojasDeDocumento, motivoParaOperario, tandasDeLectura, unirLecturas, validarEnvioDocumento } from "../../../../lib/deposito/documentos-reglas"
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

describe("varias hojas = un documento, por partes y con cola (E-38)", () => {
  const hoja = (n: number, peso: number, mime = "image/jpeg"): HojaLocal => ({ id: `h${n}`, nombre: `hoja-${n}.jpg`, mime, base64: "A".repeat(peso) })
  const OC = "11111111-1111-4111-8111-111111111111"
  const DOC = "22222222-2222-4222-8222-222222222222"

  it("tres hojas que entran en un envío: un solo envío, en orden", () => {
    const r = repartirEnEnvios([hoja(1, 100), hoja(2, 100), hoja(3, 100)], 1000)
    expect(r).toMatchObject({ ok: true })
    expect((r as { grupos: HojaLocal[][] }).grupos.map((g) => g.map((h) => h.id))).toEqual([["h1", "h2", "h3"]])
  })

  it("si no entran, se parten en varios envíos del MISMO documento, sin cambiar el orden", () => {
    const r = repartirEnEnvios([hoja(1, 600), hoja(2, 500), hoja(3, 400), hoja(4, 700)], 1000) as { ok: true; grupos: HojaLocal[][] }
    expect(r.grupos.map((g) => g.map((h) => h.id))).toEqual([["h1"], ["h2", "h3"], ["h4"]])
    const envios = enviosDeDocumento({ orden_compra_id: OC, documento_local_id: DOC, tipo_documento: "factura", grupos: r.grupos })
    expect(envios.map((e) => [e.documento_local_id, e.parte, e.partes, e.hojas.length])).toEqual([[DOC, 0, 3, 1], [DOC, 1, 3, 2], [DOC, 2, 3, 1]])
    // cada envío pasa la validación del servidor
    expect(envios.map((e) => validarEnvioDocumento(e))).toEqual([null, null, null])
  })

  it("una hoja sola que pasa el tope no se puede enviar; sin hojas tampoco", () => {
    expect(repartirEnEnvios([hoja(1, 100), hoja(2, 2000)], 1000)).toEqual({ ok: false, motivo: "La hoja 2 pesa demasiado para enviarse. Sacala de nuevo." })
    expect(repartirEnEnvios([], 1000).ok).toBe(false)
  })

  it("el servidor rechaza un envío mal formado", () => {
    const base = { orden_compra_id: OC, documento_local_id: DOC, tipo_documento: "factura", hojas: [{ nombre: "a.jpg", mime: "image/jpeg", base64: "AAAA" }] }
    expect(validarEnvioDocumento(base)).toBeNull()
    expect(validarEnvioDocumento({ ...base, orden_compra_id: "x" })).toMatch(/Orden/)
    expect(validarEnvioDocumento({ ...base, documento_local_id: "" })).toMatch(/identificador/)
    expect(validarEnvioDocumento({ ...base, tipo_documento: "contrato" })).toMatch(/Tipo/)
    expect(validarEnvioDocumento({ ...base, hojas: [] })).toMatch(/no tiene hojas/)
    expect(validarEnvioDocumento({ ...base, hojas: [{ nombre: "x.exe", mime: "application/zip", base64: "AA" }] })).toMatch(/foto ni un PDF/)
    expect(validarEnvioDocumento({ ...base, parte: 2, partes: 2 })).toMatch(/Número de envío/)
    expect(validarEnvioDocumento({ ...base, hojas: [{ nombre: "a.jpg", mime: "image/jpeg", base64: "A".repeat(3_700_001) }] })).toMatch(/pesa demasiado/)
  })

  it("documento completo recién cuando llegaron todas las partes (app y servidor dicen lo mismo)", () => {
    const parcial = { partes_esperadas: 2, hojas: [{ path: "a", parte: 0, orden: 0 }, { path: "b", parte: 0, orden: 1 }] }
    const entero = { partes_esperadas: 2, hojas: [...parcial.hojas, { path: "c", parte: 1, orden: 0 }] }
    expect([documentoCompleto(parcial), completoServidor(parcial)]).toEqual([false, false])
    expect([documentoCompleto(entero), completoServidor(entero)]).toEqual([true, true])
    expect(documentoCompleto({ hojas: null, partes_esperadas: null })).toBe(true) // documento de antes
    expect(completoServidor({ storage_path: "viejo.jpg" })).toBe(true)
  })

  it("las hojas se leen en orden: por parte y después por orden; un documento viejo tiene una sola", () => {
    const doc = { hojas: [{ path: "p1-0", nombre: "h3", mime: "image/jpeg", parte: 1, orden: 0 }, { path: "p0-1", nombre: "h2", mime: "image/jpeg", parte: 0, orden: 1 }, { path: "p0-0", nombre: "h1", mime: "image/jpeg", parte: 0, orden: 0 }] }
    expect(hojasDeDocumento(doc).map((h) => h.nombre)).toEqual(["h1", "h2", "h3"])
    expect(hojasDeDocumento({ storage_path: "rec/1.jpg", nombre_archivo: "foto.jpg", tipo_mime: "image/jpeg" })).toEqual([{ path: "rec/1.jpg", nombre: "foto.jpg", mime: "image/jpeg" }])
    expect(hojasDeDocumento({})).toEqual([])
  })

  it("subido y sin leer: pendiente; faltan partes: incompleto; factura repetida: lo dice", () => {
    const pendiente = { id: "d", tipo_documento: "factura", procesado: false, lectura_estado: "pendiente", partes_esperadas: 1, hojas: [{ path: "a", parte: 0, orden: 0 }] }
    expect(lecturaDeDocumento(pendiente).estado).toBe("pendiente")
    expect(lecturaDeDocumento({ ...pendiente, partes_esperadas: 2 }).estado).toBe("incompleto")
    const dup = lecturaDeDocumento({ ...pendiente, lectura_estado: "duplicado", datos_ocr: { duplicado: true, motivo: "La FA 0003-00045711 de este proveedor ya está cargada en esta orden." } })
    expect([dup.estado, dup.motivo]).toEqual(["duplicado", "La FA 0003-00045711 de este proveedor ya está cargada en esta orden."])
    expect(lecturaDeDocumento({ id: "d", tipo_documento: "foto", procesado: true, lectura_estado: "leido", datos_ocr: null }).estado).toBe("adjunto")
  })

  it("la cola del equipo: un renglón por documento aunque viaje en varias partes", () => {
    const op = (key: string, estado: string, parte: number, hojas: number, doc = DOC, orden = OC) =>
      ({ key, tipo: "recepcion.documento", estado, error: estado === "rechazado" ? "tipo desconocido" : null, payload: { orden_compra_id: orden, documento_local_id: doc, tipo_documento: "factura", parte, partes: 2, hojas: Array(hojas).fill({}) } })
    const cola = documentosEnCola([
      op("k1", "enviando", 0, 2), op("k2", "pendiente", 1, 1),
      op("k3", "pendiente", 0, 1, "33333333-3333-4333-8333-333333333333", "otra-orden"),
      { key: "k4", tipo: "recepcion.item", estado: "pendiente", payload: { orden_compra_id: OC } },
    ], OC)
    expect(cola).toEqual([{ documento_local_id: DOC, tipo_documento: "factura", hojas: 3, partes: 2, estado: "enviando", error: null, claves: ["k1", "k2"] }])
    expect(documentosEnCola([op("k1", "rechazado", 0, 1)], OC)[0]).toMatchObject({ estado: "rechazado", error: "tipo desconocido" })
  })
})

describe("lectura: tandas por peso, unión, motivo en castellano y app vieja (revisión T1-C)", () => {
  const MB = 1024 * 1024

  it("lo normal es una sola lectura con todas las hojas", () => {
    expect(tandasDeLectura([2 * MB, 2 * MB, 2 * MB])).toEqual([[0, 1, 2]])
    expect(tandasDeLectura([])).toEqual([])
  })

  it("si pesan más que el tope del lector se leen en tandas, en orden; una hoja enorme va sola", () => {
    expect(tandasDeLectura([5, 5, 5, 5, 5], 12)).toEqual([[0, 1], [2, 3], [4]])
    expect(tandasDeLectura([20, 3, 3], 12)).toEqual([[0], [1, 2]])
    // 30 hojas de 2,5 MB con el tope real: ninguna tanda pasa los 12 MB
    const pesos = Array(30).fill(2.5 * MB)
    const tandas = tandasDeLectura(pesos)
    expect(tandas.flat()).toEqual(pesos.map((_, i) => i))
    expect(Math.max(...tandas.map((t) => t.length * 2.5 * MB))).toBeLessThanOrEqual(12 * MB)
  })

  it("unir tandas: todos los renglones, cabecera de la primera hoja y totales de la última", () => {
    const u = unirLecturas([
      { items: [{ d: "a" }, { d: "b" }], comprobante: { numero_comprobante: "0003-00045711", tipo_comprobante: "FA", fecha: "2026-11-17", total_factura: null, total_iva: 0 }, avisos: ["uno"] },
      { items: [{ d: "c" }], comprobante: { numero_comprobante: null, tipo_comprobante: null, fecha: null, total_factura: 121000, total_iva: 21000 } },
    ])
    expect(u.items).toEqual([{ d: "a" }, { d: "b" }, { d: "c" }])
    expect(u.comprobante).toEqual({ numero_comprobante: "0003-00045711", tipo_comprobante: "FA", fecha: "2026-11-17", total_factura: 121000, total_iva: 21000 })
    expect(u.avisos?.[0]).toBe("uno")
    expect(u.avisos?.[1]).toMatch(/2 tandas/)
  })

  it("una sola lectura vuelve igual; si una tanda falla, falla todo (no hay comprobante a medias)", () => {
    const una = { items: [{ d: "a" }], comprobante: null }
    expect(unirLecturas([una])).toBe(una)
    const u = unirLecturas([{ items: [{ d: "a" }] }, { items: [], error: "Request payload size exceeds the limit" }])
    expect(u.items).toEqual([])
    expect(u.error).toMatch(/tanda 2 de 2: Request payload/)
  })

  it("el operario nunca ve el error crudo del lector", () => {
    for (const crudo of ["[400 Bad Request] Request payload size exceeds the limit", "429 RESOURCE_EXHAUSTED quota", "fetch failed", "La lectura automática no encontró ningún renglón en el documento.", "algo raro"]) {
      const m = motivoParaOperario(crudo)
      expect(m).not.toContain(crudo)
      expect(m).toMatch(/^(No se|El lector)/)
    }
    expect(motivoParaOperario("La lectura automática no encontró ningún renglón en el documento.")).toMatch(/No se encontraron renglones/)
    expect(motivoParaOperario("La lectura automática falló: [400 Bad Request] payload too large")).toMatch(/no aceptó el documento/)
  })

  it("la app usa el motivo en castellano que manda el servidor", () => {
    const l = lecturaDeDocumento({ id: "d", tipo_documento: "factura", procesado: false, lectura_estado: "no_leido", datos_ocr: { items: [], no_leido: true, motivo: "[400 Bad Request] x", motivo_operario: "El lector no aceptó el documento." } })
    expect([l.estado, l.motivo]).toEqual(["no_leido", "El lector no aceptó el documento."])
  })

  it("una lectura que quedó a medias (comprobante vinculado, sin terminar) se ve como pendiente, no como leída", () => {
    const aMedias = { id: "d", tipo_documento: "factura", procesado: false, comprobante_id: "c1", lectura_estado: "pendiente", partes_esperadas: 1, hojas: [{ path: "a", parte: 0, orden: 0 }] }
    expect(lecturaDeDocumento(aMedias).estado).toBe("pendiente")
    expect(lecturaDeDocumento({ ...aMedias, lectura_estado: "leyendo" }).estado).toBe("pendiente")
  })

  it("una app vieja ve el documento pendiente como NO leído (no como leído ni como foto de respaldo)", () => {
    const pendiente = { id: "d", tipo_documento: "factura", procesado: false, lectura_estado: "pendiente", datos_ocr: null }
    const servido = documentoParaApp(pendiente)
    expect(servido.datos_ocr).toMatchObject({ no_leido: true, pendiente_de_lectura: true })
    // lo que hacía la v0.5.4 con eso (sin lectura_estado): "no leído"
    expect(lecturaDeDocumento({ id: "d", tipo_documento: "factura", procesado: false, datos_ocr: servido.datos_ocr as never }).estado).toBe("no_leido")
    // la app nueva sigue viendo "pendiente"
    expect(lecturaDeDocumento({ ...(servido as never as typeof pendiente), partes_esperadas: 1, hojas: [{ path: "a", parte: 0, orden: 0 }] } as never).estado).toBe("pendiente")
    // lo ya leído, lo no leído de verdad y los documentos de antes no se tocan
    const leido = { lectura_estado: "leido", procesado: true, datos_ocr: { items: [1] } }
    expect(documentoParaApp(leido)).toBe(leido)
    const viejo = { lectura_estado: null, procesado: false, datos_ocr: null }
    expect(documentoParaApp(viejo)).toBe(viejo)
  })
})
