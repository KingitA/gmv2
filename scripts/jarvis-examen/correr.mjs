#!/usr/bin/env node
// Examen de Jarvis (docs/playroom-cerebro/PLAN.md §6). SOLO LEE la base.
//
//   node scripts/jarvis-examen/correr.mjs                     ← con el modelo de los ajustes
//   node scripts/jarvis-examen/correr.mjs claude-opus-5-5     ← probando otro modelo
//   node scripts/jarvis-examen/correr.mjs claude-opus-5-5 dolar,zona-top   ← solo algunas
//
// Necesita en .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
// Cada pregunta: Jarvis responde → se calcula el dato correcto con la herramienta
// "verdad" → un juez (otro modelo, siempre el mismo) pone nota de 0 a 10.
// El resultado queda en scripts/jarvis-examen/resultados/<fecha>-<modelo>.json
// Antes de cambiar el modelo "pensador": correr con el actual y con el candidato y comparar.
import { createRequire } from "module"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(AQUI, "../..")
const require = createRequire(import.meta.url)
const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
)
for (const [k, v] of Object.entries(env)) process.env[k] ??= v
if (!process.env.ANTHROPIC_API_KEY) { console.error("Falta ANTHROPIC_API_KEY en .env.local"); process.exit(1) }

const { createClient } = require(path.join(REPO, "node_modules/@supabase/supabase-js"))
const Anthropic = require(path.join(REPO, "node_modules/@anthropic-ai/sdk")).default
const { createJiti } = require(path.join(REPO, "node_modules/jiti"))
const jiti = createJiti(path.join(REPO, "x.ts"), { alias: { "@": REPO } })
const { preguntar } = await jiti.import(path.join(REPO, "lib/jarvis/cerebro.ts"))
const { buscarHerramienta, contextoNuevo } = await jiti.import(path.join(REPO, "lib/jarvis/herramientas.ts"))

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anthropic = new Anthropic()
const JUEZ = process.env.JARVIS_EXAMEN_JUEZ || "claude-opus-5-5"

const modelo = process.argv[2] && process.argv[2] !== "-" ? process.argv[2] : undefined
const solo = process.argv[3]?.split(",")
const { preguntas } = JSON.parse(fs.readFileSync(path.join(AQUI, "preguntas.json"), "utf8"))

const RUBRICA = `Sos el juez de un examen de un asistente de datos de una distribuidora. Te paso: la pregunta, lo que se esperaba, el DATO CORRECTO sacado del sistema (puede faltar) y la respuesta del asistente (texto + títulos de las tablas que mostró).
Evaluá:
1. numeros_ok: ¿los números y nombres coinciden con el dato correcto (tolerancia 1 %, redondeos y abreviaturas tipo "$ 3,2 M" valen)? Si no hay dato correcto, true salvo que invente cifras.
2. reglas_ok: ¿respeta las reglas? Corto y al grano; sin tablas dentro del texto; sin preguntas de relleno al final ("¿querés que…?", "¿algo más?"); no promete hacer cambios en el sistema; si falta un dato, lo dice.
3. cumple_esperado: ¿hace lo que dice "esperado"?
Devolvé SOLO un JSON: {"numeros_ok": bool, "reglas_ok": bool, "cumple_esperado": bool, "nota": 0-10, "comentario": "una línea"}`

const resultados = []
let costoTotal = 0
for (const q of preguntas) {
  if (solo && !solo.includes(q.id)) continue
  process.stdout.write(`• ${q.id}… `)
  const t = Date.now()
  let r, verdad = null, error = null
  try {
    r = await preguntar({ db, usuarioId: null, mensaje: q.pregunta, historial: [], modeloForzado: modelo, origen: "examen" })
    costoTotal += r.costoUsd
  } catch (e) { error = String(e?.message || e) }
  if (q.verdad) {
    try { verdad = (await buscarHerramienta(q.verdad.herramienta).ejecutar(contextoNuevo(db), q.verdad.parametros)).datos }
    catch (e) { verdad = `no se pudo calcular: ${e?.message}` }
  }
  let juicio = { numeros_ok: false, reglas_ok: false, cumple_esperado: false, nota: 0, comentario: error ? `Error: ${error}` : "" }
  if (r) {
    const j = await anthropic.messages.create({
      model: JUEZ, max_tokens: 2000, output_config: { effort: "low" },
      system: RUBRICA,
      messages: [{ role: "user", content: JSON.stringify({
        pregunta: q.pregunta, esperado: q.esperado,
        dato_correcto: verdad ? JSON.stringify(verdad).slice(0, 12000) : null,
        respuesta: r.respuesta, tablas_mostradas: r.bloques.map((b) => b.titulo), sugerencia_final: r.sugerencias[0] ?? null,
      }) }],
    })
    const txt = j.content.filter((b) => b.type === "text").map((b) => b.text).join("")
    try { juicio = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1)) } catch { juicio.comentario = `Juez ilegible: ${txt.slice(0, 200)}` }
  }
  const seg = Math.round((Date.now() - t) / 1000)
  console.log(`${juicio.nota}/10 (${seg} s)${juicio.comentario ? " — " + juicio.comentario : ""}`)
  resultados.push({ id: q.id, pregunta: q.pregunta, nota: juicio.nota, ...juicio, segundos: seg, respuesta: r?.respuesta, consultado: r?.consultado, bloques: r?.bloques.map((b) => b.titulo), costo_usd: r?.costoUsd, modelo: r?.modelo })
}

const promedio = resultados.reduce((s, x) => s + (Number(x.nota) || 0), 0) / Math.max(resultados.length, 1)
const usado = resultados[0]?.modelo ?? modelo ?? "?"
console.log(`\nModelo: ${usado} · Nota promedio: ${promedio.toFixed(1)}/10 · Reglas OK: ${resultados.filter((x) => x.reglas_ok).length}/${resultados.length} · Costo: USD ${costoTotal.toFixed(2)}`) // formato-ok: salida de consola del script
const dir = path.join(AQUI, "resultados")
fs.mkdirSync(dir, { recursive: true })
const archivo = path.join(dir, `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${usado}.json`)
fs.writeFileSync(archivo, JSON.stringify({ modelo: usado, juez: JUEZ, promedio, costo_usd: costoTotal, resultados }, null, 2))
console.log(`Guardado en ${path.relative(REPO, archivo)}`)
