import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { requireAuth } from "@/lib/auth"
import {
  calcularPrecioFinal,
  articuloToDatosArticulo,
  type DatosLista,
  type MetodoFacturacion,
  type DescuentoTipado,
} from "@/lib/pricing/calculator"
import { generarBonificacionContado } from "@/lib/comprobantes/generar-bonificacion"
import { vincularKardexAComprobante, distribuirPercepcionesKardex } from "@/lib/kardex/insertar-kardex"

export async function POST(request: Request) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const supabase = createAdminClient()
    const body = await request.json()
    const { pedido_id, pago_contado } = body

    // ─── 1. Obtener pedido con cliente y detalles ───
    // Prices are already stored in pedidos_detalle (calculated when the order was created).
    // precio_final = precio al cliente (IVA incluido for presupuesto, net for factura)
    // precio_base  = precio neto antes de IVA
    const { data: pedido, error: pedidoError } = await supabase
      .from("pedidos")
      .select(`
        *,
        cliente:clientes!pedidos_cliente_id_fkey(
          id, nombre_razon_social, condicion_iva, metodo_facturacion,
          cuit, direccion, exento_iva
        ),
        detalle:pedidos_detalle(
          id, articulo_id, cantidad, precio_final, precio_base,
          articulo:articulos!pedidos_detalle_articulo_id_fkey(
            id, descripcion, sku, iva_ventas
          )
        )
      `)
      .eq("id", pedido_id)
      .single()

    if (pedidoError || !pedido) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 })
    }

    // ─── 2. Determinar método de facturación ───
    const metodoRaw = pedido.metodo_facturacion_pedido || pedido.cliente.metodo_facturacion || "Final"
    const metodoFacturacion: MetodoFacturacion =
      metodoRaw === "Factura (21% IVA)" || metodoRaw === "Factura" ? "Factura" :
      metodoRaw === "Presupuesto" ? "Presupuesto" : "Final"

    // ─── 3. Build items using stored prices ───
    // precio_final = lo que el cliente paga (IVA incluido en presupuesto, neto en factura)
    // Para factura A: discriminamos IVA retrocalculando desde el precio almacenado.
    type ItemCalculado = {
      detalle_id: string
      articulo_id: string
      descripcion: string
      sku: string
      cantidad: number
      precioUnitario: number    // precio en la línea del comprobante
      precioAntesIva: number    // neto (= precioUnitario para factura)
      ivaUnitario: number       // IVA por unidad
      ivaIncluido: boolean
      subtotalNeto: number
      subtotalIva: number
      subtotalFinal: number
      descNegroAplicado: boolean
      vaEnComprobante: "factura" | "presupuesto"
    }

    const IVA_RATE = 0.21

    const itemsCalculados: ItemCalculado[] = []
    for (const det of pedido.detalle) {
      const art = det.articulo
      if (!art) continue

      const esPresupuesto = art.iva_ventas === "presupuesto" || metodoFacturacion === "Presupuesto"
      const vaEnComprobante: "factura" | "presupuesto" =
        metodoFacturacion === "Presupuesto" ? "presupuesto" :
        metodoFacturacion === "Factura"     ? "factura"     :
        esPresupuesto ? "presupuesto" : "factura"

      // precio_final stored = precio al cliente (with IVA for presupuesto, net for factura)
      const precioAlCliente = det.precio_final || 0

      let precioUnitario: number
      let ivaUnitario: number
      let ivaIncluido: boolean

      if (vaEnComprobante === "factura") {
        // Factura A: line shows net, IVA discriminated at bottom
        // precio_final stored is already the net (set by calcularPrecioPedido)
        precioUnitario = precioAlCliente
        ivaUnitario    = round2(precioAlCliente * IVA_RATE)
        ivaIncluido    = false
      } else {
        // Presupuesto: line shows full price with IVA included
        precioUnitario = precioAlCliente
        ivaUnitario    = 0
        ivaIncluido    = true
      }

      const subtotalNeto  = round2(precioUnitario * det.cantidad)
      const subtotalIva   = round2(ivaUnitario * det.cantidad)
      const subtotalFinal = round2(subtotalNeto + subtotalIva)

      itemsCalculados.push({
        detalle_id: det.id,
        articulo_id: det.articulo_id,
        descripcion: art.descripcion || "",
        sku: art.sku || "",
        cantidad: det.cantidad,
        precioUnitario,
        precioAntesIva: precioUnitario,
        ivaUnitario,
        ivaIncluido,
        subtotalNeto,
        subtotalIva,
        subtotalFinal,
        descNegroAplicado: false,
        vaEnComprobante,
      })
    }

    // ─── 4. Agrupar items por tipo de comprobante ───
    const itemsFactura = itemsCalculados.filter(i => i.vaEnComprobante === "factura")
    const itemsPresupuesto = itemsCalculados.filter(i => i.vaEnComprobante === "presupuesto")

    const comprobantesGenerados = []
    const tipoFactura = determinarTipoFactura(pedido.cliente.condicion_iva)

    // ─── 5. Generar comprobantes ───
    if (itemsFactura.length > 0) {
      const resultado = await generarComprobante(supabase, pedido, itemsFactura, tipoFactura)
      comprobantesGenerados.push(resultado)
    }

    if (itemsPresupuesto.length > 0) {
      const resultado = await generarComprobante(supabase, pedido, itemsPresupuesto, "PRES")
      comprobantesGenerados.push(resultado)
    }

    // ── Vincular kardex al comprobante generado ───────────────────────────────
    // Cada comprobante puede cubrir un subconjunto de ítems; vinculamos por tipo
    for (const comp of comprobantesGenerados) {
      if (!comp.id) continue
      const colorComp = comp.tipo_comprobante === "PRES" ? "NEGRO" : "BLANCO"
      const metodoComp = comp.tipo_comprobante === "PRES" ? "Presupuesto" : "Factura"
      await vincularKardexAComprobante(
        supabase,
        pedido_id,
        comp.id,
        comp.tipo_comprobante,
        comp.numero,
        metodoComp,
        colorComp,
      )
    }

    // ── Distribuir percepciones IVA/IIBB del comprobante entre ítems del kardex
    const percIva = comprobantesGenerados.reduce((s: number, c: any) => s + (c.percepcion_iva ?? 0), 0)
    const percIibb = comprobantesGenerados.reduce((s: number, c: any) => s + (c.percepcion_iibb ?? 0), 0)
    if (percIva > 0 || percIibb > 0) {
      await distribuirPercepcionesKardex(supabase, pedido_id, percIva, percIibb)
    }

    // ── Vincular comisión al comprobante principal ────────────────────────────
    if (comprobantesGenerados.length > 0 && comprobantesGenerados[0].id) {
      await supabase
        .from("comisiones")
        .update({ comprobante_venta_id: comprobantesGenerados[0].id })
        .eq("pedido_id", pedido_id)
        .is("comprobante_venta_id", null)
    }

    // ─── 6. Actualizar total del pedido ───
    const totalPedido = itemsCalculados.reduce((sum, i) => sum + i.subtotalFinal, 0)

    // ─── 8. Generar bonificación pago contado si corresponde ───
    let bonificacion = null
    if (pago_contado && comprobantesGenerados.length > 0) {
      const comprobanteIds = comprobantesGenerados.map((c: any) => c.id).filter(Boolean)
      bonificacion = await generarBonificacionContado(supabase, {
        cliente_id: pedido.cliente.id,
        comprobante_ids: comprobanteIds,
      })
    }

    return NextResponse.json({
      success: true,
      comprobantes: comprobantesGenerados,
      metodo_facturacion: metodoFacturacion,
      total_pedido: round2(totalPedido),
      bonificacion_contado: bonificacion,
    })
  } catch (error: any) {
    console.error("[Generar Comprobantes] Error:", error)
    return NextResponse.json({ error: error.message || "Error generando comprobantes" }, { status: 500 })
  }
}

