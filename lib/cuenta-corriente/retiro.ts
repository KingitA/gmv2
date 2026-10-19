import type { SupabaseClient } from "@supabase/supabase-js"
import { billeteraConCuentaPersonal, cuentaPersonalDe } from "@/lib/cuenta-corriente/cuenta-personal"
import { moneda } from "@/lib/formato"

/**
 * RETIRO del vendedor (regla del dueño 19/10/2026): lo hace él mismo desde la
 * app, de la plata que tiene en la mano. Si tiene $100.000 cobrados y retira
 * $50.000:
 *  - en su CUENTA PERSONAL se le debitan $50.000 (puede quedar en negativo);
 *  - la PLATA DE LA EMPRESA que tiene que rendir baja a $50.000
 *    (billetera_movimientos 'retiro_efectivo', que la próxima rendición
 *    descuenta de lo esperado: rendicion_crear v4).
 * No necesita aprobación previa: la oficina lo ve al controlar la rendición.
 * Idempotente por idempotency_key (la app puede reintentar sin duplicar).
 */
export class ErrorRetiro extends Error {
  constructor(message: string, public status = 400, public codigo?: string) {
    super(message)
  }
}

export async function registrarRetiro(
  supabase: SupabaseClient,
  args: {
    usuarioId: string
    vendedorIds: string[]
    monto: number
    observaciones?: string | null
    idempotencyKey?: string | null
  },
): Promise<{ retiro_id: string; cuenta_id: string; monto: number; dedup?: boolean }> {
  const monto = Math.round(Number(args.monto) * 100) / 100
  if (!(monto > 0)) throw new ErrorRetiro("El monto del retiro tiene que ser mayor a 0")
  if (!args.vendedorIds.length) throw new ErrorRetiro("No tenés código de vendedor asignado", 403)

  // Reintento de la app: si ya existe, devolver el mismo
  if (args.idempotencyKey) {
    const { data: prev } = await supabase
      .from("billetera_movimientos")
      .select("id, monto")
      .eq("referencia_tipo", "retiro_efectivo")
      .eq("referencia_id", args.idempotencyKey)
      .maybeSingle()
    if (prev) {
      const cuenta = await cuentaPersonalDe(supabase, { usuarioId: args.usuarioId, vendedorIds: args.vendedorIds })
      return { retiro_id: prev.id, cuenta_id: cuenta || "", monto: Math.abs(Number(prev.monto)), dedup: true }
    }
  }

  const cuentaId = await cuentaPersonalDe(supabase, { usuarioId: args.usuarioId, vendedorIds: args.vendedorIds })
  if (!cuentaId) {
    throw new ErrorRetiro(
      "Tu cuenta personal todavía no está vinculada. Pedile a la oficina que la vincule en Cuentas del personal.",
      409,
      "SIN_CUENTA_PERSONAL",
    )
  }

  // No puede retirar más efectivo del que tiene en la mano
  const resumen = await billeteraConCuentaPersonal(supabase, args.vendedorIds, args.usuarioId)
  if (monto > resumen.balance + 0.005) {
    throw new ErrorRetiro(
      `Tenés ${moneda(resumen.balance)} de efectivo en la mano: no podés retirar ${moneda(monto)}.`,
      422,
      "RETIRO_SUPERA_EFECTIVO",
    )
  }

  // Billetera del código de vendedor con más efectivo sin rendir (la rendición
  // se arma por código: el retiro tiene que caer en la misma)
  const { data: pagos } = await supabase
    .from("pagos_clientes")
    .select("vendedor_id, pagos_detalle(tipo_pago, monto)")
    .in("vendedor_id", args.vendedorIds)
    .eq("estado", "pendiente_rendicion")
  const efectivoDe = new Map<string, number>()
  for (const p of pagos || []) {
    const ef = ((p as any).pagos_detalle || []).filter((d: any) => d.tipo_pago === "efectivo").reduce((s: number, d: any) => s + Number(d.monto || 0), 0)
    efectivoDe.set(p.vendedor_id, (efectivoDe.get(p.vendedor_id) || 0) + ef)
  }
  const vendedorId = [...efectivoDe.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || args.vendedorIds[0]

  const concepto = `Retiro de efectivo${args.observaciones ? ` · ${args.observaciones}` : ""}`
  const { data: mov, error: movErr } = await supabase
    .from("billetera_movimientos")
    .insert({
      viajante_id: vendedorId,
      tipo: "retiro_comision",
      medio: "efectivo",
      monto: -monto,
      concepto,
      referencia_tipo: "retiro_efectivo",
      referencia_id: args.idempotencyKey || crypto.randomUUID(),
      fecha: new Date().toISOString(),
      creado_por: args.usuarioId,
    })
    .select("id")
    .single()
  if (movErr || !mov) throw new ErrorRetiro(`No se pudo registrar el retiro: ${movErr?.message}`, 500)

  const { error: ccErr } = await supabase.rpc("cc_postear", {
    p_cliente_id: cuentaId,
    p_tipo_movimiento: "retiro",
    p_debe: monto,
    p_haber: 0,
    p_referencia_tipo: "retiro",
    p_referencia_id: mov.id,
    p_numero_comprobante: null,
    p_observaciones: concepto,
    p_usuario_id: args.usuarioId,
  })
  if (ccErr) {
    // Sin el débito en la cuenta, el retiro no puede quedar: se deshace
    await supabase.from("billetera_movimientos").delete().eq("id", mov.id)
    throw new ErrorRetiro(`No se pudo registrar el retiro en tu cuenta: ${ccErr.message}`, 500)
  }
  return { retiro_id: mov.id, cuenta_id: cuentaId, monto }
}
