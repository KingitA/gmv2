/**
 * El mundo exterior de Jarvis: precios de afuera que mueven los costos.
 *
 * - Con fuente pública fija (gratis, sin IA): dólar oficial y blue, inflación
 *   mensual (api.argentinadatos.com).
 * - Sin fuente fija (petróleo, resinas, celulosa, aluminio, acero, algodón):
 *   Jarvis los busca en internet y guarda valor, fecha, fuente y link. Si una
 *   página deja de andar, la búsqueda encuentra otra: no hay URLs "cableadas".
 * - Solo se buscan los indicadores que hacen falta según cómo quedaron
 *   clasificados los artículos (ai_insumos.indicadores).
 */
import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { hoyISO, sumarDiasISO } from "@/lib/formato"
import { elegirModelo, registrarUso } from "./uso"
import type { UsoTokens } from "./modelos"

export interface DefIndicador { clave: string; nombre: string; unidad: string; fuente: "api" | "ia"; buscar?: string }

export const INDICADORES: DefIndicador[] = [
  { clave: "dolar_oficial", nombre: "Dólar oficial (venta)", unidad: "ARS por USD", fuente: "api" },
  { clave: "dolar_blue", nombre: "Dólar blue (venta)", unidad: "ARS por USD", fuente: "api" },
  { clave: "inflacion_mensual", nombre: "Inflación mensual (INDEC)", unidad: "% mensual", fuente: "api" },
  { clave: "petroleo_brent", nombre: "Petróleo Brent", unidad: "USD por barril", fuente: "ia", buscar: "precio del petróleo Brent en USD por barril" },
  { clave: "resina_polietileno", nombre: "Resina polietileno (PE)", unidad: "USD por tonelada", fuente: "ia", buscar: "precio internacional del polietileno (HDPE o LLDPE) en USD por tonelada, idealmente referencia Latinoamérica o Golfo de EE.UU." },
  { clave: "celulosa", nombre: "Celulosa (pulpa)", unidad: "USD por tonelada", fuente: "ia", buscar: "precio de la celulosa / pulpa de fibra corta (BHKP) o larga (NBSK) en USD por tonelada" },
  { clave: "aluminio", nombre: "Aluminio (LME)", unidad: "USD por tonelada", fuente: "ia", buscar: "precio del aluminio en la LME en USD por tonelada" },
  { clave: "acero", nombre: "Acero (bobina laminada en caliente)", unidad: "USD por tonelada", fuente: "ia", buscar: "precio internacional del acero laminado en caliente (HRC) en USD por tonelada" },
  { clave: "algodon", nombre: "Algodón", unidad: "USD centavos por libra", fuente: "ia", buscar: "precio del algodón (ICE futures) en centavos de USD por libra" },
]
export const DEF = new Map(INDICADORES.map((i) => [i.clave, i]))

type Fila = { indicador: string; fecha: string; valor: number; unidad?: string; fuente?: string; fuente_url?: string | null; obtenido_por: "api" | "ia" }

async function guardar(db: SupabaseClient, filas: Fila[]) {
  if (!filas.length) return 0
  const { error } = await db.from("ai_indicadores_externos").upsert(filas, { onConflict: "indicador,fecha" })
  if (error) throw new Error(`No se pudieron guardar los indicadores: ${error.message}`)
  return filas.length
}

async function json(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } })
  if (!r.ok) throw new Error(`${url} respondió ${r.status}`)
  return r.json()
}