// ─── Helpers ───────────────────────────────────────────

function determinarTipoFactura(condicionIva: string): string {
  const c = (condicionIva || "").toLowerCase()
  if (c.includes("responsable inscri")) return "FA"
  if (c.includes("monotributo")) return "FB"
  return "FC"
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

async function generarComprobante(
  supabase: any,
  pedido: any,
  items: Array<{
    articulo_id: string; descripcion: string; sku: string
    cantidad: number; precioUnitario: number; precioAntesIva: number
    ivaUnitario: number; ivaIncluido: boolean
    subtotalNeto: number; subtotalIva: number; subtotalFinal: number
    descNegroAplicado: boolean
  }>,
  tipoComprobante: string,
) {
  // Obtener numeración
  const { data: numeracion, error: numError } = await supabase
    .from("numeracion_comprobantes")
    .select("*")
    .eq("tipo_comprobante", tipoComprobante)
    .eq("punto_venta", "0001")
    .single()

  if (numError) throw new Error(`Numeración no encontrada para ${tipoComprobante}. Verificá la tabla numeracion_comprobantes.`)

  const nuevoNumero = numeracion.ultimo_numero + 1
  const numeroComprobante = `${numeracion.punto_venta}-${nuevoNumero.toString().padStart(8, "0")}`

  // Calcular totales del comprobante
  const esPresupuesto = tipoComprobante === "PRES"

  let totalNeto = 0
  let totalIva = 0

  for (const item of items) {
    if (esPresupuesto) {
      // En presupuesto: si tiene IVA incluido (blanco en presupuesto), el total ya lo incluye
      totalNeto += item.subtotalNeto
      // No discriminamos IVA en presupuesto
    } else {
      // En factura: neto + IVA discriminado
      totalNeto += round2(item.precioAntesIva * item.cantidad)
      totalIva += item.subtotalIva
    }
  }

  totalNeto = round2(totalNeto)
  totalIva = round2(totalIva)
  const totalFactura = round2(totalNeto + totalIva)

  // Crear comprobante
  const { data: comprobante, error: compError } = await supabase
    .from("comprobantes_venta")
    .insert({
      tipo_comprobante: tipoComprobante,
      numero_comprobante: numeroComprobante,
      punto_venta: numeracion.punto_venta,
      fecha: todayArgentina(),
      cliente_id: pedido.cliente_id,
      pedido_id: pedido.id,
      total_neto: totalNeto,
      total_iva: totalIva,
      total_factura: totalFactura,
      saldo_pendiente: totalFactura,
      estado_pago: "pendiente",
    })
    .select("id, percepcion_iva, percepcion_iibb")
    .single()

  if (compError) throw new Error("Error creando comprobante: " + compError.message)

  // Crear detalle
  const detalleInserts = items.map(item => ({
    comprobante_id: comprobante.id,
    articulo_id: item.articulo_id,
    descripcion: item.descripcion,
    cantidad: item.cantidad,
    precio_unitario: item.precioUnitario,
    precio_total: item.subtotalNeto,
  }))

  const { error: detError } = await supabase.from("comprobantes_venta_detalle").insert(detalleInserts)
  if (detError) throw new Error("Error creando detalle: " + detError.message)

  // Descontar stock y registrar movimiento
  for (const item of items) {
    await supabase.rpc("increment_stock_actual", {
      p_articulo_id: item.articulo_id,
      p_cantidad: -item.cantidad,
    }).then(() => {})  // Ignorar error si la función no existe

    await supabase.from("movimientos_stock").insert({
      articulo_id: item.articulo_id,
      tipo_movimiento: "salida",
      cantidad: item.cantidad,
      precio_unitario: item.precioUnitario,
      fecha_movimiento: nowArgentina(),
      observaciones: `Venta - ${tipoComprobante} ${numeroComprobante}`,
    })
  }

  // Actualizar numeración
  await supabase
    .from("numeracion_comprobantes")
    .update({ ultimo_numero: nuevoNumero })
    .eq("tipo_comprobante", tipoComprobante)
    .eq("punto_venta", numeracion.punto_venta)

  return {
    tipo: "comprobante",
    id: comprobante.id,
    tipo_comprobante: tipoComprobante,
    numero: numeroComprobante,
    total_neto: totalNeto,
    total_iva: totalIva,
    total: totalFactura,
    percepcion_iva: comprobante.percepcion_iva ?? 0,
    percepcion_iibb: comprobante.percepcion_iibb ?? 0,
  }
}
