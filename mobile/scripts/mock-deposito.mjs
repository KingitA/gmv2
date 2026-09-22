#!/usr/bin/env node
// Servidor FALSO del ERP para probar la app Depósito sin backend ni base real:
//
//   cd mobile && node scripts/mock-deposito.mjs            (puerto 3999)
//   cd apps/deposito && set VITE_API_BASE=http://localhost:3999&& npx vite
//   → http://localhost:5175  (cualquier email; contraseña "x")
//
// Implementa el protocolo de MOBILE.md §4 (auth, sync snapshot con hash, outbox con
// idempotencia real) y las reglas de negocio de lib/deposito/* en memoria: renglón
// de un solo operario, cierre idempotente, recepción, devoluciones, stock.
// Sirve para las pruebas de ruta / interrupción / concurrencia (dos pestañas con
// emails distintos = dos operarios).
//
//   GET  /__mock/estado            volcado del estado + contador de aplicaciones por clave
//   POST /__mock/red?on=0|1[&usuario=juan]   simula WiFi caído (corta la conexión sin responder);
//                                  con usuario, solo para ese operario (prueba de concurrencia)
//   POST /__mock/urgente?id=p2     pasa un pedido a prioridad 1
//   POST /__mock/reset

import { createHash, randomUUID } from "node:crypto"
import { createServer } from "node:http"

