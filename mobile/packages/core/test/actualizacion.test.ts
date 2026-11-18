import { describe, expect, it, vi } from "vitest"
import { Actualizador, MSJ_INCOMPLETA, MSJ_SIN_SENAL, type PlataformaActualizacion } from "../src/actualizacion/actualizador"
import { codeDelHeader, elegirActualizacion, type FilaVersion } from "../../../../lib/mobile/actualizacion"
import type { RespuestaActualizacion } from "@gm/contrato"

// Actualización de la app con un botón (17/11/2026). MOBILE.md → "Actualización desde la app".

const fila = (code: number, obligatoria = false): FilaVersion => ({
  version_name: `0.${code}.0`, version_code: code, archivo: `vendedor/v${code}.apk`, tamano_bytes: 1000, sha256: "a".repeat(64), notas: null, obligatoria,
})

describe("Servidor: qué versión se ofrece", () => {
  it("la última publicada, solo si es más nueva que la del equipo", () => {
    expect(elegirActualizacion([fila(20), fila(22), fila(21)], 21)?.ultima.version_code).toBe(22)
    expect(elegirActualizacion([fila(20), fila(21)], 21)).toBeNull()
    expect(elegirActualizacion([], 5)).toBeNull()
  })
  it("es obligatoria si alguna de las que le faltan lo es", () => {
    expect(elegirActualizacion([fila(22, true), fila(23)], 21)?.obligatoria).toBe(true)
    expect(elegirActualizacion([fila(21, true), fila(23)], 21)?.obligatoria).toBe(false)
  })
  it("header x-app-version-code", () => {
    expect(codeDelHeader("21")).toBe(21)
    expect(codeDelHeader(null)).toBeNull()
    expect(codeDelHeader("abc")).toBeNull()
    expect(codeDelHeader("0")).toBeNull()
  })
})

const hay = (code = 22, obligatoria = false): RespuestaActualizacion => ({
  hay: true, version_name: "0.4.13", version_code: code, notas: "Arreglos", obligatoria, tamano_bytes: 1000, sha256: "b".repeat(64), url: "https://x/apk",
})
const NADA: RespuestaActualizacion = { hay: false, version_name: null, version_code: null, notas: null, obligatoria: false, tamano_bytes: null, sha256: null, url: null }

function armar(o: { respuesta?: RespuestaActualizacion; permiso?: boolean; descargar?: PlataformaActualizacion["descargar"]; online?: boolean } = {}) {
  let permiso = o.permiso ?? true
  const plataforma: PlataformaActualizacion = {
    puedeInstalar: vi.fn(async () => permiso),
    abrirPermisoInstalar: vi.fn(async () => {}),
    descargar: o.descargar ?? vi.fn(async (_o, alAvanzar) => { alAvanzar(500, 1000); alAvanzar(1000, 1000); return "/cache/actualizacion/x.apk" }),
    instalar: vi.fn(async () => {}),
  }
  let t = 0
  const get = vi.fn(async () => o.respuesta ?? hay())
  const a = new Actualizador({ app: "vendedor", get, online: () => o.online ?? true, autenticado: () => true, plataforma, ahora: () => t })
  return { a, get, plataforma, darPermiso: () => (permiso = true), pasar: (ms: number) => (t += ms) }
}

describe("App: franja y botón ACTUALIZAR", () => {
  it("al abrir pregunta y, si hay versión nueva, queda disponible", async () => {
    const { a, get } = armar()
    await a.chequear()
    expect(get).toHaveBeenCalledWith("/api/mobile/actualizacion?app=vendedor")
    expect(a.estado.fase).toBe("disponible")
    expect(a.estado.info?.version_code).toBe(22)
  })
  it("al día: no muestra nada; sin señal no pregunta", async () => {
    const x = armar({ respuesta: NADA })
    await x.a.chequear()
    expect(x.a.estado.fase).toBe("nada")
    const y = armar({ online: false })
    await y.a.chequear()
    expect(y.get).not.toHaveBeenCalled()
  })
  it("no pregunta dos veces seguidas (abrir + volver a primer plano)", async () => {
    const { a, get, pasar } = armar()
    await a.chequear()
    await a.chequear()
    expect(get).toHaveBeenCalledTimes(1)
    pasar(61_000)
    await a.chequear()
    expect(get).toHaveBeenCalledTimes(2)
  })
  it("ACTUALIZAR: baja con progreso, verifica y abre el instalador", async () => {
    const { a, plataforma } = armar()
    await a.chequear()
    const progresos: Array<number | null> = []
    a.suscribir(() => progresos.push(a.estado.progreso))
    await a.actualizar()
    expect(plataforma.descargar).toHaveBeenCalledWith({ url: "https://x/apk", sha256: "b".repeat(64), nombre: "vendedor-22.apk" }, expect.any(Function))
    expect(progresos).toContain(0.5)
    expect(plataforma.instalar).toHaveBeenCalledWith("/cache/actualizacion/x.apk")
    expect(a.estado.fase).toBe("instalando")
  })
  it("sin permiso: pide PERMITIR y al volver a la app sigue sola", async () => {
    const { a, plataforma, darPermiso } = armar({ permiso: false })
    await a.chequear()
    await a.actualizar()
    expect(a.estado.fase).toBe("permiso")
    expect(plataforma.descargar).not.toHaveBeenCalled()
    await a.alVolver()
    expect(a.estado.fase).toBe("permiso") // todavía no lo dio
    darPermiso()
    await a.alVolver()
    expect(a.estado.fase).toBe("instalando")
  })
  it("sha256 distinto o sin señal: mensaje simple, sin instalar", async () => {
    const sha = armar({ descargar: async () => { throw Object.assign(new Error("x"), { code: "SHA" }) } })
    await sha.a.actualizar()
    expect(sha.a.estado).toMatchObject({ fase: "error", error: MSJ_INCOMPLETA })
    expect(sha.plataforma.instalar).not.toHaveBeenCalled()
    const red = armar({ descargar: async () => { throw Object.assign(new Error("x"), { code: "RED" }) } })
    await red.a.actualizar()
    expect(red.a.estado.error).toBe(MSJ_SIN_SENAL)
  })
  it("Más tarde: se oculta; la obligatoria no se puede posponer", async () => {
    const x = armar()
    await x.a.chequear()
    x.a.posponer()
    expect(x.a.estado.pospuesta).toBe(true)
    const y = armar({ respuesta: hay(22, true) })
    await y.a.chequear()
    y.a.posponer()
    expect(y.a.estado.pospuesta).toBe(false)
  })
  it("si canceló el cartel de Android, al volver puede reintentar", async () => {
    const { a } = armar()
    await a.chequear()
    await a.actualizar()
    expect(a.estado.fase).toBe("instalando")
    await a.alVolver()
    expect(a.estado.fase).toBe("disponible")
  })
})
