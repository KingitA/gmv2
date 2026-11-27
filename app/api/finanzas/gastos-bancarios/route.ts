import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { CONCEPTOS_BANCO } from "@/lib/bancos/clasificacion"
import { clasificarPendientes } from "@/lib/bancos/clasificacion-servidor"
import { cuentasBanco, FaltaMigracionBancos, gastosBancarios, movimientosBancarios } from "@/lib/bancos/consultas"
import { hoyISO, sumarDiasISO } from "@/lib/formato"

export const maxDuration = 60

const fechaOk = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Último día del mes "AAAA-MM" */
function finDeMes(mes: string) {
  const [a, m] = mes.split("-").map(Number)
  const siguiente = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`
  return sumarDiasISO(siguiente, -1)
}

/**
 * GET /api/finanzas/gastos-bancarios — impuestos y gastos del banco (Tanda 2 del plan de bancos).
 *  ?desde&hasta[&cuenta_id]            → totales por mes × banco × concepto (bancos_gastos)
 *  ?detalle=1&mes=AAAA-MM|desde&hasta&cuenta_id&concepto_id → los renglones del banco de esa celda
 * Antes de consultar clasifica lo que falte (movimientos viejos o de otra fuente). Solo lectura.
 */
export async function GET(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const db = await createClient()
    const u = new URL(request.url)
    const hoy = hoyISO()
    const mes = u.searchParams.get("mes")
    let desde = u.searchParams.get("desde")
    let hasta = u.searchParams.get("hasta")
    if (mes && /^\d{4}-\d{2}$/.test(mes)) { desde = `${mes}-01`; hasta = finDeMes(mes) }
    if (!fechaOk(hasta)) hasta = hoy
    if (!fechaOk(desde)) desde = `${sumarDiasISO(hoy, -92).slice(0, 7)}-01`
    const cuentaId = u.searchParams.get("cuenta_id") || null
    const conceptoId = u.searchParams.get("concepto_id") || null

    if (u.searchParams.get("detalle") === "1") {
      const r = await movimientosBancarios(db, {
        desde, hasta, cuentaIds: cuentaId ? [cuentaId] : null, conceptoIds: conceptoId ? [conceptoId] : null, limite: 500,
      })
      return NextResponse.json({ desde, hasta, ...r })
    }

    const [cuentas, gastos] = await Promise.all([
      cuentasBanco(db),
      gastosBancarios(db, { desde, hasta, cuentaIds: cuentaId ? [cuentaId] : null }),
    ])
    return NextResponse.json({ desde, hasta, cuentas, conceptos: CONCEPTOS_BANCO, filas: gastos.filas, aviso: gastos.aviso ?? null })
  } catch (error: any) {
    if (error instanceof FaltaMigracionBancos) return NextResponse.json({ error: error.message, falta_migracion: true }, { status: 409 })
    console.error("[finanzas/gastos-bancarios] error:", error)
    return NextResponse.json({ error: error.message ?? "No se pudo consultar" }, { status: 500 })
  }
}

/** POST { accion: "clasificar" } — vuelve a clasificar lo que falte (no toca saldos ni kardex). */
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({}))
  if (body?.accion !== "clasificar") return NextResponse.json({ error: "Acción inválida" }, { status: 400 })
  const r = await clasificarPendientes(await createClient())
  return NextResponse.json(r, { status: r.ok ? 200 : 409 })
}
