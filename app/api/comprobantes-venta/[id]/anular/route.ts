import { createAdminClient } from '@/lib/supabase/admin'
import { generarYSubirPDF, buildPDFData, generarQRBase64, buildQRUrl, buildSnapshot } from '@/lib/pdf/generar'
import { NextResponse } from 'next/server'
import { todayArgentina, nowArgentina } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import {
  TIPO_INVERSO,
  ORIGINAL_DECREMENTO_STOCK,
  CC_MOVIMIENTO,
  leyendaAnulacion,
} from '@/lib/comprobantes/anular'
import { REQUIERE_CAE, TIPO_CBTE_ARCA, DOC_TIPO, CONCEPTO, IVA_ID, TRIBUTO_ID, condicionIvaReceptorId, type AmbienteARCA } from '@/lib/arca/tipos'
import { TASA_PERCEPCION_IVA } from '@/lib/comprobantes/calcular-percepciones'
import { registrarCAEObtenido, marcarComprobanteCreado, marcarHuerfano, mensajeHuerfano } from '@/lib/arca/registro-cae'
import { obtenerTAConCache } from '@/lib/arca/cache'
import { ultimoAutorizado, solicitarCAE } from '@/lib/arca/wsfev1'

function r2(n: number): number { return Math.round(n * 100) / 100 }

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { id } = await params
    const supabase = createAdminClient()

    // ─── 1. Cargar comprobante original ───
    const { data: original, error: origErr } = await supabase
      .from('comprobantes_venta')
      .select(`
        *,
        cliente:clientes!comprobantes_venta_cliente_id_fkey(
          id, nombre_razon_social, nombre, cuit, condicion_iva, exento_iva, exento_iibb, percepcion_iibb, vendedor_id, provincia, direccion, localidad_id
        ),
        detalle:comprobantes_venta_detalle(*)
      `)
      .eq('id', id)
      .single()

    if (origErr || !original) {
      return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 })
    }

    // ─── 2. Validaciones ───
    if (original.anulado_en) {
      return NextResponse.json({
        error: 'Este comprobante ya fue anulado. No se puede volver a anular.',
        error_code: 'YA_ANULADO',
      }, { status: 422 })
    }

    const tipoInverso = TIPO_INVERSO[original.tipo_comprobante]
    if (!tipoInverso) {
      return NextResponse.json({
        error: `El tipo de comprobante "${original.tipo_comprobante}" no se puede anular.`,
      }, { status: 422 })
    }

    if (!original.cliente?.cuit) {
      return NextResponse.json({
        error: 'El cliente no tiene CUIT registrado. No se puede generar el comprobante inverso.',
      }, { status: 422 })
    }

    // ─── 3. Determinar punto de venta ───
    const esFiscal = REQUIERE_CAE.has(tipoInverso)

    const { data: empresaConfig } = await supabase
      .from('configuracion_empresa')
      .select('cuit, arca_ambiente, arca_punto_venta')
      .single()

    if (esFiscal && !empresaConfig?.arca_punto_venta) {
      return NextResponse.json(
        { error: 'configuracion_empresa.arca_punto_venta no está configurado. No se puede emitir el comprobante inverso fiscal.' },
        { status: 500 },
      )
    }
    const puntoVenta = esFiscal && empresaConfig
      ? String(empresaConfig.arca_punto_venta).padStart(4, '0')
      : original.punto_venta  // PRES/REV usan el mismo PV que el original

    // ─── 4. Obtener numeración y sincronizar con ARCA ───
    const { data: numeracion, error: numErr } = await supabase
      .from('numeracion_comprobantes')
      .select('*')
      .eq('tipo_comprobante', tipoInverso)
      .eq('punto_venta', puntoVenta)
      .single()

    if (numErr || !numeracion) {
      return NextResponse.json({
        error: `No hay numeración configurada para ${tipoInverso} en punto de venta ${puntoVenta}.`,
      }, { status: 500 })
    }

    let nuevoNumero = numeracion.ultimo_numero + 1

    // ─── 5. CAE de ARCA si corresponde ───
    let cae: string | null = null
    let vencimientoCae: string | null = null

    const certDisponible = !!(process.env.ARCA_CERTIFICADO && process.env.ARCA_CLAVE_PRIVADA)

    // Bloqueo duro: un inverso fiscal sin CAE no existe. Si falta el certificado
    // o la config, se aborta — jamás crear la NC/ND espejo sin autorización.
    if (esFiscal && (!certDisponible || !empresaConfig)) {
      return NextResponse.json(
        {
          error: !certDisponible
            ? 'Certificado ARCA no configurado (ARCA_CERTIFICADO / ARCA_CLAVE_PRIVADA). No se puede anular con comprobante fiscal — avisá al administrador.'
            : 'configuracion_empresa no encontrada. No se puede emitir el comprobante inverso fiscal.',
          error_code: 'ARCA_NO_CONFIGURADO',
        },
        { status: 500 },
      )
    }

    if (esFiscal && certDisponible && empresaConfig) {
      const ambiente = (empresaConfig.arca_ambiente ?? 'produccion') as AmbienteARCA
      const ta = await obtenerTAConCache(supabase, ambiente)
      const cuitEmpresa = (empresaConfig.cuit ?? '').replace(/-/g, '')
      const cbteTipo = TIPO_CBTE_ARCA[tipoInverso]

      // Sincronizar con ARCA
      const ultimoEnArca = await ultimoAutorizado(
        ambiente, ta.token, ta.sign, cuitEmpresa,
        parseInt(puntoVenta, 10), cbteTipo,
      )
      if (ultimoEnArca !== numeracion.ultimo_numero) {
        await supabase
          .from('numeracion_comprobantes')
          .update({ ultimo_numero: ultimoEnArca })
          .eq('tipo_comprobante', tipoInverso)
          .eq('punto_venta', puntoVenta)
        nuevoNumero = ultimoEnArca + 1
      }

      // Solicitar CAE con referencia al comprobante original
      const clienteCuit = original.cliente.cuit.replace(/-/g, '')
      const fecha = todayArgentina().replace(/-/g, '')

      // RG 5616/2024: condición IVA del receptor obligatoria
      const condIvaReceptor = condicionIvaReceptorId(original.cliente.condicion_iva)
      if (condIvaReceptor === null) {
        return NextResponse.json({
          error: `El cliente "${original.cliente.nombre_razon_social ?? ''}" tiene condición de IVA "${original.cliente.condicion_iva ?? 'sin cargar'}" que no mapea a ningún código de receptor de ARCA (RG 5616). Corregí la condición de IVA del cliente antes de anular.`,
          error_code: 'CONDICION_IVA_NO_MAPEA',
        }, { status: 422 })
      }

      // Los montos del inverso siempre positivos para ARCA (el tipo ya indica si es NC/ND)
      // Espejo exacto de la factura original: neto, IVA y percepciones (tributos)
      const impNeto   = r2(Math.abs(original.total_neto))
      const impIva    = r2(Math.abs(original.total_iva ?? 0))
      const percIvaA  = r2(Math.abs(original.percepcion_iva  ?? 0))
      const percIibbA = r2(Math.abs(original.percepcion_iibb ?? 0))
      const impTrib   = r2(percIvaA + percIibbA)
      // ImpTotal debe ser exactamente ImpNeto + ImpIVA + ImpTrib (validación ARCA)
      const impTotal  = (
        Math.round(impNeto * 100) +
        Math.round(impIva  * 100) +
        Math.round(impTrib * 100)
      ) / 100

      const tributos = []
      if (percIvaA > 0) {
        tributos.push({ id: TRIBUTO_ID.PERCEPCION_IVA, desc: 'Percepcion IVA RG 5329', baseImp: impNeto, alic: TASA_PERCEPCION_IVA, importe: percIvaA })
      }
      if (percIibbA > 0) {
        tributos.push({ id: TRIBUTO_ID.PERCEPCION_IIBB, desc: 'Percepcion IIBB', baseImp: impNeto, alic: Number(original.cliente.percepcion_iibb ?? 0), importe: percIibbA })
      }

      const respCAE = await solicitarCAE({
        ambiente,
        token:    ta.token,
        sign:     ta.sign,
        cuit:     cuitEmpresa,
        ptoVta:   parseInt(puntoVenta, 10),
        cbteTipo,
        cbteDesde: nuevoNumero,
        cbteHasta: nuevoNumero,
        concepto:  CONCEPTO.PRODUCTOS,
        docTipo:   DOC_TIPO.CUIT,
        docNro:    clienteCuit,
        fecha,
        impTotal,
        impTotConc: 0,
        impNeto,
        impOpEx:    0,
        impIva,
        impTrib,
        iva: impIva > 0
          ? [{ id: IVA_ID.IVA_21, baseImp: impNeto, importe: impIva }]
          : [{ id: IVA_ID.EXENTO,  baseImp: impNeto, importe: 0 }],
        tributos: tributos.length > 0 ? tributos : undefined,
        // Referencia al comprobante original (RG 4540) — el PV sale del número
        // del comprobante original, sin defaults
        cbteAsoc: [{
          tipo:   TIPO_CBTE_ARCA[original.tipo_comprobante],
          ptoVta: parseInt(original.numero_comprobante.split('-')[0], 10),
          nro:    parseInt(original.numero_comprobante.split('-')[1], 10),
        }],
        condicionIVAReceptorId: condIvaReceptor,
      })

      cae            = respCAE.cae
      vencimientoCae = respCAE.vencimientoCae
    }

    const numeroComprobante = `${puntoVenta}-${nuevoNumero.toString().padStart(8, '0')}`

    // ─── 6. Calcular totales del inverso ───
    // NC/REV: totales negativos (crédito para el cliente)
    // ND/PRES-inverso: totales positivos (débito para el cliente)
    const esCredito = ['NCA', 'NCB', 'REV'].includes(tipoInverso)
    const signo     = esCredito ? -1 : 1

    const totalNeto    = r2(signo * Math.abs(original.total_neto))
    const totalIva     = r2(signo * Math.abs(original.total_iva    ?? 0))
    const percIva      = r2(signo * Math.abs(original.percepcion_iva  ?? 0))
    const percIibb     = r2(signo * Math.abs(original.percepcion_iibb ?? 0))
    const totalFactura = r2(signo * Math.abs(original.total_factura))

    const leyenda = leyendaAnulacion(original.numero_comprobante, original.fecha)

    // ─── 7. Crear comprobante inverso ───
    const inversoInsert = {
      tipo_comprobante:             tipoInverso,
      numero_comprobante:           numeroComprobante,
      punto_venta:                  puntoVenta,
      fecha:                        todayArgentina(),
      cliente_id:                   original.cliente_id,
      pedido_id:                    original.pedido_id ?? null,
      total_neto:                   totalNeto,
      total_iva:                    totalIva,
      percepcion_iva:               percIva,
      percepcion_iibb:              percIibb,
      total_factura:                totalFactura,
      saldo_pendiente:              totalFactura,
      estado_pago:                  'pendiente',
      motivo_ajuste:                'Anulación',
      observaciones:                leyenda,
      comprobantes_relacionados_ids: [original.id],
      creado_por:                   auth.user.id,
      ...(cae            ? { cae }                             : {}),
      ...(vencimientoCae ? { vencimiento_cae: vencimientoCae } : {}),
    }

    // ─── 8. Detalle espejo (armado antes del insert, para el registro de CAE) ───
    // cantidad y precio_total se INVIERTEN (×−1) para que SUM(detalle.precio_total)
    // == total_neto del inverso — la misma invariante que cumplen generar,
    // generar-nd y generar-nc-reversa. precio_unitario CONSERVA su signo original:
    // el template lo usa para distinguir líneas de bonificación (pu < 0) de ítems
    // normales, en el espejo igual que en la factura.
    const detallePayload = original.detalle.map((d: any) => ({
      articulo_id:     d.articulo_id,
      descripcion:     d.descripcion,
      cantidad:        -d.cantidad,
      precio_unitario: d.precio_unitario,
      precio_total:    r2(-d.precio_total),
    }))

    const logId = cae ? await registrarCAEObtenido(supabase, {
      tipo: tipoInverso, puntoVenta, numero: numeroComprobante,
      cae, vencimientoCae, importe: Math.abs(totalFactura),
      clienteCuit: original.cliente.cuit ?? null,
      payload: { comprobante: inversoInsert, detalle: detallePayload },
    }) : null

    const { data: inverso, error: invErr } = await supabase
      .from('comprobantes_venta')
      .insert(inversoInsert)
      .select('id')
      .single()

    if (invErr || !inverso) {
      if (cae) {
        await marcarHuerfano(supabase, logId, invErr?.message ?? 'insert sin resultado')
        throw new Error(mensajeHuerfano(tipoInverso, numeroComprobante, cae))
      }
      throw new Error('Error creando comprobante inverso: ' + invErr?.message)
    }

    await marcarComprobanteCreado(supabase, logId, inverso.id)

    const detalleInserts = detallePayload.map((d: any) => ({ ...d, comprobante_id: inverso.id }))

    if (detalleInserts.length > 0) {
      const { error: detErr } = await supabase
        .from('comprobantes_venta_detalle')
        .insert(detalleInserts)
      if (detErr) throw new Error('Error creando detalle inverso: ' + detErr.message)
    }

    // ─── 9. Marcar original como anulado ───
    await supabase
      .from('comprobantes_venta')
      .update({
        anulado_en:                   nowArgentina(),
        comprobantes_relacionados_ids: [...(original.comprobantes_relacionados_ids ?? []), inverso.id],
      })
      .eq('id', original.id)

    // ─── 10. Avanzar numeración ───
    await supabase
      .from('numeracion_comprobantes')
      .update({ ultimo_numero: nuevoNumero })
      .eq('tipo_comprobante', tipoInverso)
      .eq('punto_venta', puntoVenta)

    // ─── 11. Stock: si el original decrementó stock, lo recuperamos ───
    if (ORIGINAL_DECREMENTO_STOCK.has(original.tipo_comprobante)) {
      for (const d of original.detalle) {
        const cantidad = Math.abs(d.cantidad)
        if (cantidad <= 0) continue

        await supabase.rpc('increment_stock_actual', {
          p_articulo_id: d.articulo_id,
          p_cantidad:    cantidad,   // positivo = entrada de stock
        }).then(() => {})

        await supabase.from('movimientos_stock').insert({
          articulo_id:     d.articulo_id,
          tipo_movimiento: 'entrada',
          cantidad,
          precio_unitario: Math.abs(d.precio_unitario),
          fecha_movimiento: nowArgentina(),
          observaciones:   `Anulación ${tipoInverso} ${numeroComprobante} → ${original.numero_comprobante}`,
          comprobante_venta_detalle_id: d.id,
        })
      }
    }

    // ─── 12. CC: el comprobante inverso postea al libro mayor ───
    // Por SIGNO de total_factura (misma fórmula que el backfill) → consistente
    // entre runtime y reconciliación. Reemplaza cuenta_corriente_ajustes.
    const ccMovimiento = CC_MOVIMIENTO[tipoInverso]
    if (ccMovimiento) {
      const tf = Number(totalFactura)
      const { error: ccError } = await supabase.rpc('cc_postear', {
        p_cliente_id:         original.cliente_id,
        p_tipo_movimiento:    tipoInverso.startsWith('NC') || tipoInverso === 'REV' ? 'nota_credito' : 'nota_debito',
        p_debe:               Math.max(tf, 0),
        p_haber:              Math.max(-tf, 0),
        p_referencia_tipo:    'comprobante_venta',
        p_referencia_id:      inverso.id,
        p_numero_comprobante: numeroComprobante,
        p_observaciones:      `Anulación ${tipoInverso} ${numeroComprobante} → ${original.numero_comprobante}`,
        p_usuario_id:         auth.user.id,
      })
      if (ccError) console.error('[cc_postear] anulación', inverso.id, ccError.message)
    }

    // ─── 13. Comisiones negativas si el original tenía comisión ───
    try {
      const { data: comisiones } = await supabase
        .from('comisiones')
        .select('id, monto, porcentaje, viajante_id, articulo_id, segmento, cantidad, precio_neto_unitario')
        .eq('pedido_id', original.pedido_id ?? '')
        .eq('comprobante_venta_id', original.id)

      if (comisiones && comisiones.length > 0) {
        const negativas = comisiones.map((c: any) => ({
          viajante_id:              c.viajante_id,
          pedido_id:                original.pedido_id,
          comprobante_venta_id:     inverso.id,
          tipo:                     'cobrada',
          articulo_id:              c.articulo_id,
          segmento:                 c.segmento,
          cantidad:                 -(Math.abs(c.cantidad ?? 0)),
          precio_neto_unitario:     c.precio_neto_unitario,
          porcentaje:               c.porcentaje,
          monto:                    -(Math.abs(c.monto)),
          comprobante_cobrado:      false,
          pagado:                   false,
        }))
        await supabase.from('comisiones').insert(negativas)
      }
    } catch (e) {
      console.error('[Anular] Error revirtiendo comisiones:', e)
    }

    // ─── PDF del comprobante inverso (con QR de ARCA) ───
    try {
      const { data: empresaData } = await supabase.from('configuracion_empresa').select('*').single()
      const { data: marcasTbl }   = await supabase.from('marcas').select('id, descripcion').eq('activo', true)
      const marcaDesc = new Map((marcasTbl ?? []).map((m: any) => [m.id, m.descripcion ?? '']))

      let qrDataUrl: string | undefined
      let qrUrl: string | undefined
      if (cae && original.cliente?.cuit) {
        try {
          const qrParams = {
            cuit:       empresaData?.cuit ?? '',
            ptoVta:     puntoVenta,
            tipoCmp:    tipoInverso,
            nroCmp:     numeroComprobante,
            importe:    Math.abs(totalFactura),
            fecha:      todayArgentina(),
            tipoDocRec: 80,
            nroDocRec:  original.cliente.cuit,
            cae,
          }
          qrUrl     = buildQRUrl(qrParams)
          qrDataUrl = await generarQRBase64(qrParams)
        } catch (qrErr: any) {
          console.error('[Anular QR] Error generando QR:', qrErr.message)
        }
      }

      const pdfData = buildPDFData({
        comprobante: {
          id:                  inverso.id,
          tipo_comprobante:    tipoInverso,
          numero_comprobante:  numeroComprobante,
          fecha:               todayArgentina(),
          total_neto:          totalNeto,
          total_iva:           totalIva,
          percepcion_iva:      percIva,
          percepcion_iibb:     percIibb,
          total_factura:       totalFactura,
          cae,
          vencimiento_cae:     vencimientoCae,
          observaciones:       leyenda,
        },
        cliente:        original.cliente,
        empresa:        empresaData,
        detalle:        detalleInserts.map((d: any, i: number) => ({
          ...d,
          articulo_id:     original.detalle[i]?.articulo_id,
          articulos: { descripcion: d.descripcion, sku: '' },
        })),
        marcaDesc,
        qrDataUrl,
      })

      const { pdfUrl, pdfPath, pdfHash } = await generarYSubirPDF(supabase, pdfData)
      const snapshot = buildSnapshot(pdfData)

      await supabase.from('comprobantes_venta').update({
        pdf_url:              pdfUrl,
        pdf_path:             pdfPath,
        pdf_hash:             pdfHash,
        fecha_generacion_pdf: new Date().toISOString(),
        estado_pdf:           'generado',
        pdf_snapshot:         snapshot,
        qr_url:               qrUrl ?? null,
      }).eq('id', inverso.id)
    } catch (pdfErr: any) {
      console.error('[Anular PDF] Error generando PDF del inverso:', pdfErr.message)
      await supabase.from('comprobantes_venta').update({ estado_pdf: 'error' }).eq('id', inverso.id).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      inverso: {
        id:              inverso.id,
        tipo_comprobante: tipoInverso,
        numero:           numeroComprobante,
        total:            totalFactura,
        cae:              cae ?? null,
        vencimiento_cae:  vencimientoCae ?? null,
      },
    })
  } catch (error: any) {
    console.error('[Anular Comprobante] Error:', error)
    return NextResponse.json({ error: error.message || 'Error anulando comprobante' }, { status: 500 })
  }
}
