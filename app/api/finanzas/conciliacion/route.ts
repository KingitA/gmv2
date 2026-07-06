import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * GET /api/finanzas/conciliacion — transferencias/depósitos confirmados pero
 * SIN verificar contra el banco, agrupados por cuenta destino, con contexto
 * (cliente, viaje, fotos de comprobantes).
 *
 * POST — verifica un pago contra el extracto: { pago_id } →
 * pago_verificar(..., 'conciliacion'). Cuando lleguen las APIs bancarias,
 * el matcher automático usará el mismo RPC con verificacion_fuente='api_*'.
 */
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()

    const { data: pagos, error } = await supabase
      .from("pagos_clientes")
      .select(`
        id, monto, fecha_pago, cobrador_tipo, viaje_id, cliente_id, creado_por,
        clientes(nombre),
        viajes(nombre),
        pagos_detalle(tipo_pago, monto, cuenta_bancaria_id, referencia, fecha_transferencia)
      `)
      .eq("estado", "confirmado")
      .is("verificado_por", null)
      .order("fecha_pago", { ascending: true })
    if (error) throw error

    // Solo pagos con algún método transferencia/depósito
    const candidatos = (pagos || []).filter((p) =>
      ((p as any).pagos_detalle || []).some((d: any) => ["transferencia", "deposito"].includes(d.tipo_pago))
    )

    // Fotos de comprobantes
    const pagoIds = candidatos.map((p) => p.id)
    const fotos = new Map<string, string[]>()
    if (pagoIds.length) {
      const { data: comps } = await supabase
        .from("pago_comprobantes")
        .select("pago_id, url")
        .in("pago_id", pagoIds)
      for (const c of comps || []) {
        fotos.set(c.pago_id, [...(fotos.get(c.pago_id) ?? []), c.url])
      }
    }

    const { data: cuentas } = await supabase
      .from("cuentas_bancarias")
      .select("id, nombre")
      .eq("activo", true)
    const nombreCuenta = new Map((cuentas || []).map((c) => [c.id, c.nombre]))

    const items = candidatos.map((p) => {
      const dets = ((p as any).pagos_detalle || []).filter((d: any) =>
        ["transferencia", "deposito"].includes(d.tipo_pago)
      )
      return {
        pago_id: p.id,
        cliente: (p as any).clientes?.nombre ?? p.cliente_id,
        monto_pago: Number(p.monto),
        monto_transferencias: dets.reduce((s: number, d: any) => s + Number(d.monto), 0),
        fecha: p.fecha_pago,
        cobrador_tipo: p.cobrador_tipo,
        viaje: (p as any).viajes?.nombre ?? null,
        cuenta_destino:
          dets.map((d: any) => nombreCuenta.get(d.cuenta_bancaria_id)).find(Boolean) ?? "Sin cuenta",
        referencias: dets.map((d: any) => d.referencia).filter(Boolean),
        fotos: fotos.get(p.id) ?? [],
      }
    })

    return NextResponse.json({
      items,
      total: items.reduce((s, i) => s + i.monto_transferencias, 0),
    })
  } catch (error: any) {
    console.error("[conciliacion] GET error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { pago_id } = await request.json()
    if (!pago_id) return NextResponse.json({ error: "pago_id es requerido" }, { status: 400 })

    const { data, error } = await supabase.rpc("pago_verificar", {
      p_pago_id: pago_id,
      p_usuario_id: auth.user.id,
      p_metodo: "conciliacion",
      p_fuente: "manual",
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true, ya_verificado: data?.ya_verificado ?? false })
  } catch (error: any) {
    console.error("[conciliacion] POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
