/**
 * Consultas de COMPRAS para Jarvis y para los reportes de Playroom (E-80, E-81).
 *
 * Una sola cuenta para los dos lados: cada función llama a una consulta fija de la base
 * (funciones jarvis_* de la migración 20261119c_jarvis_compras.sql) y devuelve una tabla lista
 * para mostrar o exportar. Todo es de SOLO LECTURA.
 *
 * Reglas (las aplican las funciones de la base, acá solo se muestran):
 *  - Comprado = comprobantes de compra VALIDADOS; sin remitos, notas esperadas ni estimados.
 *  - Notas de crédito y reversas restan.
 *  - "Con factura" (blanco) / "sin factura" (negro: Adquisición y Reversa).
 *  - Deuda = lo que el CALENDARIO tiene pendiente: las cuotas pendientes de cada comprobante
 *    (o su saldo de cuenta corriente, si no tiene ningún vencimiento) + vencimientos cargados a
 *    mano sin comprobante. Un vencimiento marcado pagado o cancelado es deuda saldada, aunque la
 *    cuenta corriente no lo sepa. Lo comprometido por órdenes de compra NO es deuda, y los
 *    créditos a favor sin aplicar se informan aparte.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Formato } from "@/lib/playroom/bloques"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { finDiaAR, inicioDiaAR, numero } from "@/lib/formato"

export interface TablaReporte {
  titulo: string
  columnas: { clave: string; titulo: string; formato?: Formato }[]
  filas: Record<string, string | number | null>[]
  total?: Record<string, number>
  nota?: string
}

export type Fila = Record<string, any>

/** La consulta todavía no está instalada en la base (falta aplicar la migración). */
export class FaltaMigracion extends Error {
  constructor(fn: string) {
    super(`Esta consulta todavía no está instalada en la base (${fn}): falta aplicar la migración 20261119c_jarvis_compras.sql.`)
  }
}

const esFaltaFuncion = (e: unknown) => {
  const err = e as { code?: string; message?: string } | null
  return err?.code === "PGRST202" || err?.code === "42883" || /could not find the function|does not exist/i.test(String(err?.message ?? ""))
}

/**
 * Llama a una función de la base. `orden` = columnas que identifican cada fila: con eso se pide
 * de a páginas y no se corta en 1.000 filas (la última columna es el desempate).
 */
export async function consulta(db: SupabaseClient, fn: string, args: Fila, orden: string[] = []): Promise<Fila[]> {
  try {
    if (orden.length > 0) {
      const previas = orden.slice(0, -1)
      return await fetchAllRows<Fila>(() => {
        let q: any = db.rpc(fn, args)
        for (const c of previas) q = q.order(c, { ascending: true })
        return q
      }, orden[orden.length - 1])
    }
    const { data, error } = await db.rpc(fn, args)
    if (error) throw error
    return (data ?? []) as Fila[]
  } catch (e) {
    if (esFaltaFuncion(e)) throw new FaltaMigracion(fn)
    throw new Error(`${fn}: ${(e as { message?: string })?.message ?? e}`)
  }
}

const n0 = (v: unknown) => Number(v) || 0
const red = (v: unknown, dec = 2) => Math.round(n0(v) * 10 ** dec) / 10 ** dec
const fechaSola = (v: unknown) => (v == null ? null : String(v).slice(0, 10))
const suma = (filas: Fila[], clave: string) => red(filas.reduce((s, f) => s + n0(f[clave]), 0))
/** "2026-11" → "11/2026" (así se muestra un mes, docs/FORMATOS.md) */
export const mesAR = (aaaaMm: unknown) => { const [a, m] = String(aaaaMm ?? "").split("-"); return a && m ? `${m}/${a}` : String(aaaaMm ?? "") }
/** Cantidad con coma decimal y sin ceros de más: 1,5 · 12 */
export const cantidadAR = (v: unknown) => numero(n0(v), 0, 2)

