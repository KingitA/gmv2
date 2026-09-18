#!/usr/bin/env node
// Chequeo de tipos OBLIGATORIO para las sesiones de las apps móviles (MOBILE.md §14).
//
//   npm run typecheck:movil                    ← antes de cada commit/merge
//   npm run typecheck:movil -- --actualizar-base   ← solo cuando la base BAJÓ
//
// next.config.mjs tiene ignoreBuildErrors: true (hay errores de tipo viejos), así que
// `next build` NO detecta referencias rotas: así llegó a producción el ReferenceError
// del 18/09 (limpiarCentinela). Este script cierra ese hueco:
//
//  1. ALCANCE EN CERO: cualquier error en los archivos de la fundación móvil o en los
//     que agregue cada sesión (scripts/typecheck-movil.alcance.json) ⇒ falla.
//  2. BASE QUE SOLO BAJA: los errores viejos del resto del repo están contados por
//     archivo en scripts/typecheck-movil.base.json. Un archivo con MÁS errores que su
//     base, o un archivo nuevo con errores ⇒ falla.
//  3. tsc QUE ABORTA = FALLA: si tsc se queda sin memoria o no emite su resumen, el
//     chequeo falla (nunca más un "verde" por un tsc que no terminó).
//  4. Typecheck strict de mobile/ (core + 3 apps) en cero.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const F_BASE = join(RAIZ, "scripts/typecheck-movil.base.json")
const F_ALCANCE = join(RAIZ, "scripts/typecheck-movil.alcance.json")
const WIN = process.platform === "win32"
const actualizarBase = process.argv.includes("--actualizar-base")

function correr(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    // node se llama directo; npm (.cmd en Windows) necesita shell
    shell: WIN && cmd !== process.execPath,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --max-old-space-size=8192`.trim() },
  })
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` }
}

const normalizar = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "")

// ─── 1. tsc del ERP ─────────────────────────────────────────────────────────
console.log("› tsc del repo (ERP)…")
// El compilador del repo, invocado directo con node (npx en un shell de Windows
// puede resolver otro "tsc" y el chequeo no correría)
const TSC = join(RAIZ, "node_modules/typescript/bin/tsc")
if (!existsSync(TSC)) {
  console.error("✗ Falta node_modules/typescript: corré npm install en la raíz.")
  process.exit(1)
}
const tsc = correr(process.execPath, ["--max-old-space-size=8192", TSC, "--noEmit", "-p", "."], RAIZ)
// tsc sale con 0 (sin errores) o 1/2 (hay errores; 1 cuando reusa el caché
// incremental). Cualquier otra cosa (null = señal, 134 = sin memoria, etc.) es aborto.
const abortado = /heap out of memory|FATAL ERROR|Allocation failed/i.test(tsc.out) || ![0, 1, 2].includes(tsc.code)
if (abortado) {
  console.error(tsc.out.slice(-2000))
  console.error(`\n✗ tsc ABORTÓ (exit ${tsc.code}): el chequeo no se completó. No es un verde.`)
  process.exit(1)
}

const errores = []
for (const linea of tsc.out.split(/\r?\n/)) {
  const m = /^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(linea)
  if (m) errores.push({ archivo: normalizar(m[1]), codigo: m[2], linea })
}
if (tsc.code !== 0 && errores.length === 0) {
  console.error(tsc.out.slice(-2000))
  console.error("\n✗ tsc terminó con errores pero no se pudieron leer. Revisar la salida.")
  process.exit(1)
}

// ─── 2. Alcance en cero ─────────────────────────────────────────────────────
const alcance = JSON.parse(readFileSync(F_ALCANCE, "utf8"))
const enAlcance = (f) => alcance.rutas.some((r) => (r.endsWith("/") ? f.startsWith(r) : f === r))
const errAlcance = errores.filter((e) => enAlcance(e.archivo))

// ─── 3. Base del resto ──────────────────────────────────────────────────────
const porArchivo = {}
for (const e of errores) if (!enAlcance(e.archivo)) porArchivo[e.archivo] = (porArchivo[e.archivo] || 0) + 1
const hayBase = existsSync(F_BASE)
const base = hayBase ? JSON.parse(readFileSync(F_BASE, "utf8")).archivos : {}
if (!hayBase && !actualizarBase) {
  console.error("✗ Falta scripts/typecheck-movil.base.json. Crearla una vez con: npm run typecheck:movil -- --actualizar-base")
  process.exit(1)
}
// Sin base previa (arranque): se permite crearla con el estado actual del resto del repo
const empeoraron = !hayBase ? [] : Object.entries(porArchivo)
  .filter(([f, n]) => n > (base[f] || 0))
  .map(([f, n]) => `${f}: ${base[f] || 0} → ${n}`)
const totalBase = Object.values(base).reduce((a, b) => a + b, 0)
const totalAhora = Object.values(porArchivo).reduce((a, b) => a + b, 0)

// ─── 4. mobile/ ─────────────────────────────────────────────────────────────
console.log("› typecheck de mobile/ (core + apps)…")
const movil = correr("npm", ["run", "typecheck", "--silent"], join(RAIZ, "mobile"))
const errMovil = movil.out.split(/\r?\n/).filter((l) => /error TS\d+/.test(l))

// ─── Resultado ──────────────────────────────────────────────────────────────
let falla = false
if (errAlcance.length) {
  falla = true
  console.error(`\n✗ ${errAlcance.length} error(es) en archivos del ALCANCE MÓVIL (deben ser 0):`)
  for (const e of errAlcance) console.error("   " + e.linea)
}
if (empeoraron.length) {
  falla = true
  console.error(`\n✗ Errores NUEVOS fuera del alcance (la base solo puede bajar):`)
  for (const l of empeoraron) console.error("   " + l)
  for (const e of errores.filter((x) => empeoraron.some((l) => l.startsWith(x.archivo + ":")))) console.error("     " + e.linea)
}
if (movil.code !== 0 || errMovil.length) {
  falla = true
  console.error(`\n✗ typecheck de mobile/ falló (exit ${movil.code}):`)
  console.error(errMovil.length ? errMovil.map((l) => "   " + l).join("\n") : movil.out.slice(-2000))
}

if (actualizarBase) {
  if (falla) {
    console.error("\n✗ No se actualiza la base con errores nuevos o en el alcance.")
    process.exit(1)
  }
  writeFileSync(F_BASE, JSON.stringify({ nota: "Errores de tipo preexistentes fuera del alcance móvil. Solo puede bajar. Ver MOBILE.md §14.", total: totalAhora, archivos: Object.fromEntries(Object.entries(porArchivo).sort()) }, null, 2) + "\n")
  console.log(`\n✓ Base actualizada: ${totalBase} → ${totalAhora} errores preexistentes.`)
  process.exit(0)
}

if (falla) process.exit(1)
console.log(`\n✓ typecheck:movil OK — alcance móvil: 0 errores · mobile/: 0 · base del resto: ${totalAhora}/${totalBase}`)
if (totalAhora < totalBase) console.log("  La base bajó: corré `npm run typecheck:movil -- --actualizar-base` y commiteá el JSON.")