/** Dólar (últimos 90 días) e inflación (últimos 12 meses) de fuentes públicas. Sin IA. */
export async function actualizarFuentesFijas(db: SupabaseClient) {
  const desde = sumarDiasISO(hoyISO(), -90)
  const filas: Fila[] = []
  const errores: string[] = []
  for (const [casa, clave] of [["oficial", "dolar_oficial"], ["blue", "dolar_blue"]] as const) {
    try {
      const datos = (await json(`https://api.argentinadatos.com/v1/cotizaciones/dolares/${casa}`)) as { fecha: string; venta: number }[]
      for (const d of datos) if (d.fecha >= desde && Number(d.venta) > 0)
        filas.push({ indicador: clave, fecha: d.fecha, valor: Number(d.venta), unidad: "ARS por USD", fuente: "ArgentinaDatos", fuente_url: "https://argentinadatos.com", obtenido_por: "api" })
    } catch (e) { errores.push(`${clave}: ${e instanceof Error ? e.message : e}`) }
  }
  try {
    const datos = (await json("https://api.argentinadatos.com/v1/finanzas/indices/inflacion")) as { fecha: string; valor: number }[]
    for (const d of datos.slice(-12))
      filas.push({ indicador: "inflacion_mensual", fecha: d.fecha, valor: Number(d.valor), unidad: "% mensual", fuente: "INDEC vía ArgentinaDatos", fuente_url: "https://argentinadatos.com", obtenido_por: "api" })
  } catch (e) { errores.push(`inflacion: ${e instanceof Error ? e.message : e}`) }
  return { guardados: await guardar(db, filas), errores }
}

/** Qué indicadores "de IA" hacen falta según los insumos que usan los artículos clasificados. */
export async function indicadoresNecesarios(db: SupabaseClient): Promise<string[]> {
  const { data: usados } = await db.from("ai_articulo_insumos").select("insumo").limit(5000)
  const insumos = [...new Set(((usados ?? []) as { insumo: string }[]).map((u) => u.insumo))]
  if (!insumos.length) return []
  const { data } = await db.from("ai_insumos").select("indicadores").in("insumo", insumos)
  const claves = new Set(((data ?? []) as { indicadores: string[] }[]).flatMap((i) => i.indicadores))
  return [...claves].filter((c) => DEF.get(c)?.fuente === "ia")
}

const INSTRUCCIONES_BUSQUEDA = `Buscás UN precio internacional de una materia prima para una distribuidora argentina.
Buscá en internet:
- el valor más reciente (y su fecha);
- el valor de hace aproximadamente 30 días (y su fecha), para medir la variación. Si solo encontrás la variación porcentual del mes, calculá el valor de hace 30 días y aclaralo en "fuente".
Usá fuentes confiables (bolsas, agencias de noticias, organismos, sitios de cotizaciones). Si el indicador exacto no aparece, podés usar la referencia más cercana (ej. otro tipo de polietileno) y decilo en "fuente". No inventes: si no encontrás nada, devolvé null.
Al final devolvé SOLO un JSON (sin texto alrededor):
{"valor_actual":123.4,"fecha_actual":"AAAA-MM-DD","valor_hace_30_dias":120.1,"fecha_hace_30_dias":"AAAA-MM-DD","fuente":"nombre","url":"https://…"}
Números con punto decimal, sin separador de miles.`

/**
 * Busca en internet los indicadores pedidos y los guarda.
 * Uno por uno y en paralelo (cada uno con sus propias búsquedas): así uno
 * difícil no se come las búsquedas de los demás (pasó el 14/10: de 6 solo
 * volvió el petróleo).
 */
