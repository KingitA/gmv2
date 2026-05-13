import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { nowArgentina } from "@/lib/utils"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  // Solo admin puede registrar movimientos manuales
  const { data: rolData } = await (await createClient())
    .from("usuarios_roles")
    .select("rol")
    .eq("user_id", auth.user.id)
    .single()

  if (rolData?.rol !== "admin") {
    return NextResponse.json({ error: "Solo administradores pueden registrar movimientos manuales" }, { status: 403 })
  }

  try {
    const supabase = await createClient()
    const { id } = await params
    const { tipo, monto, concepto, medio } = await request.json()

    if (!tipo || !monto || !concepto) {
      return NextResponse.json({ error: "tipo, monto y concepto son requeridos" }, { status: 400 })
    }
    if (!["debito", "credito"].includes(tipo)) {
      return NextResponse.json({ error: "tipo debe ser 'debito' o 'credito'" }, { status: 400 })
    }

    // Débito = monto negativo, crédito = monto positivo
    const montoFinal = tipo === "debito" ? -Math.abs(Number(monto)) : Math.abs(Number(monto))

    const { data, error } = await supabase.from("billetera_movimientos").insert({
      viajante_id: id,
      tipo,
      medio: medio ?? null,
      monto: montoFinal,
      concepto,
      referencia_tipo: "manual",
      fecha: nowArgentina(),
      creado_por: auth.user.id,
    }).select().single()

    if (error) throw error

    return NextResponse.json({ success: true, movimiento: data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
