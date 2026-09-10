// Catálogos de artículo: tipos de bulto (articulos.unidad_de_medida) y tipos de
// fracción (articulos.tipo_fraccion). ABM en /tablas/tipos-bulto y /tablas/tipos-fraccion.
//
// Los selects de la ficha, edición masiva y depósito leen de acá. Si la tabla
// todavía no existe (deploy antes de aplicar la migración) se cae a la lista
// que estaba hardcodeada antes, así ninguna pantalla queda sin opciones.

export interface TipoCatalogo {
  id: string
  nombre: string
  descripcion: string | null
  orden: number
  activo: boolean
}

export const TIPOS_BULTO_DEFAULT    = ["UN","BULTO","CAJA","PACK","BLISTER","SET","KG","LT","MT"]
export const TIPOS_FRACCION_DEFAULT = ["UN","BULTO","PACK","BLISTER","CAJA","DOCENA","SET","DISPLAY"]

type SbLike = { from: (t: string) => any }

async function cargarNombres(sb: SbLike, tabla: string, fallback: string[]): Promise<string[]> {
  try {
    const { data, error } = await sb.from(tabla).select("nombre").eq("activo", true).order("orden").order("nombre")
    if (error || !data) return fallback
    return (data as { nombre: string }[]).map(r => r.nombre)
  } catch {
    return fallback
  }
}

/** Nombres activos de ambos catálogos, ordenados. Acepta cliente browser o server. */
export async function cargarTiposArticulo(sb: SbLike) {
  const [bulto, fraccion] = await Promise.all([
    cargarNombres(sb, "tipos_bulto", TIPOS_BULTO_DEFAULT),
    cargarNombres(sb, "tipos_fraccion", TIPOS_FRACCION_DEFAULT),
  ])
  return { tiposBulto: bulto, tiposFraccion: fraccion }
}

/** Lista para un select: si el artículo trae un valor que no está (inactivo o viejo), lo agrega al final para no perderlo. */
export const opcionesCon = (lista: string[], actual: string | null | undefined) =>
  actual && !lista.includes(actual) ? [...lista, actual] : lista
