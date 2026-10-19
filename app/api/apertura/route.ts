import { NextRequest, NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import type { RenglonApertura } from "@/lib/apertura/parsear-chr"
import { confirmarApertura, previsualizarApertura } from "@/lib/apertura/importar"

// POST /api/apertura — apertura de cuentas corrientes desde el reporte de
// impagos del sistema viejo (solo admin). La pantalla lee el archivo y manda
// los renglones ya separados:
//   { accion: "previsualizar", renglones }  → no graba nada
//   { accion: "confirmar", renglones }      → graba (un lote de clientes por vez)
export async function POST(request: NextRequest) {
  const auth = await requirePermiso("caja")
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const renglones = (Array.isArray(body?.renglones) ? body.renglones : []) as RenglonApertura[]
    if (!renglones.length) return NextResponse.json({ error: "No hay renglones para cargar" }, { status: 400 })
    // Service role: escribe comprobantes, pagos y libro mayor en bloque (el
    // permiso ya se controló arriba: solo admin).
    const db = createAdminClient()
    if (body?.accion === "confirmar") {
      const r = await confirmarApertura(db, renglones, auth.user.id)
      return NextResponse.json({ success: true, ...r })
    }
    const previa = await previsualizarApertura(db, renglones)
    return NextResponse.json(previa)
  } catch (e: any) {
    console.error("[apertura] error:", e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
