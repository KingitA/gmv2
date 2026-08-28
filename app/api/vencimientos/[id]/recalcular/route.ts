import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth, getUserRoles } from '@/lib/auth'
import { esAdmin, esTipoReservado } from '@/lib/finanzas/tipos-reservados'

/**
 * POST /api/vencimientos/[id]/recalcular — re-aplica el acuerdo de pago de la
 * ficha del proveedor a un vencimiento ya creado (típico: se validó el
 * comprobante antes de configurar la ficha). Recalcula forma de pago,
 * modalidad, fecha de vencimiento y validez de cheques según el canal.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { id } = await params
  try {
    const supabase = createAdminClient()

    const { data: venc } = await supabase
      .from('vencimientos')
      .select('id, proveedor_id, tipo, canal, estado, fecha_vencimiento, referencia_id, referencia_tipo, orden_pago_id')
      .eq('id', id)
      .single()
    if (!venc) return NextResponse.json({ error: 'Vencimiento no encontrado' }, { status: 404 })
    // Sueldos / socios: solo admin (para el resto no existen)
    if (esTipoReservado(venc.tipo) && !esAdmin(await getUserRoles(auth.user.id))) {
      return NextResponse.json({ error: 'Vencimiento no encontrado' }, { status: 404 })
    }
    if (venc.estado !== 'pendiente') {
      return NextResponse.json({ error: 'Solo se recalculan vencimientos pendientes' }, { status: 400 })
    }
    if (!venc.proveedor_id) {
      return NextResponse.json({ error: 'El vencimiento no tiene proveedor — no hay ficha para aplicar' }, { status: 400 })
    }
    if (venc.orden_pago_id) {
      return NextResponse.json({ error: 'El vencimiento ya está asociado a una orden de pago' }, { status: 400 })
    }

    // Resolver el comprobante de origen (para fecha de factura / recepción)
    let comprobanteId: string | null = null
    if (venc.referencia_tipo === 'comprobante_compra') {
      comprobanteId = venc.referencia_id
    } else if (venc.referencia_tipo === 'cuenta_corriente' && venc.referencia_id) {
      const { data: cc } = await supabase
        .from('cuenta_corriente_proveedores')
        .select('referencia_id, referencia_tipo')
        .eq('id', venc.referencia_id)
        .maybeSingle()
      if (cc?.referencia_tipo === 'comprobante_compra') comprobanteId = cc.referencia_id
    }

    let comprobante: any = null
    if (comprobanteId) {
      const { data } = await supabase
        .from('comprobantes_compra')
        .select('id, tipo_comprobante, fecha_comprobante, orden_compra_id')
        .eq('id', comprobanteId)
        .maybeSingle()
      comprobante = data
    }

    const canal = venc.canal
      || (comprobante?.tipo_comprobante === 'Adquisicion' ? 'negro' : 'blanco')

    const { data: prov } = await supabase
      .from('proveedores')
      .select('dias_vencimiento, pago_blanco_medio, pago_blanco_plazo_cheque, pago_blanco_entrega, pago_blanco_dias, pago_blanco_desde, pago_negro_medio, pago_negro_plazo_cheque, pago_negro_entrega, pago_negro_dias, pago_negro_desde')
      .eq('id', venc.proveedor_id)
      .maybeSingle()
    const p: any = prov || {}
    const cfg = canal === 'negro' && (p.pago_negro_medio || p.pago_negro_dias != null || p.pago_negro_entrega)
      ? { medio: p.pago_negro_medio, plazoCheque: p.pago_negro_plazo_cheque, entrega: p.pago_negro_entrega, dias: p.pago_negro_dias, desde: p.pago_negro_desde }
      : { medio: p.pago_blanco_medio, plazoCheque: p.pago_blanco_plazo_cheque, entrega: p.pago_blanco_entrega, dias: p.pago_blanco_dias, desde: p.pago_blanco_desde }

    if (!cfg.medio && cfg.dias == null && !cfg.entrega) {
      return NextResponse.json({ error: 'La ficha del proveedor no tiene acuerdo de pago configurado' }, { status: 400 })
    }

    const formaPago = cfg.medio === 'transferencia' ? 'transferencia'
      : cfg.medio === 'efectivo' ? 'efectivo'
      : (cfg.medio === 'cheques' || cfg.medio === 'cheques_y_efectivo') ? 'cheque'
      : null
    const modalidad = cfg.entrega === 'deposito_bancario' ? 'deposito'
      : cfg.entrega === 'retira_oficina' ? 'entrega'
      : cfg.entrega === 'envio_grimar' ? 'grimar'
      : null

    // Fecha: si la ficha define plazo (incluido 0 = contado), manda la ficha;
    // si no, se conserva la fecha actual del vencimiento.
    let fechaVencimiento: string = venc.fecha_vencimiento
    if (cfg.dias != null || Number(p.dias_vencimiento ?? 0) > 0) {
      let fechaBase: string | null = comprobante?.fecha_comprobante
        ? String(comprobante.fecha_comprobante).slice(0, 10)
        : null
      if (cfg.desde === 'recepcion' && comprobante?.orden_compra_id) {
        const { data: rec } = await supabase
          .from('recepciones')
          .select('fecha_fin, fecha_inicio, created_at')
          .eq('orden_compra_id', comprobante.orden_compra_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const f = (rec as any)?.fecha_fin || (rec as any)?.fecha_inicio || (rec as any)?.created_at
        if (f) fechaBase = String(f).slice(0, 10)
      }
      const dias = Number(cfg.dias ?? p.dias_vencimiento ?? 0)
      if (fechaBase) {
        const base = new Date(fechaBase + 'T00:00:00')
        base.setDate(base.getDate() + dias)
        fechaVencimiento = base.toISOString().slice(0, 10)
      }
    }

    let fechaValidez: string | null = null
    if (formaPago === 'cheque' && Number(cfg.plazoCheque ?? 0) > 0) {
      const v = new Date(fechaVencimiento + 'T00:00:00')
      v.setDate(v.getDate() + Number(cfg.plazoCheque))
      fechaValidez = v.toISOString().slice(0, 10)
    }

    const { error: updErr } = await supabase
      .from('vencimientos')
      .update({
        canal,
        forma_pago: formaPago,
        modalidad,
        fecha_vencimiento: fechaVencimiento,
        fecha_validez: fechaValidez,
      })
      .eq('id', id)
    if (updErr) throw updErr

    if (comprobante && fechaVencimiento !== venc.fecha_vencimiento) {
      await supabase.from('comprobantes_compra')
        .update({ fecha_vencimiento: fechaVencimiento })
        .eq('id', comprobante.id)
    }

    return NextResponse.json({
      success: true,
      canal,
      forma_pago: formaPago,
      modalidad,
      fecha_vencimiento: fechaVencimiento,
      fecha_validez: fechaValidez,
    })
  } catch (error: any) {
    console.error('[vencimientos/recalcular] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
