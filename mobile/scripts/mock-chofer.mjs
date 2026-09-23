#!/usr/bin/env node
// Servidor FALSO del ERP para probar la app Chofer sin backend ni usuario real:
//
//   cd mobile && node scripts/mock-chofer.mjs         (puerto 3997)
//   apps/chofer/.env.development.local → VITE_API_BASE=http://localhost:3997
//   npm run dev:chofer → http://localhost:5173  (cualquier email; contraseña "x")
//
// Implementa el protocolo de MOBILE.md §4 (auth, sync snapshot con hash, refresco
// parcial ?ids=, outbox con idempotencia real) y, en memoria, las reglas de las 7
// operaciones del chofer (lib/mobile/outbox/chofer.ts): inicio del viaje, resultado de
// parada (con "cobrar sí o sí"), cobro (imputaciones, anticipos, 10 %, ajuste con tope,
// clientes extra, fotos pendientes), anulación, devolución (dedupe por id), gasto y
// cierre del viaje (rechaza con paradas sin resolver).
//
//   GET  /__mock/estado                 volcado + contador de aplicaciones por clave
//   POST /__mock/red?on=0|1             simula quedarse sin señal (corta la conexión)
//   POST /__mock/bcra?modo=apto|riesgo|caido
//   POST /__mock/ocr?modo=ok|lento|caido|sin_datos|sin_cuit
//   POST /__mock/rechazar-cobros?on=1   la RPC rechaza el próximo cobro (regla de negocio)
//   POST /__mock/anular-cobro?id=<pago> oficina confirmó ese cobro (ya no se puede anular)
//   POST /__mock/reset

import { createHash, randomUUID } from "node:crypto"
import { createServer } from "node:http"

const PUERTO = Number(process.env.PORT || 3997)
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const r2 = (n) => Math.round(n * 100) / 100
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
const ahora = () => new Date().toISOString()
class Rechazo extends Error {}

// ─── Fixture sintético ───────────────────────────────────────────────────────

function fixture() {
  const articulos = []
  const provs = ["Kenvue", "Algabo", "Unilever", "Clorox"]
  for (let i = 1; i <= 300; i++) {
    const tipo = ["Shampoo", "Jabón", "Desodorante", "Lavandina"][i % 4]
    articulos.push({ id: uid(i), sku: String(100000 + i), ean13: [String(7790000000000 + i)], descripcion: `${tipo} ${provs[i % 4]} ${200 + (i % 5) * 50}ml #${i}`, unidades_por_bulto: [6, 12, 24][i % 3], imagen_url: null, marca: provs[i % 4], proveedor: provs[i % 4], stock_disponible: 10, descuento_propio: 0, iva_ventas: "factura", rubro_id: null, categoria_id: null, subcategoria_id: null, rubro_nombre: null, categoria_nombre: null, subcategoria_nombre: null, proveedor_id: null, marca_id: null, codigo_bulto: null, sigla: null, created_at: "2026-01-01T00:00:00Z" })
  }
  const nombres = ["Almacén Don José", "Supermercado El Sol", "Kiosco La Esquina", "Perfumería Belgrano", "Autoservicio Lucía", "Despensa Los Pinos", "Farmacia Central", "Minimercado 24", "Almacén La Plaza", "Kiosco Mitre"]
  const clientes = []
  for (let k = 0; k < 40; k++) {
    const nombre = k < nombres.length ? nombres[k] : `Cliente ${k + 1} SRL`
    clientes.push({ id: uid(7000 + k), nombre, razon_social: nombre, nombre_razon_social: null, cuit: `30-7000${String(k).padStart(4, "0")}-1`, codigo_cliente: `C${k}`, direccion: `Belgrano ${100 + k * 7}`, telefono: k % 3 ? `2262-4${String(10000 + k)}` : null, localidad: k % 2 ? "Necochea" : "Quequén", saldo_actual: 0, condicion_pago: "Cuenta corriente" })
  }
  return { articulos, clientes }
}

