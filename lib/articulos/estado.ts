// Dar de baja / reactivar un artículo. ÚNICO camino del servidor (lo usan /articulos,
// el depósito web y la app de depósito). Deja actualizado_por = quien lo hizo; el
// trigger trg_articulos_estado_historial (migración 20261020b) guarda el historial
// de quién y cuándo, también si alguien lo cambia por otro lado.

export type OrigenEstadoArticulo = "articulos" | "deposito" | "app_deposito" | "importacion"

export interface ArticuloBaja {
  id: string
  sku: string | null
  descripcion: string | null
  activo: boolean
}

/**
 * Cambia el estado de uno o varios artículos (usar con el cliente ADMIN, del servidor).
 * Devuelve cuántos cambiaron. Registra quién y desde dónde (RPC articulo_cambiar_estado);
 * si la migración 20261020b todavía no está aplicada, hace el update simple.
 */
export async function cambiarEstadoArticulos(
  sb: any,
  ids: string[],
  activo: boolean,
  usuarioId: string | null,
  origen: OrigenEstadoArticulo,
): Promise<number> {
  if (!ids.length) return 0
  const rpc = await sb.rpc("articulo_cambiar_estado", { p_ids: ids, p_activo: activo, p_usuario: usuarioId, p_origen: origen })
  if (!rpc.error) return (rpc.data || []).length
  if (!/could not find the function|PGRST202/i.test(`${rpc.error.code} ${rpc.error.message}`)) throw rpc.error
  const { data, error } = await sb
    .from("articulos")
    .update({ activo, actualizado_por: usuarioId })
    .in("id", ids)
    .eq("activo", !activo) // solo los que realmente cambian (el historial no se ensucia)
    .select("id")
  if (error) throw error
  return (data || []).length
}

/**
 * Busca un artículo DADO DE BAJA por código exacto: SKU (con o sin ceros adelante),
 * EAN o código de bulto. Para que depósito pueda ofrecer "está dado de baja, ¿reactivar?"
 * cuando escanea o tipea un código que no aparece entre los activos.
 */
export async function buscarDadoDeBajaPorCodigo(sb: any, codigo: string): Promise<ArticuloBaja | null> {
  const c = String(codigo || "").trim()
  if (!c) return null
  const variantes = new Set([c])
  if (/^\d+$/.test(c)) {
    const sinCeros = c.replace(/^0+(?=\d)/, "")
    variantes.add(sinCeros)
    variantes.add(sinCeros.padStart(6, "0"))
    if (c.length < 13) variantes.add(c.padStart(13, "0"))
  }
  const lista = [...variantes]
  const filtrosEan = lista.map((v) => `ean13.cs.{"${v.replace(/"/g, "")}"}`).join(",")
  const { data } = await sb
    .from("articulos")
    .select("id, sku, descripcion, activo")
    .eq("activo", false)
    .or(`sku.in.(${lista.map((v) => `"${v.replace(/"/g, "")}"`).join(",")}),codigo_bulto.in.(${lista.map((v) => `"${v.replace(/"/g, "")}"`).join(",")}),${filtrosEan}`)
    .limit(1)
  return (data?.[0] as ArticuloBaja) ?? null
}
