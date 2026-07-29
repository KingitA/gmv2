import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { fetchAllRows } from "@/lib/supabase/fetch-all"

/**
 * GET /api/finanzas/evolucion — serie diaria de saldos por cuenta, derivada
 * del kardex (dato vivo): para cada día toma el último saldo_after conocido
 * de cada cuenta y arrastra hacia adelante. Reemplaza a los gráficos que
 * leían snapshots manuales desactualizados de finanzas_saldos.
 */
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()

    const [kardexRows, cajasRes, bancosRes, invRes] = await Promise.all([
      fetchAllRows(() =>
        supabase
          .from("kardex_contable")
          .select("fecha, origen_tipo, origen_id, destino_tipo, destino_id, saldo_origen_after, saldo_destino_after")
          .or("saldo_origen_after.not.is.null,saldo_destino_after.not.is.null")
          .order("fecha", { ascending: true })
      ),
      supabase.from("cajas_financieras").select("id, nombre").eq("activo", true),
      supabase.from("cuentas_bancarias").select("id, nombre").eq("activo", true),
      supabase.from("cuentas_inversion").select("id, nombre").eq("activo", true),
    ])

    const nombres = new Map<string, string>()
    for (const c of cajasRes.data || []) nombres.set(c.id, c.nombre)
    for (const b of bancosRes.data || []) nombres.set(b.id, b.nombre)
    for (const i of invRes.data || []) nombres.set(i.id, i.nombre)

    // último saldo conocido por cuenta y día (hora Argentina)
    const porDia = new Map<string, Map<string, number>>()
    const registrar = (fechaIso: string, cuentaId: string | null, saldo: any) => {
      if (!cuentaId || saldo === null || saldo === undefined) return
      const nombre = nombres.get(cuentaId)
      if (!nombre) return
      const dia = new Date(fechaIso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
      if (!porDia.has(dia)) porDia.set(dia, new Map())
      porDia.get(dia)!.set(nombre, Number(saldo))
    }
    for (const k of kardexRows) {
      registrar(k.fecha, k.origen_id, k.saldo_origen_after)
      registrar(k.fecha, k.destino_id, k.saldo_destino_after)
    }

    const dias = [...porDia.keys()].sort()
    const cuentasVistas = new Set<string>()
    for (const m of porDia.values()) for (const n of m.keys()) cuentasVistas.add(n)

    const running: Record<string, number> = {}
    const serie = dias.map((dia) => {
      const row: Record<string, any> = { fecha: dia }
      for (const [nombre, saldo] of porDia.get(dia)!) running[nombre] = saldo
      for (const n of cuentasVistas) row[n] = running[n] ?? null
      return row
    })

    return NextResponse.json({ serie, cuentas: [...cuentasVistas] })
  } catch (error: any) {
    console.error("[finanzas/evolucion] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