let S
function reset() {
  const f = fixture()
  const viajeId = uid(5001), historicoId = uid(5002)
  const chofer = uid(9001)
  S = {
    seq: 1, f, red: true, claves: new Map(), log: [],
    viajes: [
      { id: viajeId, nombre: "Reparto NECOCHEA 23/09", fecha: hoy(), estado: "despachado", chofer_id: chofer, zona: "NECOCHEA", iniciado_at: null, finalizado_at: null },
      { id: historicoId, nombre: "Reparto QUEQUÉN 16/09", fecha: "2026-09-16", estado: "completado", chofer_id: chofer, zona: "QUEQUÉN", iniciado_at: "2026-09-16T08:00:00Z", finalizado_at: "2026-09-16T18:00:00Z" },
    ],
    paradas: [], pedidos: [], comprobantes: [], pagos: [], devoluciones: [], gastos: [], fondos: [{ id: uid(6001), viaje_id: viajeId, monto: 50000, created_at: ahora() }],
    remitos: [], numeroDev: 42, rendiciones: [],
  }
  // 6 paradas del viaje activo: pedidos facturados (con FA) salvo la 3 (sin facturar), saldos anteriores en 2 y 4
  for (let i = 0; i < 6; i++) {
    const c = f.clientes[i]
    const pedidoId = uid(3000 + i)
    const detalle = [0, 1, 2].map((j) => {
      const a = f.articulos[(i * 7 + j * 3) % f.articulos.length]
      const cantidad = 2 + j, precio = 1000 + ((i * 3 + j) % 9) * 250
      return { id: uid(3100 + i * 10 + j), articulo_id: a.id, cantidad, precio_final: precio, subtotal: r2(cantidad * precio), es_bonificado: false }
    })
    const total = r2(detalle.reduce((s, d) => s + d.subtotal, 0))
    S.pedidos.push({ id: pedidoId, numero_pedido: String(1700 + i).padStart(6, "0"), fecha: hoy(), estado: "en_viaje", total, bultos: 3 + i, cliente_id: c.id, viaje_id: viajeId, observaciones: null, detalle, pago_contado_10: false, anticipo_pago_id: null })
    if (i !== 2) {
      S.comprobantes.push({ id: uid(4000 + i), cliente_id: c.id, pedido_id: pedidoId, tipo_comprobante: "FA", numero_comprobante: `0003-${String(5000 + i).padStart(8, "0")}`, fecha: hoy(), total_neto: r2(total / 1.21), total_factura: total, saldo_pendiente: total, estado_pago: "pendiente", anulado_en: null })
      S.remitos.push({ id: uid(4500 + i), pedido_id: pedidoId, tipo_remito: "REM", numero_remito: `0001-${String(800 + i).padStart(8, "0")}`, estado_pdf: "generado" })
    }
    if (i === 1 || i === 3) {
      const viejo = r2(15000 + i * 1234.5)
      S.comprobantes.push({ id: uid(4100 + i), cliente_id: c.id, pedido_id: null, tipo_comprobante: "FA", numero_comprobante: `0003-${String(4000 + i).padStart(8, "0")}`, fecha: "2026-08-20", total_neto: r2(viejo / 1.21), total_factura: viejo, saldo_pendiente: viejo, estado_pago: "pendiente", anulado_en: null })
    }
    S.paradas.push({ id: uid(2000 + i), viaje_id: viajeId, cliente_id: c.id, orden: i + 1, exigir_cobro_anterior: i === 3, exigir_cobro_actual: i === 1, bloquear_entrega: i === 4, motivo_bloqueo: i === 4 ? "Debe 2 facturas" : null, nota_oficina: i === 0 ? "Entregar por el fondo, preguntar por Marta" : null, estado: "pendiente", bultos_entregados: null, motivo_no_entrega: null, motivo_no_cobro: null, resuelto_at: null })
  }
  // Un cobro ya registrado en el servidor (para probar la anulación de un cobro del servidor)
  S.pagos.push({ id: uid(8001), viaje_id: viajeId, cliente_id: f.clientes[5].id, monto: 5000, estado: "pendiente_rendicion", created_at: ahora(), creado_por: chofer, detalles: [{ tipo_pago: "efectivo", monto: 5000 }], imputaciones: [], observaciones: null, declarado: false })
  // Saldo de cada cliente = Σ saldos de sus comprobantes
  for (const c of f.clientes) c.saldo_actual = r2(S.comprobantes.filter((k) => k.cliente_id === c.id && !k.anulado_en).reduce((s, k) => s + k.saldo_pendiente, 0))
}
reset()

// ─── Vistas (= lib/viajes/hoja-ruta.ts y cliente-viaje.ts, simplificadas) ─────
const clienteDe = (id) => S.f.clientes.find((c) => c.id === id)
const viajeDe = (id) => S.viajes.find((v) => v.id === id)
const pagosVivos = (viajeId, clienteId) => S.pagos.filter((p) => p.viaje_id === viajeId && (!clienteId || p.cliente_id === clienteId) && ["pendiente_rendicion", "confirmado"].includes(p.estado))
const compsDe = (clienteId) => S.comprobantes.filter((k) => k.cliente_id === clienteId && !k.anulado_en)

