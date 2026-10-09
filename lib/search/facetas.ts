// Filtros tipo Excel por columna: lógica pura (sirve en el navegador y en el servidor).
//
// Cada columna filtrable se describe con un DefColumna:
//   - valor(r):  texto de la celda (para "tildar valores")
//   - numero(r): número de la celda (para "desde / hasta")
// Los valores se agrupan sin distinguir mayúsculas ni acentos ("Responsable
// Inscripto" y "responsable inscripto" son la misma opción); la etiqueta que
// se muestra es la forma más usada.
//
// Las facetas (opciones con cantidad) de una columna se calculan aplicando
// TODOS los demás filtros menos el suyo, como en Excel: así se puede seguir
// tildando valores de la misma columna.

export const VACIO = "__vacio__"

export interface OpcionFiltro {
    valor: string
    etiqueta: string
    cantidad: number
}

export interface FiltroColumna {
    /** Valores tildados (claves normalizadas). null/undefined = sin filtro por valores. */
    valores?: string[] | null
    min?: number | null
    max?: number | null
}

export type Filtros = Record<string, FiltroColumna>

export interface DefColumna<T> {
    id: string
    valor?: (r: T) => string | null | undefined
    numero?: (r: T) => number | null | undefined
}

export function claveValor(v: string | null | undefined): string {
    const s = (v ?? "")
        .toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/\s+/g, " ")
        .trim()
    return s === "" ? VACIO : s
}

export function filtroActivo(f: FiltroColumna | undefined | null): boolean {
    if (!f) return false
    return (f.valores != null) || f.min != null || f.max != null
}

export function hayFiltros(filtros: Filtros): boolean {
    return Object.values(filtros).some(filtroActivo)
}

function pasa<T>(r: T, def: DefColumna<T>, f: FiltroColumna): boolean {
    if (f.valores != null && def.valor) {
        if (!f.valores.includes(claveValor(def.valor(r)))) return false
    }
    if ((f.min != null || f.max != null) && def.numero) {
        const n = def.numero(r)
        if (n == null || Number.isNaN(n)) return false
        if (f.min != null && n < f.min) return false
        if (f.max != null && n > f.max) return false
    }
    return true
}

/** Filas que pasan todos los filtros (menos el de la columna `excepto`, si se indica). */
export function aplicarFiltros<T>(rows: T[], defs: DefColumna<T>[], filtros: Filtros, excepto?: string): T[] {
    const activos = defs.filter((d) => d.id !== excepto && filtroActivo(filtros[d.id]))
    if (activos.length === 0) return rows
    return rows.filter((r) => activos.every((d) => pasa(r, d, filtros[d.id])))
}

/** Opciones con cantidad para cada columna pedida, en orden alfabético ("(vacío)" al final). */
export function calcularFacetas<T>(
    rows: T[],
    defs: DefColumna<T>[],
    filtros: Filtros,
    columnas: string[],
): Record<string, OpcionFiltro[]> {
    const out: Record<string, OpcionFiltro[]> = {}
    for (const id of columnas) {
        const def = defs.find((d) => d.id === id)
        if (!def?.valor) continue
        const base = aplicarFiltros(rows, defs, filtros, id)
        const conteo = new Map<string, { cantidad: number; formas: Map<string, number> }>()
        for (const r of base) {
            const crudo = def.valor(r)
            const k = claveValor(crudo)
            let e = conteo.get(k)
            if (!e) { e = { cantidad: 0, formas: new Map() }; conteo.set(k, e) }
            e.cantidad++
            const forma = (crudo ?? "").toString().trim()
            e.formas.set(forma, (e.formas.get(forma) || 0) + 1)
        }
        // Valores tildados que quedaron en 0 por otros filtros: se muestran igual (para poder destildarlos)
        for (const v of filtros[id]?.valores || []) {
            if (!conteo.has(v)) conteo.set(v, { cantidad: 0, formas: new Map([[v === VACIO ? "" : v, 1]]) })
        }
        out[id] = [...conteo.entries()]
            .map(([valor, e]) => {
                const etiqueta = valor === VACIO ? "(vacío)" : [...e.formas.entries()].sort((a, b) => b[1] - a[1])[0][0]
                return { valor, etiqueta, cantidad: e.cantidad }
            })
            .sort((a, b) => (a.valor === VACIO ? 1 : b.valor === VACIO ? -1 : a.etiqueta.localeCompare(b.etiqueta, "es", { numeric: true })))
    }
    return out
}

/** Orden estable por una columna: números como números, textos en castellano, vacíos al final. */
export function ordenarPor<T>(rows: T[], def: DefColumna<T>, dir: "asc" | "desc"): T[] {
    const s = dir === "asc" ? 1 : -1
    const key = (r: T): number | string | null => {
        if (def.numero) {
            const n = def.numero(r)
            return n == null || Number.isNaN(n) ? null : n
        }
        const v = def.valor?.(r)
        return v == null || String(v).trim() === "" ? null : String(v)
    }
    return rows
        .map((r, i) => ({ r, i, k: key(r) }))
        .sort((a, b) => {
            if (a.k === null && b.k === null) return a.i - b.i
            if (a.k === null) return 1
            if (b.k === null) return -1
            const c = typeof a.k === "number" && typeof b.k === "number"
                ? a.k - b.k
                : String(a.k).localeCompare(String(b.k), "es", { numeric: true, sensitivity: "base" })
            return c !== 0 ? c * s : a.i - b.i
        })
        .map((x) => x.r)
}
