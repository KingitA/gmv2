/**
 * Listas de precios de proveedor, del lado del servidor (Tanda 2-C): un solo lugar para crear una
 * lista (la carga de la oficina y la que llega por mail usan lo mismo), armar la vista previa y
 * firmar los enlaces a los archivos.
 */
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { MatchingEngine } from "@/lib/matching/matcher"
import { avisoPrecioVenta, cambioDeItem, precioPorDe, TOPE_CAMBIO_PCT, UMBRAL_ALERTA_PCT, type AvisoVenta, type CambioLista, type FilaLista, type PrecioPor } from "./lista-proveedor"
import { tipoDescuentoDe } from "./neto-compra"
import { fecha } from "@/lib/formato"

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const faltaColumna = (e: any) => !!e && (e.code === "PGRST204" || e.code === "42703")

async function firmar(supabase: any, rutaCruda: string | null | undefined): Promise<string | null> {
  if (!rutaCruda) return null
  let bucket = "comprobantes"
  let ruta = rutaCruda
  if (ruta.startsWith("attachments:")) { bucket = "attachments"; ruta = ruta.slice("attachments:".length) }
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(decodeURIComponent(ruta), 3600)
  if (error) { console.warn("[listas] no se pudo firmar el archivo:", error.message); return null }
  return data?.signedUrl || null
}

/** Enlaces a los archivos de la lista (un mail puede traer varios). El bucket es privado: se firman por una hora. */
export async function enlacesArchivosLista(supabase: any, lista: { storage_path?: string | null; archivo_url?: string | null; archivos?: any }): Promise<Array<{ nombre: string; enlace: string }>> {
  const rutas: Array<{ nombre: string; ruta: string }> = []
  if (Array.isArray(lista.archivos)) for (const a of lista.archivos) if (a?.ruta) rutas.push({ nombre: String(a.nombre || "archivo"), ruta: String(a.ruta) })
  if (rutas.length === 0 && lista.storage_path) rutas.push({ nombre: "archivo", ruta: lista.storage_path })
  // listas viejas: solo quedó la URL "pública" (que un bucket privado no sirve)
  if (rutas.length === 0 && lista.archivo_url) {
    const r = lista.archivo_url.match(/\/comprobantes\/(.+?)(\?|$)/)?.[1]
    if (r) rutas.push({ nombre: "archivo", ruta: r })
  }
  const salida: Array<{ nombre: string; enlace: string }> = []
  for (const r of rutas) {
    const enlace = await firmar(supabase, r.ruta)
    if (enlace) salida.push({ nombre: r.nombre, enlace })
  }
  return salida
}

/**
 * Un renglón de la lista tal como viene del archivo. El artículo NO viene resuelto de afuera (antes
 * el mail lo traía decidido y salteaba la regla del proveedor): lo decide siempre vincularRenglon.
 */
export type ItemParaLista = FilaLista

/**
 * El vínculo de UN renglón con nuestros artículos, en contexto de compra del proveedor (lo mismo
 * para la carga a mano, la que llega por mail y cuando se elige el proveedor después):
 *   articuloId → encontrado con seguridad entre los del proveedor: se aplica;
 *   sugeridoId → parecido, o de otro proveedor: queda "por revisar".
 * SIN proveedor no hay "seguro": lo encontrado queda como sugerencia (no se sabe de quién es la lista).
 */
async function vincularRenglon(engine: MatchingEngine, it: FilaLista, proveedorId: string | null): Promise<{ articuloId: string | null; sugeridoId: string | null }> {
  if (!it.codigo && !it.descripcion) return { articuloId: null, sugeridoId: null }
  try {
    // contexto de compra: el código exacto y los artículos del proveedor primero; uno de otro
    // proveedor nunca se asigna solo
    const m = await engine.resolveItem({ description: it.descripcion || "", code: it.codigo || undefined, price: it.precio_compra ?? undefined }, proveedorId || "", proveedorId ? {} : null)
    const best = m.bestCandidate
    if (!best?.sku_id) return { articuloId: null, sugeridoId: null }
    if (proveedorId && m.status === "matched" && !best.otro_proveedor) return { articuloId: best.sku_id, sugeridoId: null }
    if (best.confidence_level === "suggestion" || best.otro_proveedor || (!proveedorId && m.status === "matched")) return { articuloId: null, sugeridoId: best.sku_id }
  } catch (e: any) {
    console.warn("[listas] matching:", e?.message || e)
  }
  return { articuloId: null, sugeridoId: null }
}

