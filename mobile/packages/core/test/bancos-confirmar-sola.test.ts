// La orden de pago se confirma sola cuando el banco confirma la firma, y se le manda al proveedor
// (decisión de Juan, 19/11/2026). Se ejercita la regla completa contra el SIMULADOR de Credicoop:
// el ambiente es un parámetro, así la lógica corre igual sin tocar órdenes reales.
import { describe, expect, it } from "vitest"
import {
  armarTransferencia, crearClienteCredicoop, crearSimuladorCredicoop, decidirConfirmacion, esHorarioBancario,
  type ConfigCredicoop, type MedioDeOrden, type OperacionDeOrden,
} from "@gm/credicoop"
import { asuntoOrdenPago, cuerpoOrdenPago, mailsParaOrdenPago, porQueEseMail } from "../../../../lib/ordenes-pago/mail-orden-pago"
import { mailADespachar } from "../../../../lib/compras/mail-orden"

const HOY = "2026-11-19"
const EMPRESA = { numeroAdherente: 1234 }
const CONFIG: ConfigCredicoop = { baseUrl: "https://homoapibccl.bancocredicoop.coop", realm: "homologacion", clientId: "megasur", clavePrivada: "clave", numeroAdherente: 1234 }
const PROVEEDOR = { cbuCvu: "2770101234560200000534", cuit: "30-52123456-9", nombre: "Hornal S.A.", monto: 19877.42, referencia: "OP 31" }
const PENDIENTE = { estado: "pendiente" }
const transferencia: MedioDeOrden = { id: "d-1", medio: "transferencia", monto: 19877.42 }
const op = (o: Partial<OperacionDeOrden>): OperacionDeOrden => ({ id: "o-1", orden_pago_detalle_id: "d-1", estado: "firmada", ambiente: "produccion", monto: 19877.42, creado_at: "2026-11-19T13:00:00Z", creado_por: "u-juan", ...o })

describe("Confirmación sola: la regla", () => {
  it("con el pago hecho en el banco y nada más que confirmar, la orden se confirma (y se sabe quién lo mandó)", () => {
    const d = decidirConfirmacion(PENDIENTE, [transferencia], [op({})])
    expect(d.accion).toBe("confirmar")
    if (d.accion === "confirmar") expect(d.operacion).toMatchObject({ id: "o-1", creado_por: "u-juan" })
    expect(decidirConfirmacion(PENDIENTE, [transferencia], [op({ estado: "acreditada" })]).accion).toBe("confirmar")
  })

  it("esperando la firma, en proceso, en duda o rechazada: no se confirma", () => {
    for (const estado of ["preparada", "enviada_a_firma", "en_proceso", "error", "rechazada"]) {
      expect(decidirConfirmacion(PENDIENTE, [transferencia], [op({ estado })]).accion).toBe("esperar")
    }
  })

  it("manda la ÚLTIMA operación de cada pago: rechazada y después reenviada y hecha confirma; al revés no", () => {
    const vieja = op({ id: "o-1", estado: "rechazada", creado_at: "2026-11-19T12:00:00Z" })
    const nueva = op({ id: "o-2", estado: "firmada", creado_at: "2026-11-19T14:00:00Z", creado_por: "u-ana" })
    const d = decidirConfirmacion(PENDIENTE, [transferencia], [vieja, nueva])
    expect(d.accion === "confirmar" && d.operacion.id).toBe("o-2")
    expect(decidirConfirmacion(PENDIENTE, [transferencia], [op({ id: "o-1", estado: "firmada", creado_at: "2026-11-19T12:00:00Z" }), op({ id: "o-2", estado: "enviada_a_firma", creado_at: "2026-11-19T14:00:00Z" })]).accion).toBe("esperar")
  })

  it("si la orden tiene medios que no pasan por el banco, NO se confirma sola: falta el resto a mano", () => {
    const efectivo: MedioDeOrden = { id: "d-2", medio: "efectivo", monto: 5000 }
    const cheque: MedioDeOrden = { id: "d-3", medio: "cheque", monto: 1000 }
    const d = decidirConfirmacion(PENDIENTE, [transferencia, efectivo, cheque], [op({})])
    expect(d).toEqual({ accion: "falta_resto", medios: ["efectivo", "cheque"] })
    // …pero mientras el banco no terminó, se espera (no se avisa "falta el resto" antes de tiempo)
    expect(decidirConfirmacion(PENDIENTE, [transferencia, efectivo], [op({ estado: "enviada_a_firma" })]).accion).toBe("esperar")
  })

  it("dos pagos por el banco: recién cuando los dos están hechos", () => {
    const echeq: MedioDeOrden = { id: "d-2", medio: "cheque_propio", monto: 300 }
    const una = [op({})]
    expect(decidirConfirmacion(PENDIENTE, [transferencia, echeq], una).accion).toBe("falta_resto")   // el e-cheq todavía no se mandó
    const dos = [op({}), op({ id: "o-2", orden_pago_detalle_id: "d-2", monto: 300, estado: "enviada_a_firma" })]
    expect(decidirConfirmacion(PENDIENTE, [transferencia, echeq], dos).accion).toBe("esperar")
    dos[1].estado = "firmada"
    expect(decidirConfirmacion(PENDIENTE, [transferencia, echeq], dos).accion).toBe("confirmar")
  })

  it("el importe procesado tiene que ser el del pago", () => {
    expect(decidirConfirmacion(PENDIENTE, [transferencia], [op({ monto: 19000 })]).accion).toBe("esperar")
  })

  it("una orden que ya no está pendiente, o sin operaciones, no se toca", () => {
    for (const estado of ["pagada", "cancelada", "anulada", "borrador"]) expect(decidirConfirmacion({ estado }, [transferencia], [op({})]).accion).toBe("nada")
    expect(decidirConfirmacion(PENDIENTE, [transferencia], []).accion).toBe("nada")
  })

  it("SOLO el banco real confirma: lo del simulador o del banco de prueba no cuenta", () => {
    for (const ambiente of ["simulador", "homologacion"]) {
      expect(decidirConfirmacion(PENDIENTE, [transferencia], [op({ ambiente })]).accion).toBe("nada")
      // la misma regla se puede ejercitar pidiendo ese ambiente (así se prueba sin órdenes reales)
      expect(decidirConfirmacion(PENDIENTE, [transferencia], [op({ ambiente })], ambiente).accion).toBe("confirmar")
    }
    // una operación de prueba hecha no tapa a la real que sigue esperando
    expect(decidirConfirmacion(PENDIENTE, [transferencia], [op({ ambiente: "simulador" }), op({ id: "o-2", estado: "enviada_a_firma" })]).accion).toBe("esperar")
  })
})

