import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { fetchAllRows } from "@/lib/supabase/fetch-all"

/**
 * GET /api/cheques?estado=EN_CARTERA — cartera de cheques con cliente origen
 * y cuenta de depósito. Sin estado devuelve todos (últimos 300).
 * (cheques no tiene FKs a clientes/cuentas_bancarias → lookups manuales.)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado")
    const tipo = searchParams.get("tipo")

    // Paginado interno: la cartera ya supera 300 → sin esto se ocultaban cheques.
    const cheques = await fetchAllRows(() => {
      let q = supabase.from("cheques").select("*").order("fecha_vencimiento", { ascending: true })
      if (estado) q = q.eq("estado", estado)
      if (tipo) q = q.eq("tipo", tipo)
      return q
    }, "id")

    const clienteIds = [...new Set((cheques || []).map((c) => c.cliente_origen_id).filter(Boolean))]
    const cuentaIds = [...new Set((cheques || []).map((c) => c.cuenta_banco_id).filter(Boolean))]
    const proveedorIds = [...new Set((cheques || []).map((c) => c.proveedor_destino_id).filter(Boolean))]

    const [clientesRes, cuentasRes, proveedoresRes] = await Promise.all([
      clienteIds.length
        ? supabase.from("clientes").select("id, nombre").in("id", clienteIds)
        : Promise.resolve({ data: [] as any[] }),
      cuentaIds.length
        ? supabase.from("cuentas_bancarias").select("id, nombre").in("id", cuentaIds)
        : Promise.resolve({ data: [] as any[] }),
      proveedorIds.length
        ? supabase.from("proveedores").select("id, nombre, sigla").in("id", proveedorIds)
        : Promise.resolve({ data: [] as any[] }),
    ])

    const clientes = new Map((clientesRes.data || []).map((c: any) => [c.id, c.nombre]))
    const cuentas = new Map((cuentasRes.data || []).map((c: any) => [c.id, c.nombre]))
    const proveedores = new Map((proveedoresRes.data || []).map((p: any) => [p.id, p.nombre]))

    return NextResponse.json({
      cheques: (cheques || []).map((c) => ({
        ...c,
        cliente_nombre: c.cliente_origen_id ? clientes.get(c.cliente_origen_id) ?? null : null,
        cuenta_deposito_nombre: c.cuenta_banco_id ? cuentas.get(c.cuenta_banco_id) ?? null : null,
        proveedor_nombre: c.proveedor_destino_id ? proveedores.get(c.proveedor_destino_id) ?? null : null,
      })),
    })
  } catch (error: any) {
    console.error("[cheques] GET error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
