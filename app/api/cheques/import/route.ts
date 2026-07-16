import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { todayArgentina } from "@/lib/utils"

type Cartera = "BLANCO" | "NEGRO" | "ECHEQ"

/**
 * POST /api/cheques/import — actualización de la cartera de cheques por Excel.
 * El cliente parsea el xlsx y manda las filas normalizadas.
 *
 * Body: {
 *   cartera: 'BLANCO' | 'NEGRO' | 'ECHEQ' | 'AUTO',
 *   cheques: [{ numero, monto, fecha_vencimiento (YYYY-MM-DD), banco?, cartera? }],
 *   dar_baja_faltantes?: boolean   // marca COBRADO los EN_CARTERA de esa/s
 *                                  // cartera/s que no figuran en el Excel
 * }
 *
 * Con cartera 'AUTO' cada fila trae su propia cartera (detectada por el
 * cliente según el número: E→echeq, -→negro, /→blanco) y el Excel único se
 * procesa por grupos; dar_baja_faltantes aplica a las tres carteras.
 *
 * Mapeo a la tabla `cheques` existente:
 *   BLANCO → color BLANCO / NEGRO → color NEGRO / ECHEQ → color BLANCO + es_echeq
 */
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const carteraGlobal: string = body.cartera
    const rows: any[] = Array.isArray(body.cheques) ? body.cheques : []
    const darBaja: boolean = !!body.dar_baja_faltantes

    if (!["BLANCO", "NEGRO", "ECHEQ", "AUTO"].includes(carteraGlobal)) {
      return NextResponse.json({ error: "cartera inválida (BLANCO | NEGRO | ECHEQ | AUTO)" }, { status: 400 })
    }
    if (!rows.length) {
      return NextResponse.json({ error: "No hay cheques para importar" }, { status: 400 })
    }

    // Validar y normalizar filas, resolviendo la cartera de cada una
    const invalidas: number[] = []
    const limpias: { numero: string; monto: number; fecha_vencimiento: string; banco: string; cartera: Cartera }[] = []
    rows.forEach((r, i) => {
      const numero = String(r.numero ?? "").trim()
      const monto = Number(r.monto)
      const fecha = String(r.fecha_vencimiento ?? "").trim()
      const cartera = (carteraGlobal === "AUTO" ? String(r.cartera ?? "") : carteraGlobal) as Cartera
      if (!numero || !monto || monto <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !["BLANCO", "NEGRO", "ECHEQ"].includes(cartera)) {
        invalidas.push(i + 1)
        return
      }
      limpias.push({
        numero,
        monto,
        fecha_vencimiento: fecha,
        banco: String(r.banco ?? "").trim() || "S/D",
        cartera,
      })
    })

    if (!limpias.length) {
      return NextResponse.json(
        { error: `Ninguna fila válida (filas con error: ${invalidas.join(", ")})` },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()
    const carteras: Cartera[] =
      carteraGlobal === "AUTO"
        ? ([...new Set(limpias.map((c) => c.cartera))] as Cartera[])
        : [carteraGlobal as Cartera]

    const keyOf = (c: { numero: string; monto: number | string; fecha_vencimiento: string }) =>
      `${String(c.numero).trim()}|${Number(c.monto)}|${c.fecha_vencimiento}`

    const resumen: Record<string, { insertados: number; ya_existian: number; dados_de_baja: number }> = {}

    for (const cartera of carteras) {
      const color = cartera === "NEGRO" ? "NEGRO" : "BLANCO"
      const esEcheq = cartera === "ECHEQ"
      const delGrupo = limpias.filter((c) => c.cartera === cartera)

      // Cartera actual en el sistema (misma combinación color + es_echeq)
      const { data: actuales, error: errActuales } = await supabase
        .from("cheques")
        .select("id, numero, monto, fecha_vencimiento, banco")
        .eq("estado", "EN_CARTERA")
        .eq("tipo", "TERCERO")
        .eq("color", color)
        .eq("es_echeq", esEcheq)
      if (errActuales) throw errActuales

      const existentes = new Set((actuales || []).map(keyOf))
      const enExcel = new Set(delGrupo.map(keyOf))

      const nuevos = delGrupo
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

      let dadosDeBaja = 0
      if (darBaja) {
        const idsBaja = (actuales || []).filter((c) => !enExcel.has(keyOf(c))).map((c) => c.id)
        if (idsBaja.length) {
          const { error: errBaja } = await supabase
            .from("cheques")
            .update({
              estado: "COBRADO",
              observaciones: `Baja por sincronización Excel ${todayArgentina()}`,
            })
            .in("id", idsBaja)
          if (errBaja) throw errBaja
          dadosDeBaja = idsBaja.length
        }
      }

      resumen[cartera] = { insertados, ya_existian: delGrupo.length - nuevos.length, dados_de_baja: dadosDeBaja }
    }

    const tot = (k: "insertados" | "ya_existian" | "dados_de_baja") =>
      Object.values(resumen).reduce((s, r) => s + r[k], 0)

    return NextResponse.json({
      success: true,
      insertados: tot("insertados"),
      ya_existian: tot("ya_existian"),
      dados_de_baja: tot("dados_de_baja"),
      por_cartera: resumen,
      filas_invalidas: invalidas,
    })
  } catch (error: any) {
    console.error("[cheques/import] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
