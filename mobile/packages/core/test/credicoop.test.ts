// Banco Credicoop — API Empresas (Tanda 2-A). Se prueba el cliente real contra el simulador
// (lib/bancos/credicoop/simulador.ts), que contesta como la documentación del banco.
import { describe, expect, it } from "vitest"
import { generateKeyPairSync, createVerify } from "node:crypto"
import {
  armarEmisionEcheq, armarGestionEcheq, armarJwt, armarListaEcheqs, armarListaVeps, armarPagoVep, armarTransferencia,
  crearClienteCredicoop, crearSimuladorCredicoop, endosoSegunEcheq, ErrorCredicoop, errorDelBanco, estadoBancoConocido, estadoDesdeBanco, estadoEcheq, fechaBanco, fechaDesdeBanco,
  leerMovimientos, leerOperacion, montoBanco, montoDesdeBanco, RUTAS, SCOPES, textoBanco, type ConfigCredicoop,
} from "@gm/credicoop"

const HOY = "2026-11-19"
const EMPRESA = { numeroAdherente: 1234, firmantes: [{ documento: "21.123.456", documentoTipo: "dni" }] }
const CBU_NUESTRO = "1910081234567892233196"
const CONFIG: ConfigCredicoop = { baseUrl: "https://homoapibccl.bancocredicoop.coop", realm: "homologacion", clientId: "megasur", clavePrivada: "clave", numeroAdherente: 1234 }
const PROVEEDOR = { cbuCvu: "2770101234560200000534", cuit: "30-52123456-9", nombre: "Hornal S.A. (Ñandú)", monto: 19877.42, referencia: "OP 0001-00000031", observaciones: "Pago factura 0003-00045711" }

function armar(opciones: Parameters<typeof crearSimuladorCredicoop>[0] = {}, reloj?: { t: number }) {
  const sim = crearSimuladorCredicoop(opciones)
  let n = 0
  const cliente = crearClienteCredicoop(CONFIG, { fetch: sim.fetch, firmar: () => "firma", uuid: () => `jti-${++n}`, ...(reloj ? { ahora: () => reloj.t } : {}) })
  return { sim, cliente }
}
const falla = async (p: Promise<unknown>): Promise<ErrorCredicoop> => {
  try { await p } catch (e) { return e as ErrorCredicoop }
  throw new Error("tenía que fallar")
}

describe("Credicoop: formatos del banco", () => {
  it("el importe va como texto con punto y dos decimales, sin separador de miles", () => {
    expect(montoBanco(19877.42)).toBe("19877.42")
    expect(montoBanco(100)).toBe("100.00")
    expect(montoBanco(0.1 + 0.2)).toBe("0.30")          // sin el error de coma flotante
    expect(montoBanco(1234567.006)).toBe("1234567.01")  // redondea al centavo
    expect(montoBanco(1234567890123.45)).toBe("1234567890123.45")
  })
  it("no arma un importe que no es válido", () => {
    for (const malo of [0, -5, NaN, Infinity, 0.001, 12345678901234.5]) expect(() => montoBanco(malo)).toThrow(ErrorCredicoop)
  })
  it("lee los importes del banco, vengan como texto o como número", () => {
    expect(montoDesdeBanco("100.0")).toBe(100)
    expect(montoDesdeBanco("1234.56")).toBe(1234.56)
    expect(montoDesdeBanco(700099.28)).toBe(700099.28)
    expect(montoDesdeBanco("1.234,56")).toBeNull()       // formato que el banco no usa: no se adivina
    expect(montoDesdeBanco("")).toBeNull()
  })
  it("las fechas van AAAAMMDD", () => {
    expect(fechaBanco("2026-11-19")).toBe("20261119")
    expect(fechaDesdeBanco("20261119")).toBe("2026-11-19")
    expect(() => fechaBanco("19/11/2026")).toThrow(ErrorCredicoop)
    expect(fechaDesdeBanco("19/11/2026")).toBeNull()
  })
  it("los textos van solo con letras, números y espacios", () => {
    expect(textoBanco("Hornal S.A. (Ñandú) — pago n° 3", 100)).toBe("HORNAL S A NANDU PAGO N 3")
    expect(textoBanco("abcdefghijklmnop", 12)).toBe("ABCDEFGHIJKL")
    expect(textoBanco("  ", 10)).toBe("")
  })
})

