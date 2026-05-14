import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { requireAuth } from '@/lib/auth'
import { getComisionPorcentaje, getPrecioNeto } from "@/lib/comisiones/calcular"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { id } = await params
    const { usuario_confirmador, accion, motivo_rechazo, imputaciones } = body // accion: 'confirmar' | 'rechazar'

    if (!usuario_confirmador || !accion) {
      return NextResponse.json({ error: "usuario_confirmador y accion son requeridos" }, { status: 400 })
    }

    if (accion === "confirmar") {
      // Obtener el pago
      const { data: pago, error: pagoError } = await supabase
        .from("pagos_clientes")
        .select("*")
        .eq("id", id)
        .single()

      if (pagoError) throw pagoError

      // Confirmar pago
      const { error: updateError } = await supabase
        .from("pagos_clientes")
        .update({
          estado: "confirmado",
          confirmado_por: usuario_confirmador,
          fecha_confirmacion: nowArgentina(),
        })
        .eq("id", id)

      if (updateError) throw updateError

      let imputacionesFinales = imputaciones

      if (!imputacionesFinales || imputacionesFinales.length === 0) {
        // Buscar imputaciones previamente guardadas
        const { data: impGuardadas } = await supabase
          .from("imputaciones")
          .select("*")
          .eq("pago_id", id)
          .eq("estado", "pendiente")

        imputacionesFinales = impGuardadas || []
      }

      // Aplicar imputaciones a los comprobantes
      for (const imp of imputacionesFinales) {
        // Obtener comprobante actual
        const { data: comprobante } = await supabase
          .from("comprobantes_venta")
          .select("*")
          .eq("id", imp.comprobante_id)
          .single()

        if (!comprobante) continue

        const nuevoSaldo = Number(comprobante.saldo_pendiente) - Number(imp.monto_imputado)
        const nuevoEstado = nuevoSaldo <= 0 ? "pagado" : "parcial"

        // Actualizar saldo del comprobante
        await supabase
          .from("comprobantes_venta")
          .update({
            saldo_pendiente: Math.max(0, nuevoSaldo),
            estado_pago: nuevoEstado,
          })
          .eq("id", imp.comprobante_id)

        // Si el comprobante quedó saldado → crear comisiones 'cobrada' y movimiento en billetera
        if (nuevoEstado === "pagado") {
          try {
            // Obtener ítems del comprobante con datos del artículo
            const { data: items } = await supabase
              .from("comprobantes_venta_detalle")
              .select("articulo_id, cantidad, precio_unitario, articulos(segmento_precio, iva_ventas)")
              .eq("comprobante_id", imp.comprobante_id)

            // Tipo de comprobante y pedido_id
            const { data: comp } = await supabase
              .from("comprobantes_venta")
              .select("tipo_comprobante, pedido_id")
              .eq("id", imp.comprobante_id)
              .single()

            // Obtener viajante desde el pedido → cliente
            let viajanteId: string | null = null
            if (comp?.pedido_id) {
              const { data: pedidoData } = await supabase
                .from("pedidos")
                .select("clientes(vendedor_id)")
                .eq("id", comp.pedido_id)
                .single()
              viajanteId = (pedidoData?.clientes as any)?.vendedor_id ?? null
            }

            if (viajanteId && items?.length) {
              const { data: vendedor } = await supabase
                .from("vendedores")
                .select("comision_limpieza_bazar, comision_perfumeria_0, comision_perfumeria_plus")
                .eq("id", viajanteId)
                .single()

              const metodo = ["PRES", "REV"].includes(comp?.tipo_comprobante ?? "") ? "presupuesto" : "factura"

              const cobradas = (items ?? [])
                .filter((item: any) => item.articulos?.segmento_precio && vendedor)
                .map((item: any) => {
                  const { segmento_precio, iva_ventas } = item.articulos
                  const porcentaje = getComisionPorcentaje(vendedor!, segmento_precio, iva_ventas)
                  const precioNeto = getPrecioNeto(Number(item.precio_unitario), metodo, iva_ventas)
                  return {
                    viajante_id: viajanteId,
                    pedido_id: comp?.pedido_id ?? null,
                    comprobante_venta_id: imp.comprobante_id,
                    tipo: "cobrada",
                    articulo_id: item.articulo_id,
                    segmento: segmento_precio,
                    cantidad: Number(item.cantidad),
                    precio_neto_unitario: precioNeto,
                    porcentaje,
                    monto: (precioNeto * Number(item.cantidad) * porcentaje) / 100,
                    comprobante_cobrado: true,
                    fecha_comprobante_cobrado: nowArgentina(),
                    pagado: false,
                  }
                })
                .filter((c: any) => c.porcentaje > 0)

              if (cobradas.length) {
                await supabase.from("comisiones").insert(cobradas)
              }

              // Movimiento en billetera del viajante
              await supabase.from("billetera_movimientos").insert({
                viajante_id: viajanteId,
                tipo: "cobro_cliente",
                monto: Number(imp.monto_imputado),
                concepto: `Cobro ${comp?.tipo_comprobante ?? "comprobante"}`,
                referencia_id: pago.id,
                referencia_tipo: "pago_cliente",
                fecha: nowArgentina(),
              })
            }

            // Marcar comisiones 'vendida' del pedido como comprobante_cobrado para consulta
            await supabase
              .from("comisiones")
              .update({ comprobante_cobrado: true, fecha_comprobante_cobrado: nowArgentina() })
              .eq("comprobante_venta_id", imp.comprobante_id)
              .eq("tipo", "vendida")
              .eq("comprobante_cobrado", false)

            // Registrar cobrador_id en kardex para trazabilidad
            await supabase
              .from("kardex")
              .update({ cobrador_id: auth.user.id })
              .eq("comprobante_venta_id", imp.comprobante_id)
              .is("cobrador_id", null)
          } catch (comErr) {
            console.error("Error creando comisiones cobradas:", comErr)
          }
        }

        // Confirmar o crear la imputación
        if (imp.id) {
          await supabase.from("imputaciones").update({ estado: "confirmado" }).eq("id", imp.id)
        } else {
          await supabase.from("imputaciones").insert({
            pago_id: id,
            comprobante_id: imp.comprobante_id,
            tipo_comprobante: "venta",
            monto_imputado: imp.monto_imputado,
            estado: "confirmado",
          })
        }
      }

      return NextResponse.json({
        success: true,
        mensaje: "Pago confirmado e imputado exitosamente",
      })
    } else if (accion === "rechazar") {
      const { error: updateError } = await supabase
        .from("pagos_clientes")
        .update({
          estado: "rechazado",
          confirmado_por: usuario_confirmador,
          fecha_confirmacion: nowArgentina(),
          motivo_rechazo,
        })
        .eq("id", id)

      if (updateError) throw updateError

      // Eliminar imputaciones pendientes
      await supabase.from("imputaciones").delete().eq("pago_id", id).eq("estado", "pendiente")

      return NextResponse.json({
        success: true,
        mensaje: "Pago rechazado",
      })
    } else {
      return NextResponse.json({ error: 'Acción inválida. Use "confirmar" o "rechazar"' }, { status: 400 })
    }
  } catch (error: any) {
    console.error("[v0] Error confirmando/rechazando pago:", error)
    return NextResponse.json({ error: error.message || "Error procesando pago" }, { status: 500 })
  }
}
