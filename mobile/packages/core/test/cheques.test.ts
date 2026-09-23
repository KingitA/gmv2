// Foto de cheques: validación del OCR (nunca inventar), fila que no bloquea (OCR
// caído ⇒ carga manual) y consulta BCRA desacoplada (cobro cierra igual, aviso después).
import { describe, expect, it } from "vitest"
import {
  aplicarOcr,
  avisosBcraPendientes,
  bcraError,
  bcraSinAntecedentes,
  cuitValido,
  editarCampo,
  faltantes,
  filaDesdeFoto,
  interpretarRespuestaBcra,
  marcarFalloOcr,
  normalizarCuit,
  normalizarFecha,
  normalizarMonto,
  resultadoConDatos,
  sanearCheque,
  urlsDeFotos,
  veredictoBcra,
  vinoDelOcr,
  type ConsultaBcraResultado,
  type ResultadoOcr,
} from "@gm/cheques"
import { Outbox } from "../src/sync/outbox"
import { apiFalsa, dbNueva, type Manejador } from "./helpers"

const HOY = "2026-09-23"

describe("CUIT: solo entra si cierra el dígito verificador", () => {
  it("acepta CUITs válidos en cualquier formato y los normaliza", () => {
    expect(cuitValido("20-12345678-6")).toBe(true) // 20123456786 cierra mod 11
    expect(normalizarCuit("20123456786")).toBe("20-12345678-6")
    expect(normalizarCuit(" 30 71234567 1 ")).toBe("30-71234567-1")
  })
  it("rechaza CUIT con verificador incorrecto, corto, largo o repetido", () => {
    expect(cuitValido("20-12345678-9")).toBe(false)
    expect(cuitValido("2012345678")).toBe(false)
    expect(cuitValido("201234567861")).toBe(false)
    expect(cuitValido("11111111111")).toBe(false)
    expect(normalizarCuit("20-12345678-9")).toBeNull()
  })
  it("sanearCheque descarta el CUIT inválido y NO lo reemplaza por ningún otro número de la imagen", () => {
    const s = sanearCheque(
      { cuit_emisor: "20-12345678-9", numero_cheque: "20123456786", banco_emisor: "Banco Macro", monto: 150000, fecha_cheque: "2026-10-15", cuits_titulares: ["27-99999999-9"] },
      { hoy: HOY },
    )
    expect(s.cuit_emisor).toBeUndefined()
    expect(s.cuits_titulares).toEqual([])
    // el número de cheque (que casualmente cierra mod 11) sigue siendo número de cheque
    expect(s.numero_cheque).toBe("20123456786")
    expect(s.banco).toBe("Banco Macro")
    expect(s.monto).toBe(150000)
    expect(s.fecha_cheque).toBe("2026-10-15")
  })
  it("cuentas conjuntas: solo los titulares válidos, el emisor primero, sin duplicados", () => {
    const s = sanearCheque({ cuit_emisor: "20123456786", cuits_titulares: ["20-12345678-6", "30-71234567-1", "30-00000000-1"] }, { hoy: HOY })
    expect(s.cuits_titulares).toEqual(["20-12345678-6", "30-71234567-1"])
  })
})

