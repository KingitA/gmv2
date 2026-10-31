import { todayArgentina } from '@/lib/utils'
import { REQUIERE_CAE, TIPO_CBTE_ARCA, DOC_TIPO, CONCEPTO, IVA_ID, TRIBUTO_ID, condicionIvaReceptorId, type AmbienteARCA } from '@/lib/arca/tipos'
import { TASA_PERCEPCION_IVA } from '@/lib/comprobantes/calcular-percepciones'
import { registrarCAEObtenido, marcarComprobanteCreado, marcarHuerfano, mensajeHuerfano } from '@/lib/arca/registro-cae'
import { obtenerTAConCache } from '@/lib/arca/cache'
import { ultimoAutorizado, solicitarCAE } from '@/lib/arca/wsfev1'
import { postearLibroConAviso } from '@/lib/cuenta-corriente/postear-libro'
import { generarYSubirPDF, buildPDFData, generarQRBase64, buildQRUrl, buildSnapshot } from '@/lib/pdf/generar'
import { cuitDigitos, cuitValido, normalizarCuit } from '@/lib/formato'
import { reservarNumero, tomarTurnoFiscal, formatoNumeroComprobante, type TurnoFiscal } from '@/lib/comprobantes/numeracion'

/**
 * EMITIR UN COMPROBANTE DE AJUSTE suelto (P2-43: lo que el cliente se quedó de
 * una devolución ya aplicada en la refacturación del pedido —
 * lib/pedidos/diferencia-devolucion-aplicada.ts). Crédito: NCA/NCB/NCC o REV.
 * Débito: NDA/NDB/NDC o PRES. Mismo camino que la anulación (anular-comprobante.ts):
 * numeración (turno fiscal con ARCA o número reservado), CAE con el comprobante
 * asociado (RG 4540), libro mayor, detalle y PDF. No toca stock ni kardex.
 * Sin pedido_id: no es una "factura viva" del pedido y no se anula
 * con él. Importes en positivo: el signo lo pone el tipo.
 */
export interface AjusteAEmitir {
  tipo: string
  clienteId: string
  neto: number
  iva: number
  /** Base de la percepción IVA (neto de lo que la lleva) */
  baseIva: number
  percepcionIva: number
  percepcionIibb: number
  alicuotaIIBB: number
  detalle: Array<{ articulo_id: string | null; descripcion: string; cantidad: number; neto: number }>
  /** Comprobante asociado (RG 4540), obligatorio si es fiscal */
  asociado: { tipo_comprobante: string; numero_comprobante: string } | null
  observaciones: string
  motivo: string
  usuarioId: string | null
}

export interface AjusteEmitido {
  id: string
  tipo: string
  numero: string
  /** Con signo: negativo = crédito al cliente */
  total: number
  cae: string | null
  advertencias: string[]
}

const r2 = (n: number) => Math.round(n * 100) / 100
const CREDITOS = new Set(['NCA', 'NCB', 'NCC', 'REV'])
const TIPOS = new Set(['NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC', 'REV', 'PRES'])

export async function emitirComprobanteAjuste(supabase: any, a: AjusteAEmitir): Promise<AjusteEmitido> {
  const ctx: { turno: TurnoFiscal | null } = { turno: null }
  try {
    return await emitirEnTurno(supabase, a, ctx)
  } finally {
    await ctx.turno?.soltar()
  }
}