describe("Confirmación sola: de punta a punta con el simulador", () => {
  it("se manda la transferencia, se firma con token en el banco, y recién ahí la orden se confirmaría", async () => {
    const sim = crearSimuladorCredicoop()
    const cliente = crearClienteCredicoop(CONFIG, { fetch: sim.fetch, firmar: () => "firma" })
    const medios = [transferencia]
    const guardada = op({ id: "o-sim", ambiente: "simulador", estado: "preparada" })

    const envio = await cliente.transferir(armarTransferencia(EMPRESA, { idOrigen: "op-31-sim", cbuCuentaDebito: "1910081234567892233196", hoy: HOY, beneficiarios: [PROVEEDOR] }))
    guardada.estado = envio.resultado.estado
    expect(guardada.estado).toBe("enviada_a_firma")
    expect(decidirConfirmacion(PENDIENTE, medios, [guardada], "simulador").accion).toBe("esperar")

    // la consulta periódica pregunta: sigue esperando la firma
    guardada.estado = (await cliente.consultarTransferencia({ idOrigen: "op-31-sim" })).resultado.estado
    expect(decidirConfirmacion(PENDIENTE, medios, [guardada], "simulador").accion).toBe("esperar")

    // alguien firma con token en Banca Internet Empresa; la próxima consulta lo ve
    sim.firmar("op-31-sim")
    guardada.estado = (await cliente.consultarTransferencia({ idOrigen: "op-31-sim" })).resultado.estado
    expect(guardada.estado).toBe("firmada")
    expect(decidirConfirmacion(PENDIENTE, medios, [guardada], "simulador").accion).toBe("confirmar")
    // …y en el sistema real esa operación de simulador no confirma nada
    expect(decidirConfirmacion(PENDIENTE, medios, [guardada]).accion).toBe("nada")
  })

  it("si el banco la rechaza, la orden no se confirma", async () => {
    const sim = crearSimuladorCredicoop()
    const cliente = crearClienteCredicoop(CONFIG, { fetch: sim.fetch, firmar: () => "firma" })
    await cliente.transferir(armarTransferencia(EMPRESA, { idOrigen: "op-32-sim", cbuCuentaDebito: "1910081234567892233196", hoy: HOY, beneficiarios: [PROVEEDOR] }))
    sim.rechazar("op-32-sim", "Fondos insuficientes")
    const estado = (await cliente.consultarTransferencia({ idOrigen: "op-32-sim" })).resultado.estado
    expect(decidirConfirmacion(PENDIENTE, [transferencia], [op({ ambiente: "simulador", estado })], "simulador").accion).toBe("esperar")
  })
})

describe("Consulta periódica: horario bancario (hora de la Argentina)", () => {
  it("lunes a viernes de 8 a 20", () => {
    expect(esHorarioBancario(new Date("2026-11-19T11:00:00Z"))).toBe(true)    // jueves 8:00
    expect(esHorarioBancario(new Date("2026-11-19T10:59:00Z"))).toBe(false)   // jueves 7:59
    expect(esHorarioBancario(new Date("2026-11-19T22:59:00Z"))).toBe(true)    // jueves 19:59
    expect(esHorarioBancario(new Date("2026-11-19T23:00:00Z"))).toBe(false)   // jueves 20:00
    expect(esHorarioBancario(new Date("2026-11-21T15:00:00Z"))).toBe(false)   // sábado al mediodía
    expect(esHorarioBancario(new Date("2026-11-23T01:00:00Z"))).toBe(false)   // domingo 22:00 (ya lunes en UTC)
    expect(esHorarioBancario(new Date("2026-11-23T12:00:00Z"))).toBe(true)    // lunes 9:00
  })
})

