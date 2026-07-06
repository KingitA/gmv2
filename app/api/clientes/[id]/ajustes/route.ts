import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * Ajuste manual de cuenta corriente del cliente.
 *
 * Desde Fase A2 el ajuste postea al LIBRO MAYOR vía RPC `cc_ajuste_manual`
 * (cc_postear) y NO toca comprobantes_venta.saldo_pendiente — la versión
 * anterior modificaba saldo_pendiente sin posteo y rompía v_saldo_clientes.
 *
 * Body: { monto, motivo, comprobante_id? }
 *  - monto > 0 → débito (aumenta la deuda del cliente)
 *  - monto < 0 → crédito (reduce la deuda)
 *  - comprobante_id: opcional, solo referencia en el concepto
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id: cliente_id } = await params
    const body = await request.json()
    const { comprobante_id, monto, motivo } = body

    if (!monto || !motivo) {
      return NextResponse.json({ error: "Faltan datos requeridos (monto, motivo)" }, { status: 400 })
    }

    let concepto = String(motivo)
    if (comprobante_id) {
      const { data: comp } = await supabase
        .from("comprobantes_venta")
        .select("numero_comprobante, tipo_comprobante, cliente_id")
        .eq("id", comprobante_id)
        .single()
      if (comp && comp.cliente_id !== cliente_id) {
        return NextResponse.json(
          { error: "El comprobante no pertenece a este cliente" },
          { status: 400 }
        )
      }
      if (comp) concepto += ` (ref. ${comp.tipo_comprobante} ${comp.numero_comprobante})`
    }

    const { data, error } = await supabase.rpc("cc_ajuste_manual", {
      p_cliente_id: cliente_id,
      p_tipo: Number(monto) > 0 ? "debito" : "credito",
      p_monto: Math.abs(Number(monto)),
      p_concepto: concepto,
      p_usuario_id: auth.user.id,
    })
    if (error) throw new Error(error.message)

    return NextResponse.json({
      success: true,
      movimiento_id: data,
      mensaje: "Ajuste registrado en la cuenta corriente",
    })
  } catch (error: any) {
    console.error("[clientes/ajustes] error:", error)
    return NextResponse.json({ error: error.message || "Error al ajustar saldo" }, { status: 500 })
  }
}