const PUERTO = Number(process.env.PORT || 3999)
const N_ARTICULOS = Number(process.env.ARTICULOS || 6000)

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
// Descripciones con el largo y el estilo de las reales (mediana 33 caracteres, máx 59):
// así se ve de verdad cuánto entra en un renglón del picking.
const DESCRIPCIONES = [
  "PROTECTOR ANATÓMICO S/D ROSA x20u",
  "PROTECTOR ANATÓMICO C/D VERDE x40u",
  "JABON LIQUIDO DOY PACK RELAX FLORAL 200ml",
  "DESTAPACAÑERIAS C/MICROESFERAS X 1 LT   MERCLIN x6",
  "ACONDICIONADOR FRAGANCIA PROLONGADA x200ml (576988)",
  "ALFOMBRA VENTOSA DECO MR TRAPO x120b",
  "PROTECTOR SOLAR CON VALVULA EMULSION FPS 40 x380ml",
  "TRAPO GRIS MR x120",
  "FAC LECHE LIMP 200ML X12B",
  "DESODORANTE EROSOL KEVIN BLACK x250ml",
]
/** Foto de mentira (SVG embebido): no necesita red ni archivos en el repo. */
const fotoDemo = (i) => {
  const color = ["#fde68a", "#bbf7d0", "#bfdbfe", "#e9d5ff", "#fecaca"][i % 5]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="${color}"/><text x="150" y="150" font-family="sans-serif" font-size="34" font-weight="bold" text-anchor="middle" fill="#334155">FOTO #${i}</text><text x="150" y="195" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#64748b">artículo de prueba</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
let S
function reset() {
  const articulos = []
  for (let i = 1; i <= N_ARTICULOS; i++) {
    articulos.push({
      id: uid(i), sku: String(100000 + i), descripcion: `${DESCRIPCIONES[i % DESCRIPCIONES.length]} #${i}`,
      ean13: i % 9 === 0 ? null : [String(7790000000000 + i)], codigo_bulto: i % 4 === 0 ? String(17790000000000 + i) : null,
      stock_actual: (i * 7) % 120, unidades_por_bulto: [6, 12, 24][i % 3], unidad_de_medida: "UN", orden_deposito: i % 5 === 0 ? null : i,
      proveedor_id: uid(900 + (i % 4)), categoria: ["LIMPIEZA", "PERFUMERIA", "BAZAR"][i % 3], tipo_fraccion: null, cantidad_fraccion: null,
      marca: i % 7 === 0 ? null : ["Ayudín", "Magistral", "Ala", "Mortimer", "Media Naranja"][i % 5],
      // Fotos: como en producción las tienen ~4 de cada 10. Una de cada 20 apunta a una
      // URL que no resuelve, para ver el mensaje de "no se pudo cargar" sin apagar la red.
      imagen_url: i % 20 === 0 ? "https://no-existe.gmv2.invalid/foto.jpg" : i % 5 < 2 ? fotoDemo(i) : null,
    })
  }
  const artDe = (i) => {
    const a = articulos[i - 1]
    return { id: a.id, sku: a.sku, descripcion: a.descripcion, ean13: a.ean13, codigo_bulto: a.codigo_bulto, unidades_por_bulto: a.unidades_por_bulto, orden_deposito: a.orden_deposito, proveedores: { nombre: "Proveedor Demo" }, marca: a.marca ? { descripcion: a.marca } : null }
  }
  const linea = (pid, n, i, cantidad, extra = {}) => ({ id: uid(pid * 1000 + n), articulo_id: uid(i), cantidad, cantidad_preparada: 0, estado_item: "PENDIENTE", es_bonificado: false, precio_base: 100 + i, excluye_bonif: false, articulos: artDe(i), ...extra })
  const pedido = (n, cliente, prioridad, lineas, extra = {}) => ({
    id: uid(5000 + n), numero_pedido: `00${1500 + n}`, estado: "pendiente", fecha: "2026-09-18", prioridad, observaciones: null, created_at: `2026-09-18T1${n}:00:00Z`,
    bonif_mercaderia_pct: 0, clientes: { id: uid(7000 + n), nombre: cliente, razon_social: cliente, direccion: "Av. Siempreviva 742", localidad: "Rosario" },
    pedidos_detalle: lineas, preparadores: {}, ...extra,
  })
  S = {
    seq: 1,
    articulos,
    pedidos: [
      pedido(1, "Almacén Don José", 3, [linea(1, 1, 1, 12), linea(1, 2, 2, 6), linea(1, 3, 3, 24), linea(1, 4, 4, 2), linea(1, 5, 5, 10)]),
      pedido(2, "Supermercado El Sol", 2, Array.from({ length: 40 }, (_, k) => linea(2, k + 1, 10 + k, 1 + (k % 12)))),
      pedido(3, "Kiosco La Esquina (bonif 10 %)", 3, [linea(3, 1, 60, 10, { precio_base: 100 }), linea(3, 2, 61, 5, { precio_base: 200 }), linea(3, 3, 62, 0, { es_bonificado: true, precio_base: 50 })], { bonif_mercaderia_pct: 10 }),
    ],
    ordenes: [
      { id: uid(8001), numero_orden: "OC-000081", estado: "pendiente", fecha_orden: "2026-09-15", observaciones: null, proveedores: { id: uid(901), nombre: "Proveedor Demo SA" },
        ordenes_compra_detalle: [70, 71, 72, 73].map((i, k) => ({ id: uid(8100 + k), cantidad_pedida: 24 * (k + 1), articulo_id: uid(i), precio_unitario: 100, articulos: artDe(i) })), recepcion: null },
    ],
    devoluciones: [
      { id: uid(9001), numero_devolucion: "DEV-0042", estado: "pendiente", observaciones: "Caja golpeada", created_at: "2026-09-17T10:00:00Z", clientes: { id: uid(7001), nombre: "Almacén Don José", razon_social: "Almacén Don José" },
        devoluciones_detalle: [{ id: uid(9101), cantidad: 3, motivo: "Roto", es_vendible: false, articulos: artDe(80) }, { id: uid(9102), cantidad: 2, motivo: "Error de pedido", es_vendible: true, articulos: artDe(81) }] },
    ],
    claves: new Map(), // idempotency_key → { hash, status, body, aplicaciones }
    red: true,
    sinRed: new Set(), // operarios sin señal
    log: [],
  }
}
reset()

const catalogos = () => [
  { id: "proveedores", items: [0, 1, 2, 3].map((k) => ({ id: uid(900 + k), nombre: ["Demo Cero", "Proveedor Demo SA", "Distribuidora Norte", "INEXISTENTE"][k] })) },
  { id: "tipos", tiposBulto: ["UN", "BULTO", "CAJA", "PACK"], tiposFraccion: ["UN", "PACK", "DOCENA"] },
  { id: "transportes", items: [{ id: uid(601), nombre: "Expreso Rosario" }, { id: uid(602), nombre: "Transporte Sur" }] },
]
const PREPARABLES = ["pendiente", "en_preparacion", "impreso"]
const DATASETS = {
  deposito_pedidos: () => S.pedidos.filter((p) => PREPARABLES.includes(p.estado)),
  deposito_recepciones: () => S.ordenes.filter((o) => ["pendiente", "recibida_parcial"].includes(o.estado)),
  deposito_devoluciones: () => S.devoluciones.filter((d) => d.estado === "pendiente"),
  deposito_articulos: () => S.articulos,
  deposito_catalogos: catalogos,
}

class Rechazo extends Error {}
const estadoItem = (prep, pedida, falt) => (falt ? "FALTANTE" : prep >= pedida ? "COMPLETO" : prep > 0 ? "PARCIAL" : "PENDIENTE")
function recalcularBonificados(p) {
  const bon = p.pedidos_detalle.filter((d) => d.es_bonificado)
  if (!bon.length || !(p.bonif_mercaderia_pct > 0)) return
  const neto = p.pedidos_detalle.filter((d) => !d.es_bonificado && !d.excluye_bonif).reduce((s, d) => s + d.precio_base * d.cantidad_preparada, 0)
  for (const b of bon) {
    const u = b.precio_base > 0 ? Math.round(((neto * p.bonif_mercaderia_pct) / 100 / bon.length) / b.precio_base) : 0
    if (u !== b.cantidad || u !== b.cantidad_preparada) Object.assign(b, { cantidad: u, cantidad_preparada: u, estado_item: "COMPLETO" })
  }
}
const parchePedido = (id) => { const p = DATASETS.deposito_pedidos().find((x) => x.id === id); return { dataset: "deposito_pedidos", upserts: p ? [p] : [], deletes: p ? [] : [id] } }
const parcheOrden = (id) => { const o = DATASETS.deposito_recepciones().find((x) => x.id === id); return { dataset: "deposito_recepciones", upserts: o ? [o] : [], deletes: o ? [] : [id] } }
const parcheArt = (id) => { const a = S.articulos.find((x) => x.id === id); return { dataset: "deposito_articulos", upserts: a ? [a] : [], deletes: a ? [] : [id] } }
function recepcionDe(ordenId, userId) {
  const o = S.ordenes.find((x) => x.id === ordenId)
  if (!o) throw new Rechazo("Orden de compra no encontrada")
  if (!o.recepcion) {
    o.recepcion = { id: randomUUID(), estado: "en_proceso", numero_tanda: 1, conformidad_transporte: null, usuario_id: userId, recepciones_documentos: [],
      recepciones_items: o.ordenes_compra_detalle.map((d) => ({ id: randomUUID(), articulo_id: d.articulo_id, cantidad_oc: d.cantidad_pedida, cantidad_fisica: 0, estado_linea: "pendiente", fuera_de_oc: false })) }
    o.estado = "recibida_parcial"
  }
  return o
}
const HANDLERS = {
  "picking.abrir": (u, p) => { const x = S.pedidos.find((q) => q.id === p.pedido_id); if (x && PREPARABLES.includes(x.estado)) x.estado = "en_preparacion"; return { replica: [parchePedido(p.pedido_id)] } },
  "picking.item": (u, p) => {
    const ped = S.pedidos.find((q) => q.id === p.pedido_id)
    const d = ped?.pedidos_detalle.find((x) => x.id === p.pedido_detalle_id)
    if (!d) throw new Rechazo("Renglón no encontrado")
    if (!PREPARABLES.includes(ped.estado)) throw new Rechazo("El pedido ya se cerró: este cambio no se aplicó.")
    const prep = ped.preparadores[d.id]
    if (prep && prep.usuario_id !== u.id) throw new Rechazo(`Ya lo preparó ${prep.usuario_nombre}. Solo esa persona puede modificarlo.`)
    d.cantidad_preparada = Number(p.cantidad_preparada) || 0
    d.estado_item = estadoItem(d.cantidad_preparada, d.cantidad, !!p.es_faltante)
    if (d.estado_item === "PENDIENTE") delete ped.preparadores[d.id]
    else { ped.preparadores[d.id] = { usuario_id: u.id, usuario_nombre: u.nombre }; ped.estado = "en_preparacion" }
    if (!d.es_bonificado) recalcularBonificados(ped)
    return { estado_item: d.estado_item, replica: [parchePedido(ped.id)] }
  },
  "picking.cerrar": (u, p) => {
    const ped = S.pedidos.find((q) => q.id === p.pedido_id)
    if (!ped) throw new Rechazo("Pedido no encontrado")
    if (PREPARABLES.includes(ped.estado)) {
      const pend = ped.pedidos_detalle.filter((d) => !d.estado_item || d.estado_item === "PENDIENTE").length
      if (pend) throw new Rechazo(`Quedan ${pend} artículos sin resolver`)
      ped.estado = "pendiente_facturacion"
      ped.cierres = (ped.cierres || 0) + 1
    }
    return { ok: true, replica: [parchePedido(ped.id)] }
  },
  "recepcion.iniciar": (u, p) => { recepcionDe(p.orden_compra_id, u.id); return { replica: [parcheOrden(p.orden_compra_id)] } },
  "recepcion.conformidad": (u, p) => { const o = recepcionDe(p.orden_compra_id, u.id); o.recepcion.conformidad_transporte ??= p.conformidad.estado; return { replica: [parcheOrden(o.id)] } },
  "recepcion.item": (u, p) => {
    const o = recepcionDe(p.orden_compra_id, u.id)
    if (o.recepcion.estado === "finalizada") throw new Rechazo("La recepción de esta orden ya se finalizó: este cambio no se aplicó.")
    const c = Number(p.cantidad_fisica)
    const e = c === -1 ? { estado_linea: "pendiente", cantidad_fisica: 0 } : c === 0 ? { estado_linea: "faltante", cantidad_fisica: 0 } : { estado_linea: "ok", cantidad_fisica: c }
    const it = o.recepcion.recepciones_items.find((x) => x.articulo_id === p.articulo_id)
    if (it) Object.assign(it, e)
    else o.recepcion.recepciones_items.push({ id: randomUUID(), articulo_id: p.articulo_id, cantidad_oc: 0, fuera_de_oc: true, ...e })
    return { replica: [parcheOrden(o.id)] }
  },
  "recepcion.cerrar": (u, p) => {
    const o = recepcionDe(p.orden_compra_id, u.id)
    if (o.recepcion.estado !== "finalizada") {
      const pend = o.recepcion.recepciones_items.filter((x) => x.estado_linea === "pendiente").length
      if (pend) throw new Rechazo(`Faltan ${pend} artículos por escanear o marcar`)
      for (const it of o.recepcion.recepciones_items) { const a = S.articulos.find((x) => x.id === it.articulo_id); if (a && it.cantidad_fisica > 0) a.stock_actual += it.cantidad_fisica }
      o.recepcion.estado = "finalizada"; o.estado = "recibida_completa"; o.cierres = (o.cierres || 0) + 1
    }
    return { ok: true, replica: [parcheOrden(o.id), { dataset: "deposito_articulos", upserts: o.recepcion.recepciones_items.map((i) => S.articulos.find((a) => a.id === i.articulo_id)).filter(Boolean), deletes: [] }] }
  },
  "devolucion.recibir": (u, p) => {
    const d = S.devoluciones.find((x) => x.id === p.devolucion_id)
    if (!d) throw new Rechazo("Devolución no encontrada")
    if (d.estado === "pendiente") {
      for (const it of p.items_confirmados) { const a = S.articulos.find((x) => x.id === it.articulo_id); if (a && it.es_vendible) a.stock_actual += it.cantidad_recibida }
      d.estado = "confirmado"; d.confirmado_por = u.nombre
    }
    return { ok: true, replica: [{ dataset: "deposito_devoluciones", upserts: [], deletes: [d.id] }] }
  },
  "stock.ajustar": (u, p) => {
    const a = S.articulos.find((x) => x.id === p.articulo_id)
    if (!a) throw new Rechazo("El artículo ya no existe: el ajuste no se aplicó.")
    a.stock_actual = p.tipo === "correccion" ? p.cantidad : p.tipo === "entrada" ? a.stock_actual + p.cantidad : a.stock_actual - p.cantidad
    return { nuevoStock: a.stock_actual, replica: [parcheArt(a.id)] }
  },
  "articulo.datos": (u, p) => {
    const a = S.articulos.find((x) => x.id === p.articulo_id)
    if (!a) throw new Rechazo("El artículo ya no existe.")
    const conflictos = []
    for (const [campo, c] of Object.entries(p.cambios)) {
      const canon = (v) => JSON.stringify(Array.isArray(v) ? [...v].sort() : v ?? null)
      if (canon(a[campo]) === canon(c.despues)) continue
      if (canon(a[campo]) === canon(c.antes)) a[campo] = c.despues
      else conflictos.push(campo)
    }
    if (conflictos.length) throw new Rechazo(`${a.descripcion}: otra persona cambió ${conflictos.join(", ")} mientras estabas sin señal y no se pisó. Abrí el artículo y revisalo.`)
    return { replica: [parcheArt(a.id)] }
  },
  "articulo.inexistente": (u, p) => { const a = S.articulos.find((x) => x.id === p.articulo_id); if (a) a.proveedor_id = uid(903); return { replica: [parcheArt(p.articulo_id)] } },
}

// ─── HTTP ───────────────────────────────────────────────────────────────────
const usuarioDe = (token) => {
  const m = /^mock\.(.+)$/.exec(token || "")
  if (!m) return null
  const email = Buffer.from(m[1], "base64url").toString()
  return { id: uid(parseInt(createHash("sha1").update(email).digest("hex").slice(0, 8), 16) % 1e9), email, nombre: email.split("@")[0].replace(/^./, (c) => c.toUpperCase()) }
}
const sesion = (email) => {
  const t = `mock.${Buffer.from(email).toString("base64url")}`
  const u = usuarioDe(t)
  return { access_token: t, refresh_token: t, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: u.id, email, nombre: u.nombre }, roles: ["deposito"] }
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x")
  const cors = { "Access-Control-Allow-Origin": req.headers.origin || "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Device-Id, X-App-Version", "Access-Control-Max-Age": "86400" }
  const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors }); res.end(JSON.stringify(body)) }
  let raw = ""
  for await (const ch of req) raw += ch
  const body = raw && (req.headers["content-type"] || "").includes("json") ? JSON.parse(raw) : null

  if (url.pathname.startsWith("/__mock/")) {
    if (url.pathname === "/__mock/red") {
      const on = url.searchParams.get("on") !== "0"
      const quien = (url.searchParams.get("usuario") || "").toLowerCase()
      if (!quien) S.red = on
      else if (on) S.sinRed.delete(quien)
      else S.sinRed.add(quien)
    }
    if (url.pathname === "/__mock/reset") reset()
    if (url.pathname === "/__mock/urgente") { const p = S.pedidos.find((x) => x.id === uid(5000 + Number((url.searchParams.get("id") || "p2").slice(1)))); if (p) p.prioridad = 1; S.seq++ }
    return json(200, {
      red: S.red, sinRed: [...S.sinRed], seq: S.seq,
      pedidos: S.pedidos.map((p) => ({ numero: p.numero_pedido, estado: p.estado, prioridad: p.prioridad, cierres: p.cierres || 0, renglones: p.pedidos_detalle.map((d) => `${d.estado_item}:${d.cantidad_preparada}/${d.cantidad}${p.preparadores[d.id] ? `@${p.preparadores[d.id].usuario_nombre}` : ""}`) })),
      ordenes: S.ordenes.map((o) => ({ numero: o.numero_orden, estado: o.estado, cierres: o.cierres || 0, recepcion: o.recepcion && { estado: o.recepcion.estado, conformidad: o.recepcion.conformidad_transporte, items: o.recepcion.recepciones_items.map((i) => `${i.estado_linea}:${i.cantidad_fisica}/${i.cantidad_oc}${i.fuera_de_oc ? " FUERA_OC" : ""}`) } })),
      devoluciones: S.devoluciones.map((d) => ({ numero: d.numero_devolucion, estado: d.estado })),
      claves: [...S.claves.values()].map((c) => ({ tipo: c.tipo, estado: c.body.estado, aplicaciones: c.aplicaciones, recibidas: c.recibidas, usuario: c.usuario })),
      ultimasOperaciones: S.log.slice(-15),
    })
  }
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end() }
  if (!S.red) return req.socket.destroy() // WiFi caído: la app ve un error de red

  if (url.pathname === "/api/mobile/auth/login") return body?.email && body?.password ? json(200, sesion(String(body.email).toLowerCase())) : json(400, { error: "Faltan datos de ingreso." })
  if (url.pathname === "/api/mobile/auth/refresh") { const u = usuarioDe(body?.refresh_token); return u ? json(200, sesion(u.email)) : json(401, { error: "La sesión expiró." }) }
  if (url.pathname === "/api/mobile/auth/logout") return json(200, { ok: true })

  const u = usuarioDe((req.headers.authorization || "").replace(/^Bearer /, ""))
  if (!u) return json(401, { error: "No autorizado." })
  if (S.sinRed.has(u.nombre.toLowerCase())) return req.socket.destroy()

  if (url.pathname === "/api/mobile/sync/estado") return json(200, { server_time: new Date().toISOString(), cambios_seq: String(S.seq), protocolo: 1 })
  const ds = /^\/api\/mobile\/sync\/(.+)$/.exec(url.pathname)?.[1]
  if (ds) {
    if (!DATASETS[ds]) return json(404, { error: `Dataset desconocido: ${ds}` })
    const filas = DATASETS[ds]()
    const hash = createHash("sha1").update(JSON.stringify(filas)).digest("base64url").slice(0, 27)
    const mismo = (url.searchParams.get("cursor") || "").endsWith(hash)
    return json(200, { dataset: ds, modo: "snapshot", cursor: `s:${hash}`, generado_at: new Date().toISOString(), sin_cambios: mismo, upserts: mismo ? [] : filas, deletes: [] })
  }
  if (url.pathname === "/api/mobile/outbox") {
    const m = body
    const hash = JSON.stringify([m.tipo, m.payload])
    const previa = S.claves.get(m.idempotency_key)
    if (previa) {
      previa.recibidas++
      if (previa.hash !== hash) return json(409, { error: "Misma clave, otro contenido", reintentable: false })
      return json(previa.status, previa.body.estado === "aplicado" ? { ...previa.body, estado: "duplicado" } : previa.body)
    }
    const h = HANDLERS[m.tipo]
    if (!h) return json(422, { estado: "rechazado", error: `Operación desconocida: ${m.tipo}` })
    let status = 200, out
    try { out = { estado: "aplicado", resultado: h(u, m.payload) }; S.seq++ } catch (e) {
      if (!(e instanceof Rechazo)) { console.error(e); return json(503, { error: "Error transitorio" }) }
      status = 422; out = { estado: "rechazado", error: e.message }
    }
    S.claves.set(m.idempotency_key, { hash, status, body: out, aplicaciones: 1, recibidas: 1, tipo: m.tipo, usuario: u.nombre })
    S.log.push(`${u.nombre} ${m.tipo} → ${out.estado}${out.error ? `: ${out.error}` : ""}`)
    return json(status, out)
  }
  json(404, { error: "No existe en el mock" })
}).listen(PUERTO, () => console.log(`Mock del ERP para la app Depósito en http://localhost:${PUERTO} (${N_ARTICULOS} artículos)`))
