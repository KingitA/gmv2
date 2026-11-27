// Clasificación de impuestos y gastos bancarios (Tanda 2 del plan de bancos, 27/11/2026).
// Los textos son los que traen los extractos de octubre y las capturas del homebanking. Los
// extractos completos se prueban solo si están en la máquina (son datos reales: no van al repositorio).
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CONCEPTOS_BANCO, clasificarMovimiento, normalizarConcepto, textoAClasificar, type ConceptoId } from "../../../../lib/bancos/clasificacion"
import { leerExcelMp, leerPdfCredicoop, leerPdfNacion, leerPdfProvincia, prepararLote, type BancoLectura, type Lectura } from "../../../../lib/bancos/lectura"

const casos = (banco: BancoLectura, lista: [string, number, ConceptoId][]) =>
  it.each(lista)(`${banco}: "%s" (%d) → %s`, (texto, monto, esperado) => {
    expect(clasificarMovimiento(banco, texto, monto)).toBe(esperado)
  })

describe("Credicoop", () => {
  casos("credicoop", [
    ["Impuesto Ley 25.413 Ali Gral s/Creditos", -23400, "ley25413_creditos"],
    ["Impuesto Ley 25.413 Alic Gral s/Debitos", -117391.75, "ley25413_debitos"],
    ["Recaudacion SIRCREB CM − Condicion E", -2400, "sircreb"],
    ["Percep Ingr Brutos Bs.As. − Categoria 1", -3911.21, "percepcion_iibb"],
    ["Percepcion IVA RG 2408 s/Comis−Gastos", -2346.72, "percepcion_iva"],
    ["I.V.A. − Debito Fiscal 21%", -126, "iva_comisiones"],
    ["Comision Transferencias]Inmediatas!COM", -1200, "comision_transferencias"],
    ["Comision Transferencias]Diferidas!COMT", -3600, "comision_transferencias"],
    ["ECHQ−Comis acred Camara sin Filial Bco", -78224.13, "comision_cheques"],
    ["CHEQUE−Com acred Camara sin Filial Bco", -1000, "comision_cheques"],
    ["ECHQ −Comis acred C Int con Filial Bco", -1000, "comision_cheques"],
    ["Comision E−CHEQ pagado por Clearing", -1200, "comision_cheques"],
    ["Comision Cheque Pagado por Clearing", -1200, "comision_cheques"],
    ["Com. mantenimiento cuenta", -74000, "comision_mantenimiento"],
    ["Honorarios por Informes", -62154.64, "honorarios_informes"],
    ["Arancel por Informe de Domino", -20400, "honorarios_informes"],
    ["Servicio acreditaciones automaticas", -85, "comision_otros"],
    ["Comis. Retiro Caja en Filial de Origen", -500000, "comision_otros"],
    ["Debito Automatico Directo", -138975.31, "debito_automatico"],
    ["Debito/Credito Aut − Segurcoop Comercio", -73195.33, "debito_automatico"],
    ["Pago de Servicios", -39947.99, "pago_servicios"],
    ["Pago de Obligaciones a ARCA", -530899.69, "pago_arca"],
    ["Liquidacion de Prestamo", 14450000, "prestamo"],
    ["Cobranza de Creditos", -338130, "prestamo"],
    // Operativos: no son gastos
    ["Credito Inmediato (DEBIN) dist titular", 800000, "movimiento"],
    ["Transf.Inmediata e/Ctas.Dist Tit.O/Bco", -357523.06, "movimiento"],
    ["Transf. Inmediata e/Ctas. Dist. Titular", 100000, "movimiento"],
    ["Acreditacion de Valores − Camara", 6113763.83, "movimiento"],
    ["ECHQ − Acreditac de Valores − Camara", 500000, "movimiento"],
    ["Pago de Cheque de Camara", -200000, "movimiento"],
    ["ECHEQ − Debito cheque rechazado", -150000, "movimiento"],
    ["Transferencia por Pago de Haberes", -3563226.17, "movimiento"],
    ["Debito Inmediato (DEBIN)", -50000, "movimiento"],
  ])
})

