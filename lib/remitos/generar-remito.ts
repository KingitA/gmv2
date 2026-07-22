/**
 * Generación de remitos a partir de los comprobantes de un pedido.
 *
 * Reglas:
 * - retira_mostrador (o sin condición) → NO se genera remito.
 * - entregamos_nosotros → ORIGINAL + DUPLICADO.
 * - transporte → ORIGINAL + DUPLICADO + TRIPLICADO.
 * - FA/FB → remito REM (letra R, fiscal, con datos de empresa, valor declarado).
 * - PRES  → remito REMX (letra X, sin datos de empresa, sin valorizar, con subtotal).
 * - NC/ND/REV → nunca generan remito.
 *
 * Inmutabilidad: numeración vía RPC atómica remito_siguiente_numero; un solo
 * remito activo por comprobante (índice parcial uq_remitos_comprobante_activo);
 * PDF con upsert:false + hash SHA-256 + snapshot JSONB. El PDF de un remito
 * emitido jamás se regenera con otro contenido.
 *
 * Nunca lanza por errores de un remito individual: la factura ya tiene CAE.
 * Los errores se acumulan en `errores` y se reintenta con POST /api/remitos/generar.
 */

import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React, { type JSXElementConstructor, type ReactElement } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { RemitoPDF, type RemitoPDFData } from '@/lib/pdf/remito-template'

export type { RemitoPDFData }
import { calcularHashPDF } from '@/lib/pdf/generar'
import { REQUIERE_CAE } from '@/lib/arca/tipos'
import { todayArgentina } from '@/lib/utils'

const BUCKET = 'comprobantes_venta'
const PV_REMITO = '0001'

/** Copias por condición de entrega. retira_mostrador ausente → no se genera remito. */
export const COPIAS_POR_ENTREGA: Record<string, string[]> = {
  entregamos_nosotros: ['ORIGINAL', 'DUPLICADO'],
  transporte:          ['ORIGINAL', 'DUPLICADO', 'TRIPLICADO'],
}

/** Tipos de comprobante que llevan remito. */
const TIPOS_CON_REMITO = new Set(['FA', 'FB', 'PRES'])

export interface RemitoGenerado {
  id: string
  tipo_remito: string
  numero_remito: string
  comprobante_id: string
  estado_pdf: string
}

export interface ResultadoRemitos {
  generados: RemitoGenerado[]
  omitidos: string[]
  errores: string[]
}

/**
 * Genera los remitos pendientes de un pedido (idempotente: los comprobantes
 * que ya tienen remito activo se saltean). Sirve para la emisión inicial,
 * el reintento y el backfill de pedidos facturados antes del módulo.
 */
