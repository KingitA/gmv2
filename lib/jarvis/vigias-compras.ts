/**
 * Vigías de COMPRAS (Tanda 2-B). Mismas reglas que el resto (lib/jarvis/vigias.ts): solo leen,
 * no usan IA, y lo que encuentran va a la bandeja "Lo que Jarvis notó". Si dejan de verlo, el
 * aviso se cierra solo.
 *
 *  - nc_esperadas        nota de crédito esperada de un proveedor sin llegar hace más de 30 días
 *  - oc_sin_recibir      orden enviada al proveedor que no llegó y ya pasó la fecha estimada
 *  - diferencia_precio   factura validada con una diferencia de precio que nadie resolvió
 *  - documentos_sin_leer documento de recepción "no leído" hace más de un día
 *  - lectura_ia          la lectura automática falló por saldo o cuota del servicio de IA (E-101)
 *
 * Las consultas son las de 20261119c_jarvis_compras.sql. Si la migración todavía no está
 * aplicada, cada vigía devuelve "nada" (no figura como fallado ni cierra avisos).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { pesosCorto } from "@/lib/playroom/bloques"
import { cargarVerificacionOC } from "@/lib/compras/cargar-verificacion"
import { CLAVE_AVISO_FALLA_IA, textoAvisoFallaIA, type ServicioIA } from "@/lib/ai/fallas-ia"
import { consulta, FaltaMigracion, type Fila } from "./reportes-compras"
import type { Candidato, Vigia } from "./vigias"

const DIAS_NC_ESPERADA = 30
const HORAS_DOCUMENTO_SIN_LEER = 24
const DIAS_FACTURA_RECIENTE = 90
const MAX_ORDENES_A_REVISAR = 25

const n0 = (v: unknown) => Number(v) || 0
const lista = (xs: string[], max = 3) => (xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} y ${xs.length - max} más`)
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Envuelve un vigía: sin la migración (o sin la tabla) no avisa nada, en vez de fallar todos los días. */
const siEstaInstalado = (v: Vigia): Vigia => async (db, hoy, r) => {
  try { return await v(db, hoy, r) } catch (e) {
    const err = e as { code?: string; message?: string } | null
    if (e instanceof FaltaMigracion || err?.code === "42P01" || err?.code === "PGRST205") return []
    throw e
  }
}

/** Notas de crédito que el proveedor nos debe hace más de 30 días. */
const ncEsperadas: Vigia = siEstaInstalado(async (db) => {
  const filas = (await consulta(db, "jarvis_notas_esperadas", { p_proveedor_id: null, p_texto: null, p_dias_llegadas: 0 }, ["nota_id"]))
    .filter((f) => f.situacion === "esperada" && f.tipo === "nota de crédito" && n0(f.dias) > DIAS_NC_ESPERADA)
    .sort((a, b) => n0(b.dias) - n0(a.dias))
  if (!filas.length) return []
  const total = filas.reduce((s, f) => s + n0(f.total), 0)
  const proveedores = [...new Set(filas.map((f) => String(f.proveedor ?? "—")))]
  return [{
    clave: "nc-esperadas-viejas", vigia: "nc_esperadas", tono: "atencion",
    titulo: `${plural(filas.length, "nota de crédito de proveedor lleva", "notas de crédito de proveedores llevan")} más de ${DIAS_NC_ESPERADA} días sin llegar (${pesosCorto(total)})`,
    detalle: `De ${lista(proveedores)}. La más vieja se espera hace ${n0(filas[0].dias)} días. Mientras no llegan, esa plata no baja lo que les debemos.`,
    acciones: [{ texto: "Ver cuáles", pregunta: `¿Qué notas de crédito nos deben los proveedores hace más de ${DIAS_NC_ESPERADA} días?` }],
    severidad: total, datos: { cantidad: filas.length, total, proveedores, mas_vieja_dias: n0(filas[0].dias) },
  }]
})

