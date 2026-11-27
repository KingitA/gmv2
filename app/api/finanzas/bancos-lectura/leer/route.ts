import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { cuentaBancaria } from "@/lib/bancos/lectura-servidor"
import { leerConIA } from "@/lib/bancos/lectura-ia"
import { bancoDelTexto, leerExcelGenerico, leerExcelMp, leerPdfCredicoop, leerPdfNacion, leerPdfProvincia, type Lectura } from "@/lib/bancos/lectura"

export const maxDuration = 120

/**
 * POST /api/finanzas/bancos-lectura/leer — lee UNA captura o UN archivo del banco (no guarda nada).
 * FormData: file, cuenta_id.
 *  - Imagen (captura del homebanking): Gemini con el prompt del banco de la cuenta.
 *  - PDF del banco con texto (Credicoop / Nación / Provincia): lector exacto, sin IA. Si no tiene
 *    texto o es de otro banco: Gemini.
 *  - Excel / CSV: MercadoPago por sus columnas; otro banco por los encabezados.
 * → { lectura } para mandar después a /api/finanzas/bancos-lectura/lote (vista previa y guardado).
 * Las imágenes se mandan de a una (y achicadas desde la pantalla): Vercel corta a los 4,5 MB.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const fd = await request.formData()
    const file = fd.get("file") as File | null
    const cuentaId = String(fd.get("cuenta_id") ?? "")
    if (!file || !cuentaId) return NextResponse.json({ error: "Falta el archivo o la cuenta" }, { status: 400 })
    const cuenta = await cuentaBancaria(createAdminClient(), cuentaId)
    if (!cuenta) return NextResponse.json({ error: "No se encontró la cuenta" }, { status: 404 })
    const banco = cuenta.banco_lectura
    const nombre = file.name || "captura"
    const buffer = Buffer.from(await file.arrayBuffer())
    const mime = file.type || ""

    let lectura: Lectura | null = null
    if (mime.startsWith("image/")) {
      lectura = await leerConIA(banco, { base64: buffer.toString("base64"), mime, nombre, origen: "captura" })
    } else if (mime === "application/pdf" || /\.pdf$/i.test(nombre)) {
      const texto = await textoDelPdf(buffer)
      const delTexto = texto ? bancoDelTexto(texto) : null
      if (texto && delTexto && delTexto !== banco && banco !== "otro") {
        return NextResponse.json({ error: `Ese PDF es de ${NOMBRE[delTexto]} y la cuenta elegida es ${cuenta.nombre}.` }, { status: 422 })
      }
      const lector = delTexto === "provincia" ? leerPdfProvincia : delTexto === "nacion" ? leerPdfNacion : delTexto === "credicoop" ? leerPdfCredicoop : null
      if (texto && lector) {
        const l = lector(texto)
        if (l.filas.length) lectura = { ...l, nombre }
      }
      lectura ??= await leerConIA(banco, { base64: buffer.toString("base64"), mime: "application/pdf", nombre, origen: "pdf" })
    } else if (/\.(xlsx|xls|csv|txt)$/i.test(nombre) || /sheet|excel|csv/.test(mime)) {
      // CSV: texto plano (las fechas dd/mm se interpretan después con parseFecha, nunca como mm/dd)
      const esCsv = /\.(csv|txt)$/i.test(nombre) || mime === "text/csv"
      const wb = XLSX.read(buffer, { cellDates: false, raw: esCsv })
      const hoja: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" })
      lectura = leerExcelMp(hoja) ?? leerExcelGenerico(hoja, nombre)
      if (lectura) lectura = { ...lectura, nombre }
      if (!lectura) return NextResponse.json({ error: "No se encontraron las columnas de fecha e importe en el archivo." }, { status: 422 })
    } else {
      return NextResponse.json({ error: "Formato no soportado: subí una imagen, un PDF, un Excel o un CSV." }, { status: 400 })
    }

    if (!lectura.filas.length) return NextResponse.json({ error: "No se encontraron movimientos." }, { status: 422 })
    return NextResponse.json({ ok: true, banco, lectura })
  } catch (error: any) {
    console.error("[bancos-lectura/leer] error:", error)
    return NextResponse.json({ error: error.message ?? "No se pudo leer" }, { status: 500 })
  }
}

const NOMBRE = { nacion: "Banco Nación", provincia: "Banco Provincia", credicoop: "Credicoop", mp: "MercadoPago", otro: "otro banco" } as const

/** Texto del PDF página por página (unpdf). null si no tiene texto (escaneado) o falla. */
async function textoDelPdf(buffer: Buffer): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf")
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { text } = await extractText(pdf, { mergePages: false })
    const t = (Array.isArray(text) ? text : [text]).join("\n")
    return t.trim().length >= 50 ? t : null
  } catch (e) {
    console.warn("[bancos-lectura/leer] PDF sin texto:", (e as Error)?.message)
    return null
  }
}
