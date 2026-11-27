/**
 * Lectores DETERMINÍSTICOS (sin IA) de los extractos mensuales y archivos de cada banco.
 * Un PDF generado por el banco trae el texto adentro: se lee tal cual (unpdf) y se arma cada
 * renglón con expresiones regulares. Cero inventos: lo que no cierra se marca con `problema`.
 *
 *  - Provincia (PDF): fecha · concepto (puede seguir en otra línea) · importe con signo · fecha valor · saldo.
 *  - Nación (PDF): fecha · movimiento · comprobante · importe · saldo. Débito y crédito no se
 *    distinguen en el texto: el sentido sale del saldo (saldo anterior ± importe = saldo).
 *  - Credicoop (PDF): fecha · comprobante · descripción · importe (+ saldo al final del día) y una
 *    segunda línea con CUIT−código−NOMBRE y CBU. El sentido sale de la descripción y se CONTROLA
 *    con el saldo de cada día; si un día no cierra, sus renglones no se guardan.
 *  - MercadoPago (Excel): RELEASE_DATE · TRANSACTION_TYPE · REFERENCE_ID · neto · saldo parcial.
 *  - Cualquier otro Excel/CSV: se buscan las columnas por el encabezado.
 *
 * El texto lo arma la ruta con unpdf (una página tras otra). Pruebas con los extractos reales de
 * octubre 2026: mobile/packages/core/test/bancos-lectura.test.ts.
 */
import { parseFecha, parseMonto, redondear } from "../../formato"
import { limpiarTexto } from "./contraparte"
import type { BancoLectura, FilaLeida, Lectura } from "./tipos"

const TOL = 0.011
const lineasDe = (texto: string) => texto.split(/\r?\n/).map((l) => limpiarTexto(l)).filter(Boolean)

/** ¿De qué banco es este texto de PDF? (para no aplicar el lector equivocado) */
export function bancoDelTexto(texto: string): BancoLectura | null {
  const t = texto.slice(0, 4000).toUpperCase()
  if (/CREDICOOP/.test(t)) return "credicoop"
  if (/NACION ARGENTINA|NACIÓN ARGENTINA/.test(t)) return "nacion"
  if (/BANCOPROVINCIA|BANCO PROVINCIA|BANCO DE LA PROVINCIA|EXTRACTO DE CUENTA INFORMATIVO/.test(t)) return "provincia"
  return null
}

// ─── Provincia ───────────────────────────────────────────────────────────────

export function leerPdfProvincia(texto: string): Lectura {
  const filas: FilaLeida[] = []
  let saldoInicial: number | null = null
  let actual: { fecha: string; texto: string } | null = null
  const FIN = /^(.*?)\s*(-?\d+\.\d{2})\s+(\d{2}-\d{2})\s+(-?\d+\.\d{2})$/
  const cerrar = () => {
    if (!actual) return
    const m = FIN.exec(actual.texto)
    if (m) filas.push({ fecha: actual.fecha, concepto: m[1].trim(), monto: parseMonto(m[2]), saldo: parseMonto(m[4]) })
  }
  for (const l of lineasDe(texto)) {
    const ant = /^(\d{2}\/\d{2}\/\d{4})\s+SALDO ANTERIOR\s+(-?\d+\.\d{2})$/.exec(l)
    if (ant) { saldoInicial = parseMonto(ant[2]); actual = null; continue }
    const ini = /^(\d{2}\/\d{2}\/\d{4})\s+(.*)$/.exec(l)
    if (ini) {
      actual = { fecha: ini[1], texto: ini[2] }
      if (FIN.test(actual.texto)) { cerrar(); actual = null }
      continue
    }
    if (actual) {
      actual.texto = `${actual.texto} ${l}`
      if (FIN.test(actual.texto)) { cerrar(); actual = null }
      else if (actual.texto.length > 400) actual = null
    }
  }
  const fechas = filas.map((f) => parseFecha(String(f.fecha))).filter(Boolean) as string[]
  return {
    nombre: "Extracto Provincia", origen: "pdf", orden: "viejo_primero", filas,
    saldo_inicial: saldoInicial, saldo_final: filas.length ? (filas[filas.length - 1].saldo as number) : null,
    periodo_desde: fechas[0] ?? null, periodo_hasta: fechas[fechas.length - 1] ?? null,
  }
}

// ─── Nación ──────────────────────────────────────────────────────────────────

const MONTO_AR = String.raw`\d{1,3}(?:\.\d{3})*,\d{2}`