export const MOTIVO_NOTA: Record<string, string> = {
  faltante: "faltante", diferencia_precio: "diferencia de precio", descuento_fuera_factura: "descuento fuera de factura",
  devolucion: "devolución", sobrante: "sobrante que va a facturar",
}
export const DESTINO_DIFERENCIA: Record<string, string> = {
  empresa: "lo asumimos nosotros", proveedor: "se le reclama al proveedor (nota de crédito)", transporte: "se le carga al transporte",
  descuento_fuera_factura: "descuento que llega aparte (nota de crédito)", espera_factura: "sobrante: esperamos la factura",
  bonificado: "sobrante recibido sin cargo",
}
export const ESTADO_OC: Record<string, string> = {
  pendiente: "sin enviar", enviada: "enviada", confirmada: "enviada", en_camino: "enviada", recibida_parcial: "recibida en parte",
}

export interface FiltrosCompras {
  desde?: string
  hasta?: string
  proveedorId?: string | null
  proveedorNombre?: string
  articuloId?: string | null
  articuloNombre?: string
  texto?: string | null
}

// ─── 1. Compras por proveedor y mes ────────────────────────────────────────
export async function repComprasProveedorMes(db: SupabaseClient, f: FiltrosCompras): Promise<TablaReporte> {
  const rows = await consulta(db, "jarvis_compras_proveedor_mes", { p_desde: f.desde, p_hasta: f.hasta, p_proveedor_id: f.proveedorId ?? null }, ["proveedor_id", "mes"])
  const filas = rows.map((r) => ({
    proveedor: String(r.proveedor ?? "—"), mes: String(r.mes), comprobantes: n0(r.comprobantes),
    con_factura_neto: red(r.blanco_neto), con_factura_total: red(r.blanco_total), sin_factura: red(r.negro_total), total: red(r.total),
  })).sort((a, b) => a.proveedor.localeCompare(b.proveedor) || b.mes.localeCompare(a.mes)).map((x) => ({ ...x, mes: mesAR(x.mes) }))
  return {
    titulo: `Compras por proveedor y mes${f.proveedorNombre ? ` — ${f.proveedorNombre}` : ""}`,
    columnas: [
      { clave: "proveedor", titulo: "Proveedor" }, { clave: "mes", titulo: "Mes" }, { clave: "comprobantes", titulo: "Comprobantes", formato: "numero" },
      { clave: "con_factura_neto", titulo: "Con factura (neto)", formato: "pesos" }, { clave: "con_factura_total", titulo: "Con factura (total)", formato: "pesos" },
      { clave: "sin_factura", titulo: "Sin factura", formato: "pesos" }, { clave: "total", titulo: "Total", formato: "pesos" },
    ],
    filas,
    total: { con_factura_neto: suma(filas, "con_factura_neto"), con_factura_total: suma(filas, "con_factura_total"), sin_factura: suma(filas, "sin_factura"), total: suma(filas, "total") },
    nota: "Comprobantes de compra validados, por fecha del comprobante. Las notas de crédito y las reversas restan. No incluye remitos, notas esperadas ni órdenes de compra sin facturar.",
  }
}

