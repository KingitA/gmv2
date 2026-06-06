/**
 * Genera el PDF de un comprobante y lo sube al bucket 'comprobantes_venta' de Supabase.
 * Retorna la URL pública firmada (1 año de validez) que se guarda en comprobantes_venta.pdf_url.
 *
 * El PDF queda congelado: si después cambian los datos del cliente, artículos o precios,
 * el PDF original no se modifica. Es el comprobante en el momento de su emisión.
 */

import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React, { type JSXElementConstructor, type ReactElement } from 'react'
import { ComprobantePDF, type ComprobantePDFData } from './comprobante-template'
import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'comprobantes_venta'

/**
 * Genera el PDF en memoria y lo sube a Supabase Storage.
 * Retorna la URL firmada con 1 año de validez.
 */
export async function generarYSubirPDF(
  supabase: SupabaseClient,
  data: ComprobantePDFData,
): Promise<string> {
  // 1. Renderizar el PDF a buffer
  const element = React.createElement(ComprobantePDF, { data }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
  const buffer  = await renderToBuffer(element)

  // 2. Nombre de archivo: tipo-numero-id.pdf (ej: FA-0007-00000001-uuid.pdf)
  const tipo   = data.comprobante.tipo_comprobante
  const nro    = data.comprobante.numero_comprobante.replace('-', '_')
  const id     = data.comprobante.id
  const nombre = `${tipo}_${nro}_${id}.pdf`

  // 3. Subir al bucket
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(nombre, buffer, {
      contentType: 'application/pdf',
      upsert:      false, // no sobreescribir — el comprobante ya fue emitido
    })

  if (uploadErr) {
    throw new Error(`Error subiendo PDF al bucket: ${uploadErr.message}`)
  }

  // 4. Obtener URL firmada con 1 año de validez (60 * 60 * 24 * 365 = 31536000 seg)
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(nombre, 31_536_000)

  if (signErr || !signed?.signedUrl) {
    throw new Error(`Error generando URL firmada del PDF: ${signErr?.message}`)
  }

  return signed.signedUrl
}

/**
 * Construye el objeto ComprobantePDFData a partir de los datos del comprobante en DB.
 * Llamar después de cargar el comprobante con su detalle, cliente y empresa.
 */
export function buildPDFData(params: {
  comprobante:    any
  cliente:        any
  empresa:        any
  detalle:        any[]
  pedido?:        any
  bonificaciones?: any[]
  marcaDesc?:     Map<string, string>
}): ComprobantePDFData {
  const { comprobante, cliente, empresa, detalle, pedido, bonificaciones = [], marcaDesc } = params

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
      razon_social:  empresa?.razon_social   ?? '—',
      cuit:          empresa?.cuit           ?? '—',
      direccion:     empresa?.direccion      ?? null,
      telefono:      empresa?.telefono       ?? null,
      email:         empresa?.email          ?? null,
      condicion_iva: empresa?.condicion_iva  ?? 'Responsable Inscripto',
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