describe("Nación", () => {
  casos("nacion", [
    ["GRAVAMEN LEY 25413 S/DEB", -9.34, "ley25413_debitos"],
    ["GRAVAMEN LEY 25413 S/CRED", -3112.44, "ley25413_creditos"],
    ["REG.REC.SIRCREB", -1556.22, "sircreb"],
    ["I.V.A. BASE", -14490, "iva_comisiones"],
    ["RETEN. I.V.A. RG.2408", -2070, "percepcion_iva"],
    ["GRAVAMEN IB PERCEP. BA", -3450, "percepcion_iibb"],
    ["COMISION PAQUETES", -69000, "comision_mantenimiento"],
    ["COMIS.TRANSF.NE24", -1130, "comision_transferencias"],
    ["COM ECH CANJE O/BANCOS", -130137.66, "comision_cheques"],
    ["DEBITO PAGO DIRECTO", -747842, "debito_automatico"],
    ["PAGO PRESTAMO", -3955696.8, "prestamo"],
    ["CR DEBIN RED LINK", 518740.53, "movimiento"],
    ["DEB.TRAN.INTERB", -1528310, "movimiento"],
    ["TRANSF.INT.DIST-LINKLAR", 407567, "movimiento"],
    ["DEP. CH. 48 HS. BNA", 5558074, "movimiento"],
    ["CAM.FED.DIST.PZA. O/BCOS.", 18591094.84, "movimiento"],
  ])
})

describe("Provincia", () => {
  casos("provincia", [
    ["IMPUESTO DEBITO - LEY 25413", -5422.07, "ley25413_debitos"],
    ["IMPUESTO CREDITO -LEY 25413", -50177.33, "ley25413_creditos"],
    ["INGRESOS BRUTOS SIRCREB", -25088.6, "sircreb"],
    ["REVERSA INGRESOS BRUTO SIRCREB", 1800, "sircreb_reverso"],
    ["REV. IMP.DEBITO.-LEY 25413", 132000, "ley25413_reverso"],
    ["COMISION GESTION DE COBRO DE CHEQUES DE FECHA 05-10-2026", -8362.88, "comision_cheques"],
    ["COMISION MANTENIM. PERIODO DESDE 28-09-2026 HASTA 28-10-2026", -69000, "comision_mantenimiento"],
    ["COMISION TRANSFERENCIA/GIRO", -5900, "comision_transferencias"],
    ["IMPUESTO I.BRUTOS - PERCEPCION", -3450, "percepcion_iibb"],
    ["BIP DB TR 02/10-C.000310594578 DES:0014-27-620605931404", -903677.58, "movimiento"],
    ["DEPOSITO CHEQUE C/BANCOS NRO: 000000000", 8362887.95, "movimiento"],
    ["CHEQUE/O.E. RECHAZADO", -500000, "movimiento"],
    ["CR.DEBIN 30/10-S.843896 C:30710229240", 600000, "movimiento"],
  ])
})

describe("MercadoPago", () => {
  casos("mp", [
    ["Pago de impuestos INDUSTRIAS PLEXI S.R", -1836.49, "ley25413_debitos"],
    ["Pago de impuesto Keel Sa", -25800, "ley25413_debitos"],
    ["Rendimientos", 4006.7, "rendimientos"],
    ["Pago de servicio Osecac", -140840, "pago_servicios"],
    ["Débito por deuda Facturas vencidas de Mercado Libre", -3965.54, "comision_otros"],
    ["Transferencia recibida Mario Oscar Rossi", 141422.64, "movimiento"],
    ["Transferencia enviada Colgate-palmolive", -306081.6, "movimiento"],
    ["Liquidación de dinero Venta con QR", 391728, "movimiento"],
  ])
})