export async function actualizarConIA(db: SupabaseClient, claves: string[], usuarioId: string | null) {
  const defs = claves.map((c) => DEF.get(c)).filter((d): d is DefIndicador => !!d && d.fuente === "ia")
  if (!defs.length) return { guardados: 0, errores: [] as string[] }
  const elegido = await elegirModelo(db, "pensador")
  const client = new Anthropic()
  const errores: string[] = []
  const filas: Fila[] = []
  const fechaOk = (f: unknown) => typeof f === "string" && /^d{4}-d{2}-d{2}$/.test(f) && f <= hoyISO()

  await Promise.all(defs.map(async (d) => {
    try {
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: `Hoy es ${hoyISO()}. Indicador: ${d.buscar} (unidad: ${d.unidad}).` }]
      let texto = ""
      for (let vuelta = 0; vuelta < 3; vuelta++) {
        const resp = await client.messages.create({
          model: elegido.modelo, max_tokens: 4000, output_config: { effort: "low" },
          system: INSTRUCCIONES_BUSQUEDA,
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
          messages,
        })
        await registrarUso(db, { usuarioId, origen: "exterior", modelo: elegido.modelo, uso: resp.usage as UsoTokens })
        messages.push({ role: "assistant", content: resp.content })
        texto = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("")
        if (resp.stop_reason !== "pause_turn") break
      }
      const it = JSON.parse(texto.slice(texto.indexOf("{"), texto.lastIndexOf("}") + 1))
      const base = { indicador: d.clave, unidad: d.unidad, fuente: String(it.fuente ?? "búsqueda web").slice(0, 160), fuente_url: typeof it.url === "string" ? it.url.slice(0, 500) : null, obtenido_por: "ia" as const }
      if (Number(it.valor_actual) > 0 && fechaOk(it.fecha_actual)) filas.push({ ...base, fecha: it.fecha_actual, valor: Number(it.valor_actual) })
      else { errores.push(`${d.nombre}: no se encontró`); return }
      if (Number(it.valor_hace_30_dias) > 0 && fechaOk(it.fecha_hace_30_dias) && it.fecha_hace_30_dias !== it.fecha_actual)
        filas.push({ ...base, fecha: it.fecha_hace_30_dias, valor: Number(it.valor_hace_30_dias) })
    } catch (e) {
      console.error(`[jarvis] exterior ${d.clave}`, e)
      errores.push(`${d.nombre}: no se encontró`)
    }
  }))
  return { guardados: await guardar(db, filas), errores }
}

export interface EstadoIndicador {
  clave: string; nombre: string; unidad: string; valor: number | null; fecha: string | null
  variacion_30d: number | null; fuente: string | null; fuente_url: string | null; obtenido_por: string | null
}

/** Último valor de cada indicador y su variación contra ~30 días antes. */
export async function estadoIndicadores(db: SupabaseClient): Promise<EstadoIndicador[]> {
  const { data } = await db.from("ai_indicadores_externos").select("indicador, fecha, valor, fuente, fuente_url, obtenido_por")
    .gte("fecha", sumarDiasISO(hoyISO(), -400)).order("fecha", { ascending: false }).limit(5000)
  const filas = (data ?? []) as { indicador: string; fecha: string; valor: number; fuente: string | null; fuente_url: string | null; obtenido_por: string }[]
  return INDICADORES.map((d) => {
    const xs = filas.filter((f) => f.indicador === d.clave)
    const ult = xs[0]
    if (!ult) return { clave: d.clave, nombre: d.nombre, unidad: d.unidad, valor: null, fecha: null, variacion_30d: null, fuente: null, fuente_url: null, obtenido_por: null }
    // contra el valor más cercano a 30 días antes (entre 20 y 45 días antes); la inflación no se compara (ya es una variación)
    const objetivo = sumarDiasISO(ult.fecha, -30)
    const previo = d.clave === "inflacion_mensual" ? undefined : xs
      .filter((x) => x.fecha <= sumarDiasISO(ult.fecha, -20) && x.fecha >= sumarDiasISO(ult.fecha, -45))
      .sort((a, b) => Math.abs(Date.parse(a.fecha) - Date.parse(objetivo)) - Math.abs(Date.parse(b.fecha) - Date.parse(objetivo)))[0]
    const v = previo && Number(previo.valor) > 0 ? Math.round(((Number(ult.valor) / Number(previo.valor)) - 1) * 1000) / 10 : null
    return { clave: d.clave, nombre: d.nombre, unidad: d.unidad, valor: Number(ult.valor), fecha: ult.fecha, variacion_30d: v, fuente: ult.fuente, fuente_url: ult.fuente_url, obtenido_por: ult.obtenido_por }
  })
}

/** ¿Hace falta buscar con IA? (una vez por semana alcanza para materias primas) */
export async function iaDesactualizada(db: SupabaseClient, claves: string[], dias = 6): Promise<string[]> {
  if (!claves.length) return []
  const { data } = await db.from("ai_indicadores_externos").select("indicador, obtenido_at").in("indicador", claves).gte("obtenido_at", new Date(Date.now() - dias * 86_400_000).toISOString())
  const frescos = new Set(((data ?? []) as { indicador: string }[]).map((d) => d.indicador))
  return claves.filter((c) => !frescos.has(c))
}
