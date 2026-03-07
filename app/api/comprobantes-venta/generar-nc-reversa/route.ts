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
    const {
      devolucion_id,
      tipo_comprobante, // 'NC' o 'REV'
      motivo_ajuste,
    } = body

    const { data: devolucion, error: devError } = await supabase
      .from("devoluciones")
      .select(`
        *,
        pedido_id,
        cliente:clientes!devoluciones_cliente_id_fkey(
          id,
          nombre_razon_social,
          condicion_iva,
          metodo_facturacion,
          exento_iva
        ),
        detalle:devoluciones_detalle(
          *,
          articulo:articulos!devoluciones_detalle_articulo_id_fkey(
            id,
            descripcion,
            iva_ventas
          ),
          comprobante_original:comprobantes_venta!devoluciones_detalle_comprobante_venta_id_fkey(
            id,
            tipo_comprobante
          )
        )
      `)
      .eq("id", devolucion_id)
      .single()

    if (devError || !devolucion) {
      return NextResponse.json({ error: "Devolución no encontrada" }, { status: 404 })
    }

    let tipoFinal = tipo_comprobante

    if (tipo_comprobante === "auto") {
      // Auto-determinar según método del cliente
      const metodo = devolucion.cliente.metodo_facturacion?.toLowerCase() || "factura"

      if (metodo.includes("presupuesto") || metodo.includes("remito")) {
        tipoFinal = "REV" // Reversa
      } else {
        // Determinar si es NC A, B o C según condición IVA
        const condicion = devolucion.cliente.condicion_iva?.toLowerCase() || ""

        if (condicion.includes("responsable inscripto")) {
          tipoFinal = "NCA"
        } else if (condicion.includes("monotributo")) {
          tipoFinal = "NCB"
        } else {
          tipoFinal = "NCC"
        }
      }
    }

    if (devolucion.detalle.length > 0 && devolucion.detalle[0].comprobante_original) {
      const tipoOriginal = devolucion.detalle[0].comprobante_original.tipo_comprobante

      if (tipoOriginal === "FA") tipoFinal = "NCA"
      else if (tipoOriginal === "FB") tipoFinal = "NCB"
      else if (tipoOriginal === "FC") tipoFinal = "NCC"
      else if (tipoOriginal === "PRES") tipoFinal = "REV"
    }

    const { data: numeracion, error: numError } = await supabase
      .from("numeracion_comprobantes")
      .select("*")
      .eq("tipo_comprobante", tipoFinal)
      .eq("punto_venta", "0001")
      .single()

    if (numError) {
      return NextResponse.json({ error: "Error obteniendo numeración" }, { status: 500 })
    }

    const nuevoNumero = numeracion.ultimo_numero + 1
    const numeroComprobante = `${numeracion.punto_venta}-${nuevoNumero.toString().padStart(8, "0")}`

    let totalNeto = 0
    let totalIva = 0

    devolucion.detalle.forEach((item: any) => {
      const subtotal = item.subtotal || 0

      if (tipoFinal.startsWith("NC") && !devolucion.cliente.exento_iva) {
        const neto = subtotal / 1.21
        const iva = subtotal - neto
        totalNeto += neto
        totalIva += iva
      } else {
        totalNeto += subtotal
      }
    })

    const totalComprobante = totalNeto + totalIva

    const { data: comprobante, error: comprobanteError } = await supabase
      .from("comprobantes_venta")
      .insert({
        tipo_comprobante: tipoFinal,
        numero_comprobante: numeroComprobante,
        punto_venta: numeracion.punto_venta,
        fecha: todayArgentina(),
        cliente_id: devolucion.cliente_id,
        pedido_id: devolucion.pedido_id || null,
        total_neto: -Math.abs(totalNeto), // Negativo para NC/Reversa
        total_iva: -Math.abs(totalIva),
        total_factura: -Math.abs(totalComprobante),
        saldo_pendiente: -Math.abs(totalComprobante),
        estado_pago: "pendiente",
        motivo_ajuste: motivo_ajuste,
        observaciones: `Devolución ${devolucion.numero_devolucion || devolucion.id}`,
      })
      .select()
      .single()

    if (comprobanteError) {
      return NextResponse.json(
        {
          error: "Error creando comprobante: " + comprobanteError.message,
        },
        { status: 500 },
      )
    }

    const detalleInserts = devolucion.detalle.map((item: any) => ({
      comprobante_id: comprobante.id,
      articulo_id: item.articulo_id,
      descripcion: item.articulo.descripcion,
      cantidad: -Math.abs(item.cantidad), // Negativo
      precio_unitario: item.precio_venta_original || 0,
      precio_total: -Math.abs(item.subtotal || 0),
    }))

    const { error: detalleError } = await supabase.from("comprobantes_venta_detalle").insert(detalleInserts)

    if (detalleError) {
      return NextResponse.json(
        {
          error: "Error creando detalle del comprobante",
        },
        { status: 500 },
      )
    }

    await supabase
      .from("numeracion_comprobantes")
      .update({ ultimo_numero: nuevoNumero })
      .eq("tipo_comprobante", tipoFinal)
      .eq("punto_venta", numeracion.punto_venta)

    await supabase.from("cuenta_corriente_ajustes").insert({
      cliente_id: devolucion.cliente_id,
      tipo_movimiento: "haber",
      tipo_comprobante: tipoFinal,
      numero_comprobante: numeroComprobante,
      monto: Math.abs(totalComprobante),
      fecha: todayArgentina(),
      concepto: "Devolución",
      descripcion: motivo_ajuste,
    })

    return NextResponse.json({
      success: true,
      comprobante: {
        id: comprobante.id,
        tipo: tipoFinal,
        numero: numeroComprobante,
        total: totalComprobante,
      },
    })
  } catch (error: any) {
    console.error("[v0] Error generando NC/Reversa:", error)
    return NextResponse.json({ error: error.message || "Error generando comprobante" }, { status: 500 })
  }
}
