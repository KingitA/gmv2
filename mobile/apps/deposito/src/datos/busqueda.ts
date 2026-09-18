// Búsqueda LOCAL de artículos sobre la réplica (reemplaza a GET /api/deposito/picking?q=
// y a buscarArticulosDeposito de la web, que necesitan red). Misma prioridad que el
// servidor: código exacto (EAN13 / código de bulto, con y sin ceros a la izquierda)
// y después texto (todas las palabras, sin acentos, en cualquier orden).

export interface Buscable {
  id: string
  sku?: string | null
  descripcion?: string | null
  ean13?: string[] | string | null
  codigo_bulto?: string | null
  marca?: string | { descripcion?: string | null } | null
}

/** Igual que lib/utils/ean.ts del ERP: lectores que se comen el cero inicial. */
export function padEan13(code: string): string {
  const t = code.trim()
  return /^\d+$/.test(t) && t.length < 13 ? t.padStart(13, "0") : t
}

export function eansDe(a: Pick<Buscable, "ean13">): string[] {
  const e = a.ean13
  return (Array.isArray(e) ? e : e ? [e] : []).map((x) => String(x).trim()).filter(Boolean)
}

export function marcaDe(a: Buscable): string | null {
  const m = a.marca
  return typeof m === "string" ? m : m?.descripcion || null
}

export function normalizar(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Todas las palabras de `q` aparecen en los campos (o en su versión sin espacios). */
export function coincide(q: string, ...campos: Array<string | null | undefined>): boolean {
  const texto = normalizar(campos.filter(Boolean).join(" "))
  const compacto = texto.replace(/ /g, "")
  const toks = normalizar(q).split(" ").filter(Boolean)
  return toks.every((t) => texto.includes(t) || compacto.includes(t))
}

export interface Indice<T extends Buscable> {
  porId: Map<string, T>
  porCodigo: Map<string, T[]>
  entradas: Array<{ a: T; texto: string; compacto: string; desc: string }>
}

export function crearIndice<T extends Buscable>(arts: T[]): Indice<T> {
  const porId = new Map<string, T>()
  const porCodigo = new Map<string, T[]>()
  const entradas: Indice<T>["entradas"] = []
  const agregar = (codigo: string, a: T) => {
    for (const c of new Set([codigo, padEan13(codigo)])) {
      const l = porCodigo.get(c)
      if (l) {
        if (!l.includes(a)) l.push(a)
      } else porCodigo.set(c, [a])
    }
  }
  for (const a of arts) {
    porId.set(a.id, a)
    const eans = eansDe(a)
    for (const e of eans) agregar(e, a)
    if (a.codigo_bulto) agregar(String(a.codigo_bulto).trim(), a)
    const texto = normalizar([a.descripcion, a.sku, marcaDe(a), ...eans, a.codigo_bulto].filter(Boolean).join(" "))
    entradas.push({ a, texto, compacto: texto.replace(/ /g, ""), desc: normalizar(a.descripcion) })
  }
  return { porId, porCodigo, entradas }
}

/** Código escaneado/tipeado → artículos con ese EAN o código de bulto. */
export function buscarPorCodigo<T extends Buscable>(ix: Indice<T>, codigo: string): T[] {
  const c = codigo.trim()
  if (!c) return []
  return ix.porCodigo.get(padEan13(c)) ?? ix.porCodigo.get(c) ?? []
}

export function buscar<T extends Buscable>(ix: Indice<T>, q0: string, limite = 50): T[] {
  const q = q0.trim()
  if (q.length < 2) return []
  if (/^\d{8,14}$/.test(q)) {
    const exacto = buscarPorCodigo(ix, q)
    if (exacto.length) return exacto
  }
  const toks = normalizar(q).split(" ").filter(Boolean)
  if (!toks.length) return []
  const primero = toks[0]
  const hits: Array<{ a: T; rango: number; desc: string }> = []
  for (const e of ix.entradas) {
    if (!toks.every((t) => e.texto.includes(t) || e.compacto.includes(t))) continue
    // Relevancia simple: empieza con la búsqueda > palabra que empieza así > contiene
    const rango = e.desc.startsWith(toks.join(" ")) ? 0 : e.desc.startsWith(primero) ? 1 : ` ${e.desc}`.includes(` ${primero}`) ? 2 : 3
    hits.push({ a: e.a, rango, desc: e.desc })
  }
  hits.sort((x, y) => x.rango - y.rango || (x.desc < y.desc ? -1 : x.desc > y.desc ? 1 : 0))
  return hits.slice(0, limite).map((h) => h.a)
}

// ─── Texto de apoyo (igual que components/search/ArticuloResultRow del ERP) ──

export function sufijoMarca(a: Buscable): string {
  const m = marcaDe(a)
  return m ? ` · ${m}` : ""
}

export function lineaInfo(a: Buscable & { unidades_por_bulto?: number | null }): string {
  const ean = eansDe(a)[0]
  const bulto = a.unidades_por_bulto ? `${a.unidades_por_bulto} u/bulto` : "Sin bulto"
  return `SKU ${a.sku || "—"} · ${bulto} · ${ean ? `EAN ${ean}` : "Sin EAN"}`
}
