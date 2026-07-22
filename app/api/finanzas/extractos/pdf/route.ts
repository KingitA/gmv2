import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai"

export const maxDuration = 120

/**
 * POST /api/finanzas/extractos/pdf — extrae los movimientos de un extracto
 * bancario en PDF (Credicoop, Nación, Provincia, etc.) con Gemini, el mismo
 * OCR que ya usa el sistema para comprobantes de pago.
 *
 * FormData: file (application/pdf, también acepta imagen)
 * → { movimientos: [{ fecha, descripcion, monto, referencia_externa? }],
 *     saldo_inicial?, saldo_final?, periodo_desde?, periodo_hasta? }
 *
 * El cliente muestra el preview y después importa por POST /api/finanzas/extractos
 * (mismo circuito que Excel/CSV — idempotente).
 */

const SCHEMA: any = {
  type: SchemaType.OBJECT,
  properties: {
    movimientos: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          fecha: { type: SchemaType.STRING, description: "YYYY-MM-DD" },
          descripcion: { type: SchemaType.STRING },
          monto: { type: SchemaType.NUMBER, description: "negativo si es débito" },
          referencia: { type: SchemaType.STRING, description: "nro comprobante/operación" },
        },
        required: ["fecha", "monto"],
      },
    },
    saldo_inicial: { type: SchemaType.NUMBER },
    saldo_final: { type: SchemaType.NUMBER },
    periodo_desde: { type: SchemaType.STRING },
    periodo_hasta: { type: SchemaType.STRING },
  },
  required: ["movimientos"],
}

const PROMPT = `Sos un experto en extractos bancarios argentinos (Credicoop, Nación, Provincia, MercadoPago).

Extraé TODOS los movimientos de este extracto de cuenta, de TODAS las páginas.

Para cada movimiento:
- fecha: en formato YYYY-MM-DD. Los años de 2 dígitos son 20XX (ej: 01/06/26 → 2026-06-01).
- descripcion: el concepto COMPLETO. Si la descripción ocupa varias líneas (ej: "Transf. Inmediata e/Ctas." + la línea siguiente con CUIT/beneficiario), unilas en una sola. Incluí CUIT, beneficiario y CBU origen si figuran.
- monto: numérico. NEGATIVO si es débito (columna DEBITO/DEBITOS, o importe con signo -), POSITIVO si es crédito (columna CREDITO/CREDITOS). Sin símbolos ni separador de miles, punto como decimal (ej: -3241.30).
- referencia: el número de comprobante/operación si figura (columna COMPROB./COMBTE/REFERENCE_ID). Si no hay, null.

IGNORAR (no son movimientos):
- "SALDO ANTERIOR", saldos parciales de la columna SALDO, subtotales, transportes de página ("CONTINUA EN PAGINA SIGUIENTE"), totales del período, encabezados repetidos.

Además devolvé si son visibles:
- saldo_inicial (el "SALDO ANTERIOR" del inicio), saldo_final (el saldo del cierre del período)
- periodo_desde y periodo_hasta (YYYY-MM-DD)

Verificación: la suma de créditos menos débitos debería aproximar saldo_final − saldo_inicial. Si no cierra, revisá si te faltó alguna página o confundiste la columna SALDO con un importe.`

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: "GEMINI_API_KEY no configurado" }, { status: 500 })
    }
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "Se requiere el archivo" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const base64 = buffer.toString("base64")
    const mime = file.type || "application/pdf"

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA },
    })

    const result = await model.generateContent([{ inlineData: { mimeType: mime, data: base64 } }, PROMPT])
    const text = result.response.text()
    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {
      const m = text.match(/\{[\s\S]*\}/)
      if (!m) throw new Error("No se pudo interpretar la respuesta del OCR")
      parsed = JSON.parse(m[0])
    }

    const movimientos = (parsed.movimientos || [])
      .filter((m: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(m.fecha ?? "")) && Number(m.monto))
      .map((m: any) => ({
        fecha: m.fecha,
        descripcion: String(m.descripcion ?? "").trim(),
        monto: Number(m.monto),
        referencia_externa: m.referencia ? String(m.referencia).trim() : undefined,
      }))

    if (!movimientos.length) {
      return NextResponse.json({ error: "El OCR no detectó movimientos en el PDF" }, { status: 422 })
    }

    return NextResponse.json({
      success: true,
      movimientos,
      saldo_inicial: parsed.saldo_inicial ?? null,
      saldo_final: parsed.saldo_final ?? null,
      periodo_desde: parsed.periodo_desde ?? null,
      periodo_hasta: parsed.periodo_hasta ?? null,
    })
  } catch (error: any) {
    console.error("[finanzas/extractos/pdf] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