describe("Credicoop: siempre con firma", () => {
  it("las rutas que mueven plata son las de ConFirma, y los permisos también", () => {
    for (const r of [RUTAS.transferir, RUTAS.emitirEcheq, RUTAS.gestionEcheq, RUTAS.pagarVep]) expect(r).toContain("/ConFirma/")
    expect(SCOPES).toEqual({ cuentas: "cuentas", transferencias: "transferenciasConFirma", echeq: "echeqConFirma", vep: "vepConFirma" })
  })
})

describe("Credicoop: autenticación", () => {
  it("el JWT lleva lo que pide el banco y vale 60 segundos", () => {
    const jwt = armarJwt(CONFIG, { ahora: () => 1_700_000_000_000, uuid: () => "un-uuid", firmar: () => "firma" })
    const [cab, cuerpo, firma] = jwt.split(".")
    expect(JSON.parse(Buffer.from(cab, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" })
    expect(JSON.parse(Buffer.from(cuerpo, "base64url").toString())).toEqual({
      iss: "megasur", sub: "megasur", aud: "https://homoapibccl.bancocredicoop.coop/auth/realms/homologacion",
      iat: 1_700_000_000, exp: 1_700_000_060, jti: "un-uuid",
    })
    expect(firma).toBe("firma")
  })
  it("firma de verdad con una clave RSA (RS256) y el banco la puede verificar con la pública", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } })
    const jwt = armarJwt({ ...CONFIG, clavePrivada: privateKey })
    const [cab, cuerpo, firma] = jwt.split(".")
    expect(createVerify("RSA-SHA256").update(`${cab}.${cuerpo}`).verify(publicKey, Buffer.from(firma, "base64url"))).toBe(true)
  })
  it("con una clave que no sirve avisa sin mostrarla", () => {
    try { armarJwt({ ...CONFIG, clavePrivada: "esto-no-es-una-clave-SECRETA" }); throw new Error("tenía que fallar") } catch (e) {
      expect(e).toBeInstanceOf(ErrorCredicoop)
      expect((e as ErrorCredicoop).clase).toBe("SIN_CONEXION")
      expect((e as Error).message).not.toContain("SECRETA")
    }
  })
  it("pide el token una vez y lo reusa hasta que vence (30 minutos)", async () => {
    const reloj = { t: 1_700_000_000_000 }
    const { sim, cliente } = armar({}, reloj)
    await cliente.cuentas(); await cliente.cuentas()
    expect(sim.pedidos).toBe(3)                      // 1 token + 2 consultas
    reloj.t += 31 * 60_000
    await cliente.cuentas()
    expect(sim.pedidos).toBe(5)                      // venció: token nuevo + consulta
  })
  it("cada tipo de operación pide su propio permiso", async () => {
    const { sim, cliente } = armar()
    await cliente.cuentas()
    await cliente.listarVeps(armarListaVeps(EMPRESA, { idOrigen: "v-1" }))
    expect(sim.pedidos).toBe(4)                      // dos tokens (cuentas y vepConFirma) + dos pedidos
  })
  it("no manda más de 50 pedidos por minuto: al llegar al tope corta sin salir al banco", async () => {
    const reloj = { t: 1_700_000_000_000 }
    const { sim, cliente } = armar({}, reloj)
    for (let i = 0; i < 49; i++) await cliente.cuentas()   // 1 token + 49 = 50
    const e = await falla(cliente.cuentas())
    expect(e.clase).toBe("LIMITE")
    expect(sim.pedidos).toBe(50)
    reloj.t += 61_000
    await expect(cliente.cuentas()).resolves.toHaveLength(2)
  })
})