describe("Mail de la orden de pago al proveedor", () => {
  it("a quién va: primero el mail para órdenes de pago de la ficha; si está vacío, oficina, general y por último el vendedor", () => {
    expect(mailsParaOrdenPago({ mail_ordenes_pago: "Pagos@Hornal.com.ar; tesoreria@hornal.com.ar", mail_oficina: "adm@hornal.com.ar" })).toEqual({ para: ["pagos@hornal.com.ar", "tesoreria@hornal.com.ar"], origen: "ordenes_pago" })
    expect(mailsParaOrdenPago({ mail_ordenes_pago: "  ", mail_oficina: "adm@hornal.com.ar" }).origen).toBe("oficina")
    // la pantalla dice a cuál fue y por qué (nada que aclarar si fue al mail para órdenes de pago)
    expect(porQueEseMail("ordenes_pago")).toBe("")
    expect(porQueEseMail("oficina")).toBe("Fue al mail de la oficina porque el proveedor no tiene cargado un mail para órdenes de pago.")
    expect(porQueEseMail("vendedor")).toContain("al mail del vendedor")
    expect(porQueEseMail(null)).toBe("")
    expect(mailsParaOrdenPago({ mail_oficina: "adm@hornal.com.ar; cobranzas@hornal.com.ar", email: "info@hornal.com.ar" })).toEqual({ para: ["adm@hornal.com.ar", "cobranzas@hornal.com.ar"], origen: "oficina" })
    expect(mailsParaOrdenPago({ mail_oficina: "no es un mail", email: "info@hornal.com.ar" })).toEqual({ para: ["info@hornal.com.ar"], origen: "general" })
    expect(mailsParaOrdenPago({ mail_vendedor: "vendedor@hornal.com.ar" }).origen).toBe("vendedor")
  })

  it("sin ningún mail: no hay a quién mandársela (queda pagada sin enviar)", () => {
    expect(mailsParaOrdenPago({ nombre: "Sin mail" })).toEqual({ para: [], origen: null })
    expect(mailsParaOrdenPago({ mail_oficina: "  ", email: "sin arroba" }).para).toEqual([])
    expect(mailsParaOrdenPago(null).para).toEqual([])
  })

  const datos = {
    numero_op: "0001-00000031", fecha: "2026-11-19", proveedor: "Hornal S.A.", empresa: "Megasur S.A.",
    monto_total: 20000, total_retenciones: 122.58, neto_a_pagar: 19877.42, numero_certificado: "0001-00000012",
    medios: [{ medio: "transferencia", monto: 19877.42, referencia: "operación 55001" }, { medio: "efectivo", monto: 0 }],
  }

  it("el texto dice qué se pagó, la retención y cómo, con los formatos de la Argentina", () => {
    const t = cuerpoOrdenPago(datos)
    expect(asuntoOrdenPago(datos)).toBe("Orden de pago 0001-00000031 — Megasur S.A.")
    expect(t).toContain("orden de pago N° 0001-00000031, del 19/11/2026")
    expect(t).toContain("Importe de los comprobantes: $20.000,00")
    expect(t).toContain("Retenciones: $122,58 (certificado N° 0001-00000012, adjunto)")
    expect(t).toContain("Importe pagado: $19.877,42")
    expect(t).toContain("- Transferencia: $19.877,42 (operación 55001)")
    expect(t).not.toContain("Efectivo")
    expect(t).toContain("Adjuntamos la orden de pago y el certificado de retención.")
  })

  it("sin retención no se habla de retenciones ni de certificado", () => {
    const t = cuerpoOrdenPago({ ...datos, total_retenciones: 0, numero_certificado: null, neto_a_pagar: 20000 })
    expect(t).not.toContain("Retenciones")
    expect(t).toContain("Adjuntamos la orden de pago.")
  })

  it("MODO PRUEBA: sale solo a la dirección de prueba, con [PRUEBA] y diciendo a quién habría ido", () => {
    const ajustes = { cuenta_envio: "compras@ejemplo.com", modo_prueba: true, mail_prueba: "prueba@ejemplo.com" }
    const d = mailADespachar(ajustes, { para: ["adm@hornal.com.ar"], cc: [], asunto: asuntoOrdenPago(datos), texto: cuerpoOrdenPago(datos) })
    expect(d.para).toEqual(["prueba@ejemplo.com"])
    expect(d.cc).toEqual([])
    expect(d.asunto).toBe("[PRUEBA] Orden de pago 0001-00000031 — Megasur S.A.")
    expect(d.texto).toContain("Habría ido a: adm@hornal.com.ar")
    expect(d.prueba).toBe(true)
    // con el modo prueba apagado va al proveedor
    expect(mailADespachar({ ...ajustes, modo_prueba: false }, { para: ["adm@hornal.com.ar"], cc: [], asunto: "a", texto: "t" }).para).toEqual(["adm@hornal.com.ar"])
  })
})