function parada(pa) {
  const c = clienteDe(pa.cliente_id)
  const peds = S.pedidos.filter((p) => p.viaje_id === pa.viaje_id && p.cliente_id === pa.cliente_id && p.estado !== "eliminado")
  const pedidos = peds.map((p) => ({
    id: p.id, numero: p.numero_pedido, estado: p.estado, total: p.total, bultos: p.bultos, vendedor: "Vendedor Demo",
    comprobantes: S.comprobantes.filter((k) => k.pedido_id === p.id && !k.anulado_en).map((k) => ({ id: k.id, tipo: k.tipo_comprobante, numero: k.numero_comprobante, total: k.total_factura, saldo: k.saldo_pendiente })),
    remitos: S.remitos.filter((r) => r.pedido_id === p.id),
  }))
  const totalViaje = r2(pedidos.reduce((s, p) => s + (p.comprobantes.length ? p.comprobantes.reduce((x, k) => x + k.total, 0) : p.total), 0))
  const propio = pedidos.reduce((s, p) => s + p.comprobantes.reduce((x, k) => x + k.saldo, 0), 0)
  const saldoAnterior = r2(c.saldo_actual - propio)
  const pagos = pagosVivos(pa.viaje_id, pa.cliente_id).map((p) => ({
    id: p.id, monto: p.monto, estado: p.estado, fecha: p.created_at, cargado_por: "Chofer",
    metodos: p.detalles.map((d) => ({ tipo: d.tipo_pago, monto: d.monto, detalle: d.tipo_pago === "cheque" ? [d.banco, d.numero_cheque].filter(Boolean).join(" · ") : d.numero_comprobante_pago || "" })),
    imputaciones: p.imputaciones.map((i) => ({ comprobante: S.comprobantes.find((k) => k.id === i.comprobante_id)?.numero_comprobante || "comprobante", monto: i.monto_imputado, de_este_viaje: true })),
    a_cuenta: r2(Math.max(0, p.monto - p.imputaciones.reduce((s, i) => s + i.monto_imputado, 0))), contado_10: !!p.contado, ajuste: p.ajuste || 0,
  }))
  const cobrado = r2(pagos.reduce((s, p) => s + p.monto, 0))
  const devuelto = r2(S.devoluciones.filter((d) => d.viaje_id === pa.viaje_id && d.cliente_id === pa.cliente_id).reduce((s, d) => s + d.monto_total, 0))
  const minimo = r2((pa.exigir_cobro_anterior ? Math.max(saldoAnterior, 0) : 0) + (pa.exigir_cobro_actual ? totalViaje : 0))
  return {
    ...pa, cliente_nombre: c.nombre, direccion: c.direccion, localidad: c.localidad, telefono: c.telefono || "", vendedores: ["Vendedor Demo"],
    pedidos, bultos: pedidos.reduce((s, p) => s + p.bultos, 0), total_viaje: totalViaje, saldo_anterior: saldoAnterior, total_a_cobrar: r2(saldoAnterior + totalViaje),
    minimo_exigido: minimo, cobrado, cobrado_anterior: 0, cobrado_viaje: cobrado, devuelto, cobro_cumplido: cobrado + 0.01 >= minimo, pagos,
  }
}
function dinero(viajeId) {
  const dets = pagosVivos(viajeId).flatMap((p) => p.detalles)
  const suma = (tipos) => r2(dets.filter((d) => tipos.includes(d.tipo_pago)).reduce((s, d) => s + d.monto, 0))
  const fondo = r2(S.fondos.filter((f) => f.viaje_id === viajeId).reduce((s, f) => s + f.monto, 0))
  const gastos = S.gastos.filter((g) => g.viaje_id === viajeId)
  const gastosTotal = r2(gastos.reduce((s, g) => s + g.monto, 0))
  return {
    fondo_entregado: fondo, fondos: S.fondos.filter((f) => f.viaje_id === viajeId).map((f) => ({ id: f.id, monto: f.monto, origen: "CAJA", retirado_por: "Chofer", entregado_por: "Oficina", fecha: f.created_at })),
    gastos: gastos.map((g) => ({ id: g.id, categoria: g.categoria, monto: g.monto, observaciones: g.observaciones, estado: g.estado, cargado_por: "Chofer", foto_url: g.foto_url, fecha: g.created_at })),
    gastos_total: gastosTotal, cobrado_efectivo: suma(["efectivo"]), cobrado_cheques: suma(["cheque"]), cheques_cantidad: dets.filter((d) => d.tipo_pago === "cheque").length,
    cobrado_transferencias: suma(["transferencia", "deposito"]), efectivo_en_mano: r2(fondo + suma(["efectivo"]) - gastosTotal), saldo_billetera_titular: 0,
  }
}
const filaViaje = (v) => ({
  id: v.id,
  viaje: { id: v.id, nombre: v.nombre, fecha: v.fecha, estado: v.estado, zona_nombre: v.zona, es_titular: true, chofer_id: v.chofer_id, vehiculo: "CAMIÓN 1 · AB123CD" },
  paradas: S.paradas.filter((p) => p.viaje_id === v.id).sort((a, b) => a.orden - b.orden).map(parada),
  dinero: dinero(v.id),
  tripulacion: [{ usuario_id: v.chofer_id, nombre: "Chofer Demo", rol: "titular" }],
})
function filaCliente(viajeId, clienteId) {
  const v = viajeDe(viajeId), c = clienteDe(clienteId)
  if (!v || !c) return null
  const ped = S.pedidos.find((p) => p.viaje_id === viajeId && p.cliente_id === clienteId && p.estado !== "eliminado")
  const artDe = (id) => S.f.articulos.find((a) => a.id === id)
  const pend = compsDe(clienteId).filter((k) => k.saldo_pendiente > 0).map(({ id, tipo_comprobante, numero_comprobante, fecha, total_factura, saldo_pendiente }) => ({ id, tipo_comprobante, numero_comprobante, fecha, total_factura, saldo_pendiente }))
  const pagos = pagosVivos(viajeId, clienteId).map((p) => ({ id: p.id, monto: p.monto, estado: p.estado, created_at: p.created_at }))
  const devs = S.devoluciones.filter((d) => d.viaje_id === viajeId && d.cliente_id === clienteId).map((d) => ({ id: d.id, numero_devolucion: d.numero_devolucion, monto_total: d.monto_total, estado: d.estado, devoluciones_detalle: d.items.map((i, n) => ({ id: `${d.id}:${n}`, articulo_id: i.articulo_id, cantidad: i.cantidad, precio_venta_original: i.precio_venta_original, motivo: i.motivo, condicion: i.condicion, articulos: { sku: artDe(i.articulo_id)?.sku, descripcion: artDe(i.articulo_id)?.descripcion } })) }))
  const totalDev = r2(devs.reduce((s, d) => s + d.monto_total, 0)), totalCob = r2(pagos.reduce((s, p) => s + p.monto, 0))
  const pedidosCli = S.pedidos.filter((p) => p.cliente_id === clienteId && p.estado !== "eliminado")
  return {
    id: `${viajeId}:${clienteId}`, viaje_id: viajeId, cliente_id: clienteId,
    cliente: { nombre: c.nombre, razon_social: c.razon_social, direccion: c.direccion, telefono: c.telefono, cuit: c.cuit, condicion_pago: c.condicion_pago },
    pedido: ped ? { id: ped.id, numero: ped.numero_pedido, fecha: ped.fecha, estado: ped.estado, total: ped.total, bultos: ped.bultos, observaciones: ped.observaciones, detalle: ped.detalle.map((d) => ({ ...d, articulos: { sku: artDe(d.articulo_id)?.sku, descripcion: artDe(d.articulo_id)?.descripcion, unidades_por_bulto: artDe(d.articulo_id)?.unidades_por_bulto } })) } : null,
    comprobantes_pendientes: pend, devoluciones: devs, pagos_registrados: pagos,
    resumen: { saldo_anterior: c.saldo_actual, saldo_real: c.saldo_actual, saldo_proyectado: r2(c.saldo_actual - totalCob), pendiente_verificacion: totalCob, total_pedido: ped?.total || 0, total_devuelto: totalDev, total_cobrado: totalCob, total_a_cobrar: r2(c.saldo_actual + (ped?.total || 0) - totalDev), ya_cobrado: totalCob > 0 },
    viaje_estado: v.estado,
    cobro: {
      comprobantes: compsDe(clienteId).filter((k) => ["pendiente", "parcial"].includes(k.estado_pago)).map(({ id, tipo_comprobante, numero_comprobante, fecha, total_neto, total_factura, saldo_pendiente, estado_pago, pedido_id }) => ({ id, tipo_comprobante, numero_comprobante, fecha, total_neto, total_factura, saldo_pendiente, estado_pago, pedido_id })),
      pedidos: pedidosCli.map((p) => ({ id: p.id, numero_pedido: p.numero_pedido, fecha: p.fecha, total: p.total, estado: p.estado, pago_contado_10: p.pago_contado_10, anticipo_pago_id: p.anticipo_pago_id })),
      pedidos_facturados: [...new Set(S.comprobantes.filter((k) => k.cliente_id === clienteId && k.pedido_id).map((k) => k.pedido_id))],
      dtos_hechos: [],
    },
    comprados: S.f.articulos.slice(10, 16).map((a) => ({ articulo_id: a.id, sku: a.sku, ean13: a.ean13, descripcion: a.descripcion, imagen_url: null, unidades_por_bulto: a.unidades_por_bulto, ultimo_precio: 1234.5, ultima_fecha: "2026-08-20", comprobante_venta_id: uid(4900), numero_comprobante: "0003-00004900", tipo_comprobante: "FA", cantidad_total: 12 })),
  }
}
function billetera() {
  const vivos = new Set(S.viajes.filter((v) => ["programado", "despachado", "en_curso"].includes(v.estado)).map((v) => v.id))
  let efectivo = 0, chequesCant = 0, chequesMonto = 0, transf = 0, enRend = 0
  const cobros = S.pagos.filter((p) => ["pendiente_rendicion", "confirmado"].includes(p.estado)).map((p) => {
    const sinRendir = p.estado === "pendiente_rendicion"
    if (sinRendir && !p.declarado) for (const d of p.detalles) { if (d.tipo_pago === "efectivo") efectivo += d.monto; else if (d.tipo_pago === "cheque") { chequesCant++; chequesMonto += d.monto } else transf += d.monto }
    else if (sinRendir && p.declarado) enRend += p.monto
    return { id: p.id, fecha: p.created_at, cliente: clienteDe(p.cliente_id)?.nombre || "Cliente", viaje: viajeDe(p.viaje_id)?.nombre || "", monto: p.monto, metodos: [...new Set(p.detalles.map((d) => (d.tipo_pago === "cheque" ? `Cheque ${d.banco || ""} ${d.numero_cheque || ""}`.trim() : d.tipo_pago === "transferencia" ? "Transferencia" : "Efectivo")))], estado: p.estado === "confirmado" ? "rendido" : p.declarado ? "en_rendicion" : "en_mano" }
  })
  const fondo = r2(S.fondos.filter((f) => vivos.has(f.viaje_id)).reduce((s, f) => s + f.monto, 0))
  const gastos = r2(S.gastos.filter((g) => vivos.has(g.viaje_id)).reduce((s, g) => s + g.monto, 0))
  return {
    id: "billetera", efectivo: r2(efectivo + fondo - gastos),
    desglose: { cobros_efectivo: r2(efectivo), fondo_viaje: fondo, gastos, cheques_monto: r2(chequesMonto), transferencias: r2(transf), en_rendicion: r2(enRend) },
    cheques_cantidad: chequesCant, saldo_cuenta_corriente: 0, cobros,
    gastos: S.gastos.map((g) => ({ id: g.id, viaje: viajeDe(g.viaje_id)?.nombre || "", categoria: g.categoria, monto: g.monto, estado: g.estado, observaciones: g.observaciones, created_at: g.created_at })),
    fondos: S.fondos.map((f) => ({ id: f.id, viaje: viajeDe(f.viaje_id)?.nombre || "", monto: f.monto, created_at: f.created_at })),
  }
}
const me = (u) => {
  const activos = S.viajes.filter((v) => ["despachado", "en_curso"].includes(v.estado))
  const res = (v) => ({ id: v.id, nombre: v.nombre, fecha: v.fecha, estado: v.estado, zonas: { nombre: v.zona } })
  return { id: "me", usuario: { id: u.id, nombre: u.nombre, email: u.email }, viaje_activo: (activos.find((v) => v.estado === "en_curso") || activos[0] || null) && res(activos.find((v) => v.estado === "en_curso") || activos[0]), historial: S.viajes.filter((v) => ["completado", "en_rendicion"].includes(v.estado)).map(res) }
}
const DATASETS = {
  chofer_me: (u) => [me(u)],
  chofer_viajes: () => S.viajes.map(filaViaje),
  chofer_viaje_clientes: () => S.paradas.filter((p) => ["despachado", "en_curso", "en_rendicion"].includes(viajeDe(p.viaje_id)?.estado)).map((p) => filaCliente(p.viaje_id, p.cliente_id)),
  chofer_billetera: () => [billetera()],
  chofer_clientes: () => S.f.clientes.map(({ id, nombre, razon_social, nombre_razon_social, cuit, codigo_cliente, direccion, localidad, saldo_actual }) => ({ id, nombre, razon_social, nombre_razon_social, cuit, codigo_cliente, direccion, localidad, saldo_actual })),
  chofer_articulos: () => S.f.articulos,
  chofer_catalogos: () => [{ id: "cuentas", cuentas: [{ id: uid(601), banco: "Banco Nación", nombre: "Cta. Cte. GM", alias: "gm.nacion" }] }],
}
const PARCIALES = new Set(["chofer_viajes", "chofer_viaje_clientes"])

