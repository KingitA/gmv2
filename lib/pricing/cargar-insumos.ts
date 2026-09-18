// Carga desde Supabase los insumos del motor de precios (lib/pricing/motor.ts).
// Recibe el cliente de Supabase por parámetro: sirve igual con la sesión del
// usuario (cookie o bearer) que con el admin. Las apps móviles NO usan este
// archivo: replican las mismas tablas vía /api/mobile/sync (ver MOBILE.md).

import type { InsumosCliente, ListaPrecioRow, ReglaPrecioRow } from "./motor"
import type { CondicionMarca, CondicionProveedor } from "./resolver"

// Los selects son literales únicos (sin "+"): así supabase-js infiere el tipo de
// las filas. Concatenados, el tipo cae a GenericStringError y tsc lo marca.
export const CLIENTE_LISTAS_COLS =
  "id, vendedor_id, metodo_facturacion, lista_precio_id, lista_limpieza_id, metodo_limpieza, lista_perf0_id, metodo_perf0, lista_perf_plus_id, metodo_perf_plus"

export const LISTA_PRECIO_COLS = "id,codigo,recargo_limpieza_bazar,recargo_perfumeria_negro,recargo_perfumeria_blanco"
export const REGLA_PRECIO_COLS = "grupo_precio,iva_compras,iva_ventas,formulas"
export const CONDICION_PROVEEDOR_COLS =
  "proveedor_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct"
export const CONDICION_MARCA_COLS =
  "marca_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct"

/** Columnas de `articulos` que necesita el motor (mismo select que usaba pedidos.ts). */
export const ARTICULO_PRECIO_COLS =
  "id,proveedor_id,marca_id,precio_compra,precio_base,precio_base_contado,precio_lista_especial,oferta_lista_especial,porcentaje_ganancia,bonif_recargo,categoria,iva_compras,iva_ventas,descuento_propio,segmento_precio,rubros:rubro_id(slug),proveedor:proveedores(tipo_descuento)"

/**
 * Insumos de un cliente. Lanza "Cliente no encontrado" si no existe (mismo
 * contrato que tenían previewPrecioArticulo / previewPreciosArticulos).
 */
export async function cargarInsumosCliente(supabase: any, clienteId: string): Promise<InsumosCliente> {
  const [clienteRes, listasRes, reglasRes, condProvRes, condMarcaRes, bonifRes] = await Promise.all([
    supabase.from("clientes").select(CLIENTE_LISTAS_COLS).eq("id", clienteId).single(),
    supabase.from("listas_precio").select(LISTA_PRECIO_COLS),
    supabase.from("listas_precio_reglas").select(REGLA_PRECIO_COLS),
    supabase.from("cliente_proveedor_condicion").select(CONDICION_PROVEEDOR_COLS).eq("cliente_id", clienteId),
    supabase.from("cliente_marca_condicion").select(CONDICION_MARCA_COLS).eq("cliente_id", clienteId),
    supabase
      .from("bonificaciones")
      .select("tipo, segmento, porcentaje")
      .eq("cliente_id", clienteId)
      .eq("activo", true)
      .in("tipo", ["general", "viajante"]),
  ])
  if (!clienteRes.data) throw new Error("Cliente no encontrado")
  return {
    cliente: clienteRes.data,
    listas: (listasRes.data || []) as ListaPrecioRow[],
    reglas: (reglasRes.data || []) as ReglaPrecioRow[],
    condicionesProveedor: (condProvRes.data || []) as CondicionProveedor[],
    condicionesMarca: (condMarcaRes.data || []) as CondicionMarca[],
    bonificaciones: bonifRes.data || [],
  }
}
