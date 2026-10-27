// Refacturar un pedido (R3, regla de Juan 27/10/2026) — el 10 % contado compartido.
//
// La REV del 10 % contado es UNA por cobro y puede cubrir comprobantes de otros
// pedidos o deuda vieja. Al refacturar se anula SOLO la parte de este pedido: un
// PRES por esa parte (débito no fiscal), con su asiento en el libro mayor, que
// después se cruza con el crédito de la anulación. Lo pagado sigue al pedido en
// lib/pedidos/refacturar.ts (listas de precios).

import { postearLibroConAviso } from "@/lib/cuenta-corriente/postear-libro"
import { todayArgentina } from "@/lib/utils"
import { moneda } from "@/lib/formato"

const r2 = (n: number) => Math.round(n * 100) / 100

/** Anula solo la parte de este pedido de la REV del 10 % contado (paso 3): PRES por esa parte. */
export async function anularParteContado(
  supabase: any,
  nota: { id: string; tipo_comprobante: string; numero_comprobante: string },
  monto: number,
  pedido: { id: string; numero_pedido: string | null },
  usuarioId: string,
): Promise<{ id: string; tipo_comprobante: string; numero_comprobante: string; total: number }> {
  if (nota.tipo_comprobante !== "REV") throw new Error("Solo se anula en parte una REV (no fiscal)")
  const { data: orig, error: oErr } = await supabase.from("comprobantes_venta").select("id, cliente_id, punto_venta, anulado_en").eq("id", nota.id).single()
  if (oErr || !orig) throw new Error("No se encontró la REV del 10 % contado")
  if (orig.anulado_en) throw new Error(`La REV ${nota.numero_comprobante} ya está anulada`)
  const puntoVenta = orig.punto_venta || nota.numero_comprobante.split("-")[0]
  const importe = r2(monto)

  // Numeración con control de carrera: solo avanza si nadie la tomó en el medio
  let numero = ""
  for (let intento = 0; intento < 5 && !numero; intento++) {
    const { data: num } = await supabase.from("numeracion_comprobantes").select("ultimo_numero").eq("tipo_comprobante", "PRES").eq("punto_venta", puntoVenta).single()
    if (!num) throw new Error(`No hay numeración de PRES para el punto de venta ${puntoVenta}`)
    const siguiente = Number(num.ultimo_numero) + 1
    const { data: tomado } = await supabase
      .from("numeracion_comprobantes")
      .update({ ultimo_numero: siguiente })
      .eq("tipo_comprobante", "PRES")
      .eq("punto_venta", puntoVenta)
      .eq("ultimo_numero", num.ultimo_numero)
      .select("ultimo_numero")
    if (tomado?.length) numero = `${puntoVenta}-${String(siguiente).padStart(8, "0")}`
  }
  if (!numero) throw new Error("No se pudo numerar el PRES de la anulación parcial (reintentá)")

  const obs = `Anulación parcial del 10% contado: REV ${nota.numero_comprobante}, parte del pedido ${pedido.numero_pedido || pedido.id} (${moneda(importe)}) — refacturación`
  const { data: pres, error: pErr } = await supabase
    .from("comprobantes_venta")
    .insert({
      tipo_comprobante: "PRES",
      numero_comprobante: numero,
      punto_venta: puntoVenta,
      fecha: todayArgentina(),
      cliente_id: orig.cliente_id,
      pedido_id: null,
      total_neto: importe,
      total_iva: 0,
      percepcion_iva: 0,
      percepcion_iibb: 0,
      total_factura: importe,
      saldo_pendiente: importe,
      estado_pago: "pendiente",
      motivo_ajuste: "Anulación parcial",
      observaciones: obs,
      comprobantes_relacionados_ids: [nota.id],
      creado_por: usuarioId,
    })
    .select("id")
    .single()
  if (pErr || !pres) throw new Error(`No se pudo crear el PRES de la anulación parcial: ${pErr?.message}`)

  const aviso = await postearLibroConAviso(
    supabase,
    {
      p_cliente_id: orig.cliente_id,
      p_tipo_movimiento: "presupuesto",
      p_debe: importe,
      p_haber: 0,
      p_referencia_tipo: "comprobante_venta",
      p_referencia_id: pres.id,
      p_numero_comprobante: numero,
      p_observaciones: obs,
      p_usuario_id: usuarioId,
    },
    `PRES ${numero} (anulación parcial del 10%)`,
  )
  if (aviso) throw new Error(aviso)
  return { id: pres.id, tipo_comprobante: "PRES", numero_comprobante: numero, total: importe }
}
