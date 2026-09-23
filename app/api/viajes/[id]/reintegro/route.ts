import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireOficina, errorJson } from "@/lib/viajes/servidor"
import { nowArgentina } from "@/lib/utils"

// POST /api/viajes/[id]/reintegro — el chofer puso plata de su bolsillo
// (gastó más que el fondo + lo cobrado en efectivo): su billetera quedó
// negativa (a su favor). Oficina se lo devuelve desde una caja o banco:
// kardex CAJA→BILLETERA (baja la caja) + crédito en la billetera (la deja en 0).
// Body: { origen_tipo: "CAJA"|"BANCO", origen_id, monto }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOficina()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id } = await params
    const body = await request.json()
    const monto = Math.round((Number(body.monto) || 0) * 100) / 100
    if (!body.origen_id || !["CAJA", "BANCO"].includes(body.origen_tipo)) return errorJson("Elegí de qué caja o banco sale la plata")
    if (monto <= 0) return errorJson("El monto debe ser mayor a 0")

    const { data: viaje } = await supabase.from("viajes").select("id, nombre, chofer_id").eq("id", id).single()
    if (!viaje?.chofer_id) return errorJson("Viaje sin chofer titular", 404)

    // Solo hasta lo que la billetera tiene a favor (negativa)
    const { data: saldo } = await supabase
      .from("saldos_financieros")
      .select("saldo")
      .eq("cuenta_tipo", "BILLETERA")
      .eq("cuenta_id", viaje.chofer_id)
    const aFavor = -((saldo || []).reduce((s: number, x: any) => s + Number(x.saldo), 0))
    if (aFavor < 0.01) return errorJson("La billetera del chofer no tiene saldo a favor")
    if (monto > aFavor + 0.01) return errorJson(`El chofer tiene a favor ${aFavor.toFixed(2)}: no se reintegra más que eso`)

    const { data: u } = await supabase.from("usuarios").select("nombre").eq("id", viaje.chofer_id).maybeSingle()
    const concepto = `Reintegro a ${u?.nombre || "chofer"} — puso de su bolsillo en viaje ${viaje.nombre}`

    const { data: transf, error: tErr } = await supabase.rpc("caja_transferir", {
      p_origen_tipo: body.origen_tipo,
      p_origen_id: body.origen_id,
      p_destino_tipo: "BILLETERA",
      p_destino_id: viaje.chofer_id,
      p_monto: monto,
      p_gastos: 0,
      p_color: "BLANCO",
      p_concepto: concepto,
      p_usuario_id: auth.user.id,
    })
    if (tErr) return errorJson(tErr.message.replace(/^caja_transferir:\s*/, ""))

    const { error: bmErr } = await supabase.from("billetera_movimientos").insert({
      viajante_id: viaje.chofer_id,
      tipo: "credito",
      medio: "efectivo",
      monto,
      concepto,
      referencia_tipo: "kardex_contable",
      referencia_id: (transf as any)?.kardex_id ?? null,
      fecha: nowArgentina(),
      creado_por: auth.user.id,
    })
    if (bmErr) {
      console.error("[viajes/reintegro] kardex OK pero billetera falló:", bmErr)
      return errorJson(`La plata salió de la caja pero la billetera no se acreditó (${bmErr.message}). Avisá al administrador.`, 500)
    }
    return NextResponse.json({ success: true, concepto })
  } catch (error: any) {
    console.error("[viajes] Error en POST reintegro:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
