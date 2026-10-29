import { NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { POST as generarUno } from "../generar/route"

// Facturar varios pedidos tildados de una vez (P2-22, /clientes-pedidos).
//
// Los pedidos se facturan UNO ATRÁS DEL OTRO con el mismo circuito que el botón
// "Generar" de cada pedido (segmentos, CAE, PDF, kardex, NC contado). La
// numeración no se repite aunque otras máquinas estén facturando a la vez: cada
// comprobante fiscal espera su turno (tipo + punto de venta) y cada pedido tiene
// su candado. Un pedido que falla no frena a los demás: el resultado dice cuál
// salió y cuál no (y por qué).
//
// Body: { pedido_ids: string[] }  (máximo MAX_PEDIDOS por llamada; el resto, en otra)

export const maxDuration = 300

const MAX_PEDIDOS = 30

type ResultadoPedido = {
  pedido_id: string
  ok: boolean
  status: number
  comprobantes?: Array<{ tipo_comprobante: string; numero: string; id?: string }>
  error?: string
  error_code?: string
}

export async function POST(request: Request) {
  const auth = await requirePermiso("emitir_comprobantes")
  if (auth.error) return auth.error

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 })
  }
  const ids: string[] = Array.isArray(body?.pedido_ids)
    ? [...new Set<string>(body.pedido_ids.filter((x: unknown) => typeof x === "string" && x))]
    : []
  if (!ids.length) return NextResponse.json({ error: "No hay pedidos tildados para facturar" }, { status: 400 })
  if (ids.length > MAX_PEDIDOS) {
    return NextResponse.json({ error: `Se pueden facturar hasta ${MAX_PEDIDOS} pedidos por vez (tildaste ${ids.length}).` }, { status: 400 })
  }

  const resultados: ResultadoPedido[] = []
  for (const pedido_id of ids) {
    try {
      const res = await generarUno(new Request(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_id }),
      }))
      const data = await res.json().catch(() => ({}))
      resultados.push(res.ok
        ? { pedido_id, ok: true, status: res.status, comprobantes: data.comprobantes ?? [] }
        : { pedido_id, ok: false, status: res.status, error: data.error ?? "Error generando comprobantes", error_code: data.error_code })
    } catch (e: any) {
      resultados.push({ pedido_id, ok: false, status: 500, error: e?.message ?? "Error generando comprobantes" })
    }
  }

  const facturados = resultados.filter((r) => r.ok).length
  return NextResponse.json({
    success: facturados === resultados.length,
    facturados,
    fallidos: resultados.length - facturados,
    resultados,
  })
}
