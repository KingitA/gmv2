import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai"

const BUCKET_COMPROBANTES = "comprobantes-pago"

// Schema de salida: fuerza a Gemini a devolver JSON válido (cero errores de parseo).
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
          localidad: { type: SchemaType.STRING },
          color_cheque: { type: SchemaType.STRING },
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

interface OCRResultMetodo {
  tipo: "cheque" | "transferencia" | "deposito"
  monto?: number
  // cheque
  numero_cheque?: string
  banco_emisor?: string
  fecha_emision?: string
  fecha_cheque?: string  // fecha de pago/vencimiento
  cuit_emisor?: string
  localidad?: string
  color_cheque?: "BLANCO" | "NEGRO" | "ECHEQ"
  // transferencia
  cbu_destino?: string
  cvu_destino?: string
  fecha_transferencia?: string
  numero_comprobante?: string
  cuenta_bancaria_id?: string | null  // resultado del match CBU/CVU
  banco_nombre?: string | null
  // deposito
  fecha_deposito?: string
  items?: Array<{
    tipo_item: "efectivo" | "cheque"
    monto: number
    banco_emisor?: string
    numero_cheque?: string
    fecha_pago_cheque?: string
    numero_comprobante_deposito?: string
    fecha_deposito_efectivo?: string
    nro_comprobante_deposito_ef?: string
  }>
}

