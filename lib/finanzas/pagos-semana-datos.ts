import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllRows, fetchByIds } from "@/lib/supabase/fetch-all"
import { hoyISO, parseFecha, sumarDiasISO } from "@/lib/formato"
import { chequesReservados } from "@/lib/cheques/reserva"
import { armarPagosSemana, proyectarCaja, type CuentaFondo, type VencimientoSemana } from "@/lib/finanzas/pagos-semana"

/**
 * Lee de la base todo lo que necesita "Pagos de la semana" (E-71) y la proyección de caja
 * (E-69) y arma la vista. Solo lectura. La usan la pantalla (GET /api/finanzas/pagos-semana) y
 * Jarvis (herramienta plan_de_pagos): una sola cuenta, el mismo resultado en los dos lados.
 *
 *  - desde: cualquier día de la semana a mirar (se toma de lunes a domingo). Sin fecha, la
 *    semana de hoy. En la semana de hoy entra también todo lo atrasado.
 *  - dias: cuántos días proyectar la caja desde hoy (30 por defecto, de 7 a 90).
 *
 * `db` tiene que ser el cliente de servicio: quién puede verlo lo decide quien llama.
 */

/** Lunes de la semana de un día (aaaa-mm-dd). Cuenta de calendario pura, sin zona horaria. */
function lunesDe(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number)
  const diaSemana = new Date(Date.UTC(a, m - 1, d)).getUTCDay() // 0 = domingo
  return sumarDiasISO(iso, diaSemana === 0 ? -6 : 1 - diaSemana)
}

export async function cargarPagosSemana(db: SupabaseClient, opciones: { desde?: string | null; dias?: number | null } = {}) {
  const hoy = hoyISO()
  const pedido = parseFecha(opciones.desde ?? null)
  const desde = lunesDe(pedido ?? hoy)
  const hasta = sumarDiasISO(desde, 6)
  const esSemanaActual = desde <= hoy && hoy <= hasta
  const dias = Math.min(90, Math.max(7, Math.trunc(Number(opciones.dias) || 30)))
  const finProyeccion = sumarDiasISO(hoy, dias - 1)
  const tope = hasta > finProyeccion ? hasta : finProyeccion

  const [vencs, retRes, cajasRes, bancosRes, saldosRes, cartera, depositados, propios] = await Promise.all([
    fetchAllRows<VencimientoSemana>(() => db.from("vencimientos")
      .select("*, proveedores(id, nombre, sigla)")
      .eq("estado", "pendiente").lte("fecha_vencimiento", tope)
      .order("fecha_vencimiento", { ascending: true })),
    db.rpc("ganancias_proyeccion_vencimientos"),
    db.from("cajas_financieras").select("id, nombre").eq("activo", true).order("nombre"),
    db.from("cuentas_bancarias").select("id, nombre").eq("activo", true).order("nombre"),
    db.from("saldos_financieros").select("cuenta_tipo, cuenta_id, saldo").in("cuenta_tipo", ["CAJA", "BANCO"]),
    fetchAllRows<any>(() => db.from("cheques").select("id, banco, numero, fecha_vencimiento, monto, color, es_echeq")
      .eq("estado", "EN_CARTERA").eq("tipo", "TERCERO")),
    fetchAllRows<any>(() => db.from("cheques").select("id, fecha_vencimiento, monto")
      .eq("estado", "DEPOSITADO").eq("tipo", "TERCERO")),
    fetchAllRows<any>(() => db.from("cheques").select("id, fecha_vencimiento, monto")
      .eq("estado", "ENTREGADO_A_PROVEEDOR").eq("tipo", "PROPIO")),
  ])
  if (cajasRes.error) throw cajasRes.error
  if (bancosRes.error) throw bancosRes.error
  if (saldosRes.error) throw saldosRes.error

  // Retención de Ganancias estimada por vencimiento (regla vigente). Si la cuenta falla, se
  // muestra sin retención y se avisa: nunca se inventa un neto.
  const retenciones: Record<string, number> = {}
  let avisoRetencion: string | null = null
  if (retRes.error) {
    console.error("[pagos-semana] proyección de retenciones:", retRes.error.message)
    // Pantalla solo de admin: el detalle ayuda a encontrar qué dato lo corta
    avisoRetencion = `No se pudo calcular la retención de Ganancias estimada: los importes se muestran SIN restar la retención. (Detalle para sistemas: ${String(retRes.error.message).slice(0, 200)})`
  } else {
    for (const r of (retRes.data as any[]) ?? []) {
      const ret = Number(r.retencion_proyectada)
      if (r.vencimiento_id && ret > 0) retenciones[r.vencimiento_id] = ret
    }
  }

  // Proveedores de esos vencimientos (con su acuerdo de pago). select * a propósito: las
  // columnas "acepta cheques de terceros / e-cheq" pueden no estar todavía en la base.
  const provIds = [...new Set(vencs.map((v) => v.proveedor_id).filter((x): x is string => !!x))]
  const proveedores = await fetchByIds<any>((chunk) => db.from("proveedores").select("*").in("id", chunk), provIds)

  const saldoDe = (tipo: string, id: string) => (saldosRes.data ?? [])
    .filter((s: any) => s.cuenta_tipo === tipo && s.cuenta_id === id)
    .reduce((s: number, x: any) => s + Number(x.saldo ?? 0), 0)
  const cuentas: CuentaFondo[] = [
    ...(bancosRes.data ?? []).map((b: any) => ({ cuenta_tipo: "BANCO" as const, cuenta_id: b.id, nombre: b.nombre, saldo: saldoDe("BANCO", b.id) })),
    ...(cajasRes.data ?? []).map((c: any) => ({ cuenta_tipo: "CAJA" as const, cuenta_id: c.id, nombre: c.nombre, saldo: saldoDe("CAJA", c.id) })),
  ]

  const reservadosMapa = await chequesReservados(cartera.map((c) => c.id))
  const reservados: Record<string, string> = Object.fromEntries(reservadosMapa)

  const deLaSemana = vencs.filter((v) =>
    v.fecha_vencimiento <= hasta && (v.fecha_vencimiento >= desde || (esSemanaActual && v.fecha_vencimiento < hoy)))

  const semana = armarPagosSemana({
    hoy, desde, hasta, vencimientos: deLaSemana,
    proveedores: proveedores.map((p) => ({
      id: p.id, nombre: p.nombre,
      pago_blanco_medio: p.pago_blanco_medio ?? null, pago_blanco_plazo_cheque: p.pago_blanco_plazo_cheque ?? null,
      pago_negro_medio: p.pago_negro_medio ?? null, pago_negro_plazo_cheque: p.pago_negro_plazo_cheque ?? null,
      acepta_cheques_terceros: p.acepta_cheques_terceros ?? null, acepta_echeq: p.acepta_echeq ?? null,
    })),
    retenciones, cartera, reservados, cuentas,
  })

  const proyeccion = proyectarCaja({
    hoy, dias,
    saldo_inicial: cuentas.reduce((s, c) => s + c.saldo, 0),
    vencimientos: vencs.filter((v) => v.fecha_vencimiento <= finProyeccion),
    retenciones,
    cheques_a_cobrar: [...cartera.filter((c) => !reservados[c.id]), ...depositados],
    cheques_a_debitar: propios,
  })

  return { ...semana, es_semana_actual: esSemanaActual, aviso_retencion: avisoRetencion, proyeccion }
}

export type PagosSemana = Awaited<ReturnType<typeof cargarPagosSemana>>