// ─── Operaciones ─────────────────────────────────────────────────────────────
let MODO_BCRA = "apto", MODO_OCR = "ok", RECHAZAR_COBROS = false
const parcheViaje = (id) => { const v = viajeDe(id); return { dataset: "chofer_viajes", upserts: v ? [filaViaje(v)] : [], deletes: v ? [] : [id] } }
const parcheClientes = (viajeId, ids) => ({ dataset: "chofer_viaje_clientes", upserts: ids.filter((c) => S.paradas.some((p) => p.viaje_id === viajeId && p.cliente_id === c)).map((c) => filaCliente(viajeId, c)), deletes: [] })
const parcheBilletera = () => ({ dataset: "chofer_billetera", upserts: [billetera()], deletes: [] })
const parcheMe = (u) => ({ dataset: "chofer_me", upserts: [me(u)], deletes: [] })
const tripulante = (viajeId) => { const v = viajeDe(viajeId); if (!v) throw new Rechazo("El viaje ya no existe."); return v }

const HANDLERS = {
  "viaje.iniciar": (u, p) => { const v = tripulante(p.viaje_id); if (v.estado === "despachado") { v.estado = "en_curso"; v.iniciado_at = ahora() } return { replica: [parcheViaje(v.id), parcheMe(u)] } },
  "viaje.parada": (u, p) => {
    const v = tripulante(p.viaje_id)
    if (!["despachado", "en_curso"].includes(v.estado)) throw new Rechazo("El viaje no está en curso")
    const pa = S.paradas.find((x) => x.id === p.parada_id && x.viaje_id === v.id)
    if (!pa) throw new Rechazo("Parada no encontrada")
    if (p.estado === "pendiente") { Object.assign(pa, { estado: "pendiente", bultos_entregados: null, motivo_no_entrega: null, motivo_no_cobro: null, resuelto_at: null }); return { replica: [parcheViaje(v.id)] } }
    const calc = parada(pa)
    const mE = String(p.motivo_no_entrega || "").trim(), mC = String(p.motivo_no_cobro || "").trim()
    if (["no_entregado", "entregado_parcial"].includes(p.estado) && !mE) throw new Rechazo("Contá por qué no se entregó todo")
    if (p.estado === "solo_cobro" && calc.pedidos.length) throw new Rechazo("Esta parada tiene mercadería para entregar")
    if (!calc.cobro_cumplido && !mC) throw new Rechazo(`Oficina pidió cobrar sí o sí $${calc.minimo_exigido} y hay cobrado $${calc.cobrado}: contá por qué no se cobró`)
    const bultos = p.estado === "entregado" ? calc.bultos : p.estado === "entregado_parcial" ? Math.max(0, Math.min(calc.bultos, Number(p.bultos_entregados) || 0)) : p.estado === "no_entregado" ? 0 : null
    Object.assign(pa, { estado: p.estado, bultos_entregados: bultos, motivo_no_entrega: mE || null, motivo_no_cobro: calc.cobro_cumplido ? null : mC, resuelto_at: ahora() })
    return { replica: [parcheViaje(v.id)] }
  },
  "viaje.cobrar": (u, p, m) => {
    const v = tripulante(p.viaje_id)
    if (!["despachado", "en_curso", "en_rendicion"].includes(v.estado)) throw new Rechazo("El viaje no está activo")
    if (RECHAZAR_COBROS) { RECHAZAR_COBROS = false; throw new Rechazo("cobranza_crear: el comprobante 0003-00005001 está anulado — no se puede cobrar") }
    const monto = r2(Number(p.monto_total))
    const imps = (p.imputaciones || []).filter((i) => i.comprobante_id).map((i) => ({ comprobante_id: i.comprobante_id, monto_imputado: r2(Number(i.monto_imputado)) }))
    const ajuste = r2(Number(p.ajuste_redondeo || 0))
    if (Math.abs(ajuste) > 0.005) { const tope = r2(imps.reduce((s, i) => s + i.monto_imputado, 0) * 0.01); if (Math.abs(ajuste) > tope + 0.005) throw new Rechazo(`El ajuste (${Math.abs(ajuste).toFixed(2)}) supera el tope del 1% de los comprobantes seleccionados (${tope.toFixed(2)}). Dejá el saldo pendiente: lo resuelve la oficina.`) }
    // Recorte: Σ imputaciones ≤ monto (secuencial)
    let resta = monto
    const recortadas = []
    for (const i of imps) { const x = Math.min(i.monto_imputado, resta); if (x > 0.005) { recortadas.push({ ...i, monto_imputado: r2(x) }); resta = r2(resta - x) } }
    for (const i of recortadas) { const k = S.comprobantes.find((c) => c.id === i.comprobante_id); if (!k) throw new Rechazo("cobranza_crear: comprobante inexistente"); if (k.anulado_en) throw new Rechazo(`cobranza_crear: el comprobante ${k.numero_comprobante} está anulado — no se puede cobrar`) }
    const pago = { id: randomUUID(), viaje_id: v.id, cliente_id: p.cliente_id, monto, estado: "pendiente_rendicion", created_at: ahora(), creado_por: u.id, detalles: (p.metodos || []).map((x) => ({ tipo_pago: x.tipo, monto: r2(Number(x.monto)), banco: x.banco_emisor || null, numero_cheque: x.numero_cheque || null, numero_comprobante_pago: x.numero_comprobante || null })), imputaciones: recortadas, contado: !!p.contado_general, ajuste, fotos: [...(p.comprobante_urls || []).map((c) => c.url), ...(p.fotos_pendientes || []).map(() => "https://placehold.co/640x300/e2e8f0/475569.png?text=Foto+pendiente+(mock)")], declarado: false }
    S.pagos.push(pago)
    for (const i of recortadas) { const k = S.comprobantes.find((c) => c.id === i.comprobante_id); k.saldo_pendiente = r2(k.saldo_pendiente - i.monto_imputado); k.estado_pago = k.saldo_pendiente <= 0.009 ? "pagado" : "parcial" }
    for (const pid of p.pedidos_contado || []) { const ped = S.pedidos.find((x) => x.id === pid); if (ped) { ped.pago_contado_10 = true; ped.anticipo_pago_id = pago.id } }
    for (const did of p.devolucion_ids || []) { const d = S.devoluciones.find((x) => x.id === did); if (d) d.descontada = true }
    const extras = []
    for (const ex of p.cobros_extra || []) {
      if (!ex?.cliente_id || !ex?.metodos?.length) continue
      const mx = r2(ex.metodos.reduce((s, x) => s + Number(x.monto), 0))
      S.pagos.push({ id: randomUUID(), viaje_id: v.id, cliente_id: ex.cliente_id, monto: mx, estado: "pendiente_rendicion", created_at: ahora(), creado_por: u.id, detalles: ex.metodos.map((x) => ({ tipo_pago: x.tipo, monto: r2(Number(x.monto)) })), imputaciones: [], declarado: false })
      extras.push(ex.cliente_id)
    }
    // Saldo real del cliente NO baja hasta que oficina confirma (= libro mayor); el proyectado sí
    return { success: true, pago_id: pago.id, estado: "pendiente_rendicion", replica: [parcheViaje(v.id), parcheClientes(v.id, [p.cliente_id, ...extras]), parcheBilletera()] }
  },
  "viaje.cobro_anular": (u, p) => {
    const v = tripulante(p.viaje_id)
    const pago = S.pagos.find((x) => x.id === p.pago_id)
    if (pago && pago.estado !== "anulado") {
      if (pago.viaje_id !== v.id) throw new Rechazo("Pago no encontrado en este viaje")
      if (pago.estado !== "pendiente_rendicion") throw new Rechazo(`El cobro ya fue ${pago.estado === "confirmado" ? "rendido y confirmado" : pago.estado} — no se puede eliminar`)
      pago.estado = "anulado"
      for (const i of pago.imputaciones) { const k = S.comprobantes.find((c) => c.id === i.comprobante_id); if (k) { k.saldo_pendiente = r2(k.saldo_pendiente + i.monto_imputado); k.estado_pago = k.saldo_pendiente >= k.total_factura - 0.009 ? "pendiente" : "parcial" } }
      for (const ped of S.pedidos) if (ped.anticipo_pago_id === pago.id) { ped.anticipo_pago_id = null; ped.pago_contado_10 = false }
    }
    return { success: true, replica: [parcheViaje(v.id), parcheClientes(v.id, [p.cliente_id]), parcheBilletera()] }
  },
  "viaje.devolucion": (u, p) => {
    const v = tripulante(p.viaje_id)
    let d = S.devoluciones.find((x) => x.id === p.id)
    if (!d) {
      if (!["despachado", "en_curso"].includes(v.estado)) throw new Rechazo("El viaje no está activo")
      const total = r2(p.items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precio_venta_original), 0))
      d = { id: p.id, numero_devolucion: `DEV-${String(++S.numeroDev).padStart(5, "0")}`, viaje_id: v.id, cliente_id: p.cliente_id, pedido_id: p.pedido_id || null, items: p.items, monto_total: total, estado: "pendiente", altas: 0 }
      S.devoluciones.push(d)
    }
    d.altas++
    return { success: true, devolucion_id: d.id, numero_devolucion: d.numero_devolucion, monto_total: d.monto_total, replica: [parcheViaje(v.id), parcheClientes(v.id, [p.cliente_id])] }
  },
  "viaje.gasto": (u, p, m) => {
    const cat = ["nafta", "hotel", "peon", "cubierta", "peaje", "comida", "otro"].includes(p.categoria) ? p.categoria : "otro"
    if (p.viaje_id) {
      const v = tripulante(p.viaje_id)
      if (!["despachado", "en_curso", "en_rendicion"].includes(v.estado)) throw new Rechazo(`viaje_gasto_registrar: el viaje está ${v.estado}`)
      // = RPC viaje_gasto_registrar: idempotente por clave
      let g = S.gastos.find((x) => x.idempotency_key === m.idempotency_key)
      if (!g) { g = { id: randomUUID(), viaje_id: v.id, categoria: cat, monto: r2(Number(p.monto)), observaciones: p.observaciones || null, foto_url: p.foto_url || null, estado: "declarado", created_at: ahora(), idempotency_key: m.idempotency_key, altas: 0 }; S.gastos.push(g) }
      g.altas++
      return { success: true, gasto_id: g.id, replica: [parcheViaje(v.id), parcheBilletera()] }
    }
    S.gastos.push({ id: randomUUID(), viaje_id: null, categoria: cat, monto: r2(Number(p.monto)), observaciones: p.observaciones || null, foto_url: null, estado: "declarado", created_at: ahora(), altas: 1 })
    return { success: true, replica: [parcheBilletera()] }
  },
  "viaje.finalizar": (u, p) => {
    const v = tripulante(p.viaje_id)
    if (v.estado === "en_rendicion" || v.estado === "completado") return { success: true, estado: v.estado, dedup: true, replica: [parcheViaje(v.id), parcheBilletera(), parcheMe(u)] }
    if (v.estado !== "en_curso") throw new Rechazo("El viaje no está en curso")
    const pend = S.paradas.filter((x) => x.viaje_id === v.id && x.estado === "pendiente")
    if (pend.length) throw new Rechazo(`Quedan ${pend.length} parada(s) sin resolver: marcá cada una como entregada o no entregada.`)
    v.estado = "en_rendicion"; v.finalizado_at = ahora()
    const pagos = S.pagos.filter((x) => x.viaje_id === v.id && x.estado === "pendiente_rendicion")
    for (const x of pagos) x.declarado = true
    S.rendiciones.push({ id: randomUUID(), viaje_id: v.id, pago_ids: pagos.map((x) => x.id), efectivo_declarado: Number(p.efectivo_declarado) || 0, estado: "abierta" })
    return { success: true, estado: "en_rendicion", pagos_declarados: pagos.length, replica: [parcheViaje(v.id), parcheBilletera(), parcheMe(u)] }
  },
  "bcra.consultar": (u, p) => {
    const cheque = { banco: p.banco ?? null, numero_cheque: p.numero_cheque ?? null, monto: p.monto ?? null, cliente_nombre: p.cliente_nombre ?? null }
    const consultado_at = ahora()
    if (MODO_BCRA === "caido") return { veredicto: "sin_respuesta", titulo: "⚠️ No se pudo consultar el BCRA — verificá el cheque a mano", detalle: ["El BCRA no respondió a tiempo"], mismoBanco: false, cheque, consultado_at }
    if (MODO_BCRA === "riesgo") return { veredicto: "riesgo", titulo: "⛔ BCRA: Situación 3 — riesgo medio — evaluá si aceptás el cheque", detalle: [`DEMO SA (${p.cuits[0] || ""}): Situación 3 — riesgo medio`, "🚨 La deuda (situación 3) es en BANCO MACRO S.A., el MISMO banco que emitió el cheque."], mismoBanco: true, cheque, consultado_at }
    return { veredicto: "apto", titulo: "✅ BCRA: se puede aceptar — sin antecedentes", detalle: [], mismoBanco: false, cheque, consultado_at }
  },
}

