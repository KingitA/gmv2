// Lectura de movimientos del banco sin duplicar (Tanda 1 del plan de bancos, 27/11/2026).
// Las capturas de abajo son las del homebanking de Nación (25 y 26.png) y Provincia (27 y 28.png)
// tal como las devuelve la IA. Los extractos de octubre se prueban completos solo si están en la
// máquina (son datos reales: no van en el repositorio).
import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  bancoDeCuenta, bancoDelTexto, extraerContraparte, leerExcelMp, leerPdfCredicoop, leerPdfNacion, leerPdfProvincia,
  prepararLote, type FilaLeida, type Lectura, type MovExistente, type MovLeido,
} from "../../../../lib/bancos/lectura"

const cap = (filas: FilaLeida[], extra: Partial<Lectura> = {}): Lectura => ({ nombre: "captura", origen: "captura", orden: "nuevo_primero", filas, ...extra })
/** "Guardar": lo nuevo (y lo sin control) pasa a la base */
const guardar = (base: MovExistente[], filas: MovLeido[]) => [
  ...base,
  ...filas.filter((f) => f.estado === "nuevo" || f.estado === "sin_control")
    .map((f) => ({ referencia_externa: f.clave, fecha: f.fecha, monto: f.monto, fuente_detalle: f.origen, saldo_banco: f.saldo })),
]

// ─── Nación (25.png y 26.png) ────────────────────────────────────────────────
const NACION_26_11: FilaLeida[] = [
  { fecha: "26/11/2026", hora: "00:00:00", concepto: "GRAVAMEN LEY 25413 S/DEB", detalle: "-", debito: "- $ 9,34" },
  { fecha: "26/11/2026", hora: "00:00:00", concepto: "GRAVAMEN LEY 25413 S/DEB", detalle: "-", debito: 9169.86 },
  { fecha: "26/11/2026", hora: "00:00:00", concepto: "REG.REC.SIRCREB", detalle: "-", debito: 1556.22 },
  { fecha: "26/11/2026", hora: "00:00:00", concepto: "GRAVAMEN LEY 25413 S/CRED", detalle: "-", debito: 3112.44 },
  { fecha: "26/11/2026", hora: "13:26:57", concepto: "DEB.TRAN.INTERB", detalle: "COMPA IA DE HIGIENE TO 23123974123", debito: 1528310 },
  { fecha: "26/11/2026", hora: "11:30:17", concepto: "CR DEBIN RED LINK", detalle: "AGUSTIN MANUEL PENA GIMEN 20389197891", credito: "$ 518.740,53" },
]
const NACION_25_24: FilaLeida[] = [
  { fecha: "25/11/2026", hora: "00:00:00", concepto: "GRAVAMEN LEY 25413 S/DEB", debito: 10.52 },
  { fecha: "25/11/2026", hora: "00:00:00", concepto: "REG.REC.SIRCREB", debito: 1753.15 },
  { fecha: "25/11/2026", hora: "00:00:00", concepto: "GRAVAMEN LEY 25413 S/CRED", debito: 3506.3 },
  { fecha: "25/11/2026", hora: "09:23:56", concepto: "CR DEBIN RED LINK", detalle: "YIHAI HUANG 23190608859", credito: 584384 },
  { fecha: "24/11/2026", hora: "00:00:00", concepto: "GRAVAMEN LEY 25413 S/DEB", debito: 13.9 },
  { fecha: "24/11/2026", hora: "00:00:00", concepto: "GRAVAMEN LEY 25413 S/DEB", debito: 77.4 },
  { fecha: "24/11/2026", hora: "00:00:00", concepto: "REG.REC.SIRCREB", debito: 2315.85 },
  { fecha: "24/11/2026", hora: "00:00:00", concepto: "GRAVAMEN LEY 25413 S/CRED", debito: 4631.7 },
  { fecha: "24/11/2026", hora: "00:00:00", concepto: "REG.REC.SIRCREB", debito: 12900 },
  { fecha: "24/11/2026", hora: "00:00:00", concepto: "GRAVAMEN LEY 25413 S/CRED", debito: 25800 },
]

