import type { SupabaseClient } from "@supabase/supabase-js"
import { nowArgentina } from "@/lib/utils"
import { postearLibroConAviso } from "@/lib/cuenta-corriente/postear-libro"
import { moneda } from "@/lib/formato"

/**
 * COMISIÓN GANADA → cuenta personal del vendedor (reglas del dueño 16-19/10/2026).
 *
 *  - Se gana cuando el comprobante del cliente queda SALDADO del todo.
 *  - Se calcula sobre la PLATA que el cliente realmente pagó a ese comprobante
 *    (imputaciones de pagos). Las NC/REV (10% contado, devoluciones) no son
 *    plata: si el cliente pagó $90.000 de una factura de $100.000 porque tuvo
 *    el 10% de contado, la comisión es sobre $90.000. Lo mismo una devolución.
 *  - El % es el de la venta (kardex.comision_viajante_monto, grabado al armar
 *    el pedido): un cambio posterior en la ficha del vendedor no toca lo vendido.
 *  - Va al vendedor original del cliente (kardex.vendedor_id), aunque cobre otro.
 *  - Entra a favor en la cuenta personal (vendedores.cuenta_cliente_id → cuenta
 *    de cliente del empleado) como renglón 'comision', referido al comprobante.
 *
 * RECONCILIA, no suma: para cada comprobante calcula lo que corresponde HOY y
 * postea solo la diferencia contra lo ya posteado. Si un cobro se anula, el
 * comprobante deja de estar saldado → se revierte; si se vuelve a cobrar, se
 * gana de nuevo. Re-ejecutarlo no duplica nada. Reemplaza a las viejas filas
 * 'cobrada', al débito del 10% y a las comisiones negativas de las NC.
 */
const DEBITOS = new Set(["FA", "FB", "FC", "PRES"])
const r2 = (n: number) => Math.round(n * 100) / 100

export interface ResultadoLiquidacion {
  posteados: number
  /** Comprobantes con comisión cuyo vendedor no tiene cuenta personal vinculada */
  sin_cuenta: Array<{ comprobante_id: string; vendedor_id: string }>
  avisos: string[]
}