/** Vincula muchos renglones, de a unos pocos a la vez (cada uno consulta la base y arma un embedding). */
async function vincularRenglones(items: FilaLista[], proveedorId: string | null) {
  const engine = new MatchingEngine()
  const salida: Array<{ articuloId: string | null; sugeridoId: string | null }> = new Array(items.length)
  const LOTE = 5
  for (let i = 0; i < items.length; i += LOTE) {
    const r = await Promise.all(items.slice(i, i + LOTE).map((it) => vincularRenglon(engine, it, proveedorId)))
    r.forEach((v, j) => { salida[i + j] = v })
  }
  return salida
}

/**
 * Crea la lista con sus renglones. Cada renglón queda:
 *   pendiente  → artículo encontrado con seguridad entre los del proveedor: se aplica;
 *   revisar    → artículo sugerido (parecido, o de otro proveedor, o lista sin proveedor): falta confirmarlo;
 *   ignorado   → sin artículo.
 * Una lista SIN proveedor (mail de alguien que no se identificó) no tiene ningún renglón "pendiente"
 * y no se puede aplicar hasta que se elija el proveedor (asignarProveedorLista).
 * Todo o nada: si los renglones no se pueden guardar, la cabecera se borra (no queda una lista vacía).
 */
export async function crearListaProveedor(supabase: any, p: {
  proveedor_id: string | null
  nombre: string
  fecha_vigencia: string
  fecha_fin?: string | null
  observaciones?: string | null
  /** En qué viene el precio del archivo (unidad | bulto). Sin dato: el del proveedor; si no, unidad. */
  precio_por?: PrecioPor | null
  storage_path?: string | null
  archivos?: Array<{ nombre: string; ruta: string }> | null
  archivo_url?: string | null
  origen: "manual" | "mail"
  email_id?: string | null
  creado_por?: string | null
  items: ItemParaLista[]
}): Promise<{ lista_id: string; precio_por: PrecioPor; stats: { total: number; pendientes: number; revisar: number; sin_articulo: number } }> {
  let precioPor: PrecioPor | null = p.precio_por ?? null
  if (!precioPor && p.proveedor_id) {
    const { data: prov } = await supabase.from("proveedores").select("*").eq("id", p.proveedor_id).maybeSingle()
    if (prov?.lista_precio_por) precioPor = precioPorDe(prov.lista_precio_por)
  }
  precioPor = precioPor ?? "unidad"

  const cabecera: Record<string, unknown> = {
    proveedor_id: p.proveedor_id || null,
    nombre: p.nombre,
    fecha_vigencia: p.fecha_vigencia,
    fecha_fin: p.fecha_fin || null,
    archivo_url: p.archivo_url || null,
    observaciones: p.observaciones || null,
    estado: "pendiente",
    creado_por: p.creado_por || null,
  }
  // columnas de la migración 20261119a: si todavía no está, la lista se crea igual sin ellas
  let { data: lista, error } = await supabase.from("listas_proveedores")
    .insert({ ...cabecera, storage_path: p.storage_path || p.archivos?.[0]?.ruta || null, archivos: p.archivos?.length ? p.archivos : null, origen: p.origen, email_id: p.email_id || null, precio_por: precioPor })
    .select("id").single()
  if (faltaColumna(error)) ({ data: lista, error } = await supabase.from("listas_proveedores").insert(cabecera).select("id").single())
  if (error || !lista) throw new Error(error?.message || "No se pudo crear la lista")

  try {
    const vinculos = await vincularRenglones(p.items, p.proveedor_id || null)
    const filas: any[] = []
    for (const [n, it] of p.items.entries()) {
      const { articuloId, sugeridoId } = vinculos[n]
      filas.push({
        lista_id: lista.id,
        articulo_id: articuloId,
        articulo_sugerido_id: sugeridoId,
        codigo_proveedor: it.codigo || null,
        descripcion_proveedor: it.descripcion || null,
        precio_compra: it.precio_compra ?? null,
        // vacío = null ("no tocar"); 0 = 0
        descuento1: it.descuento1 ?? null, descuento2: it.descuento2 ?? null, descuento3: it.descuento3 ?? null, descuento4: it.descuento4 ?? null,
        estado_item: articuloId ? "pendiente" : sugeridoId ? "revisar" : "ignorado",
      })
    }
    for (let i = 0; i < filas.length; i += 500) {
      const lote = filas.slice(i, i + 500)
      let ins = await supabase.from("listas_proveedores_items").insert(lote)
      if (faltaColumna(ins.error)) {
        // sin la migración: no hay dónde anotar el sugerido; el renglón queda sin artículo
        ins = await supabase.from("listas_proveedores_items").insert(lote.map(({ articulo_sugerido_id: _s, ...r }) => ({ ...r, estado_item: r.articulo_id ? "pendiente" : "ignorado" })))
      }
      if (ins.error) throw new Error(`No se pudieron guardar los renglones de la lista: ${ins.error.message}`)
    }
    return {
      lista_id: lista.id,
      precio_por: precioPor,
      stats: {
        total: filas.length,
        pendientes: filas.filter((f) => f.estado_item === "pendiente").length,
        revisar: filas.filter((f) => f.estado_item === "revisar").length,
        sin_articulo: filas.filter((f) => f.estado_item === "ignorado").length,
      },
    }
  } catch (e) {
    // Todo o nada: no queda una lista a medias (los renglones se van con ella, ON DELETE CASCADE)
    const { error: delErr } = await supabase.from("listas_proveedores").delete().eq("id", lista.id)
    if (delErr) console.error("[listas] no se pudo deshacer la lista a medias:", delErr.message)
    throw e
  }
}

