import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * GET /api/finanzas/cajas — todas las cuentas de fondos con sus saldos
 * materializados (saldos_financieros, derivados del kardex — Fase B).
 *
 * Grupos: EFECTIVO (cajas_financieras), BANCOS (cuentas_bancarias),
 * BOLSA (cuentas_inversion), BILLETERAS (choferes/viajantes con saldo).
 */
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()

    const [cajasRes, bancosRes, inversionRes, saldosRes] = await Promise.all([
      supabase.from("cajas_financieras").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("cuentas_bancarias").select("id, nombre, banco").eq("activo", true).order("nombre"),
      supabase.from("cuentas_inversion").select("id, nombre, tipo_instrumento").eq("activo", true).order("nombre"),
      supabase.from("saldos_financieros").select("cuenta_tipo, cuenta_id, color, saldo, updated_at"),
    ])

    const saldos = saldosRes.data || []
    const saldoDe = (tipo: string, id: string) => {
      const blanco = saldos.find((s) => s.cuenta_tipo === tipo && s.cuenta_id === id && s.color === "BLANCO")
      const negro = saldos.find((s) => s.cuenta_tipo === tipo && s.cuenta_id === id && s.color === "NEGRO")
      return { BLANCO: Number(blanco?.saldo ?? 0), NEGRO: Number(negro?.saldo ?? 0) }
    }
    const updatedDe = (tipo: string, id: string) => {
      const fechas = saldos
        .filter((s) => s.cuenta_tipo === tipo && s.cuenta_id === id && (s as any).updated_at)
        .map((s) => (s as any).updated_at as string)
        .sort()
      return fechas[fechas.length - 1] ?? null
    }

    const cuentas = [
      ...(cajasRes.data || []).map((c) => ({
        cuenta_tipo: "CAJA",
        cuenta_id: c.id,
        nombre: c.nombre,
        grupo: "EFECTIVO",
        saldos: saldoDe("CAJA", c.id),
        updated_at: updatedDe("CAJA", c.id),
      })),
      ...(bancosRes.data || []).map((b) => ({
        cuenta_tipo: "BANCO",
        cuenta_id: b.id,
        nombre: b.nombre,
        grupo: "BANCOS",
        saldos: saldoDe("BANCO", b.id),
        updated_at: updatedDe("BANCO", b.id),
      })),
      ...((inversionRes.data as any[]) || []).map((i) => ({
        cuenta_tipo: "INVERSION",
        cuenta_id: i.id,
        nombre: i.nombre,
        grupo: "BOLSA",
        saldos: saldoDe("INVERSION", i.id),
        updated_at: updatedDe("INVERSION", i.id),
      })),
    ]

    // Billeteras: solo las que tienen saldo registrado
    const billeteraIds = [
      ...new Set(saldos.filter((s) => s.cuenta_tipo === "BILLETERA").map((s) => s.cuenta_id)),
    ]
    if (billeteraIds.length) {
      const { data: vendedores } = await supabase
        .from("vendedores")
        .select("id, nombre")
        .in("id", billeteraIds)
      for (const id of billeteraIds) {
        cuentas.push({
          cuenta_tipo: "BILLETERA",
          cuenta_id: id,
          nombre: `Billetera ${vendedores?.find((v) => v.id === id)?.nombre ?? id.slice(0, 8)}`,
          grupo: "BILLETERAS",
          saldos: saldoDe("BILLETERA", id),
        })
      }
    }

    return NextResponse.json({ cuentas })
  } catch (error: any) {
    console.error("[finanzas/cajas] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
