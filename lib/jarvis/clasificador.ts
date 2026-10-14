/**
 * Clasificador de artículos (PLAN.md §10.1): de qué depende el costo de cada
 * artículo (plástico, papel, químicos…). Lo hace la IA barata (modelo rápido)
 * leyendo descripción, rubro, categoría, marca y proveedor.
 *
 * - Solo clasifica lo que no tiene clasificación (los nuevos entran solos).
 * - Lo que corrigió una persona (fuente 'persona') NUNCA se pisa.
 * - Si no está segura, deja confianza baja: eso va a la lista de "dudas"
 *   que revisa una persona.
 */
import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { elegirModelo, registrarUso } from "./uso"
import type { UsoTokens } from "./modelos"

const TANDA = 80
export const UMBRAL_DUDA = 0.7

interface Insumo { insumo: string; nombre: string; descripcion: string | null }

async function catalogo(db: SupabaseClient): Promise<Insumo[]> {
  const { data, error } = await db.from("ai_insumos").select("insumo, nombre, descripcion").eq("activo", true)
  if (error) throw new Error(error.message)
  return (data ?? []) as Insumo[]
}

/** Artículos activos sin clasificar (los primeros `limite`). */
async function pendientes(db: SupabaseClient, limite: number) {
  const [hechos, arts] = await Promise.all([
    fetchAllRows<{ articulo_id: string }>(() => db.from("ai_articulo_insumos").select("articulo_id"), "articulo_id"),
    fetchAllRows<Record<string, any>>(() => db.from("articulos").select("id, descripcion, rubro, categoria, subcategoria, marca_nombre, proveedor_nombre").neq("activo", false), "id"),
  ])
  const ya = new Set(hechos.map((h) => h.articulo_id))
  const faltan = arts.filter((a) => !ya.has(a.id))
  return { faltan: faltan.slice(0, limite), totalFaltan: faltan.length }
}

/** Clasifica hasta `limite` artículos sin clasificar. */
export async function clasificarPendientes(db: SupabaseClient, limite: number, usuarioId: string | null) {
  const { faltan, totalFaltan } = await pendientes(db, limite)
  if (!faltan.length) return { clasificados: 0, quedan: 0, costoUsd: 0 }
  const insumos = await catalogo(db)
  const claves = insumos.map((i) => i.insumo)
  const elegido = await elegirModelo(db, "rapido")
  const client = new Anthropic()
  const sistema = `Clasificás artículos de una distribuidora mayorista argentina (perfumería, limpieza, bazar) según la materia prima que más pesa en su COSTO.
Opciones (usá exactamente la clave):
${insumos.map((i) => `- ${i.insumo}: ${i.nombre}. ${i.descripcion ?? ""}`).join("\n")}
Reglas:
- Mirá descripción, rubro, categoría, marca y proveedor. Ej.: "FUENTON 60 LT PLASTIC HOUSE" → plastico; "ROLLO COCINA" → papel; "LAVANDINA" → quimicos; "VIRULANA" → metal.
- Shampoo, desodorantes, perfumes, cremas, detergentes: quimicos (aunque el envase sea plástico, pesa más el contenido).
- confianza de 0 a 1: menos de 0.7 si dudás de verdad (descripción ambigua, sin pistas).
- motivo: 3 a 8 palabras.`
  let clasificados = 0
  let costo = 0
  for (let i = 0; i < faltan.length; i += TANDA) {
    const tanda = faltan.slice(i, i + TANDA)
    const lista = tanda.map((a, n) => `${n}|${a.descripcion ?? ""}|${a.rubro ?? ""}|${a.categoria ?? ""}|${a.subcategoria ?? ""}|${a.marca_nombre ?? ""}|${a.proveedor_nombre ?? ""}`).join("\n")
    const resp = await client.messages.create({
      model: elegido.modelo, max_tokens: 12000, output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object", additionalProperties: false, required: ["items"],
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object", additionalProperties: false, required: ["n", "insumo", "confianza", "motivo"],
                  properties: { n: { type: "integer" }, insumo: { type: "string", enum: claves }, confianza: { type: "number" }, motivo: { type: "string" } },
                },
              },
            },
          },
        },
      },
      system: sistema,
      messages: [{ role: "user", content: `Clasificá (n|descripción|rubro|categoría|subcategoría|marca|proveedor):\n${lista}` }],
    })
    costo += await registrarUso(db, { usuarioId, origen: "clasificador", modelo: elegido.modelo, uso: resp.usage as UsoTokens })
    const texto = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("")
    let items: { n: number; insumo: string; confianza: number; motivo: string }[] = []
    try { items = JSON.parse(texto).items ?? [] } catch { console.error("[jarvis] clasificador: respuesta ilegible"); continue }
    const filas = items
      .filter((it) => tanda[it.n] && claves.includes(it.insumo))
      .map((it) => ({
        articulo_id: tanda[it.n].id, insumo: it.insumo, confianza: Math.max(0, Math.min(1, Number(it.confianza) || 0)),
        fuente: "ia", motivo: String(it.motivo ?? "").slice(0, 200), modelo: elegido.modelo, actualizado_at: new Date().toISOString(),
      }))
    if (filas.length) {
      // ignoreDuplicates: si mientras tanto una persona lo clasificó, se respeta lo suyo
      const { error } = await db.from("ai_articulo_insumos").upsert(filas, { onConflict: "articulo_id", ignoreDuplicates: true })
      if (error) throw new Error(error.message)
      clasificados += filas.length
    }
  }
  return { clasificados, quedan: Math.max(0, totalFaltan - clasificados), costoUsd: costo }
}

