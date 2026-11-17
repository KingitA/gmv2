import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { todayArgentina } from "@/lib/utils"

/**
 * POST /api/cheques/[id]/debitar — conciliación de un cheque PROPIO:
 * el banco lo debitó. ENTREGADO_A_PROVEEDOR → COBRADO + fecha_debito.
 *
 * E-62 (17/11/2026): con la migración 20261117p_ordenes_pago_t1d.sql lo hace la función cheque_propio_debitar,
 * que además BAJA el saldo de la cuenta bancaria del cheque (una línea de kardex), una sola
 * vez. Si el cheque no tiene cuenta (los cargados antes) se puede mandar cuenta_bancaria_id;
 * sin cuenta se marca debitado como antes y se avisa que el saldo del banco no se movió.
 * Sin la migración, sigue funcionando como siempre (solo cambia el estado).
 *
 * Body: { fecha_debito? (default hoy), cuenta_bancaria_id? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const fecha = body.fecha_debito || todayArgentina()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json({ error: "fecha_debito inválida" }, { status: 400 })
    }

    const supabase = createAdminClient()

    const rpc = await supabase.rpc("cheque_propio_debitar", {
      p_cheque_id: id, p_fecha: fecha, p_cuenta_banco_id: body.cuenta_bancaria_id || null, p_usuario_id: auth.user.id,
    })
    if (!rpc.error) {
      const d = (rpc.data ?? {}) as any
      // "mensaje" es lo que la pantalla de cheques muestra debajo del aviso
      return NextResponse.json({
        success: true, ...d,
        mensaje: d.ya_debitado ? "El cheque ya estaba debitado."
          : d.bajo_el_banco === false ? "El cheque no tiene cuenta bancaria cargada: el saldo del banco NO se movió." : "Bajó el saldo de la cuenta bancaria.",
        aviso: d.ya_debitado ? "El cheque ya estaba debitado."
          : d.bajo_el_banco === false ? "Se marcó debitado, pero el cheque no tiene cuenta bancaria cargada: el saldo del banco NO se movió." : undefined,
      })
    }
    const faltaFuncion = (rpc.error.code === "PGRST202" || rpc.error.code === "42883") && /cheque_propio_debitar/.test(rpc.error.message || "")
    if (!faltaFuncion) {
      return NextResponse.json({ error: rpc.error.message }, { status: rpc.error.code === "P0001" ? 400 : 500 })
    }

    // Respaldo sin la migración 20261117p_ordenes_pago_t1d.sql: solo cambia el estado (comportamiento anterior)
    const { data: cheque, error: errGet } = await supabase
      .from("cheques")
      .select("id, tipo, estado")
      .eq("id", id)
      .single()
    if (errGet) throw errGet
    if (!cheque || cheque.tipo !== "PROPIO" || cheque.estado !== "ENTREGADO_A_PROVEEDOR") {
      return NextResponse.json(
        { error: "Solo se puede debitar un cheque PROPIO en estado ENTREGADO_A_PROVEEDOR" },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from("cheques")
      .update({ estado: "COBRADO", fecha_debito: fecha })
      .eq("id", id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[cheques/debitar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
