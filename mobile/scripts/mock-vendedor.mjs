#!/usr/bin/env node
// Servidor FALSO del ERP para probar la app Vendedor sin backend ni usuario real:
//
//   cd mobile && node scripts/fixture-vendedor.mjs      (una vez: catálogo REAL, solo lectura)
//   cd mobile && node scripts/mock-vendedor.mjs         (puerto 3998)
//   apps/vendedor/.env.development.local → VITE_API_BASE=http://localhost:3998
//   npm run dev:vendedor → http://localhost:5174  (cualquier email; contraseña "x")
//
// Implementa el protocolo de MOBILE.md §4 (auth, sync snapshot con hash, refresco
// parcial ?ids=, outbox con idempotencia real) y, en memoria, las reglas de las 12
// operaciones del vendedor (lib/mobile/outbox/vendedor.ts): pedido único por local_id,
// renglones a estado final, CAS por campo en la ficha, cobro que reserva comprobantes…
// Los PRECIOS no se recalculan acá (eso lo prueban los tests del motor isomórfico):
// el mock guarda el precio que mandó el equipo y registra `precios_al`.
//
//   GET  /__mock/estado                volcado + contador de aplicaciones por clave
//   POST /__mock/red?on=0|1            simula quedarse sin señal (corta la conexión)
//   POST /__mock/precio?sku=X&base=N   cambia precio_base de un artículo (como el ERP)
//   POST /__mock/estado-pedido?numero=000123&estado=facturado
//   POST /__mock/reset

