#!/usr/bin/env node
// Control de FORMATOS (fecha dd/mm/aaaa GMT-3, $1.000,32, CUIT xx-xxxxxxxx-x).
// Ver docs/FORMATOS.md. Lo corre `npm run typecheck:movil` (obligatorio antes de commitear).
//
//   node scripts/check-formatos.mjs                    ← chequeo
//   node scripts/check-formatos.mjs --actualizar-base  ← solo cuando la base BAJÓ
//   node scripts/check-formatos.mjs --listar           ← muestra cada línea que cuenta
//
// Busca patrones que ya causaron errores de formato. Lo que existía al crear el
// control está contado por archivo en scripts/check-formatos.base.json y SOLO
// PUEDE BAJAR: un patrón nuevo (en un archivo nuevo o más usos en uno viejo) falla.
// Si un uso es legítimo (formato fiscal de ARCA, valor de máquina), se marca la
// línea con el comentario `formato-ok: <motivo>` y no cuenta.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const F_BASE = join(RAIZ, "scripts/check-formatos.base.json")
const actualizar = process.argv.includes("--actualizar-base")
const listar = process.argv.includes("--listar")

// Código de la app (ERP + apps). lib/formato es la implementación: no se controla.
const CARPETAS = ["app", "components", "lib", "hooks", "mobile/apps", "mobile/packages/core/src"]
const EXCLUIR = [/node_modules/, /\/\.next\//, /^lib\/formato\//, /\/dist\//, /\/android\//, /\.test\.tsx?$/, /\.d\.ts$/]

const PATRONES = {
  "input type=number (usar InputMonto / MontoInput)": /type\s*=\s*\{?\s*["'`]number["'`]/,
  "input type=date/datetime-local/month (usar DateInputAR / FechaInput)": /type\s*=\s*\{?\s*["'`](date|datetime-local|month)["'`]/,
  "toLocale*String (usar fecha() / moneda() / numero())": /\.toLocale(Date|Time)?String\s*\(/,
  "Intl.NumberFormat / DateTimeFormat (usar lib/formato)": /\bIntl\.(NumberFormat|DateTimeFormat)\s*\(/,
  "toFixed (en pantalla: numero() / moneda(); cálculo: redondear())": /\.toFixed\s*\(/,
  "parseFloat (usar parseMonto)": /\bparseFloat\s*\(/,
  'replace(",", ".") (usar parseMonto)': /\.replace\(\s*["'`],["'`]\s*,\s*["'`]\.["'`]\s*\)/,
  "hoy en UTC con toISOString (usar hoyISO() / fechaISO())": /toISOString\(\)\s*\.\s*(split\(\s*["'`]T["'`]\s*\)|slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\))/,
  "split('-').reverse() para mostrar fecha (usar fecha())": /split\(\s*["'`]-["'`]\s*\)\s*\.\s*reverse\(\)/,
}

// Migraciones nuevas (posteriores a la unificación): nada de CURRENT_DATE ni timestamp sin zona
const MIGRACIONES = "supabase/migrations"
const DESDE_MIGRACION = "20261011"
const PATRONES_SQL = {
  "CURRENT_DATE en SQL (usar public.hoy_ar())": /\bcurrent_date\b/i,
  "timestamp sin zona en SQL (usar timestamptz)": /\btimestamp\b(?!\s*with\s+time\s+zone)(?!tz)\s*(\(\d\))?\s*(not\s+null|null|default|,|\)|;|$)/i,
}

const norm = (p) => p.replace(/\\/g, "/")

function* recorrer(dir) {
  let items
  try { items = readdirSync(dir) } catch { return }
  for (const it of items) {
    const p = join(dir, it)
    const rel = norm(relative(RAIZ, p))
    if (EXCLUIR.some((r) => r.test(rel))) continue
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) yield* recorrer(p)
    else if (/\.(ts|tsx)$/.test(it)) yield rel
  }
}

const conteo = {} // archivo → patrón → n
const lineas = [] // para --listar
function contar(archivo, texto, patrones) {
  texto.split(/\r?\n/).forEach((linea, i) => {
    if (/formato-ok/.test(linea)) return
    const sinComentario = linea.replace(/^\s*(\/\/|\*|--).*$/, "")
    if (!sinComentario.trim()) return
    for (const [nombre, re] of Object.entries(patrones)) {
      if (re.test(sinComentario)) {
        ;(conteo[archivo] ??= {})[nombre] = (conteo[archivo][nombre] || 0) + 1
        lineas.push(`${archivo}:${i + 1}  [${nombre}]  ${linea.trim().slice(0, 140)}`)
      }
    }
  })
}

for (const c of CARPETAS) for (const f of recorrer(join(RAIZ, c))) contar(f, readFileSync(join(RAIZ, f), "utf8"), PATRONES)
if (existsSync(join(RAIZ, MIGRACIONES))) {
  for (const it of readdirSync(join(RAIZ, MIGRACIONES))) {
    if (!it.endsWith(".sql") || it.slice(0, 8) < DESDE_MIGRACION) continue
    const f = `${MIGRACIONES}/${it}`
    contar(f, readFileSync(join(RAIZ, f), "utf8"), PATRONES_SQL)
  }
}

if (listar) for (const l of lineas) console.log(l)

const total = (o) => Object.values(o).reduce((a, x) => a + Object.values(x).reduce((b, y) => b + y, 0), 0)
const hayBase = existsSync(F_BASE)
const base = hayBase ? JSON.parse(readFileSync(F_BASE, "utf8")).archivos : {}

if (actualizar || !hayBase) {
  if (hayBase) {
    // Solo se puede bajar: no se actualiza si algo subió
    const subio = Object.entries(conteo).some(([f, ps]) => Object.entries(ps).some(([p, n]) => n > (base[f]?.[p] || 0)))
    if (subio) {
      console.error("✗ check-formatos: hay usos NUEVOS; no se actualiza la base. Corregilos (ver docs/FORMATOS.md).")
      process.exit(1)
    }
  }
  const orden = Object.fromEntries(Object.entries(conteo).sort())
  writeFileSync(F_BASE, JSON.stringify({ nota: "Usos preexistentes de patrones de formato prohibidos (docs/FORMATOS.md). Solo puede bajar.", total: total(conteo), archivos: orden }, null, 2) + "\n")
  console.log(`✓ check-formatos: base ${hayBase ? "actualizada" : "creada"} (${hayBase ? total(base) + " → " : ""}${total(conteo)} usos preexistentes).`)
  process.exit(0)
}

const nuevos = []
for (const [f, ps] of Object.entries(conteo)) {
  for (const [p, n] of Object.entries(ps)) {
    const b = base[f]?.[p] || 0
    if (n > b) nuevos.push({ f, p, b, n })
  }
}
if (nuevos.length) {
  console.error("\n✗ check-formatos: patrones de formato prohibidos NUEVOS (ver docs/FORMATOS.md):")
  for (const x of nuevos) {
    console.error(`   ${x.f}: ${x.p}  (${x.b} → ${x.n})`)
    for (const l of lineas.filter((l) => l.startsWith(x.f + ":") && l.includes(`[${x.p}]`))) console.error("      " + l.slice(x.f.length + 1))
  }
  console.error("   Si un uso es legítimo (formato fiscal, valor de máquina), agregá en esa línea: // formato-ok: <motivo>")
  process.exit(1)
}
const tb = total(base), ta = total(conteo)
console.log(`✓ check-formatos OK — ${ta}/${tb} usos preexistentes`)
if (ta < tb) console.log("  La base de formatos bajó: corré `node scripts/check-formatos.mjs --actualizar-base` y commiteá el JSON.")