async function processPaymentOCR(base64: string, mimeType: string): Promise<{ resultados: OCRResultMetodo[]; raw_text?: string }> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no configurado")

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  // gemini-2.0-flash fue dado de baja (404); usamos el modelo vigente (igual que lib/services/ocr.ts)
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })

  const prompt = `Sos un experto en documentos bancarios y de pagos argentinos.

Analizá esta imagen y extraé TODOS los comprobantes de pago que aparecen.
Puede haber uno o varios comprobantes en la misma imagen: cheques, transferencias, depósitos.

Para cada comprobante que encuentres, devolvé un objeto con sus datos:

CHEQUE:
- tipo: "cheque"
- numero_cheque: número del cheque (ej: "12345678")
- banco_emisor: nombre del banco que emite el cheque
- fecha_emision: fecha de emisión (formato YYYY-MM-DD)
- fecha_cheque: fecha de pago/vencimiento (formato YYYY-MM-DD)
- monto: importe numérico sin simbolos de moneda
- cuit_emisor: CUIT del titular del cheque. BUSCALO CON PRIORIDAD ALTA — es un número de 11 dígitos que puede aparecer en cualquiera de estos formatos: "CUIT: 20-12345678-9", "C.U.I.T.: 20-12345678-9", "CT: 20-12345678-9", "CT 20-12345678-9", o sin guiones como "20123456789". También puede estar en la línea inferior del cheque junto al número de cuenta. Normalmente empieza con 20, 23, 24, 27 (persona física) o 30, 33, 34 (empresa). Devolvé SIEMPRE en formato XX-XXXXXXXX-X con guiones (ej: "20-12345678-9"). Si aparece sin guiones (11 dígitos seguidos), convertilo al formato con guiones.
- localidad: ciudad/localidad del cheque si es visible
- color_cheque: "ECHEQ" si es electrónico, sino "BLANCO" (nunca "NEGRO" por OCR)

TRANSFERENCIA:
- tipo: "transferencia"
- monto: importe numérico
- cbu_destino: CBU de 22 dígitos si es visible
- cvu_destino: CVU de 22 dígitos si es visible
- fecha_transferencia: fecha de la transferencia (formato YYYY-MM-DD)
- numero_comprobante: número de operación o comprobante

DEPÓSITO (puede tener múltiples ítems dentro):
- tipo: "deposito"
- fecha_deposito: fecha del depósito (formato YYYY-MM-DD)
- items: array con cada ítem del depósito:
  Para ítem EFECTIVO:
    { tipo_item: "efectivo", monto: NUMBER, fecha_deposito_efectivo: "YYYY-MM-DD", nro_comprobante_deposito_ef: "STRING" }
  Para ítem CHEQUE:
    { tipo_item: "cheque", monto: NUMBER, banco_emisor: "STRING", numero_cheque: "STRING", fecha_pago_cheque: "YYYY-MM-DD", numero_comprobante_deposito: "STRING" }

IMPORTANTE:
- Si no podés determinar un campo, usá null
- Los montos SIEMPRE son numéricos (sin $, sin puntos de miles, con punto decimal si aplica)
- Si hay múltiples comprobantes en la imagen, devolvé todos en el array "resultados"

Devolvé SOLO este JSON:
{
  "resultados": [ ... ]
}`

  const result = await model.generateContent([
    { inlineData: { mimeType: mimeType || "image/jpeg", data: base64 } },
    prompt,
  ])

  const text = result.response.text()
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    // Fallback defensivo por si el modelo envolviera el JSON en texto
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error("No se pudo interpretar la respuesta del OCR")
    parsed = JSON.parse(m[0])
  }
  const resultados: OCRResultMetodo[] = parsed.resultados || []

  // Fallback regex: busca CUIT con guiones O sin guiones (11 dígitos que empiezan con 20/23/24/27/30/33/34)
  const cuitConGuiones = /\b(\d{2}-\d{8}-\d)\b/g
  const cuitSinGuiones = /\b((?:20|23|24|27|30|33|34)\d{9})\b/g

  const cuitsConG = [...text.matchAll(cuitConGuiones)].map(m => m[1])
  const cuitsSinG = [...text.matchAll(cuitSinGuiones)].map(m => {
    const n = m[1]
    return `${n.slice(0, 2)}-${n.slice(2, 10)}-${n.slice(10)}`
  })
  const todosLosCuits = [...cuitsConG, ...cuitsSinG]

  for (const r of resultados) {
    if (r.tipo === "cheque" && !r.cuit_emisor && todosLosCuits.length > 0) {
      r.cuit_emisor = todosLosCuits[0]
    }
  }

  return { resultados, raw_text: text }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const formData = await request.formData()

    const files = formData.getAll("files") as File[]
    if (!files.length) {
      return NextResponse.json({ error: "Se requiere al menos un archivo" }, { status: 400 })
    }

    // Cargar bancos propios para hacer match por CBU/CVU
    const { data: bancos } = await supabase
      .from("cuentas_bancarias")
      .select("id, nombre, banco, cbu, cvu")
      .eq("activo", true)

    const bancosActivos = bancos || []

    // Procesar cada archivo con Gemini (resiliente) + guardar la foto en el bucket
    const admin = createAdminClient()
    const todosResultados: OCRResultMetodo[] = []
    const archivos: { url: string; nombre: string }[] = []
    const errores: string[] = []

    for (const file of files) {
      // Leer el archivo UNA sola vez (el File se consume en la primera lectura)
      const buffer = Buffer.from(await file.arrayBuffer())
      const base64 = buffer.toString("base64")

      // Subir la foto al bucket (aunque el OCR falle, la foto queda guardada)
      try {
        const ext = (file.name?.split(".").pop() || "jpg").toLowerCase()
        const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const { error: upErr } = await admin.storage
          .from(BUCKET_COMPROBANTES)
          .upload(path, buffer, { contentType: file.type || "image/jpeg", upsert: false })
        if (!upErr) {
          const { data: pub } = admin.storage.from(BUCKET_COMPROBANTES).getPublicUrl(path)
          if (pub?.publicUrl) archivos.push({ url: pub.publicUrl, nombre: file.name || path })
        } else {
          console.error("[pagos-clientes/ocr] upload:", upErr.message)
        }
      } catch (e: any) {
        console.error("[pagos-clientes/ocr] upload exc:", e?.message)
      }

      // OCR (usa el base64 ya leído, no vuelve a leer el File)
      try {
        const { resultados } = await processPaymentOCR(base64, file.type)
        if (!resultados.length) errores.push(`${file.name || "archivo"}: no se detectaron datos`)
        todosResultados.push(...resultados)
      } catch (e: any) {
        console.error("[pagos-clientes/ocr] archivo", file.name, e?.message)
        errores.push(`${file.name || "archivo"}: ${e?.message || "no se pudo leer"}`)
      }
    }

    // Match CBU/CVU con bancos propios
    const resultadosEnriquecidos = todosResultados.map((r) => {
      if (r.tipo === "transferencia" || r.tipo === "deposito") {
        const cbu = r.tipo === "transferencia" ? (r.cbu_destino || r.cvu_destino) : null
        if (cbu) {
          const match = bancosActivos.find(
            (b: any) =>
              (b.cbu && b.cbu.trim() === cbu.trim()) ||
              (b.cvu && b.cvu.trim() === cbu.trim())
          )
          if (match) {
            return {
              ...r,
              cuenta_bancaria_id: match.id,
              banco_nombre: `${match.banco} — ${match.nombre}`,
            }
          }
        }
        return { ...r, cuenta_bancaria_id: null, banco_nombre: null }
      }
      return r
    })

    return NextResponse.json({
      success: true,
      resultados: resultadosEnriquecidos,
      total_encontrados: resultadosEnriquecidos.length,
      archivos, // URLs de las fotos guardadas en el bucket
      errores: errores.length ? errores : undefined,
    })
  } catch (error: any) {
    console.error("[pagos-clientes/ocr] POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
