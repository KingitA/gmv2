#!/usr/bin/env node
// Foto SOLO LECTURA de todo lo que una prueba de la app Vendedor puede tocar en la base de
// .env.local. Sirve para probar contra producción y demostrar, al terminar y limpiar, que
// quedó IDÉNTICA (MOBILE.md §18 → checklist contra producción). Mismo método que
// scripts/foto-deposito.cjs.
//
//   node scripts/foto-vendedor.cjs guardar antes.json     ← antes de crear datos de prueba
//   node scripts/foto-vendedor.cjs comparar antes.json    ← después de borrar los datos de prueba
//   node scripts/foto-vendedor.cjs rastros TEST-VENDEDOR  ← busca el texto en las tablas de negocio
//
// Guarda: cantidad de filas por tabla, stock (actual y reservado) de CADA artículo, saldo de
// CADA cliente, saldos financieros (billeteras), máximos de numeración y el id más nuevo de
// las tablas de movimientos. `comparar` lista cada diferencia.
const { readFileSync, writeFileSync } = require("node:fs")
const { createClient } = require("@supabase/supabase-js")

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const TABLAS = [
  "clientes", "bonificaciones", "cliente_proveedor_condicion", "cliente_marca_condicion", "clientes_zonas",
  "pedidos", "pedidos_detalle", "pedido_proveedor_condicion", "pedido_marca_condicion", "kardex", "comisiones", "movimientos_stock",
  "pagos_clientes", "pagos_detalle", "cheques", "imputaciones", "pago_comprobantes", "cobranzas", "billetera_movimientos", "saldos_financieros",
  "rendiciones", "rendicion_items", "comprobantes_venta", "comprobantes_venta_detalle", "cuenta_corriente_clientes",
  "devoluciones", "devoluciones_detalle", "devoluciones_descuentos",
  "viajes", "viaje_zonas", "viajes_clientes", "zonas", "localidades",
  "mobile_idempotencia", "mobile_alertas_integridad", "mobile_dispositivos", "precio_insumos_historial",
]
const TEXTO = { clientes: ["nombre", "razon_social", "direccion"], pedidos: ["observaciones"], pagos_clientes: ["observaciones"], devoluciones: ["observaciones"], viajes: ["nombre"], billetera_movimientos: ["concepto"], kardex: ["articulo_descripcion"] }

async function paginar(build, orden = "id") {
  const out = []
  for (let o = 0; ; o += 1000) {
    const { data, error } = await build().order(orden).range(o, o + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

async function foto() {
  const f = { tomada: new Date().toISOString(), filas: {}, maximos: {}, stock: {}, saldos: {}, financieros: {} }
  for (const t of TABLAS) {
    const { count, error } = await sb.from(t).select("*", { count: "exact", head: true })
    f.filas[t] = error ? `error: ${error.message}` : count
  }
  for (const [t, col] of [["pedidos", "numero_pedido"], ["devoluciones", "numero_devolucion"], ["clientes", "codigo_cliente"]]) {
    const { data } = await sb.from(t).select(col).not(col, "is", null).order(col, { ascending: false }).limit(1)
    f.maximos[`${t}.${col}`] = data?.[0]?.[col] ?? null
  }
  for (const a of await paginar(() => sb.from("articulos").select("id, stock_actual, stock_reservado"))) f.stock[a.id] = [Number(a.stock_actual ?? 0), Number(a.stock_reservado ?? 0)]
  for (const s of await paginar(() => sb.from("v_saldo_clientes").select("cliente_id, saldo_actual"), "cliente_id").catch(() => [])) f.saldos[s.cliente_id] = Number(s.saldo_actual ?? 0)
  const fin = await sb.from("saldos_financieros").select("*")
  for (const s of fin.data || []) f.financieros[`${s.cuenta_tipo}|${s.cuenta_id}|${s.color}`] = Number(s.saldo ?? s.monto ?? 0)
  return f
}

;(async () => {
  const [modo, arg] = process.argv.slice(2)
  if (modo === "rastros") {
    let total = 0
    for (const [t, cols] of Object.entries(TEXTO)) {
      const { data, error } = await sb.from(t).select("id").or(cols.map((c) => `${c}.ilike.%${arg}%`).join(",")).limit(50)
      if (error) { console.log(`${t}: error ${error.message}`); continue }
      total += data.length
      console.log(`${t}: ${data.length}${data.length ? " → " + data.map((x) => x.id).join(", ") : ""}`)
    }
    console.log(total ? `✗ ${total} rastro(s) de "${arg}"` : `✓ 0 rastros de "${arg}"`)
    process.exit(total ? 1 : 0)
  }
  if (!["guardar", "comparar"].includes(modo) || !arg) { console.error("uso: foto-vendedor.cjs guardar|comparar <archivo.json> · rastros <texto>"); process.exit(2) }
  const ahora = await foto()
  if (modo === "guardar") {
    writeFileSync(arg, JSON.stringify(ahora))
    console.log(`Foto guardada en ${arg}:`, ahora.filas, ahora.maximos, `· ${Object.keys(ahora.stock).length} artículos · ${Object.keys(ahora.saldos).length} saldos de clientes · financieros`, ahora.financieros)
    return
  }
  const antes = JSON.parse(readFileSync(arg, "utf8"))
  const dif = []
  for (const grupo of ["filas", "maximos", "saldos", "financieros"]) {
    for (const k of new Set([...Object.keys(antes[grupo] || {}), ...Object.keys(ahora[grupo] || {})])) {
      if (JSON.stringify(antes[grupo]?.[k]) !== JSON.stringify(ahora[grupo]?.[k])) dif.push(`${grupo}.${k}: ${JSON.stringify(antes[grupo]?.[k])} → ${JSON.stringify(ahora[grupo]?.[k])}`)
    }
  }
  for (const k of new Set([...Object.keys(antes.stock), ...Object.keys(ahora.stock)])) {
    if (JSON.stringify(antes.stock[k]) !== JSON.stringify(ahora.stock[k])) dif.push(`stock ${k}: ${JSON.stringify(antes.stock[k])} → ${JSON.stringify(ahora.stock[k])}`)
  }
  console.log(`Foto de ${antes.tomada} vs ahora (${ahora.tomada})`)
  if (!dif.length) console.log("✓ IDÉNTICA: filas por tabla, numeración, stock de cada artículo, saldo de cada cliente y saldos financieros")
  else { console.log(`✗ ${dif.length} diferencia(s):`); for (const d of dif) console.log("  " + d) }
  process.exit(dif.length ? 1 : 0)
})()
