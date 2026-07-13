import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

type Cartera = "BLANCO" | "NEGRO" | "ECHEQ"

/**
 * POST /api/cheques/import — actualización de la cartera de cheques por Excel.
 * El cliente parsea el xlsx y manda las filas normalizadas.
 *
 * Body: {
 *   cartera: 'BLANCO' | 'NEGRO' | 'ECHEQ',
 *   cheques: [{ numero, monto, fecha_vencimiento (YYYY-MM-DD), banco? }],
 *   dar_baja_faltantes?: boolean   // marca COBRADO los EN_CARTERA de esa
 *                                  // cartera que no figuran en el Excel
 * }
 *
 * Mapeo a la tabla `cheques` existente (sin duplicar nada):
 *   BLANCO → color BLANCO / NEGRO → color NEGRO / ECHEQ → color BLANCO + es_echeq
 */
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const cartera: Cartera = body.cartera
    const rows: any[] = Array.isArray(body.cheques) ? body.cheques : []
    const darBaja: boolean = !!body.dar_baja_faltantes

    if (!["BLANCO", "NEGRO", "ECHEQ"].includes(cartera)) {
      return NextResponse.json({ error: "cartera inválida (BLANCO | NEGRO | ECHEQ)" }, { status: 400 })
    }
    if (!rows.length) {
      return NextResponse.json({ error: "No hay cheques para importar" }, { status: 400 })
    }

    const color = cartera === "NEGRO" ? "NEGRO" : "BLANCO"
    const esEcheq = cartera === "ECHEQ"

    // Validar filas
    const invalidas: number[] = []
    const limpias = rows
      .map((r, i) => {
        const numero = String(r.numero ?? "").trim()
        const monto = Number(r.monto)
        const fecha = String(r.fecha_vencimiento ?? "").trim()
        if (!numero || !monto || monto <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
          invalidas.push(i + 1)
          return null
        }
        return {
          numero,
          monto,
          fecha_vencimiento: fecha,
          banco: String(r.banco ?? "").trim() || "S/D",
        }
      })
      .filter(Boolean) as { numero: string; monto: number; fecha_vencimiento: string; banco: string }[]

    if (!limpias.length) {
      return NextResponse.json(
        { error: `Ninguna fila válida (filas con error: ${invalidas.join(", ")})` },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Cartera actual (misma combinación color + es_echeq, solo terceros en cartera)
    const { data: actuales, error: errActuales } = await supabase
      .from("cheques")
      .select("id, numero, monto, fecha_vencimiento, banco")
      .eq("estado", "EN_CARTERA")
      .eq("tipo", "TERCERO")
      .eq("color", color)
      .eq("es_echeq", esEcheq)
    if (errActuales) throw errActuales

    const keyOf = (c: { numero: string; monto: number | string; fecha_vencimiento: string }) =>
      `${String(c.numero).trim()}|${Number(c.monto)}|${c.fecha_vencimiento}`

    const existentes = new Map((actuales || []).map((c) => [keyOf(c), c]))
    const enExcel = new Set(limpias.map(keyOf))

    // Insertar los que no están
    const nuevos = limpias
      .filter((c) => !existentes.has(keyOf(c)))
      .map((c) => ({
        tipo: "TERCERO",
        estado: "EN_CARTERA",
        banco: c.banco,
        numero: c.numero,
        monto: c.monto,
        fecha_vencimiento: c.fecha_vencimiento,
        color,
        es_echeq: esEcheq,
        observaciones: `Importado por Excel (cartera ${cartera.toLowerCase()})`,
      }))

    let insertados = 0
    if (nuevos.length) {
      const { error: errInsert, count } = await supabase
        .from("cheques")
        .insert(nuevos, { count: "exact" })
      if (errInsert) throw errInsert
      insertados = count ?? nuevos.length
    }

    // Baja de los que ya no figuran (opcional)
    let dadosDeBaja = 0
    if (darBaja) {
      const idsBaja = (actuales || []).filter((c) => !enExcel.has(keyOf(c))).map((c) => c.id)
      if (idsBaja.length) {
        const { error: errBaja } = await supabase
          .from("cheques")
          .update({
            estado: "COBRADO",
            observaciones: `Baja por sincronización Excel ${new Date().toISOString().slice(0, 10)}`,
          })
          .in("id", idsBaja)
        if (errBaja) throw errBaja
        dadosDeBaja = idsBaja.length
      }
    }

    return NextResponse.json({
      success: true,
      insertados,
      ya_existian: limpias.length - nuevos.length,
      dados_de_baja: dadosDeBaja,
      filas_invalidas: invalidas,
    })
  } catch (error: any) {
    console.error("[cheques/import] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
