import type { ReactNode } from "react"

// Render estándar de un artículo en resultados de búsqueda / selección.
// Arriba: descripción + marca (grande, negrita). Abajo: SKU, cantidad por bulto y
// EAN (compacto, letra clara) con etiquetas para que el operario sepa qué ve.

function getMarca(a: any): string | null {
    if (!a) return null
    if (typeof a.marca === "string") return a.marca || null
    return a.marca?.descripcion || a.marca_descripcion || null
}

function getEan(a: any): string | null {
    const e = a?.ean13
    if (Array.isArray(e)) return e[0] || null
    return e || null
}

// Helpers de texto para pantallas con estilo propio (ej. escáner de depósito).
export function articuloMarcaSuffix(a: any): string {
    const m = getMarca(a)
    return m ? ` · ${m}` : ""
}

export function articuloInfoLine(a: any): string {
    const ean = getEan(a)
    const bulto = a?.unidades_por_bulto ? `${a.unidades_por_bulto} u/bulto` : "Sin bulto"
    return `SKU ${a?.sku || "—"} · ${bulto} · ${ean ? `EAN ${ean}` : "Sin EAN"}`
}

export function ArticuloResultRow({
    articulo,
    size = "md",
    trailing,
}: {
    articulo: any
    size?: "sm" | "md"
    trailing?: ReactNode
}) {
    const marca = getMarca(articulo)
    const ean = getEan(articulo)
    const bulto = articulo?.unidades_por_bulto
    const titleCls = size === "sm" ? "text-sm" : "text-[15px]"

    return (
        <div className="flex items-center gap-2 min-w-0">
            <div className="min-w-0 flex-1">
                <div className={`font-bold text-slate-800 leading-snug ${titleCls}`}>
                    <span>{articulo?.descripcion || "—"}</span>
                    {marca && <span className="ml-2 text-indigo-600">{marca}</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                    <span>SKU {articulo?.sku || "—"}</span>
                    <span className="text-slate-300">·</span>
                    <span>{bulto ? `${bulto} u/bulto` : "Sin bulto"}</span>
                    <span className="text-slate-300">·</span>
                    <span>{ean ? `EAN ${ean}` : "Sin EAN"}</span>
                </div>
            </div>
            {trailing && <div className="shrink-0">{trailing}</div>}
        </div>
    )
}
