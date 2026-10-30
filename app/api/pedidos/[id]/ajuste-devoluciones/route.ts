import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { planNeutralizacion } from "@/lib/pedidos/ajuste-devoluciones-refacturado"

// P2-43: antes de volver a Generar un pedido refacturado, qué artículos salen del
// comprobante nuevo por estar devueltos y qué crédito se neutraliza.
//  GET → { devoluciones: [{ numero, articulos, neutralizaciones: [{ tipo, total, fiscal }], aparte, texto }] }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso("emitir_comprobantes")
  if (auth.error) return auth.error
  try {
    const { id } = await params
    const plan = await planNeutralizacion(createAdminClient() as any, id)
    return NextResponse.json({
      devoluciones: plan.map((p) => ({
        numero: p.numero,
        articulos: p.articulos.map((a) => ({ descripcion: a.descripcion, cantidad: a.cantidad })),
        neutralizaciones: p.neutralizaciones.filter((n) => !n.ya).map((n) => ({ tipo: n.tipo, total: n.total, fiscal: n.fiscal })),
        aparte: p.con_parte_aparte,
        texto: p.texto,
      })),
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Error revisando las devoluciones del pedido" }, { status: 500 })
  }
}
