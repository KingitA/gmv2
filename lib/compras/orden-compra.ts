/**
 * Orden de compra: lecturas compartidas por las rutas del servidor (Tanda 1-A).
 * Todo lo que ESCRIBE pasa por las funciones SQL de la migración 20261117n
 * (oc_guardar, oc_cancelar, oc_marcar_enviada): acá solo se lee y se arma el pedido.
 */
import { fetchAllRows, fetchByIds } from "@/lib/supabase/fetch-all"
import { diasEntre, fechaISO, finDiaAR, hoyISO, inicioDiaAR, redondear, sumarDiasISO } from "@/lib/formato"
import { bultosParaCubrir, unidadesPorBultoDe } from "@/lib/deposito/unidades"
import { faltaLaColumna, faltaLaFuncion } from "@/lib/utils/migracion-pendiente"

export const MIGRACION_OC = "20261117n_oc_guardar.sql"
export const MIGRACION_PROVEEDORES = "20261117m_proveedores_datos_compra.sql"

/** Estados en los que la orden todavía no llegó: se puede editar, enviar y cancelar. */
export const ESTADOS_OC_ABIERTA = ["pendiente", "enviada", "confirmada", "en_camino"] as const

export const ESTADOS_OC: Record<string, { nombre: string; tono: "amarillo" | "azul" | "violeta" | "naranja" | "verde" | "rojo" | "gris" }> = {
  pendiente: { nombre: "Sin enviar", tono: "amarillo" },
  enviada: { nombre: "Enviada", tono: "azul" },
  // Juan (17/11): "confirmada" y "en camino" no se usan (la orden llega cuando depósito empieza
  // a escanear). La base los admite; si alguna orden los tuviera se muestra como Enviada.
  confirmada: { nombre: "Enviada", tono: "azul" },
  en_camino: { nombre: "Enviada", tono: "azul" },
  recibida_parcial: { nombre: "Recibida en parte", tono: "naranja" },
  recibida_completa: { nombre: "Recibida", tono: "naranja" },
  recibida: { nombre: "Recibida", tono: "naranja" },
  finalizada: { nombre: "Finalizada", tono: "verde" },
  cancelada: { nombre: "Cancelada", tono: "rojo" },
}

/** Respuesta lista para devolver cuando falta la migración de la orden de compra. */
export function mensajeMigracionOC(error: unknown): string | null {
  const funciones = ["oc_guardar", "oc_cancelar", "oc_marcar_enviada", "oc_totales"]
  if (funciones.some((f) => faltaLaFuncion(error, f)) || faltaLaColumna(error)) {
    return `Falta aplicar la migración ${MIGRACION_OC} en la base. Hasta entonces no se pueden crear, editar, cancelar ni enviar órdenes de compra. Avisá a sistemas.`
  }
  return null
}

/** Error de una función SQL (RAISE EXCEPTION … USING DETAIL = 'codigo') → { mensaje, codigo, status } */
export function errorDeFuncion(error: any): { mensaje: string; codigo: string | null; status: number } {
  const codigo = typeof error?.details === "string" && /^[a-z_]+$/.test(error.details) ? error.details : null
  const esRegla = error?.code === "P0001" || error?.code === "P0002"
  return {
    mensaje: esRegla ? String(error.message) : `No se pudo completar la operación: ${error?.message || "error desconocido"}`,
    codigo,
    status: error?.code === "P0002" ? 404 : esRegla ? 409 : 500,
  }
}

// ─── Artículos de un proveedor (E-14: una sola fuente) ──────────────────────────────────────
/**
 * "Artículos de este proveedor" = los que lo tienen como proveedor en la ficha
 * (`articulos.proveedor_id`) MÁS los que se le vincularon desde una factura o lista
 * (`articulos_proveedores`). Antes la tabla de la orden usaba lo primero y la sugerencia lo segundo.
 */
export async function idsArticulosDeProveedor(supabase: any, proveedorId: string): Promise<string[]> {
  const [propios, vinculados] = await Promise.all([
    fetchAllRows<any>(() => supabase.from("articulos").select("id").eq("proveedor_id", proveedorId).eq("activo", true)),
    fetchAllRows<any>(() => supabase.from("articulos_proveedores").select("articulo_id").eq("proveedor_id", proveedorId), "articulo_id").catch(() => []),
  ])
  return [...new Set<string>([...propios.map((a) => a.id), ...vinculados.map((a) => a.articulo_id)].filter(Boolean))]
}

export const COLS_ARTICULO_OC = "id, sku, ean13, descripcion, unidades_por_bulto, precio_compra, descuento1, descuento2, descuento3, descuento4, iva_compras, stock_actual, proveedor_id, activo, imagen_url, marca_id"

