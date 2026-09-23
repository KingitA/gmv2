import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai"
import { normalizarMonto, resultadoConDatos, sanearCheque, sanearTransferencia, type ResultadoOcr } from "@/lib/cheques/isomorfico"
import { subirFotoComprobante, type FotoSubida } from "@/lib/cobranzas/fotos"

// POST /api/pagos-clientes/ocr — multipart `files[]` (una o varias fotos).
//
// Por cada foto, EN PARALELO: la sube al bucket y la lee con Gemini. La respuesta
// devuelve, por archivo, la URL de la foto y los comprobantes leídos YA VALIDADOS
// (lib/cheques: CUIT por dígito verificador, fecha y monto por formato/rango). Lo que
// no valida no viaja: el cliente lo carga a mano. Nunca un dato inventado.
//
// `solo_subir=1`: guarda la foto sin OCR (reintento de adjuntar cuando la lectura
// falló, o el usuario ya cargó los datos).
//
// Contrato de salida (retrocompatible con la app vendedor v0.2.x y las pantallas
// de oficina): { success, resultados[], total_encontrados, archivos[], errores? }.
// Cada resultado trae además `archivo_index` (a qué foto pertenece).

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Esquema de salida: fuerza JSON válido (antes estaba definido pero NO se aplicaba).
const OCR_SCHEMA: any = {
  type: SchemaType.OBJECT,
  properties: {
    resultados: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          tipo: { type: SchemaType.STRING, description: "cheque | transferencia | deposito" },
          monto: { type: SchemaType.NUMBER },
          numero_cheque: { type: SchemaType.STRING },
          banco_emisor: { type: SchemaType.STRING },
          fecha_emision: { type: SchemaType.STRING },
          fecha_cheque: { type: SchemaType.STRING },
          cuit_emisor: { type: SchemaType.STRING },
          cuits_titulares: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          localidad: { type: SchemaType.STRING },
          color_cheque: { type: SchemaType.STRING, description: "ECHEQ solo si es cheque electrónico; en papel no devolver este campo" },
          cbu_destino: { type: SchemaType.STRING },
          cvu_destino: { type: SchemaType.STRING },
          fecha_transferencia: { type: SchemaType.STRING },
          numero_comprobante: { type: SchemaType.STRING },
          fecha_deposito: { type: SchemaType.STRING },
          items: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                tipo_item: { type: SchemaType.STRING, description: "efectivo | cheque" },
                monto: { type: SchemaType.NUMBER },
                banco_emisor: { type: SchemaType.STRING },
                numero_cheque: { type: SchemaType.STRING },
                fecha_pago_cheque: { type: SchemaType.STRING },
                numero_comprobante_deposito: { type: SchemaType.STRING },
                fecha_deposito_efectivo: { type: SchemaType.STRING },
                nro_comprobante_deposito_ef: { type: SchemaType.STRING },
              },
              required: ["tipo_item", "monto"],
            },
          },
        },
        required: ["tipo"],
      },
    },
  },
  required: ["resultados"],
}

