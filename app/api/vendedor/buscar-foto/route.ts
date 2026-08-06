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
    .eq("activo", true).gt("precio_base", 0)
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
    .eq("activo", true).gt("precio_base", 0)
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
              sinonimos: {
                type: "array",
                items: { type: "string" },
                description: "3 a 5 nombres alternativos MUY cortos con los que un catálogo podría listar este producto (ej. para una emulsión corporal: 'crema', 'crema corporal', 'anti age'; para un trapo de piso: 'trapo', 'trapo gris')",
              },
            },
            required: ["ean13", "marca", "producto", "medida", "color", "terminos_busqueda", "sinonimos"],
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

    // ── Etapa 1: recuperar ANCHO ──
    // Muchas consultas degradadas (términos armados + producto + sinónimos +
    // marca) + artículos de la marca detectada. Los candidatos pueden ser
    // malos: la decisión fina la toma el re-rank de la etapa 2. Esto cubre
    // catálogos con descripciones pobres ("Anti-age Manos x 90 ml 24b" sin
    // la marca) que ninguna búsqueda léxica/vectorial matchearía sola.
    const consultas: string[] = [
      ...(deteccion.terminos_busqueda || []),
      deteccion.producto,
      ...(deteccion.sinonimos || []),
      [deteccion.producto, deteccion.medida].filter(Boolean).join(" "),
      deteccion.marca,
    ]
      .filter((q: any) => typeof q === "string" && q.trim().length >= 3)
      .map((q: string) => q.trim())
      .filter((q, i, arr) => arr.indexOf(q) === i)
      .slice(0, 9)

    const vistos = new Set<string>()
    const candidatos: any[] = []
    const sumar = (arts: any[]) => {
      for (const a of arts) {
        if (!vistos.has(a.id)) {
          vistos.add(a.id)
          candidatos.push(a)
        }
      }
    }

    for (const term of consultas) {
      if (candidatos.length >= 40) break
      sumar(await buscarHibrido(supabase, term, 8))
    }

    // Candidatos directos por marca (campo, no palabra): si el catálogo tiene
    // la marca cargada, sus artículos entran aunque la descripción no la nombre
    if (deteccion.marca) {
      const { data: marcaRow } = await supabase
        .from("marcas")
        .select("id")
        .ilike("descripcion", `%${String(deteccion.marca).trim()}%`)
        .limit(1)
        .maybeSingle()
      if (marcaRow?.id) {
        const { data: deMarca } = await supabase
          .from("articulos")
          .select(ARTICULO_SELECT)
          .eq("marca_id", marcaRow.id)
          .eq("activo", true).gt("precio_base", 0)
          .limit(25)
        sumar((deMarca || []).map((a: any) => mapArticuloVendedor(a)))
      }
    }

    // ── Etapa 2: re-rank — Claude elige entre los candidatos ──
    // La búsqueda de texto no sabe que "Anti-age Manos x 90 ml" es la crema
    // Hinds de la foto; el modelo, viendo la detección y la lista, sí.
    let articulos = candidatos.slice(0, 10)
    if (candidatos.length) {
      try {
        const listado = candidatos
          .slice(0, 60)
          .map((a, i) => `${i}| ${a.descripcion}${a.marca ? ` | marca: ${a.marca}` : ""}${a.sku ? ` | sku ${a.sku}` : ""}`)
          .join("\n")

        const rerank = await getAnthropic().messages.create({
          model: "claude-opus-4-8",
          max_tokens: 512,
          output_config: {
            format: {
              type: "json_schema",
              schema: {
                type: "object",
                properties: {
                  indices: {
                    type: "array",
                    items: { type: "integer" },
                    description: "Índices de los candidatos que pueden ser el producto de la foto, del más al menos probable, máximo 6. Vacío si ninguno corresponde.",
                  },
                },
                required: ["indices"],
                additionalProperties: false,
              },
            },
          },
          messages: [
            {
              role: "user",
              content: `Un vendedor mayorista sacó una foto de un producto y el sistema detectó: "${descripcion}".

Estos son los candidatos del catálogo (las descripciones son abreviadas y muchas veces omiten la marca o usan jerga interna — "Anti-age Manos x 90 ml" puede ser una crema Hinds Anti-Age aunque no diga Hinds):

${listado}

Devolvé los índices de los candidatos que realmente pueden ser ese producto (mismo tipo de producto y, si figura, medida compatible), del más al menos probable. Sé permisivo con abreviaturas y marcas omitidas, estricto con el tipo de producto: un shampoo no es una crema.`,
            },
          ],
        })
        if (rerank.stop_reason !== "refusal") {
          const rtxt = rerank.content.find((b: any) => b.type === "text") as any
          const indices: number[] = JSON.parse(rtxt?.text || "{}").indices || []
          const elegidos = indices
            .filter((i) => i >= 0 && i < candidatos.length)
            .map((i) => candidatos[i])
          if (elegidos.length) articulos = elegidos
          else articulos = [] // el modelo revisó y ninguno corresponde
        }
      } catch (e) {
        console.error("[buscar-foto] re-rank falló, devuelvo candidatos crudos:", e)
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