describe("Credicoop: transferencia con firma", () => {
  it("arma el pedido como lo pide el banco", () => {
    const p = armarTransferencia(EMPRESA, { idOrigen: "0193ad1e-c3cd-7ebd-1234-5d4227bf207d", cbuCuentaDebito: CBU_NUESTRO, hoy: HOY, beneficiarios: [{ ...PROVEEDOR, mails: ["pagos@hornal.com.ar, otro@hornal.com.ar", "malo"] }] })
    expect(p).toEqual({
      numeroAdherente: 1234, idOrigen: "0193ad1e-c3cd-7ebd-1234-5d4227bf207d", cbuCuentaDebito: CBU_NUESTRO, fechaPago: "20261119",
      operadoresFirmantes: [{ documento: "21123456", documentoTipo: "DNI" }],
      beneficiarios: [{
        orden: 0, cbuCvu: "2770101234560200000534", esCuentaPropia: "N", monto: "19877.42", moneda: "ARS",
        observaciones: "PAGO FACTURA 0003 00045711", concepto: "FAC", referenciaConcepto: "OP0001000000",
        cui: "30521234569", nombre: "HORNAL S A NANDU", mails: ["pagos@hornal.com.ar", "otro@hornal.com.ar"],
      }],
    })
  })
  it("no arma una transferencia sin CBU, sin CUIT o sin importe (y dice qué falta)", () => {
    const base = { idOrigen: "x", cbuCuentaDebito: CBU_NUESTRO, hoy: HOY }
    expect(() => armarTransferencia(EMPRESA, { ...base, beneficiarios: [{ ...PROVEEDOR, cbuCvu: "123" }] })).toThrow(/CBU de Hornal/)
    expect(() => armarTransferencia(EMPRESA, { ...base, beneficiarios: [{ ...PROVEEDOR, cuit: "" }] })).toThrow(/CUIT de Hornal/)
    expect(() => armarTransferencia(EMPRESA, { ...base, beneficiarios: [{ ...PROVEEDOR, monto: 0 }] })).toThrow(/importe/)
    expect(() => armarTransferencia(EMPRESA, { ...base, cbuCuentaDebito: "", beneficiarios: [PROVEEDOR] })).toThrow(/cuenta de la que sale/)
    expect(() => armarTransferencia(EMPRESA, { ...base, beneficiarios: [] })).toThrow(/ningún beneficiario/)
    expect(() => armarTransferencia({ numeroAdherente: 0 }, { ...base, beneficiarios: [PROVEEDOR] })).toThrow(/adherente/)
  })
  it("queda esperando la firma; cuando se firma, la consulta la da por hecha", async () => {
    const { sim, cliente } = armar()
    const pedido = armarTransferencia(EMPRESA, { idOrigen: "op-31-a", cbuCuentaDebito: CBU_NUESTRO, hoy: HOY, beneficiarios: [PROVEEDOR] })
    const envio = await cliente.transferir(pedido)
    expect(envio.resultado.estado).toBe("enviada_a_firma")
    expect(envio.resultado.estadoBanco).toBe("Enviada a la firma")
    expect(envio.resultado.idOperacion).toMatch(/^\d+$/)
    expect((await cliente.consultarTransferencia({ idOrigen: "op-31-a" })).resultado.estado).toBe("enviada_a_firma")
    sim.firmar("op-31-a")
    const fin = await cliente.consultarTransferencia({ idOrigen: "op-31-a" })
    expect(fin.resultado.estado).toBe("firmada")
    expect(fin.resultado.estadoBanco).toBe("Enviada a Banco Destino")
  })
  it("si el banco la rechaza, queda rechazada con el motivo", async () => {
    const { sim, cliente } = armar()
    await cliente.transferir(armarTransferencia(EMPRESA, { idOrigen: "op-32", cbuCuentaDebito: CBU_NUESTRO, hoy: HOY, beneficiarios: [PROVEEDOR] }))
    sim.rechazar("op-32", "Fondos insuficientes")
    const r = await cliente.consultarTransferencia({ idOrigen: "op-32" })
    expect(r.resultado).toMatchObject({ estado: "rechazada", motivo: "Fondos insuficientes" })
  })
  it("la misma operación mandada dos veces NO sale dos veces: el banco la rechaza por repetida", async () => {
    const { sim, cliente } = armar()
    const pedido = armarTransferencia(EMPRESA, { idOrigen: "op-33", cbuCuentaDebito: CBU_NUESTRO, hoy: HOY, beneficiarios: [PROVEEDOR] })
    await cliente.transferir(pedido)
    const e = await falla(cliente.transferir(pedido))
    expect(e.clase).toBe("DUPLICADO")
    expect(e.codigo).toBe("APIE-0003")
    expect(e.message).toMatch(/Actualizar estado/)
    expect(sim.cantidad).toBe(1)
  })
  it("si se corta la comunicación al enviar, queda EN DUDA y la consulta dice que sí había entrado", async () => {
    const { sim, cliente } = armar()
    sim.cortarProximoEnvio()
    const e = await falla(cliente.transferir(armarTransferencia(EMPRESA, { idOrigen: "op-34", cbuCuentaDebito: CBU_NUESTRO, hoy: HOY, beneficiarios: [PROVEEDOR] })))
    expect(e.clase).toBe("INCIERTO")
    expect(e.message).toMatch(/NO se sabe si la operación entró/)
    // lo correcto ante la duda: consultar por idOrigen, no reenviar
    expect((await cliente.consultarTransferencia({ idOrigen: "op-34" })).resultado.estado).toBe("enviada_a_firma")
    expect(sim.cantidad).toBe(1)
  })
  it("una operación que el banco no conoce se informa como rechazo, no como hecha", async () => {
    const { cliente } = armar()
    const e = await falla(cliente.consultarTransferencia({ idOrigen: "no-existe" }))
    expect(e.clase).toBe("RECHAZO")
    expect(e.codigo).toBe("APIE-0026")
  })
})