const PROMPT = `Sos un experto en documentos bancarios y de pagos argentinos.

Analizá esta imagen y extraé TODOS los comprobantes de pago que aparecen (puede haber uno o varios: cheques, transferencias, depósitos).

REGLA PRINCIPAL: COPIÁ, NO COMPLETES. Transcribí lo que está impreso; nunca completes dígitos que no ves ni corrijas un número para que "cierre". Si un dato no está en la imagen, null. Un campo inventado es un error grave; un campo transcripto con un dígito dudoso lo revisa el sistema.

CHEQUE (tipo: "cheque"):
- numero_cheque: número del cheque, solo dígitos.
- banco_emisor: nombre del banco emisor (logo/leyenda a la izquierda). Si no está claro, null.
- FECHAS (prioridad alta): un cheque común tiene UNA sola fecha impresa (arriba a la derecha, "Lugar y fecha"): devolvela en fecha_cheque Y en fecha_emision. Un cheque de pago diferido tiene dos: "fecha de emisión" → fecha_emision y "fecha de pago" → fecha_cheque. Formato YYYY-MM-DD; si está en letras ("30 de octubre de 2026") convertila. Devolvé siempre la fecha si se ve, aunque sea futura.
- monto: importe numérico sin símbolos. En el cheque figura en números y en letras: deben coincidir. Tené en cuenta que puede usar coma decimal y punto de miles o viceversa.
- cuit_emisor (prioridad alta): CUIT/CUIL del titular de la cuenta, 11 dígitos. Está impreso junto al nombre del titular (abajo a la izquierda o debajo del nombre), precedido por "CUIT", "C.U.I.T.", "CUIL" o "CT", con o sin guiones (20-12345678-6 / 20123456786). Transcribí los 11 dígitos exactamente como se leen, en formato XX-XXXXXXXX-X, aunque tengas dudas de un dígito (el sistema verifica el dígito verificador). Solo devolvé null si directamente no hay CUIT impreso o faltan dígitos. NO uses el número de cheque, el número de cuenta ni la línea inferior (MICR).
- cuits_titulares: TODOS los CUITs impresos junto a los nombres de los titulares (cuenta conjunta = dos). Mismo formato. Si hay uno solo, array con ese único CUIT.
- localidad: si es visible.
- color_cheque: "ECHEQ" únicamente si es un cheque electrónico; si es papel, null.

TRANSFERENCIA (tipo: "transferencia"):
- monto, cbu_destino / cvu_destino (22 dígitos si es visible), fecha_transferencia (YYYY-MM-DD), numero_comprobante.

DEPÓSITO (tipo: "deposito", puede tener varios ítems):
- fecha_deposito (YYYY-MM-DD) e items: { tipo_item: "efectivo", monto, fecha_deposito_efectivo, nro_comprobante_deposito_ef } o { tipo_item: "cheque", monto, banco_emisor, numero_cheque, fecha_pago_cheque, numero_comprobante_deposito }.

Los montos SIEMPRE numéricos. Devolvé solo el JSON { "resultados": [ ... ] }.`

/** Resultado en el formato que ya consumen los clientes viejos (nombres de campo del prompt). */
interface OCRResultLegacy {
  tipo: "cheque" | "transferencia" | "deposito"
  archivo_index?: number
  monto?: number
  numero_cheque?: string
  banco_emisor?: string
  fecha_emision?: string
  fecha_cheque?: string
  cuit_emisor?: string
  cuits_titulares?: string[]
  color_cheque?: "ECHEQ"
  cbu_destino?: string
  cvu_destino?: string
  fecha_transferencia?: string
  numero_comprobante?: string
  cuenta_bancaria_id?: string | null
  banco_nombre?: string | null
  fecha_deposito?: string
  items?: any[]
}

const OCR_TIMEOUT_MS = 30_000

async function leerConGemini(base64: string, mimeType: string): Promise<any[]> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no configurado")
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json", responseSchema: OCR_SCHEMA, temperature: 0 },
  })
  const result = await model.generateContent([{ inlineData: { mimeType: mimeType || "image/jpeg", data: base64 } }, PROMPT], { timeout: OCR_TIMEOUT_MS })
  const text = result.response.text()
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error("No se pudo interpretar la respuesta del OCR")
    parsed = JSON.parse(m[0])
  }
  return Array.isArray(parsed?.resultados) ? parsed.resultados : []
}

/**
 * Valida cada resultado crudo del modelo. Cheques y transferencias pasan por
 * lib/cheques (campo que no valida ⇒ no viaja). Los depósitos (solo oficina) se
 * dejan pasar con los montos normalizados.
 */
