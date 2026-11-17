// Tanda 1-A — orden de compra: totales (E-08, E-97), acuerdo de pago y vencimientos (E-04..E-06)
// y el mensaje que se le manda al proveedor (E-03). Reglas puras de lib/compras.
import { describe, expect, it } from "vitest"
import { netoRenglon, precioNeto, totalesOC, unidadesRenglon } from "../../../../lib/compras/oc-totales"
import { netoCompra, tipoDescuentoDe } from "../../../../lib/compras/neto-compra"
import {
  acuerdoDeProveedor, acuerdoDeProveedorConLegado, acuerdoDelCanal, formaPagoVencimiento, modalidadVencimiento, normalizarAcuerdo,
  normalizarCuotas, planDePagos, textoCanal, textoCondicionPago,
} from "../../../../lib/compras/acuerdo-pago"
import { armarMime, asuntoOrden, base64DeTexto, cuerpoOrden, encabezadoUtf8, mailADespachar, rawParaGmail } from "../../../../lib/compras/mail-orden"

const deBase64 = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s+/g, "")), (c) => c.charCodeAt(0)))

describe("totales de la orden de compra", () => {
  it("el precio es por unidad: 2 bultos de 24 = 48 unidades", () => {
    const r = { cantidad_pedida: 2, tipo_cantidad: "bulto", precio_unitario: 1812.5, descuento1: 20, descuento2: 2.4, unidades_por_bulto: 24 }
    expect(unidadesRenglon(r)).toBe(48)
    expect(precioNeto(r)).toBeCloseTo(1415.2, 6)
    expect(netoRenglon(r)).toBe(67929.6)
  })

  it("pedido por unidad no multiplica por el bulto; bulto sin unidades por bulto = 1", () => {
    expect(unidadesRenglon({ cantidad_pedida: 7, tipo_cantidad: "unidad", unidades_por_bulto: 24 })).toBe(7)
    expect(unidadesRenglon({ cantidad_pedida: 3, tipo_cantidad: "bulto", unidades_por_bulto: null })).toBe(3)
    expect(unidadesRenglon({ cantidad_pedida: 3, tipo_cantidad: null, unidades_por_bulto: 10 })).toBe(30) // vacío = bulto
  })

  it("el neto NO se redondea antes de multiplicar (era la diferencia de centavos, E-97)", () => {
    // 1.812,50 − 20 % − 2,4 % = 1.415,20 exacto; con 3 descuentos queda con más decimales
    const r = { cantidad_pedida: 96, tipo_cantidad: "unidad", precio_unitario: 1933.33, descuento1: 3.5, descuento2: 0, descuento3: 0, descuento4: 0 }
    const exacto = 96 * 1933.33 * 0.965
    expect(netoRenglon(r)).toBe(Math.round(exacto * 100) / 100)
    // redondeando el precio primero daría otro total
    expect(netoRenglon(r)).not.toBe(Math.round(96 * (Math.round(1933.33 * 0.965 * 100) / 100) * 100) / 100)
  })

  it("misma orden que la prueba de la función SQL oc_totales (blanco + negro + mixto, percepciones 4,5 %)", () => {
    const t = totalesOC([
      { cantidad_pedida: 2, tipo_cantidad: "bulto", precio_unitario: 1812.5, descuento1: 20, descuento2: 2.4, unidades_por_bulto: 24, iva_compras: "factura" },
      { cantidad_pedida: 7, tipo_cantidad: "unidad", precio_unitario: 100, unidades_por_bulto: 1, iva_compras: "adquisicion_stock" },
      { cantidad_pedida: 3, tipo_cantidad: "bulto", precio_unitario: 33.33, unidades_por_bulto: 10, iva_compras: "mixto" },
    ], { percepcion_iva: 3, percepcion_iibb: 1.5 })
    expect(t).toMatchObject({
      neto: 69629.5, iva: 14370.21, percepciones: 3079.33,
      total_blanco: 85879.09, total_negro: 1199.95, total: 87079.04, renglones: 3, unidades: 85,
    })
  })

  it("la retención de Ganancias no es deuda: no entra en el total", () => {
    const con = totalesOC([{ cantidad_pedida: 1, tipo_cantidad: "unidad", precio_unitario: 1000 }], { percepcion_iva: 0, percepcion_iibb: 0, ...({ retencion_ganancias: 2 } as any) })
    expect(con.total).toBe(1210)
  })

  it("todo sin factura: sin IVA ni percepciones", () => {
    const t = totalesOC([{ cantidad_pedida: 5, tipo_cantidad: "unidad", precio_unitario: 110, iva_compras: "adquisicion_stock" }], { percepcion_iva: 3, percepcion_iibb: 3 })
    expect(t).toMatchObject({ neto: 550, iva: 0, percepciones: 0, total_blanco: 0, total_negro: 550, total: 550 })
  })

  it("descuentos del proveedor: en cascada o sobre precio de lista (Juan, 17/11)", () => {
    expect(netoCompra(1000, [10, 5, 0, 0], "cascada")).toBeCloseTo(855, 6)
    expect(netoCompra(1000, [10, 5, null, undefined], "sobre_lista")).toBeCloseTo(850, 6)
    expect(netoCompra(1000, [10, 5])).toBeCloseTo(855, 6) // sin dato = cascada
    expect(netoCompra(1000, [60, 60], "sobre_lista")).toBe(0) // nunca negativo
    expect(tipoDescuentoDe("cualquiera")).toBe("cascada")
    const r = { cantidad_pedida: 10, tipo_cantidad: "unidad", precio_unitario: 1000, descuento1: 10, descuento2: 5 }
    expect(netoRenglon(r, "cascada")).toBe(8550)
    expect(netoRenglon(r, "sobre_lista")).toBe(8500)
    expect(totalesOC([r], { tipo_descuento: "sobre_lista" }).neto).toBe(8500)
  })

  it("mixto: la parte con factura depende del proveedor; sin dato, 50 % (misma orden que la prueba SQL)", () => {
    const r = [{ cantidad_pedida: 10, tipo_cantidad: "unidad", precio_unitario: 1000, descuento1: 10, descuento2: 5, iva_compras: "mixto" }]
    const t70 = totalesOC(r, { tipo_descuento: "sobre_lista", mixto_pct_factura: 70 })
    expect(t70).toMatchObject({ neto: 8500, neto_blanco: 5950, neto_negro: 2550, total_blanco: 7199.5, total_negro: 2550, hay_mixto: true })
    expect(totalesOC(r, { tipo_descuento: "sobre_lista" })).toMatchObject({ neto_blanco: 4250, neto_negro: 4250 })
    expect(totalesOC(r, { tipo_descuento: "sobre_lista", mixto_pct_factura: 0 })).toMatchObject({ neto_blanco: 0, iva: 0, total: 8500 })
    expect(totalesOC(r, { tipo_descuento: "sobre_lista", mixto_pct_factura: 250 as any }).neto_blanco).toBe(4250) // inválido = 50
    // el neto (lo que ve el proveedor) no cambia con la proporción
    expect(t70.neto).toBe(totalesOC(r, { tipo_descuento: "sobre_lista", mixto_pct_factura: 20 }).neto)
  })

  it("renglones en cero no cuentan", () => {
    expect(totalesOC([{ cantidad_pedida: 0, precio_unitario: 100 }]).renglones).toBe(0)
  })
})