describe("Nación: capturas", () => {
  it("lee importe con signo, hora y contraparte con CUIT válido", () => {
    const r = prepararLote("nacion", [cap(NACION_26_11)], [])
    expect(r.nuevos).toBe(6)
    expect(r.errores).toBe(0)
    const debin = r.filas.find((f) => f.concepto === "CR DEBIN RED LINK")!
    expect(debin.monto).toBe(518740.53)
    expect(debin.hora).toBe("11:30:17")
    expect(debin.contraparte_cuit).toBe("20-38919789-1")
    expect(debin.contraparte_nombre).toBe("AGUSTIN MANUEL PENA GIMEN")
    expect(r.filas.find((f) => f.concepto === "DEB.TRAN.INTERB")!.monto).toBe(-1528310)
    expect(r.filas[0].monto).toBe(-9.34)
  })

  it("subir la misma captura otra vez, o capturas que se superponen, no duplica", () => {
    let base: MovExistente[] = []
    const r1 = prepararLote("nacion", [cap(NACION_26_11)], base)
    base = guardar(base, r1.filas)
    // Segunda subida: la de ayer + la de hoy otra vez (se superponen)
    const r2 = prepararLote("nacion", [cap(NACION_26_11), cap(NACION_25_24)], base)
    expect(r2.ya_estaban).toBe(6)
    expect(r2.nuevos).toBe(10)
    base = guardar(base, r2.filas)
    const r3 = prepararLote("nacion", [cap(NACION_25_24.slice(3)), cap(NACION_26_11.slice(2))], base)
    expect(r3.nuevos).toBe(0)
    expect(base).toHaveLength(16)
  })

  it("impuestos idénticos del mismo día: queda el máximo visto en UNA captura, nunca la suma", () => {
    const imp: FilaLeida = { fecha: "27/11/2026", hora: "00:00:00", concepto: "GRAVAMEN LEY 25413 S/DEB", debito: 12 }
    const otro: FilaLeida = { fecha: "27/11/2026", hora: "10:00:01", concepto: "CR DEBIN RED LINK", credito: 2000 }
    let base: MovExistente[] = []
    // Captura A: dos iguales
    let r = prepararLote("nacion", [cap([imp, otro, imp])], base)
    expect(r.nuevos).toBe(3)
    base = guardar(base, r.filas)
    // Captura B: uno solo (vista parcial) → nada nuevo
    r = prepararLote("nacion", [cap([imp])], base)
    expect(r.nuevos).toBe(0)
    // Lote con dos capturas que muestran 2 y 1: sigue siendo 2
    r = prepararLote("nacion", [cap([imp, imp]), cap([imp, otro])], base)
    expect(r.nuevos).toBe(0)
    // Captura C: tres iguales → entra UNO (el tercero)
    r = prepararLote("nacion", [cap([imp, imp, otro, imp])], base)
    expect(r.nuevos).toBe(1)
    base = guardar(base, r.filas)
    expect(base.filter((b) => b.monto === -12)).toHaveLength(3)
  })

  it("un CUIT mal leído no se guarda (dígito verificador) y la fila sigue siendo la misma", () => {
    const bien = prepararLote("nacion", [cap([NACION_26_11[5]])], [])
    const mal = prepararLote("nacion", [cap([{ ...NACION_26_11[5], detalle: "AGUSTIN MANUEL PENA GIMEN 20389197890" }])], [])
    expect(mal.filas[0].contraparte_cuit).toBeNull()
    expect(mal.filas[0].clave).toBe(bien.filas[0].clave)
  })

  it("renglón ilegible: se muestra con error y no entra", () => {
    const r = prepararLote("nacion", [cap([{ fecha: "26/11/2026", hora: "12:00:00", concepto: "CR DEBIN", credito: "ilegible" }, NACION_26_11[4]])], [])
    expect(r.errores).toBe(1)
    expect(r.nuevos).toBe(1)
    expect(r.filas.find((f) => f.estado === "error")!.problema).toMatch(/Importe/)
  })
})

