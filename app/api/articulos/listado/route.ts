import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { padEan13 } from "@/lib/utils/ean"
import { hybridSearchIds } from "@/lib/search/hybrid"
import { normalizeLocal } from "@/lib/search/local-match"
import { aplicarFiltros, calcularFacetas, ordenarPor, type DefColumna, type Filtros } from "@/lib/search/facetas"

// Listado de /articulos con filtros por encabezado (tipo Excel).
//
// POST { q?, filtros?, orden?: { col, dir }, proveedor?, fresco? }
//  → { ids: string[] (TODOS, ya ordenados), total, facetas: { col: [{valor, etiqueta, cantidad}] } }
//
// Trae un índice liviano de los artículos activos (~2.000 filas, solo las
// columnas filtrables), aplica texto + filtros + orden en memoria y devuelve la
// lista completa de ids ordenados. La página pagina de a 50 sin volver a llamar
// y pide las columnas completas solo de la página visible.

const INDICE = "id,descripcion,sku,ean13,unidades_por_bulto,proveedor_id,proveedor_nombre,marca_nombre,categoria,subcategoria,rubro,descuento_propio,segmento_precio,iva_compras,iva_ventas,precio_compra,porcentaje_ganancia,bonif_recargo,ultimo_costo,precio_base,precio_base_contado"

type Fila = Record<string, any>

const num = (v: any): number | null => (v == null || v === "" ? null : Number(v))
const SEG: Record<string, string> = { limpieza_bazar: "L/B", perfumeria: "PERF" }
const IVA_C: Record<string, string> = { factura: "Factura (+)", mixto: "Mixto (½)", adquisicion_stock: "Adq. stock (0)" }
const IVA_V: Record<string, string> = { factura: "Factura (+)", presupuesto: "Presupuesto (0)" }

// Mismos ids de columna que usa app/articulos/page.tsx
const DEFS: DefColumna<Fila>[] = [
    { id: "desc", valor: (r) => r.descripcion },
    { id: "sku", valor: (r) => r.sku },
    { id: "ean13", valor: (r) => (Array.isArray(r.ean13) ? r.ean13[0] : r.ean13) },
    { id: "ubulto", valor: (r) => (r.unidades_por_bulto != null ? String(r.unidades_por_bulto) : null), numero: (r) => num(r.unidades_por_bulto) },
    { id: "prov", valor: (r) => r.proveedor_nombre },
    { id: "marca", valor: (r) => r.marca_nombre },
    { id: "rubro", valor: (r) => r.rubro },
    { id: "cat", valor: (r) => r.categoria },
    { id: "subcat", valor: (r) => r.subcategoria },
    { id: "oferta", valor: (r) => (Number(r.descuento_propio) > 0 ? `${Number(r.descuento_propio)}%` : "Sin oferta"), numero: (r) => num(r.descuento_propio) },
    { id: "segprecio", valor: (r) => (r.segmento_precio ? SEG[r.segmento_precio] ?? r.segmento_precio : null) },
    { id: "ivac", valor: (r) => IVA_C[r.iva_compras] ?? r.iva_compras },
    { id: "ivav", valor: (r) => IVA_V[r.iva_ventas] ?? r.iva_ventas },
    { id: "plista", numero: (r) => num(r.precio_compra) },
    { id: "marg", numero: (r) => num(r.porcentaje_ganancia) },
    { id: "br", numero: (r) => num(r.bonif_recargo) },
    { id: "ucosto", numero: (r) => num(r.ultimo_costo) },
    { id: "pbase", numero: (r) => num(r.precio_base) },
    { id: "pbcont", numero: (r) => num(r.precio_base_contado) },
]
// Las columnas de IVA aparecen dos veces en la planilla (modo compras y ventas)
const ALIAS: Record<string, string> = { ivac_v: "ivac", ivav_v: "ivav" }
const FACETAS = ["ubulto", "prov", "marca", "rubro", "cat", "subcat", "oferta", "segprecio", "ivac", "ivav"]

// Caché corto del índice: filtrar, ordenar y paginar seguido no vuelve a leer
// 2.000 filas cada vez. La página pide `fresco: true` después de guardar,
// importar o dar de baja, para no mostrar datos viejos.
const TTL_MS = 20_000
let cache: { t: number; filas: Fila[] } | null = null

