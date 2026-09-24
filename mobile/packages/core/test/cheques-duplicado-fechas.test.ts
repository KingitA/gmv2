import { describe, expect, it } from "vitest"
import { autoFormatoFechaAR, fechaARAIso, fechaIsoAAR } from "@gm/cheques"
import { ErrorReglaCobranza, chequeDuplicadoDe, errorDeRpcCobranza, mensajeChequeDuplicado, mensajeParaUsuario } from "../../../../lib/cobranzas/errores"

// Correcciones del 24/09/2026 (pruebas del dueño en la preview de apk-chofer):
//  1. Un cheque YA REGISTRADO (unicidad de `cheques`, SQLSTATE 23505) es un rechazo
//     DEFINITIVO con mensaje en castellano, en las cuatro superficies: nunca un 500 crudo
//     de Postgres, nunca un reintento eterno que trabe la cola.
//  2. Las fechas de cheques se muestran y tipean dd/mm/aaaa (Argentina), no según el idioma
//     del navegador.

describe("Cheque duplicado: rechazo definitivo con mensaje claro", () => {
  const errorPg = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "cheques_banco_numero_key"',
    details: "Key (banco, numero)=(Santander, 11400260) already exists.",
  }

  it("lee la clave que chocó del detalle de Postgres", () => {
    expect(chequeDuplicadoDe(errorPg)).toEqual({ banco: "Santander", numero: "11400260" })
  })

  it("unicidad de OTRA tabla o sin detalle: no es un cheque duplicado / clave vacía", () => {
    expect(chequeDuplicadoDe({ code: "23505", message: 'duplicate key value violates unique constraint "pedidos_movil_local_id_key"', details: "Key (movil_local_id)=(x) already exists." })).toBeNull()
    expect(chequeDuplicadoDe({ code: "23505", message: 'duplicate key value violates unique constraint "cheques_numero_key"' })).toEqual({})
    expect(chequeDuplicadoDe({ code: "P0001", message: "cheques: algo" })).toBeNull()
    expect(chequeDuplicadoDe(null)).toBeNull()
  })

  it("errorDeRpcCobranza lo clasifica como regla de negocio (422, no reintentable) con texto en castellano", () => {
    const e = errorDeRpcCobranza("cobranza_crear", errorPg)
    expect(e).toBeInstanceOf(ErrorReglaCobranza)
    expect((e as ErrorReglaCobranza).codigo).toBe("regla_negocio")
    expect(e.message).toBe("El cheque N° 11400260 (Santander) ya está registrado. No se puede cargar dos veces: si es un error, hay que anular ese cobro desde oficina.")
    expect(mensajeParaUsuario(e)).not.toMatch(/duplicate key|constraint/)
  })

  it("con la referencia al cobro/cliente donde está", () => {
    expect(mensajeChequeDuplicado({ numero: "11400260", banco: "Santander" }, { fecha: "2026-09-23", cliente: "HERRERO MAXIMILIANO", estado: "pendiente_rendicion" })).toBe(
      "El cheque N° 11400260 (Santander) ya está registrado: está en el cobro del 23/09/2026 a HERRERO MAXIMILIANO (pendiente de rendición). No se puede cargar dos veces: si es un error, hay que anular ese cobro desde oficina.",
    )
    expect(mensajeChequeDuplicado({})).toBe("Ese cheque ya está registrado. No se puede cargar dos veces: si es un error, hay que anular ese cobro desde oficina.")
  })

  it("un error transitorio sigue siendo transitorio", () => {
    expect(errorDeRpcCobranza("cobranza_crear", { code: "57014", message: "canceling statement due to statement timeout" })).not.toBeInstanceOf(ErrorReglaCobranza)
  })
})

describe("Fechas de cheques: dd/mm/aaaa", () => {
  it("ISO → dd/mm/aaaa y vuelta", () => {
    expect(fechaIsoAAR("2026-06-15")).toBe("15/06/2026")
    expect(fechaIsoAAR("")).toBe("")
    expect(fechaIsoAAR(null)).toBe("")
    expect(fechaARAIso("15/06/2026")).toBe("2026-06-15")
  })

  it("al tipear se ponen las barras solas y solo entran dígitos", () => {
    expect(autoFormatoFechaAR("1")).toBe("1")
    expect(autoFormatoFechaAR("1506")).toBe("15/06")
    expect(autoFormatoFechaAR("15062026")).toBe("15/06/2026")
    expect(autoFormatoFechaAR("15/06/2026x9")).toBe("15/06/2026")
  })

  it("incompleta o inexistente ⇒ '' (el campo queda vacío, nunca una fecha inventada); día y mes NO se cruzan", () => {
    expect(fechaARAIso("15/06")).toBe("")
    expect(fechaARAIso("31/02/2026")).toBe("")
    expect(fechaARAIso("06/15/2026")).toBe("") // mm/dd (lo que pintaba el navegador en inglés) no es una fecha
    expect(fechaARAIso("07/06/2026")).toBe("2026-06-07") // 7 de junio, no 6 de julio
  })
})
