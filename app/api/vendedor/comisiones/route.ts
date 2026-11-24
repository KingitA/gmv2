import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { calcularComisiones } from "@/lib/vendedor/comisiones-vendedor"

// GET /api/vendedor/comisiones?tipo=cobrada|vendida
// Comisiones del vendedor. REGLA DE ORO: el vendedor solo ve plata que
// efectivamente va a cobrar (netos). El monto pactado vive en el kardex
// (comision_viajante_monto, al % con el que se vendió — la config actual del
// vendedor NO pisa ventas viejas) y cuando el comprobante se cobró con
// bonificación contado, la fila trae descuento_financiero_pct: la comisión
// neta es monto × (1 − pct/100).
// - totales:
//   · disponible ("para retirar") = Σ comisiones tipo='cobrada' pagado=false
//     (la tabla ya incluye los débitos negativos del 10% → da neto solo)
//   · retirado = Σ tipo='cobrada' pagado=true
//   · sin_cobrar = devengado desde kardex sin cobrar — ESTIMADO máximo (el
//     10% contado recién se conoce cuando el cliente paga); la UI lo rotula.
// - pedidos: agregado por pedido con comisión NETA por línea.
// - V3 (21/10): con la cuenta personal vinculada, "cobrada" sale de los renglones de
//   comisión de esa cuenta (lo GANADO, ya sin devoluciones ni contado): la suma de la
//   lista es exactamente "Comisiones ganadas". total_pactada = lo del kardex, para explicar.
export async function GET(req: NextRequest) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(req.url)
    const tipo = searchParams.get("tipo") === "vendida" ? "vendida" : "cobrada"

    const r = await calcularComisiones(supabase, session)
    return NextResponse.json(tipo === "vendida" ? r.vendida : r.cobrada)
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/comisiones:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