// ─── Provincia (27.png y 28.png) ─────────────────────────────────────────────
const PROV_27: FilaLeida[] = [
  { fecha: "27/11/2026", concepto: "IMPUESTO DEBITO - LEY 25413", monto: "-$ 20,70", saldo: "-$ 63.348,57" },
  { fecha: "27/11/2026", concepto: "IMPUESTO DEBITO - LEY 25413", monto: -414, saldo: -63327.87 },
  { fecha: "27/11/2026", concepto: "IMPUESTO I.BRUTOS - PERCEPCION", monto: -3450, saldo: -62913.87 },
  { fecha: "27/11/2026", concepto: "COMISION MANTENIMIENTO COMISION MANTENIM. PERIODO DESDE 28-10-2026 HASTA 26-11-2026", monto: -69000, saldo: -59463.87 },
  { fecha: "25/11/2026", concepto: "COMISION TRANSFERENCIA/GIRO", monto: -5900, saldo: 9536.13 },
  { fecha: "25/11/2026", concepto: "IMPUESTO DEBITO - LEY 25413", monto: -34800, saldo: 15436.13 },
]
const PROV_28: FilaLeida[] = [
  { fecha: "25/11/2026", concepto: "DEBITO TRANS.CAJERO AUT.TRAS. TRANSF A LOREAL ARGENTINA SA (30501460423) FAC FAC 444350", monto: -5800000, saldo: 50236.13 },
  { fecha: "24/11/2026", concepto: "REV. IMP.DEBITO.-LEY 25413", monto: 48.6, saldo: 5850236.13 },
  { fecha: "24/11/2026", concepto: "REVERSA INGRESOS BRUTO SIRCREB", monto: 8100, saldo: 5850187.53 },
  { fecha: "24/11/2026", concepto: "REV. IMP.CREDITO-LEY 25413", monto: 16200, saldo: 5842087.53 },
  { fecha: "24/11/2026", concepto: "CHEQUE/O.E. RECHAZADO", monto: -2700000, saldo: 5825887.53 },
  { fecha: "24/11/2026", concepto: "IMPUESTO DEBITO - LEY 25413", monto: -48.6, saldo: 8525887.53 },
  { fecha: "24/11/2026", concepto: "IMPUESTO CREDITO -LEY 25413", monto: -16200, saldo: 8525936.13 },
  { fecha: "24/11/2026", concepto: "INGRESOS BRUTOS SIRCREB", monto: -8100, saldo: 8542136.13 },
]

describe("Provincia: capturas con saldo por renglón", () => {
  it("encadena por saldo: el más viejo queda sin control, el resto controlado; saldo actual = el de arriba", () => {
    const r = prepararLote("provincia", [cap(PROV_27)], [])
    expect(r.errores).toBe(0)
    expect(r.sin_control).toBe(1)
    expect(r.nuevos).toBe(5)
    expect(r.filas.find((f) => f.estado === "sin_control")!.monto).toBe(-34800)
    expect(r.saldo).toEqual({ saldo: -63348.57, al: "ahora", fuente: "captura (último renglón)" })
  })

  it("dos capturas juntas: se controlan entre sí (la de abajo le da el saldo anterior a la de arriba)", () => {
    const r = prepararLote("provincia", [cap(PROV_27), cap(PROV_28)], [])
    expect(r.errores).toBe(0)
    expect(r.nuevos).toBe(13)
    expect(r.sin_control).toBe(1) // solo el más viejo de todo (INGRESOS BRUTOS SIRCREB)
    const lor = r.filas.find((f) => f.monto === -5800000)!
    expect(lor.contraparte_cuit).toBe("30-50146042-3")
    expect(lor.contraparte_nombre).toBe("LOREAL ARGENTINA SA")
  })

  it("si la IA lee mal un importe la cadena no cierra: ese renglón NO se guarda", () => {
    const mal = PROV_27.map((f, i) => (i === 2 ? { ...f, monto: -3540 } : f))
    const r = prepararLote("provincia", [cap(mal)], [])
    expect(r.errores).toBe(1)
    expect(r.filas.find((f) => f.estado === "error")!.problema).toMatch(/no cierra/)
  })

  it("lo ya guardado controla al más viejo de la captura nueva y no se duplica", () => {
    let base: MovExistente[] = []
    base = guardar(base, prepararLote("provincia", [cap(PROV_28)], base).filas)
    const r = prepararLote("provincia", [cap(PROV_27), cap(PROV_28.slice(0, 3))], base)
    expect(r.ya_estaban).toBe(3)
    expect(r.nuevos).toBe(6)
    expect(r.sin_control).toBe(0)
  })

  it("renglón sin saldo visible (cortado): error, no se inventa", () => {
    const r = prepararLote("provincia", [cap([...PROV_28, { fecha: "24/11/2026", concepto: "DEPOSITO", monto: 2700000 }])], [])
    expect(r.filas.find((f) => f.monto === 2700000)!.estado).toBe("error")
  })
})