// ─── HTTP ───────────────────────────────────────────────────────────────────
const usuarioDe = (token) => {
  const m = /^mock\.(.+)$/.exec(token || "")
  if (!m) return null
  const email = Buffer.from(m[1], "base64url").toString()
  return { id: uid(9001), email, nombre: email.split("@")[0].replace(/^./, (c) => c.toUpperCase()) }
}
const sesion = (email) => { const t = `mock.${Buffer.from(email).toString("base64url")}`; const u = usuarioDe(t); return { access_token: t, refresh_token: t, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: u.id, email, nombre: u.nombre }, roles: ["chofer"] } }

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x")
  const cors = { "Access-Control-Allow-Origin": req.headers.origin || "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, PATCH, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Device-Id, X-App-Version", "Access-Control-Max-Age": "86400" }
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
    if (url.pathname === "/__mock/anular-cobro") { const p = S.pagos.find((x) => x.id === url.searchParams.get("id")); if (p) { p.estado = "confirmado"; S.seq++ } }
    if (url.pathname === "/__mock/red" || url.pathname === "/__mock/anular-cobro") S.seq++
    return json(200, {
      red: S.red, seq: S.seq,
      viajes: S.viajes.map((v) => ({ nombre: v.nombre, estado: v.estado, iniciado_at: v.iniciado_at, finalizado_at: v.finalizado_at })),
      paradas: S.paradas.map((p) => ({ cliente: clienteDe(p.cliente_id)?.nombre, estado: p.estado, bultos: p.bultos_entregados, motivo_no_entrega: p.motivo_no_entrega, motivo_no_cobro: p.motivo_no_cobro })),
      cobros: S.pagos.map((p) => ({ id: p.id, cliente: clienteDe(p.cliente_id)?.nombre, monto: p.monto, estado: p.estado, detalles: p.detalles.map((d) => `${d.tipo_pago} ${d.monto}`), imputaciones: p.imputaciones.map((i) => i.monto_imputado), contado: p.contado, ajuste: p.ajuste, fotos: p.fotos?.length || 0 })),
      devoluciones: S.devoluciones.map((d) => ({ numero: d.numero_devolucion, cliente: clienteDe(d.cliente_id)?.nombre, total: d.monto_total, altas: d.altas, descontada: !!d.descontada })),
      gastos: S.gastos.map((g) => ({ categoria: g.categoria, monto: g.monto, altas: g.altas })),
      rendiciones: S.rendiciones,
      billetera: billetera().efectivo,
      claves: [...S.claves.values()].map((c) => ({ tipo: c.tipo, estado: c.body.estado, aplicaciones: c.aplicaciones, recibidas: c.recibidas })),
      ultimasOperaciones: S.log.slice(-30),
    })
  }
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end() }
  if (!S.red) return req.socket.destroy() // sin señal: la app ve un error de red

  if (url.pathname === "/api/mobile/auth/login") return body?.email && body?.password ? json(200, sesion(String(body.email).toLowerCase())) : json(400, { error: "Faltan datos de ingreso." })
  if (url.pathname === "/api/mobile/auth/refresh") { const u = usuarioDe(body?.refresh_token); return u ? json(200, sesion(u.email)) : json(401, { error: "La sesión expiró." }) }
  if (url.pathname === "/api/mobile/auth/logout") return json(200, { ok: true })

  const u = usuarioDe((req.headers.authorization || "").replace(/^Bearer /, ""))
  if (!u) return json(401, { error: "No autorizado." })

  if (url.pathname === "/api/mobile/sync/estado") return json(200, { server_time: ahora(), cambios_seq: String(S.seq), protocolo: 1 })
  const ds = /^\/api\/mobile\/sync\/(.+)$/.exec(url.pathname)?.[1]
  if (ds) {
    if (!DATASETS[ds]) return json(404, { error: `Dataset desconocido: ${ds}` })
    const filas = DATASETS[ds](u).filter(Boolean)
    const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean)
    if (ids.length) {
      if (!PARCIALES.has(ds)) return json(400, { error: "Este dataset no admite refresco parcial." })
      const upserts = filas.filter((f) => ids.includes(f.id))
      return json(200, { dataset: ds, generado_at: ahora(), upserts, deletes: ids.filter((id) => !upserts.some((f) => f.id === id)) })
    }
    const hash = createHash("sha1").update(JSON.stringify(filas)).digest("base64url").slice(0, 27)
    const mismo = (url.searchParams.get("cursor") || "").endsWith(hash)
    return json(200, { dataset: ds, modo: "snapshot", cursor: `s:${hash}`, generado_at: ahora(), sin_cambios: mismo, upserts: mismo ? [] : filas, deletes: [] })
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
  // Foto de cheque: la app crea la fila al instante y llama acá en segundo plano
  if (url.pathname === "/api/pagos-clientes/ocr") {
    if (MODO_OCR === "caido") return json(500, { error: "GEMINI_API_KEY no configurado" })
    await new Promise((r) => setTimeout(r, MODO_OCR === "lento" ? 8000 : 1500))
    const foto = { url: "https://placehold.co/640x300/e2e8f0/475569.png?text=Cheque+(mock)", nombre: "cheque.jpg" }
    if (MODO_OCR === "sin_datos") return json(200, { success: true, resultados: [], total_encontrados: 0, archivos: [foto], archivos_por_indice: [foto], saneados: [], errores: ["cheque.jpg: no se detectaron datos"] })
    const venc = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    const cheque = MODO_OCR === "sin_cuit"
      ? { tipo: "cheque", monto: 421100, banco: "Santander", numero_cheque: "11400261", cuits_titulares: [], descartados: { fecha_cheque: "27 de xyz de 2026" }, no_encontrados: ["cuit_emisor"] }
      : { tipo: "cheque", monto: 15000, banco: "Banco Macro", numero_cheque: "00098765", fecha_cheque: venc, cuit_emisor: "20-12345678-6", cuits_titulares: ["20-12345678-6"] }
    return json(200, { success: true, resultados: [{ ...cheque, banco_emisor: cheque.banco, archivo_index: 0 }], total_encontrados: 1, archivos: [foto], archivos_por_indice: [foto], saneados: [{ ...cheque, archivo_index: 0 }] })
  }
  // Foto del ticket de un gasto (online-only)
  if (url.pathname === "/api/chofer/billetera/gasto/ocr") {
    await new Promise((r) => setTimeout(r, 1200))
    return json(200, { success: true, categoria: "nafta", monto: 32500, fecha: hoy(), comercio: "YPF Necochea", detalle: "YPF Necochea · Nafta súper 32 L", confianza: 0.9, foto_url: "https://placehold.co/400x600/e2e8f0/475569.png?text=Ticket+(mock)" })
  }
  if (url.pathname === "/api/chofer/articulo/precio-historico") return json(200, { precio: 999.99, fecha: null, comprobante: null, fuente: "vigente" })
  if (/^\/api\/remitos\/.+\/pdf$/.test(url.pathname)) { res.writeHead(302, { Location: "https://placehold.co/600x800.png?text=Remito+(mock)", ...cors }); return res.end() }
  if (url.pathname.startsWith("/api/bcra/deudor/")) return json(200, { cuit: url.pathname.split("/").pop(), denominacion: "DEMO SA", situacion_max: 1, sin_antecedentes: true, apto: true, entidades: [] })
  json(404, { error: "No existe en el mock" })
}).listen(PUERTO, () => console.log(`Mock del ERP para la app Chofer en http://localhost:${PUERTO} · viaje "${S.viajes[0].nombre}" con ${S.paradas.length} paradas · ${S.f.clientes.length} clientes · ${S.f.articulos.length} artículos`))
