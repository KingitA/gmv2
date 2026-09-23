// Operación `bcra.consultar` del outbox: consulta la Central de Deudores del BCRA
// para los CUITs de un cheque, EN SEGUNDO PLANO y desacoplada del cobro.
//
// Diseño (MOBILE.md → "Vendedor → Cheques"):
//  - La app la encola justo después de `cobro.registrar`; el cobro cierra sin esperar.
//  - Funciona sin señal al capturar: queda en el outbox y sale cuando vuelve la red.
//  - NUNCA lanza un error transitorio por el BCRA: si el BCRA no responde, devuelve
//    `veredicto: "sin_respuesta"` como operación APLICADA. Un transitorio frenaría el
//    FIFO del usuario (O3) y dejaría trabados los cobros y pedidos siguientes por una
//    consulta informativa. La app ofrece "Reintentar" (nueva operación).
//  - Consulta vía el proxy Edge propio (/api/bcra/deudor): las IPs de Lambda están
//    bloqueadas por el BCRA. Si el proxy no responde, intenta directo.

import { bcraError, bcraSinAntecedentes, cuitValido, interpretarRespuestaBcra, normalizarCuit, veredictoBcra, type BcraResultado, type ConsultaBcraPayload, type ConsultaBcraResultado } from "@/lib/cheques/isomorfico"
import type { CtxOutbox, HandlerDef } from "./tipos"

const TIMEOUT_MS = 8_000
const INTENTOS = 2

async function consultarUno(ctx: CtxOutbox, cuit: string): Promise<BcraResultado> {
  const limpio = cuit.replace(/\D/g, "")
  let ultimoError = "No se pudo consultar el BCRA"
  for (let intento = 1; intento <= INTENTOS; intento++) {
    // 1) Proxy Edge propio (mismo despliegue). En previews protegidos por SSO hace falta el bypass.
    try {
      const url = new URL(`/api/bcra/deudor/${limpio}`, ctx.request.url)
      const headers: Record<string, string> = { Accept: "application/json" }
      if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
      const ct = res.headers.get("content-type") || ""
      if (ct.includes("application/json")) {
        const d = await res.json()
        if (res.ok && !d?.error) return d as BcraResultado
        if (res.status === 400) return bcraError(limpio, "CUIT inválido")
        ultimoError = String(d?.error || `Error BCRA (${res.status})`)
      } else ultimoError = `Proxy BCRA respondió ${res.status}`
    } catch (e: any) {
      ultimoError = e?.name === "TimeoutError" ? "El BCRA no respondió a tiempo" : String(e?.message || ultimoError)
    }
    // 2) Directo (por si el proxy no está disponible)
    try {
      const res = await fetch(`https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/${limpio}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (res.status === 404) return bcraSinAntecedentes(limpio)
      if (res.ok) return interpretarRespuestaBcra(limpio, await res.json())
      ultimoError = `Error BCRA: ${res.status}`
    } catch (e: any) {
      ultimoError = e?.name === "TimeoutError" ? "El BCRA no respondió a tiempo" : ultimoError
    }
  }
  return bcraError(limpio, ultimoError)
}

export const bcraConsultar: HandlerDef<ConsultaBcraPayload> = {
  tipo: "bcra.consultar",
  roles: ["vendedor", "chofer"],
  validar: (p) => {
    const cuits = Array.isArray(p?.cuits) ? p.cuits : []
    if (!cuits.length || cuits.length > 4) return "Consulta BCRA sin CUIT"
    if (!cuits.every((c) => typeof c === "string" && cuitValido(c))) return "Consulta BCRA con CUIT inválido"
    return null
  },
  async aplicar(ctx, m): Promise<ConsultaBcraResultado> {
    const cuits = [...new Set(m.payload.cuits.map((c) => normalizarCuit(c)).filter((c): c is string => !!c))]
    const resultados = await Promise.all(cuits.map((c) => consultarUno(ctx, c)))
    const v = veredictoBcra(resultados, m.payload.banco)
    return {
      veredicto: v.veredicto,
      titulo: v.titulo,
      detalle: v.detalle,
      mismoBanco: v.mismoBanco,
      cheque: {
        banco: m.payload.banco ?? null,
        numero_cheque: m.payload.numero_cheque ?? null,
        monto: typeof m.payload.monto === "number" ? m.payload.monto : null,
        cliente_nombre: m.payload.cliente_nombre ?? null,
      },
      consultado_at: new Date().toISOString(),
    }
  },
}