export interface ArticuloParaPedir {
  id: string
  sku: string | null
  ean13: string | null
  descripcion: string
  unidades_por_bulto: number
  precio_compra: number
  descuento1: number
  descuento2: number
  descuento3: number
  descuento4: number
  iva_compras: string
  /** Todo en UNIDADES */
  stock_actual: number
  en_camino: number
  vendido: number
  venta_diaria: number
  sugerido: number
  /** La sugerencia en la unidad en que se pide: bultos enteros hacia arriba (o unidades si no tiene bulto) */
  sugerido_bultos: number
  /** No es de este proveedor en la ficha: se agregó por vínculo o a mano */
  externo: boolean
  /** Foto del artículo (articulos.imagen_url) */
  imagen_url: string | null
  /** Nombre de la marca (marcas.descripcion vía articulos.marca_id) */
  marca: string | null
}

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Stock, en camino, venta del período y sugerencia para una lista de artículos.
 * Sugerencia = venta diaria × días objetivo − stock − en camino (nunca negativa), en unidades.
 */
export async function datosParaPedir(
  supabase: any,
  articuloIds: string[],
  p: { proveedorId: string; fechaDesde: string; fechaHasta: string; tipoVenta: "vendida" | "facturada"; diasObjetivo: number; excluirOrdenId?: string | null; /** artículos dados de baja que igual se muestran (ya estaban en la orden) */ conservarInactivos?: string[] },
): Promise<{ articulos: ArticuloParaPedir[]; diasPeriodo: number }> {
  const diasPeriodo = Math.max(1, diasEntre(p.fechaDesde, p.fechaHasta) || 0)
  if (articuloIds.length === 0) return { articulos: [], diasPeriodo }

  const porTandas = async (armar: (ids: string[]) => any) => {
    const out: any[] = []
    for (let i = 0; i < articuloIds.length; i += 200) out.push(...(await fetchAllRows(() => armar(articuloIds.slice(i, i + 200)))))
    return out
  }

  const [arts, ventas, enCamino] = await Promise.all([
    fetchByIds<any>((ids) => supabase.from("articulos").select(COLS_ARTICULO_OC).in("id", ids), articuloIds),
    porTandas((ids) => {
      let q = supabase.from("kardex").select("articulo_id, cantidad").eq("tipo_movimiento", "venta").eq("signo", -1).in("articulo_id", ids)
        .gte("fecha", inicioDiaAR(p.fechaDesde)).lte("fecha", finDiaAR(p.fechaHasta))
      if (p.tipoVenta === "facturada") q = q.not("comprobante_venta_id", "is", null)
      return q
    }),
    porTandas((ids) => supabase.from("kardex").select("articulo_id, cantidad, orden_compra_id").eq("tipo_movimiento", "compra").eq("estado", "pendiente").in("articulo_id", ids)),
  ])

  const vendido = new Map<string, number>()
  for (const v of ventas) vendido.set(v.articulo_id, (vendido.get(v.articulo_id) || 0) + num(v.cantidad))
  const camino = new Map<string, number>()
  for (const c of enCamino) {
    // Al editar una orden, lo que ella misma tiene "en camino" no cuenta
    if (p.excluirOrdenId && c.orden_compra_id === p.excluirOrdenId) continue
    camino.set(c.articulo_id, (camino.get(c.articulo_id) || 0) + num(c.cantidad))
  }

  // Nombre de la marca de cada artículo (si falla, la fila sale sin marca: no traba la orden)
  const marcaIds = [...new Set<string>(arts.map((a: any) => a.marca_id).filter(Boolean))]
  const marcas = new Map<string, string>()
  if (marcaIds.length > 0) {
    try {
      const filasMarca = await fetchByIds<any>((ids) => supabase.from("marcas").select("id, descripcion").in("id", ids), marcaIds)
      for (const m of filasMarca) if (m.descripcion) marcas.set(m.id, String(m.descripcion))
    } catch { /* sin marcas */ }
  }

  const conservar = new Set(p.conservarInactivos || [])
  const articulos: ArticuloParaPedir[] = arts.filter((a: any) => a.activo !== false || conservar.has(a.id)).map((a: any) => {
    const totalVendido = vendido.get(a.id) || 0
    const stock = num(a.stock_actual)
    const stockCamino = camino.get(a.id) || 0
    const ventaDiaria = totalVendido / diasPeriodo
    const sugerido = Math.max(0, Math.ceil(ventaDiaria * p.diasObjetivo - stock - stockCamino))
    const ub = unidadesPorBultoDe(a.unidades_por_bulto)
    return {
      id: a.id, sku: a.sku ?? null, ean13: Array.isArray(a.ean13) ? a.ean13[0] ?? null : a.ean13 ?? null,
      descripcion: a.descripcion || "—", unidades_por_bulto: ub,
      precio_compra: num(a.precio_compra), descuento1: num(a.descuento1), descuento2: num(a.descuento2), descuento3: num(a.descuento3), descuento4: num(a.descuento4),
      iva_compras: a.iva_compras || "factura",
      stock_actual: stock, en_camino: stockCamino, vendido: totalVendido, venta_diaria: redondear(ventaDiaria),
      sugerido, sugerido_bultos: ub > 1 ? bultosParaCubrir(sugerido, ub) : sugerido,
      externo: a.proveedor_id !== p.proveedorId,
      imagen_url: typeof a.imagen_url === "string" && a.imagen_url.trim() ? a.imagen_url : null,
      marca: a.marca_id ? marcas.get(a.marca_id) ?? null : null,
    }
  })
  articulos.sort((a, b) => a.descripcion.localeCompare(b.descripcion, "es"))
  return { articulos, diasPeriodo }
}

