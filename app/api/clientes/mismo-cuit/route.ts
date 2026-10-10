import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { clientesConMismoCuit, avisoMismoCuit } from "@/lib/clientes/mismo-cuit"

// GET /api/clientes/mismo-cuit?cuit=20-12345678-9&excluir=<id del cliente que se edita>
// → { clientes: [...], aviso: "Ya hay un cliente con este CUIT: …" | null }
// Busca en TODOS los clientes (también los de otros viajantes): el aviso tiene que
// decir cuál es el otro aunque no esté en la cartera de quien carga.
export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { searchParams } = new URL(request.url)
  const clientes = await clientesConMismoCuit(createAdminClient(), searchParams.get("cuit"), searchParams.get("excluir"))
  return NextResponse.json({ clientes, aviso: avisoMismoCuit(clientes) })
}