// ─── 2. Evolución del costo de un artículo ─────────────────────────────────
export async function repCostoArticulo(db: SupabaseClient, f: FiltrosCompras): Promise<TablaReporte> {
  if (!f.articuloId) throw new Error("Falta el artículo")
  const [compras, hist] = await Promise.all([
    consulta(db, "jarvis_compras_renglones", { p_articulo_id: f.articuloId, p_proveedor_id: null, p_desde: f.desde ?? null, p_hasta: f.hasta ?? null, p_limite: 500 }),
    (async () => {
      let q = db.from("precios_compra_historial").select("*").eq("articulo_id", f.articuloId).order("fecha_desde", { ascending: false }).limit(500)
      if (f.desde) q = q.gte("fecha_desde", inicioDiaAR(f.desde))
      if (f.hasta) q = q.lte("fecha_desde", finDiaAR(f.hasta))
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return (data ?? []) as Fila[]
    })(),
  ])
  const ORIGEN: Record<string, string> = { factura: "al validar una factura", diferencia_precio: "se aceptó un precio distinto al de la orden", bonificado: "mercadería recibida sin cargo" }
  const dtos = (h: Fila) => [h.descuento1, h.descuento2, h.descuento3, h.descuento4].map(n0).filter((x) => x > 0).join(" + ") || null
  const filas = [
    ...compras.map((c) => ({
      fecha: fechaSola(c.fecha), que: `Compra: ${c.tipo_comprobante} ${c.numero_comprobante}${c.orden ? ` (${c.orden})` : ""}`, proveedor: String(c.proveedor ?? "—"),
      cantidad: n0(c.unidades), precio_lista: c.precio_lista == null ? null : red(c.precio_lista), descuentos: c.descuentos ?? null,
      costo_neto_unidad: c.neto_unitario == null ? null : red(c.neto_unitario),
    })),
    ...hist.map((h) => ({
      fecha: fechaSola(h.fecha_desde), que: `Cambio de costo${h.origen ? `: ${ORIGEN[h.origen] ?? h.origen}` : " (lista)"}`, proveedor: "",
      cantidad: null as number | null, precio_lista: h.precio_compra == null ? null : red(h.precio_compra), descuentos: dtos(h),
      costo_neto_unidad: h.ultimo_costo == null ? null : red(h.ultimo_costo),
    })),
  ].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
  return {
    titulo: `Costo de ${f.articuloNombre ?? "el artículo"}`,
    columnas: [
      { clave: "fecha", titulo: "Fecha", formato: "fecha" }, { clave: "que", titulo: "Qué pasó" }, { clave: "proveedor", titulo: "Proveedor" },
      { clave: "cantidad", titulo: "Unidades", formato: "numero" }, { clave: "precio_lista", titulo: "Precio de lista", formato: "pesos" },
      { clave: "descuentos", titulo: "Descuentos %" }, { clave: "costo_neto_unidad", titulo: "Costo neto por unidad", formato: "pesos" },
    ],
    filas,
    nota: "“Compra” = renglón de un comprobante validado (precio de lista tal cual la factura; si vino por bulto, es por bulto; el costo neto está siempre por unidad). “Cambio de costo” = lo que quedó anotado en el historial de precios de compra.",
  }
}

// ─── 3. Antigüedad de la deuda a proveedores ───────────────────────────────
export async function repDeudaProveedores(db: SupabaseClient, f: FiltrosCompras): Promise<TablaReporte> {
  const rows = await consulta(db, "jarvis_cc_proveedores", { p_proveedor_id: f.proveedorId ?? null }, ["proveedor_id"])
  const filas = rows.map((r) => ({
    proveedor: String(r.proveedor ?? "—"), deuda: red(r.deuda_total), a_vencer: red(r.a_vencer),
    vencido_1_30: red(r.vencido_1_30), vencido_31_60: red(r.vencido_31_60), vencido_61_90: red(r.vencido_61_90), vencido_mas_90: red(r.vencido_mas_90),
    creditos_sin_aplicar: red(r.creditos_sin_aplicar), anotado_a_mano: red(r.vencimientos_a_mano), comprometido_oc: red(r.comprometido_oc),
    proximo_vencimiento: fechaSola(r.proximo_vencimiento),
  })).filter((x) => f.proveedorId || x.deuda > 0.01 || x.comprometido_oc > 0.01 || Math.abs(x.creditos_sin_aplicar) > 0.01).sort((a, b) => b.deuda - a.deuda)
  const claves = ["deuda", "a_vencer", "vencido_1_30", "vencido_31_60", "vencido_61_90", "vencido_mas_90", "comprometido_oc"]
  return {
    titulo: "Deuda a proveedores por antigüedad",
    columnas: [
      { clave: "proveedor", titulo: "Proveedor" }, { clave: "deuda", titulo: "Le debemos", formato: "pesos" }, { clave: "a_vencer", titulo: "A vencer", formato: "pesos" },
      { clave: "vencido_1_30", titulo: "Vencido 1-30 d", formato: "pesos" }, { clave: "vencido_31_60", titulo: "31-60 d", formato: "pesos" },
      { clave: "vencido_61_90", titulo: "61-90 d", formato: "pesos" }, { clave: "vencido_mas_90", titulo: "Más de 90 d", formato: "pesos" },
      { clave: "anotado_a_mano", titulo: "De eso, anotado a mano", formato: "pesos" }, { clave: "creditos_sin_aplicar", titulo: "Créditos a favor (aparte)", formato: "pesos" },
      { clave: "comprometido_oc", titulo: "Comprometido por órdenes", formato: "pesos" }, { clave: "proximo_vencimiento", titulo: "Próx. vencimiento", formato: "fecha" },
    ],
    filas,
    total: Object.fromEntries(claves.map((c) => [c, suma(filas, c)])),
    nota: "“Le debemos” = lo que el calendario de pagos tiene pendiente: las cuotas pendientes de cada comprobante (un vencimiento marcado pagado o cancelado ya no cuenta) más lo anotado a mano sin comprobante (ya incluido). Los tramos reparten ese total por los días de vencida de cada cuota. Los créditos a favor sin aplicar (notas de crédito, pagos a cuenta) van aparte: NO están restados. “Comprometido por órdenes” es mercadería pedida sin factura: no es deuda y no está sumado.",
  }
}