export interface ItemVistaPrevia {
  id: string
  estado_item: string
  error: string | null
  codigo_proveedor: string | null
  descripcion_proveedor: string | null
  articulo: { id: string; sku: string | null; descripcion: string | null; unidades_por_bulto: number | null } | null
  sugerido: { id: string; sku: string | null; descripcion: string | null; otro_proveedor: string | null } | null
  /** Lo que trae el archivo (null = no toca ese dato) */
  archivo: { precio_compra: number | null; descuentos: Array<number | null> }
  cambio: CambioLista | null
  venta: AvisoVenta | null
  /** Hay una lista POSTERIOR ya aplicada del mismo proveedor para este artículo: no se pisa */
  lista_posterior: string | null
  /** Ya confirmado a mano aunque supere el tope */
  confirmado_tope: boolean
}

export type FiltroLista = "todos" | "cambian" | "alertas" | "frenados" | "venta" | "revisar" | "sin_articulo" | "errores"

export interface VistaPreviaLista {
  lista: any
  proveedor_nombre: string | null
  tipo_descuento: string
  precio_por: PrecioPor
  /** Valor por defecto guardado en el proveedor (null = nunca se eligió) */
  precio_por_proveedor: PrecioPor | null
  tope_pct: number
  archivos: Array<{ nombre: string; enlace: string }>
  umbral_pct: number
  /**
   * Cambios de costo que esta lista dejó en el historial (precios_compra_historial). 0 = no cambió
   * ningún costo: se puede eliminar. null = no se pudo saber (falta la migración 20261119a).
   */
  cambios_de_costo: number | null
  /** Solo una página de renglones (los que pasan el filtro); `total_filtrados` dice cuántos hay */
  items: ItemVistaPrevia[]
  pagina: number
  por_pagina: number
  total_filtrados: number
  resumen: {
    total: number
    /** Renglones que se aplicarían (pendientes con artículo, sin freno ni lista posterior) */
    se_aplican: number
    con_cambio: number
    sin_cambio: number
    subas_grandes: number
    bajas_grandes: number
    /** Pendientes que NO se van a aplicar sin confirmarlos (superan el tope, o bulto sin unidades por bulto) */
    frenados: number
    lista_posterior: number
    por_revisar: number
    sin_articulo: number
    con_error: number
    aplicados: number
    /** De los ya aplicados: cuántos cambiaron el costo del artículo y cuántos ya estaban igual */
    aplicados_con_cambio: number
    aplicados_sin_cambio: number
    venta_desactualizados: number
    venta_cambian_solos: number
  }
}

const POR_PAGINA = 200

/**
 * Todo lo que muestra la pantalla de una lista, armado en el servidor. Las cuentas (resumen) son de
 * TODA la lista; los renglones se devuelven de a una página y ya filtrados, para que una lista de
 * miles de renglones no tarde ni pese.
 */