function sanear(crudos: any[], bancos: any[], archivoIndex: number): { legacy: OCRResultLegacy[]; saneados: ResultadoOcr[] } {
  const legacy: OCRResultLegacy[] = []
  const saneados: ResultadoOcr[] = []
  for (const r of crudos) {
    if (!r || typeof r !== "object") continue
    if (r.tipo === "cheque") {
      const s = sanearCheque(r)
      if (s.descartados) console.warn("[pagos-clientes/ocr] descartado por validación:", JSON.stringify({ leido: { cuit: r.cuit_emisor, fecha_cheque: r.fecha_cheque, fecha_emision: r.fecha_emision, monto: r.monto }, descartados: s.descartados }))
      const res: ResultadoOcr = { tipo: "cheque", ...s }
      if (!resultadoConDatos(res)) continue
      saneados.push(res)
      legacy.push({
        tipo: "cheque",
        archivo_index: archivoIndex,
        monto: s.monto,
        numero_cheque: s.numero_cheque,
        banco_emisor: s.banco,
        fecha_emision: s.fecha_emision,
        fecha_cheque: s.fecha_cheque,
        cuit_emisor: s.cuit_emisor,
        cuits_titulares: s.cuits_titulares,
        color_cheque: s.es_echeq ? "ECHEQ" : undefined,
      })
    } else if (r.tipo === "transferencia") {
      const cbu = String(r.cbu_destino || r.cvu_destino || "").replace(/\D/g, "")
      const match = cbu.length === 22 ? bancos.find((b: any) => (b.cbu && String(b.cbu).trim() === cbu) || (b.cvu && String(b.cvu).trim() === cbu)) : null
      const s = sanearTransferencia({ ...r, cuenta_bancaria_id: match?.id, banco_nombre: match ? `${match.banco} — ${match.nombre}` : undefined })
      const res: ResultadoOcr = { tipo: "transferencia", ...s }
      if (!resultadoConDatos(res)) continue
      saneados.push(res)
      legacy.push({
        tipo: "transferencia",
        archivo_index: archivoIndex,
        monto: s.monto,
        cbu_destino: cbu.length === 22 ? cbu : undefined,
        fecha_transferencia: s.fecha_transferencia,
        numero_comprobante: s.numero_comprobante,
        cuenta_bancaria_id: s.cuenta_bancaria_id ?? null,
        banco_nombre: s.banco_nombre ?? null,
      })
    } else if (r.tipo === "deposito") {
      const items = (Array.isArray(r.items) ? r.items : [])
        .map((it: any) => ({ ...it, monto: normalizarMonto(it?.monto) ?? 0 }))
        .filter((it: any) => it.monto > 0)
      legacy.push({ tipo: "deposito", archivo_index: archivoIndex, fecha_deposito: r.fecha_deposito || undefined, items, cuenta_bancaria_id: null, banco_nombre: null })
    }
  }
  return { legacy, saneados }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const formData = await request.formData()
    const files = formData.getAll("files") as File[]
    if (!files.length) return NextResponse.json({ error: "Se requiere al menos un archivo" }, { status: 400 })
    const soloSubir = ["1", "true"].includes(String(formData.get("solo_subir") || ""))

    const { data: bancos } = soloSubir ? { data: [] as any[] } : await supabase.from("cuentas_bancarias").select("id, nombre, banco, cbu, cvu").eq("activo", true)
    const bancosActivos = bancos || []
    const admin = createAdminClient()

    const archivos: (FotoSubida | null)[] = []
    const resultados: OCRResultLegacy[] = []
    const saneados: (ResultadoOcr & { archivo_index: number })[] = []
    const errores: string[] = []

    const porArchivo = await Promise.all(
      files.map(async (file, i) => {
        const buffer = Buffer.from(await file.arrayBuffer())
        // Subida y lectura EN PARALELO: la foto queda guardada aunque el OCR falle o tarde
        const subida = subirFotoComprobante(admin, buffer, { mime: file.type, nombre: file.name }).catch((e: any) => {
          console.error("[pagos-clientes/ocr] upload:", e?.message)
          return null
        })
        const lectura = soloSubir
          ? Promise.resolve<{ ok: true; crudos: any[] } | { ok: false; error: string }>({ ok: true, crudos: [] })
          : leerConGemini(buffer.toString("base64"), file.type)
              .then((crudos) => ({ ok: true as const, crudos }))
              .catch((e: any) => {
                console.error("[pagos-clientes/ocr] archivo", file.name, e?.message)
                return { ok: false as const, error: String(e?.message || "no se pudo leer") }
              })
        const [foto, r] = await Promise.all([subida, lectura])
        return { i, foto, r }
      }),
    )

    for (const { i, foto, r } of porArchivo) {
      archivos[i] = foto
      if (!r.ok) {
        errores.push(`${files[i].name || "archivo"}: ${r.error}`)
        continue
      }
      const s = sanear(r.crudos, bancosActivos, i)
      if (!soloSubir && !s.legacy.length) errores.push(`${files[i].name || "archivo"}: no se detectaron datos`)
      resultados.push(...s.legacy)
      saneados.push(...s.saneados.map((x) => ({ ...x, archivo_index: i })))
    }

    return NextResponse.json({
      success: true,
      resultados,
      total_encontrados: resultados.length,
      /** URLs de las fotos guardadas (orden = orden de `files`; las que fallaron no figuran) */
      archivos: archivos.filter((a): a is FotoSubida => !!a),
      /** Misma posición que `files`: null si esa foto no se pudo guardar */
      archivos_por_indice: archivos,
      /** Cheques/transferencias ya validados (lib/cheques), para los clientes nuevos */
      saneados,
      errores: errores.length ? errores : undefined,
    })
  } catch (error: any) {
    console.error("[pagos-clientes/ocr] POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