describe("fecha y monto: por formato y rango", () => {
  it("fechas en varios formatos, fuera de rango o inexistentes", () => {
    expect(normalizarFecha("2026-10-15", { hoy: HOY })).toBe("2026-10-15")
    expect(normalizarFecha("15/10/2026", { hoy: HOY })).toBe("2026-10-15")
    expect(normalizarFecha("15-10-26", { hoy: HOY })).toBe("2026-10-15")
    expect(normalizarFecha("31/02/2026", { hoy: HOY })).toBeNull()
    expect(normalizarFecha("2019-01-01", { hoy: HOY })).toBeNull()
    expect(normalizarFecha("2099-01-01", { hoy: HOY })).toBeNull()
    expect(normalizarFecha("mañana", { hoy: HOY })).toBeNull()
    // emisión: no puede ser muy futura
    expect(normalizarFecha("2026-12-01", { hoy: HOY, adelanteDias: 7 })).toBeNull()
  })
  it("montos con puntos/comas argentinas, negativos o absurdos", () => {
    expect(normalizarMonto("1.234.567,89")).toBe(1234567.89)
    expect(normalizarMonto("1234567.89")).toBe(1234567.89)
    expect(normalizarMonto("$ 12.500")).toBe(12500)
    expect(normalizarMonto("12,50")).toBe(12.5)
    expect(normalizarMonto(0)).toBeNull()
    expect(normalizarMonto(-5)).toBeNull()
    expect(normalizarMonto(9e12)).toBeNull()
    expect(normalizarMonto("abc")).toBeNull()
  })
  it("cheque común con UNA sola fecha impresa: es la fecha de pago (aunque venga como emisión y sea futura)", () => {
    const s = sanearCheque({ fecha_emision: "2026-10-30", fecha_cheque: null }, { hoy: HOY })
    expect(s.fecha_cheque).toBe("2026-10-30")
    expect(s.fecha_emision).toBe("2026-10-30")
    const d = sanearCheque({ fecha_emision: "2026-09-20", fecha_cheque: "2026-12-15" }, { hoy: HOY })
    expect(d.fecha_cheque).toBe("2026-12-15")
    expect(d.fecha_emision).toBe("2026-09-20")
  })
  it("lo leído y descartado viaja como pista (nunca como dato) y no cuenta como dato válido", () => {
    const s = sanearCheque({ cuit_emisor: "20-12345678-9", fecha_cheque: "31/02/2026" }, { hoy: HOY })
    expect(s.cuit_emisor).toBeUndefined()
    expect(s.descartados).toEqual({ cuit_emisor: "20-12345678-9", fecha_cheque: "31/02/2026" })
    expect(resultadoConDatos({ tipo: "cheque", ...s })).toBe(false)
    const fila = aplicarOcr(filaDesdeFoto("f9", null), { tipo: "cheque", numero_cheque: "123", cuits_titulares: [], descartados: { cuit_emisor: "20-12345678-9" } }, null)
    expect(fila.cuit_emisor).toBe("")
    expect(fila.ocr.pista).toMatch(/20-12345678-9/)
  })
  it("un resultado sin ningún dato válido no genera fila fantasma", () => {
    const s = sanearCheque({ cuit_emisor: "1", monto: "x", fecha_cheque: "ayer" }, { hoy: HOY })
    expect(resultadoConDatos({ tipo: "cheque", ...s })).toBe(false)
  })
})