describe("reglas generales", () => {
  it("un impuesto a favor (importe positivo) es una reversa aunque el banco no lo diga", () => {
    expect(clasificarMovimiento("nacion", "GRAVAMEN LEY 25413 S/DEB", 9.34)).toBe("ley25413_reverso")
    expect(clasificarMovimiento("nacion", "REG.REC.SIRCREB", 1556.22)).toBe("sircreb_reverso")
    expect(clasificarMovimiento("credicoop", "Percepcion IVA RG 2408 s/Comis−Gastos", 105)).toBe("percepcion_reverso")
  })
  it("'Pago de impuestos' es Ley 25.413 solo en MercadoPago", () => {
    expect(clasificarMovimiento("credicoop", "Pago de impuestos", -100)).toBe("otro")
  })
  it("un nombre con COM / ARCA no confunde: COMERCIAL no es comisión, una transferencia de ARCA SA es movimiento", () => {
    expect(clasificarMovimiento("mp", "Transferencia recibida COMERCIAL DEL SUR", 1000)).toBe("movimiento")
    expect(clasificarMovimiento("credicoop", "Transf. Inmediata e/Ctas. Dist. Titular — 30-1-VAR-ARCA SA", 1000)).toBe("movimiento")
  })
  it("lo desconocido queda 'otro' (para mirarlo), y vacío también", () => {
    expect(clasificarMovimiento("nacion", "ALGO RARO", -10)).toBe("otro")
    expect(clasificarMovimiento("nacion", "", -10)).toBe("otro")
  })
  it("normaliza acentos y guiones raros", () => {
    expect(normalizarConcepto("Percep  Ingr Brutos Bs.As. − Categoría 1")).toBe("PERCEP INGR BRUTOS BS.AS. - CATEGORIA 1")
  })
  it("usa el concepto del banco; si no está (movimientos viejos), la descripción", () => {
    expect(textoAClasificar({ concepto_banco: "REG.REC.SIRCREB", descripcion: "otra cosa" })).toBe("REG.REC.SIRCREB")
    expect(textoAClasificar({ concepto_banco: null, descripcion: "GRAVAMEN LEY 25413 S/DEB — 20727" })).toBe("GRAVAMEN LEY 25413 S/DEB — 20727")
  })
  it("el catálogo es el mismo que el de la migración 20261127b", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../../../supabase/migrations/20261127b_bancos_clasificacion.sql", import.meta.url)), "utf8")
    const filas = [...sql.matchAll(/\('([a-z0-9_]+)',\s*'([^']+)',\s*'([a-z]+)',\s*'([a-z]+)',\s*(\d+)\)/g)]
      .map((m) => ({ id: m[1], nombre: m[2], tipo: m[3], signo: m[4], orden: Number(m[5]) }))
    expect(filas).toEqual(CONCEPTOS_BANCO.map((c) => ({ ...c })))
  })
})

// ─── Extractos de octubre: lo clasificado suma igual que los totales del banco ─────────
const DIR = process.env.EXTRACTOS_OCT ?? "C:/Users/INTEL PC1/AppData/Local/Temp/claude/e0109a47763aff3f/28d390d2-d831-407f-b2ee-5a79aadb583c/scratchpad/extractos/"
const hay = (f: string) => existsSync(DIR + f)
const leer = (f: string) => readFileSync(DIR + f, "utf8")

/** Total (positivo = lo que se cobró) por concepto de una lectura entera */
function totales(banco: BancoLectura, l: Lectura) {
  const r = prepararLote(banco, [l], [])
  const t = new Map<ConceptoId, number>()
  for (const f of r.filas) {
    const c = clasificarMovimiento(banco, f.concepto, f.monto)
    t.set(c, (t.get(c) ?? 0) - f.monto)
  }
  const de = (...ids: ConceptoId[]) => Math.round(ids.reduce((s, id) => s + (t.get(id) ?? 0), 0) * 100) / 100
  return { de, t }
}
/** "PERCIBIDO DEL 01−10−2026 AL 31−10−2026 : 2.411.557,31" debajo del título */
function percibido(texto: string, titulo: RegExp): number {
  const lineas = texto.split(/\r?\n/)
  const i = lineas.findIndex((x) => titulo.test(x))
  const m = /PERCIBIDO.*:\s*([\d.]+,\d{2})/.exec(lineas.slice(i, i + 3).join(" "))
  if (i < 0 || !m) throw new Error(`no encontré ${titulo}`)
  return Number(m[1].replace(/\./g, "").replace(",", "."))
}