async function cargarIndice(sb: ReturnType<typeof createAdminClient>, fresco: boolean): Promise<Fila[]> {
    if (!fresco && cache && Date.now() - cache.t < TTL_MS) return cache.filas
    const filas = await leerIndice(sb)
    cache = { t: Date.now(), filas }
    return filas
}

async function leerIndice(sb: ReturnType<typeof createAdminClient>): Promise<Fila[]> {
    const { count } = await sb.from("articulos").select("id", { count: "exact", head: true }).eq("activo", true)
    const lote = 1000
    const n = Math.max(1, Math.ceil((count || 0) / lote))
    const partes = await Promise.all(
        Array.from({ length: n }, (_, i) =>
            sb.from("articulos").select(INDICE).eq("activo", true).order("id").range(i * lote, (i + 1) * lote - 1),
        ),
    )
    for (const p of partes) if (p.error) throw p.error
    return partes.flatMap((p) => (p.data as Fila[]) || [])
}

// Ids que coinciden con el texto, en orden de relevancia: EAN exacto (escáner)
// → ranking híbrido → todos los que contienen cada palabra (completitud).
async function idsPorTexto(sb: ReturnType<typeof createAdminClient>, q: string): Promise<string[]> {
    if (/^\d{8,14}$/.test(q)) {
        const padded = padEan13(q)
        for (const code of padded !== q ? [padded, q] : [q]) {
            const { data } = await sb.from("articulos").select("id").eq("activo", true).or(`ean13.cs.{"${code}"},codigo_bulto.eq.${code}`)
            if (data && data.length > 0) return data.map((r: any) => r.id)
        }
    }
    const toks = normalizeLocal(q).split(" ").filter((t) => t.length >= 2)
    let lq = sb.from("articulos").select("id").eq("activo", true)
    for (const t of toks) lq = lq.ilike("search_text", `%${t}%`)
    const [rank, lit] = await Promise.all([
        hybridSearchIds("articulos", q, 300),
        toks.length ? lq.order("descripcion").limit(5000) : Promise.resolve({ data: [] as any[] }),
    ])
    const out = [...rank]
    const vistos = new Set(out)
    for (const r of (lit as any).data || []) if (!vistos.has(r.id)) { vistos.add(r.id); out.push(r.id) }
    return out
}

export async function POST(request: NextRequest) {
    try {
        const auth = await requireAuth()
        if (auth.error) return auth.error

        const body = await request.json().catch(() => ({}))
        const q: string = String(body.q || "").trim()
        const filtrosIn: Filtros = body.filtros && typeof body.filtros === "object" ? body.filtros : {}
        const filtros: Filtros = {}
        for (const [k, v] of Object.entries(filtrosIn)) filtros[ALIAS[k] ?? k] = v as any
        const ordenCol: string | null = body.orden?.col ? ALIAS[body.orden.col] ?? body.orden.col : null
        const ordenDir: "asc" | "desc" = body.orden?.dir === "desc" ? "desc" : "asc"
        const proveedor: string | null = body.proveedor || null
        const fresco = body.fresco === true

        const sb = createAdminClient()
        const [indice, idsTexto] = await Promise.all([
            cargarIndice(sb, fresco),
            q.length >= 2 ? idsPorTexto(sb, q) : Promise.resolve(null),
        ])

        // Universo: activos (+ proveedor del selector de arriba) (+ texto, en orden de relevancia)
        let filas: Fila[] = proveedor ? indice.filter((r) => r.proveedor_id === proveedor) : indice
        if (idsTexto) {
            const pos = new Map(idsTexto.map((id, i) => [id, i]))
            filas = filas.filter((r) => pos.has(r.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!)
        }

        const facetas = calcularFacetas(filas, DEFS, filtros, FACETAS)
        let resultado = aplicarFiltros(filas, DEFS, filtros)

        const defOrden = ordenCol ? DEFS.find((d) => d.id === ordenCol) : null
        if (defOrden) resultado = ordenarPor(resultado, defOrden, ordenDir)
        else if (!idsTexto) resultado = ordenarPor(resultado, DEFS[0], "asc") // sin texto ni orden: por descripción

        return NextResponse.json({ ids: resultado.map((r) => r.id), total: resultado.length, facetas })
    } catch (error: any) {
        console.error("[articulos/listado] Error:", error)
        return NextResponse.json({ error: error.message || "Error listando artículos" }, { status: 500 })
    }
}