// ─── Fecha estimada de entrega (E-10) ──────────────────────────────────────────────────────
export interface DiasEntrega {
  dias: number
  /** historial = promedio real de las últimas recepciones · ficha = lo cargado en el proveedor · defecto = 7 días */
  origen: "historial" | "ficha" | "defecto"
  /** Cuántas órdenes recibidas entraron en el promedio */
  muestras: number
}

/**
 * Cuánto tarda este proveedor en entregar: promedio de días entre que se le mandó (o se creó)
 * la orden y el fin de su primera recepción, sobre las últimas 10 órdenes recibidas.
 * Sin historia: `proveedores.dias_entrega`. Sin eso: 7 días. NUNCA los días de pago (era el error).
 */
export async function diasEntregaDeProveedor(supabase: any, proveedorId: string, proveedor?: any): Promise<DiasEntrega> {
  try {
    let { data: ocs, error } = await supabase.from("ordenes_compra").select("id, fecha_orden, enviada_at")
      .eq("proveedor_id", proveedorId).in("estado", ["recibida_parcial", "recibida_completa", "finalizada"])
      .order("fecha_orden", { ascending: false }).limit(10)
    if (error && faltaLaColumna(error)) {
      ;({ data: ocs } = await supabase.from("ordenes_compra").select("id, fecha_orden")
        .eq("proveedor_id", proveedorId).in("estado", ["recibida_parcial", "recibida_completa", "finalizada"])
        .order("fecha_orden", { ascending: false }).limit(10))
    }
    const lista: any[] = ocs || []
    if (lista.length > 0) {
      const { data: recs } = await supabase.from("recepciones").select("orden_compra_id, fecha_fin, estado")
        .in("orden_compra_id", lista.map((o) => o.id)).eq("estado", "finalizada").not("fecha_fin", "is", null)
        .order("fecha_fin", { ascending: true })
      const primera = new Map<string, string>()
      for (const r of recs || []) if (!primera.has(r.orden_compra_id)) primera.set(r.orden_compra_id, r.fecha_fin)
      const dias: number[] = []
      for (const o of lista) {
        const fin = primera.get(o.id)
        const desde = o.enviada_at || o.fecha_orden
        if (!fin || !desde) continue
        const d = diasEntre(fechaISO(desde), fechaISO(fin))
        if (Number.isFinite(d) && d >= 0 && d <= 180) dias.push(d)
      }
      if (dias.length > 0) return { dias: Math.max(1, Math.round(dias.reduce((s, d) => s + d, 0) / dias.length)), origen: "historial", muestras: dias.length }
    }
  } catch { /* sin historial utilizable: se sigue con la ficha */ }
  const deFicha = Number(proveedor?.dias_entrega)
  if (Number.isFinite(deFicha) && deFicha > 0) return { dias: Math.round(deFicha), origen: "ficha", muestras: 0 }
  return { dias: 7, origen: "defecto", muestras: 0 }
}

export const fechaEntregaEstimada = (d: DiasEntrega) => sumarDiasISO(hoyISO(), d.dias)

// ─── Mails del proveedor (E-03) ────────────────────────────────────────────────────────────
const RE_MAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/

/** "a@x.com; b@y.com , " → ["a@x.com", "b@y.com"] (válidos, en minúsculas, sin repetir) */
export function separarMails(v: unknown): string[] {
  const out: string[] = []
  for (const parte of String(v ?? "").split(/[,;\s]+/)) {
    const m = parte.trim().toLowerCase()
    if (m && RE_MAIL.test(m) && !out.includes(m)) out.push(m)
  }
  return out
}
export const mailsInvalidos = (v: unknown): string[] =>
  String(v ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter((x) => x && !RE_MAIL.test(x))

/**
 * A quién se le manda la orden: el "mail para órdenes de compra" de la ficha. Si no está cargado,
 * se PROPONE el del vendedor, el de la oficina o el general (en ese orden) y la pantalla lo dice.
 */
export function mailsParaOrden(p: any): { para: string[]; origen: "ordenes_compra" | "vendedor" | "oficina" | "general" | null; otros: string[] } {
  const fuentes: [NonNullable<ReturnType<typeof mailsParaOrden>["origen"]>, unknown][] = [
    ["ordenes_compra", p?.mail_ordenes_compra], ["vendedor", p?.mail_vendedor], ["oficina", p?.mail_oficina], ["general", p?.email],
  ]
  const todos = fuentes.map(([o, v]) => ({ origen: o, mails: separarMails(v) })).filter((f) => f.mails.length > 0)
  if (todos.length === 0) return { para: [], origen: null, otros: [] }
  const elegido = todos[0]
  const otros = [...new Set(todos.slice(1).flatMap((f) => f.mails))].filter((m) => !elegido.mails.includes(m))
  return { para: elegido.mails, origen: elegido.origen, otros }
}
