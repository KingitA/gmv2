// Búsqueda LOCAL del catálogo sobre la réplica. Reemplaza a
// GET /api/vendedor/articulos?vista=buscar (lib/search/hybrid.ts), que necesita red.
//
// Mismo orden de resolución que el servidor:
//   1. CÓDIGO (solo dígitos, 3+): exactos por sku / código de bulto / EAN, después
//      prefijo de sku ordenado por sku.
//   2. TEXTO: todas las palabras (sin acentos, en cualquier orden, también pegadas),
//      con el mismo puntaje que search_articulos: la consulta completa como prefijo
//      (+0,5) y como substring (+0,3) sobre una base de similitud.
//   3. Si el texto exacto no alcanza (< 4 resultados) se toleran errores de tipeo por
//      trigramas (el servidor usa word_similarity > 0,5 de pg_trgm). La pata VECTORIAL
//      (embeddings de Gemini) no existe sin red: es la única diferencia.
//
// La prioridad por FILTRO ACTIVO (proveedor / categoría / ofertas…) es la de la web:
// dentro de un filtro se busca SOLO en la lista de ese filtro (filtrarLocal), y el
// escape a todo el catálogo es explícito. "shampoo" dentro de Kenvue nunca trae Algabo.

import { localMatch, normalizeLocal } from "@gm/vendedor"
import type { Articulo } from "../datasets"

export const eansDe = (a: Pick<Articulo, "ean13">): string[] =>
  (Array.isArray(a.ean13) ? a.ean13 : a.ean13 ? [a.ean13] : []).map((x) => String(x).trim()).filter(Boolean)

/** Lectores que se comen el cero inicial (igual que lib/utils/ean.ts del ERP). */
const padEan13 = (c: string) => (/^\d+$/.test(c) && c.length < 13 ? c.padStart(13, "0") : c)

interface Entrada {
  a: Articulo
  /** = search_text del servidor (menos los alias de proveedor, que no se replican) */
  texto: string
  compacto: string
  palabras: string[]
}

export interface IndiceCatalogo {
  articulos: Articulo[]
  porId: Map<string, Articulo>
  porCodigo: Map<string, Articulo[]>
  porProveedor: Map<string, Articulo[]>
  porCategoria: Map<string, Articulo[]>
  entradas: Entrada[]
  /** Por sku ascendente (para el prefijo de código) */
  porSku: Articulo[]
}

export function crearIndice(articulos: Articulo[]): IndiceCatalogo {
  const porId = new Map<string, Articulo>()
  const porCodigo = new Map<string, Articulo[]>()
  const porProveedor = new Map<string, Articulo[]>()
  const porCategoria = new Map<string, Articulo[]>()
  const entradas: Entrada[] = []
  const alta = (m: Map<string, Articulo[]>, k: string | null | undefined, a: Articulo) => {
    if (!k) return
    const l = m.get(k)
    if (l) l.push(a)
    else m.set(k, [a])
  }
  // Orden estable por descripción: es el orden de las vistas por categoría/proveedor de la web
  const ordenados = [...articulos].sort((x, y) => (x.descripcion || "").localeCompare(y.descripcion || "", "es"))
  for (const a of ordenados) {
    porId.set(a.id, a)
    const codigos = new Set<string>()
    for (const e of eansDe(a)) { codigos.add(e); codigos.add(padEan13(e)) }
    if (a.sku) codigos.add(String(a.sku).trim())
    if (a.codigo_bulto) codigos.add(String(a.codigo_bulto).trim())
    for (const c of codigos) alta(porCodigo, c, a)
    alta(porProveedor, a.proveedor_id, a)
    alta(porCategoria, a.categoria_id, a)
    const texto = normalizeLocal(
      [a.descripcion, a.sku, ...eansDe(a), a.codigo_bulto, a.sigla, a.categoria_nombre, a.subcategoria_nombre, a.rubro_nombre, a.marca, a.proveedor].filter(Boolean).join(" "),
    )
    entradas.push({ a, texto, compacto: texto.replace(/ /g, ""), palabras: texto.split(" ") })
  }
  const porSku = ordenados.filter((a) => a.sku).sort((x, y) => String(x.sku).localeCompare(String(y.sku)))
  return { articulos: ordenados, porId, porCodigo, porProveedor, porCategoria, entradas, porSku }
}

/** ¿Es un código escaneado? (colectora/lector: solo dígitos, 8-14 = EAN/DUN) — igual que la web. */
export const esScan = (v: string) => /^[0-9]{8,14}$/.test(v.trim())

