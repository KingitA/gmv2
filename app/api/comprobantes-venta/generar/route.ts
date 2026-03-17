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

export async function POST(request: Request) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const supabase = createAdminClient()
    const body = await request.json()
    const { pedido_id } = body

    // ─── 1. Obtener pedido con cliente, detalles y artículos ───
    const { data: pedido, error: pedidoError } = await supabase
      .from("pedidos")
      .select(`
        *,
        cliente:clientes!pedidos_cliente_id_fkey(
          id, nombre_razon_social, condicion_iva, metodo_facturacion,
          cuit, direccion, exento_iva, lista_precio_id, descuento_especial
        ),
        detalle:pedidos_detalle(
          id, articulo_id, cantidad,
          articulo:articulos!pedidos_detalle_articulo_id_fkey(
            id, descripcion, sku, precio_compra,
            descuento1, descuento2, descuento3, descuento4,
            porcentaje_ganancia, categoria, rubro,
            iva_compras, iva_ventas,
            proveedor:proveedores!articulos_proveedor_id_fkey(tipo_descuento)
          )
        )
      `)
      .eq("id", pedido_id)
      .single()

    if (pedidoError || !pedido) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 })
    }

    // Obtener descuentos tipados para todos los artículos del pedido
    const articuloIds = pedido.detalle.map((d: any) => d.articulo_id).filter(Boolean)
    const { data: descuentosDB } = await supabase
      .from("articulos_descuentos")
      .select("articulo_id, tipo, porcentaje, orden")
      .in("articulo_id", articuloIds)
      .order("orden")

    const descuentosPorArticulo: Record<string, DescuentoTipado[]> = {}
    for (const d of (descuentosDB || [])) {
      if (!descuentosPorArticulo[d.articulo_id]) descuentosPorArticulo[d.articulo_id] = []
      descuentosPorArticulo[d.articulo_id].push({ tipo: d.tipo, porcentaje: d.porcentaje, orden: d.orden })
    }

    // ─── 2. Obtener lista de precio del cliente ───
    let listaDatos: DatosLista = { recargo_limpieza_bazar: 0, recargo_perfumeria_negro: 0, recargo_perfumeria_blanco: 0 }
    if (pedido.cliente.lista_precio_id) {
      const { data: lista } = await supabase
        .from("listas_precio")
        .select("*")
        .eq("id", pedido.cliente.lista_precio_id)
        .single()
      if (lista) {
        listaDatos = {
          recargo_limpieza_bazar: lista.recargo_limpieza_bazar || 0,
          recargo_perfumeria_negro: lista.recargo_perfumeria_negro || 0,
          recargo_perfumeria_blanco: lista.recargo_perfumeria_blanco || 0,
        }
      }
    }

    // ─── 3. Determinar método de facturación ───
    // Prioridad: override del pedido > default del cliente
    const metodoRaw = pedido.metodo_facturacion_pedido || pedido.cliente.metodo_facturacion || "Final"
    const metodoFacturacion: MetodoFacturacion =
      metodoRaw === "Factura" ? "Factura" :
      metodoRaw === "Presupuesto" ? "Presupuesto" : "Final"

    const descuentoCliente = pedido.cliente.descuento_especial || 0

    // ─── 4. Calcular precios para cada item ───
    type ItemCalculado = {
      detalle_id: string
      articulo_id: string
      descripcion: string
      sku: string
      cantidad: number
      precioUnitario: number       // precio que se muestra al cliente
      precioAntesIva: number       // neto antes de IVA
      ivaUnitario: number          // IVA por unidad (discriminado, 0 si incluido)
      ivaIncluido: boolean
      subtotalNeto: number
      subtotalIva: number
      subtotalFinal: number
      descNegroAplicado: boolean
      vaEnComprobante: "factura" | "presupuesto"
    }

    const itemsCalculados: ItemCalculado[] = []

    for (const det of pedido.detalle) {
      const art = det.articulo
      if (!art) continue

      const datosArticulo = articuloToDatosArticulo(art, descuentosPorArticulo[det.articulo_id])

      const resultado = calcularPrecioFinal(datosArticulo, listaDatos, metodoFacturacion, descuentoCliente)

      itemsCalculados.push({
        detalle_id: det.id,
        articulo_id: det.articulo_id,
        descripcion: art.descripcion || "",
        sku: art.sku || "",
        cantidad: det.cantidad,
        precioUnitario: resultado.precioUnitarioFinal,
        precioAntesIva: resultado.precioAntesIva,
        ivaUnitario: resultado.montoIvaDiscriminado,
        ivaIncluido: resultado.ivaIncluido,
        subtotalNeto: round2(resultado.precioUnitarioFinal * det.cantidad),
        subtotalIva: round2(resultado.montoIvaDiscriminado * det.cantidad),
        subtotalFinal: round2(
          resultado.ivaIncluido
            ? resultado.precioUnitarioFinal * det.cantidad
            : (resultado.precioUnitarioFinal + resultado.montoIvaDiscriminado) * det.cantidad
        ),
        descNegroAplicado: resultado.descuentoNegroEnFacturaPct > 0,
        vaEnComprobante: resultado.vaEnComprobante,
      })
    }

    // ─── 5. Agrupar items por tipo de comprobante ───
    const itemsFactura = itemsCalculados.filter(i => i.vaEnComprobante === "factura")
    const itemsPresupuesto = itemsCalculados.filter(i => i.vaEnComprobante === "presupuesto")

    const comprobantesGenerados = []
    const tipoFactura = determinarTipoFactura(pedido.cliente.condicion_iva)

    // ─── 6. Generar comprobantes ───
    if (itemsFactura.length > 0) {
      const resultado = await generarComprobante(supabase, pedido, itemsFactura, tipoFactura)
      comprobantesGenerados.push(resultado)
    }

    if (itemsPresupuesto.length > 0) {
      const resultado = await generarComprobante(supabase, pedido, itemsPresupuesto, "PRES")
      comprobantesGenerados.push(resultado)
    }

    // ─── 7. Actualizar pedidos_detalle con los precios calculados ───
    for (const item of itemsCalculados) {
      await supabase
        .from("pedidos_detalle")
        .update({
          precio_final: item.precioUnitario,
          precio_base: item.precioAntesIva,
          subtotal: item.subtotalNeto,
        })
        .eq("id", item.detalle_id)
    }

    // Actualizar total del pedido
    const totalPedido = itemsCalculados.reduce((sum, i) => sum + i.subtotalFinal, 0)
    await supabase.from("pedidos").update({ total: round2(totalPedido) }).eq("id", pedido_id)

    return NextResponse.json({
      success: true,
      comprobantes: comprobantesGenerados,
      metodo_facturacion: metodoFacturacion,
      total_pedido: round2(totalPedido),
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
    .select()
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
  }
}