describe("Credicoop: e-cheq", () => {
  it("emite cruzado y a la orden; con fecha de hoy es común y con fecha posterior, diferido", () => {
    const p = armarEmisionEcheq(EMPRESA, { idOrigen: "ech-1", cbuCuentaDebito: CBU_NUESTRO, hoy: HOY, echeqs: [
      { monto: 19877.42, fechaPago: "2026-12-18", beneficiarioNombre: "Hornal S.A.", beneficiarioCuit: "30-52123456-9", motivo: "OP 0001-00000031" },
      { monto: 500, fechaPago: HOY, beneficiarioNombre: "Hornal S.A.", beneficiarioCuit: "30521234569" },
    ] })
    expect(p.echeqs[0]).toEqual({
      monto: "19877.42", fechaPago: "20261218", motivoPago: "OP 0001 00000031", concepto: "FAC", caracter: "1", modo: "1",
      beneficiarioNombre: "HORNAL S A", beneficiarioDocumentoTipo: "CUIT", beneficiarioDocumento: "30521234569", tipoCheque: "ECHD",
    })
    expect(p.echeqs[1]).toMatchObject({ tipoCheque: "ECHC", motivoPago: "PAGO A PROVEEDOR" })
    expect(() => armarEmisionEcheq(EMPRESA, { idOrigen: "e", cbuCuentaDebito: CBU_NUESTRO, hoy: HOY, echeqs: [{ monto: 1, fechaPago: "2026-11-18", beneficiarioNombre: "X", beneficiarioCuit: "30521234569" }] })).toThrow(/anterior a hoy/)
  })
  it("la emisión queda a la firma y, firmada, devuelve el identificador del e-cheq", async () => {
    const { sim, cliente } = armar()
    const envio = await cliente.emitirEcheq(armarEmisionEcheq(EMPRESA, { idOrigen: "ech-2", cbuCuentaDebito: CBU_NUESTRO, hoy: HOY, echeqs: [{ monto: 1000, fechaPago: "2026-12-18", beneficiarioNombre: "Hornal", beneficiarioCuit: "30521234569" }] }))
    expect(envio.resultado.estado).toBe("enviada_a_firma")
    sim.firmar("ech-2")
    const fin = await cliente.consultarEcheq({ idOrigen: "ech-2" })
    expect(fin.resultado.estado).toBe("firmada")
    expect(fin.resultado.idCheque).toMatch(/^SIM/)
  })
  it("endosar un e-cheq recibido al proveedor: endoso nominal a su CUIT, con firma", async () => {
    const { sim, cliente } = armar()
    const recibidos = await cliente.listarEcheqs(armarListaEcheqs(EMPRESA, { idOrigen: "l-1", gestion: "RECIBIDOS", estado: "ACTIVO", numeroCheque: "603430" }))
    expect(recibidos.echeqs).toHaveLength(1)
    expect(recibidos.echeqs[0]).toMatchObject({ idCheque: "JWV9J0JWAAM2QMD", estado: "ACTIVO", monto: 250000, fechaPago: "2026-12-10" })
    const pedido = armarGestionEcheq(EMPRESA, { idOrigen: "end-1", cbuCuenta: CBU_NUESTRO, accion: "ENDOSAR", echeqs: [{ idCheque: recibidos.echeqs[0].idCheque }], beneficiarioCuit: "30-52123456-9" })
    expect(pedido).toMatchObject({ accion: "ENDOSAR", tipoEndoso: "NOM", beneficiario: { documento: "30521234569", documentoTipo: "CUIT" }, echeqs: [{ idCheque: "JWV9J0JWAAM2QMD" }] })
    expect((await cliente.gestionarEcheq(pedido)).resultado.estado).toBe("enviada_a_firma")
    sim.firmar("end-1")
    const despues = await cliente.listarEcheqs(armarListaEcheqs(EMPRESA, { idOrigen: "l-2", gestion: "RECIBIDOS", numeroCheque: "603430" }))
    expect(despues.echeqs[0].estado).toBe("ACTIVO-PENDIENTE")   // ya no lo tenemos libre
  })
  it("no arma un endoso sin el identificador del cheque o sin el CUIT del proveedor", () => {
    expect(() => armarGestionEcheq(EMPRESA, { idOrigen: "e", cbuCuenta: CBU_NUESTRO, accion: "ENDOSAR", echeqs: [{}], beneficiarioCuit: "30521234569" })).toThrow(/identificador del e-cheq/)
    expect(() => armarGestionEcheq(EMPRESA, { idOrigen: "e", cbuCuenta: CBU_NUESTRO, accion: "ENDOSAR", echeqs: [{ idCheque: "A" }] })).toThrow(/CUIT del proveedor/)
    expect(() => armarGestionEcheq(EMPRESA, { idOrigen: "e", cbuCuenta: CBU_NUESTRO, accion: "DEPOSITAR", echeqs: [{ idCheque: "A" }] })).toThrow(/importe y la fecha/)
  })
})

