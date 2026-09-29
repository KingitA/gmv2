import type { SupabaseClient } from "@supabase/supabase-js"

// ¿Un comprobante YA tiene aplicado el 10 % de contado? Única definición para todo el
// sistema (generación de la NC al confirmar la rendición, control al registrar el cobro,
// selector de comprobantes de la web y réplica de las apps).
//
// Un comprobante está bonificado si una NC/REV de bonificación NO anulada:
//  a) le está imputada como crédito (`imputaciones.credito_comprobante_id`, modelo actual), o
//  b) lo menciona por número en sus observaciones ("Bonificación contado 10% — facturas 0003-…",
//     legado del modelo "pozo").
// Con la NC fiscal el doble CAE es irreversible en ARCA: por eso la regla vive en el servidor
// y no solo en la pantalla.

export interface ComprobanteBonificable {
  id: string
  numero_comprobante: string
}

/** Solo estos tipos bonifican (= saldo.ts / generar-bonificacion.ts). */
export const TIPOS_BONIFICABLES = ["FA", "FB", "FC", "PRES"]

export interface MarcasBonificacion {
  /** ids de comprobantes con una NC/REV de bonificación imputada como crédito */
  bonificadosPorImputacion: Set<string>
  /** observaciones de las NC/REV de bonificación vivas del cliente */
  obsNcs: string[]
}

/** Parte pura: separa los que todavía pueden bonificar de los que ya lo tienen. */
export function separarYaBonificados<T extends ComprobanteBonificable>(comprobantes: T[], marcas: MarcasBonificacion): { pendientes: T[]; yaBonificados: T[] } {
  const pendientes: T[] = []
  const yaBonificados: T[] = []
  for (const c of comprobantes) {
    const ya = marcas.bonificadosPorImputacion.has(c.id) || marcas.obsNcs.some((o) => !!c.numero_comprobante && o.includes(c.numero_comprobante))
    ;(ya ? yaBonificados : pendientes).push(c)
  }
  return { pendientes, yaBonificados }
}

export async function cargarMarcasBonificacion(supabase: SupabaseClient, cliente_id: string, ids: string[]): Promise<MarcasBonificacion> {
  if (!ids.length) return { bonificadosPorImputacion: new Set(), obsNcs: [] }
  const [{ data: impsCredito }, { data: ncsBonif }] = await Promise.all([
    supabase
      .from("imputaciones")
      .select("comprobante_id, credito:comprobantes_venta!imputaciones_credito_comprobante_id_fkey(observaciones, anulado_en)")
      .in("comprobante_id", ids)
      .not("credito_comprobante_id", "is", null)
      .neq("estado", "anulado"),
    supabase
      .from("comprobantes_venta")
      .select("observaciones")
      .eq("cliente_id", cliente_id)
      .in("tipo_comprobante", ["REV", "NCA", "NCB", "NCC"])
      .is("anulado_en", null)
      .neq("estado_pago", "anulado")
      .ilike("observaciones", "%Bonificación contado%"),
  ])
  return {
    bonificadosPorImputacion: new Set(
      (impsCredito || [])
        .filter((i: any) => {
          const cred = i.credito
          return cred && !cred.anulado_en && (cred.observaciones || "").includes("Bonificación contado")
        })
        .map((i: any) => i.comprobante_id as string),
    ),
    obsNcs: (ncsBonif || []).map((n: any) => n.observaciones || ""),
  }
}

/** Los que todavía pueden recibir el 10 % (= lo que usa la generación de la NC). */
export async function filtrarYaBonificados<T extends ComprobanteBonificable>(supabase: SupabaseClient, cliente_id: string, comprobantes: T[]): Promise<T[]> {
  if (!comprobantes.length) return []
  const marcas = await cargarMarcasBonificacion(supabase, cliente_id, comprobantes.map((c) => c.id))
  return separarYaBonificados(comprobantes, marcas).pendientes
}

/** Texto para quien cobra cuando el 10 % no se puede aplicar (a todo o a parte). */
export function mensajeContadoYaAplicado(numeros: string[], todos: boolean): string {
  const lista = numeros.filter(Boolean).join(", ")
  return todos
    ? `El 10% de contado ya está aplicado en ${numeros.length === 1 ? "el comprobante" : "los comprobantes"} ${lista}: no se aplica dos veces. Destildá «10% contado» para registrar el cobro.`
    : `El 10% de contado no se aplica a ${lista}: ya lo ${numeros.length === 1 ? "tiene" : "tienen"}. Se aplica solo al resto.`
}
