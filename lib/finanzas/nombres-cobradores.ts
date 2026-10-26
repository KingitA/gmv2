// Nombre legible de quien cobra en la calle (#40 de la prueba de salida).
// Las billeteras y rendiciones se guardan con el id del cobrador: el de un vendedor
// (tabla vendedores) o el del usuario del chofer (tabla usuarios). Las vistas de
// tesorería solo miran vendedores y, para un chofer, muestran un pedazo del id
// ("d6ac25bb"). Esto completa el nombre buscando en las dos tablas.

/** Mapa id → nombre, buscando primero en vendedores y después en usuarios. */
export async function nombresCobradores(supabase: any, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))]
  const mapa = new Map<string, string>()
  if (!unicos.length) return mapa
  const [vend, usu] = await Promise.all([
    supabase.from("vendedores").select("id, nombre").in("id", unicos),
    supabase.from("usuarios").select("id, nombre").in("id", unicos),
  ])
  for (const u of (usu.data || []) as { id: string; nombre: string | null }[]) if (u.nombre) mapa.set(u.id, u.nombre)
  // El nombre del vendedor manda (es el que se usa en el resto del sistema)
  for (const v of (vend.data || []) as { id: string; nombre: string | null }[]) if (v.nombre) mapa.set(v.id, v.nombre)
  return mapa
}

/** Reemplaza `cobrador_nombre` en filas que traen `cobrador_id` (vistas v_dias_calle, v_rendicion_diferencias). */
export async function conNombreCobrador<T extends { cobrador_id?: string | null; cobrador_nombre?: string | null }>(
  supabase: any,
  filas: T[],
): Promise<T[]> {
  const nombres = await nombresCobradores(supabase, filas.map((f) => f.cobrador_id))
  return filas.map((f) => (f.cobrador_id && nombres.has(f.cobrador_id) ? { ...f, cobrador_nombre: nombres.get(f.cobrador_id)! } : f))
}