describe.skipIf(!hay("EXTRACTOS CREDICOOP OCT.pdf.txt"))("Credicoop octubre: totales del pie del resumen", () => {
  it("Ley 25.413, SIRCREB, IVA RG 2408 e IVA inscripto cierran al centavo", () => {
    const texto = leer("EXTRACTOS CREDICOOP OCT.pdf.txt")
    const { de, t } = totales("credicoop", leerPdfCredicoop(texto))
    expect(de("ley25413_debitos", "ley25413_creditos", "ley25413_reverso")).toBe(percibido(texto, /^TOTAL IMPUESTO LEY 25413/))
    expect(de("ley25413_debitos", "ley25413_creditos")).toBe(2411557.31)
    expect(de("sircreb", "sircreb_reverso")).toBe(percibido(texto, /^REG\. DE RECAUDACION SIRCREB/))
    expect(de("percepcion_iva")).toBe(percibido(texto, /^IVA.ALIC ADIC RG 2408/))
    expect(de("iva_comisiones")).toBe(percibido(texto, /^IVA . ALICUOTA INSCRIPTO/))
    expect(t.get("otro") ?? 0).toBe(0)
  })
})

describe.skipIf(!hay("extractos nacion oct.pdf.txt"))("Nación octubre: totales del pie del resumen", () => {
  it("Ley 25.413 créditos / débitos y SIRCREB cierran al centavo", () => {
    const texto = leer("extractos nacion oct.pdf.txt")
    const total = (re: RegExp) => Number(re.exec(texto)![1].replace(/\./g, "").replace(",", "."))
    const { de, t } = totales("nacion", leerPdfNacion(texto))
    expect(de("ley25413_creditos")).toBe(total(/TOTAL GRAV\. LEY 25413 CREDITOS.*\$ ([\d.]+,\d{2})/))
    expect(de("ley25413_debitos")).toBe(total(/TOTAL GRAV\. LEY 25413 DEBITOS.*\$ ([\d.]+,\d{2})/))
    expect(de("sircreb")).toBe(total(/TOTAL REG REC\. SIRCREB.*\$ ([\d.]+,\d{2})/))
    expect(t.get("otro") ?? 0).toBe(0)
  })
})

describe.skipIf(!hay("extractos provincia oct.pdf.txt"))("Provincia y MercadoPago octubre", () => {
  it("Provincia: todo reconocido, la reversa de Ley 25.413 resta", () => {
    const { de, t } = totales("provincia", leerPdfProvincia(leer("extractos provincia oct.pdf.txt")))
    expect(t.get("otro") ?? 0).toBe(0)
    expect(de("ley25413_reverso")).toBe(-132000)
    expect(de("comision_mantenimiento")).toBe(69000)
  })
  it.skipIf(!hay("mp-sheet0.csv"))("MercadoPago: 'Pago de impuestos' = 0,6 % de cada transferencia enviada", () => {
    const filas = leer("mp-sheet0.csv").split(/\r?\n/).map((l) => (l.match(/("([^"]*)"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "")))
    const l = leerExcelMp(filas)!
    const r = prepararLote("mp", [l], [])
    const { t } = totales("mp", l)
    expect(t.get("otro") ?? 0).toBe(0)
    // Cada "Pago de impuestos X" va con su "Transferencia enviada X" (mismo REFERENCE_ID) y es el 0,6 %
    const imp = r.filas.filter((f) => clasificarMovimiento("mp", f.concepto, f.monto) === "ley25413_debitos")
    expect(imp.length).toBeGreaterThan(10)
    for (const f of imp) {
      const tr = r.filas.find((x) => x.referencia === f.referencia && x.concepto.startsWith("Transferencia enviada"))
      if (tr) expect(Math.abs(Math.abs(tr.monto) * 0.006 - Math.abs(f.monto))).toBeLessThan(0.02)
    }
  })
})
