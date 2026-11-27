import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { nombresCobradores } from "@/lib/finanzas/nombres-cobradores"
import { bancoDeCuenta } from "@/lib/bancos/lectura"
import { estadoConexion } from "@/lib/bancos/credicoop/config"

/**
 * GET /api/finanzas/cajas — todas las cuentas de fondos con sus saldos
 * materializados (saldos_financieros, derivados del kardex — Fase B).
 *
 * Grupos: EFECTIVO (cajas_financieras), BANCOS (cuentas_bancarias),
 * BOLSA (cuentas_inversion), BILLETERAS (choferes/viajantes con saldo).
 *
 * Bancos (Tanda 1 de bancos): además, el último saldo que informó el BANCO (banco_saldo_actual,
 * migración 20261127a) y si la cuenta se lee sola (MercadoPago / Credicoop). Solo para mostrar:
 * el saldo del sistema sigue saliendo del kardex.
 */
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()

    const [cajasRes, bancosRes, inversionRes, saldosRes, bancoSaldosRes] = await Promise.all([
      supabase.from("cajas_financieras").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("cuentas_bancarias").select("id, nombre, banco, api_banco").eq("activo", true).order("nombre"),
      supabase.from("cuentas_inversion").select("id, nombre, tipo_instrumento").eq("activo", true).order("nombre"),
      supabase.from("saldos_financieros").select("cuenta_tipo, cuenta_id, color, saldo, updated_at"),
      // Sin la migración 20261127a la vista no existe: se sigue sin el saldo del banco
      supabase.from("banco_saldo_actual").select("cuenta_bancaria_id, saldo, al, fuente"),
    ])
    const bancoSaldo = new Map<string, { saldo: number; al: string; fuente: string }>()
    for (const b of (bancoSaldosRes.error ? [] : bancoSaldosRes.data) || []) {
      bancoSaldo.set((b as any).cuenta_bancaria_id, { saldo: Number((b as any).saldo), al: (b as any).al, fuente: (b as any).fuente })
    }
    const credicoop = estadoConexion()
    const lecturaDe = (b: { banco?: string | null; nombre?: string | null; api_banco?: string | null }) => {
      const banco = bancoDeCuenta(b)
      if (banco === "mp") return { banco, auto: "mp", conectado: !!process.env.MP_ACCESS_TOKEN, aviso: process.env.MP_ACCESS_TOKEN ? null : "MercadoPago no conectado" }
      if (b.api_banco === "credicoop") {
        const prod = credicoop.conectado && credicoop.ambiente === "produccion"
        return { banco, auto: "credicoop", conectado: prod, aviso: prod ? null : credicoop.conectado ? "Credicoop en prueba: no se lee solo" : "Credicoop no conectado" }
      }
      return { banco, auto: null, conectado: false, aviso: null }
    }

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
        // Conectada por API (Credicoop): el e-cheq lo emite el banco y él pone el número
        api_banco: (b as any).api_banco ?? null,
        banco_saldo: bancoSaldo.get(b.id) ?? null,
        lectura: lecturaDe(b as any),
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
      // Vendedores y choferes (usuarios): #40
      const nombres = await nombresCobradores(supabase, billeteraIds)
      for (const id of billeteraIds) {
        cuentas.push({
          cuenta_tipo: "BILLETERA",
          cuenta_id: id,
          nombre: `Billetera ${nombres.get(id) ?? id.slice(0, 8)}`,
          grupo: "BILLETERAS",
          saldos: saldoDe("BILLETERA", id),
          updated_at: updatedDe("BILLETERA", id),
        })
      }
    }

    return NextResponse.json({ cuentas })
  } catch (error: any) {
    console.error("[finanzas/cajas] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