export interface Cobertura { activos: number; clasificados: number; por_persona: number; dudas: number; sin_clasificar: number; por_insumo: Record<string, number> }

export async function cobertura(db: SupabaseClient): Promise<Cobertura> {
  const [{ count: activos }, filas] = await Promise.all([
    db.from("articulos").select("id", { count: "exact", head: true }).neq("activo", false),
    fetchAllRows<{ articulo_id: string; insumo: string; fuente: string; confianza: number }>(() => db.from("ai_articulo_insumos").select("articulo_id, insumo, fuente, confianza"), "articulo_id"),
  ])
  const por_insumo: Record<string, number> = {}
  for (const f of filas) por_insumo[f.insumo] = (por_insumo[f.insumo] ?? 0) + 1
  return {
    activos: activos ?? 0,
    clasificados: filas.length,
    por_persona: filas.filter((f) => f.fuente === "persona").length,
    dudas: filas.filter((f) => f.fuente === "ia" && Number(f.confianza) < UMBRAL_DUDA).length,
    sin_clasificar: Math.max(0, (activos ?? 0) - filas.length),
    por_insumo,
  }
}

/** Las clasificaciones dudosas, para que las revise una persona. */
export async function dudas(db: SupabaseClient, limite = 30) {
  const { data, error } = await db.from("ai_articulo_insumos")
    .select("articulo_id, insumo, confianza, motivo, articulos(descripcion, proveedor_nombre, categoria)")
    .eq("fuente", "ia").lt("confianza", UMBRAL_DUDA).order("confianza", { ascending: true }).limit(limite)
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((d) => ({
    articulo_id: d.articulo_id, articulo: d.articulos?.descripcion ?? "—", proveedor: d.articulos?.proveedor_nombre ?? null,
    categoria: d.articulos?.categoria ?? null, propuesta: d.insumo, confianza: Number(d.confianza), motivo: d.motivo,
  }))
}

/** Una persona confirma o corrige (queda en la bitácora por trigger). */
export async function revisarArticulo(db: SupabaseClient, articuloId: string, insumo: string, usuarioId: string) {
  const { error } = await db.from("ai_articulo_insumos").upsert({
    articulo_id: articuloId, insumo, confianza: 1, fuente: "persona", revisado_por: usuarioId,
    revisado_at: new Date().toISOString(), actualizado_at: new Date().toISOString(),
  }, { onConflict: "articulo_id" })
  if (error) throw new Error(error.message)
}
