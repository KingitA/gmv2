import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { creditosAFavor } from "@/lib/cobranzas/creditos-a-favor"

// GET /api/pagos-clientes/creditos?cliente_id=… — plata a favor tildable en un
// cobro de /caja (#37): NC/REV vivas y entregas a cuenta con disponible, sin lo
// que ya tomaron cobros sin confirmar. La oficina decide si la usa (regla 39);
// se manda como `creditos_aplicar` en POST /api/pagos-clientes.
export async function GET(request: NextRequest) {
  const auth = await requirePermiso("cargar_cobros")
  if (auth.error) return auth.error
  const clienteId = request.nextUrl.searchParams.get("cliente_id")
  if (!clienteId) return NextResponse.json({ error: "cliente_id requerido" }, { status: 400 })
  const supabase = await createClient()
  const { creditos, aCuenta, totalAFavor } = await creditosAFavor(supabase, clienteId)
  return NextResponse.json({
    creditos,
    a_cuenta: aCuenta.map(({ vendedor_id: _v, creado_por: _c, ...p }) => p),
    total_a_favor: totalAFavor,
  })
}
