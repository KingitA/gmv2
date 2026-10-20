import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { fecha, moneda } from "@/lib/formato"

type Cartera = "BLANCO" | "NEGRO" | "ECHEQ"

const ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * POST /api/cheques/manual — carga a mano de un cheque de TERCERO que no viene
 * de un cliente ni va a un proveedor (venta de pallets, venta del camión…).
 * Queda EN_CARTERA y nada más: no toca kardex, cajas ni cuentas corrientes.
 *
 * Body: {
 *   numero, banco, monto (> 0), fecha_vencimiento (YYYY-MM-DD),
 *   fecha_emision? (YYYY-MM-DD), cartera ('BLANCO' | 'NEGRO' | 'ECHEQ'),
 *   origen (texto libre, obligatorio), observaciones?
 * }
 * Duplicado = mismo número + monto + vencimiento (misma clave que la importación
 * por Excel) → 409.
 * Respuesta: { ok: true, cheque }
 */
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const body = await request.json().catch(() => ({}))
    const numero = String(body.numero ?? "").trim()
    const banco = String(body.banco ?? "").trim()
    const monto = typeof body.monto === "number" ? body.monto : Number(body.monto)
    const fechaVenc = String(body.fecha_vencimiento ?? "").trim()
    const fechaEmisionRaw = String(body.fecha_emision ?? "").trim()
    const cartera = String(body.cartera ?? "") as Cartera
    const origen = String(body.origen ?? "").trim()
    const observaciones = String(body.observaciones ?? "").trim()

    if (!numero) return NextResponse.json({ error: "Falta el número del cheque" }, { status: 400 })
    if (!banco) return NextResponse.json({ error: "Falta el banco" }, { status: 400 })
    if (!Number.isFinite(monto) || monto <= 0) {
      return NextResponse.json({ error: "El monto tiene que ser mayor a cero" }, { status: 400 })
    }
    if (!ISO.test(fechaVenc)) {
      return NextResponse.json({ error: "Fecha de vencimiento inválida" }, { status: 400 })
    }
    if (fechaEmisionRaw && !ISO.test(fechaEmisionRaw)) {
      return NextResponse.json({ error: "Fecha de emisión inválida" }, { status: 400 })
    }
    if (!["BLANCO", "NEGRO", "ECHEQ"].includes(cartera)) {
      return NextResponse.json({ error: "Cartera inválida (Blanco, Negro o Echeq)" }, { status: 400 })
    }
    if (!origen) {
      return NextResponse.json({ error: "Indicá el origen del cheque (ej. Venta de pallets)" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Misma clave lógica que /api/cheques/import: número + monto + vencimiento
    const { data: existentes, error: errEx } = await supabase
      .from("cheques")
      .select("id, numero, monto, fecha_vencimiento, estado")
      .eq("numero", numero)
      .eq("fecha_vencimiento", fechaVenc)
    if (errEx) throw errEx
    const dup = (existentes || []).find((c) => Number(c.monto) === monto)
    if (dup) {
      return NextResponse.json(
        {
          error: `Ya existe el cheque Nº ${numero} por ${moneda(monto)} con vencimiento ${fecha(fechaVenc)} (estado ${String(dup.estado).replace(/_/g, " ").toLowerCase()}).`,
        },
        { status: 409 }
      )
    }

    const { data: cheque, error } = await supabase
      .from("cheques")
      .insert({
        tipo: "TERCERO",
        estado: "EN_CARTERA",
        banco,
        numero,
        monto,
        fecha_emision: fechaEmisionRaw || null,
        fecha_vencimiento: fechaVenc,
        color: cartera === "NEGRO" ? "NEGRO" : "BLANCO",
        es_echeq: cartera === "ECHEQ",
        observaciones: "Origen: " + origen + (observaciones ? " · " + observaciones : ""),
      })
      .select("*")
      .single()
    if (error) throw error

    return NextResponse.json({ ok: true, cheque })
  } catch (error: any) {
    console.error("[cheques/manual] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