describe("Credicoop: VEP de ARCA", () => {
  it("lista los pendientes y, al pagar uno con firma y firmarlo, deja de estar pendiente", async () => {
    const { sim, cliente } = armar()
    const pendientes = await cliente.listarVeps(armarListaVeps(EMPRESA, { idOrigen: "v-1", estado: "PENDIENTE_PAGO" }))
    expect(pendientes).toHaveLength(2)
    expect(pendientes[0]).toMatchObject({ numeroVep: "55366315", monto: 1850000, vence: "2026-11-20", periodoFiscal: "10/2026" })
    const pago = armarPagoVep(EMPRESA, { idOrigen: "vep-1", cbuCuentaDebito: CBU_NUESTRO, numeroVep: pendientes[0].numeroVep, monto: pendientes[0].monto!, cuitContribuyente: pendientes[0].cuitContribuyente })
    expect(pago.veps).toEqual([{ numeroVep: 55366315, cuitContribuyente: "30541234501", monto: "1850000.00", moneda: "ARS" }])
    expect((await cliente.pagarVep(pago)).resultado.estado).toBe("enviada_a_firma")
    sim.firmar("vep-1")
    expect((await cliente.consultarPagoVep({ idOrigen: "vep-1" })).resultado.estado).toBe("firmada")
    expect(await cliente.listarVeps(armarListaVeps(EMPRESA, { idOrigen: "v-2", estado: "PENDIENTE_PAGO" }))).toHaveLength(1)
  })
  it("el mismo pago de VEP mandado dos veces se rechaza por repetido", async () => {
    const { cliente } = armar()
    const pago = armarPagoVep(EMPRESA, { idOrigen: "vep-2", cbuCuentaDebito: CBU_NUESTRO, numeroVep: 55366399, monto: 42750.5 })
    await cliente.pagarVep(pago)
    const e = await falla(cliente.pagarVep(pago))
    expect(e.clase).toBe("DUPLICADO")
    expect(e.codigo).toBe("APIE-4011")
  })
})

