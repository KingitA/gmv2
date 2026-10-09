import { deudaCuentaCorriente, TIPOS_CC_BILLETERA } from "../cobranzas/billetera-cc"

/**
 * Saldo de la billetera del vendedor: UN solo cálculo para el inicio de la app
 * (/api/vendedor/me) y la pantalla Billetera (/api/vendedor/billetera).
 *
 * Caso FREIJE (05/10 y otra vez 09/10/2026): el 05/10 se corrigió la cuenta de
 * /api/vendedor/billetera (compensaciones 'rendicion_devuelta' y 'manual') pero
 * /api/vendedor/me tenía SU PROPIA copia del cálculo y siguió mostrando
 * −$674.500 en el inicio mientras la billetera decía $0. Ninguno de los dos
 * endpoints calcula más el saldo por su cuenta: los dos llaman acá.
 *
 * - Plata en la calle: cobros pendiente_rendicion que NO están declarados en una
 *   rendición abierta (esos están "en viaje a oficina").
 * - Saldo = SOLO el efectivo en la calle + la cuenta corriente de rendiciones y
 *   ajustes (lib/cobranzas/billetera-cc). Los cheques van aparte como cantidad
 *   de papeles; el echeq y las transferencias van directo al banco.
 */
export interface ResumenBilletera {
  /** Lo que muestra la app como "Saldo en billetera" (inicio y Billetera) */
  saldo: number
  /** Efectivo en la calle (sin la cuenta corriente) */
  balance: number
  desglose: { efectivo: number; cheques: number; transferencias: number }
  cheques_cantidad: number
  pagos_sin_rendir: number
  en_viaje: { total: number; cantidad: number }
  /** Cuenta corriente de rendiciones/ajustes (positivo = debe, negativo = a favor) */
  deuda_rendiciones: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function resumenBilletera(supabase: any, vendedorIds: string[]): Promise<ResumenBilletera> {
  const [{ data: pagosSinRendir, error: e1 }, { data: abiertas, error: e2 }, { data: difs, error: e3 }] = await Promise.all([
    supabase
      .from("pagos_clientes")
      .select("id, monto, forma_pago, pagos_detalle(tipo_pago, monto, color_cheque)")
      .in("vendedor_id", vendedorIds)
      .eq("estado", "pendiente_rendicion"),
    supabase.from("rendiciones").select("id").in("cobrador_id", vendedorIds).eq("estado", "abierta"),
    supabase
      .from("billetera_movimientos")
      .select("monto, referencia_tipo")
      .in("viajante_id", vendedorIds)
      .in("referencia_tipo", [...TIPOS_CC_BILLETERA]),
  ])
  // Sin datos no hay saldo: mejor un error (la app conserva el último bueno) que un número inventado
  for (const e of [e1, e2, e3]) if (e) throw e

  const declarados = new Set<string>()
  if (abiertas?.length) {
    const { data: items, error } = await supabase
      .from("rendicion_items")
      .select("pago_id")
      .in("rendicion_id", abiertas.map((r: any) => r.id))
    if (error) throw error
    for (const it of items || []) declarados.add(it.pago_id)
  }

  const enCalle = (pagosSinRendir ?? []).filter((p: any) => !declarados.has(p.id))
  const enViaje = (pagosSinRendir ?? []).filter((p: any) => declarados.has(p.id))

  let efectivo = 0
  let cheques = 0
  let chequesCantidad = 0
  let transferencias = 0
  for (const p of enCalle) {
    const detalles: any[] = p.pagos_detalle || []
    if (detalles.length) {
      for (const d of detalles) {
        const tipo = (d.tipo_pago || "").toLowerCase()
        // Echeq = canal DIGITAL (como la transferencia): no es un papel en mano.
        if (tipo === "cheque" && d.color_cheque === "ECHEQ") { transferencias += Number(d.monto); continue }
        if (tipo === "efectivo") efectivo += Number(d.monto)
        else if (tipo === "cheque") { cheques += Number(d.monto); chequesCantidad += 1 }
        else transferencias += Number(d.monto)
      }
    } else {
      // pagos viejos sin detalle: clasificar por forma_pago
      const forma = (p.forma_pago || "").toLowerCase()
      if (forma === "cheque") { cheques += Number(p.monto); chequesCantidad += 1 }
      else if (forma === "transferencia") transferencias += Number(p.monto)
      else efectivo += Number(p.monto)
    }
  }

  const balance = r2(efectivo)
  const deuda = deudaCuentaCorriente(difs ?? [])
  return {
    saldo: r2(balance + deuda),
    balance,
    desglose: { efectivo, cheques, transferencias },
    cheques_cantidad: chequesCantidad,
    pagos_sin_rendir: enCalle.length,
    en_viaje: { total: enViaje.reduce((s: number, p: any) => s + Number(p.monto), 0), cantidad: enViaje.length },
    deuda_rendiciones: deuda,
  }
}
