import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"

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

async function processPaymentOCR(file: File): Promise<{ resultados: OCRResultMetodo[]; raw_text?: string }> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no configurado")

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" })

  const bytes = await file.arrayBuffer()
  const base64 = Buffer.from(bytes).toString("base64")

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
- cuit_emisor: CUIT del titular del cheque si es visible. Puede aparecer como "CUIT: XX-XXXXXXXX-X", "CT: XX-XXXXXXXX-X", "CT XX-XXXXXXXX-X", o simplemente el número en formato XX-XXXXXXXX-X (11 dígitos con guiones). Extraé el número en formato XX-XXXXXXXX-X.
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
    { inlineData: { mimeType: file.type, data: base64 } },
    prompt,
  ])

  const text = result.response.text()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("No se pudo extraer JSON de la respuesta OCR")

  const parsed = JSON.parse(jsonMatch[0])
  const resultados: OCRResultMetodo[] = parsed.resultados || []

  // Fallback regex: si un cheque no tiene cuit_emisor, buscar patrón XX-XXXXXXXX-X en el texto crudo
  const cuitRegex = /\b(\d{2}-\d{8}-\d{1})\b/g
  const cuits = [...text.matchAll(cuitRegex)].map(m => m[1])
  for (const r of resultados) {
    if (r.tipo === "cheque" && !r.cuit_emisor && cuits.length > 0) {
      r.cuit_emisor = cuits[0]
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

    // Procesar cada archivo con Gemini
    const todosResultados: OCRResultMetodo[] = []

    for (const file of files) {
      const { resultados } = await processPaymentOCR(file)
      todosResultados.push(...resultados)
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
    })
  } catch (error: any) {
    console.error("[pagos-clientes/ocr] POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