describe("Credicoop: cuentas y movimientos", () => {
  it("trae las cuentas con su saldo, venga como número o como texto", async () => {
    const { cliente } = armar()
    expect(await cliente.cuentas()).toEqual([
      { nroCuenta: "191-008-1234567/8", denominacion: "CTA CTE SIMULADA", saldo: 700099.28, tipo: "CC", moneda: "ARS", cbu: "1910081234567892233196" },
      { nroCuenta: "191-008-7654321/0", denominacion: "CAJA DE AHORRO SIMULADA", saldo: 1500, tipo: "CA", moneda: "ARS", cbu: "1910087654321092233190" },
    ])
  })
  it("los movimientos salen con signo (entra +, sale −) y el encabezado no es un movimiento", async () => {
    const { sim, cliente } = armar()
    await cliente.transferir(armarTransferencia(EMPRESA, { idOrigen: "op-40", cbuCuentaDebito: CBU_NUESTRO, hoy: HOY, beneficiarios: [PROVEEDOR] }))
    sim.firmar("op-40")
    const r = await cliente.movimientos("191-008-1234567/8", "2026-11-01", HOY)
    expect(r.saldo).toBe(700099.28)
    expect(r.parcial).toBe(false)
    expect(r.movimientos.map((m) => [m.fecha, m.monto])).toEqual([[HOY, -19877.42], ["2026-11-01", 125000.5], ["2026-11-01", -750]])
    expect(r.movimientos[0].idTransaccion).toMatch(/^SIM-/)
  })
  it("avisa cuando el banco cortó por el tope de registros (faltan movimientos)", () => {
    const r = leerMovimientos({ alerta: [{ mensaje: "supera el límite", cantidadRegistros: 1001 }], consMovCtas: [
      { fecha: "20261119", descripcion: "ENCABEZADO", indDBCR: "", monto: "10.00", saldo: "10.00" },
      { fecha: "20261119", descripcion: "ALGO", indDBCR: "CR", monto: "5.00", saldo: "10.00", idTransaccion: "1" },
      { fecha: "mala", descripcion: "SE SALTEA", indDBCR: "CR", monto: "5.00" },
    ] })
    expect(r.parcial).toBe(true)
    expect(r.movimientos).toHaveLength(1)
  })
})

