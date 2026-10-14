import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { duenoDelCodigo, normalizarCodigo, siguienteCodigo, type EntidadCodigo } from "@/lib/codigos"

// GET /api/codigos?entidad=cliente|proveedor[&codigo=342][&excluir=<id que se edita>]
// → { sugerido: "4", codigo: "342", disponible: false, ocupado_por: { id, nombre, activo } }
// Sin `codigo`: solo el primer número libre (para precargar el alta).
export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const entidad = searchParams.get("entidad") as EntidadCodigo
  if (entidad !== "cliente" && entidad !== "proveedor") {
    return NextResponse.json({ error: "entidad debe ser cliente o proveedor" }, { status: 400 })
  }
  const sb = createAdminClient()
  const codigo = normalizarCodigo(searchParams.get("codigo"))
  const [sugerido, ocupado] = await Promise.all([
    siguienteCodigo(sb, entidad),
    codigo ? duenoDelCodigo(sb, entidad, codigo, searchParams.get("excluir")) : Promise.resolve(null),
  ])
  return NextResponse.json({ sugerido, codigo, disponible: !ocupado, ocupado_por: ocupado })
}