export function leerPdfNacion(texto: string): Lectura {
  const filas: FilaLeida[] = []
  let saldoInicial: number | null = null
  let previo: number | null = null
  let desde: string | null = null, hasta: string | null = null
  const per = /PERIODO:\s*(\d{2}\/\d{2}\/\d{4})\s*AL\s*(\d{2}\/\d{2}\/\d{4})/.exec(texto)
  if (per) { desde = parseFecha(per[1]); hasta = parseFecha(per[2]) }
  const RENGLON = new RegExp(String.raw`^(\d{2}\/\d{2}\/\d{2})\s+(.+?)\s+(\S+)\s+(${MONTO_AR})\s+(${MONTO_AR}-?|-${MONTO_AR})$`)
  for (const l of lineasDe(texto)) {
    const ant = new RegExp(String.raw`^SALDO ANTERIOR\s+(-?${MONTO_AR}-?)$`).exec(l)
    if (ant) { saldoInicial = parseMonto(ant[1]); previo = saldoInicial; continue }
    const tr = new RegExp(String.raw`^TRANSPORTE\s+(-?${MONTO_AR}-?)$`).exec(l)
    if (tr) { previo = parseMonto(tr[1]); continue }
    const m = RENGLON.exec(l)
    if (!m) continue
    const importe = parseMonto(m[4]) as number, saldo = parseMonto(m[5]) as number
    let monto: number | null = null
    let problema: string | null = null
    if (previo == null) problema = "No se encontró el saldo anterior"
    else if (Math.abs(previo + importe - saldo) < TOL) monto = importe
    else if (Math.abs(previo - importe - saldo) < TOL) monto = -importe
    else problema = "El saldo no cierra con el renglón anterior"
    filas.push({ fecha: m[1], concepto: m[2], referencia: m[3], monto: monto ?? importe, saldo, problema })
    previo = saldo
  }
  return {
    nombre: "Extracto Nación", origen: "pdf", orden: "viejo_primero", filas,
    saldo_inicial: saldoInicial, saldo_final: filas.length ? (filas[filas.length - 1].saldo as number) : null,
    periodo_desde: desde, periodo_hasta: hasta,
  }
}

// ─── Credicoop ───────────────────────────────────────────────────────────────

/** Sentido por la descripción: +1 crédito, −1 débito, 0 = no se sabe (lo decide el saldo del día). */
export function sentidoCredicoop(desc: string, detalle: string): 1 | -1 | 0 {
  const d = desc.toUpperCase(), x = detalle.toUpperCase()
  if (/REVERS|CONTRASIENTO|DEVOLUCION/.test(d)) return 0
  if (/CREDITO INMEDIATO|ACREDITAC|ACRED VALORES|LIQUIDACION DE PRESTAMO|PRESTAMO POR CONVENIO|COBRANZA DE CREDITOS|DEPOSITO|INTERESES GANADOS/.test(d) && !/COMIS|COM\.? ACRED|COM ACRED/.test(d)) return 1
  if (/CBU ORIGEN|^ORD\.?:/.test(x)) return 1
  if (/CBU DESTINO|SE ACREDITARA EN/.test(x)) return -1
  if (/^TRANSF|^TRANSFER/.test(d)) return 0
  if (/DEBITO\/CREDITO/.test(d)) return 0
  return -1
}

