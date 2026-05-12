import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { nowArgentina, todayArgentina } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'

/**
 * Genera Notas de Débito (NDA/NDB/NDC) para ventas.
 * No afectan stock. Incrementan lo que el cliente debe (CC-debe).
 * Usos: cheque rechazado, diferencia de precio, recargo por mora.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { cookies: { get(name: string) { return cookieStore.get(name)?.value } } },
    )

    const body = await request.json()
    const {
      cliente_id,
      tipo_comprobante, // 'NDA'|'NDB'|'NDC'|'auto'
      concepto,         // descripción del cargo
      items,            // [{ descripcion, cantidad?, precio_unitario_neto, iva_pct? }]
      pedido_id,
    } = body

    if (!cliente_id || !concepto || !items?.length) {
      return NextResponse.json({ error: 'cliente_id, concepto e items son requeridos' }, { status: 400 })
    }

    const { data: cliente, error: clError } = await supabase
      .from('clientes')
      .select('id, nombre_razon_social, nombre, condicion_iva, exento_iva, vendedor_id, provincia')
      .eq('id', cliente_id)
      .single()

    if (clError || !cliente) {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
    }

    let tipoFinal = tipo_comprobante
    if (!tipoFinal || tipoFinal === 'auto') {
      const condicion = (cliente.condicion_iva ?? '').toLowerCase()
      if (condicion.includes('responsable inscripto')) {
        tipoFinal = 'NDA'
      } else if (condicion.includes('monotributo')) {
        tipoFinal = 'NDB'
      } else {
        tipoFinal = 'NDC'
      }
    }

    const { data: numeracion, error: numError } = await supabase
      .from('numeracion_comprobantes')
      .select('*')
      .eq('tipo_comprobante', tipoFinal)
      .eq('punto_venta', '0001')
      .single()

    if (numError || !numeracion) {
      return NextResponse.json(
        { error: `No hay numeración configurada para ${tipoFinal}. Agregue una fila en numeracion_comprobantes.` },
        { status: 500 },
      )
    }

    const nuevoNumero = numeracion.ultimo_numero + 1
    const numeroComprobante = `${numeracion.punto_venta}-${nuevoNumero.toString().padStart(8, '0')}`

    // Calcular totales
    let totalNeto = 0
    let totalIva = 0

    const itemsCalculados = items.map((item: any) => {
      const qty = Number(item.cantidad ?? 1)
      const precioNeto = Number(item.precio_unitario_neto ?? 0)
      const ivaPct = Number(item.iva_pct ?? (cliente.exento_iva ? 0 : 21))
      const subtotalNeto = qty * precioNeto
      const subtotalIva = subtotalNeto * (ivaPct / 100)
      totalNeto += subtotalNeto
      totalIva += subtotalIva
      return { qty, precioNeto, ivaPct, subtotalNeto, subtotalIva, descripcion: item.descripcion ?? concepto, articulo_id: item.articulo_id ?? null }
    })

    const totalComprobante = totalNeto + totalIva

    const { data: comprobante, error: compError } = await supabase
      .from('comprobantes_venta')
      .insert({
        tipo_comprobante: tipoFinal,
        numero_comprobante: numeroComprobante,
        punto_venta: numeracion.punto_venta,
        fecha: todayArgentina(),
        cliente_id,
        pedido_id: pedido_id ?? null,
        total_neto: totalNeto,
        total_iva: totalIva,
        total_factura: totalComprobante,
        saldo_pendiente: totalComprobante,
        estado_pago: 'pendiente',
        observaciones: concepto,
      })
      .select()
      .single()

    if (compError) {
      return NextResponse.json({ error: 'Error creando comprobante: ' + compError.message }, { status: 500 })
    }

    const detalleInserts = itemsCalculados.map((item: any) => ({
      comprobante_id: comprobante.id,
      articulo_id: item.articulo_id,
      descripcion: item.descripcion,
      cantidad: item.qty,
      precio_unitario: item.precioNeto,
      precio_total: item.subtotalNeto + item.subtotalIva,
    }))

    const { error: detError } = await supabase.from('comprobantes_venta_detalle').insert(detalleInserts)
    if (detError) {
      return NextResponse.json({ error: 'Error creando detalle: ' + detError.message }, { status: 500 })
    }

    await supabase
      .from('numeracion_comprobantes')
      .update({ ultimo_numero: nuevoNumero })
      .eq('tipo_comprobante', tipoFinal)
      .eq('punto_venta', numeracion.punto_venta)

    // CC: el cliente debe más
    await supabase.from('cuenta_corriente_ajustes').insert({
      cliente_id,
      tipo_movimiento: 'debe',
      tipo_comprobante: tipoFinal,
      numero_comprobante: numeroComprobante,
      monto: totalComprobante,
      fecha: todayArgentina(),
      concepto: 'Nota de Débito',
      descripcion: concepto,
    })

    return NextResponse.json({
      success: true,
      comprobante: {
        id: comprobante.id,
        tipo: tipoFinal,
        numero: numeroComprobante,
        total: totalComprobante,
        total_neto: totalNeto,
        total_iva: totalIva,
      },
    })
  } catch (err: any) {
    console.error('[ND] Error generando nota de débito:', err)
    return NextResponse.json({ error: err.message || 'Error generando nota de débito' }, { status: 500 })
  }
}