describe("acuerdo de pago", () => {
  const prov = {
    pago_blanco_medio: "cheques", pago_blanco_dias: 30, pago_blanco_cuotas: "30/60", pago_blanco_desde: "factura", pago_blanco_plazo_cheque: 30, pago_blanco_entrega: "retira_oficina",
    pago_negro_medio: null, pago_negro_dias: null, pago_negro_desde: null,
    plazo_dias: 99, dias_vencimiento: 77, // legado: NO se usa
  }

  it("sale de pago_blanco_* / pago_negro_* y nunca de plazo_dias / dias_vencimiento", () => {
    const a = acuerdoDeProveedor(prov)
    expect(a.blanco).toEqual({ medio: "cheques", dias: 30, cuotas: "30/60", desde: "factura", plazo_cheque: 30, entrega: "retira_oficina" })
    expect(a.negro).toBeNull()
    expect(acuerdoDeProveedor({ plazo_dias: 30, dias_vencimiento: 15 }).blanco.dias).toBeNull()
  })

  it("proveedor SIN plazo en el acuerdo: cae al dato viejo de la ficha, marcado (revisión 17/11)", () => {
    // GAETA: sin pago_blanco_dias, legado 20 días desde recepción
    const gaeta = acuerdoDeProveedorConLegado({ plazo_dias: 20, plazo_desde: "fecha_recepcion" })
    expect(gaeta.blanco).toMatchObject({ dias: 20, desde: "recepcion", de_legado: true })
    // LUQUE: contado
    expect(acuerdoDeProveedorConLegado({ plazo_dias: 0, plazo_desde: "fecha_factura" }).blanco).toMatchObject({ dias: 0, desde: "factura", de_legado: true })
    // la marca sobrevive a guardarse en la orden y volver a leerse
    expect(normalizarAcuerdo(JSON.parse(JSON.stringify(gaeta)))!.blanco.de_legado).toBe(true)
    expect(planDePagos(1000, "2026-12-01", gaeta.blanco)[0]).toMatchObject({ fecha: "2026-12-21", sin_plazo: false })
  })

  it("acuerdo y dato viejo contradictorios: manda el acuerdo, sin marca", () => {
    // BUYANOR: legado 30 desde recepción, acuerdo 0 desde recepción
    const b = acuerdoDeProveedorConLegado({ pago_blanco_dias: 0, pago_blanco_desde: "recepcion", plazo_dias: 30, plazo_desde: "fecha_recepcion" })
    expect(b.blanco).toMatchObject({ dias: 0, desde: "recepcion" })
    expect(b.blanco.de_legado).toBeUndefined()
    // COTY: legado 30 desde recepción, acuerdo 30 desde factura
    expect(acuerdoDeProveedorConLegado({ pago_blanco_dias: 30, pago_blanco_desde: "factura", plazo_dias: 30, plazo_desde: "fecha_recepcion" }).blanco.desde).toBe("factura")
  })

  it("negro sin acuerdo propio usa el de blanco", () => {
    const a = acuerdoDeProveedor(prov)
    expect(acuerdoDelCanal(a, "negro")).toEqual(a.blanco)
    const b = acuerdoDeProveedor({ ...prov, pago_negro_medio: "efectivo", pago_negro_dias: 0 })
    expect(acuerdoDelCanal(b, "negro")).toMatchObject({ medio: "efectivo", dias: 0 })
  })

  it("cuotas: acepta separadores y espacios; una sola no es cuota", () => {
    expect(normalizarCuotas("30 / 60/90")).toBe("30/60/90")
    expect(normalizarCuotas("30-60")).toBe("30/60")
    expect(normalizarCuotas("30")).toBeNull()
    expect(normalizarCuotas("treinta")).toBeNull()
  })

  it("lo que llega de la pantalla se limpia: valores fuera de lista quedan vacíos", () => {
    const a = normalizarAcuerdo({ blanco: { medio: "bitcoin", dias: "45", desde: "ayer", entrega: "paloma", plazo_cheque: -3 }, negro: {} })!
    expect(a.blanco).toEqual({ medio: null, dias: 45, cuotas: null, desde: "factura", plazo_cheque: null, entrega: null })
    expect(a.negro).toBeNull()
    expect(normalizarAcuerdo(null)).toBeNull()
  })

  it("medio y entrega → forma de pago y modalidad del vencimiento (solo valores que acepta la base)", () => {
    expect(formaPagoVencimiento("echeq")).toBe("cheque")
    expect(formaPagoVencimiento("cheques_y_efectivo")).toBe("cheque")
    expect(formaPagoVencimiento("transferencia")).toBe("transferencia")
    expect(formaPagoVencimiento(null)).toBeNull()
    expect(modalidadVencimiento("envio_grimar")).toBe("grimar")
    expect(modalidadVencimiento("transferencia")).toBeNull()
  })

  it("plan de pagos en cuotas: fechas desde la entrega estimada y centavos en la última", () => {
    const plan = planDePagos(85879.09, "2026-11-27", acuerdoDeProveedor(prov).blanco)
    expect(plan.map((p) => [p.fecha, p.monto, p.forma_pago, p.modalidad, p.fecha_validez])).toEqual([
      ["2026-12-27", 42939.55, "cheque", "entrega", "2027-01-26"],
      ["2027-01-26", 42939.54, "cheque", "entrega", "2027-02-25"],
    ])
    expect(plan.reduce((s, p) => s + p.monto, 0)).toBeCloseTo(85879.09, 2)
  })

  it("sin plazo acordado: un pago en la fecha base, marcado", () => {
    const plan = planDePagos(550, "2026-12-01", normalizarAcuerdo({ blanco: {} })!.blanco)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ fecha: "2026-12-01", monto: 550, sin_plazo: true, forma_pago: null })
    expect(planDePagos(0, "2026-12-01", acuerdoDeProveedor(prov).blanco)).toEqual([])
  })

  it("texto de la condición de pago", () => {
    const a = acuerdoDeProveedor(prov)
    expect(textoCanal(a.blanco)).toBe("Cheques a 30/60 días de la fecha de la factura (cheques hasta 30 días) · Retira en nuestra oficina")
    expect(textoCanal(acuerdoDeProveedor({ pago_blanco_medio: "transferencia", pago_blanco_dias: 0 }).blanco)).toBe("Transferencia contado")
    expect(textoCanal(acuerdoDeProveedor({}).blanco)).toBe("Sin acuerdo de pago cargado")
    const dos = acuerdoDeProveedor({ pago_blanco_medio: "transferencia", pago_blanco_dias: 30, pago_negro_medio: "efectivo", pago_negro_dias: 0 })
    expect(textoCondicionPago(dos, { blanco: true, negro: true })).toBe("Con factura: Transferencia a 30 días de la fecha de la factura. Sin factura: Efectivo contado")
    expect(textoCondicionPago(dos, { blanco: true, negro: false })).toBe("Transferencia a 30 días de la fecha de la factura")
    expect(textoCondicionPago(dos, { blanco: true, negro: true }).length).toBeLessThanOrEqual(100)
  })
})

