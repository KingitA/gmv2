// Clientes que comparten CUIT. Regla del dueño (10/10/2026): distintos clientes PUEDEN
// tener el mismo CUIT (sucursales, el mismo dueño con dos negocios), pero el sistema
// tiene que AVISAR al crear/editar e informar cuál es el otro. No se bloquea.
import { cuitDigitos, normalizarCuit } from "@/lib/formato"

export interface ClienteMismoCuit {
  id: string
  codigo_cliente: string | null
  nombre: string | null
  razon_social: string | null
  localidad: string | null
  activo: boolean
}

/** Clientes con ese CUIT (sin importar cómo se escribió), sin contar `excluirId`. */
export async function clientesConMismoCuit(sb: any, cuit: string | null | undefined, excluirId?: string | null): Promise<ClienteMismoCuit[]> {
  const n = normalizarCuit(cuit)
  if (!n || cuitDigitos(n).length !== 11) return []
  // Con y sin guiones por si quedó algún dato viejo sin normalizar (el trigger los normaliza)
  const { data } = await sb
    .from("clientes")
    .select("id, codigo_cliente, nombre, razon_social, localidad, activo")
    .in("cuit", [n, cuitDigitos(n)])
    .order("activo", { ascending: false })
    .limit(20)
  return ((data || []) as ClienteMismoCuit[]).filter((c) => c.id !== excluirId)
}

/** "702 · CHI YANBIN (BENITO JUAREZ)" */
export function describirCliente(c: ClienteMismoCuit): string {
  const cod = c.codigo_cliente ? `${c.codigo_cliente} · ` : ""
  const loc = c.localidad ? ` (${c.localidad})` : ""
  return `${cod}${c.nombre || c.razon_social || "Sin nombre"}${loc}${c.activo ? "" : " [dado de baja]"}`
}

/** "Ya hay un cliente con este CUIT: 702 · CHI YANBIN (BENITO JUAREZ)" */
export function avisoMismoCuit(lista: ClienteMismoCuit[]): string | null {
  if (!lista.length) return null
  const nombres = lista.slice(0, 3).map(describirCliente).join("; ")
  const resto = lista.length > 3 ? ` y ${lista.length - 3} más` : ""
  return lista.length === 1
    ? `Ya hay un cliente con este CUIT: ${nombres}`
    : `Ya hay ${lista.length} clientes con este CUIT: ${nombres}${resto}`
}
