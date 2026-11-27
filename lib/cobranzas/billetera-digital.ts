import type { SupabaseClient } from "@supabase/supabase-js"
import { nowArgentina } from "@/lib/utils"

/**
 * BILLETERA (02/10, caso echeq GRUPO HEMA): un cobro de CALLE aceptado DIRECTO por oficina
 * (echeq/transferencia — "Aceptar echeq" en /caja, sin pasar por rendición) acreditó la billetera
 * del cobrador al registrarse, y el débito solo lo hacía la rendición → quedaba un crédito fantasma
 * para siempre. Mismo débito y misma referencia ('rendicion' + pago) que usa rendicion_confirmar:
 * si después el pago entra igual a una rendición, el guard de allá no lo duplica.
 *
 * Lo usan la confirmación de /caja (PATCH /api/pagos/[id]/confirmar) y la confirmación con el banco
 * (lib/bancos/transferencias/servidor.ts). Idempotente.
 */
export async function debitarBilleteraCobroDigital(admin: SupabaseClient, pagoId: string, usuarioId: string): Promise<void> {
  const { data: credBill } = await admin
    .from("billetera_movimientos")
    .select("viajante_id, monto")
    .eq("tipo", "cobro_cliente")
    .eq("referencia_tipo", "pago_cliente")
    .eq("referencia_id", pagoId)
  for (const cb of credBill || []) {
    const { data: yaDebitado } = await admin
      .from("billetera_movimientos")
      .select("id")
      .eq("tipo", "debito")
      .eq("referencia_tipo", "rendicion")
      .eq("referencia_id", pagoId)
      .eq("viajante_id", cb.viajante_id)
      .maybeSingle()
    if (!yaDebitado) {
      await admin.from("billetera_movimientos").insert({
        viajante_id: cb.viajante_id,
        tipo: "debito",
        monto: -Math.abs(Number(cb.monto)),
        concepto: `Cobro aceptado directo por oficina (digital) — pago ${pagoId.slice(0, 8)}`,
        referencia_id: pagoId,
        referencia_tipo: "rendicion",
        fecha: nowArgentina(),
        creado_por: usuarioId,
      })
    }
  }
}