import { createHash, randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PUERTO = Number(process.env.PORT || 3998)
const AQUI = dirname(fileURLToPath(import.meta.url))
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const r2 = (n) => Math.round(n * 100) / 100
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
class Rechazo extends Error {}

function fixtureSintetico() {
  const lista = { id: uid(101), codigo: "neco", nombre: "Neco", activo: true, recargo_limpieza_bazar: 20, recargo_perfumeria_negro: 10, recargo_perfumeria_blanco: 15 }
  const provs = ["Kenvue", "Algabo", "Unilever", "Clorox"].map((nombre, k) => ({ id: uid(900 + k), nombre, sigla: nombre.slice(0, 3).toUpperCase() }))
  const rubro = { id: uid(200), nombre: "Perfumería", slug: "perfumeria" }
  const cats = ["Shampoo", "Jabones", "Desodorantes"].map((nombre, k) => ({ id: uid(210 + k), nombre }))
  const articulos = [], precios = []
  for (let i = 1; i <= 600; i++) {
    const prov = provs[i % 4], cat = cats[i % 3]
    const tipo = ["Shampoo", "Jabón", "Desodorante"][i % 3]
    articulos.push({ id: uid(i), sku: String(100000 + i), ean13: [String(7790000000000 + i)], descripcion: `${tipo} ${prov.nombre} ${200 + (i % 5) * 50}ml #${i}`, unidades_por_bulto: [6, 12, 24][i % 3], tipo_fraccion: null, cantidad_fraccion: null, stock_disponible: i % 40, descuento_propio: i % 11 === 0 ? 10 : 0, iva_ventas: "factura", marca: prov.nombre, proveedor: prov.nombre, imagen_url: null, rubro_id: rubro.id, categoria_id: cat.id, subcategoria_id: null, rubro_nombre: rubro.nombre, categoria_nombre: cat.nombre, subcategoria_nombre: null, proveedor_id: prov.id, marca_id: null, codigo_bulto: null, sigla: null, created_at: new Date(Date.now() - i * 3600e3).toISOString() })
    precios.push({ id: uid(i), proveedor_id: prov.id, marca_id: null, precio_compra: 500 + i, precio_base: 1000 + i * 3, precio_base_contado: null, precio_lista_especial: null, oferta_lista_especial: null, porcentaje_ganancia: 30, bonif_recargo: 0, categoria: "PERFUMERIA", iva_compras: "factura", iva_ventas: "factura", descuento_propio: i % 11 === 0 ? 10 : 0, segmento_precio: "perf_plus", rubros: { slug: "perfumeria" }, proveedor: { tipo_descuento: null }, sku: String(100000 + i), descripcion: "", activo: true, unidades_por_bulto: 12, descuentos: [] })
  }
  const clientes = ["Almacén Don José", "Supermercado El Sol", "Kiosco La Esquina", "Perfumería Belgrano"].map((nombre, k) => ({ id: uid(7000 + k), nombre, razon_social: nombre, cuit: `30-7000000${k}-1`, codigo_cliente: `C${k}`, direccion: "Belgrano 123", localidad: "Necochea", localidad_id: null, provincia: "Buenos Aires", telefono: null, mail: null, condicion_iva: "Responsable Inscripto", condicion_pago: "Cuenta corriente", condicion_entrega: null, metodo_facturacion: "Factura", vendedor_id: uid(50), lista_precio_id: lista.id, lista: { nombre: "Neco" }, saldo_actual: k * 15000 }))
  return {
    vendedor: { id: uid(50), nombre: "Vendedor Demo", lista_precio_id: null, lista_nombre: null, puede_cambiar_lista: true },
    articulos, precios_articulos: precios, precios_listas: [lista], precios_reglas: [], precios_programados: [],
    catalogo: [{ ...rubro, cantidad: 600, categorias: cats.map((c) => ({ ...c, cantidad: 200, subcategorias: [] })) }],
    proveedores: provs.map((p) => ({ ...p, cantidad: 150 })), ventas: {},
    ficha: { condiciones_pago: [{ id: uid(1), nombre: "Cuenta corriente" }], condiciones_entrega: [], zonas: [{ id: uid(300), nombre: "NECOCHEA" }], localidades: [], listas_precio: [{ id: lista.id, nombre: "Neco", codigo: "neco" }] },
    zonas: [{ id: uid(300), nombre: "NECOCHEA", descripcion: null, cantidad_clientes: 4, mis_clientes: 4 }],
    clientes, precios_clientes: clientes.map((c) => ({ id: c.id, cliente: { id: c.id, vendedor_id: c.vendedor_id, metodo_facturacion: "Factura", lista_precio_id: lista.id }, condicionesProveedor: [], condicionesMarca: [], bonificaciones: [] })),
    bonificaciones: {},
  }
}

const RUTA_FIXTURE = resolve(AQUI, ".fixture-vendedor.json")
const FIX = existsSync(RUTA_FIXTURE) ? JSON.parse(readFileSync(RUTA_FIXTURE, "utf8")) : fixtureSintetico()

let S
function reset() {
  const f = structuredClone(FIX)
  const bonifDe = (id) => {
    const b = { viajante: { limpieza_bazar: 0, perf0: 0, perf_plus: 0 }, mercaderia: { limpieza_bazar: 0, perf0: 0, perf_plus: 0 } }
    for (const x of f.bonificaciones[id] || []) if (b[x.tipo]) for (const s of x.segmento ? [x.segmento] : Object.keys(b[x.tipo])) b[x.tipo][s] = Number(x.porcentaje)
    return b
  }
  // Sin deuda real en el fixture no se puede probar Cobrar: se les inventa a algunos
  if (!f.clientes.some((c) => c.saldo_actual > 0)) f.clientes.forEach((c, k) => { if (k % 9 === 0) c.saldo_actual = r2(48000 + k * 1234.56) })
  const clientes = f.clientes.map((c) => ({ razon_social: null, cuit: null, codigo_cliente: null, ...c, saldo_proyectado: c.saldo_actual, pagos_sin_rendir: 0, bonificaciones: bonifDe(c.id) }))
  // Cuenta corriente sintética: a los clientes con saldo se les arma una factura por ese saldo
  const cc = new Map(clientes.map((c, k) => [c.id, {
    comprobantes: c.saldo_actual > 0 ? [{ id: uid(40000 + k), tipo_comprobante: "FA", numero_comprobante: `0001-${String(1000 + k).padStart(8, "0")}`, fecha: "2026-09-01", total_factura: r2(c.saldo_actual), saldo_pendiente: r2(c.saldo_actual), estado_pago: "pendiente", pedido_id: null, en_cobro: 0, en_cobro_contado: 0 }] : [],
    pagos: [], devoluciones: [],
    comprados: f.articulos.slice(k * 3, k * 3 + 8).map((a) => ({ articulo_id: a.id, sku: a.sku, ean13: a.ean13, descripcion: a.descripcion, imagen_url: a.imagen_url, unidades_por_bulto: a.unidades_por_bulto, ultimo_precio: 1500, ultima_fecha: "2026-08-20", comprobante_venta_id: uid(40000 + k), numero_comprobante: `0001-${String(1000 + k).padStart(8, "0")}`, tipo_comprobante: "FA", cantidad_total: 12 })),
    habituales: f.articulos.slice(k * 5, k * 5 + 12).map((a, j) => ({ articulo_id: a.id, veces_pedido: 12 - j, cantidad_habitual: 6 })),
  }]))
  S = { seq: 1, f, clientes, cc, pedidos: [], numero: 1600, viajes: [], claves: new Map(), red: true, log: [], alertas: [] }
}
reset()

// ─── Datasets ────────────────────────────────────────────────────────────────
const clienteDe = (id) => S.clientes.find((c) => c.id === id)
function filaCC(id) {
  const c = clienteDe(id), k = S.cc.get(id)
  if (!c || !k) return null
  const pedidosCobro = S.pedidos.filter((p) => p.cliente_id === id && p.estado !== "en_venta").map((p) => ({ id: p.id, numero_pedido: p.numero_pedido, fecha: p.fecha, estado: p.estado, total: p.total, pago_contado_10: !!p.pago_contado_10, anticipo_pago_id: p.anticipo_pago_id || null, facturado: false, cobrable: !p.anticipo_pago_id && p.total > 0 }))
  return {
    id, cliente: { ...c, pendiente_verificacion: 0, devoluciones_en_proceso: 0, actualizado_at: c.actualizado_at || null, actualizado_por_nombre: c.actualizado_por_nombre || null },
    comprobantes: k.comprobantes.filter((x) => x.saldo_pendiente > 0), creditos: [], a_cuenta: [], total_a_favor: 0, pedidos_cobrables: [], pedidos_cobro: pedidosCobro,
    devoluciones_pendientes: k.devoluciones.map((d) => ({ ...d, descontado: r2(d.monto_total - d.restante) })),
    pagos_recientes: k.pagos.slice(0, 10), comprados: k.comprados, habituales: k.habituales,
  }
}
function filaPedido(p) {
  const c = clienteDe(p.cliente_id)
  const artDe = (id) => { const a = S.f.articulos.find((x) => x.id === id); return a ? { id: a.id, sku: a.sku, descripcion: a.descripcion, unidades_por_bulto: a.unidades_por_bulto, imagen_url: a.imagen_url, marca_id: a.marca_id, proveedor_id: a.proveedor_id, marca: a.marca ? { descripcion: a.marca } : null } : null }
  const seg = (s) => ({ segmento: s, general: { pct: 0, origen: "ninguno" }, viajante: { pct: p.bonif_pedido?.viajante?.[s] ?? c?.bonificaciones.viajante[s] ?? 0, origen: p.bonif_pedido?.viajante?.[s] != null ? "pedido" : "ficha" }, mercaderia: { pct: p.bonif_pedido?.mercaderia?.[s] ?? c?.bonificaciones.mercaderia[s] ?? 0, origen: p.bonif_pedido?.mercaderia?.[s] != null ? "pedido" : "ficha" } })
  return {
    id: p.id,
    pedido: { id: p.id, numero_pedido: p.numero_pedido, fecha: p.fecha, estado: p.estado, total: p.total, observaciones: p.observaciones, metodo_facturacion_pedido: p.metodo_facturacion_pedido, lista_precio_pedido_id: p.lista_precio_pedido_id, bonif_pedido: p.bonif_pedido, bonif_mercaderia_pct: null, vendedor_id: S.f.vendedor.id, cliente_id: p.cliente_id, created_at: p.created_at,
      clientes: c ? { id: c.id, nombre: c.nombre, localidad: c.localidad, metodo_facturacion: c.metodo_facturacion, lista_precio_id: c.lista_precio_id, lista: c.lista || null } : null,
      pedidos_detalle: p.detalle.map((d) => ({ ...d, articulos: artDe(d.articulo_id) })) },
    comprobantes: [], remitos: [],
    descuentos: { segmentos: ["limpieza_bazar", "perf0", "perf_plus"].map(seg), condiciones: [], solo_este_pedido: !!p.bonif_pedido },
  }
}
const filaViaje = (v) => {
  const clientes = S.clientes.filter((c) => v.cliente_ids.includes(c.id)).map((c) => {
    const ped = S.pedidos.filter((p) => p.cliente_id === c.id && p.estado !== "eliminado" && p.fecha >= v.fecha_inicio).at(-1)
    const noVa = v.no_va.has(c.id)
    return { id: c.id, nombre: c.nombre, localidad: c.localidad, telefono: c.telefono, saldo_actual: c.saldo_actual, estado_viaje: noVa ? "no_va" : ped ? "pedido_levantado" : "pendiente", pedido: ped ? { id: ped.id, cliente_id: c.id, numero_pedido: ped.numero_pedido, total: ped.total, estado: ped.estado } : null }
  })
  const resumen = { id: v.id, nombre: v.nombre, estado: v.estado, fecha_inicio: v.fecha_inicio, fecha_fin_estimada: v.fecha_fin_estimada, zonas: v.zonas }
  return { id: v.id, resumen, viaje: resumen, clientes }
}
const billetera = () => {
  const pagos = [...S.cc.values()].flatMap((k) => k.pagos).filter((p) => p.estado === "pendiente_rendicion")
  const efectivo = r2(pagos.reduce((s, p) => s + (p.efectivo || 0), 0))
  return [
    { id: "billetera", balance: efectivo, saldo: efectivo, desglose: { efectivo, cheques: 0, transferencias: r2(pagos.reduce((s, p) => s + p.monto - (p.efectivo || 0), 0)) }, cheques_cantidad: 0, pagos_sin_rendir: pagos.length, en_viaje: { total: 0, cantidad: 0 }, deuda_rendiciones: 0, comisiones_pendientes: [], total_pendiente_comisiones: 0, historial: pagos.map((p) => ({ id: p.id, tipo: "cobro_cliente", medio: p.forma_pago, monto: p.monto, concepto: `Cobro ${p.cliente_nombre}`, fecha: p.fecha_pago, referencia_id: p.id, referencia_tipo: "pago_cliente" })), total: pagos.length, page: 1, per_page: 50 },
    { id: "comisiones:cobrada", tipo: "cobrada", totales: { disponible: 0, sin_cobrar: 0, retirado: 0 }, pedidos: [] },
    { id: "comisiones:vendida", tipo: "vendida", totales: { disponible: 0, sin_cobrar: r2(S.pedidos.reduce((s, p) => s + p.total * 0.05, 0)), retirado: 0 }, pedidos: S.pedidos.filter((p) => p.estado !== "eliminado").map((p) => ({ pedido_id: p.id, numero_pedido: p.numero_pedido, cliente_id: p.cliente_id, cliente_nombre: clienteDe(p.cliente_id)?.nombre || "—", fecha: p.fecha, fecha_cobro: "", total_monto: p.total, total_comision: r2(p.total * 0.05), total_debito_contado: 0, cantidad_skus: p.detalle.length })) },
    ...S.pedidos.map((p) => ({ id: `detalle:vendida:${p.id}`, tipo: "vendida", articulos: p.detalle.map((d) => ({ kardex_id: d.id, articulo_id: d.articulo_id, sku: "—", descripcion: S.f.articulos.find((a) => a.id === d.articulo_id)?.descripcion || "—", categoria: "—", cantidad: d.cantidad, precio_unitario: d.precio_base, subtotal: r2(d.precio_base * d.cantidad), comision_pct: 5, comision_monto: r2(d.precio_base * d.cantidad * 0.05), comision_pactada: r2(d.precio_base * d.cantidad * 0.05), descuento_financiero_pct: 0 })) })),
    { id: "pagos_pendientes", pagos: pagos.map((p) => ({ id: p.id, monto: p.monto, monto_efectivo: p.efectivo || 0, fecha_pago: p.fecha_pago, cliente_nombre: p.cliente_nombre, metodo_resumen: p.forma_pago })), total: r2(pagos.reduce((s, p) => s + p.monto, 0)), total_efectivo: efectivo, total_otros: r2(pagos.reduce((s, p) => s + p.monto - (p.efectivo || 0), 0)) },
    { id: "rendiciones", rendiciones: [] },
    { id: "estadisticas", ventas_por_mes: [{ mes: hoy().slice(0, 7), total: r2(S.pedidos.reduce((s, p) => s + p.total, 0)), pedidos: S.pedidos.length }], top_clientes: [], comisiones: { pendientes: 0, generadas_mes: 0 }, cartera: { deuda_total: r2(S.clientes.reduce((s, c) => s + Math.max(0, c.saldo_actual), 0)), clientes_con_deuda: S.clientes.filter((c) => c.saldo_actual > 0).length } },
  ]
}
const DATASETS = {
  precios_listas: () => S.f.precios_listas, precios_reglas: () => S.f.precios_reglas, precios_programados: () => S.f.precios_programados,
  precios_articulos: () => S.f.precios_articulos, precios_clientes: () => S.f.precios_clientes,
  vendedor_me: (u) => [{ id: "me", usuario: { id: u.id, nombre: u.nombre, email: u.email }, vendedores: [S.f.vendedor], total_clientes: S.clientes.length, ultimos_pedidos: [], billetera: { saldo: billetera()[0].saldo, cheques_cantidad: 0, comisiones_pendientes: 0 }, proximas_zonas: [] }],
  vendedor_articulos: () => S.f.articulos,
  vendedor_catalogos: () => [
    { id: "catalogo", rubros: S.f.catalogo }, { id: "proveedores", proveedores: S.f.proveedores }, { id: "ventas", ventas: S.f.ventas, disponible: true },
    { id: "precios_listas", listas: S.f.ficha.listas_precio, metodos: [{ key: "Factura", label: "c/IVA" }, { key: "Final", label: "Final" }, { key: "Presupuesto", label: "Presup." }] },
    { id: "ficha", ...S.f.ficha, vendedores: [{ id: S.f.vendedor.id, nombre: S.f.vendedor.nombre, lista_precio_id: S.f.vendedor.lista_precio_id, lista_nombre: S.f.vendedor.lista_nombre }], segmentos: [{ key: "limpieza_bazar", label: "Limpieza y bazar" }, { key: "perf0", label: "Perfumería 0" }, { key: "perf_plus", label: "Perfumería plus" }], condiciones_iva: ["Responsable Inscripto", "Monotributista", "Exento", "Consumidor Final"], metodos_facturacion: ["Factura", "Final", "Presupuesto"], puede_cambiar_lista: S.f.vendedor.puede_cambiar_lista },
    { id: "cuentas", cuentas: [{ id: uid(601), banco: "Banco Nación", nombre: "Cta. Cte. GM", alias: "gm.nacion" }] },
    { id: "zonas", zonas: S.f.zonas },
  ],
  vendedor_clientes: () => S.clientes,
  vendedor_cc: () => S.clientes.map((c) => filaCC(c.id)),
  vendedor_pedidos: () => S.pedidos.filter((p) => p.estado !== "eliminado").map(filaPedido),
  vendedor_billetera: billetera,
  vendedor_viajes: () => S.viajes.map(filaViaje),
}
const PARCIALES = new Set(["vendedor_clientes", "vendedor_cc", "vendedor_viajes"])

// ─── Operaciones ─────────────────────────────────────────────────────────────
const EDITABLES = ["en_venta", "pendiente", "impreso", "en_preparacion"]
// Rechazo de negocio a pedido, para probar el caso "la RPC rechazó el cobro" (POST /__mock/rechazar-cobros?on=1)
let MODO_BCRA = "apto" // apto | riesgo | caido
let MODO_OCR = "ok" // ok | caido | sin_datos | lento
let RECHAZAR_COBROS = false
const parchePedido = (id) => { const p = S.pedidos.find((x) => x.id === id && x.estado !== "eliminado"); return { dataset: "vendedor_pedidos", upserts: p ? [filaPedido(p)] : [], deletes: p ? [] : [id] } }
const parcheCliente = (id) => { const c = clienteDe(id); return [{ dataset: "vendedor_clientes", upserts: c ? [c] : [], deletes: c ? [] : [id] }, { dataset: "vendedor_cc", upserts: c ? [filaCC(id)] : [], deletes: c ? [] : [id] }] }
const parcheViaje = (id) => { const v = S.viajes.find((x) => x.id === id); return { dataset: "vendedor_viajes", upserts: v ? [filaViaje(v)] : [], deletes: v ? [] : [id] } }

function aplicarPedido(p, capturadoAt) {
  const c = clienteDe(p.cliente_id)
  if (!c) throw new Rechazo("El cliente ya no existe.")
  let ped = p.pedido_id ? S.pedidos.find((x) => x.id === p.pedido_id) : S.pedidos.find((x) => x.local_id === p.local_id)
  if (p.pedido_id && (!ped || ped.estado === "eliminado")) throw new Rechazo("El pedido fue eliminado: los cambios no se aplicaron.")
  if (ped && !EDITABLES.includes(ped.estado)) throw new Rechazo(`El pedido ya está ${ped.estado} y no se puede modificar.`)
  const creado = !ped
  if (!ped) {
    ped = { id: randomUUID(), local_id: p.local_id, numero_pedido: String(++S.numero).padStart(6, "0"), cliente_id: p.cliente_id, fecha: capturadoAt.slice(0, 10), estado: "pendiente", created_at: new Date().toISOString(), detalle: [], creaciones: 0 }
    S.pedidos.push(ped)
  }
  if (creado) ped.creaciones++
  // Renglones al ESTADO FINAL (idempotente)
  const previos = ped.detalle
  ped.detalle = p.items.map((i) => {
    const previo = previos.find((d) => d.id === i.detalle_id) || previos.find((d) => d.articulo_id === i.articulo_id)
    return { id: previo?.id || randomUUID(), articulo_id: i.articulo_id, cantidad: Number(i.cantidad), precio_base: i.precio_neto ?? i.precio, precio_final: Number(i.precio), subtotal: r2(i.precio * i.cantidad), es_bonificado: false, estado_item: "PENDIENTE", descuento_propio_pct: 0, bonif_viajante_pct: 0 }
  })
  ped.metodo_facturacion_pedido = p.cond?.metodo_facturacion_pedido || null
  ped.lista_precio_pedido_id = p.cond?.lista_precio_pedido_id || null
  ped.bonif_pedido = p.cond?.bonif_pedido || null
  if (p.confirmar !== false) { ped.observaciones = p.observaciones || null; if (ped.estado === "en_venta") ped.estado = "pendiente" }
  ped.total = r2(ped.detalle.reduce((s, d) => s + d.subtotal, 0))
  ped.precios_al = p.precios_al
  // = lib/vendedor/vigencia-precios.ts: precios de más de 24 hs al capturar ⇒ no garantizados
  ped.precios_garantizados = !(p.precios_al && Date.parse(capturadoAt) - Date.parse(p.precios_al) > 24 * 3600e3)
  ped.capturado_at = capturadoAt
  return { pedido_id: ped.id, numero_pedido: ped.numero_pedido, total: ped.total, creado, precios_verificados: true, replica: [parchePedido(ped.id), ...parcheCliente(p.cliente_id)] }
}

const HANDLERS = {
  "pedido.crear": (u, p, m) => aplicarPedido({ ...p, pedido_id: null }, m.capturado_at),
  "pedido.editar": (u, p, m) => aplicarPedido(p, m.capturado_at),
  "pedido.eliminar": (u, p) => {
    const ped = S.pedidos.find((x) => x.id === p.pedido_id)
    if (ped && ped.estado !== "eliminado") { if (!EDITABLES.includes(ped.estado)) throw new Rechazo(`El pedido ya está ${ped.estado} y no se puede eliminar.`); ped.estado = "eliminado" }
    return { replica: [parchePedido(p.pedido_id), ...(ped ? parcheCliente(ped.cliente_id) : [])] }
  },
  "cliente.crear": (u, p) => {
    if (!clienteDe(p.id)) {
      const dup = p.cuit && S.clientes.find((c) => c.cuit === String(p.cuit).trim())
      if (dup) throw new Rechazo(`Ya existe un cliente con ese CUIT: ${dup.nombre}. Buscalo en tu cartera o pedile a oficina que te lo asigne.`)
      const nombre = String(p.nombre || p.razon_social).trim()
      const lista = S.f.ficha.listas_precio.find((l) => l.id === p.lista_precio_id)
      S.clientes.push({ id: p.id, nombre, razon_social: p.razon_social || null, cuit: p.cuit || null, codigo_cliente: null, direccion: p.direccion || null, localidad: p.localidad || null, localidad_id: p.localidad_id || null, provincia: null, telefono: p.telefono || null, mail: p.mail || null, condicion_iva: p.condicion_iva || null, condicion_pago: p.condicion_pago || null, condicion_entrega: p.condicion_entrega || null, metodo_facturacion: p.metodo_facturacion || null, vendedor_id: S.f.vendedor.id, lista_precio_id: p.lista_precio_id || null, lista: lista ? { nombre: lista.nombre } : null, saldo_actual: 0, saldo_proyectado: 0, pagos_sin_rendir: 0, bonificaciones: { viajante: {}, mercaderia: {} } })
      S.cc.set(p.id, { comprobantes: [], pagos: [], devoluciones: [], comprados: [], habituales: [] })
      S.f.precios_clientes.push({ id: p.id, cliente: { id: p.id, vendedor_id: S.f.vendedor.id, metodo_facturacion: p.metodo_facturacion || null, lista_precio_id: p.lista_precio_id || null }, condicionesProveedor: [], condicionesMarca: [], bonificaciones: [] })
    }
    return { cliente_id: p.id, replica: parcheCliente(p.id) }
  },
  "cliente.editar": (u, p) => {
    const c = clienteDe(p.cliente_id)
    if (!c) throw new Rechazo("El cliente ya no existe o no está asignado a vos.")
    const igual = (a, b) => String(a ?? "").trim() === String(b ?? "").trim()
    const pisados = []
    for (const [campo, v] of Object.entries(p.cambios)) {
      if (igual(c[campo], v.despues)) continue
      if (igual(c[campo], v.antes)) c[campo] = v.despues
      else pisados.push(campo)
    }
    const pc = S.f.precios_clientes.find((x) => x.id === c.id)
    if (pc) Object.assign(pc.cliente, { metodo_facturacion: c.metodo_facturacion, lista_precio_id: c.lista_precio_id })
    c.lista = S.f.ficha.listas_precio.find((l) => l.id === c.lista_precio_id) ? { nombre: S.f.ficha.listas_precio.find((l) => l.id === c.lista_precio_id).nombre } : null
    if (pisados.length) throw new Rechazo(`Otra persona cambió ${pisados.join(", ")} mientras estabas sin señal: esos campos no se modificaron. Revisá la ficha.`)
    return { replica: parcheCliente(c.id) }
  },
  "cliente.bonificaciones": (u, p) => {
    const c = clienteDe(p.cliente_id)
    if (!c) throw new Rechazo("El cliente ya no existe.")
    c.bonificaciones = { viajante: { ...c.bonificaciones.viajante, ...p.viajante }, mercaderia: { ...c.bonificaciones.mercaderia, ...p.mercaderia } }
    const pc = S.f.precios_clientes.find((x) => x.id === c.id)
    if (pc) pc.bonificaciones = [...pc.bonificaciones.filter((b) => b.tipo !== "viajante"), ...Object.entries(c.bonificaciones.viajante).filter(([, v]) => v > 0).map(([segmento, porcentaje]) => ({ tipo: "viajante", segmento, porcentaje }))]
    return { replica: parcheCliente(c.id) }
  },
  "cobro.registrar": (u, p, m) => {
    if (RECHAZAR_COBROS) throw new Rechazo("el comprobante 0001-00001072 está anulado — no se puede cobrar")
    const totalMetodos = r2(p.metodos.reduce((s, x) => s + Number(x.monto || 0), 0))
    if (totalMetodos <= 0) throw new Rechazo("El cobro no tiene importe.")
    const suma = (l) => (l || []).reduce((s, x) => s + Number(x.monto || 0), 0)
    const esperado = r2(p.clientes.reduce((s, c) => s + suma(c.imputaciones) + suma(c.pedidos) + Number(c.pago_a_cuenta || 0) - Number(c.bonificacion_proyectada || 0) - Number(c.ajuste_redondeo || 0) - suma(c.creditos) - suma(c.devoluciones), 0))
    if (Math.abs(totalMetodos - esperado) > 0.01) throw new Rechazo(`Los métodos de pago ($${totalMetodos}) no coinciden con lo imputado ($${esperado})`)
    const pagos = []
    for (const c of p.clientes) {
      const cli = clienteDe(c.cliente_id), k = S.cc.get(c.cliente_id)
      if (!cli || !k) throw new Rechazo("Cliente inexistente")
      for (const i of c.imputaciones || []) { const comp = k.comprobantes.find((x) => x.id === i.comprobante_id); if (!comp) throw new Rechazo("Comprobante inexistente"); comp.en_cobro = r2(comp.en_cobro + Number(i.monto)) }
      for (const x of c.pedidos || []) { const ped = S.pedidos.find((q) => q.id === x.pedido_id); if (ped) { ped.anticipo_pago_id = m.idempotency_key; ped.pago_contado_10 = !!x.contado } }
      for (const d of c.devoluciones || []) { const dev = k.devoluciones.find((x) => x.id === d.devolucion_id); if (dev) dev.restante = Math.max(0, r2(dev.restante - Number(d.monto))) }
      const efectivo = r2(p.metodos.filter((x) => x.tipo === "efectivo").reduce((s, x) => s + Number(x.monto), 0))
      const pago = { id: randomUUID(), fecha_pago: hoy(), monto: totalMetodos, efectivo, estado: "pendiente_rendicion", forma_pago: [...new Set(p.metodos.map((x) => x.tipo))].join(" + "), verificado: false, eliminable: true, cliente_nombre: cli.nombre, imputaciones: c.imputaciones || [] }
      k.pagos.unshift(pago)
      cli.pagos_sin_rendir++
      cli.saldo_proyectado = r2(cli.saldo_proyectado - (suma(c.imputaciones) + suma(c.pedidos) + Number(c.pago_a_cuenta || 0) - suma(c.creditos) - suma(c.devoluciones)))
      pagos.push({ pago_id: pago.id, cliente_id: cli.id, monto: totalMetodos, estado: "pendiente_rendicion" })
    }
    return { success: true, pagos, replica: p.clientes.flatMap((c) => parcheCliente(c.cliente_id)) }
  },
  // Consulta BCRA en segundo plano (lib/mobile/outbox/bcra.ts). /__mock/bcra?modo=apto|riesgo|caido
  "bcra.consultar": (u, p) => {
    const cheque = { banco: p.banco ?? null, numero_cheque: p.numero_cheque ?? null, monto: p.monto ?? null, cliente_nombre: p.cliente_nombre ?? null }
    const consultado_at = new Date().toISOString()
    if (MODO_BCRA === "caido") return { veredicto: "sin_respuesta", titulo: "⚠️ No se pudo consultar el BCRA — verificá el cheque a mano", detalle: ["El BCRA no respondió a tiempo"], mismoBanco: false, cheque, consultado_at }
    if (MODO_BCRA === "riesgo") return { veredicto: "riesgo", titulo: "⛔ BCRA: Situación 3 — riesgo medio — evaluá si aceptás el cheque", detalle: [`DEMO SA (${(p.cuits[0] || "").replace(/D/g, "")}): Situación 3 — riesgo medio`, `🚨 La deuda (situación 3) es en BANCO MACRO S.A., el MISMO banco que emitió el cheque.`], mismoBanco: true, cheque, consultado_at }
    return { veredicto: "apto", titulo: "✅ BCRA: se puede aceptar — sin antecedentes", detalle: [], mismoBanco: false, cheque, consultado_at }
  },
  "cobro.anular": (u, p) => {
    const k = S.cc.get(p.cliente_id), cli = clienteDe(p.cliente_id)
    const pago = k?.pagos.find((x) => x.id === p.pago_id)
    if (pago && pago.estado !== "anulado") {
      if (pago.estado !== "pendiente_rendicion") throw new Rechazo("El cobro ya fue rendido: no se puede eliminar.")
      pago.estado = "anulado"; pago.eliminable = false
      for (const i of pago.imputaciones) { const comp = k.comprobantes.find((x) => x.id === i.comprobante_id); if (comp) comp.en_cobro = Math.max(0, r2(comp.en_cobro - Number(i.monto))) }
      cli.pagos_sin_rendir = Math.max(0, cli.pagos_sin_rendir - 1)
      cli.saldo_proyectado = r2(cli.saldo_proyectado + pago.imputaciones.reduce((s, i) => s + Number(i.monto), 0))
    }
    return { replica: parcheCliente(p.cliente_id) }
  },
  "devolucion.registrar": (u, p) => {
    const k = S.cc.get(p.cliente_id)
    if (!k) throw new Rechazo("Cliente inexistente")
    let d = k.devoluciones.find((x) => x.id === p.id)
    if (!d) {
      const total = r2(p.items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_venta_original), 0))
      d = { id: p.id, numero_devolucion: `DEV-${String(k.devoluciones.length + 43).padStart(5, "0")}`, pedido_id: p.pedido_id || null, monto_total: total, restante: total, created_at: new Date().toISOString(), altas: 0 }
      k.devoluciones.unshift(d)
    }
    d.altas = (d.altas || 0) + 1
    return { devolucion_id: d.id, numero_devolucion: d.numero_devolucion, replica: parcheCliente(p.cliente_id) }
  },
  "viaje.crear": (u, p) => {
    if (!S.viajes.find((v) => v.id === p.id)) {
      const zonas = S.f.zonas.filter((z) => p.zona_ids.includes(z.id)).map(({ id, nombre }) => ({ id, nombre }))
      if (zonas.length !== p.zona_ids.length) throw new Rechazo("Alguna de las zonas no existe.")
      S.viajes.unshift({ id: p.id, nombre: p.nombre || `Levantamiento ${zonas.map((z) => z.nombre).join(" + ")} · ${p.fecha_inicio}`, estado: "en_curso", fecha_inicio: p.fecha_inicio, fecha_fin_estimada: p.fecha_fin_estimada || null, zonas, cliente_ids: S.clientes.slice(0, 12).map((c) => c.id), no_va: new Set() })
    }
    return { viaje_id: p.id, replica: [parcheViaje(p.id)] }
  },
  "viaje.cliente_no_va": (u, p) => { const v = S.viajes.find((x) => x.id === p.viaje_id); if (!v) throw new Rechazo("Viaje inexistente o no asignado a vos."); if (p.no_va) v.no_va.add(p.cliente_id); else v.no_va.delete(p.cliente_id); return { replica: [parcheViaje(v.id)] } },
  "viaje.estado": (u, p) => { const v = S.viajes.find((x) => x.id === p.viaje_id); if (!v) throw new Rechazo("Viaje inexistente o no asignado a vos."); v.estado = p.estado; return { replica: [parcheViaje(v.id)] } },
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
  return { access_token: t, refresh_token: t, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: u.id, email, nombre: u.nombre }, roles: ["vendedor"] }
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x")
  const cors = { "Access-Control-Allow-Origin": req.headers.origin || "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Device-Id, X-App-Version", "Access-Control-Max-Age": "86400" }
  const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors }); res.end(JSON.stringify(body)) }
  let raw = ""
  for await (const ch of req) raw += ch
  const body = raw && (req.headers["content-type"] || "").includes("json") ? JSON.parse(raw) : null

  if (url.pathname.startsWith("/__mock/")) {
    if (url.pathname === "/__mock/red") S.red = url.searchParams.get("on") !== "0"
    if (url.pathname === "/__mock/reset") reset()
    if (url.pathname === "/__mock/rechazar-cobros") RECHAZAR_COBROS = url.searchParams.get("on") !== "0"
    if (url.pathname === "/__mock/bcra") MODO_BCRA = url.searchParams.get("modo") || "apto"
    if (url.pathname === "/__mock/ocr") MODO_OCR = url.searchParams.get("modo") || "ok"
    if (url.pathname === "/__mock/precio") {
      const a = S.f.precios_articulos.find((x) => x.sku === url.searchParams.get("sku"))
      if (a) { a.precio_base = Number(url.searchParams.get("base")); S.seq++ }
    }
    if (url.pathname === "/__mock/estado-pedido") { const p = S.pedidos.find((x) => x.numero_pedido === url.searchParams.get("numero")); if (p) { p.estado = url.searchParams.get("estado"); S.seq++ } }
    return json(200, {
      red: S.red, seq: S.seq,
      pedidos: S.pedidos.map((p) => ({ numero: p.numero_pedido, local_id: p.local_id, estado: p.estado, cliente: clienteDe(p.cliente_id)?.nombre, total: p.total, creaciones: p.creaciones, precios_garantizados: p.precios_garantizados, precios_al: p.precios_al, capturado_at: p.capturado_at, renglones: p.detalle.map((d) => `${d.cantidad} x ${d.precio_final}`) })),
      cobros: [...S.cc.entries()].flatMap(([cid, k]) => k.pagos.map((p) => ({ cliente: clienteDe(cid)?.nombre, monto: p.monto, estado: p.estado, forma: p.forma_pago }))),
      devoluciones: [...S.cc.values()].flatMap((k) => k.devoluciones.map((d) => ({ numero: d.numero_devolucion, total: d.monto_total, restante: d.restante, altas: d.altas }))),
      viajes: S.viajes.map((v) => ({ nombre: v.nombre, estado: v.estado, no_va: [...v.no_va].length })),
      clientes_nuevos: S.clientes.length - FIX.clientes.length,
      claves: [...S.claves.values()].map((c) => ({ tipo: c.tipo, estado: c.body.estado, aplicaciones: c.aplicaciones, recibidas: c.recibidas })),
      ultimasOperaciones: S.log.slice(-20),
    })
  }
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end() }
  if (!S.red) return req.socket.destroy() // sin señal: la app ve un error de red

  if (url.pathname === "/api/mobile/auth/login") return body?.email && body?.password ? json(200, sesion(String(body.email).toLowerCase())) : json(400, { error: "Faltan datos de ingreso." })
  if (url.pathname === "/api/mobile/auth/refresh") { const u = usuarioDe(body?.refresh_token); return u ? json(200, sesion(u.email)) : json(401, { error: "La sesión expiró." }) }
  if (url.pathname === "/api/mobile/auth/logout") return json(200, { ok: true })

  const u = usuarioDe((req.headers.authorization || "").replace(/^Bearer /, ""))
  if (!u) return json(401, { error: "No autorizado." })

  if (url.pathname === "/api/mobile/sync/estado") return json(200, { server_time: new Date().toISOString(), cambios_seq: String(S.seq), protocolo: 1 })
  const ds = /^\/api\/mobile\/sync\/(.+)$/.exec(url.pathname)?.[1]
  if (ds) {
    if (!DATASETS[ds]) return json(404, { error: `Dataset desconocido: ${ds}` })
    const filas = DATASETS[ds](u).filter(Boolean)
    const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean)
    if (ids.length) {
      if (!PARCIALES.has(ds)) return json(400, { error: "Este dataset no admite refresco parcial." })
      const upserts = filas.filter((f) => ids.includes(f.id))
      return json(200, { dataset: ds, generado_at: new Date().toISOString(), upserts, deletes: ids.filter((id) => !upserts.some((f) => f.id === id)) })
    }
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
    try { out = { estado: "aplicado", resultado: h(u, m.payload, m) }; S.seq++ } catch (e) {
      if (!(e instanceof Rechazo)) { console.error(e); return json(503, { error: "Error transitorio" }) }
      status = 422; out = { estado: "rechazado", error: e.message }
    }
    S.claves.set(m.idempotency_key, { hash, status, body: out, aplicaciones: 1, recibidas: 1, tipo: m.tipo })
    S.log.push(`${u.nombre} ${m.tipo} → ${out.estado}${out.error ? `: ${out.error}` : ""}`)
    return json(status, out)
  }
  // Foto de cheque: la app crea la fila al instante y llama acá en segundo plano. /__mock/ocr?modo=ok|lento|caido|sin_datos
  if (url.pathname === "/api/pagos-clientes/ocr") {
    if (MODO_OCR === "caido") return json(500, { error: "GEMINI_API_KEY no configurado" })
    await new Promise((r) => setTimeout(r, MODO_OCR === "lento" ? 8000 : 1500))
    const foto = { url: "https://placehold.co/640x300/e2e8f0/475569.png?text=Cheque+(mock)", nombre: "cheque.jpg" }
    if (MODO_OCR === "sin_datos") return json(200, { success: true, resultados: [], total_encontrados: 0, archivos: [foto], archivos_por_indice: [foto], saneados: [], errores: ["cheque.jpg: no se detectaron datos"] })
    const venc = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    const cheque = { tipo: "cheque", monto: 150000, banco: "Banco Macro", numero_cheque: "00098765", fecha_cheque: venc, cuit_emisor: "20-12345678-6", cuits_titulares: ["20-12345678-6"] }
    return json(200, { success: true, resultados: [{ ...cheque, banco_emisor: cheque.banco, archivo_index: 0 }], total_encontrados: 1, archivos: [foto], archivos_por_indice: [foto], saneados: [{ ...cheque, archivo_index: 0 }] })
  }
  // Online-only
  if (url.pathname === "/api/viajante/rendir") return json(201, { success: true, rendicion_id: randomUUID(), estado: "abierta", efectivo_declarado: body?.efectivo_declarado ?? 0, efectivo_registrado: 0, diferencia: 0, cantidad_pagos: (body?.pago_ids || []).length })
  if (url.pathname.startsWith("/api/bcra/deudor/")) return json(200, { cuit: url.pathname.split("/").pop(), denominacion: "DEMO SA", situacion_max: 1, sin_antecedentes: true, apto: true, entidades: [] })
  json(404, { error: "No existe en el mock" })
}).listen(PUERTO, () => console.log(`Mock del ERP para la app Vendedor en http://localhost:${PUERTO} · ${FIX.articulos.length} artículos · ${FIX.clientes.length} clientes ${existsSync(RUTA_FIXTURE) ? "(fixture real)" : "(sintético: corré fixture-vendedor.mjs para el catálogo real)"}`))
