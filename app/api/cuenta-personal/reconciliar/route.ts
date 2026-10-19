import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { liquidarComisiones } from "@/lib/comisiones/liquidar"

// POST /api/cuenta-personal/reconciliar — solo admin.
// Pone al día las cuentas personales después de vincular un empleado (o tras la
// puesta a cero): es idempotente, se puede correr las veces que haga falta.
//  1. Comisiones: reconcilia todos los comprobantes con comisión (postea solo la
//     diferencia contra lo ya cargado; lib/comisiones/liquidar.ts).
//  2. Diferencias de rendición / gastos rechazados que se anotaron en la
//     billetera cuando el empleado todavía no tenía la cuenta vinculada.
export async function POST() {
  const auth = await requirePermiso("caja")
  if (auth.error) return auth.error
  try {
    const supabase = createAdminClient()

    // 1. Comisiones
    // Solo lo que puede tener comisión: comprobantes saldados + los que ya tienen
    // comisión cargada (por si dejaron de estar saldados). No recorre todo el kardex.
    const [saldados, conComision] = await Promise.all([
      fetchAllRows<{ id: string }>(() =>
        supabase
          .from("comprobantes_venta")
          .select("id")
          .in("tipo_comprobante", ["FA", "FB", "FC", "PRES"])
          .is("anulado_en", null)
          .lte("saldo_pendiente", 0.005),
      ),
      fetchAllRows<{ referencia_id: string }>(() =>
        supabase.from("cuenta_corriente_clientes").select("referencia_id").eq("referencia_tipo", "comision"),
      ),
    ])
    const comps = [...new Set([...saldados.map((c) => c.id), ...conComision.map((c) => c.referencia_id)])]
    let comisionesPosteadas = 0
    const sinCuenta = new Set<string>()
    const avisos: string[] = []
    for (let i = 0; i < comps.length; i += 100) {
      const r = await liquidarComisiones(supabase, comps.slice(i, i + 100), auth.user.id)
      comisionesPosteadas += r.posteados
      for (const s of r.sin_cuenta) sinCuenta.add(s.vendedor_id)
      avisos.push(...r.avisos)
    }

    // 2. Billetera → cuenta personal (lo que el trigger no pudo copiar)
    const pendientes = await fetchAllRows<any>(() =>
      supabase
        .from("billetera_movimientos")
        .select("id, viajante_id, monto, concepto, referencia_tipo, fecha, creado_por")
        .in("referencia_tipo", ["rendicion_saldo_declarado", "rendicion_diferencia", "rendicion_devuelta", "viaje_gasto_rechazado"])
        .eq("cuenta_posteada", false)
        .neq("monto", 0),
    )
    let diferenciasPosteadas = 0
    for (const m of pendientes) {
      const { data: cuenta } = await supabase.rpc("cuenta_empleado_de", { p_id: m.viajante_id })
      if (!cuenta) continue
      const { data: ya } = await supabase
        .from("cuenta_corriente_clientes")
        .select("id")
        .eq("referencia_tipo", "billetera")
        .eq("referencia_id", m.id)
        .limit(1)
      if (!ya?.length) {
        const monto = Number(m.monto)
        const { error } = await supabase.rpc("cc_postear", {
          p_cliente_id: cuenta,
          p_tipo_movimiento: m.referencia_tipo === "viaje_gasto_rechazado" ? "gasto_rechazado" : "diferencia_rendicion",
          p_debe: monto > 0 ? monto : 0,
          p_haber: monto < 0 ? -monto : 0,
          p_referencia_tipo: "billetera",
          p_referencia_id: m.id,
          p_numero_comprobante: null,
          p_observaciones: m.concepto || m.referencia_tipo,
          p_usuario_id: m.creado_por || auth.user.id,
          p_fecha: m.fecha || new Date().toISOString(),
        })
        if (error) {
          avisos.push(`Diferencia ${m.id}: ${error.message}`)
          continue
        }
        diferenciasPosteadas++
      }
      await supabase.from("billetera_movimientos").update({ cuenta_posteada: true }).eq("id", m.id)
    }

    return NextResponse.json({
      success: true,
      comprobantes_revisados: comps.length,
      comisiones_posteadas: comisionesPosteadas,
      diferencias_posteadas: diferenciasPosteadas,
      vendedores_sin_cuenta: [...sinCuenta],
      avisos,
    })
  } catch (error: any) {
    console.error("[cuenta-personal/reconciliar] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
