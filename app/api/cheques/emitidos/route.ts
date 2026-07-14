import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * POST /api/cheques/emitidos — registrar cheques propios entregados a un
 * proveedor. Van a la tabla `cheques` con tipo PROPIO y estado
 * ENTREGADO_A_PROVEEDOR. Mientras no tengan fecha_debito, se muestran como
 * plata comprometida (pueden debitarse desde fecha_vencimiento y por 30 días).
 *
 * Body: {
 *   proveedor_id?, vencimiento_id?,
 *   cheques: [{ numero, monto, fecha_vencimiento (fecha de pago),
 *               banco?, color? (BLANCO|NEGRO), es_echeq? }]
 * }
 */
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const rows: any[] = Array.isArray(body.cheques) ? body.cheques : []
    if (!rows.length) {
      return NextResponse.json({ error: "No hay cheques para registrar" }, { status: 400 })
    }

    const hoy = new Date().toISOString().slice(0, 10)
    const invalidas: number[] = []
    const inserts = rows
      .map((r, i) => {
        const numero = String(r.numero ?? "").trim()
        const monto = Number(r.monto)
        const fecha = String(r.fecha_vencimiento ?? "").trim()
        const color = r.color === "NEGRO" ? "NEGRO" : "BLANCO"
        if (!numero || !monto || monto <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
          invalidas.push(i + 1)
          return null
        }
        return {
          tipo: "PROPIO",
          estado: "ENTREGADO_A_PROVEEDOR",
          banco: String(r.banco ?? "").trim() || "S/D",
          numero,
          monto,
          fecha_emision: hoy,
          fecha_vencimiento: fecha,
          color,
          es_echeq: !!r.es_echeq,
          proveedor_destino_id: body.proveedor_id || null,
          observaciones: body.vencimiento_id ? `Emitido por vencimiento ${body.vencimiento_id}` : null,
        }
      })
      .filter(Boolean)

    if (!inserts.length) {
      return NextResponse.json(
        { error: `Ningún cheque válido (filas con error: ${invalidas.join(", ")})` },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()
    const { error, count } = await supabase.from("cheques").insert(inserts as any[], { count: "exact" })
    if (error) throw error

    return NextResponse.json({ success: true, registrados: count ?? inserts.length, filas_invalidas: invalidas })
  } catch (error: any) {
    console.error("[cheques/emitidos] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