/** Coincidencia EXACTA de un código con un artículo (sku o cualquiera de sus EAN). */
export const matchExacto = (a: Articulo, code: string) => a.sku === code || eansDe(a).includes(code)

export function buscarPorCodigo(ix: IndiceCatalogo, codigo: string): Articulo[] {
  const c = codigo.trim()
  if (!c) return []
  return ix.porCodigo.get(c) ?? ix.porCodigo.get(padEan13(c)) ?? []
}

// ── Trigramas (aproximación de pg_trgm para tolerar errores de tipeo) ──
const trigramas = (w: string): Set<string> => {
  const p = `  ${w} `
  const s = new Set<string>()
  for (let i = 0; i < p.length - 2; i++) s.add(p.slice(i, i + 3))
  return s
}
function similitud(a: Set<string>, b: Set<string>): number {
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter || 1)
}

export function buscarCatalogo(ix: IndiceCatalogo, q0: string, limite = 50): Articulo[] {
  const q = q0.trim()
  if (!q) return []
  const out: Articulo[] = []
  const vistos = new Set<string>()
  const sumar = (a: Articulo) => {
    if (!vistos.has(a.id)) { vistos.add(a.id); out.push(a) }
  }

  // 1. Código
  if (/^[0-9]{3,}$/.test(q)) {
    for (const a of buscarPorCodigo(ix, q)) sumar(a)
    for (const a of ix.porSku) {
      if (out.length >= limite) break
      if (String(a.sku).startsWith(q)) sumar(a)
    }
  }

  // 2. Texto: todas las palabras
  const nq = normalizeLocal(q)
  const toks = nq.split(" ").filter(Boolean)
  if (!toks.length) return out.slice(0, limite)
  const tq = trigramas(nq)
  const puntuar = (e: Entrada) => similitud(tq, trigramas(e.texto.slice(0, 80))) + (e.texto.startsWith(nq) ? 0.5 : 0) + (e.texto.includes(nq) ? 0.3 : 0)
  const hits: Array<{ a: Articulo; p: number }> = []
  for (const e of ix.entradas) if (toks.every((t) => e.texto.includes(t) || e.compacto.includes(t))) hits.push({ a: e.a, p: puntuar(e) })

  // 3. Tolerancia a errores de tipeo (solo si lo exacto no alcanza)
  if (hits.length < 4 && nq.length >= 3) {
    const tt = toks.map(trigramas)
    const ya = new Set(hits.map((h) => h.a.id))
    for (const e of ix.entradas) {
      if (ya.has(e.a.id)) continue
      const ok = toks.every((t, k) => e.texto.includes(t) || e.palabras.some((w) => similitud(tt[k]!, trigramas(w)) > 0.5))
      if (ok) hits.push({ a: e.a, p: puntuar(e) - 1 }) // siempre debajo de lo exacto
    }
  }
  hits.sort((x, y) => y.p - x.p)
  for (const h of hits) {
    if (out.length >= limite) break
    sumar(h.a)
  }
  return out.slice(0, limite)
}

/** Búsqueda DENTRO de un listado ya acotado (filtro/proveedor/categoría): = localMatch de la web. */
export function filtrarLocal(arts: Articulo[], q: string): Articulo[] {
  if (!q.trim()) return arts
  return arts.filter((a) => localMatch(q, a.descripcion, a.sku, eansDe(a), a.marca, a.subcategoria_nombre))
}

// ── Vistas que en la web resuelve el servidor (app/api/vendedor/articulos) ──

/** vista=ofertas: con descuento propio, mayor descuento primero, hasta 300. */
export const vistaOfertas = (ix: IndiceCatalogo) =>
  ix.articulos.filter((a) => a.descuento_propio > 0).sort((x, y) => y.descuento_propio - x.descuento_propio).slice(0, 300)

/** vista=novedades: últimos ingresos, hasta 80. */
export const vistaNovedades = (ix: IndiceCatalogo) =>
  [...ix.articulos].sort((x, y) => (y.created_at || "").localeCompare(x.created_at || "")).slice(0, 80)

/** vista=habituales: lo que el cliente pide seguido (frecuencia calculada por el servidor). */
export function vistaHabituales(ix: IndiceCatalogo, habituales: Array<{ articulo_id: string; veces_pedido: number; cantidad_habitual: number }>): Articulo[] {
  const out: Articulo[] = []
  for (const h of habituales) {
    const a = ix.porId.get(h.articulo_id)
    if (a) out.push({ ...a, veces_pedido: h.veces_pedido, cantidad_habitual: h.cantidad_habitual })
  }
  return out
}