// ─── 4. Retenciones por período ────────────────────────────────────────────
export async function repRetenciones(db: SupabaseClient, f: FiltrosCompras): Promise<TablaReporte> {
  const data = await fetchAllRows<Fila>(() => {
    let q = db.from("retenciones_emitidas")
      .select("id, fecha, numero_certificado, base_calculo, alicuota, monto, estado, ajuste_manual, proveedores(nombre, cuit), ordenes_pago(numero_op)")
    if (f.desde) q = q.gte("fecha", f.desde)
    if (f.hasta) q = q.lte("fecha", f.hasta)
    if (f.proveedorId) q = q.eq("proveedor_id", f.proveedorId)
    return q
  }, "id")
  const uno = (x: any) => (Array.isArray(x) ? x[0] : x)
  const filas = data.map((r) => ({
    fecha: fechaSola(r.fecha), certificado: String(r.numero_certificado ?? ""), proveedor: String(uno(r.proveedores)?.nombre ?? "—"), cuit: uno(r.proveedores)?.cuit ?? null,
    orden_pago: uno(r.ordenes_pago)?.numero_op ?? null, base: red(r.base_calculo), alicuota: red(r.alicuota, 3), retenido: red(r.monto),
    estado: r.estado === "anulada" ? "anulado" : "emitido",
  })).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
  const vigentes = filas.filter((x) => x.estado === "emitido")
  return {
    titulo: `Retenciones de Ganancias${f.proveedorNombre ? ` — ${f.proveedorNombre}` : ""}`,
    columnas: [
      { clave: "fecha", titulo: "Fecha", formato: "fecha" }, { clave: "certificado", titulo: "Certificado" }, { clave: "proveedor", titulo: "Proveedor" },
      { clave: "cuit", titulo: "CUIT" }, { clave: "orden_pago", titulo: "Orden de pago" }, { clave: "base", titulo: "Base", formato: "pesos" },
      { clave: "alicuota", titulo: "Alícuota %", formato: "numero" }, { clave: "retenido", titulo: "Retenido", formato: "pesos" }, { clave: "estado", titulo: "Estado" },
    ],
    filas,
    total: { retenido: suma(vigentes, "retenido"), base: suma(vigentes, "base") },
    nota: "Certificados de retención de Ganancias por fecha de confirmación de la orden de pago. Los totales no suman los anulados.",
  }
}