describe("Credicoop: estados y errores", () => {
  it("solo da por hecha una operación con los textos finales del banco", () => {
    expect(estadoDesdeBanco("Enviada a la firma")).toBe("enviada_a_firma")
    expect(estadoDesdeBanco("Enviada a Banco Destino")).toBe("firmada")
    expect(estadoDesdeBanco("Aceptada")).toBe("firmada")
    expect(estadoDesdeBanco("Rechazada")).toBe("rechazada")
    // Lo que termina mal gana aunque el texto hable de la firma
    for (const t of ["Rechazada por el firmante", "Firma rechazada", "Anulada", "Vencida sin firma", "Cancelada por el firmante", "Caducada"]) expect(estadoDesdeBanco(t)).toBe("rechazada")
    // Un texto que el sistema no conoce no es ni hecho ni rechazado, y se sabe que es desconocido
    expect(estadoBancoConocido("Un texto nuevo del banco")).toBe(false)
    expect(estadoBancoConocido("")).toBe(false)
    for (const t of ["Enviada a la firma", "Aceptada", "Retenida", "Rechazada por el firmante", "Aceptada parcialmente"]) expect(estadoBancoConocido(t)).toBe(true)
    for (const t of ["En procesamiento", "Retenida", "Enviada a proceso", "Confeccionada", "Aceptada parcialmente", "Un texto nuevo del banco", ""]) expect(estadoDesdeBanco(t)).toBe("en_proceso")
  })
  it("una respuesta sin estado no se toma como hecha: queda en duda", () => {
    expect(() => leerOperacion({ data: { idOperacion: 1 } })).toThrow(/Actualizar estado/)
  })
  it("traduce los errores del banco al castellano y distingue qué hacer", () => {
    const sinCuenta = errorDelBanco(400, { codigo: 8, descripcion: "x", errores: [{ codigo: "APIE-0008", descripcion: "Beneficiario no se encuentra en la lista de Cuentas de Terceros", orden: 0 }] })
    expect(sinCuenta.clase).toBe("RECHAZO")
    expect(sinCuenta.message).toMatch(/darlo de alta en Banca Internet Empresa/)
    expect(errorDelBanco(400, { codigo: 3, descripcion: "Ya existe una operación con el mismo idOrigen" }).clase).toBe("DUPLICADO")
    expect(errorDelBanco(401, {}).clase).toBe("AUTORIZACION")
    expect(errorDelBanco(400, { errores: [{ codigo: "APIE-1030" }] }).clase).toBe("AUTORIZACION")
    expect(errorDelBanco(429, {}).clase).toBe("LIMITE")
    expect(errorDelBanco(503, null).clase).toBe("INCIERTO")
    expect(errorDelBanco(400, null).clase).toBe("INCIERTO")          // error sin explicación: no se sabe
    const desconocido = errorDelBanco(400, { codigo: 9999, descripcion: "Algo raro del banco" })
    expect(desconocido.clase).toBe("RECHAZO")
    expect(desconocido.message).toContain("Algo raro del banco")
  })
})

describe("Credicoop — revisión: endoso de e-cheq y simulador sin memoria", () => {
  it("el endoso solo se da por hecho con un estado concreto del e-cheq", () => {
    expect(estadoEcheq(" activo pendiente ")).toBe("ACTIVO-PENDIENTE")
    expect(estadoEcheq("Activo_Pendiente")).toBe("ACTIVO-PENDIENTE")
    expect(endosoSegunEcheq("ACTIVO-PENDIENTE")).toBe("hecho")
    expect(endosoSegunEcheq("activo - pendiente".replace(/ /g, ""))).toBe("hecho")
    expect(endosoSegunEcheq("activo")).toBe("pendiente")
    // No encontrado, vacío o un estado que no se esperaba: NUNCA hecho
    for (const t of [undefined, null, "", "RECHAZADO", "ANULADO", "CUSTODIA", "DEPOSITADO", "UN-ESTADO-NUEVO"]) expect(endosoSegunEcheq(t)).toBe("desconocido")
  })

  it("un simulador recién creado contesta por una operación sembrada (no depende de la memoria del servidor)", async () => {
    const pedido = armarTransferencia(EMPRESA, { idOrigen: "sembrada-1", cbuCuentaDebito: CBU_NUESTRO, hoy: HOY, beneficiarios: [PROVEEDOR] })
    const consultar = async (hecha: boolean) => {
      const sim = crearSimuladorCredicoop()   // otro servidor: no vio el envío
      const cliente = crearClienteCredicoop(CONFIG, { fetch: sim.fetch, firmar: () => "f" })
      sim.sembrar({ tipo: "transferencia", idOrigen: "sembrada-1", pedido, hecha })
      return (await cliente.consultarTransferencia({ idOrigen: "sembrada-1" })).resultado.estado
    }
    expect(await consultar(false)).toBe("enviada_a_firma")
    expect(await consultar(true)).toBe("firmada")
  })
})