export async function generarRemitosParaPedido(
  supabase: SupabaseClient,
  pedidoId: string,
  creadoPor?: string,
): Promise<ResultadoRemitos> {
  const resultado: ResultadoRemitos = { generados: [], omitidos: [], errores: [] }

  // ─── 1. Pedido + cliente + viaje ───
  const { data: pedido, error: pedidoErr } = await supabase
    .from('pedidos')
    .select(`
      id, numero_pedido, cliente_id, viaje_id, condicion_entrega, bultos,
      cliente:clientes!pedidos_cliente_id_fkey(
        id, nombre_razon_social, cuit, direccion, localidad, condicion_iva, condicion_entrega
      ),
      viaje:viajes(id, transporte_id, zona_id)
    `)
    .eq('id', pedidoId)
    .single()

  if (pedidoErr || !pedido) {
    resultado.errores.push(`Pedido ${pedidoId} no encontrado: ${pedidoErr?.message ?? ''}`)
    return resultado
  }

  const cliente = pedido.cliente as any
  const condicion: string = pedido.condicion_entrega || cliente?.condicion_entrega || ''
  const copias = COPIAS_POR_ENTREGA[condicion]
  if (!copias) {
    resultado.omitidos.push(
      condicion === 'retira_mostrador'
        ? 'Retira en mostrador: no corresponde remito.'
        : `Condición de entrega "${condicion || 'sin definir'}": no corresponde remito.`,
    )
    return resultado
  }

  // ─── 2. Transporte (cascada: viaje.transporte_id → zona del viaje) ───
  // Si al facturar no hay viaje asignado, el remito sale con el bloque de
  // transporte en blanco para completar a mano (el PDF no se regenera después).
  let transporteId: string | null = (pedido.viaje as any)?.transporte_id ?? null
  if (!transporteId && (pedido.viaje as any)?.zona_id) {
    const { data: zona } = await supabase
      .from('zonas')
      .select('transporte_id')
      .eq('id', (pedido.viaje as any).zona_id)
      .single()
    transporteId = zona?.transporte_id ?? null
  }
  let transporte: { nombre: string; cuit?: string | null } | null = null
  if (transporteId) {
    const { data: t } = await supabase
      .from('transportes')
      .select('nombre, cuit')
      .eq('id', transporteId)
      .single()
    if (t) transporte = { nombre: t.nombre, cuit: t.cuit ?? null }
  }

  // ─── 3. Comprobantes vigentes del pedido que llevan remito ───
  const { data: comprobantes, error: compErr } = await supabase
    .from('comprobantes_venta')
    .select(`
      id, tipo_comprobante, numero_comprobante, total_factura, fecha,
      comprobantes_venta_detalle(articulo_id, descripcion, cantidad, articulos(sku))
    `)
    .eq('pedido_id', pedidoId)
    .is('anulado_en', null)
    .in('tipo_comprobante', [...TIPOS_CON_REMITO])

  if (compErr) {
    resultado.errores.push(`Error consultando comprobantes: ${compErr.message}`)
    return resultado
  }
  if (!comprobantes?.length) {
    resultado.omitidos.push('El pedido no tiene comprobantes vigentes que lleven remito (FA/FB/PRES).')
    return resultado
  }

  // Comprobantes que ya tienen remito activo → saltear (idempotencia)
  const { data: remitosExistentes } = await supabase
    .from('remitos')
    .select('comprobante_id')
    .in('comprobante_id', comprobantes.map((c: any) => c.id))
    .eq('estado', 'activo')
  const conRemito = new Set((remitosExistentes ?? []).map((r: any) => r.comprobante_id))

  // ─── 4. Empresa (solo la necesita el remito R) ───
  const { data: empresa } = await supabase
    .from('configuracion_empresa')
    .select('razon_social, cuit, direccion, telefono, condicion_iva, iibb, numero_iibb, inicio_actividades, logo_url')
    .single()

  // ─── 5. Un remito por comprobante ───
  for (const comp of comprobantes as any[]) {
    if (conRemito.has(comp.id)) {
      resultado.omitidos.push(`${comp.tipo_comprobante} ${comp.numero_comprobante}: ya tiene remito activo.`)
      continue
    }

    try {
      const esFiscal = REQUIERE_CAE.has(comp.tipo_comprobante)
      const tipoRemito = esFiscal ? 'REM' : 'REMX'

      // Numeración atómica (UPDATE..RETURNING): sin colisiones posibles.
      const { data: nro, error: nroErr } = await supabase.rpc('remito_siguiente_numero', {
        p_tipo: tipoRemito,
        p_punto_venta: PV_REMITO,
      })
      if (nroErr || nro == null) {
        throw new Error(`Numeración ${tipoRemito}/${PV_REMITO} no disponible: ${nroErr?.message ?? 'sin fila'}. ¿Se aplicó la migración 20260722_remitos.sql?`)
      }
      const numeroRemito = `${PV_REMITO}-${String(nro).padStart(8, '0')}`

      // Insert del remito. Si otro proceso ya creó uno para este comprobante,
      // el índice parcial uq_remitos_comprobante_activo lo rechaza (23505) → skip.
      const { data: remito, error: insErr } = await supabase
        .from('remitos')
        .insert({
          comprobante_id:    comp.id,
          numero_remito:     numeroRemito,
          tipo_remito:       tipoRemito,
          punto_venta:       PV_REMITO,
          fecha:             todayArgentina(),
          cliente_id:        pedido.cliente_id,
          pedido_id:         pedido.id,
          viaje_id:          pedido.viaje_id ?? null,
          transporte_id:     transporteId,
          transporte:        transporte?.nombre ?? null,
          valor_declarado:   Number(comp.total_factura ?? 0),
          bultos:            pedido.bultos && pedido.bultos > 0 ? pedido.bultos : null,
          condicion_entrega: condicion,
          copias:            copias.length,
          estado:            'activo',
          estado_pdf:        'pendiente',
          ...(creadoPor ? { creado_por: creadoPor } : {}),
        })
        .select('id')
        .single()

      if (insErr) {
        if (insErr.code === '23505') {
          resultado.omitidos.push(`${comp.tipo_comprobante} ${comp.numero_comprobante}: remito creado por otro proceso.`)
          continue
        }
        throw new Error(`Error creando remito: ${insErr.message}`)
      }

      const detalle = (comp.comprobantes_venta_detalle ?? []).map((d: any) => ({
        remito_id:   remito.id,
        articulo_id: d.articulo_id,
        descripcion: d.descripcion ?? '—',
        cantidad:    Number(d.cantidad ?? 0),
      }))
      if (detalle.length) {
        const { error: detErr } = await supabase.from('remitos_detalle').insert(detalle)
        if (detErr) throw new Error(`Error creando detalle del remito ${numeroRemito}: ${detErr.message}`)
      }

      // PDF: si falla queda estado_pdf='error' y se reintenta con regenerar-pdf.
      let estadoPdf = 'generado'
      try {
        const pdfData: RemitoPDFData = {
          remito: {
            id:                 remito.id,
            tipo_remito:        tipoRemito as 'REM' | 'REMX',
            numero_remito:      numeroRemito,
            fecha:              todayArgentina(),
            valor_declarado:    Number(comp.total_factura ?? 0),
            bultos:             pedido.bultos && pedido.bultos > 0 ? pedido.bultos : null,
            comprobante_numero: comp.numero_comprobante,
            comprobante_tipo:   comp.tipo_comprobante,
          },
          empresa: esFiscal ? (empresa ?? null) : null,
          cliente: {
            nombre_razon_social: cliente?.nombre_razon_social ?? '—',
            cuit:                cliente?.cuit ?? null,
            direccion:           cliente?.direccion ?? null,
            localidad:           cliente?.localidad ?? null,
            condicion_iva:       cliente?.condicion_iva ?? null,
          },
          transporte,
          condicion_entrega: condicion,
          copias,
          detalle: (comp.comprobantes_venta_detalle ?? []).map((d: any) => ({
            sku:         d.articulos?.sku ?? null,
            descripcion: d.descripcion ?? '—',
            cantidad:    Number(d.cantidad ?? 0),
          })),
          numero_pedido: pedido.numero_pedido ?? null,
        }
        await generarYSubirRemitoPDF(supabase, remito.id, pdfData)
      } catch (pdfErr: any) {
        console.error('[Remitos] Error PDF remito', numeroRemito, pdfErr.message)
        estadoPdf = 'error'
        await supabase.from('remitos').update({ estado_pdf: 'error' }).eq('id', remito.id)
        resultado.errores.push(`PDF del remito ${numeroRemito}: ${pdfErr.message}`)
      }

      resultado.generados.push({
        id: remito.id,
        tipo_remito: tipoRemito,
        numero_remito: numeroRemito,
        comprobante_id: comp.id,
        estado_pdf: estadoPdf,
      })
    } catch (err: any) {
      console.error('[Remitos] Error en comprobante', comp.id, err.message)
      resultado.errores.push(`${comp.tipo_comprobante} ${comp.numero_comprobante}: ${err.message}`)
    }
  }

  return resultado
}