describe("Otras fuentes del mismo banco: por día + importe, entra solo la diferencia", () => {
  it("PDF de Nación después de las capturas: lo que ya entró por captura no se duplica", () => {
    let base: MovExistente[] = []
    base = guardar(base, prepararLote("nacion", [cap(NACION_26_11)], base).filas)
    const pdf: Lectura = {
      nombre: "pdf", origen: "pdf", orden: "viejo_primero", saldo_inicial: 1000000,
      filas: [
        { fecha: "26/11/26", concepto: "DEBIN 20389197891", referencia: "20900", monto: 518740.53, saldo: 1518740.53 },
        { fecha: "26/11/26", concepto: "TRANSF.INT.DIST-LINKLAR", referencia: "20901", monto: 1000, saldo: 1519740.53 },
        { fecha: "26/11/26", concepto: "GRAVAMEN LEY 25413 S/DEB", referencia: "20900", monto: -9.34, saldo: 1519731.19 },
        { fecha: "26/11/26", concepto: "GRAVAMEN LEY 25413 S/DEB", referencia: "20901", monto: -9.34, saldo: 1519721.85 },
      ],
    }
    const r = prepararLote("nacion", [pdf], base)
    expect(r.errores).toBe(0)
    expect(r.ya_estaban).toBe(2) // el DEBIN y UN impuesto de 9,34 (la captura vio uno solo)
    expect(r.nuevos).toBe(2)
  })
})

describe("Contraparte", () => {
  it("Credicoop: CUIT-código-NOMBRE y CBU", () => {
    const c = extraerContraparte("Credito Inmediato (DEBIN) dist titular", "27953018549−VAR−REBECA SOLABARRIETA CBU Origen:3220001805000054570077")
    expect(c).toEqual({ nombre: "REBECA SOLABARRIETA", cuit: "27-95301854-9", cbu: "3220001805000054570077" })
    expect(extraerContraparte("Transf. Interbanking", "Ord.:30506957970−COOPERATIVA AGR G NECO").nombre).toBe("COOPERATIVA AGR G NECO")
  })
  it("MercadoPago: nombre del que transfiere", () => {
    expect(extraerContraparte("Transferencia recibida DANIEL OMAR,GENTILI", "").nombre).toBe("DANIEL OMAR, GENTILI")
  })
  it("banco de la cuenta", () => {
    expect(bancoDeCuenta({ banco: "Banco de la Nación Argentina" })).toBe("nacion")
    expect(bancoDeCuenta({ nombre: "Provincia cta cte" })).toBe("provincia")
    expect(bancoDeCuenta({ banco: "MercadoPago" })).toBe("mp")
    expect(bancoDeCuenta({ banco: "Credicoop" })).toBe("credicoop")
  })
})

// ─── Extractos de octubre (solo en la máquina de desarrollo) ────────────────
const DIR = process.env.EXTRACTOS_OCT ?? "C:/Users/INTEL PC1/AppData/Local/Temp/claude/e0109a47763aff3f/28d390d2-d831-407f-b2ee-5a79aadb583c/scratchpad/extractos/"
const Q = process.env.EXTRACTOS_OCT_ORIGINALES ?? "Q:/DJ_Gestion/Exportaciones/2026/10. OCTUBRE/"
const hay = (f: string) => existsSync(DIR + f)
const leer = (f: string) => readFileSync(DIR + f, "utf8")

