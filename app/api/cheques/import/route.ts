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

    // Clave lógica sin banco (los imports usan banco "S/D"; un mismo cheque
    // cargado por cobranza puede tener banco real — no hay que duplicarlo)
    const keyOf = (c: { numero: string; monto: number | string; fecha_vencimiento: string }) =>
      `${String(c.numero).trim()}|${Number(c.monto)}|${c.fecha_vencimiento}`

    // Deduplicar filas repetidas dentro del mismo Excel (violarían la unique key)
    const vistos = new Set<string>()
    let duplicadosExcel = 0
    const unicas = limpias.filter((c) => {
      const k = keyOf(c)
      if (vistos.has(k)) { duplicadosExcel++; return false }
      vistos.add(k)
      return true
    })

    // Todos los cheques existentes con esos números, sin importar estado/cartera
    const numeros = [...new Set(unicas.map((c) => c.numero))]
    const existentes = new Map<string, { id: string; estado: string; tipo: string }>()
    for (let i = 0; i < numeros.length; i += 200) {
      const { data, error } = await supabase
        .from("cheques")
        .select("id, numero, monto, fecha_vencimiento, estado, tipo")
        .in("numero", numeros.slice(i, i + 200))
      if (error) throw error
      for (const c of data || []) existentes.set(keyOf(c), { id: c.id, estado: c.estado, tipo: c.tipo })
    }

    const carteras: Cartera[] =
      carteraGlobal === "AUTO"
        ? ([...new Set(unicas.map((c) => c.cartera))] as Cartera[])
        : [carteraGlobal as Cartera]

    const resumen: Record<string, { insertados: number; ya_existian: number; reactivados: number; dados_de_baja: number; conflictos: number }> = {}

    for (const cartera of carteras) {
      const color = cartera === "NEGRO" ? "NEGRO" : "BLANCO"
      const esEcheq = cartera === "ECHEQ"
      const delGrupo = unicas.filter((c) => c.cartera === cartera)

      const nuevos: any[] = []
      const idsReactivar: string[] = []
      let yaExistian = 0
      let conflictos = 0

      for (const c of delGrupo) {
        const ex = existentes.get(keyOf(c))
        if (!ex) {
          nuevos.push({
            tipo: "TERCERO",
            estado: "EN_CARTERA",
            banco: c.banco,
            numero: c.numero,
            monto: c.monto,
            fecha_vencimiento: c.fecha_vencimiento,
            color,
            es_echeq: esEcheq,
            observaciones: `Importado por Excel (cartera ${cartera.toLowerCase()})`,
          })
        } else if (ex.estado === "EN_CARTERA") {
          yaExistian++
        } else if (ex.estado === "COBRADO" && ex.tipo === "TERCERO") {
          // Sigue figurando en el Excel: se lo dio de baja de más → reactivar
          idsReactivar.push(ex.id)
        } else {
          // DEPOSITADO / ENTREGADO / RECHAZADO / propio: no tocar, solo avisar
          conflictos++
        }
      }

      let insertados = 0
      if (nuevos.length) {
        const { error: errInsert, count } = await supabase
          .from("cheques")
          .insert(nuevos, { count: "exact" })
        if (errInsert) throw errInsert
        insertados = count ?? nuevos.length
      }

      let reactivados = 0
      if (idsReactivar.length) {
        const { error: errReact } = await supabase
          .from("cheques")
          .update({
            estado: "EN_CARTERA",
            color,
            es_echeq: esEcheq,
            observaciones: `Reactivado por Excel ${todayArgentina()} (cartera ${cartera.toLowerCase()})`,
          })
          .in("id", idsReactivar)
        if (errReact) throw errReact
        reactivados = idsReactivar.length
      }

      let dadosDeBaja = 0
      if (darBaja) {
        // EN_CARTERA de esta cartera que no figuran en el Excel
        const { data: actuales, error: errActuales } = await supabase
          .from("cheques")
          .select("id, numero, monto, fecha_vencimiento")
          .eq("estado", "EN_CARTERA")
          .eq("tipo", "TERCERO")
          .eq("color", color)
          .eq("es_echeq", esEcheq)
        if (errActuales) throw errActuales
        const enExcel = new Set(delGrupo.map(keyOf))
        const idsBaja = (actuales || [])
          .filter((c) => !enExcel.has(keyOf(c)) && !idsReactivar.includes(c.id))
          .map((c) => c.id)
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

      resumen[cartera] = { insertados, ya_existian: yaExistian, reactivados, dados_de_baja: dadosDeBaja, conflictos }
    }

    const tot = (k: "insertados" | "ya_existian" | "reactivados" | "dados_de_baja" | "conflictos") =>
      Object.values(resumen).reduce((s, r) => s + r[k], 0)

    return NextResponse.json({
      success: true,
      insertados: tot("insertados"),
      ya_existian: tot("ya_existian"),
      reactivados: tot("reactivados"),
      dados_de_baja: tot("dados_de_baja"),
      conflictos: tot("conflictos"),
      duplicados_excel: duplicadosExcel,
      por_cartera: resumen,
      filas_invalidas: invalidas,
    })
  } catch (error: any) {
    console.error("[cheques/import] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
