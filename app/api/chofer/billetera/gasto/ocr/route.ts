import { NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { GEMINI_MODEL } from "@/lib/ai/gemini-model"

// POST /api/chofer/billetera/gasto/ocr — foto de un ticket (nafta, hotel,
// peaje, comida…): Gemini detecta el tipo de gasto y el importe. La foto
// queda en el bucket y su URL vuelve para adjuntarla al gasto.
// Body: multipart con "file". Respuesta: { categoria, monto, fecha, detalle, foto_url }

const BUCKET = "comprobantes-pago"
const CATEGORIAS = ["nafta", "peon", "hotel", "peaje", "comida", "cubierta", "otro"] as const

const schema = {
  type: SchemaType.OBJECT,
  properties: {
    categoria: { type: SchemaType.STRING, enum: [...CATEGORIAS], format: "enum" },
    monto: { type: SchemaType.NUMBER },
    fecha: { type: SchemaType.STRING },
    comercio: { type: SchemaType.STRING },
    detalle: { type: SchemaType.STRING },
    confianza: { type: SchemaType.NUMBER },
  },
  required: ["categoria", "monto"],
} as any

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    if (!process.env.GEMINI_API_KEY) return NextResponse.json({ error: "GEMINI_API_KEY no configurado" }, { status: 500 })
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "Falta la foto del ticket" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const base64 = buffer.toString("base64")

    // La foto queda guardada aunque el OCR no entienda el ticket
    let foto_url: string | null = null
    try {
      const admin = createAdminClient()
      const ext = (file.name?.split(".").pop() || "jpg").toLowerCase()
      const path = `gastos/${auth.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: file.type || "image/jpeg", upsert: false })
      if (!upErr) foto_url = admin.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || null
      else console.error("[gasto/ocr] upload:", upErr.message)
    } catch (e: any) {
      console.error("[gasto/ocr] upload exc:", e?.message)
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
    })
    const prompt = `Es la foto de un ticket o factura de un gasto de viaje de un chofer de reparto en Argentina.
Devolvé:
- categoria: una de nafta (combustible, GNC, gasoil, estación de servicio), hotel (alojamiento), peaje, comida (restaurante, kiosco, panadería), cubierta (gomería, neumáticos, auxilio), peon (mano de obra, changarín), otro.
- monto: el TOTAL pagado, número. Los importes argentinos usan punto de miles y coma decimal ("12.500,00" = 12500). Si hay varios totales, el final/pagado.
- fecha: AAAA-MM-DD si se lee, si no null.
- comercio: nombre del comercio si se lee.
- detalle: una línea corta (ej: "Nafta súper 32 L", "Peaje Azul").
- confianza: 0 a 1, qué tan seguro estás del monto y la categoría.
Si la imagen no es un ticket, devolvé monto 0 y confianza 0.`
    const result = await model.generateContent([{ inlineData: { mimeType: file.type || "image/jpeg", data: base64 } }, prompt])
    let parsed: any = {}
    try {
      parsed = JSON.parse(result.response.text())
    } catch {
      const m = result.response.text().match(/\{[\s\S]*\}/)
      if (m) parsed = JSON.parse(m[0])
    }
    const monto = Math.round((Number(parsed.monto) || 0) * 100) / 100
    const categoria = CATEGORIAS.includes(parsed.categoria) ? parsed.categoria : "otro"

    return NextResponse.json({
      success: monto > 0,
      categoria,
      monto,
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(parsed.fecha || "") ? parsed.fecha : null,
      comercio: parsed.comercio || null,
      detalle: [parsed.comercio, parsed.detalle].filter(Boolean).join(" · ") || null,
      confianza: Number(parsed.confianza) || 0,
      foto_url,
    })
  } catch (error: any) {
    console.error("[chofer] gasto/ocr:", error)
    return NextResponse.json({ error: error.message || "No se pudo leer el ticket" }, { status: 500 })
  }
}