export async function vistaPreviaLista(supabase: any, listaId: string, op: { umbral_pct?: number | null; filtro?: FiltroLista | null; pagina?: number | null; por_pagina?: number | null; todos?: boolean } = {}): Promise<VistaPreviaLista | null> {
  const { data: lista, error } = await supabase.from("listas_proveedores").select("*, proveedor:proveedores(*)").eq("id", listaId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!lista) return null
  const prov: any = Array.isArray(lista.proveedor) ? lista.proveedor[0] : lista.proveedor
  const tipoDescuento = tipoDescuentoDe(prov?.tipo_descuento)
  const umbral = op.umbral_pct && op.umbral_pct > 0 ? op.umbral_pct : UMBRAL_ALERTA_PCT
  const precioPor = precioPorDe(lista.precio_por)
  const tope = num(lista.tope_pct) > 0 ? num(lista.tope_pct) : TOPE_CAMBIO_PCT

  const items: any[] = await fetchAllRows(() => supabase.from("listas_proveedores_items").select("*").eq("lista_id", listaId).order("created_at").order("id"))
  const idsArt = [...new Set(items.flatMap((i) => [i.articulo_id, i.articulo_sugerido_id]).filter(Boolean))] as string[]
  const arts = new Map<string, any>()
  // de a 300 ids, varias consultas a la vez
  const tandas: string[][] = []
  for (let i = 0; i < idsArt.length; i += 300) tandas.push(idsArt.slice(i, i + 300))
  for (let i = 0; i < tandas.length; i += 6) {
    const res = await Promise.all(tandas.slice(i, i + 6).map((ids) => supabase.from("articulos")
      .select("id, sku, descripcion, proveedor_id, unidades_por_bulto, precio_compra, descuento1, descuento2, descuento3, descuento4, precio_base, porcentaje_ganancia, bonif_recargo")
      .in("id", ids)))
    for (const r of res) {
      if (r.error) throw new Error(r.error.message)
      for (const a of r.data || []) arts.set(a.id, a)
    }
  }
  const idsProv = [...new Set([...arts.values()].map((a) => a.proveedor_id).filter((id) => id && id !== lista.proveedor_id))] as string[]
  const nombreProv = new Map<string, string>()
  if (idsProv.length > 0) {
    const { data } = await supabase.from("proveedores").select("id, nombre").in("id", idsProv)
    for (const pr of data || []) nombreProv.set(pr.id, pr.nombre)
  }

  // Listas POSTERIORES ya aplicadas del mismo proveedor: los artículos que tocaron no se pisan
  const posterior = new Map<string, string>()
  if (lista.estado !== "aplicada" && lista.proveedor_id) {
    const { data: posteriores } = await supabase.from("listas_proveedores").select("id, nombre, fecha_vigencia")
      .eq("proveedor_id", lista.proveedor_id).eq("estado", "aplicada").gt("fecha_vigencia", lista.fecha_vigencia).neq("id", listaId)
    const idsPost = ((posteriores || []) as any[]).map((l) => l.id)
    if (idsPost.length > 0) {
      const nombreLista = new Map<string, string>(((posteriores || []) as any[]).map((l) => [l.id, `${l.nombre || "lista"} (rige desde ${fecha(l.fecha_vigencia)})`]))
      const h = await supabase.from("precios_compra_historial").select("articulo_id, lista_proveedor_id").in("lista_proveedor_id", idsPost)
      // sin la migración 20261119a la columna no existe: no hay listas posteriores que mirar
      if (!h.error) for (const f of (h.data || []) as any[]) if (!posterior.has(f.articulo_id)) posterior.set(f.articulo_id, nombreLista.get(f.lista_proveedor_id) || "lista posterior")
    }
  }

  const todos: ItemVistaPrevia[] = items.map((it) => {
    const a = it.articulo_id ? arts.get(it.articulo_id) : null
    const s = it.articulo_sugerido_id ? arts.get(it.articulo_sugerido_id) : null
    const archivo = { precio_compra: it.precio_compra != null ? num(it.precio_compra) : null, descuentos: [it.descuento1, it.descuento2, it.descuento3, it.descuento4].map((d: unknown) => (d == null ? null : num(d))) }
    // Ya aplicado: el "antes" es el que se guardó al aplicar, no el artículo de hoy
    const base = it.estado_item === "aplicado" && it.precio_anterior != null
      ? { ...a, precio_compra: it.precio_anterior, descuento1: it.descuento1_anterior, descuento2: it.descuento2_anterior, descuento3: it.descuento3_anterior, descuento4: it.descuento4_anterior }
      : a
    const cambio = a
      ? cambioDeItem(
          { precio_compra: archivo.precio_compra, descuento1: archivo.descuentos[0], descuento2: archivo.descuentos[1], descuento3: archivo.descuentos[2], descuento4: archivo.descuentos[3] },
          base, tipoDescuento, umbral,
          { precio_por: precioPor, unidades_por_bulto: a.unidades_por_bulto, tope_pct: tope, confirmado: !!it.confirmado_tope || it.estado_item === "aplicado" })
      : null
    return {
      id: it.id, estado_item: it.estado_item, error: it.error ?? null,
      codigo_proveedor: it.codigo_proveedor ?? null, descripcion_proveedor: it.descripcion_proveedor ?? null,
      articulo: a ? { id: a.id, sku: a.sku ?? null, descripcion: a.descripcion ?? null, unidades_por_bulto: num(a.unidades_por_bulto) || null } : null,
      sugerido: s ? { id: s.id, sku: s.sku ?? null, descripcion: s.descripcion ?? null, otro_proveedor: s.proveedor_id && s.proveedor_id !== lista.proveedor_id ? (nombreProv.get(s.proveedor_id) || "otro proveedor") : null } : null,
      archivo,
      cambio,
      venta: a && cambio ? avisoPrecioVenta(a, cambio.actual.neto, cambio.nuevo.neto) : null,
      lista_posterior: a && it.estado_item !== "aplicado" ? posterior.get(a.id) ?? null : null,
      confirmado_tope: !!it.confirmado_tope,
    }
  })

  const pendientes = todos.filter((i) => i.estado_item === "pendiente" && i.articulo)
  const frenados = pendientes.filter((i) => !i.lista_posterior && !!i.cambio?.frena)
  const conPosterior = pendientes.filter((i) => !!i.lista_posterior)
  const seAplican = pendientes.filter((i) => !i.lista_posterior && !i.cambio?.frena)
  const cambia = (i: ItemVistaPrevia) => !!i.cambio && Object.keys(i.cambio.cambios).length > 0
  const conCambio = seAplican.filter(cambia)

  const filtro = op.filtro || "todos"
  const filtrados = todos.filter((i) => {
    if (filtro === "cambian") return seAplican.includes(i) && cambia(i)
    if (filtro === "alertas") return !!i.cambio?.alerta && i.estado_item !== "ignorado"
    if (filtro === "frenados") return frenados.includes(i) || conPosterior.includes(i)
    if (filtro === "venta") return i.venta?.tipo === "desactualizado" && seAplican.includes(i)
    if (filtro === "revisar") return i.estado_item === "revisar"
    if (filtro === "sin_articulo") return i.estado_item === "ignorado"
    if (filtro === "errores") return i.estado_item === "error"
    return true
  })
  const porPagina = op.por_pagina && op.por_pagina > 0 ? Math.min(op.por_pagina, 1000) : POR_PAGINA
  const pagina = op.pagina && op.pagina > 0 ? Math.floor(op.pagina) : 1

  return {
    lista: { ...lista, proveedor: undefined },
    proveedor_nombre: prov?.nombre ?? null,
    tipo_descuento: tipoDescuento,
    precio_por: precioPor,
    precio_por_proveedor: prov?.lista_precio_por ? precioPorDe(prov.lista_precio_por) : null,
    tope_pct: tope,
    archivos: await enlacesArchivosLista(supabase, lista),
    umbral_pct: umbral,
    cambios_de_costo: await cambiosDeCostoDeLista(supabase, listaId),
    items: op.todos ? filtrados : filtrados.slice((pagina - 1) * porPagina, pagina * porPagina),
    pagina,
    por_pagina: porPagina,
    total_filtrados: filtrados.length,
    resumen: {
      total: todos.length,
      se_aplican: seAplican.length,
      con_cambio: conCambio.length,
      sin_cambio: seAplican.length - conCambio.length,
      subas_grandes: conCambio.filter((i) => i.cambio?.alerta === "suba").length,
      bajas_grandes: conCambio.filter((i) => i.cambio?.alerta === "baja").length,
      frenados: frenados.length,
      lista_posterior: conPosterior.length,
      por_revisar: todos.filter((i) => i.estado_item === "revisar").length,
      sin_articulo: todos.filter((i) => i.estado_item === "ignorado").length,
      con_error: todos.filter((i) => i.estado_item === "error").length,
      aplicados: todos.filter((i) => i.estado_item === "aplicado").length,
      aplicados_con_cambio: todos.filter((i) => i.estado_item === "aplicado" && cambia(i)).length,
      aplicados_sin_cambio: todos.filter((i) => i.estado_item === "aplicado" && !cambia(i)).length,
      venta_desactualizados: conCambio.filter((i) => i.venta?.tipo === "desactualizado").length,
      venta_cambian_solos: conCambio.filter((i) => i.venta?.tipo === "cambia_solo").length,
    },
  }
}

