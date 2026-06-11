/**
 * Genera el PDF de un comprobante y lo sube al bucket 'comprobantes_venta' de Supabase.
 * El PDF queda congelado: si después cambian los datos del cliente, artículos o precios,
 * el PDF original no se modifica. Es el comprobante en el momento de su emisión.
 */

import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React, { type JSXElementConstructor, type ReactElement } from 'react'
import { ComprobantePDF, type ComprobantePDFData } from './comprobante-template'
import type { SupabaseClient } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import crypto from 'crypto'
import { TIPO_CBTE_ARCA } from '@/lib/arca/tipos'

/**
 * Genera el QR de verificación ARCA según RG 4892/2020 (modificatoria de la RG 4291).
 * URL: https://www.afip.gob.ar/fe/qr/?p=<base64(JSON)>
 */
export async function generarQRBase64(params: {
  cuit:       string
  ptoVta:     string
  tipoCmp:    string
  nroCmp:     string
  importe:    number
  fecha:      string
  tipoDocRec: number
  nroDocRec:  string
  cae:        string
}): Promise<string> {
  const url = buildQRUrl(params)
  return QRCode.toDataURL(url, { margin: 2, width: 300, errorCorrectionLevel: 'M' })
}

/** Retorna solo la URL del QR sin generar la imagen (para guardar en DB). */
export function buildQRUrl(params: {
  cuit:       string
  ptoVta:     string
  tipoCmp:    string
  nroCmp:     string
  importe:    number
  fecha:      string
  tipoDocRec: number
  nroDocRec:  string
  cae:        string
}): string {
  const nroComprobante = parseInt(params.nroCmp.split('-')[1] ?? params.nroCmp, 10)
  const payload = {
    ver:        1,
    fecha:      params.fecha,
    cuit:       parseInt(params.cuit.replace(/-/g, ''), 10),
    ptoVta:     parseInt(params.ptoVta, 10),
    tipoCmp:    TIPO_CBTE_ARCA[params.tipoCmp] ?? 0,
    nroCmp:     nroComprobante,
    importe:    params.importe,
    moneda:     'PES',
    ctz:        1,
    tipoDocRec: params.tipoDocRec,
    nroDocRec:  parseInt(params.nroDocRec.replace(/-/g, ''), 10),
    tipoCodAut: 'E',
    codAut:     parseInt(params.cae, 10),
  }
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
  return `https://www.afip.gob.ar/fe/qr/?p=${b64}`
}

