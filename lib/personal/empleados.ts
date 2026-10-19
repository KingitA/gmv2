// Cuentas personales de empleados (regla del dueño, 19/10/2026).
// La cuenta de un vendedor / chofer / depósito ES una cuenta de cliente
// (clientes.es_empleado = true, migración 20261019_cc_personal.sql). Esas
// cuentas NO son deuda de clientes (Playroom, Jarvis, cartera del vendedor) y
// sus pedidos NO entran en la cola de preparación del depósito (se los
// preparan ellos mismos). Las ventas sí cuentan: son ventas reales.

/**
 * Ids de los clientes que son cuenta de empleado. Si la migración todavía no
 * está aplicada (falta la columna) devuelve un conjunto vacío: los reportes
 * siguen funcionando como antes en vez de romperse.
 */
export async function idsClientesEmpleados(db: any): Promise<Set<string>> {
  try {
    const { data, error } = await db.from("clientes").select("id").eq("es_empleado", true).limit(1000)
    if (error) return new Set()
    return new Set<string>(((data || []) as Array<{ id: string }>).map((c) => c.id))
  } catch {
    return new Set()
  }
}

/** Valor para `.not("cliente_id", "in", …)` de PostgREST, o null si no hay empleados. */
export function listaNotIn(ids: Set<string>): string | null {
  return ids.size ? `(${[...ids].join(",")})` : null
}
