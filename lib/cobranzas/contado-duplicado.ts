import type { SupabaseClient } from "@supabase/supabase-js"
import { cargarMarcasBonificacion, mensajeContadoYaAplicado, separarYaBonificados, TIPOS_BONIFICABLES } from "@/lib/comprobantes/ya-bonificados"

// Regla de negocio al REGISTRAR un cobro con "10% contado": un mismo comprobante jamás
// recibe el 10 % dos veces (ni por este cobro ni por uno anterior). La NC al confirmar
// ya lo filtra (generar-bonificacion), pero el que cobra en la calle tiene que enterarse
// AL CARGAR, no cuando oficina confirma: si TODOS los comprobantes seleccionados ya lo
// tienen, el cobro se rechaza (definitivo); si solo algunos, se registra igual y se avisa
// a cuáles no se les aplica. La marca [10% CONTADO] queda en el pago (la NC se emite
// solo sobre los pendientes).

export interface ControlContado {
  /** Motivo de rechazo definitivo (todos los bonificables ya tienen el 10 %) */
  rechazo: string | null
  /** Aviso (algunos ya lo tienen; el resto sí bonifica) */
  aviso: string | null
  /** Números de los comprobantes que ya estaban bonificados */
  yaBonificados: string[]
}

export async function controlarContadoDuplicado(supabase: SupabaseClient, cliente_id: string, comprobanteIds: string[]): Promise<ControlContado> {
  const ids = [...new Set(comprobanteIds.filter(Boolean))]
  if (!ids.length) return { rechazo: null, aviso: null, yaBonificados: [] }
  const { data: comps } = await supabase.from("comprobantes_venta").select("id, tipo_comprobante, numero_comprobante").in("id", ids)
  const bonificables = (comps || []).filter((c: any) => TIPOS_BONIFICABLES.includes(String(c.tipo_comprobante || "").toUpperCase()))
  if (!bonificables.length) return { rechazo: null, aviso: null, yaBonificados: [] }
  const marcas = await cargarMarcasBonificacion(supabase, cliente_id, bonificables.map((c: any) => c.id))
  const { pendientes, yaBonificados } = separarYaBonificados(bonificables as Array<{ id: string; numero_comprobante: string }>, marcas)
  const numeros = yaBonificados.map((c) => c.numero_comprobante)
  if (!yaBonificados.length) return { rechazo: null, aviso: null, yaBonificados: [] }
  if (!pendientes.length) return { rechazo: mensajeContadoYaAplicado(numeros, true), aviso: null, yaBonificados: numeros }
  return { rechazo: null, aviso: mensajeContadoYaAplicado(numeros, false), yaBonificados: numeros }
}