/** Órdenes enviadas al proveedor que no llegaron y ya pasó la fecha estimada. */
const ocSinRecibir: Vigia = siEstaInstalado(async (db) => {
  const filas = (await consulta(db, "jarvis_oc_pendientes", { p_proveedor_id: null }, ["orden_id"]))
    .filter((f) => f.enviada && n0(f.dias_atraso) > 0 && n0(f.unidades_pedidas) - n0(f.unidades_recibidas) > 0)
    .sort((a, b) => n0(b.dias_atraso) - n0(a.dias_atraso))
  if (!filas.length) return []
  const total = filas.reduce((s, f) => s + n0(f.total_estimado), 0)
  return [{
    clave: "oc-sin-recibir", vigia: "oc_sin_recibir", tono: "atencion",
    titulo: `${plural(filas.length, "orden de compra enviada no llegó", "órdenes de compra enviadas no llegaron")} y ya pasó la fecha estimada`,
    detalle: `${lista(filas.map((f) => `${f.orden} de ${f.proveedor} (${n0(f.dias_atraso)} días)`))}.${total > 0 ? ` Son ${pesosCorto(total)} en mercadería pedida.` : ""}`,
    acciones: [{ texto: "Ver órdenes", pregunta: "¿Qué órdenes de compra estamos esperando y cuáles están atrasadas?", href: "/ordenes-compra" }],
    severidad: filas.reduce((s, f) => s + n0(f.dias_atraso), 0) * 1000 + total / 1000,
    datos: { ordenes: filas.map((f) => f.orden), mas_atrasada_dias: n0(filas[0].dias_atraso) },
  }]
})

/**
 * Facturas validadas con una diferencia de precio que nadie resolvió. La diferencia se calcula
 * con la MISMA cuenta que la pantalla de verificación (lib/compras/cargar-verificacion.ts):
 * acá no se inventa otra regla de tolerancia.
 */
const diferenciaPrecio: Vigia = siEstaInstalado(async (db, hoy) => {
  const desde = new Date(Date.parse(hoy + "T12:00:00Z") - DIAS_FACTURA_RECIENTE * 86_400_000).toISOString() // formato-ok: límite de antigüedad, no es "hoy"
  const { data, error } = await db.from("comprobantes_compra")
    .select("orden_compra_id, fecha_validacion, ordenes_compra!inner(id, numero_orden, estado)")
    .in("estado", ["validado", "cerrado"]).in("tipo_comprobante", ["FA", "FB", "FC", "Adquisicion", "ADQ"])
    .not("orden_compra_id", "is", null).gte("fecha_validacion", desde)
    .order("fecha_validacion", { ascending: false }).limit(300)
  if (error) throw new Error(error.message)
  const ordenes = new Map<string, string>()
  for (const c of (data ?? []) as Fila[]) {
    const oc = Array.isArray(c.ordenes_compra) ? c.ordenes_compra[0] : c.ordenes_compra
    if (!oc || ["finalizada", "cancelada"].includes(String(oc.estado))) continue
    if (!ordenes.has(oc.id) && ordenes.size < MAX_ORDENES_A_REVISAR) ordenes.set(oc.id, String(oc.numero_orden))
  }
  if (!ordenes.size) return []
  const conDiferencia: { orden: string; proveedor: string; renglones: number; importe: number }[] = []
  for (const [id, numero] of ordenes) {
    const v = await cargarVerificacionOC(db, id)
    if (!v) continue
    const filas = v.verificacion.filas.filter((f) => f.banderas.includes("precio"))
    if (!filas.length) continue
    conDiferencia.push({
      orden: numero, proveedor: v.orden.proveedor_nombre ?? "—", renglones: filas.length,
      // a favor del proveedor = nos facturó más caro (lo que hay que reclamar o aceptar)
      importe: filas.reduce((s, f) => s + (f.dif.precio?.a_favor === "proveedor" ? n0(f.dif.precio.total) : 0), 0),
    })
  }
  if (!conDiferencia.length) return []
  const total = conDiferencia.reduce((s, x) => s + x.importe, 0)
  const renglones = conDiferencia.reduce((s, x) => s + x.renglones, 0)
  return [{
    clave: "diferencia-precio-sin-resolver", vigia: "diferencia_precio", tono: "alerta",
    titulo: `${plural(conDiferencia.length, "orden tiene", "órdenes tienen")} facturas validadas con diferencias de precio sin resolver${total > 0 ? ` (${pesosCorto(total)} facturados de más)` : ""}`,
    detalle: `${lista(conDiferencia.map((x) => `${x.orden} de ${x.proveedor}`))}: ${plural(renglones, "artículo", "artículos")} a un precio distinto del acordado. Hay que decidir en la verificación si se acepta el precio o se le reclama al proveedor.`,
    acciones: [{ texto: "Ir a órdenes de compra", pregunta: "¿Qué órdenes de compra tienen diferencias de precio sin resolver?", href: "/ordenes-compra" }],
    severidad: Math.max(total, renglones * 1000), datos: { ordenes: conDiferencia },
  }]
})