describe.skipIf(!hay("extractos provincia oct.pdf.txt"))("Extractos reales de octubre", () => {
  it("Provincia: todos los renglones cierran por saldo", () => {
    const t = leer("extractos provincia oct.pdf.txt")
    expect(bancoDelTexto(t)).toBe("provincia")
    const l = leerPdfProvincia(t)
    const r = prepararLote("provincia", [l], [])
    expect(l.saldo_inicial).toBe(2913352.62)
    expect(r.errores).toBe(0)
    expect(r.sin_control).toBe(0)
    expect(r.nuevos).toBe(l.filas.length)
    expect(l.filas.length).toBeGreaterThan(30)
    expect(r.saldo?.saldo).toBe(40033.28)
    // Volver a subirlo no duplica
    expect(prepararLote("provincia", [l], guardar([], r.filas)).nuevos).toBe(0)
  })

  it("Nación: el sentido sale del saldo y todo cierra", () => {
    const t = leer("extractos nacion oct.pdf.txt")
    expect(bancoDelTexto(t)).toBe("nacion")
    const l = leerPdfNacion(t)
    const r = prepararLote("nacion", [l], [])
    expect(r.errores).toBe(0)
    expect(r.sin_control).toBe(0)
    expect(l.filas.length).toBeGreaterThan(100)
    expect(r.filas.find((f) => f.concepto.startsWith("EMIS TRANSFERENCIA"))!.monto).toBe(-5877243.82)
    expect(r.filas.find((f) => f.concepto === "DEBIN 20350340670")!.contraparte_cuit).toBe("20-35034067-0")
  })

  it("Credicoop: cada día cierra con el saldo del banco", () => {
    const t = leer("EXTRACTOS CREDICOOP OCT.pdf.txt")
    expect(bancoDelTexto(t)).toBe("credicoop")
    const l = leerPdfCredicoop(t)
    const r = prepararLote("credicoop", [l], [])
    expect(l.saldo_inicial).toBe(36462070.78)
    expect(l.saldo_final).toBe(9545357.56)
    expect(l.filas.length).toBeGreaterThan(300)
    expect(r.errores).toBe(0)
    const debin = r.filas.find((f) => f.detalle.includes("REBECA SOLABARRIETA"))!
    expect(debin.monto).toBe(800000)
    expect(debin.contraparte_cbu).toBe("3220001805000054570077")
    expect(r.filas.find((f) => f.detalle.includes("OLDCLAN"))!.monto).toBe(-357523.06)
    expect(r.filas.find((f) => f.detalle.includes("COOPERATIVA AGR G NECO"))!.monto).toBe(6113763.83)
    expect(r.filas.find((f) => f.concepto.startsWith("Transferencia por Pago de Haberes"))!.monto).toBe(-3563226.17)
    // Los impuestos son débitos
    expect(r.filas.filter((f) => /SIRCREB|Ley 25\.413|I\.V\.A\./.test(f.concepto)).every((f) => f.monto < 0)).toBe(true)
    const suma = r.filas.reduce((t, f) => t + f.monto, 0)
    expect(Math.abs(36462070.78 + suma - 9545357.56)).toBeLessThan(0.02)
  })

  it.skipIf(!existsSync(Q))("los PDF y el Excel originales, leídos como en el servidor (unpdf / xlsx)", async () => {
    const { extractText, getDocumentProxy } = await import("unpdf")
    const texto = async (f: string) => {
      const { text } = await extractText(await getDocumentProxy(new Uint8Array(readFileSync(Q + f))), { mergePages: false })
      return (Array.isArray(text) ? text : [text]).join("\n")
    }
    for (const [f, banco, lector] of [
      ["extractos provincia oct.pdf", "provincia", leerPdfProvincia],
      ["extractos nacion oct.pdf", "nacion", leerPdfNacion],
      ["EXTRACTOS CREDICOOP OCT.pdf", "credicoop", leerPdfCredicoop],
    ] as const) {
      const t = await texto(f)
      expect(bancoDelTexto(t)).toBe(banco)
      const l = lector(t)
      const r = prepararLote(banco, [l], [])
      expect(r.errores, f).toBe(0)
      expect(r.nuevos, f).toBe(l.filas.length)
      const suma = r.filas.reduce((s, x) => s + x.monto, 0)
      expect(Math.abs((l.saldo_inicial as number) + suma - (l.saldo_final as number)), f).toBeLessThan(0.02)
    }
    const XLSX = await import("xlsx")
    const wb = XLSX.read(readFileSync(Q + "extractos mp oct.xlsx"), { cellDates: false })
    const hoja: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" })
    const l = leerExcelMp(hoja)!
    const r = prepararLote("mp", [l], [])
    expect(r.errores).toBe(0)
    expect(r.sin_control).toBe(0)
    expect(r.saldo?.saldo).toBe(13070147.5)
  })

  it("MercadoPago (Excel): REFERENCE_ID + saldo parcial, todo controlado", () => {
    const csv = leer("mp-sheet0.csv")
    // CSV simple con comillas
    const filas = csv.split(/\r?\n/).map((l) => (l.match(/("([^"]*)"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "")))
    const l = leerExcelMp(filas)!
    const r = prepararLote("mp", [l], [])
    expect(l.saldo_inicial).toBe(7749427.62)
    expect(r.errores).toBe(0)
    expect(r.sin_control).toBe(0)
    expect(r.saldo?.saldo).toBe(13070147.5)
    expect(r.filas.find((f) => f.concepto.startsWith("Transferencia recibida JONATAN"))!.contraparte_nombre).toBe("JONATAN EZEQUIEL ROMERO")
  })
})