export function leerPdfCredicoop(texto: string): Lectura {
  type R = { fecha: string; combte: string | null; desc: string; detalle: string[]; importe: number; saldoDia: number | null }
  const rs: R[] = []
  let saldoInicial: number | null = null, saldoFinal: number | null = null
  let desde: string | null = null, hasta: string | null = null
  const per = /del:\s*(\d{2}\/\d{2}\/\d{4})\s*al:\s*(\d{2}\/\d{2}\/\d{4})/.exec(texto)
  if (per) { desde = parseFecha(per[1]); hasta = parseFecha(per[2]) }
  const RENGLON = new RegExp(String.raw`^(\d{2}\/\d{2}\/\d{2})\s+(?:(\d{3,7})\s+)?(.+?)\s+(${MONTO_AR})(?:\s+(-?${MONTO_AR}-?))?$`)
  let enMovimientos = false
  for (const l of lineasDe(texto)) {
    const ant = new RegExp(String.raw`^SALDO ANTERIOR\s+(-?${MONTO_AR}-?)$`).exec(l)
    if (ant) { saldoInicial = parseMonto(ant[1]); enMovimientos = true; continue }
    const fin = new RegExp(String.raw`^SALDO AL\s+\d{2}\/\d{2}\/\d{2}\s+(-?${MONTO_AR}-?)$`).exec(l)
    if (fin) { saldoFinal = parseMonto(fin[1]); enMovimientos = false; break }
    if (!enMovimientos) continue
    if (/^(=== |CONTINUA EN PAGINA|>>>|FECHA COMBTE|Cuenta Corriente|Debito directo|Banco Credicoop|Credicoop Responde|Calidad de Servicios|PAGINA )/i.test(l)) continue
    const m = RENGLON.exec(l)
    if (m) {
      rs.push({ fecha: m[1], combte: m[2] ?? null, desc: m[3], detalle: [], importe: parseMonto(m[4]) as number, saldoDia: m[5] ? parseMonto(m[5]) : null })
    } else if (rs.length && !/^\d{2}\/\d{2}\/\d{2}\s/.test(l)) {
      rs[rs.length - 1].detalle.push(l)
    }
  }

  // Sentido por regla y control por el saldo de cada día (el banco imprime el saldo en el último renglón del día)
  const filas: FilaLeida[] = []
  let previo = saldoInicial
  let dia: R[] = []
  const cerrarDia = (saldoDia: number) => {
    const sentidos = dia.map((r) => sentidoCredicoop(r.desc, r.detalle.join(" ")))
    const firmes: number[] = sentidos.map((s) => (s === 0 ? -1 : s))
    const suma = (ss: number[]) => redondear(dia.reduce((t, r, i) => t + ss[i] * r.importe, 0))
    let problema: string | null = null
    let elegidos: number[] | null = null
    if (previo == null) problema = "No se encontró el saldo anterior"
    else {
      const objetivo = redondear(saldoDia - previo)
      if (Math.abs(suma(firmes) - objetivo) < TOL) elegidos = firmes
      else {
        // Probar dar vuelta los dudosos (todas las combinaciones si son pocos), después de a uno y de a dos cualquiera
        const dudosos = sentidos.map((s, i) => (s === 0 ? i : -1)).filter((i) => i >= 0)
        const soluciones: number[][] = []
        if (dudosos.length && dudosos.length <= 12) {
          for (let mask = 1; mask < 1 << dudosos.length; mask++) {
            const ss = [...firmes]
            dudosos.forEach((idx, b) => { if (mask & (1 << b)) ss[idx] = -ss[idx] })
            if (Math.abs(suma(ss) - objetivo) < TOL) soluciones.push(ss)
          }
        }
        if (!soluciones.length) {
          const n = dia.length
          for (let i = 0; i < n && soluciones.length < 3; i++) {
            const s1 = [...firmes]; s1[i] = -s1[i]
            if (Math.abs(suma(s1) - objetivo) < TOL) soluciones.push(s1)
            for (let j = i + 1; j < n && soluciones.length < 3; j++) {
              const s2 = [...s1]; s2[j] = -s2[j]
              if (Math.abs(suma(s2) - objetivo) < TOL) soluciones.push(s2)
            }
          }
        }
        // Única (o todas equivalentes: mismos importes dados vuelta)
        const firma = (ss: number[]) => dia.map((r, i) => ss[i] * r.importe).sort((a, b) => a - b).join(",")
        if (soluciones.length && soluciones.every((s) => firma(s) === firma(soluciones[0]))) elegidos = soluciones[0]
        else problema = "El día no cierra con el saldo del banco"
      }
    }
    dia.forEach((r, i) => {
      const detalle = r.detalle.join(" ")
      filas.push({
        fecha: r.fecha, concepto: r.desc, detalle, referencia: r.combte,
        monto: elegidos ? elegidos[i] * r.importe : -r.importe,
        saldo: i === dia.length - 1 ? saldoDia : null,
        problema,
      })
    })
    previo = saldoDia
    dia = []
  }
  for (const r of rs) {
    dia.push(r)
    if (r.saldoDia != null) cerrarDia(r.saldoDia)
  }
  if (dia.length) {
    // Renglones después del último saldo impreso: se controlan contra el SALDO AL del final
    if (saldoFinal != null) cerrarDia(saldoFinal)
    else dia.forEach((r) => filas.push({ fecha: r.fecha, concepto: r.desc, detalle: r.detalle.join(" "), referencia: r.combte, monto: -r.importe, problema: "Sin saldo del día para controlar" }))
  }
  return { nombre: "Extracto Credicoop", origen: "pdf", orden: "viejo_primero", filas, saldo_inicial: saldoInicial, saldo_final: saldoFinal ?? previo, periodo_desde: desde, periodo_hasta: hasta }
}

// ─── MercadoPago (Excel de "Dinero disponible") ──────────────────────────────

const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()

