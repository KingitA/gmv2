import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * UN CHEQUE = UN PAPEL (pedido del dueño 01/10/2026). Cuando un mismo cheque
 * cubre a varios clientes (cobro conjunto del chofer, cobro a varios clientes
 * del vendedor), en cartera queda UNA sola fila por el total; cada cliente
 * tiene su parte en su pago (pagos_detalle.cheque_id apunta a esa fila).
 * Antes se creaba un cheque por cliente, con sufijo " (2)" en el número.
 *
 * Idempotente: si el cheque ya existe vivo (mismo banco, número, importe total
 * y vencimiento — la unicidad de la base), se reutiliza; así un reintento de la
 * app no crea un segundo papel. Nace EN_CARTERA y el trigger
 * cheque_al_vincular_pago lo pasa a EN_VERIFICACION al vincularse a un cobro
 * sin confirmar (migración 20261020b_cheques_un_papel.sql).
 */
export interface ChequeCompartidoInput {
  banco: string
  numero: string
  fecha_vencimiento: string
  fecha_emision?: string | null
  monto: number
  color: string
  es_echeq: boolean
  /** Cliente que entregó el cheque: si rebota, la deuda va entera a él (regla del dueño 16/10) */
  cliente_origen_id: string
}

export async function asegurarChequeCompartido(admin: SupabaseClient, c: ChequeCompartidoInput): Promise<string> {
  const monto = Math.round(Number(c.monto) * 100) / 100
  const { data: existente } = await admin
    .from("cheques")
    .select("id")
    .eq("banco", c.banco)
    .eq("numero", c.numero)
    .eq("monto", monto)
    .eq("fecha_vencimiento", c.fecha_vencimiento)
    .neq("estado", "ANULADO")
    .limit(1)
  if (existente?.[0]?.id) return existente[0].id

  const { data, error } = await admin
    .from("cheques")
    .insert({
      tipo: "TERCERO",
      estado: "EN_CARTERA",
      banco: c.banco,
      numero: c.numero,
      fecha_emision: c.fecha_emision || null,
      fecha_vencimiento: c.fecha_vencimiento,
      monto,
      color: c.color,
      es_echeq: c.es_echeq,
      cliente_origen_id: c.cliente_origen_id,
      observaciones: "Cheque compartido entre varios clientes (un cheque = un papel)",
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(`No se pudo registrar el cheque compartido: ${error?.message}`)
  return data.id
}

/** Si el cheque quedó sin ningún cobro que lo use (falló el alta), se borra: no queda un papel fantasma. */
export async function liberarChequeSinUso(admin: SupabaseClient, chequeId: string) {
  const { count } = await admin.from("pagos_detalle").select("id", { count: "exact", head: true }).eq("cheque_id", chequeId)
  if (!count) await admin.from("cheques").delete().eq("id", chequeId)
}

/** "123 (2)" → "123": el sufijo de las piezas del reparto ya no hace falta con un solo papel. */
export const numeroBaseCheque = (numero: string | null | undefined) => String(numero || "").replace(/\s+\(\d+\)$/, "")
