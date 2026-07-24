import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { hybridSearchIds } from "@/lib/search/hybrid"
import { ARTICULO_SELECT, mapArticuloVendedor } from "@/lib/vendedor/articulos-select"

export const maxDuration = 60

// POST /api/vendedor/buscar-foto — búsqueda de artículos por cámara/foto.
// FormData:
//   - ean: string  → el cliente ya leyó un código de barras (BarcodeDetector);
//                    lookup exacto por ean13, con fallback al motor híbrido.
//   - image: File  → foto del producto; Claude (visión) extrae EAN legible,
//                    marca, medida y términos de búsqueda, y se sugieren
//                    artículos del catálogo vía búsqueda híbrida.
// Respuesta: { descripcion_detectada, ean_detectado, articulos: [...] }

const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])

let anthropic: Anthropic | null = null
function getAnthropic(): Anthropic {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY no está configurada.")
    anthropic = new Anthropic({ apiKey })
  }
  return anthropic
}

async function buscarPorEan(supabase: any, ean: string) {
  const limpio = ean.replace(/\D/g, "")
  if (!limpio) return []
  const { data } = await supabase
    .from("articulos")
    .select(ARTICULO_SELECT)
    .eq("ean13", limpio)
    .eq("activo", true)
    .limit(5)
  return (data || []).map((a: any) => mapArticuloVendedor(a))
}

async function buscarHibrido(supabase: any, q: string, limit = 10) {
  const ids = await hybridSearchIds("articulos", q, limit)
  if (!ids.length) return []
  const { data } = await supabase
    .from("articulos")
    .select(ARTICULO_SELECT)
    .in("id", ids)
    .eq("activo", true)
  const porId = new Map((data || []).map((a: any) => [a.id, a]))
  return ids
    .map((id) => porId.get(id))
    .filter(Boolean)
    .map((a: any) => mapArticuloVendedor(a))
}

export async function POST(request: Request) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const form = await request.formData()

    // ── Camino 1: código de barras ya leído por el cliente ──
    const ean = (form.get("ean") as string | null)?.trim()
    if (ean) {
      let articulos = await buscarPorEan(supabase, ean)
      if (!articulos.length) articulos = await buscarHibrido(supabase, ean)
      return NextResponse.json({
        descripcion_detectada: `Código de barras ${ean}`,
        ean_detectado: ean,
        articulos,
      })
    }

    // ── Camino 2: foto del producto → Claude visión ──
    const image = form.get("image") as File | null
    if (!image) {
      return NextResponse.json({ error: "Mandá una foto o un código de barras." }, { status: 400 })
    }
    const mediaType = MEDIA_TYPES.has(image.type) ? image.type : "image/jpeg"
    const base64 = Buffer.from(await image.arrayBuffer()).toString("base64")

    const response = await getAnthropic().messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              ean13: {
                type: ["string", "null"],
                description: "Código de barras EAN-13/EAN-8 si es legible en la foto, solo dígitos",
              },
              marca: { type: ["string", "null"] },
              producto: { type: "string", description: "Qué producto es, en pocas palabras" },
              medida: { type: ["string", "null"], description: "Tamaño/medida visible, ej: x475, 45x60, 900ml" },
              color: { type: ["string", "null"] },
              terminos_busqueda: {
                type: "array",
                items: { type: "string" },
                description: "2 a 3 consultas de búsqueda para encontrarlo en el catálogo, de más específica a más general",
              },
            },
            required: ["ean13", "marca", "producto", "medida", "color", "terminos_busqueda"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as any, data: base64 } },
            {
              type: "text",
              text: `Sos el buscador visual del catálogo de una distribuidora mayorista argentina de limpieza, perfumería y bazar. Un vendedor sacó esta foto de un producto para encontrarlo en el catálogo.

Identificá el producto: marca (leé etiquetas y logos, ej: MR TRAPO, ALGABO, ELVIVE, QUERUBIN), tipo de producto, medida/tamaño visible (ej: x475, 45x60, 900cc) y color si es distintivo. Si hay un código de barras legible, transcribilo.

Los términos de búsqueda deben parecerse a descripciones de catálogo mayorista, cortos y en mayúsculas conceptuales, combinando tipo + marca + medida/color. Ejemplos: "trapo gris mr 45x60", "gel algabo amarillo x475", "shampoo elvive collagen 200ml".`,
            },
          ],
        },
      ],
    })

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "No se pudo analizar la foto. Probá con otra toma." }, { status: 422 })
    }
    const texto = response.content.find((b: any) => b.type === "text") as any
    const deteccion = JSON.parse(texto?.text || "{}")

    const partes = [deteccion.producto, deteccion.marca, deteccion.medida, deteccion.color].filter(Boolean)
    const descripcion = partes.join(" · ") || "Producto no identificado"

    // EAN legible en la foto → lookup exacto primero
    if (deteccion.ean13) {
      const porEan = await buscarPorEan(supabase, String(deteccion.ean13))
      if (porEan.length) {
        return NextResponse.json({
          descripcion_detectada: descripcion,
          ean_detectado: String(deteccion.ean13),
          articulos: porEan,
        })
      }
    }

    // Búsqueda híbrida con los términos sugeridos, hasta juntar resultados
    const vistos = new Set<string>()
    const articulos: any[] = []
    for (const term of (deteccion.terminos_busqueda || []).slice(0, 3)) {
      if (articulos.length >= 8) break
      const res = await buscarHibrido(supabase, term, 8)
      for (const a of res) {
        if (!vistos.has(a.id)) {
          vistos.add(a.id)
          articulos.push(a)
        }
      }
    }

    return NextResponse.json({
      descripcion_detectada: descripcion,
      ean_detectado: deteccion.ean13 || null,
      articulos: articulos.slice(0, 10),
    })
  } catch (error: any) {
    console.error("[vendedor] Error en POST /api/vendedor/buscar-foto:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