export function leerExcelMp(filasHoja: unknown[][]): Lectura | null {
  const h = filasHoja.findIndex((r) => r.some((c) => norm(c) === "release_date") && r.some((c) => norm(c) === "reference_id"))
  if (h < 0) return null
  const cab = filasHoja[h].map(norm)
  const col = (n: string) => cab.indexOf(n)
  const iF = col("release_date"), iT = col("transaction_type"), iR = col("reference_id"), iN = col("transaction_net_amount"), iS = col("partial_balance")
  let saldoInicial: number | null = null, saldoFinal: number | null = null
  const ib = filasHoja.findIndex((r) => r.some((c) => norm(c) === "initial_balance"))
  if (ib >= 0 && ib < h) {
    const cabB = filasHoja[ib].map(norm), val = filasHoja[ib + 1] ?? []
    saldoInicial = parseMonto(val[cabB.indexOf("initial_balance")] as string)
    saldoFinal = parseMonto(val[cabB.indexOf("final_balance")] as string)
  }
  const filas: FilaLeida[] = []
  for (const r of filasHoja.slice(h + 1)) {
    if (!r || r.every((c) => String(c ?? "").trim() === "")) continue
    const tipo = limpiarTexto(String(r[iT] ?? ""))
    filas.push({
      fecha: typeof r[iF] === "number" ? (r[iF] as number) : String(r[iF] ?? ""),
      concepto: tipo,
      referencia: String(r[iR] ?? "").trim() || null,
      monto: r[iN] as number | string,
      saldo: iS >= 0 ? (r[iS] as number | string) : null,
    })
  }
  const fechas = filas.map((f) => parseFecha(f.fecha as string)).filter(Boolean) as string[]
  return {
    nombre: "Excel MercadoPago", origen: "archivo", orden: "viejo_primero", filas,
    saldo_inicial: saldoInicial, saldo_final: saldoFinal ?? (filas.length ? parseMonto(filas[filas.length - 1].saldo as string) : null),
    periodo_desde: fechas[0] ?? null, periodo_hasta: fechas[fechas.length - 1] ?? null,
  }
}

// ─── Excel / CSV genérico (p. ej. "Descargar" del homebanking) ───────────────

export function leerExcelGenerico(filasHoja: unknown[][], nombre: string): Lectura | null {
  const esFecha = (x: string) => x.includes("fecha") || x === "date"
  const esImporte = (x: string) => /debito|credito|debit|credit|importe|monto|amount/.test(x)
  const h = filasHoja.slice(0, 20).findIndex((r) => r.map(norm).some(esFecha) && r.map(norm).some(esImporte))
  if (h < 0) return null
  const cab = filasHoja[h].map(norm)
  const idx = (...c: string[]) => { for (const x of c) { const i = cab.findIndex((v) => v.includes(x)); if (i >= 0) return i } return -1 }
  const iF = idx("fecha", "date"), iH = idx("hora", "time"), iC = idx("concepto", "descrip", "movimiento", "transaction_type", "leyenda", "operacion")
  const iD = cab.findIndex((v, i) => i !== iC && /detalle|referencia adicional|beneficiario|originante/.test(v))
  const iDeb = idx("debito", "debit"), iCred = idx("credito", "credit"), iImp = idx("importe", "monto", "amount"), iS = idx("saldo", "balance")
  const iR = idx("comprob", "referencia", "reference", "nro. operacion", "numero de operacion")
  const filas: FilaLeida[] = []
  for (const r of filasHoja.slice(h + 1)) {
    if (!r || r.every((c) => String(c ?? "").trim() === "")) continue
    const f = r[iF]
    if (!parseFecha(typeof f === "number" ? f : String(f ?? "").trim().split(/\s+/)[0])) continue
    filas.push({
      fecha: typeof f === "number" ? f : String(f ?? ""),
      hora: iH >= 0 ? String(r[iH] ?? "") : null,
      concepto: iC >= 0 ? String(r[iC] ?? "") : "",
      detalle: iD >= 0 ? String(r[iD] ?? "") : "",
      debito: iDeb >= 0 ? (r[iDeb] as string) : null,
      credito: iCred >= 0 ? (r[iCred] as string) : null,
      monto: iDeb < 0 && iCred < 0 && iImp >= 0 ? (r[iImp] as string) : null,
      saldo: iS >= 0 ? (r[iS] as string) : null,
      referencia: iR >= 0 ? String(r[iR] ?? "").trim() || null : null,
    })
  }
  if (!filas.length) return null
  // ¿Lo más nuevo arriba? (homebanking)
  const fs = filas.map((x) => parseFecha(typeof x.fecha === "number" ? x.fecha : String(x.fecha).split(/\s+/)[0]) ?? "")
  const orden = fs[0] > fs[fs.length - 1] ? "nuevo_primero" : "viejo_primero"
  return { nombre, origen: "archivo", orden, filas }
}
