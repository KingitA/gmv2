import { NextRequest, NextResponse } from "next/server"

// Ejecuta en Edge Runtime — IPs de Vercel Edge (distinto a AWS Lambda, no bloqueadas por BCRA)
export const runtime = "edge"

// GET /api/bcra/deudor/[cuit]
// Proxy público a la API de Central de Deudores del BCRA.
// Solo expone datos que ya son públicos en api.bcra.gob.ar — no requiere auth.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cuit: string }> }
) {
  try {
    const { cuit } = await params
    const cuitLimpio = cuit.replace(/\D/g, "")

    if (cuitLimpio.length < 10 || cuitLimpio.length > 11) {
      return NextResponse.json({ error: "CUIT inválido" }, { status: 400 })
    }

    const res = await fetch(
      `https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/${cuitLimpio}`,
      { headers: { Accept: "application/json" } }
    )

    if (res.status === 404) {
      return NextResponse.json({
        cuit: cuitLimpio,
        denominacion: null,
        situacion_max: 1,
        sin_antecedentes: true,
        apto: true,
        entidades: [],
      })
    }

    if (!res.ok) {
      return NextResponse.json({ error: `Error BCRA: ${res.status}` }, { status: 502 })
    }

    const data = await res.json()
    const results = data.results
    let situacionMax = 1

    // Peor situación por entidad (todas las informadas): permite al front
    // resaltar si la deuda está justo en el banco emisor del cheque.
    const porEntidad = new Map<string, number>()
    for (const periodo of results?.periodos || []) {
      for (const entidad of periodo.entidades || []) {
        const sit = Number(entidad.situacion)
        if (sit > situacionMax) situacionMax = sit
        const nombre = String(entidad.entidad || "").trim()
        if (nombre) porEntidad.set(nombre, Math.max(porEntidad.get(nombre) ?? 0, sit))
      }
    }

    return NextResponse.json({
      cuit: cuitLimpio,
      denominacion: results?.denominacion || null,
      situacion_max: situacionMax,
      sin_antecedentes: false,
      apto: situacionMax === 1,
      entidades: [...porEntidad.entries()]
        .map(([entidad, situacion]) => ({ entidad, situacion }))
        .sort((a, b) => b.situacion - a.situacion),
    })
  } catch (error: any) {
    console.error("[bcra]", error?.message)
    return NextResponse.json({ error: "No se pudo consultar el BCRA" }, { status: 502 })
  }
}
