/**
 * Guarda el resultado de una importación masiva en importaciones_historial.
 * Se llama desde las API routes de import (clientes / proveedores / articulos)
 * después de aplicar los cambios. Nunca lanza: si falla, sólo loguea (la
 * importación ya se aplicó y no queremos romper la respuesta por el historial).
 */

import { createAdminClient } from "@/lib/supabase/admin"

export interface HistorialFila {
  clave: string | null
  nombre: string | null
  status: string
  cambios: { campo: string; actual: any; nuevo: any }[]
  error?: string
}

export async function guardarHistorialImportacion(params: {
  modulo: "clientes" | "proveedores" | "articulos"
  archivo_nombre?: string | null
  usuario_id?: string | null
  conector?: string | null
  filas: HistorialFila[]
}): Promise<{ id: string; created_at: string } | null> {
  try {
    const { modulo, archivo_nombre, usuario_id, conector, filas } = params
    const cuenta = (s: string) =>
      s === "actualizado"
        ? filas.filter(f => f.status === "actualizado" || f.status === "actualizar").length
        : filas.filter(f => f.status === s).length

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("importaciones_historial")
      .insert({
        modulo,
        archivo_nombre: archivo_nombre ?? null,
        usuario_id: usuario_id ?? null,
        conector: conector ?? null,
        total_filas: filas.length,
        actualizados: cuenta("actualizado"),
        sin_cambios: cuenta("sin_cambios"),
        no_encontrados: cuenta("no_encontrado"),
        nuevos: cuenta("nuevo"),
        errores: cuenta("error"),
        resultado: filas,
      })
      .select("id, created_at")
      .single()

    if (error) {
      console.error("[historial-importacion] no se pudo guardar:", error.message)
      return null
    }
    return data as any
  } catch (e: any) {
    console.error("[historial-importacion] excepción:", e?.message)
    return null
  }
}
