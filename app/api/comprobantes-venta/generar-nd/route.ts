import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { nowArgentina, todayArgentina } from '@/lib/utils'
import { requireAuth } from '@/lib/auth'
import { determinarTipoNDA, mensajeErrorCondicionIva } from '@/lib/comprobantes/tipo-comprobante'
import { TIPO_CBTE_ARCA, DOC_TIPO, CONCEPTO, IVA_ID, TRIBUTO_ID, condicionIvaReceptorId, type AmbienteARCA } from "@/lib/arca/tipos"
import { obtenerTAConCache } from "@/lib/arca/cache"
import { ultimoAutorizado, solicitarCAE } from "@/lib/arca/wsfev1"
import { calcularPercepciones } from "@/lib/comprobantes/calcular-percepciones"
import { resolverAlicuotaIIBB } from "@/lib/comprobantes/percepcion-iibb"
import { generarYSubirPDF, buildPDFData, generarQRBase64, buildQRUrl, buildSnapshot } from "@/lib/pdf/generar"
import { registrarCAEObtenido, marcarComprobanteCreado, marcarHuerfano, mensajeHuerfano } from "@/lib/arca/registro-cae"

/**
 * Genera Notas de Débito (NDA/NDB) para ventas.
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
      tipo_comprobante, // 'NDA'|'NDB'|'auto'
      concepto,         // descripción del cargo
      items,            // [{ descripcion, cantidad?, precio_unitario_neto, iva_pct? }]
      pedido_id,
      asociados,        // [{ tipo: 'FA'|'FB'|..., numero: 'PPPP-NNNNNNNN' }] — comprobantes que ajusta (RG 4540)
      periodo,          // { desde: 'YYYY-MM-DD', hasta: 'YYYY-MM-DD' } — alternativa para mora/intereses
    } = body

    if (!cliente_id || !concepto || !items?.length) {
      return NextResponse.json({ error: 'cliente_id, concepto e items son requeridos' }, { status: 400 })
    }

    // ─── RG 4540: ND fiscal requiere comprobantes asociados O período asociado ───
    const cbteAsoc: { tipo: number; ptoVta: number; nro: number }[] = []
    for (const asoc of (asociados ?? [])) {
      const tipoArca = TIPO_CBTE_ARCA[asoc?.tipo]
      const partes   = String(asoc?.numero ?? '').trim().split('-')
      const ptoVta   = parseInt(partes[0], 10)
      const nro      = parseInt(partes[1] ?? '', 10)
      if (!tipoArca || isNaN(ptoVta) || isNaN(nro)) {
        return NextResponse.json({
          error: `Comprobante asociado inválido: "${asoc?.tipo ?? ''} ${asoc?.numero ?? ''}". Formato esperado: tipo FA/FB y número PPPP-NNNNNNNN (ej: FA 0007-00000123).`,
          error_code: 'ASOCIADO_INVALIDO',
        }, { status: 422 })
      }
      cbteAsoc.push({ tipo: tipoArca, ptoVta, nro })
    }

    let periodoAsoc: { desde: string; hasta: string } | undefined
    if (!cbteAsoc.length && periodo?.desde && periodo?.hasta) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodo.desde) || !/^\d{4}-\d{2}-\d{2}$/.test(periodo.hasta)) {
        return NextResponse.json({
          error: 'Período asociado inválido: desde y hasta deben ser YYYY-MM-DD.',
          error_code: 'PERIODO_INVALIDO',
        }, { status: 422 })
      }
      periodoAsoc = { desde: periodo.desde.replace(/-/g, ''), hasta: periodo.hasta.replace(/-/g, '') }
    }

    if (!cbteAsoc.length && !periodoAsoc) {
      return NextResponse.json({
        error: 'Una Nota de Débito fiscal requiere el/los comprobantes asociados que ajusta, o un período asociado (RG 4540). Ingresalos antes de emitir.',
        error_code: 'ND_SIN_ASOCIADO',
      }, { status: 422 })
    }

    const { data: cliente, error: clError } = await supabase
      .from('clientes')
      .select('id, nombre_razon_social, nombre, cuit, condicion_iva, exento_iva, exento_iibb, percepcion_iibb, vendedor_id, provincia, direccion, localidad_id')
      .eq('id', cliente_id)
      .single()

    if (clError || !cliente) {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
    }

    if (!cliente.cuit || cliente.cuit.trim() === '') {
      return NextResponse.json({
        error: `El cliente "${cliente.nombre_razon_social ?? cliente.nombre ?? ''}" no tiene CUIT configurado. Sin CUIT no se puede emitir un comprobante fiscal.`,
        error_code: 'CLIENTE_SIN_CUIT',
        cliente_id,
        cliente_nombre: cliente.nombre_razon_social ?? cliente.nombre,
      }, { status: 422 })
    }

    let tipoFinal = tipo_comprobante
    if (!tipoFinal || tipoFinal === 'auto') {
      const tipoND = determinarTipoNDA(cliente.condicion_iva)
      if (!tipoND) {
        return NextResponse.json({
          error: mensajeErrorCondicionIva(cliente.nombre_razon_social ?? cliente.nombre ?? ''),
          error_code: 'CLIENTE_SIN_CONDICION_IVA',
          cliente_id,
          cliente_nombre: cliente.nombre_razon_social ?? cliente.nombre,
        }, { status: 422 })
      }
      tipoFinal = tipoND
    }

    // ─── Configuración ARCA ───
    const { data: empresaConfig } = await supabase
      .from('configuracion_empresa')
      .select('*')
      .single()

    if (!empresaConfig?.arca_punto_venta) {
      return NextResponse.json(
        { error: 'configuracion_empresa.arca_punto_venta no está configurado. No se puede emitir la ND fiscal.' },
        { status: 500 },
      )
    }
    const puntoVenta = String(empresaConfig.arca_punto_venta).padStart(4, '0')

    const { data: numeracion, error: numError } = await supabase
      .from('numeracion_comprobantes')
      .select('*')
      .eq('tipo_comprobante', tipoFinal)
      .eq('punto_venta', puntoVenta)
      .single()

    if (numError || !numeracion) {
      return NextResponse.json(
        { error: `No hay numeración configurada para ${tipoFinal} PV ${puntoVenta}.` },
        { status: 500 },
      )
    }

    // ─── Calcular totales de ítems ───
    let totalNeto = 0
    let totalIva  = 0

    const itemsCalculados = items.map((item: any) => {
      const qty         = Number(item.cantidad ?? 1)
      const precioNeto  = Number(item.precio_unitario_neto ?? 0)
      // exento_iva es solo exclusión de PERCEPCIONES — el IVA de la operación es 21% siempre
      // (un receptor exento paga IVA sobre bienes gravados, solo que no computa el crédito)
      const ivaPct      = Number(item.iva_pct ?? 21)
      const subtotalNeto = qty * precioNeto
      const subtotalIva  = subtotalNeto * (ivaPct / 100)
      totalNeto += subtotalNeto
      totalIva  += subtotalIva
      return {
        qty, precioNeto, ivaPct, subtotalNeto, subtotalIva,
        descripcion: item.descripcion ?? concepto,
        articulo_id: item.articulo_id ?? null,
      }
    })
    totalNeto = Math.round(totalNeto * 100) / 100
    totalIva  = Math.round(totalIva  * 100) / 100

    // ─── Percepciones (IVA 3% RG 5329/2023 + IIBB según padrón) ───
    const esFiscal   = true // NDA/NDB siempre son fiscales
    const tasaIIBBResuelta = await resolverAlicuotaIIBB(supabase, cliente)
    const percResult = calcularPercepciones(totalNeto, { ...cliente, percepcion_iibb: tasaIIBBResuelta }, esFiscal)
    const percIVA    = percResult.percepcion_iva
    const percIIBB   = percResult.percepcion_iibb
    const totalTrib  = Math.round((percIVA + percIIBB) * 100) / 100
    const totalComprobante = (
      Math.round(totalNeto * 100) +
      Math.round(totalIva  * 100) +
      Math.round(totalTrib * 100)
    ) / 100

    // ─── Obtener TA y sincronizar numeración ───
    const ambiente    = (empresaConfig?.arca_ambiente ?? 'produccion') as AmbienteARCA
    const ta          = await obtenerTAConCache(supabase, ambiente)
    const cuitEmpresa = (empresaConfig?.cuit ?? '').replace(/-/g, '')
    const cbteTipo    = TIPO_CBTE_ARCA[tipoFinal]

    let nuevoNumero = numeracion.ultimo_numero + 1
    if (cbteTipo) {
      const ultimoEnArca = await ultimoAutorizado(
        ambiente, ta.token, ta.sign, cuitEmpresa, parseInt(puntoVenta, 10), cbteTipo,
      )
      if (ultimoEnArca !== numeracion.ultimo_numero) {
        await supabase.from('numeracion_comprobantes')
          .update({ ultimo_numero: ultimoEnArca })
          .eq('tipo_comprobante', tipoFinal)
          .eq('punto_venta', puntoVenta)
        nuevoNumero = ultimoEnArca + 1
      }
    }

    const numeroComprobante = `${puntoVenta}-${nuevoNumero.toString().padStart(8, '0')}`

    // ─── Solicitar CAE ───
    const clienteCuit = cliente.cuit.replace(/-/g, '')
    const fecha       = todayArgentina().replace(/-/g, '')

    // RG 5616/2024: condición IVA del receptor obligatoria
    const condIvaReceptor = condicionIvaReceptorId(cliente.condicion_iva)
    if (condIvaReceptor === null) {
      return NextResponse.json({
        error: `El cliente "${cliente.nombre_razon_social ?? cliente.nombre ?? ''}" tiene condición de IVA "${cliente.condicion_iva ?? 'sin cargar'}" que no mapea a ningún código de receptor de ARCA (RG 5616). Corregí la condición de IVA del cliente antes de emitir.`,
        error_code: 'CONDICION_IVA_NO_MAPEA',
      }, { status: 422 })
    }

    const tributos = []
    if (percIVA > 0) {
      tributos.push({ id: TRIBUTO_ID.PERCEPCION_IVA, desc: 'Percepcion IVA RG 5329', baseImp: totalNeto, alic: percResult.tasa_iva_aplicada, importe: percIVA })
    }
    if (percIIBB > 0) {
      tributos.push({ id: TRIBUTO_ID.PERCEPCION_IIBB, desc: 'Percepcion IIBB', baseImp: totalNeto, alic: percResult.tasa_iibb_aplicada, importe: percIIBB })
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
      impTotal:   totalComprobante,
      impTotConc: 0,
      impNeto:    totalNeto,
      impOpEx:    0,
      impIva:     totalIva,
      impTrib:    totalTrib,
      iva: totalIva > 0
        ? [{ id: IVA_ID.IVA_21, baseImp: totalNeto, importe: totalIva }]
        : [{ id: IVA_ID.EXENTO,  baseImp: totalNeto, importe: 0 }],
      tributos: tributos.length > 0 ? tributos : undefined,
      cbteAsoc: cbteAsoc.length > 0 ? cbteAsoc : undefined,
      periodoAsoc,
      condicionIVAReceptorId: condIvaReceptor,
    })

    const comprobanteInsert = {
      tipo_comprobante:   tipoFinal,
      numero_comprobante: numeroComprobante,
      punto_venta:        puntoVenta,
      fecha:              todayArgentina(),
      cliente_id,
      pedido_id:          pedido_id ?? null,
      total_neto:         totalNeto,
      total_iva:          totalIva,
      percepcion_iva:     percIVA,
      percepcion_iibb:    percIIBB,
      total_factura:      totalComprobante,
      saldo_pendiente:    totalComprobante,
      estado_pago:        'pendiente',
      observaciones:      concepto,
      cae:                respCAE.cae,
      vencimiento_cae:    respCAE.vencimientoCae,
    }

    const detallePayload = itemsCalculados.map((item: any) => ({
      articulo_id:     item.articulo_id,
      descripcion:     item.descripcion,
      cantidad:        item.qty,
      precio_unitario: item.precioNeto,
      // precio_total es NETO en todo el sistema: SUM(detalle.precio_total) == total_neto
      precio_total:    item.subtotalNeto,
    }))

    const logId = await registrarCAEObtenido(supabase, {
      tipo: tipoFinal, puntoVenta, numero: numeroComprobante,
      cae: respCAE.cae, vencimientoCae: respCAE.vencimientoCae,
      importe: totalComprobante, clienteCuit: cliente.cuit,
      payload: { comprobante: comprobanteInsert, detalle: detallePayload },
    })

    const { data: comprobante, error: compError } = await supabase
      .from('comprobantes_venta')
      .insert(comprobanteInsert)
      .select('id, tipo_comprobante, numero_comprobante, fecha, total_neto, total_iva, percepcion_iva, percepcion_iibb, total_factura, cae, vencimiento_cae, observaciones')
      .single()

    if (compError) {
      await marcarHuerfano(supabase, logId, compError.message)
      return NextResponse.json({ error: mensajeHuerfano(tipoFinal, numeroComprobante, respCAE.cae) }, { status: 500 })
    }

    await marcarComprobanteCreado(supabase, logId, comprobante.id)

    const detalleInserts = detallePayload.map((d: any) => ({ ...d, comprobante_id: comprobante.id }))

    const { error: detError } = await supabase.from('comprobantes_venta_detalle').insert(detalleInserts)
    if (detError) {
      return NextResponse.json({ error: 'Error creando detalle: ' + detError.message }, { status: 500 })
    }

    await supabase
      .from('numeracion_comprobantes')
      .update({ ultimo_numero: nuevoNumero })
      .eq('tipo_comprobante', tipoFinal)
      .eq('punto_venta', puntoVenta)

    // CC: el cliente debe más
    await supabase.from('cuenta_corriente_ajustes').insert({
      cliente_id,
      tipo_movimiento:    'debe',
      tipo_comprobante:   tipoFinal,
      numero_comprobante: numeroComprobante,
      monto:              totalComprobante,
      fecha:              todayArgentina(),
      concepto:           'Nota de Débito',
      descripcion:        concepto,
    })

    // ─── Generar PDF con QR y subirlo al bucket ───
    try {
      const { data: marcasTbl } = await supabase.from('marcas').select('id, descripcion').eq('activo', true)
      const marcaDesc = new Map((marcasTbl ?? []).map((m: any) => [m.id, m.descripcion ?? '']))

      let qrDataUrl: string | undefined
      let qrUrl: string | undefined
      if (respCAE.cae && cliente.cuit) {
        try {
          const qrParams = {
            cuit:       empresaConfig?.cuit ?? '',
            ptoVta:     puntoVenta,
            tipoCmp:    tipoFinal,
            nroCmp:     numeroComprobante,
            importe:    totalComprobante,
            fecha:      todayArgentina(),
            tipoDocRec: 80,
            nroDocRec:  cliente.cuit,
            cae:        respCAE.cae,
          }
          qrUrl     = buildQRUrl(qrParams)
          qrDataUrl = await generarQRBase64(qrParams)
        } catch (qrErr: any) {
          console.error('[ND QR] Error generando QR:', qrErr.message)
        }
      }

      const detalleND = itemsCalculados.map((item: any) => ({
        articulo_id:      item.articulo_id,
        descripcion:      item.descripcion,
        sku:              '',
        cantidad:         item.qty,
        precio_unitario:  item.precioNeto,
        precio_total:     item.subtotalNeto,
        marca:            '',
        descuento_propio: 0,
      }))

      const pdfData = buildPDFData({
        comprobante:   comprobante,
        cliente,
        empresa:       empresaConfig,
        detalle:       detalleND,
        pedido:        null,
        bonificaciones: [],
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
      }).eq('id', comprobante.id)
    } catch (pdfErr: any) {
      console.error('[ND PDF] Error generando PDF:', pdfErr.message)
      await supabase.from('comprobantes_venta').update({ estado_pdf: 'error' }).eq('id', comprobante.id).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      comprobante: {
        id:              comprobante.id,
        tipo:            tipoFinal,
        numero:          numeroComprobante,
        total:           totalComprobante,
        total_neto:      totalNeto,
        total_iva:       totalIva,
        percepcion_iva:  percIVA,
        percepcion_iibb: percIIBB,
        cae:             respCAE.cae,
        vencimiento_cae: respCAE.vencimientoCae,
      },
    })
  } catch (err: any) {
    console.error('[ND] Error generando nota de débito:', err)
    return NextResponse.json({ error: err.message || 'Error generando nota de débito' }, { status: 500 })
  }
}
