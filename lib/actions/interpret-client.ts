"use server"

import Anthropic from "@anthropic-ai/sdk"
import { searchClientesByVector } from "@/lib/actions/embeddings"
import { createClient } from "@/lib/supabase/server"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

/**
 * Given raw text extracted from an order file (filename + cell values),
 * uses vector search + Claude to interpret which client the order belongs to.
 * Returns the best matching client or null.
 */
export async function interpretClientFromText(rawText: string): Promise<{
  id: string
  nombre_razon_social: string
  codigo_cliente?: string
  direccion?: string
  localidad?: string
  metodo_facturacion?: string | null
  lista_precio_id?: string | null
} | null> {
  if (!rawText.trim()) return null

  const supabase = await createClient()

  // Step 1: Broad vector search to get candidate pool
  let candidates: any[] = []
  try {
    candidates = await searchClientesByVector(rawText, 0.2, 25)
  } catch { /* ignore */ }

  // Step 2: Also text search with individual tokens
  const tokens = rawText
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !/^\d+$/.test(t))

  const textSet = new Set(candidates.map((c: any) => c.id))
  for (const token of tokens.slice(0, 6)) {
    const { data } = await supabase
      .from("clientes")
      .select("id, nombre_razon_social, codigo_cliente, direccion, localidad, metodo_facturacion, lista_precio_id")
      .eq("activo", true)
      .or(
        `nombre_razon_social.ilike.%${token}%,` +
        `codigo_cliente.ilike.%${token}%,` +
        `localidad.ilike.%${token}%,` +
        `direccion.ilike.%${token}%`
      )
      .limit(8)
    for (const c of data || []) {
      if (!textSet.has(c.id)) { candidates.push(c); textSet.add(c.id) }
    }
  }

  if (candidates.length === 0) return null

  // Deduplicate and limit
  const seen = new Set<string>()
  const pool = candidates.filter((c: any) => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    return true
  }).slice(0, 20)

  // Step 3: Ask Claude to interpret
  const clienteList = pool.map((c: any, i: number) =>
    `${i + 1}. ID=${c.id} | ${c.nombre_razon_social || ""} | código: ${c.codigo_cliente || "—"} | ${c.direccion || ""}, ${c.localidad || ""}`
  ).join("\n")

  const prompt = `Tenés que identificar a qué cliente corresponde un pedido, basándote en texto extraído del archivo.

TEXTO DEL ARCHIVO (nombre de archivo + contenido):
${rawText}

CLIENTES DISPONIBLES:
${clienteList}

Interpretá el texto con sentido común. Por ejemplo:
- "chino sarmiento" → busca un cliente de origen chino en calle sarmiento
- "ultraseas viedma" → cliente que se llama algo como "ultraseas" y queda en viedma
- "001344" → puede ser el código de cliente
- Un apellido puede coincidir parcialmente con la razón social

Respondé SOLO con el número de la lista (1, 2, 3...) del cliente más probable. Si ninguno corresponde, respondé 0.`

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      messages: [{ role: "user", content: prompt }],
    })

    const text = (response.content[0] as any).text?.trim() || "0"
    const idx = parseInt(text) - 1
    if (idx >= 0 && idx < pool.length) {
      const c = pool[idx]
      // Fetch full client data if vector result didn't include all fields
      if (!c.nombre_razon_social) return null
      return {
        id: c.id,
        nombre_razon_social: c.nombre_razon_social,
        codigo_cliente: c.codigo_cliente,
        direccion: c.direccion,
        localidad: c.localidad,
        metodo_facturacion: c.metodo_facturacion ?? null,
        lista_precio_id: c.lista_precio_id ?? null,
      }
    }
  } catch { /* ignore */ }

  return null
}