// ─── 5. Órdenes de compra pendientes de recibir ────────────────────────────
export async function repOcPendientes(db: SupabaseClient, f: FiltrosCompras): Promise<TablaReporte> {
  const rows = await consulta(db, "jarvis_oc_pendientes", { p_proveedor_id: f.proveedorId ?? null }, ["orden_id"])
  const filas = rows.map((r) => ({
    orden: String(r.orden ?? ""), proveedor: String(r.proveedor ?? "—"), fecha: fechaSola(r.fecha_orden),
    estado: ESTADO_OC[String(r.estado)] ?? String(r.estado),
    envio: r.enviada ? `enviada el ${String(r.enviada).slice(8, 10)}/${String(r.enviada).slice(5, 7)}` : r.enviada_a_prueba ? "solo envío de prueba" : "sin enviar",
    fecha_estimada: fechaSola(r.fecha_estimada), dias_atraso: r.dias_atraso == null ? null : n0(r.dias_atraso),
    renglones_pendientes: n0(r.renglones_pendientes), renglones: n0(r.renglones),
    unidades_pedidas: red(r.unidades_pedidas), unidades_recibidas: red(r.unidades_recibidas),
    unidades_pendientes: red(n0(r.unidades_pedidas) - n0(r.unidades_recibidas)), total_estimado: r.total_estimado == null ? null : red(r.total_estimado),
  })).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
  return {
    titulo: `Órdenes de compra pendientes de recibir${f.proveedorNombre ? ` — ${f.proveedorNombre}` : ""}`,
    columnas: [
      { clave: "orden", titulo: "Orden" }, { clave: "proveedor", titulo: "Proveedor" }, { clave: "fecha", titulo: "Fecha", formato: "fecha" },
      { clave: "estado", titulo: "Estado" }, { clave: "envio", titulo: "Envío al proveedor" }, { clave: "fecha_estimada", titulo: "Llega (estimado)", formato: "fecha" },
      { clave: "dias_atraso", titulo: "Días de atraso", formato: "numero" }, { clave: "renglones_pendientes", titulo: "Artículos que faltan", formato: "numero" },
      { clave: "unidades_pedidas", titulo: "Unidades pedidas", formato: "numero" }, { clave: "unidades_recibidas", titulo: "Recibidas", formato: "numero" },
      { clave: "unidades_pendientes", titulo: "Faltan", formato: "numero" }, { clave: "total_estimado", titulo: "Total estimado", formato: "pesos" },
    ],
    filas,
    total: { total_estimado: suma(filas, "total_estimado") },
    nota: "Órdenes sin enviar, enviadas o recibidas en parte. “Recibidas” = lo contado en las recepciones finalizadas de la orden. El total estimado es de la orden completa, no de lo que falta.",
  }
}

// ─── 6. Cumplimiento del proveedor ─────────────────────────────────────────
export async function repCumplimiento(db: SupabaseClient, f: FiltrosCompras): Promise<TablaReporte> {
  const rows = await consulta(db, "jarvis_cumplimiento_proveedores", { p_desde: f.desde, p_hasta: f.hasta, p_proveedor_id: f.proveedorId ?? null }, ["proveedor_id"])
  const filas = rows.map((r) => ({
    proveedor: String(r.proveedor ?? "—"), ordenes_recibidas: n0(r.ordenes_recibidas), renglones_recibidos: n0(r.renglones_recibidos),
    faltantes: n0(r.faltantes), faltante_importe: red(r.faltante_importe), sobrantes: n0(r.sobrantes),
    diferencias_precio: n0(r.diferencias_precio), diferencia_precio_importe: red(r.diferencia_precio_importe),
    con_problema_pct: r.renglones_con_problema_pct == null ? null : red(r.renglones_con_problema_pct, 1),
  })).sort((a, b) => (b.con_problema_pct ?? -1) - (a.con_problema_pct ?? -1))
  return {
    titulo: `Cumplimiento de proveedores${f.proveedorNombre ? ` — ${f.proveedorNombre}` : ""}`,
    columnas: [
      { clave: "proveedor", titulo: "Proveedor" }, { clave: "ordenes_recibidas", titulo: "Órdenes recibidas", formato: "numero" },
      { clave: "renglones_recibidos", titulo: "Renglones recibidos", formato: "numero" }, { clave: "faltantes", titulo: "Faltantes", formato: "numero" },
      { clave: "faltante_importe", titulo: "Faltantes $", formato: "pesos" }, { clave: "sobrantes", titulo: "Sobrantes", formato: "numero" },
      { clave: "diferencias_precio", titulo: "Dif. de precio", formato: "numero" }, { clave: "diferencia_precio_importe", titulo: "Dif. de precio $", formato: "pesos" },
      { clave: "con_problema_pct", titulo: "Renglones con problema %", formato: "porcentaje" },
    ],
    filas,
    total: { faltante_importe: suma(filas, "faltante_importe"), diferencia_precio_importe: suma(filas, "diferencia_precio_importe") },
    nota: "Cuenta las diferencias de cantidad y de precio RESUELTAS en la verificación, en el período. Una diferencia todavía sin resolver no figura acá.",
  }
}