describe("la foto nunca bloquea: OCR caído => carga manual", () => {
  it("la fila nace al instante con la foto y en leyendo; si el OCR falla queda editable y registrable", () => {
    let fila = filaDesdeFoto("f1", "blob:local")
    expect(fila.ocr.estado).toBe("leyendo")
    expect(fila.ocr.foto_local).toBe("blob:local")
    fila = marcarFalloOcr(fila, "https://bucket/foto.jpg", "timeout")
    expect(fila.ocr.estado).toBe("fallo")
    expect(fila.ocr.foto_url).toBe("https://bucket/foto.jpg")
    expect(fila.ocr.detalle).toMatch(/cargá los datos a mano/i)
    // carga manual sin fricción
    fila = editarCampo(fila, "banco", "Galicia")
    fila = editarCampo(fila, "numero_cheque", "00012345")
    fila = editarCampo(fila, "fecha_cheque", "2026-10-30")
    fila = editarCampo(fila, "monto", 50000)
    expect(faltantes(fila)).toEqual([])
    expect(urlsDeFotos([fila])).toEqual(["https://bucket/foto.jpg"])
  })
  it("si la subida también falló, la fila igual se registra (sin foto)", () => {
    let fila = marcarFalloOcr(filaDesdeFoto("f2", null), null, "sin conexión")
    expect(fila.ocr.detalle).toMatch(/no se pudo subir/i)
    fila = editarCampo(editarCampo(editarCampo(editarCampo(fila, "banco", "Nación"), "numero_cheque", "123"), "fecha_cheque", "2026-10-01"), "monto", 1)
    expect(faltantes(fila)).toEqual([])
    expect(urlsDeFotos([fila])).toEqual([])
  })
  it("el OCR que llega tarde completa solo lo vacío y marca qué vino del OCR; lo que el usuario tocó no se pisa", () => {
    let fila = filaDesdeFoto("f3", null)
    fila = editarCampo(fila, "monto", 99999) // el vendedor ya tipeó el monto
    const r: ResultadoOcr = { tipo: "cheque", monto: 150000, banco: "Macro", numero_cheque: "00098765", fecha_cheque: "2026-11-10", cuit_emisor: "20-12345678-6", cuits_titulares: ["20-12345678-6"] }
    fila = aplicarOcr(fila, r, "https://bucket/f3.jpg")
    expect(fila.monto).toBe(99999)
    expect(fila.banco).toBe("Macro")
    expect(fila.cuit_emisor).toBe("20-12345678-6")
    expect(vinoDelOcr(fila, "banco")).toBe(true)
    expect(vinoDelOcr(fila, "monto")).toBe(false)
    expect(fila.ocr.estado).toBe("ok")
    // el usuario pisa un campo del OCR: deja de estar marcado
    fila = editarCampo(fila, "cuit_emisor", "30-71234567-1")
    expect(vinoDelOcr(fila, "cuit_emisor")).toBe(false)
  })
  it("una transferencia leída en una fila virgen cambia el tipo de la fila", () => {
    const fila = aplicarOcr(filaDesdeFoto("f4", null), { tipo: "transferencia", monto: 1000, numero_comprobante: "OP-77", cuenta_bancaria_id: "cb1" }, null)
    expect(fila.tipo).toBe("transferencia")
    expect(fila.referencia_transferencia).toBe("OP-77")
    expect(faltantes(fila)).toEqual([])
  })
})

describe("veredicto BCRA", () => {
  it("interpreta la respuesta del BCRA y resalta la deuda en el mismo banco del cheque", () => {
    const r = interpretarRespuestaBcra("20123456786", { results: { denominacion: "PEREZ JUAN", periodos: [{ entidades: [{ entidad: "BANCO MACRO S.A.", situacion: 3 }, { entidad: "BANCO GALICIA", situacion: 1 }] }] } })
    expect(r.apto).toBe(false)
    expect(r.situacion_max).toBe(3)
    const v = veredictoBcra([r], "Macro")
    expect(v.veredicto).toBe("riesgo")
    expect(v.mismoBanco).toBe(true)
  })
  it("todos los titulares en situación 1 => apto; alguno sin respuesta => sin_respuesta", () => {
    expect(veredictoBcra([bcraSinAntecedentes("20123456786"), interpretarRespuestaBcra("30712345671", { results: { periodos: [{ entidades: [{ entidad: "X", situacion: 1 }] }] } })]).veredicto).toBe("apto")
    expect(veredictoBcra([bcraSinAntecedentes("20123456786"), bcraError("30712345671", "timeout")]).veredicto).toBe("sin_respuesta")
    expect(veredictoBcra([]).veredicto).toBe("sin_respuesta")
  })
})

