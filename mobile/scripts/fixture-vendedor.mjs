#!/usr/bin/env node
// Arma un FIXTURE para mock-vendedor.mjs con el catálogo REAL (solo lectura) de la base
// de ../.env.local: artículos, insumos de precio, taxonomía, proveedores y la cartera de
// un vendedor. Sirve para probar la app Vendedor con el volumen real (MOBILE.md →
// Vendedor → "Performance") sin tocar producción ni necesitar un usuario.
//
//   cd mobile && node scripts/fixture-vendedor.mjs [nombre-del-vendedor]
//
// Salida: scripts/.fixture-vendedor.json (en .gitignore: tiene datos reales de clientes).
// NO escribe nada en la base. La cuenta corriente, pedidos y billetera del mock son
// sintéticos (los genera mock-vendedor.mjs).
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const { createClient } = createRequire(resolve(RAIZ, "package.json"))("@supabase/supabase-js")
const env = Object.fromEntries(readFileSync(resolve(RAIZ, ".env.local"), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function todo(build) {
  const out = []
  for (let o = 0; ; o += 1000) {
    const { data, error } = await build().order("id").range(o, o + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}
const ok = ({ data, error }) => { if (error) throw error; return data || [] }

// = lib/vendedor/articulos-select.ts + lib/mobile/sync/vendedor.ts
const SELECT = "id, sku, ean13, descripcion, unidades_por_bulto, tipo_fraccion, cantidad_fraccion, stock_actual, stock_reservado, descuento_propio, iva_ventas, imagen_url, rubro_id, categoria_id, subcategoria_id, rubro, categoria, subcategoria, marca:marca_id(descripcion), proveedor:proveedor_id(nombre), rubro_info:rubro_id(nombre), categoria_info:categoria_id(nombre), subcategoria_info:subcategoria_id(nombre), proveedor_id, marca_id, codigo_bulto, sigla, created_at"
// = ARTICULO_PRECIO_COLS de lib/pricing/cargar-insumos.ts
const PRECIO = "id,proveedor_id,marca_id,precio_compra,precio_base,precio_base_contado,precio_lista_especial,oferta_lista_especial,porcentaje_ganancia,bonif_recargo,categoria,iva_compras,iva_ventas,descuento_propio,segmento_precio,rubros:rubro_id(slug),proveedor:proveedores(tipo_descuento),sku,descripcion,activo,unidades_por_bulto"

const quien = process.argv[2]
const vendedores = ok(await sb.from("vendedores").select("id, nombre, lista_precio_id, lista:lista_precio_id(nombre), puede_cambiar_lista").eq("activo", true))
const conteo = await Promise.all(vendedores.map(async (v) => ({ v, n: (await sb.from("clientes").select("*", { count: "exact", head: true }).eq("vendedor_id", v.id).eq("activo", true)).count || 0 })))
const elegido = (quien ? conteo.find((x) => x.v.nombre.toLowerCase().includes(quien.toLowerCase())) : conteo.sort((a, b) => b.n - a.n)[0])?.v
if (!elegido) { console.error("No encontré ese vendedor"); process.exit(1) }

console.log(`Vendedor: ${elegido.nombre}`)
const [arts, precios, descs, listas, reglas, programados, rubros, cats, subs, extras, provs, ventas, condPago, condEntrega, localidades, zonas, clientes] = await Promise.all([
  todo(() => sb.from("articulos").select(SELECT).eq("activo", true).gt("precio_base", 0)),
  todo(() => sb.from("articulos").select(PRECIO).eq("activo", true)),
  todo(() => sb.from("articulos_descuentos").select("id,articulo_id,tipo,porcentaje,orden")),
  sb.from("listas_precio").select("id,codigo,recargo_limpieza_bazar,recargo_perfumeria_negro,recargo_perfumeria_blanco,nombre,activo").then(ok),
  sb.from("listas_precio_reglas").select("id,grupo_precio,iva_compras,iva_ventas,formulas").then(ok),
  sb.from("precios_programados").select("id,tabla,registro_id,cambios,vigencia_desde,estado").eq("estado", "pendiente").then(ok).catch(() => []),
  sb.from("rubros").select("id, nombre, slug, orden").order("orden").then(ok),
  sb.from("categorias").select("id, rubro_id, nombre, orden").order("orden").then(ok),
  sb.from("subcategorias").select("id, categoria_id, nombre, orden").order("orden").then(ok),
  sb.from("rubros").select("id, descripcion, imagen_url").then(ok).catch(() => []),
  sb.from("proveedores").select("id, nombre, sigla").eq("activo", true).then(ok),
  sb.from("v_articulos_ventas").select("articulo_id, unidades_180d").then(ok).catch(() => []),
  sb.from("condiciones_pago").select("id, nombre").eq("activo", true).order("nombre").then(ok),
  sb.from("condiciones_entrega").select("id, codigo, nombre").eq("activo", true).order("nombre").then(ok),
  sb.from("localidades").select("id, nombre, provincia, zona_id").order("provincia").order("nombre").then(ok),
  sb.from("zonas").select("id, nombre, descripcion").order("nombre").then(ok),
  todo(() => sb.from("clientes").select("id, nombre, razon_social, cuit, codigo_cliente, direccion, localidad, localidad_id, provincia, telefono, mail, condicion_iva, condicion_pago, condicion_entrega, metodo_facturacion, vendedor_id, lista_precio_id, lista:lista_precio_id(nombre), lista_limpieza_id, metodo_limpieza, lista_perf0_id, metodo_perf0, lista_perf_plus_id, metodo_perf_plus").eq("vendedor_id", elegido.id).eq("activo", true)),
])
const cids = clientes.map((c) => c.id)
const [condProv, condMarca, bonifs, saldos] = await Promise.all([
  sb.from("cliente_proveedor_condicion").select("cliente_id, proveedor_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct").in("cliente_id", cids).then(ok),
  sb.from("cliente_marca_condicion").select("cliente_id, marca_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct").in("cliente_id", cids).then(ok),
  sb.from("bonificaciones").select("cliente_id,tipo,segmento,porcentaje").eq("activo", true).in("cliente_id", cids).then(ok),
  sb.from("v_saldo_clientes").select("cliente_id, saldo_actual").in("cliente_id", cids).then(ok).catch(() => []),
])

const articulos = arts.map((a) => ({
  id: a.id, sku: a.sku, ean13: a.ean13, descripcion: a.descripcion, unidades_por_bulto: a.unidades_por_bulto, tipo_fraccion: a.tipo_fraccion || null, cantidad_fraccion: a.cantidad_fraccion || null,
  stock_disponible: Math.max(0, (a.stock_actual || 0) - (a.stock_reservado || 0)), descuento_propio: a.descuento_propio || 0, iva_ventas: a.iva_ventas,
  marca: a.marca?.descripcion || null, proveedor: a.proveedor?.nombre || null, imagen_url: a.imagen_url || null,
  rubro_id: a.rubro_id || null, categoria_id: a.categoria_id || null, subcategoria_id: a.subcategoria_id || null,
  rubro_nombre: a.rubro_info?.nombre || a.rubro || null, categoria_nombre: a.categoria_info?.nombre || a.categoria || null, subcategoria_nombre: a.subcategoria_info?.nombre || a.subcategoria || null,
  proveedor_id: a.proveedor_id || null, marca_id: a.marca_id || null, codigo_bulto: a.codigo_bulto || null, sigla: a.sigla || null, created_at: a.created_at || null,
}))
const descPorArt = new Map()
for (const d of descs.sort((a, b) => a.orden - b.orden)) (descPorArt.get(d.articulo_id) || descPorArt.set(d.articulo_id, []).get(d.articulo_id)).push({ tipo: d.tipo, porcentaje: d.porcentaje, orden: d.orden })

const cuenta = (campo) => { const m = new Map(); for (const a of articulos) if (a[campo]) m.set(a[campo], (m.get(a[campo]) || 0) + 1); return m }
const porCat = cuenta("categoria_id"), porSub = cuenta("subcategoria_id"), porProv = cuenta("proveedor_id")
const extra = new Map(extras.map((e) => [e.id, e]))
const agrupar = (rows) => { const m = new Map(); for (const { cliente_id, ...r } of rows) (m.get(cliente_id) || m.set(cliente_id, []).get(cliente_id)).push(r); return m }
const cp = agrupar(condProv), cm = agrupar(condMarca), bo = agrupar(bonifs)
const saldoDe = new Map(saldos.map((s) => [s.cliente_id, Number(s.saldo_actual) || 0]))
const PRECIO_CLIENTE = ["id", "vendedor_id", "metodo_facturacion", "lista_precio_id", "lista_limpieza_id", "metodo_limpieza", "lista_perf0_id", "metodo_perf0", "lista_perf_plus_id", "metodo_perf_plus"]

const fixture = {
  generado: new Date().toISOString(),
  vendedor: { id: elegido.id, nombre: elegido.nombre, lista_precio_id: elegido.lista_precio_id, lista_nombre: elegido.lista?.nombre || null, puede_cambiar_lista: !!elegido.puede_cambiar_lista },
  articulos,
  precios_articulos: precios.map((a) => ({ ...a, descuentos: descPorArt.get(a.id) || [] })),
  precios_listas: listas, precios_reglas: reglas, precios_programados: programados,
  catalogo: rubros.map((r) => {
    const categorias = cats.filter((c) => c.rubro_id === r.id && porCat.get(c.id)).map((c) => ({ id: c.id, nombre: c.nombre, cantidad: porCat.get(c.id), subcategorias: subs.filter((s) => s.categoria_id === c.id && porSub.get(s.id)).map((s) => ({ id: s.id, nombre: s.nombre, cantidad: porSub.get(s.id) })) }))
    return { id: r.id, nombre: r.nombre, slug: r.slug, descripcion: extra.get(r.id)?.descripcion || null, imagen_url: extra.get(r.id)?.imagen_url || null, cantidad: categorias.reduce((s, c) => s + c.cantidad, 0), categorias }
  }),
  proveedores: provs.filter((p) => porProv.get(p.id)).map((p) => ({ ...p, cantidad: porProv.get(p.id) })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
  ventas: Object.fromEntries(ventas.map((v) => [v.articulo_id, v.unidades_180d])),
  ficha: { condiciones_pago: condPago, condiciones_entrega: condEntrega, zonas: zonas.map(({ id, nombre }) => ({ id, nombre })), localidades: localidades.map(({ id, nombre, provincia }) => ({ id, nombre, provincia })), listas_precio: listas.filter((l) => l.activo !== false && l.codigo !== "especial").map(({ id, nombre, codigo }) => ({ id, nombre, codigo })) },
  zonas: zonas.map((z) => { const locs = new Set(localidades.filter((l) => l.zona_id === z.id).map((l) => l.id)); const n = clientes.filter((c) => locs.has(c.localidad_id)).length; return { id: z.id, nombre: z.nombre, descripcion: z.descripcion, cantidad_clientes: n, mis_clientes: n } }),
  clientes: clientes.map((c) => {
    const { lista_limpieza_id, metodo_limpieza, lista_perf0_id, metodo_perf0, lista_perf_plus_id, metodo_perf_plus, ...ficha } = c
    return { ...ficha, saldo_actual: saldoDe.get(c.id) || 0 }
  }),
  precios_clientes: clientes.map((c) => ({ id: c.id, cliente: Object.fromEntries(PRECIO_CLIENTE.map((k) => [k, c[k] ?? null])), condicionesProveedor: cp.get(c.id) || [], condicionesMarca: cm.get(c.id) || [], bonificaciones: (bo.get(c.id) || []).filter((b) => b.tipo === "general" || b.tipo === "viajante") })),
  bonificaciones: Object.fromEntries(clientes.map((c) => [c.id, (bo.get(c.id) || []).filter((b) => b.tipo === "viajante" || b.tipo === "mercaderia")])),
}
const salida = resolve(dirname(fileURLToPath(import.meta.url)), ".fixture-vendedor.json")
writeFileSync(salida, JSON.stringify(fixture))
console.log(`OK → ${salida}\n  ${articulos.length} artículos · ${fixture.precios_articulos.length} con insumos de precio · ${clientes.length} clientes · ${fixture.proveedores.length} proveedores · ${(JSON.stringify(fixture).length / 1e6).toFixed(1)} MB`)