describe("mail de la orden al proveedor", () => {
  const datos = {
    numero_orden: "OC-000012", proveedor: "HORNAL", empresa: "GM Distribuidora", fecha_entrega: "2026-11-27",
    condiciones: ["Transferencia a 30 días de la fecha de la factura"], renglones: 3, total: 87079.04,
    observaciones: "Entregar por la mañana", firma: "Juan", telefono: "291-4000000",
  }

  it("asunto y cuerpo con formatos argentinos", () => {
    expect(asuntoOrden(datos)).toBe("Orden de compra OC-000012 — GM Distribuidora")
    expect(asuntoOrden({ ...datos, reemplaza: true })).toMatch(/^ACTUALIZADA — /)
    const c = cuerpoOrden(datos)
    expect(c).toContain("orden de compra OC-000012")
    expect(c).toContain("Total: $87.079,04 (precios sin IVA)")
    expect(c).not.toMatch(/factura:/i) // al proveedor no se le separa con / sin factura
    expect(c).toContain("Fecha de entrega pedida: 27/11/2026")
    expect(c).toContain("Condición de pago: Transferencia a 30 días")
    expect(c).toContain("Observaciones: Entregar por la mañana")
    expect(cuerpoOrden({ ...datos, reemplaza: true })).toContain("ACTUALIZADA")
  })

  it("arma un mensaje MIME con texto, html y los adjuntos", () => {
    const pdf = base64DeTexto("%PDF-1.4 contenido de prueba ".repeat(20))
    const mime = armarMime({
      de: "compras@gm.com.ar", nombreDe: "GM Distribuidora", para: ["ventas@hornal.com", "pedidos@hornal.com"], cc: ["ventas@hornal.com", "jefe@gm.com.ar"],
      asunto: asuntoOrden(datos), texto: cuerpoOrden(datos),
      adjuntos: [{ nombre: "OC_OC-000012.pdf", tipo: "application/pdf", base64: pdf }, { nombre: "OC_OC-000012.xlsx", tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: base64DeTexto("xlsx") }],
    }, "F")
    const cab = mime.split("\r\n\r\n")[0]
    expect(cab).toContain("From: GM Distribuidora <compras@gm.com.ar>")
    expect(cab).toContain("To: ventas@hornal.com, pedidos@hornal.com")
    expect(cab).toContain("Cc: jefe@gm.com.ar") // el repetido en "para" no va en copia
    expect(cab).toContain('Content-Type: multipart/mixed; boundary="F_m"')
    expect(cab).toMatch(/Subject: =\?UTF-8\?B\?/) // el asunto tiene "—": va codificado
    // todo el mensaje es ASCII (lo que tiene acentos va en base64)
    expect(/^[\x00-\x7f]*$/.test(mime)).toBe(true)
    // ninguna línea de más de 78 caracteres en los cuerpos
    expect(mime.split("\r\n").every((l) => l.length <= 200)).toBe(true)
    expect(mime).toContain('Content-Disposition: attachment; filename="OC_OC-000012.pdf"')
    expect(mime).toContain('Content-Disposition: attachment; filename="OC_OC-000012.xlsx"')
    expect(mime.trimEnd().endsWith("--F_m--")).toBe(true)

    // el texto se recupera igual
    const parteTexto = mime.split("--F_a")[1]
    expect(deBase64(parteTexto.split("\r\n\r\n")[1])).toBe(cuerpoOrden(datos).replace(/\n/g, "\r\n"))
    // el PDF adjunto se recupera byte a byte
    const partePdf = mime.split("--F_m").find((p) => p.includes('filename="OC_OC-000012.pdf"'))!
    expect(partePdf.split("\r\n\r\n")[1].replace(/\s+/g, "")).toBe(pdf)
    // y el campo raw de Gmail es base64url sin relleno que vuelve al mismo mensaje
    const raw = rawParaGmail(mime)
    expect(/^[A-Za-z0-9_-]+$/.test(raw)).toBe(true)
    expect(deBase64(raw.replace(/-/g, "+").replace(/_/g, "/"))).toBe(mime)
  })

  it("el asunto codificado vuelve al texto original", () => {
    const enc = encabezadoUtf8("ACTUALIZADA — Orden de compra OC-000012 — Señor Ñandú & Cía. Distribución")
    const dec = enc.split(/\r\n /).map((t) => deBase64(t.replace(/^=\?UTF-8\?B\?/, "").replace(/\?=$/, ""))).join("")
    expect(dec).toBe("ACTUALIZADA — Orden de compra OC-000012 — Señor Ñandú & Cía. Distribución")
    expect(encabezadoUtf8("Orden simple")).toBe("Orden simple")
  })

  it("MODO PRUEBA (Juan, 17/11): todo va solo a la dirección de prueba, nunca al proveedor", () => {
    const ajustes = { cuenta_envio: "compras@empresa.test", modo_prueba: true, mail_prueba: "prueba@empresa.test" }
    const m = { para: ["ventas@hornal.com", "pedidos@hornal.com"], cc: ["jefe@hornal.com"], asunto: "Orden de compra OC-000012 — GM", texto: "Hola" }
    const d = mailADespachar(ajustes, m)
    expect(d.para).toEqual(["prueba@empresa.test"])
    expect(d.cc).toEqual([])
    expect(d.prueba).toBe(true)
    expect(d.asunto).toBe("[PRUEBA] Orden de compra OC-000012 — GM")
    expect(d.seria).toEqual(["ventas@hornal.com", "pedidos@hornal.com", "jefe@hornal.com"])
    expect(d.texto).toContain("NO se le envió al proveedor")
    expect(d.texto).toContain("ventas@hornal.com, pedidos@hornal.com, jefe@hornal.com")
    expect(d.texto.endsWith("Hola")).toBe(true)
    // el mensaje armado no nombra al proveedor en ningún encabezado
    const cab = armarMime({ de: ajustes.cuenta_envio, para: d.para, cc: d.cc, asunto: d.asunto, texto: d.texto }, "F").split("\r\n\r\n")[0]
    expect(cab).toContain("To: prueba@empresa.test")
    expect(cab).not.toContain("hornal.com")
    expect(cab).not.toMatch(/^Cc:/m)
    // no duplica el prefijo en un reenvío
    expect(mailADespachar(ajustes, { ...m, asunto: d.asunto }).asunto).toBe(d.asunto)
  })

  it("con el modo prueba apagado el mail va a quien se escribió, sin tocar nada", () => {
    const m = { para: ["ventas@hornal.com"], cc: ["jefe@hornal.com"], asunto: "Orden", texto: "Hola" }
    expect(mailADespachar({ cuenta_envio: "c@e.test", modo_prueba: false, mail_prueba: "p@e.test" }, m)).toEqual({ ...m, prueba: false, seria: ["ventas@hornal.com"] })
  })

  it("rechaza sin destinatario, mails inválidos e intento de inyectar encabezados", () => {
    const base = { de: "compras@gm.com.ar", asunto: "x", texto: "y" }
    expect(() => armarMime({ ...base, para: [] })).toThrow(/destinatario/)
    expect(() => armarMime({ ...base, para: ["no-es-mail"] })).toThrow(/inválidas/)
    expect(() => armarMime({ ...base, para: ["a@b.com"], asunto: " " })).toThrow(/asunto/)
    const m = armarMime({ ...base, para: ["a@b.com"], asunto: "Hola\r\nBcc: espia@x.com" }, "F")
    expect(m.split("\r\n\r\n")[0]).not.toMatch(/^Bcc:/m)
  })
})