async function emitirEnTurno(supabase: any, a: AjusteAEmitir, ctx: { turno: TurnoFiscal | null }): Promise<AjusteEmitido> {
  if (!TIPOS.has(a.tipo)) throw new Error(`Tipo de ajuste no válido: ${a.tipo}`)
  const esFiscal = REQUIERE_CAE.has(a.tipo)
  const esCredito = CREDITOS.has(a.tipo)
  const signo = esCredito ? -1 : 1

  const neto = r2(Math.abs(a.neto))
  const iva = esFiscal ? r2(Math.abs(a.iva)) : 0
  const percIva = esFiscal ? r2(Math.abs(a.percepcionIva)) : 0
  const percIibb = esFiscal ? r2(Math.abs(a.percepcionIibb)) : 0
  const trib = r2(percIva + percIibb)
  // ImpTotal = ImpNeto + ImpIVA + ImpTrib al centavo (validación ARCA)
  const total = (Math.round(neto * 100) + Math.round(iva * 100) + Math.round(trib * 100)) / 100
  if (!(total > 0)) throw new Error('El ajuste no tiene importe')

  const { data: cliente } = await supabase
    .from('clientes')
    .select('id, nombre_razon_social, nombre, cuit, condicion_iva, exento_iva, exento_iibb, percepcion_iibb, vendedor_id, provincia, direccion, localidad_id')
    .eq('id', a.clienteId)
    .single()
  if (!cliente) throw new Error('Cliente no encontrado')

  const { data: empresaConfig } = await supabase
    .from('configuracion_empresa')
    .select('cuit, arca_ambiente, arca_punto_venta')
    .single()

  let puntoVenta = '0001'
  let nuevoNumero: number
  let cae: string | null = null
  let vencimientoCae: string | null = null

  if (esFiscal) {
    // Las mismas barreras que la anulación: sin CAE no existe el comprobante
    if (!process.env.ARCA_CERTIFICADO || !process.env.ARCA_CLAVE_PRIVADA) throw new Error('Certificado ARCA no configurado: no se puede emitir el ajuste fiscal.')
    if (!empresaConfig?.arca_punto_venta) throw new Error('configuracion_empresa.arca_punto_venta no está configurado: no se puede emitir el ajuste fiscal.')
    if (!normalizarCuit(cliente.cuit) || !cuitValido(cliente.cuit)) throw new Error(`El cliente "${cliente.nombre_razon_social ?? ''}" no tiene un CUIT válido: no se puede emitir el ajuste fiscal.`)
    const condIvaReceptor = condicionIvaReceptorId(cliente.condicion_iva)
    if (condIvaReceptor === null) throw new Error(`La condición de IVA "${cliente.condicion_iva ?? 'sin cargar'}" del cliente no mapea a ARCA (RG 5616).`)
    const asoc = a.asociado
    const tipoAsoc = asoc ? TIPO_CBTE_ARCA[asoc.tipo_comprobante] : undefined
    if (!asoc || !tipoAsoc || !asoc.numero_comprobante?.includes('-')) throw new Error('El ajuste fiscal necesita su comprobante asociado (RG 4540).')

    puntoVenta = String(empresaConfig.arca_punto_venta).padStart(4, '0')
    const ambiente = (empresaConfig.arca_ambiente ?? 'produccion') as AmbienteARCA
    const ta = await obtenerTAConCache(supabase, ambiente)
    const cuitEmpresa = cuitDigitos(empresaConfig.cuit)
    const cbteTipo = TIPO_CBTE_ARCA[a.tipo]
    ctx.turno = await tomarTurnoFiscal(supabase, a.tipo, puntoVenta, () => ultimoAutorizado(ambiente, ta.token, ta.sign, cuitEmpresa, parseInt(puntoVenta, 10), cbteTipo))
    nuevoNumero = ctx.turno.numero

    const tributos = []
    if (percIva > 0) tributos.push({ id: TRIBUTO_ID.PERCEPCION_IVA, desc: 'Percepcion IVA RG 5329', baseImp: r2(Math.abs(a.baseIva)) || neto, alic: TASA_PERCEPCION_IVA, importe: percIva })
    if (percIibb > 0) tributos.push({ id: TRIBUTO_ID.PERCEPCION_IIBB, desc: 'Percepcion IIBB', baseImp: neto, alic: Number(a.alicuotaIIBB) || 0, importe: percIibb })
    const resp = await solicitarCAE({
      ambiente,
      token: ta.token,
      sign: ta.sign,
      cuit: cuitEmpresa,
      ptoVta: parseInt(puntoVenta, 10),
      cbteTipo,
      cbteDesde: nuevoNumero,
      cbteHasta: nuevoNumero,
      concepto: CONCEPTO.PRODUCTOS,
      docTipo: DOC_TIPO.CUIT,
      docNro: cuitDigitos(cliente.cuit),
      fecha: todayArgentina().replace(/-/g, ''),
      impTotal: total,
      impTotConc: 0,
      impNeto: neto,
      impOpEx: 0,
      impIva: iva,
      impTrib: trib,
      iva: iva > 0 ? [{ id: IVA_ID.IVA_21, baseImp: neto, importe: iva }] : [{ id: IVA_ID.EXENTO, baseImp: neto, importe: 0 }],
      tributos: tributos.length ? tributos : undefined,
      cbteAsoc: [{
        tipo: tipoAsoc,
        ptoVta: parseInt(asoc.numero_comprobante.split('-')[0], 10),
        nro: parseInt(asoc.numero_comprobante.split('-')[1], 10),
      }],
      condicionIVAReceptorId: condIvaReceptor,
    })
    cae = resp.cae
    vencimientoCae = resp.vencimientoCae
    ctx.turno.marcarUsado()
  } else {
    nuevoNumero = await reservarNumero(supabase, a.tipo, puntoVenta)
  }
  const numero = formatoNumeroComprobante(puntoVenta, nuevoNumero)

  const insert = {
    tipo_comprobante: a.tipo,
    numero_comprobante: numero,
    punto_venta: puntoVenta,
    fecha: todayArgentina(),
    cliente_id: a.clienteId,
    pedido_id: null,
    total_neto: r2(signo * neto),
    total_iva: r2(signo * iva),
    percepcion_iva: r2(signo * percIva),
    percepcion_iibb: r2(signo * percIibb),
    total_factura: r2(signo * total),
    saldo_pendiente: r2(signo * total),
    estado_pago: 'pendiente',
    motivo_ajuste: a.motivo,
    observaciones: a.observaciones,
    creado_por: a.usuarioId,
    ...(cae ? { cae } : {}),
    ...(vencimientoCae ? { vencimiento_cae: vencimientoCae } : {}),
  }
  // Detalle: precio_total suma el total_neto (misma invariante que generar y la NC de devolución)
  const detallePayload = a.detalle.map((d) => {
    const cant = Math.abs(Number(d.cantidad) || 0) || 1
    return {
      articulo_id: d.articulo_id,
      descripcion: d.descripcion,
      cantidad: signo * cant,
      precio_unitario: Math.round((Math.abs(d.neto) / cant) * 10000) / 10000,
      precio_total: r2(signo * Math.abs(d.neto)),
    }
  })

  const logId = cae ? await registrarCAEObtenido(supabase, {
    tipo: a.tipo, puntoVenta, numero, cae, vencimientoCae, importe: total,
    clienteCuit: cliente.cuit ?? null,
    payload: { comprobante: insert, detalle: detallePayload },
  }) : null

  const { data: comp, error } = await supabase.from('comprobantes_venta').insert(insert).select('id').single()
  if (error || !comp) {
    if (cae) {
      await marcarHuerfano(supabase, logId, error?.message ?? 'insert sin resultado')
      throw new Error(mensajeHuerfano(a.tipo, numero, cae))
    }
    throw new Error(`Error creando el ajuste ${a.tipo}: ${error?.message}`)
  }
  await marcarComprobanteCreado(supabase, logId, comp.id)
  await ctx.turno?.soltar()

  const advertencias: string[] = []
  if (detallePayload.length) {
    const { error: detErr } = await supabase.from('comprobantes_venta_detalle').insert(detallePayload.map((d) => ({ ...d, comprobante_id: comp.id })))
    if (detErr) advertencias.push(`Detalle del ${a.tipo} ${numero} sin grabar (${detErr.message}).`)
  }

  const aviso = await postearLibroConAviso(supabase, {
    p_cliente_id: a.clienteId,
    p_tipo_movimiento: esCredito ? 'nota_credito' : 'nota_debito',
    p_debe: esCredito ? 0 : total,
    p_haber: esCredito ? total : 0,
    p_referencia_tipo: 'comprobante_venta',
    p_referencia_id: comp.id,
    p_numero_comprobante: numero,
    p_observaciones: `${a.tipo} ${numero} — ${a.motivo}`,
    p_usuario_id: a.usuarioId,
  }, `${a.tipo} ${numero}`)
  if (aviso) advertencias.push(aviso)

  // PDF (con QR si tiene CAE); si falla queda marcado y se regenera después
  try {
    const { data: empresaData } = await supabase.from('configuracion_empresa').select('*').single()
    let qrDataUrl: string | undefined
    let qrUrl: string | undefined
    if (cae && cliente.cuit) {
      const qrParams = { cuit: empresaData?.cuit ?? '', ptoVta: puntoVenta, tipoCmp: a.tipo, nroCmp: numero, importe: total, fecha: todayArgentina(), tipoDocRec: 80, nroDocRec: cliente.cuit, cae }
      qrUrl = buildQRUrl(qrParams)
      qrDataUrl = await generarQRBase64(qrParams)
    }
    const pdfData = buildPDFData({
      comprobante: { id: comp.id, ...insert },
      cliente,
      empresa: empresaData,
      detalle: detallePayload.map((d) => ({ ...d, articulos: { descripcion: d.descripcion, sku: '' } })),
      marcaDesc: new Map(),
      qrDataUrl,
    })
    const { pdfUrl, pdfPath, pdfHash } = await generarYSubirPDF(supabase, pdfData)
    await supabase.from('comprobantes_venta').update({
      pdf_url: pdfUrl,
      pdf_path: pdfPath,
      pdf_hash: pdfHash,
      fecha_generacion_pdf: new Date().toISOString(),
      estado_pdf: 'generado',
      pdf_snapshot: buildSnapshot(pdfData),
      qr_url: qrUrl ?? null,
    }).eq('id', comp.id)
  } catch (pdfErr: any) {
    console.error('[ajuste PDF]', pdfErr?.message)
    const { error: marcaErr } = await supabase.from('comprobantes_venta').update({ estado_pdf: 'error' }).eq('id', comp.id)
    if (marcaErr) console.error('[ajuste PDF] marcando error:', marcaErr.message)
  }

  return { id: comp.id, tipo: a.tipo, numero, total: r2(signo * total), cae, advertencias }
}
