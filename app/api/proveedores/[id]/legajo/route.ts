import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'

export const maxDuration = 120

/**
 * POST /api/proveedores/[id]/legajo — lee un legajo impositivo / constancia
 * (PDF o imagen) con Gemini OCR y devuelve la PROPUESTA de actualización de
 * la ficha fiscal del proveedor. NO escribe nada: la aplicación la confirma
 * el usuario desde el diálogo (PUT /fiscal).
 */

const SCHEMA: any = {
  type: SchemaType.OBJECT,
  properties: {
    cuit: { type: SchemaType.STRING, description: 'XX-XXXXXXXX-X' },
    razon_social: { type: SchemaType.STRING },
    condicion_iva: { type: SchemaType.STRING },
    inscripto_ganancias: { type: SchemaType.BOOLEAN, description: 'true si figura inscripto en GANANCIAS SOCIEDADES o IMPUESTO A LAS GANANCIAS' },
    certificados_exclusion: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          impuesto: { type: SchemaType.STRING, description: 'ganancias | iva | otro' },
          porcentaje: { type: SchemaType.NUMBER, description: '100 si es exclusión total' },
          fecha_desde: { type: SchemaType.STRING, description: 'YYYY-MM-DD' },
          fecha_hasta: { type: SchemaType.STRING, description: 'YYYY-MM-DD' },
          numero_certificado: { type: SchemaType.STRING },
        },
        required: ['impuesto'],
      },
    },
    tipo_documento: { type: SchemaType.STRING, description: 'constancia_inscripcion | certificado_exclusion | legajo | otro' },
    observaciones: { type: SchemaType.STRING },
  },
  required: ['tipo_documento'],
}

const PROMPT = `Sos un experto en documentación fiscal argentina (ARCA/AFIP).

Analizá este documento de un PROVEEDOR (puede ser: constancia de inscripción de CUIT,
certificado de exclusión de retenciones RG 830, legajo impositivo, constancia de IIBB).

Extraé:
- cuit (formato XX-XXXXXXXX-X), razon_social, condicion_iva
- inscripto_ganancias: true si el documento muestra inscripción vigente en el
  Impuesto a las Ganancias (GANANCIAS SOCIEDADES / GANANCIAS PERSONAS HUMANAS).
- certificados_exclusion: SOLO si el documento es o incluye un certificado de
  exclusión de retenciones (RG 830 art. 38 / RG 5306): impuesto, porcentaje
  (100 si es total), vigencia desde/hasta (YYYY-MM-DD), número de certificado.
  Una constancia de inscripción común NO es un certificado de exclusión.
- tipo_documento y observaciones relevantes (ej. "monotributista", "IVA exento").

Fechas siempre YYYY-MM-DD. Si un dato no está, null.`

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { id } = await params
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY no configurado' }, { status: 500 })
    }
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Se requiere el archivo' }, { status: 400 })

    const supabase = createAdminClient()
    const { data: prov } = await supabase
      .from('proveedores')
      .select('id, nombre, cuit, regimen_ganancias, condicion_ganancias')
      .eq('id', id)
      .single()
    if (!prov) return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA },
    })
    const result = await model.generateContent([
      { inlineData: { mimeType: file.type || 'application/pdf', data: buffer.toString('base64') } },
      PROMPT,
    ])
    let parsed: any
    try {
      parsed = JSON.parse(result.response.text())
    } catch {
      const m = result.response.text().match(/\{[\s\S]*\}/)
      if (!m) throw new Error('No se pudo interpretar la respuesta del OCR')
      parsed = JSON.parse(m[0])
    }

    // Chequeo de identidad: el CUIT del documento debe coincidir con la ficha
    const limpiar = (c?: string | null) => String(c ?? '').replace(/\D/g, '')
    const cuitCoincide = !parsed.cuit || !prov.cuit || limpiar(parsed.cuit) === limpiar(prov.cuit)

    // Propuesta de cambios contra la ficha actual
    const propuesta: any = {
      tipo_documento: parsed.tipo_documento,
      observaciones: parsed.observaciones ?? null,
      cuit_documento: parsed.cuit ?? null,
      razon_social_documento: parsed.razon_social ?? null,
      cuit_coincide: cuitCoincide,
      cambios: [] as Array<{ campo: string; actual: string; nuevo: string }>,
      exclusiones_detectadas: (parsed.certificados_exclusion ?? [])
        .filter((c: any) => (c.impuesto || '').toLowerCase().includes('ganancia'))
        .map((c: any) => ({
          tipo: 'retencion_ganancias',
          porcentaje: Number(c.porcentaje ?? 100),
          fecha_desde: c.fecha_desde ?? null,
          fecha_hasta: c.fecha_hasta ?? null,
          numero_certificado: c.numero_certificado ?? null,
        })),
    }

    if (parsed.inscripto_ganancias === true && prov.condicion_ganancias !== 'inscripto') {
      propuesta.cambios.push({ campo: 'condicion_ganancias', actual: prov.condicion_ganancias, nuevo: 'inscripto' })
    }
    if (parsed.inscripto_ganancias === false && prov.condicion_ganancias !== 'no_inscripto') {
      propuesta.cambios.push({ campo: 'condicion_ganancias', actual: prov.condicion_ganancias, nuevo: 'no_inscripto' })
    }

    return NextResponse.json({ success: true, propuesta })
  } catch (error: any) {
    console.error('[proveedores/legajo] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
