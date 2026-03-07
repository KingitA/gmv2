import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { requireAuth } from '@/lib/auth'

export async function POST(request: Request) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const cookieStore = await cookies()
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
      },
    })

    const body = await request.json()
    const { pedido_id } = body

    const { data: pedido, error: pedidoError } = await supabase
      .from("pedidos")
      .select(`
        *,
        cliente:clientes!pedidos_cliente_id_fkey(
          id,
          nombre_razon_social,
          condicion_iva,
          metodo_facturacion,
          cuit,
          direccion,
          exento_iva
        ),
        detalle:pedidos_detalle(
          id,
          articulo_id,
          cantidad,
          precio_final,
          subtotal,
          articulo:articulos!pedidos_detalle_articulo_id_fkey(
            id,
            descripcion,
            iva_ventas
          )
        )
      `)
      .eq("id", pedido_id)
      .single()

    if (pedidoError || !pedido) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 })
    }

    const itemsFactura = pedido.detalle.filter((item: any) => item.articulo.iva_ventas === "factura")
    const itemsPresupuesto = pedido.detalle.filter((item: any) => item.articulo.iva_ventas === "presupuesto")
    const itemsRemito = pedido.detalle.filter((item: any) => item.articulo.iva_ventas === "remito")

    const comprobantesGenerados = []

    const tipoFactura = determinarTipoFactura(pedido.cliente.condicion_iva)

    if (itemsFactura.length > 0) {
      const factura = await generarComprobante(supabase, pedido, itemsFactura, tipoFactura, false)
      comprobantesGenerados.push(factura)
    }

    if (itemsPresupuesto.length > 0) {
      const presupuesto = await generarComprobante(supabase, pedido, itemsPresupuesto, "PRES", false)
      comprobantesGenerados.push(presupuesto)
    }

    if (itemsRemito.length > 0) {
      const remito = await generarRemito(supabase, pedido, itemsRemito)
      comprobantesGenerados.push(remito)
    }

    return NextResponse.json({
      success: true,
      comprobantes: comprobantesGenerados,
    })
  } catch (error: any) {
    console.error("[v0] Error generando comprobantes:", error)
    return NextResponse.json({ error: error.message || "Error generando comprobantes" }, { status: 500 })
  }
}

function determinarTipoFactura(condicionIva: string): string {
  const condicion = condicionIva?.toLowerCase() || ""

  if (condicion.includes("responsable inscripto") || condicion.includes("responsable inscrito")) {
    return "FA" // Factura A
  } else if (condicion.includes("monotributo")) {
    return "FB" // Factura B
  } else {
    return "FC" // Factura C (consumidor final, exento, etc)
  }
}

async function generarComprobante(
  supabase: any,
  pedido: any,
  items: any[],
  tipoComprobante: string,
  esNotaCredito = false,
) {
  // Obtener próximo número
  const { data: numeracion, error: numError } = await supabase
    .from("numeracion_comprobantes")
    .select("*")
    .eq("tipo_comprobante", tipoComprobante)
    .eq("punto_venta", "0001")
    .single()

  if (numError) {
    throw new Error("Error obteniendo numeración")
  }

  const nuevoNumero = numeracion.ultimo_numero + 1
  const numeroComprobante = `${numeracion.punto_venta}-${nuevoNumero.toString().padStart(8, "0")}`

  // Calcular totales
  let totalNeto = 0
  let totalIva = 0

  items.forEach((item: any) => {
    const subtotal = item.subtotal || item.cantidad * item.precio_final

    // Si es factura A o B y el artículo tiene IVA
    if ((tipoComprobante === "FA" || tipoComprobante === "FB") && !pedido.cliente.exento_iva) {
      // El precio ya incluye IVA, extraer el neto e IVA
      const neto = subtotal / 1.21
      const iva = subtotal - neto
      totalNeto += neto
      totalIva += iva
    } else {
      // Para factura C o presupuesto, el total es directo
      totalNeto += subtotal
    }
  })

  const totalFactura = totalNeto + totalIva

  // Crear comprobante
  const { data: comprobante, error: comprobanteError } = await supabase
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

  if (comprobanteError) {
    throw new Error("Error creando comprobante: " + comprobanteError.message)
  }

  // Crear detalle del comprobante
  const detalleInserts = items.map((item: any) => ({
    comprobante_id: comprobante.id,
    articulo_id: item.articulo_id,
    descripcion: item.articulo.descripcion,
    cantidad: item.cantidad,
    precio_unitario: item.precio_final,
    precio_total: item.subtotal || item.cantidad * item.precio_final,
  }))

  const { error: detalleError } = await supabase.from("comprobantes_venta_detalle").insert(detalleInserts)

  if (detalleError) {
    throw new Error("Error creando detalle del comprobante")
  }

  // NUEVO: Descontar stock_actual, liberar stock_reservado y registrar en Kardex
  for (const item of items) {
    // 1. Descontar stock_actual (usamos valor negativo)
    await supabase.rpc("increment_stock_actual", {
      p_articulo_id: item.articulo_id,
      p_cantidad: -item.cantidad,
    })

    // 2. Liberar stock_reservado (usamos valor negativo)
    await supabase.rpc("increment_stock_reservado", {
      p_articulo_id: item.articulo_id,
      p_cantidad: -item.cantidad,
    })

    // 3. Registrar movimiento en Kardex
    await supabase.from("movimientos_stock").insert({
      articulo_id: item.articulo_id,
      tipo_movimiento: "salida",
      cantidad: item.cantidad,
      precio_unitario: item.precio_final,
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
    total: totalFactura,
  }
}

async function generarRemito(supabase: any, pedido: any, items: any[]) {
  // Obtener próximo número de remito
  const { data: numeracion, error: numError } = await supabase
    .from("numeracion_comprobantes")
    .select("*")
    .eq("tipo_comprobante", "REM")
    .eq("punto_venta", "0001")
    .single()

  if (numError) {
    throw new Error("Error obteniendo numeración de remito")
  }

  const nuevoNumero = numeracion.ultimo_numero + 1
  const numeroRemito = `${numeracion.punto_venta}-${nuevoNumero.toString().padStart(8, "0")}`

  // Crear remito
  const { data: remito, error: remitoError } = await supabase
    .from("remitos")
    .insert({
      numero_remito: numeroRemito,
      punto_venta: numeracion.punto_venta,
      fecha: todayArgentina(),
      cliente_id: pedido.cliente_id,
      pedido_id: pedido.id,
      valor_declarado: 0, // Editable después
      bultos: pedido.bultos || 0,
      estado: "activo",
    })
    .select()
    .single()

  if (remitoError) {
    throw new Error("Error creando remito: " + remitoError.message)
  }

  // Crear detalle del remito
  const detalleInserts = items.map((item: any) => ({
    remito_id: remito.id,
    articulo_id: item.articulo_id,
    descripcion: item.articulo.descripcion,
    cantidad: item.cantidad,
  }))

  const { error: detalleError } = await supabase.from("remitos_detalle").insert(detalleInserts)

  if (detalleError) {
    throw new Error("Error creando detalle del remito")
  }

  // Actualizar numeración
  await supabase
    .from("numeracion_comprobantes")
    .update({ ultimo_numero: nuevoNumero })
    .eq("tipo_comprobante", "REM")
    .eq("punto_venta", numeracion.punto_venta)

  return {
    tipo: "remito",
    id: remito.id,
    numero: numeroRemito,
  }
}