export async function liquidarComisiones(
  supabase: SupabaseClient,
  comprobanteIds: string[],
  usuarioId?: string | null,
): Promise<ResultadoLiquidacion> {
  const res: ResultadoLiquidacion = { posteados: 0, sin_cuenta: [], avisos: [] }
  const ids = [...new Set(comprobanteIds)].filter(Boolean)
  if (!ids.length) return res

  const [{ data: comps }, { data: lineas }, { data: imps }, { data: posteados }] = await Promise.all([
    supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, numero_comprobante, total_factura, saldo_pendiente, anulado_en, estado_pago, cliente_id, pedido_id")
      .in("id", ids),
    supabase
      .from("kardex")
      .select("comprobante_venta_id, vendedor_id, comision_viajante_monto, pedido_eliminado")
      .in("comprobante_venta_id", ids)
      .eq("tipo_movimiento", "venta"),
    supabase
      .from("imputaciones")
      .select("comprobante_id, monto_imputado")
      .in("comprobante_id", ids)
      .eq("estado", "confirmado")
      .not("pago_id", "is", null),
    supabase
      .from("cuenta_corriente_clientes")
      .select("cliente_id, referencia_id, debe, haber")
      .eq("referencia_tipo", "comision")
      .in("referencia_id", ids),
  ])

  // Comisión total vendida por comprobante y vendedor
  const comisionDe = new Map<string, Map<string, number>>()
  for (const l of lineas || []) {
    if (!l.vendedor_id || l.pedido_eliminado) continue
    const m = comisionDe.get(l.comprobante_venta_id) || new Map<string, number>()
    m.set(l.vendedor_id, (m.get(l.vendedor_id) || 0) + (Number(l.comision_viajante_monto) || 0))
    comisionDe.set(l.comprobante_venta_id, m)
  }
  const plataDe = new Map<string, number>()
  for (const i of imps || []) plataDe.set(i.comprobante_id, (plataDe.get(i.comprobante_id) || 0) + (Number(i.monto_imputado) || 0))

  // Refacturar (R3, Juan 27/10): lo que el cliente pagó del comprobante anulado
  // llega al nuevo del MISMO pedido como crédito de la NC/REV espejo de la
  // anulación (lib/pedidos/refacturar.ts). Es plata cobrada de verdad: cuenta
  // para la comisión igual que un cobro. Las NC/REV de devoluciones y del 10 %
  // contado no (esas sí la reducen).
  const pedidoDe = new Map((comps || []).filter((c: any) => c.pedido_id).map((c: any) => [c.id, c.pedido_id]))
  if (pedidoDe.size) {
    const { data: impsCredito } = await supabase
      .from("imputaciones")
      .select("comprobante_id, monto_imputado, credito:comprobantes_venta!imputaciones_credito_comprobante_id_fkey(pedido_id, motivo_ajuste)")
      .in("comprobante_id", [...pedidoDe.keys()])
      .eq("estado", "confirmado")
      .not("credito_comprobante_id", "is", null)
    for (const i of (impsCredito || []) as any[]) {
      const cr = Array.isArray(i.credito) ? i.credito[0] : i.credito
      if (cr?.motivo_ajuste !== "Anulación" || !cr.pedido_id || cr.pedido_id !== pedidoDe.get(i.comprobante_id)) continue
      plataDe.set(i.comprobante_id, (plataDe.get(i.comprobante_id) || 0) + (Number(i.monto_imputado) || 0))
    }
  }
  const posteadoDe = new Map<string, Map<string, number>>()
  for (const p of posteados || []) {
    const m = posteadoDe.get(p.referencia_id) || new Map<string, number>()
    m.set(p.cliente_id, (m.get(p.cliente_id) || 0) + (Number(p.haber) || 0) - (Number(p.debe) || 0))
    posteadoDe.set(p.referencia_id, m)
  }

  // Cuenta personal de cada vendedor
  const vendedorIds = [...new Set([...comisionDe.values()].flatMap((m) => [...m.keys()]))]
  const cuentaDe = new Map<string, string>()
  if (vendedorIds.length) {
    const { data: vends } = await supabase.from("vendedores").select("id, cuenta_cliente_id, usuario_id").in("id", vendedorIds)
    const usuarios = (vends || []).filter((v: any) => !v.cuenta_cliente_id && v.usuario_id).map((v: any) => v.usuario_id)
    const cuentaDeUsuario = new Map<string, string>()
    if (usuarios.length) {
      const { data: cs } = await supabase.from("clientes").select("id, empleado_usuario_id").in("empleado_usuario_id", usuarios)
      for (const c of cs || []) cuentaDeUsuario.set(c.empleado_usuario_id, c.id)
    }
    for (const v of vends || []) {
      const cuenta = v.cuenta_cliente_id || (v.usuario_id ? cuentaDeUsuario.get(v.usuario_id) : undefined)
      if (cuenta) cuentaDe.set(v.id, cuenta)
    }
  }

  const postear = async (cuenta: string, comp: any, monto: number, detalle: string) => {
    const aviso = await postearLibroConAviso(
      supabase,
      {
        p_cliente_id: cuenta,
        p_tipo_movimiento: "comision",
        p_debe: monto < 0 ? r2(-monto) : 0,
        p_haber: monto > 0 ? r2(monto) : 0,
        p_referencia_tipo: "comision",
        p_referencia_id: comp.id,
        p_numero_comprobante: comp.numero_comprobante,
        p_observaciones: `${monto > 0 ? "Comisión" : "Reversa de comisión"} ${comp.tipo_comprobante} ${comp.numero_comprobante} · ${detalle}`,
        p_usuario_id: usuarioId || null,
      },
      `comisión ${comp.tipo_comprobante} ${comp.numero_comprobante}`,
    )
    if (aviso) res.avisos.push(aviso)
    else res.posteados++
  }

  for (const comp of comps || []) {
    const porVendedor = comisionDe.get(comp.id) || new Map<string, number>()
    const yaPosteado = posteadoDe.get(comp.id) || new Map<string, number>()
    const total = Math.abs(Number(comp.total_factura) || 0)
    const saldado =
      DEBITOS.has(comp.tipo_comprobante) &&
      !comp.anulado_en &&
      comp.estado_pago !== "anulado" &&
      Number(comp.saldo_pendiente) <= 0.005
    const plata = r2(plataDe.get(comp.id) || 0)
    const proporcion = total > 0 ? Math.min(1, plata / total) : 0

    // Lo que corresponde HOY, por cuenta personal
    const objetivo = new Map<string, number>()
    for (const [vendedorId, comision] of porVendedor) {
      const monto = saldado ? r2(comision * proporcion) : 0
      if (Math.abs(monto) < 0.005) continue
      const cuenta = cuentaDe.get(vendedorId)
      if (!cuenta) {
        res.sin_cuenta.push({ comprobante_id: comp.id, vendedor_id: vendedorId })
        continue
      }
      objetivo.set(cuenta, r2((objetivo.get(cuenta) || 0) + monto))
    }

    const detalle = saldado
      ? `cobrado ${moneda(plata)} de ${moneda(total)}`
      : "el comprobante dejó de estar saldado"
    for (const cuenta of new Set([...objetivo.keys(), ...yaPosteado.keys()])) {
      const dif = r2((objetivo.get(cuenta) || 0) - (yaPosteado.get(cuenta) || 0))
      if (Math.abs(dif) >= 0.01) await postear(cuenta, comp, dif, detalle)
    }

    // Marca "cobrado" en el kardex (estimación "sin cobrar" de la app y Playroom)
    await supabase
      .from("kardex")
      .update(saldado
        ? { comprobante_cobrado: true, fecha_comprobante_cobrado: nowArgentina(), ...(usuarioId ? { cobrador_id: usuarioId } : {}) }
        : { comprobante_cobrado: false, fecha_comprobante_cobrado: null })
      .eq("comprobante_venta_id", comp.id)
      .eq("comprobante_cobrado", !saldado)
  }

  return res
}