// ─── 7. Notas de crédito / débito esperadas ────────────────────────────────
export async function filasNotas(db: SupabaseClient, f: FiltrosCompras, diasLlegadas = 365) {
  const rows = await consulta(db, "jarvis_notas_esperadas", { p_proveedor_id: f.proveedorId ?? null, p_texto: f.texto || null, p_dias_llegadas: diasLlegadas }, ["nota_id"])
  return rows.map((r) => ({
    tipo: String(r.tipo), situacion: String(r.situacion), motivo: MOTIVO_NOTA[String(r.motivo)] ?? (String(r.motivo || "") || "—"),
    proveedor: String(r.proveedor ?? "—"), anotada: fechaSola(r.anotada), dias: n0(r.dias), total: red(r.total),
    numero_real: r.numero_real ?? null, fecha_real: fechaSola(r.fecha_real), orden: r.orden ?? null, factura: r.factura ?? null,
    articulos: textoArticulos(r.articulos),
  }))
}

/** [{ articulo, unidades, en }] → "10032 CREMA DENTAL (12 unidades); …" con los números en formato argentino */
function textoArticulos(v: unknown): string | null {
  const lista = Array.isArray(v) ? (v as Fila[]) : []
  if (!lista.length) return null
  const partes = [...new Set(lista.map((a) => `${String(a.articulo ?? "(sin artículo)")}${a.unidades == null ? "" : ` (${cantidadAR(a.unidades)} ${a.en === "bultos" ? "bultos" : "u."})`}`))]
  return partes.join("; ")
}

export async function repNotasEsperadas(db: SupabaseClient, f: FiltrosCompras): Promise<TablaReporte> {
  const filas = (await filasNotas(db, f, 0)).filter((x) => x.situacion === "esperada").sort((a, b) => b.dias - a.dias)
    .map((x) => ({ ...x, tramo: x.dias > 90 ? "más de 90 días" : x.dias > 60 ? "61 a 90 días" : x.dias > 30 ? "31 a 60 días" : "hasta 30 días" }))
  return {
    titulo: `Notas de crédito y débito esperadas${f.proveedorNombre ? ` — ${f.proveedorNombre}` : ""}`,
    columnas: [
      { clave: "proveedor", titulo: "Proveedor" }, { clave: "tipo", titulo: "Qué se espera" }, { clave: "motivo", titulo: "Por qué" },
      { clave: "anotada", titulo: "Desde", formato: "fecha" }, { clave: "dias", titulo: "Días esperando", formato: "numero" }, { clave: "tramo", titulo: "Antigüedad" },
      { clave: "total", titulo: "Importe", formato: "pesos" }, { clave: "factura", titulo: "Factura" }, { clave: "orden", titulo: "Orden" },
      { clave: "articulos", titulo: "Artículos" },
    ],
    filas,
    total: { total: suma(filas, "total") },
    nota: "Notas que el proveedor todavía no mandó. No son deuda ni crédito hasta que llega el comprobante real y se carga.",
  }
}

// ─── Entrada única para el endpoint de reportes ────────────────────────────
export const REPORTES_COMPRAS = {
  compras_proveedor_mes: { fn: repComprasProveedorMes, soloAdmin: false },
  costo_articulo: { fn: repCostoArticulo, soloAdmin: false },
  deuda_proveedores: { fn: repDeudaProveedores, soloAdmin: false },
  retenciones: { fn: repRetenciones, soloAdmin: true },
  oc_pendientes: { fn: repOcPendientes, soloAdmin: false },
  cumplimiento_proveedor: { fn: repCumplimiento, soloAdmin: false },
  notas_esperadas: { fn: repNotasEsperadas, soloAdmin: false },
} as const

export type ReporteCompras = keyof typeof REPORTES_COMPRAS
