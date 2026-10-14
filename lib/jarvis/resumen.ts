/**
 * La revisión diaria de Jarvis: corre los vigías, saca una "foto" de los
 * números del día y escribe el resumen (2-3 oraciones, como un gerente).
 *
 * - Lo corre el cron todas las mañanas y, a pedido, el botón "Revisar ahora".
 * - El resumen y la foto se guardan en ai_registro (inborrable): queda la
 *   historia de lo que Jarvis dijo cada día y con qué números.
 * - Abrir Playroom NO gasta IA: lee lo guardado.
 */
import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { fecha, hoyISO } from "@/lib/formato"
import { calcularIndicadores } from "@/lib/playroom/indicadores"
import { detectar, sincronizar } from "./vigias"
import { actualizarConIA, actualizarFuentesFijas, estadoIndicadores, iaDesactualizada, indicadoresNecesarios } from "./exterior"
import { clasificarPendientes } from "./clasificador"
import { destrabarEnCurso } from "./agenda"
import { anotar } from "./registro"
import { elegirModelo, registrarUso } from "./uso"
import type { UsoTokens } from "./modelos"

const INDICADORES_FOTO = ["ventas_mes", "ventas_hoy", "cobrado_mes", "deuda_clientes", "cobros_pendientes", "pagos_7dias", "pedidos_preparar", "cheques_cartera"]

const INSTRUCCIONES_RESUMEN = `Sos Jarvis, el analista de una distribuidora mayorista (perfumería, limpieza, bazar) de Bahía Blanca. Escribís el resumen de la mañana que se lee arriba de todo en la pantalla.
Reglas:
- Dos o tres oraciones, como lo contaría un buen gerente. Nada de saludos ni despedidas.
- Lo que importa hoy: cómo vienen las ventas, la cobranza, pagos que se vienen y lo raro si lo hay. Lo de afuera (dólar, petróleo…) solo si se movió fuerte.
- Usá SOLO los números que te paso. Montos abreviados ($ 3,2 M), porcentajes con coma.
- Negritas (**así**) en 2 o 3 datos clave, nada más.
- Si un dato parece mal cargado, no lo destaques.
Devolvé solo el texto del resumen.`

export interface ResultadoRevision {
  avisos: { nuevos: number; actualizados: number; cerrados: number }
  fallaron: string[]
  resumen: string | null
  exterior?: { fijas: number; ia: number; clasificados: number; errores: string[] }
}

/**
 * Antes de los vigías: precios de afuera y artículos nuevos.
 * - dólar e inflación (fuente pública, sin IA): siempre;
 * - artículos sin clasificar (IA barata): hasta 400 por corrida;
 * - materias primas por internet (IA): una vez por semana.
 * Si algo de esto falla, la revisión sigue igual.
 */
async function prepararExterior(db: SupabaseClient, usuarioId: string | null) {
  const res = { fijas: 0, ia: 0, clasificados: 0, errores: [] as string[] }
  try { const f = await actualizarFuentesFijas(db); res.fijas = f.guardados; res.errores.push(...f.errores) } catch (e) { res.errores.push(`fuentes fijas: ${e}`) }
  try { res.clasificados = (await clasificarPendientes(db, 400, usuarioId)).clasificados } catch (e) { res.errores.push(`clasificador: ${e}`) }
  try {
    const faltan = await iaDesactualizada(db, await indicadoresNecesarios(db))
    if (faltan.length) { const r = await actualizarConIA(db, faltan, usuarioId); res.ia = r.guardados; res.errores.push(...r.errores) }
  } catch (e) { res.errores.push(`materias primas: ${e}`) }
  if (res.errores.length) console.error("[jarvis] exterior", res.errores)
  return res
}

export async function revisionDiaria(db: SupabaseClient, usuarioId: string | null): Promise<ResultadoRevision> {
  const hoy = hoyISO()
  try { await destrabarEnCurso(db) } catch (e) { console.error("[jarvis] destrabar", e) }
  const exterior = await prepararExterior(db, usuarioId)
  const [{ candidatos, fallaron }, { bloques }] = await Promise.all([
    detectar(db, hoy),
    calcularIndicadores(db, INDICADORES_FOTO),
  ])
  const avisos = await sincronizar(db, candidatos, fallaron)

  // Foto de los números del día (para comparar contra días anteriores)
  const foto: Record<string, unknown> = {}
  for (const [id, b] of Object.entries(bloques)) {
    if ("error" in b) continue
    if (b.tipo === "numero") foto[id] = { valor: b.valor, comparacion: b.comparacion?.texto ?? null }
  }
  await anotar(db, { usuarioId: null, accion: "foto_diaria", entidadTipo: "jarvis", entidadId: hoy, detalle: { foto, avisos: candidatos.length } })

  // Resumen escrito por la IA (si falla, queda la foto y los avisos igual)
  let resumen: string | null = null
  try {
    const elegido = await elegirModelo(db, "pensador")
    const datos = {
      hoy: fecha(hoy),
      numeros: foto,
      lo_raro: candidatos.sort((a, b) => b.severidad - a.severidad).slice(0, 5).map((c) => c.titulo),
      afuera: (await estadoIndicadores(db)).filter((i) => i.valor != null).map((i) => ({ indicador: i.nombre, valor: i.valor, fecha: i.fecha, variacion_30d_pct: i.variacion_30d })),
    }
    const resp = await new Anthropic().messages.create({
      model: elegido.modelo,
      max_tokens: 2000,
      output_config: { effort: "low" },
      system: INSTRUCCIONES_RESUMEN,
      messages: [{ role: "user", content: JSON.stringify(datos) }],
    })
    await registrarUso(db, { usuarioId, origen: "resumen", modelo: elegido.modelo, uso: resp.usage as UsoTokens })
    resumen = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim() || null
    if (resumen) await anotar(db, { usuarioId: null, accion: "resumen_del_dia", entidadTipo: "jarvis", entidadId: hoy, detalle: { texto: resumen, datos, modelo: elegido.modelo, pedido_por: usuarioId } })
  } catch (e) {
    console.error("[jarvis] resumen del día", e)
  }
  return { avisos, fallaron, resumen, exterior }
}

/** Último resumen guardado (de hoy). */
export async function resumenDeHoy(db: SupabaseClient): Promise<{ texto: string | null; generado_at: string | null }> {
  const { data } = await db.from("ai_registro").select("detalle, created_at").eq("accion", "resumen_del_dia").eq("entidad_id", hoyISO())
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  const d = data as { detalle: { texto?: string }; created_at: string } | null
  return { texto: d?.detalle?.texto ?? null, generado_at: d?.created_at ?? null }
}

/** Cuándo fue la última revisión (para no repetirla seguido). */
export async function ultimaRevision(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from("ai_registro").select("created_at").eq("accion", "foto_diaria").order("created_at", { ascending: false }).limit(1).maybeSingle()
  return (data as { created_at: string } | null)?.created_at ?? null
}