/** Calcula el hash SHA-256 del buffer PDF. Retorna hex de 64 chars. */
export function calcularHashPDF(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/** Captura un snapshot JSONB del comprobante en el momento de generación. */
export function buildSnapshot(data: ComprobantePDFData): Record<string, unknown> {
  return {
    v:            1,
    generado_en:  new Date().toISOString(),
    comprobante:  data.comprobante,
    cliente:      data.cliente,
    empresa:      { razon_social: data.empresa.razon_social, cuit: data.empresa.cuit },
    detalle_count: data.detalle.length,
    total_factura: data.comprobante.total_factura,
  }
}

const BUCKET = 'comprobantes_venta'

export interface GenerarPDFResult {
  pdfUrl:  string
  pdfPath: string
  pdfHash: string
}

/**
 * Genera el PDF en memoria, calcula su hash SHA-256 y lo sube a Supabase Storage.
 * Retorna path permanente + URL firmada (1 año) + hash para verificación.
 */
export async function generarYSubirPDF(
  supabase: SupabaseClient,
  data: ComprobantePDFData,
): Promise<GenerarPDFResult> {
  // 1. Renderizar el PDF a buffer
  const element = React.createElement(ComprobantePDF, { data }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
  const buffer  = await renderToBuffer(element)

  // 2. Calcular hash SHA-256
  const pdfHash = calcularHashPDF(buffer)

  // 3. Nombre de archivo: tipo-numero-id.pdf
  const tipo    = data.comprobante.tipo_comprobante
  const nro     = data.comprobante.numero_comprobante.replace('-', '_')
  const id      = data.comprobante.id
  const pdfPath = `${tipo}_${nro}_${id}.pdf`

  // 4. Subir al bucket (no sobreescribir — el comprobante ya fue emitido)
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(pdfPath, buffer, {
      contentType: 'application/pdf',
      upsert:      false,
    })

  if (uploadErr) {
    throw new Error(`Error subiendo PDF al bucket: ${uploadErr.message}`)
  }

  // 5. Obtener URL firmada con 1 año de validez (31_536_000 seg)
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pdfPath, 31_536_000)

  if (signErr || !signed?.signedUrl) {
    throw new Error(`Error generando URL firmada del PDF: ${signErr?.message}`)
  }

  return { pdfUrl: signed.signedUrl, pdfPath, pdfHash }
}

/**
 * Construye el objeto ComprobantePDFData a partir de los datos del comprobante en DB.
 */
export function buildPDFData(params: {
  comprobante:    any
  cliente:        any
  empresa:        any
  detalle:        any[]
  pedido?:        any
  bonificaciones?: any[]
  marcaDesc?:     Map<string, string>
  qrDataUrl?:     string
}): ComprobantePDFData {
  const { comprobante, cliente, empresa, detalle, pedido, bonificaciones = [], marcaDesc, qrDataUrl } = params

  return {
    comprobante: {
      id:               comprobante.id,
      tipo_comprobante: comprobante.tipo_comprobante,
      numero_comprobante: comprobante.numero_comprobante,
      fecha:            comprobante.fecha,
      total_neto:       Number(comprobante.total_neto      ?? 0),
      total_iva:        Number(comprobante.total_iva       ?? 0),
      percepcion_iva:   Number(comprobante.percepcion_iva  ?? 0),
      percepcion_iibb:  Number(comprobante.percepcion_iibb ?? 0),
      total_factura:    Number(comprobante.total_factura   ?? 0),
      cae:              comprobante.cae              ?? null,
      vencimiento_cae:  comprobante.vencimiento_cae  ?? null,
      observaciones:    comprobante.observaciones    ?? null,
      motivo_ajuste:    comprobante.motivo_ajuste    ?? null,
      qr_data_url:      qrDataUrl ?? null,
    },
    cliente: {
      nombre_razon_social: cliente?.nombre_razon_social ?? cliente?.nombre ?? '—',
      cuit:                cliente?.cuit                ?? '—',
      direccion:           cliente?.direccion           ?? null,
      localidad:           cliente?.localidad           ?? null,
      condicion_iva:       cliente?.condicion_iva       ?? null,
      telefono:            cliente?.telefono            ?? null,
      condicion_pago:      cliente?.condicion_pago      ?? null,
    },
    empresa: {
      razon_social:         empresa?.razon_social         ?? '—',
      cuit:                 empresa?.cuit                 ?? '—',
      logo_url:             empresa?.logo_url             ?? null,
      direccion:            empresa?.direccion            ?? null,
      telefono:             empresa?.telefono             ?? null,
      email:                empresa?.email                ?? null,
      condicion_iva:        empresa?.condicion_iva        ?? 'Responsable Inscripto',
      inicio_actividades:   empresa?.inicio_actividades   ?? null,
      iibb:                 empresa?.iibb                 ?? null,
    },
    pedido: pedido ? {
      numero_pedido:     pedido.numero_pedido,
      condicion_entrega: pedido.condicion_entrega,
      vendedor:          pedido.vendedores?.nombre ?? pedido.vendedor ?? undefined,
    } : null,
    detalle: detalle.map(d => ({
      articulo_id:     d.articulo_id,
      descripcion:     d.articulos?.descripcion ?? d.descripcion ?? '—',
      sku:             d.articulos?.sku         ?? d.sku         ?? '',
      cantidad:        Number(d.cantidad        ?? 0),
      precio_unitario: Number(d.precio_unitario ?? 0),
      precio_total:    Number(d.precio_total    ?? 0),
      marca:           marcaDesc?.get(d.articulos?.marca_id) ?? '',
      descuento_propio: Number(d.articulos?.descuento_propio ?? 0),
    })),
    bonificaciones: bonificaciones.map(b => ({
      tipo:       b.tipo,
      porcentaje: Number(b.porcentaje),
      segmento:   b.segmento ?? undefined,
    })),
  }
}
