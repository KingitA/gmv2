import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from "@/lib/auth"

/**
 * GET /api/finanzas/panel — datos chicos que suma el Panel de Finanzas (solo lectura):
 *  - ultimos_ajustes: último cambio manual de saldo de cada cuenta (quién, cuándo, motivo),
 *    sacado del kardex (AJUSTE_CAJA guarda el usuario en verificado_por y el motivo en concepto).
 *  - en_calle: plata cobrada que tienen choferes/vendedores y todavía no rindieron (v_dias_calle).
 *  - cobros_por_verificar: cobros registrados que Finanzas todavía no confirmó en Caja.
 */
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const sb = createAdminClient()
    const [ajustes, calle, pendientes] = await Promise.all([
      sb.from("kardex_contable")
        .select("created_at, concepto, origen_tipo, origen_id, destino_tipo, destino_id, verificado_por")
        .eq("tipo_movimiento", "AJUSTE_CAJA")
        .order("created_at", { ascending: false })
        .limit(300),
      sb.from("v_dias_calle").select("*"),
      sb.from("pagos_clientes").select("id, monto").in("estado", ["pendiente", "pendiente_rendicion"]),
    ])

    const usuarioIds = [...new Set((ajustes.data || []).map((a: any) => a.verificado_por).filter(Boolean))] as string[]
    const { data: usuarios } = usuarioIds.length
      ? await sb.from("usuarios").select("id, nombre").in("id", usuarioIds)
      : { data: [] as any[] }
    const nombre = new Map((usuarios || []).map((u: any) => [u.id, u.nombre]))

    // Último ajuste por cuenta (clave "TIPO:id")
    const ultimos: Record<string, { fecha: string; usuario: string | null; motivo: string | null }> = {}
    for (const a of (ajustes.data || []) as any[]) {
      const tipo = a.destino_tipo || a.origen_tipo
      const id = a.destino_id || a.origen_id
      if (!tipo || !id) continue
      const k = `${tipo}:${id}`
      if (ultimos[k]) continue
      ultimos[k] = {
        fecha: a.created_at,
        usuario: a.verificado_por ? nombre.get(a.verificado_por) ?? null : null,
        motivo: a.concepto && a.concepto !== "Ajuste manual de saldo" ? a.concepto : null,
      }
    }

    const enCalle = ((calle.data || []) as any[]).reduce((t, d) => t + (Number(d.en_calle) || 0), 0)
    const porVerificar = (pendientes.data || []) as any[]

    return NextResponse.json({
      ultimos_ajustes: ultimos,
      en_calle: enCalle,
      en_calle_detalle: ((calle.data || []) as any[])
        .filter((d) => Number(d.en_calle) > 0)
        .map((d) => ({ nombre: d.cobrador_nombre ?? "—", monto: Number(d.en_calle), dias: d.dias_calle ?? null })),
      cobros_por_verificar: { cantidad: porVerificar.length, monto: porVerificar.reduce((t, p) => t + (Number(p.monto) || 0), 0) },
    })
  } catch (e: any) {
    console.error("[finanzas/panel]", e?.message)
    return NextResponse.json({ error: e?.message || "Error" }, { status: 500 })
  }
}
