import { NextRequest, NextResponse } from "next/server"
import { bcraSinAntecedentes, cuitValido, interpretarRespuestaBcra } from "@/lib/cheques/isomorfico"

// Ejecuta en Edge Runtime — IPs de Vercel Edge (distinto a AWS Lambda, que el BCRA bloquea)
export const runtime = "edge"

const BCRA_TIMEOUT_MS = 10_000

// GET /api/bcra/deudor/[cuit]
// Proxy público a la API de Central de Deudores del BCRA.
// Solo expone datos que ya son públicos en api.bcra.gob.ar — no requiere auth.
// Solo acepta CUITs completos y válidos (dígito verificador): nada de consultas a
// medio tipear ni de números inventados.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cuit: string }> }
) {
  const { cuit } = await params
  const cuitLimpio = cuit.replace(/\D/g, "")
  if (!cuitValido(cuitLimpio)) {
    return NextResponse.json({ error: "CUIT inválido" }, { status: 400 })
  }
  try {
    const res = await fetch(`https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/${cuitLimpio}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(BCRA_TIMEOUT_MS),
    })
    if (res.status === 404) return NextResponse.json(bcraSinAntecedentes(cuitLimpio))
    if (!res.ok) return NextResponse.json({ error: `Error BCRA: ${res.status}` }, { status: 502 })
    return NextResponse.json(interpretarRespuestaBcra(cuitLimpio, await res.json()))
  } catch (error: any) {
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError"
    console.error("[bcra]", error?.message)
    return NextResponse.json({ error: timeout ? "El BCRA no respondió a tiempo" : "No se pudo consultar el BCRA" }, { status: 502 })
  }
}