/** Documentos de recepción que el sistema no pudo leer y siguen así hace más de un día. */
const documentosSinLeer: Vigia = siEstaInstalado(async (db) => {
  const filas = (await consulta(db, "jarvis_documentos_sin_leer", { p_horas: HORAS_DOCUMENTO_SIN_LEER }, ["documento_id"]))
    .sort((a, b) => n0(b.horas) - n0(a.horas))
  if (!filas.length) return []
  const ordenes = [...new Set(filas.map((f) => String(f.orden ?? "recepción sin orden")))]
  return [{
    clave: "documentos-sin-leer", vigia: "documentos_sin_leer", tono: "atencion",
    titulo: `${plural(filas.length, "documento de recepción lleva", "documentos de recepción llevan")} más de un día sin leerse`,
    detalle: `De ${lista(ordenes)}. Son facturas o remitos que subió el depósito y la lectura automática no pudo procesar: hay que volver a leerlos o cargar el comprobante a mano para poder verificar y validar.`,
    acciones: [{ texto: "Ir a órdenes de compra", pregunta: "¿Qué documentos de recepción quedaron sin leer y de qué órdenes son?", href: "/ordenes-compra" }],
    severidad: filas.length * 10 + n0(filas[0].horas), datos: { cantidad: filas.length, ordenes, mas_viejo_horas: n0(filas[0].horas) },
  }]
})

/** E-101: un servicio de IA rechazó pedidos por saldo o cuota en las últimas 24 horas. */
const lecturaIA: Vigia = siEstaInstalado(async (db) => {
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { data, error } = await db.from("ia_fallas").select("servicio, estado, created_at").gte("created_at", desde).order("created_at", { ascending: false }).limit(500)
  if (error) throw error
  const porServicio = new Map<ServicioIA, { veces: number; estado: number | null }>()
  for (const f of (data ?? []) as Fila[]) {
    const s = (f.servicio === "claude" ? "claude" : "gemini") as ServicioIA
    const x = porServicio.get(s) ?? { veces: 0, estado: f.estado ?? null }   // el primero es el más reciente
    x.veces++
    porServicio.set(s, x)
  }
  return [...porServicio.entries()].map(([servicio, x]): Candidato => {
    const t = textoAvisoFallaIA(servicio, x.veces, x.estado)
    return {
      clave: CLAVE_AVISO_FALLA_IA[servicio], vigia: "lectura_ia", tono: "alerta", titulo: t.titulo, detalle: t.detalle,
      acciones: [], severidad: 100 + x.veces, datos: { servicio, veces: x.veces, estado: x.estado },
    }
  })
})

export const VIGIAS_COMPRAS: Record<string, Vigia> = {
  nc_esperadas: ncEsperadas,
  oc_sin_recibir: ocSinRecibir,
  diferencia_precio: diferenciaPrecio,
  documentos_sin_leer: documentosSinLeer,
  lectura_ia: lecturaIA,
}
