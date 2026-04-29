import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const estado = searchParams.get("estado") || "pendiente"

    const { data: pagos, error } = await supabase
      .from("pagos_clientes")
      .select(
        `
        *,
        clientes(nombre, razon_social),
        vendedor:usuarios!pagos_clientes_vendedor_id_fkey(nombre)
      `
      )
      .eq("estado", estado)
      .order("created_at", { ascending: false })

    if (error) throw error

    // Obtener detalle de cada pago (formas de pago)
    const pagosConDetalle = await Promise.all(
      (pagos || []).map(async (pago) => {
        const { data: detalles } = await supabase.from("pagos_detalle").select("*").eq("pago_id", pago.id)

        return {
          ...pago,
          detalles: detalles || [],
        }
      })
    )

    return NextResponse.json(pagosConDetalle)
  } catch (error: any) {
    console.error("[v0] Error obteniendo pagos:", error)
    return NextResponse.json({ error: error.message || "Error obteniendo pagos" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()

    const {
      cliente_id,
      vendedor_id,
      viaje_id, // Nuevo campo
      pedido_id, // Nuevo campo opcional para vincular al pedido específico
      fecha_pago,
      observaciones,
      detalles, // [{ tipo_pago, monto, numero_cheque?, banco?, fecha_cheque? }]
      imputaciones, // [{ comprobante_id, monto_imputado }] - opcional
      pagos, // Alias para detalles desde el frontend nuevo
      documentos_imputados, // Alias para imputaciones desde el frontend nuevo
    } = body

    // Normalizar datos
    const listaDetalles = detalles || pagos?.map((p: any) => ({
      tipo_pago: p.tipo,
      monto: p.monto,
      numero_cheque: p.detalles?.numero_cheque,
      banco: p.detalles?.banco,
      fecha_cheque: p.detalles?.fecha_cheque,
      referencia: p.detalles?.referencia
    })) || []

    const listaImputaciones = imputaciones || documentos_imputados?.map((d: any) => ({
      comprobante_id: d.id,
      monto_imputado: d.monto,
      tipo_documento: d.tipo
    })) || []

    // Validaciones
    if (!cliente_id || listaDetalles.length === 0) {
      return NextResponse.json({ error: "cliente_id y detalles son requeridos" }, { status: 400 })
    }

    // Calcular monto total
    const montoTotal = listaDetalles.reduce((sum: number, d: any) => sum + Number(d.monto), 0)

    if (montoTotal <= 0) {
      return NextResponse.json({ error: "El monto total debe ser mayor a 0" }, { status: 400 })
    }

    // Crear pago en estado pendiente
    // Intentamos guardar viaje_id si la columna existe
    const pagoData: any = {
      cliente_id,
      vendedor_id,
      monto: montoTotal,
      fecha_pago: fecha_pago || todayArgentina(),
      observaciones,
      estado: "pendiente",
    }

    if (viaje_id) pagoData.viaje_id = viaje_id
    if (pedido_id) pagoData.pedido_id = pedido_id

    const { data: pago, error: pagoError } = await supabase
      .from("pagos_clientes")
      .insert(pagoData)
      .select()
      .single()

    if (pagoError) throw pagoError

    // Crear detalles del pago (formas de pago)
    const detallesConPagoId = listaDetalles.map((d: any) => ({
      pago_id: pago.id,
      tipo_pago: d.tipo_pago,
      monto: d.monto,
      numero_cheque: d.numero_cheque || null,
      banco: d.banco || null,
      fecha_cheque: d.fecha_cheque || null,
      referencia: d.referencia || null,
    }))

    const { error: detallesError } = await supabase.from("pagos_detalle").insert(detallesConPagoId)

    if (detallesError) throw detallesError

    if (listaImputaciones.length > 0) {
      const imputacionesData = listaImputaciones.map((imp: any) => ({
        pago_id: pago.id,
        comprobante_id: imp.comprobante_id,
        tipo_comprobante: imp.tipo_documento || "venta",
        monto_imputado: imp.monto_imputado,
        estado: "confirmado",
      }))

      const { error: impError } = await supabase.from("imputaciones").insert(imputacionesData)
      if (impError) {
        console.error("[v0] Error guardando imputaciones:", impError)
      }

      // Aplicar cada imputación al saldo_pendiente del comprobante
      for (const imp of listaImputaciones) {
        if (!imp.comprobante_id) continue
        const { data: comp } = await supabase
          .from("comprobantes_venta")
          .select("saldo_pendiente")
          .eq("id", imp.comprobante_id)
          .single()
        if (!comp) continue
        const nuevoSaldo = Number(comp.saldo_pendiente) - Number(imp.monto_imputado)
        await supabase
          .from("comprobantes_venta")
          .update({
            saldo_pendiente: Math.max(0, nuevoSaldo),
            estado_pago: nuevoSaldo <= 0 ? "pagado" : "parcial",
          })
          .eq("id", imp.comprobante_id)
      }
    }

    // Marcar el pago como confirmado directamente
    await supabase.from("pagos_clientes").update({ estado: "confirmado" }).eq("id", pago.id)

    return NextResponse.json({
      success: true,
      pago,
      mensaje: "Pago registrado y aplicado.",
    })
  } catch (error: any) {
    console.error("[v0] Error registrando pago:", error)
    return NextResponse.json({ error: error.message || "Error registrando pago" }, { status: 500 })
  }
}