/** Snapshot inmutable del remito en el momento de emisión. */
function buildRemitoSnapshot(data: RemitoPDFData): Record<string, unknown> {
  return {
    v:               1,
    generado_en:     new Date().toISOString(),
    remito:          data.remito,
    cliente:         data.cliente,
    transporte:      data.transporte ?? null,
    condicion_entrega: data.condicion_entrega,
    copias:          data.copias,
    detalle_count:   data.detalle.length,
    total_unidades:  data.detalle.reduce((s, d) => s + Math.abs(Number(d.cantidad) || 0), 0),
    valor_declarado: data.remito.valor_declarado,
    empresa:         data.empresa ? { razon_social: data.empresa.razon_social, cuit: data.empresa.cuit } : null,
  }
}

/**
 * Renderiza el PDF del remito, calcula hash SHA-256 y lo sube al bucket.
 * upsert:false por defecto (el remito emitido jamás se sobreescribe);
 * upsert:true solo desde el endpoint de regeneración para huérfanos.
 */
export async function generarYSubirRemitoPDF(
  supabase: SupabaseClient,
  remitoId: string,
  data: RemitoPDFData,
  opts?: { upsert?: boolean },
): Promise<{ pdfUrl: string; pdfPath: string; pdfHash: string }> {
  const element = React.createElement(RemitoPDF, { data }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
  const buffer  = await renderToBuffer(element)
  const pdfHash = calcularHashPDF(buffer)
  const pdfPath = `${data.remito.tipo_remito}_${data.remito.numero_remito.replace('-', '_')}_${remitoId}.pdf`

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(pdfPath, buffer, {
      contentType: 'application/pdf',
      upsert:      opts?.upsert ?? false,
    })
  if (uploadErr) throw new Error(`Error subiendo PDF del remito: ${uploadErr.message}`)

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pdfPath, 31_536_000)
  if (signErr || !signed?.signedUrl) {
    throw new Error(`Error firmando URL del PDF del remito: ${signErr?.message}`)
  }

  await supabase
    .from('remitos')
    .update({
      pdf_url:              signed.signedUrl,
      pdf_path:             pdfPath,
      pdf_hash:             pdfHash,
      pdf_snapshot:         buildRemitoSnapshot(data),
      estado_pdf:           'generado',
      fecha_generacion_pdf: new Date().toISOString(),
    })
    .eq('id', remitoId)

  return { pdfUrl: signed.signedUrl, pdfPath, pdfHash }
}