describe("BCRA lento/caído: el cobro cierra igual y el aviso llega después (outbox)", () => {
  function servidor(opts: { bcraFallaHasta: number }) {
    let intentosBcra = 0
    const aplicadas: string[] = []
    const manejador: Manejador = ({ body }) => {
      if (body.tipo === "cobro.registrar") {
        aplicadas.push(body.tipo)
        return { status: 200, body: { estado: "aplicado", resultado: { pago_id: "p1" } } }
      }
      if (body.tipo === "bcra.consultar") {
        intentosBcra++
        if (intentosBcra <= opts.bcraFallaHasta) return { status: 503, body: { error: "BCRA no responde" } }
        aplicadas.push(body.tipo)
        const resultado: ConsultaBcraResultado = {
          veredicto: "riesgo",
          titulo: "⛔ BCRA: Situación 3 — riesgo medio — evaluá si aceptás el cheque",
          detalle: ["PEREZ JUAN (20123456786): Situación 3 — riesgo medio"],
          mismoBanco: false,
          cheque: { banco: "Macro", numero_cheque: "00098765", monto: 150000, cliente_nombre: "Almacén X" },
          consultado_at: "2026-09-23T12:00:00Z",
        }
        return { status: 200, body: { estado: "aplicado", resultado } }
      }
      return { status: 422, body: { estado: "rechazado", error: "?" } }
    }
    return { manejador, aplicadas, get intentosBcra() { return intentosBcra } }
  }

  it("el cobro se aplica aunque el BCRA esté caído; la consulta reintenta y el aviso aparece cuando vuelve", async () => {
    const db = await dbNueva()
    const srv = servidor({ bcraFallaHasta: 2 })
    const { api } = apiFalsa(srv.manejador)
    const reloj = { t: 1_000_000 }
    const ob = new Outbox(db, api, { app: "vendedor", deviceId: "d", appVersion: "t", usuarioActual: () => "u1", autoEnviar: false }, () => reloj.t)
    const cobro = await ob.encolar({ tipo: "cobro.registrar", payload: { clientes: [], metodos: [] }, etiqueta: "Cobro Almacén X" })
    const bcra = await ob.encolar({ tipo: "bcra.consultar", payload: { cuits: ["20-12345678-6"], banco: "Macro", numero_cheque: "00098765" }, etiqueta: "BCRA cheque 00098765" })
    await ob.enviar()
    // El cobro cerró; la consulta quedó pendiente (transitorio) sin frenar el cobro (iba antes en la cola)
    expect((await ob.item(cobro.key))!.estado).toBe("enviado")
    expect((await ob.item(bcra.key))!.estado).toBe("pendiente")
    expect(avisosBcraPendientes(await ob.lista(), [])).toEqual([])
    // Vuelve el BCRA
    for (let i = 0; i < 3; i++) {
      reloj.t += 10 * 60_000
      await ob.enviar()
    }
    const it = (await ob.item(bcra.key))!
    expect(it.estado).toBe("enviado")
    const avisos = avisosBcraPendientes(await ob.lista(), [])
    expect(avisos).toHaveLength(1)
    expect(avisos[0]!.resultado.veredicto).toBe("riesgo")
    // Una vez visto, no se repite
    expect(avisosBcraPendientes(await ob.lista(), [bcra.key])).toEqual([])
    expect(srv.aplicadas).toEqual(["cobro.registrar", "bcra.consultar"])
  })

  it("sin señal al capturar: las dos operaciones quedan en el equipo y salen en orden cuando vuelve la red", async () => {
    const db = await dbNueva()
    const srv = servidor({ bcraFallaHasta: 0 })
    let red = false
    const { api } = apiFalsa((req) => (red ? srv.manejador(req) : "red"))
    const ob = new Outbox(db, api, { app: "vendedor", deviceId: "d", appVersion: "t", usuarioActual: () => "u1", autoEnviar: false })
    await ob.encolar({ tipo: "cobro.registrar", payload: { clientes: [], metodos: [] } })
    const bcra = await ob.encolar({ tipo: "bcra.consultar", payload: { cuits: ["20-12345678-6"] } })
    await ob.enviar()
    expect(ob.contadores.pendientes).toBe(2)
    red = true
    await ob.enviar({ forzar: true })
    expect(ob.contadores.pendientes).toBe(0)
    expect(srv.aplicadas).toEqual(["cobro.registrar", "bcra.consultar"])
    expect(avisosBcraPendientes(await ob.lista(), []).map((a) => a.key)).toEqual([bcra.key])
  })
})
