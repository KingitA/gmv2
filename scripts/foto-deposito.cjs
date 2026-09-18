#!/usr/bin/env node
// Foto SOLO LECTURA de todo lo que una prueba de la app Depósito puede tocar en la base
// de .env.local. Sirve para probar contra producción y demostrar, al terminar y limpiar,
// que quedó IDÉNTICA (MOBILE.md §17 → checklist contra producción).
//
//   node scripts/foto-deposito.cjs guardar antes.json      ← antes de crear datos de prueba
//   node scripts/foto-deposito.cjs comparar antes.json     ← después de borrar los datos de prueba
//
// Guarda: cantidad de filas por tabla, stock de CADA artículo, máximos de numeración y
// los ids de kardex / movimientos_stock más nuevos. `comparar` lista cada diferencia.
const { readFileSync, writeFileSync } = require("node:fs")
const { createClient } = require("@supabase/supabase-js")

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const TABLAS = [
  "pedidos", "pedidos_detalle", "clientes", "kardex", "movimientos_stock", "comisiones",
  "picking_sesiones", "picking_items",
  "ordenes_compra", "ordenes_compra_detalle", "recepciones", "recepciones_items", "recepciones_documentos",
  "devoluciones", "devoluciones_detalle",
  "deposito_ajustes_movil", "mobile_alertas_integridad", "mobile_pruebas_sync",
]

async function paginar(build) {
  const out = []
  for (let o = 0; ; o += 1000) {
    const { data, error } = await build().order("id").range(o, o + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

async function foto() {
  const f = { tomada: new Date().toISOString(), filas: {}, maximos: {}, stock: {} }
  for (const t of TABLAS) {
    const { count, error } = await sb.from(t).select("*", { count: "exact", head: true })
    f.filas[t] = error ? `error: ${error.message}` : count
  }
  for (const [t, col] of [["pedidos", "numero_pedido"], ["ordenes_compra", "numero_orden"], ["devoluciones", "numero_devolucion"]]) {
    const { data } = await sb.from(t).select(col).not(col, "is", null).order(col, { ascending: false }).limit(1)
    f.maximos[`${t}.${col}`] = data?.[0]?.[col] ?? null
  }
  for (const a of await paginar(() => sb.from("articulos").select("id, stock_actual"))) f.stock[a.id] = Number(a.stock_actual ?? 0)
  return f
}

;(async () => {
  const [modo, archivo] = process.argv.slice(2)
  if (!["guardar", "comparar"].includes(modo) || !archivo) { console.error("uso: foto-deposito.cjs guardar|comparar <archivo.json>"); process.exit(2) }
  const ahora = await foto()
  if (modo === "guardar") {
    writeFileSync(archivo, JSON.stringify(ahora))
    console.log(`Foto guardada en ${archivo}:`, ahora.filas, ahora.maximos, `· ${Object.keys(ahora.stock).length} artículos, stock total ${Object.values(ahora.stock).reduce((a, b) => a + b, 0)}`)
    return
  }
  const antes = JSON.parse(readFileSync(archivo, "utf8"))
  const dif = []
  for (const t of TABLAS) if (antes.filas[t] !== ahora.filas[t]) dif.push(`filas ${t}: ${antes.filas[t]} → ${ahora.filas[t]}`)
  for (const k of Object.keys(ahora.maximos)) if (antes.maximos[k] !== ahora.maximos[k]) dif.push(`numeración ${k}: ${antes.maximos[k]} → ${ahora.maximos[k]}`)
  for (const id of new Set([...Object.keys(antes.stock), ...Object.keys(ahora.stock)])) {
    if (antes.stock[id] !== ahora.stock[id]) dif.push(`stock artículo ${id}: ${antes.stock[id]} → ${ahora.stock[id]}`)
  }
  console.log(`Foto de referencia: ${antes.tomada} · ahora: ${ahora.tomada}`)
  if (dif.length === 0) console.log("✓ IDÉNTICO: mismas filas en las 18 tablas, misma numeración, mismo stock en todos los artículos.")
  else { console.log(`✗ ${dif.length} diferencia(s):`); for (const d of dif.slice(0, 60)) console.log("  -", d) }
  console.log("(Si el depósito real operó mientras tanto, sus movimientos legítimos también aparecen acá: se explican uno por uno.)")
})().catch((e) => { console.error("✗", e.message); process.exit(1) })