/**
 * Elige (o corrige) el proveedor de una lista que todavía no se aplicó — típicamente una que llegó
 * por mail de alguien que no se pudo identificar. Vuelve a vincular los renglones que decidió la
 * máquina (por revisar, y sin artículo ni sugerencia) en contexto de ESE proveedor: lo encontrado
 * con seguridad entre sus artículos queda para aplicar. Lo que alguien ya confirmó o descartó a mano
 * no se toca. Una lista con algún renglón aplicado no cambia de proveedor.
 */
export async function asignarProveedorLista(supabase: any, listaId: string, proveedorId: string): Promise<{ revinculados: number; pendientes: number; revisar: number }> {
  const { data: prov } = await supabase.from("proveedores").select("*").eq("id", proveedorId).maybeSingle()
  if (!prov) throw Object.assign(new Error("El proveedor no existe."), { status: 404 })
  const { data: lista } = await supabase.from("listas_proveedores").select("id, estado, proveedor_id").eq("id", listaId).maybeSingle()
  if (!lista) throw Object.assign(new Error("La lista no existe."), { status: 404 })
  if (lista.estado === "aplicada" || lista.estado === "programada") throw Object.assign(new Error("La lista ya está aplicada o programada: no se puede cambiar el proveedor."), { status: 409 })
  const { count: aplicados } = await supabase.from("listas_proveedores_items").select("id", { count: "exact", head: true }).eq("lista_id", listaId).eq("estado_item", "aplicado")
  if ((aplicados ?? 0) > 0) throw Object.assign(new Error("La lista ya tiene renglones aplicados: no se puede cambiar el proveedor."), { status: 409 })

  const cambios: Record<string, unknown> = { proveedor_id: proveedorId }
  if (prov.lista_precio_por) cambios.precio_por = precioPorDe(prov.lista_precio_por)
  let upd = await supabase.from("listas_proveedores").update(cambios).eq("id", listaId)
  if (faltaColumna(upd.error)) upd = await supabase.from("listas_proveedores").update({ proveedor_id: proveedorId }).eq("id", listaId)
  if (upd.error) throw new Error(upd.error.message)

  // Lo que decidió la máquina: "por revisar" sin error (los frenados por el tope tienen motivo y ya
  // tienen artículo) y "sin artículo" sin sugerencia. Lo confirmado o descartado a mano queda igual.
  const items: any[] = await fetchAllRows(() => supabase.from("listas_proveedores_items")
    .select("id, estado_item, articulo_id, articulo_sugerido_id, error, codigo_proveedor, descripcion_proveedor, precio_compra")
    .eq("lista_id", listaId).in("estado_item", ["revisar", "ignorado"]).order("created_at").order("id"))
  const aRevincular = items.filter((i) => !i.articulo_id && !i.error && (i.estado_item === "revisar" || !i.articulo_sugerido_id))
  const vinculos = await vincularRenglones(aRevincular.map((i) => ({
    codigo: i.codigo_proveedor, descripcion: i.descripcion_proveedor, precio_compra: i.precio_compra != null ? num(i.precio_compra) : null,
    descuento1: null, descuento2: null, descuento3: null, descuento4: null,
  })), proveedorId)
  let pendientes = 0, revisar = 0
  for (const [n, it] of aRevincular.entries()) {
    const { articuloId, sugeridoId } = vinculos[n]
    const estado = articuloId ? "pendiente" : sugeridoId ? "revisar" : "ignorado"
    if (estado === "pendiente") pendientes++
    else if (estado === "revisar") revisar++
    const r = await supabase.from("listas_proveedores_items").update({ articulo_id: articuloId, articulo_sugerido_id: sugeridoId, estado_item: estado }).eq("id", it.id)
    if (r.error) throw new Error(`No se pudo volver a vincular un renglón: ${r.error.message}`)
  }
  return { revinculados: aRevincular.length, pendientes, revisar }
}

/** Cuántos cambios de costo dejó una lista en el historial. null si no se puede saber. */
export async function cambiosDeCostoDeLista(supabase: any, listaId: string): Promise<number | null> {
  const { count, error } = await supabase.from("precios_compra_historial").select("id", { count: "exact", head: true }).eq("lista_proveedor_id", listaId)
  if (error) { console.warn("[listas] no se pudo contar el historial de la lista:", error.message); return null }
  return count ?? 0
}
