import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// GET /api/bcra/deudor/[cuit]
// Proxy a la API pública del BCRA — Central de Deudores.
// Retorna la peor situación crediticia del CUIT en los últimos períodos.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cuit: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const { cuit } = await params
    // Limpiar CUIT: solo dígitos (puede venir como 20-12345678-9 o 20123456789)
    const cuitLimpio = cuit.replace(/\D/g, "")

    if (cuitLimpio.length < 10 || cuitLimpio.length > 11) {
      return NextResponse.json({ error: "CUIT inválido" }, { status: 400 })
    }

    const url = `https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/${cuitLimpio}`
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      // timeout implícito de Next.js fetch (30s)
    })

    if (res.status === 404) {
      // CUIT sin deudas registradas = situación 1 (sin antecedentes)
      return NextResponse.json({
        cuit: cuitLimpio,
        denominacion: null,
        situacion_max: 1,
        sin_antecedentes: true,
        apto: true,
        detalle: [],
      })
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `Error BCRA: ${res.status}` },
        { status: 502 }
      )
    }

    const data = await res.json()
    const results = data.results

    // Recorrer todos los períodos y todas las entidades → peor situación
    let situacionMax = 1
    const detalle: Array<{ periodo: string; entidad: number; situacion: number; monto: number }> = []

    for (const periodo of results?.periodos || []) {
      for (const entidad of periodo.entidades || []) {
        const sit = Number(entidad.situacion)
        if (sit > situacionMax) situacionMax = sit
        detalle.push({
          periodo: periodo.periodo,
          entidad: entidad.entidad,
          situacion: sit,
          monto: entidad.monto || 0,
        })
      }
    }

    // Ordenar por período desc para mostrar el más reciente primero
    detalle.sort((a, b) => b.periodo.localeCompare(a.periodo))

    return NextResponse.json({
      cuit: cuitLimpio,
      denominacion: results?.denominacion || null,
      situacion_max: situacionMax,
      sin_antecedentes: false,
      apto: situacionMax === 1,
      detalle: detalle.slice(0, 10), // últimos 10 registros
    })
  } catch (error: any) {
    console.error("[bcra] Error consultando BCRA:", error)
    return NextResponse.json({ error: "No se pudo consultar el BCRA. Verificá tu conexión." }, { status: 502 })
  }
}
