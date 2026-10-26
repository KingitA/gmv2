import type { SupabaseClient } from "@supabase/supabase-js"
import { disponibleDePago } from "@/lib/cuenta-corriente/pago-disponible"
import { reservasDeCreditos } from "@/lib/cobranzas/creditos"

/**
 * PLATA A FAVOR del cliente que se puede tildar en un cobro (#37): créditos
 * documento vivos (NC/REV con saldo) y entregas a cuenta con disponible sin
 * imputar. Lo ya tomado por cobros sin confirmar (reservasDeCreditos) no está
 * disponible. Lo usan la ficha del vendedor y /caja (registrar cobro).
 *
 * Las entregas a cuenta valen confirmadas, en viaje (pendiente_rendicion) o en
 * oficina (pendiente): el movimiento existe y tildarlo evita cobrar dos veces.
 * Con `incluirRechazadasDesde` se listan también las rechazadas desde esa
 * fecha, solo informativas (disponible = 0 para el cálculo del cobro).
 */
export async function creditosAFavor(
  supabase: SupabaseClient,
  clienteId: string,
  opts: { incluirRechazadasDesde?: string } = {},
) {
  const reservas = await reservasDeCreditos(supabase, clienteId)

  const { data: creditosDb } = await supabase
    .from("comprobantes_venta")
    .select("id, tipo_comprobante, numero_comprobante, fecha, saldo_pendiente")
    .eq("cliente_id", clienteId)
    .lt("saldo_pendiente", -0.005)
    .is("anulado_en", null)
    .neq("estado_pago", "anulado")
    .order("fecha", { ascending: true })
  const creditos = (creditosDb || [])
    .map((c: any) => ({
      ...c,
      saldo_pendiente: -Math.round(Math.max(0, -Number(c.saldo_pendiente) - (reservas.get(c.id) ?? 0)) * 100) / 100,
    }))
    .filter((c: any) => Number(c.saldo_pendiente) < -0.005)

  const estados = ["confirmado", "pendiente", "pendiente_rendicion"]
  if (opts.incluirRechazadasDesde) estados.push("rechazado")
  const { data: pagos } = await supabase
    .from("pagos_clientes")
    .select("id, monto, fecha_pago, estado, vendedor_id, creado_por")
    .eq("cliente_id", clienteId)
    .in("estado", estados)
  const ids = (pagos || []).map((p: any) => p.id)
  const impsPorPago = new Map<string, any[]>()
  if (ids.length) {
    const { data: imps } = await supabase
      .from("imputaciones")
      .select("pago_id, monto_imputado, estado, comprobante:comprobantes_venta!imputaciones_comprobante_id_fkey(tipo_comprobante)")
      .in("pago_id", ids)
    for (const i of imps || []) {
      if (!impsPorPago.has(i.pago_id)) impsPorPago.set(i.pago_id, [])
      impsPorPago.get(i.pago_id)!.push(i)
    }
  }
  const aCuenta = (pagos || [])
    .map((p: any) => ({
      pago_id: p.id as string,
      fecha: p.fecha_pago as string,
      estado: p.estado as string,
      monto: Number(p.monto) || 0,
      vendedor_id: p.vendedor_id as string | null,
      creado_por: p.creado_por as string | null,
      disponible: Math.round(Math.max(0, disponibleDePago(
        p.monto,
        (impsPorPago.get(p.id) || []).map((i: any) => ({
          monto_imputado: i.monto_imputado,
          estado: i.estado,
          tipo_comprobante_destino: (i.comprobante as any)?.tipo_comprobante ?? null,
        })),
      ) - (reservas.get(p.id) ?? 0)) * 100) / 100,
    }))
    .filter((p) =>
      p.estado === "rechazado"
        ? (p.fecha || "") >= (opts.incluirRechazadasDesde || "")
        : p.disponible > 0.005
    )

  const totalAFavor = Math.round((
    creditos.reduce((s: number, c: any) => s + Math.abs(Number(c.saldo_pendiente)), 0)
    + aCuenta.filter((p) => p.estado !== "rechazado").reduce((s, p) => s + p.disponible, 0)
  ) * 100) / 100

  return { creditos, aCuenta, totalAFavor }
}
