import { tipoDescuentoDe, type TipoDescuento } from "./diferencias"

/**
 * Cómo aplica los descuentos un proveedor (`proveedores.tipo_descuento`: "cascada" o
 * "sobre_lista"). Sin proveedor, sin dato o si la consulta falla: en cascada, que es lo que
 * tienen casi todos y lo que se asumía antes.
 */
export async function tipoDescuentoProveedor(supabase: any, proveedorId: string | null | undefined): Promise<TipoDescuento> {
  if (!proveedorId) return "cascada"
  try {
    const { data, error } = await supabase.from("proveedores").select("tipo_descuento").eq("id", proveedorId).maybeSingle()
    if (error) {
      console.error("[compras] no se pudo leer el tipo de descuento del proveedor:", error.message)
      return "cascada"
    }
    return tipoDescuentoDe(data?.tipo_descuento)
  } catch (e: any) {
    console.error("[compras] no se pudo leer el tipo de descuento del proveedor:", e?.message || e)
    return "cascada"
  }
}
