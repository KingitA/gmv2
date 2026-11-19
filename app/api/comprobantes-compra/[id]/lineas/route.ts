import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth, requirePermiso } from '@/lib/auth'
import { cuentaRenglon, factorDeUnidad, faltaEnRenglon, type UnidadRenglon } from '@/lib/compras/renglon-manual'
import { tipoDescuentoProveedor } from '@/lib/compras/tipo-descuento-proveedor'
import { netoCompra } from '@/lib/compras/neto-compra'
import { sumarDocumentado } from '@/lib/compras/documentado'

/**
 * Renglones de un comprobante de compra, a mano (prueba en producción del 18/11).
 *
 *   GET    → { lineas[], articulos_oc[], tipo_descuento, editable }   todo lo que necesita el diálogo
 *   POST   { articulo_id, cantidad, unidad, precio_unitario, descuento1..4 }            agrega
 *   PATCH  { linea_id, cantidad, unidad, precio_unitario, descuento1..4 }               corrige
 *   DELETE { linea_id }                                                                 borra
 *
 * `unidad` = 'unidad' | 'bulto': en qué está la cantidad Y el precio (como en la factura). Antes la
 * cantidad se tomaba en la unidad de la orden sin decirlo. Solo comprobantes SIN validar.
 * Cada alta, corrección o borrado queda anotado con quién lo hizo (comprobantes_compra_cambios,
 * migración 20261118a; si la tabla no está, se hace igual y queda en el registro del servidor).
 * La cantidad documentada de la recepción se acomoda sola (en unidades base).
 */

const CREDITOS = ['NC', 'NCA', 'NCB', 'NCC', 'Reversa']
const VALIDADO = ['validado', 'cerrado']
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

async function cargarComprobante(supabase: any, id: string) {
  const { data } = await supabase
    .from('comprobantes_compra')
    .select('id, orden_compra_id, proveedor_id, tipo_comprobante, numero_comprobante, estado, orden_compra:ordenes_compra(proveedor_id)')
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  const oc: any = Array.isArray(data.orden_compra) ? data.orden_compra[0] : data.orden_compra
  return { ...data, proveedor: (data.proveedor_id || oc?.proveedor_id || null) as string | null }
}

async function anotar(supabase: any, fila: { comprobante_id: string; detalle_id: string | null; accion: 'agregar' | 'editar' | 'borrar'; antes: any; despues: any; usuario_id: string }) {
  const { error } = await supabase.from('comprobantes_compra_cambios').insert(fila)
  if (error) console.warn(`[renglones] no se pudo anotar el cambio (${fila.accion} por ${fila.usuario_id}): ${error.message}`, JSON.stringify({ antes: fila.antes, despues: fila.despues }))
}

/** Unidades base de un renglón guardado: los bultos se convierten con el factor de su línea de recepción o del artículo. */
async function unidadesBaseDe(supabase: any, linea: any): Promise<number> {
  if (linea.tipo_cantidad !== 'bulto') return num(linea.cantidad_facturada)
  let factor = 0
  if (linea.recepcion_item_id) {
    const { data: it } = await supabase.from('recepciones_items').select('factor_conversion').eq('id', linea.recepcion_item_id).maybeSingle()
    factor = num(it?.factor_conversion)
  }
  if (!(factor > 1) && linea.articulo_id) {
    const { data: a } = await supabase.from('articulos').select('unidades_por_bulto').eq('id', linea.articulo_id).maybeSingle()
    factor = num(a?.unidades_por_bulto)
  }
  return num(linea.cantidad_facturada) * (factor > 1 ? factor : 1)
}

/** Suma (o resta) unidades a lo documentado de la línea de recepción, en un solo paso en la base. */
async function moverDocumentado(supabase: any, recepcionItemId: string | null, delta: number) {
  await sumarDocumentado(supabase, recepcionItemId, delta)
}

/** Línea de recepción del artículo en la orden (preferir la fila real de la orden con recepción física). */
async function lineaDeRecepcion(supabase: any, ordenId: string | null, articuloId: string): Promise<string | null> {
  if (!ordenId) return null
  const { data: recs } = await supabase.from('recepciones').select('id').eq('orden_compra_id', ordenId).neq('estado', 'cancelada')
  const recIds = (recs ?? []).map((r: any) => r.id)
  if (!recIds.length) return null
  const { data: items } = await supabase.from('recepciones_items').select('id, cantidad_fisica, fuera_de_oc').eq('articulo_id', articuloId).in('recepcion_id', recIds)
  const item = (items ?? []).find((i: any) => !i.fuera_de_oc && num(i.cantidad_fisica) > 0) || (items ?? []).find((i: any) => !i.fuera_de_oc) || (items ?? [])[0]
  return item?.id ?? null
}

function leerRenglon(body: any) {
  return {
    cantidad: num(body.cantidad),
    unidad: (body.unidad === 'bulto' ? 'bulto' : body.unidad === 'unidad' ? 'unidad' : null) as UnidadRenglon | null,
    precio_unitario: num(body.precio_unitario),
    descuentos: [body.descuento1, body.descuento2, body.descuento3, body.descuento4].map(num),
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { id } = await params
  try {
    const supabase = createAdminClient()
    const comp = await cargarComprobante(supabase, id)
    if (!comp) return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 })
    const tipoDescuento = await tipoDescuentoProveedor(supabase, comp.proveedor)

    const { data: lineas, error } = await supabase
      .from('comprobantes_compra_detalle')
      .select('*, articulo:articulos!comprobantes_compra_detalle_articulo_id_fkey(id, sku, descripcion, unidades_por_bulto)')
      .eq('comprobante_id', id)
      .order('created_at', { ascending: true })
    if (error) throw error

    let articulosOC: any[] = []
    if (comp.orden_compra_id) {
      const { data: det } = await supabase
        .from('ordenes_compra_detalle')
        .select('articulo_id, cantidad_pedida, tipo_cantidad, precio_unitario, descuento1, descuento2, descuento3, descuento4, articulo:articulos(sku, descripcion, unidades_por_bulto)')
        .eq('orden_compra_id', comp.orden_compra_id)
      articulosOC = (det || []).map((d: any) => {
        const a = Array.isArray(d.articulo) ? d.articulo[0] : d.articulo
        return {
          articulo_id: d.articulo_id, sku: a?.sku ?? null, descripcion: a?.descripcion ?? null, unidades_por_bulto: num(a?.unidades_por_bulto) || null,
          cantidad_pedida: num(d.cantidad_pedida), tipo_cantidad: d.tipo_cantidad || 'bulto', precio_unitario: num(d.precio_unitario),
          descuentos: [d.descuento1, d.descuento2, d.descuento3, d.descuento4].map(num),
        }
      })
    }

    return NextResponse.json({
      editable: !VALIDADO.includes(comp.estado),
      tipo_descuento: tipoDescuento,
      articulos_oc: articulosOC,
      lineas: (lineas || []).map((l: any) => {
        const a = Array.isArray(l.articulo) ? l.articulo[0] : l.articulo
        const descuentos = [l.descuento1, l.descuento2, l.descuento3, l.descuento4].map(num)
        return {
          id: l.id, articulo_id: l.articulo_id, sku: a?.sku ?? null, descripcion: a?.descripcion ?? l.descripcion_proveedor ?? null,
          descripcion_proveedor: l.descripcion_proveedor ?? null, unidades_por_bulto: num(a?.unidades_por_bulto) || null,
          cantidad: num(l.cantidad_facturada), unidad: l.tipo_cantidad === 'bulto' ? 'bulto' : 'unidad',
          precio_unitario: num(l.precio_unitario), descuentos, match_estado: l.match_estado,
          importe: r2(num(l.cantidad_facturada) * netoCompra(l.precio_unitario, descuentos, tipoDescuento)),
        }
      }),
    })
  } catch (error: any) {
    console.error('[renglones GET]', error)
    return NextResponse.json({ error: `No se pudieron cargar los renglones. Detalle para sistemas: ${error.message || error}` }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso('compras')
  if (auth.error) return auth.error
  const { id: comprobanteId } = await params
  try {
    const body = await request.json().catch(() => ({}))
    const articuloId = body.articulo_id
    if (!articuloId) return NextResponse.json({ error: 'Elegí el artículo.' }, { status: 400 })

    const supabase = createAdminClient()
    const comp = await cargarComprobante(supabase, comprobanteId)
    if (!comp) return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 })
    if (VALIDADO.includes(comp.estado)) return NextResponse.json({ error: 'El comprobante ya está validado: no se le pueden agregar renglones.' }, { status: 409 })
    if (CREDITOS.includes(comp.tipo_comprobante)) return NextResponse.json({ error: 'Los renglones de una nota de crédito se cargan desde el circuito de notas de crédito.' }, { status: 400 })

    const { data: art } = await supabase.from('articulos').select('id, sku, descripcion, unidades_por_bulto').eq('id', articuloId).maybeSingle()
    if (!art) return NextResponse.json({ error: 'Artículo no encontrado' }, { status: 404 })

    const r = leerRenglon(body)
    const falta = faltaEnRenglon({ ...r, unidad: r.unidad ?? undefined }, art.unidades_por_bulto)
    if (falta) return NextResponse.json({ error: falta }, { status: 400 })
    const unidad = r.unidad as UnidadRenglon
    const tipoDescuento = await tipoDescuentoProveedor(supabase, comp.proveedor)
    const cuenta = cuentaRenglon({ ...r, unidad }, art.unidades_por_bulto, tipoDescuento)

    const recepcionItemId = await lineaDeRecepcion(supabase, comp.orden_compra_id, articuloId)
    const fila = {
      comprobante_id: comprobanteId,
      articulo_id: articuloId,
      articulo_sugerido_id: null,
      cantidad_facturada: r.cantidad,
      precio_unitario: r.precio_unitario,
      descuento1: r.descuentos[0], descuento2: r.descuentos[1], descuento3: r.descuentos[2], descuento4: r.descuentos[3],
      costo_final: r2(cuenta.neto),
      descripcion_proveedor: art.descripcion,
      tipo_cantidad: unidad,
      match_estado: 'manual',
      recepcion_item_id: recepcionItemId,
      iva_porcentaje: ['Adquisicion', 'ADQ'].includes(comp.tipo_comprobante) ? 0 : 21,
    }
    const { data: linea, error: insErr } = await supabase.from('comprobantes_compra_detalle').insert(fila).select('id').single()
    if (insErr) throw insErr

    // Lo documentado de la recepción va SIEMPRE en unidades base. Si el renglón es por bulto, la
    // línea de recepción queda con el factor que se usó (lo lee la verificación).
    if (recepcionItemId) {
      await moverDocumentado(supabase, recepcionItemId, cuenta.unidades)
      if (unidad === 'bulto') await supabase.from('recepciones_items').update({ factor_conversion: factorDeUnidad(unidad, art.unidades_por_bulto) }).eq('id', recepcionItemId)
    }
    await anotar(supabase, { comprobante_id: comprobanteId, detalle_id: linea.id, accion: 'agregar', antes: null, despues: { ...fila, unidades: cuenta.unidades, importe: cuenta.importe }, usuario_id: auth.user.id })

    return NextResponse.json({ success: true, linea_id: linea.id, recepcion_documentada: !!recepcionItemId, unidades: cuenta.unidades, importe: cuenta.importe })
  } catch (error: any) {
    console.error('[renglones POST]', error)
    return NextResponse.json({ error: `No se pudo agregar el renglón. Detalle para sistemas: ${error.message || error}` }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso('compras')
  if (auth.error) return auth.error
  const { id: comprobanteId } = await params
  try {
    const body = await request.json().catch(() => ({}))
    if (!body.linea_id) return NextResponse.json({ error: 'Falta el renglón.' }, { status: 400 })
    const supabase = createAdminClient()
    const comp = await cargarComprobante(supabase, comprobanteId)
    if (!comp) return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 })
    if (VALIDADO.includes(comp.estado)) return NextResponse.json({ error: 'El comprobante ya está validado: no se le pueden cambiar renglones.' }, { status: 409 })

    const { data: antes } = await supabase.from('comprobantes_compra_detalle').select('*').eq('id', body.linea_id).eq('comprobante_id', comprobanteId).maybeSingle()
    if (!antes) return NextResponse.json({ error: 'Ese renglón ya no existe.' }, { status: 404 })

    // UN solo factor de bulto para lo que había y para lo nuevo: el que ya usó la línea de recepción
    // (si el renglón estaba por bulto) y, si no hay, las unidades por bulto del artículo. Así la
    // diferencia que se le suma a lo documentado es coherente, y el factor de la recepción no se toca.
    let upb: number | null = null
    if (antes.recepcion_item_id) {
      const { data: it } = await supabase.from('recepciones_items').select('factor_conversion').eq('id', antes.recepcion_item_id).maybeSingle()
      if (num(it?.factor_conversion) > 1) upb = num(it?.factor_conversion)
    }
    if (!upb && antes.articulo_id) {
      const { data: art } = await supabase.from('articulos').select('unidades_por_bulto').eq('id', antes.articulo_id).maybeSingle()
      upb = num(art?.unidades_por_bulto) || null
    }
    const r = leerRenglon(body)
    const falta = faltaEnRenglon({ ...r, unidad: r.unidad ?? undefined }, upb)
    if (falta) return NextResponse.json({ error: falta }, { status: 400 })
    const unidad = r.unidad as UnidadRenglon
    const tipoDescuento = await tipoDescuentoProveedor(supabase, comp.proveedor)
    const cuenta = cuentaRenglon({ ...r, unidad }, upb, tipoDescuento)

    const unidadesAntes = antes.articulo_id ? num(antes.cantidad_facturada) * factorDeUnidad(antes.tipo_cantidad, upb) : 0
    const cambios = {
      cantidad_facturada: r.cantidad,
      precio_unitario: r.precio_unitario,
      descuento1: r.descuentos[0], descuento2: r.descuentos[1], descuento3: r.descuentos[2], descuento4: r.descuentos[3],
      costo_final: r2(cuenta.neto),
      tipo_cantidad: unidad,
    }
    const { error: updErr } = await supabase.from('comprobantes_compra_detalle').update(cambios).eq('id', antes.id)
    if (updErr) throw updErr

    if (antes.articulo_id && antes.recepcion_item_id) {
      await moverDocumentado(supabase, antes.recepcion_item_id, cuenta.unidades - unidadesAntes)
    }
    await anotar(supabase, {
      comprobante_id: comprobanteId, detalle_id: antes.id, accion: 'editar',
      antes: { cantidad_facturada: antes.cantidad_facturada, precio_unitario: antes.precio_unitario, descuento1: antes.descuento1, descuento2: antes.descuento2, descuento3: antes.descuento3, descuento4: antes.descuento4, tipo_cantidad: antes.tipo_cantidad, unidades: unidadesAntes },
      despues: { ...cambios, unidades: cuenta.unidades, importe: cuenta.importe }, usuario_id: auth.user.id,
    })
    return NextResponse.json({ success: true, unidades: cuenta.unidades, importe: cuenta.importe })
  } catch (error: any) {
    console.error('[renglones PATCH]', error)
    return NextResponse.json({ error: `No se pudo corregir el renglón. Detalle para sistemas: ${error.message || error}` }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso('compras')
  if (auth.error) return auth.error
  const { id: comprobanteId } = await params
  try {
    const body = await request.json().catch(() => ({}))
    if (!body.linea_id) return NextResponse.json({ error: 'Falta el renglón.' }, { status: 400 })
    const supabase = createAdminClient()
    const comp = await cargarComprobante(supabase, comprobanteId)
    if (!comp) return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 })
    if (VALIDADO.includes(comp.estado)) return NextResponse.json({ error: 'El comprobante ya está validado: no se le pueden borrar renglones.' }, { status: 409 })

    const { data: antes } = await supabase.from('comprobantes_compra_detalle').select('*').eq('id', body.linea_id).eq('comprobante_id', comprobanteId).maybeSingle()
    if (!antes) return NextResponse.json({ success: true, ya_borrado: true })
    const unidadesAntes = antes.articulo_id ? await unidadesBaseDe(supabase, antes) : 0

    const { data: borradas, error: delErr } = await supabase.from('comprobantes_compra_detalle').delete().eq('id', antes.id).select('id')
    if (delErr) throw delErr
    // Solo si de verdad se borró (dos personas a la vez: una sola descuenta lo documentado)
    if (borradas && borradas.length > 0) {
      if (antes.recepcion_item_id) await moverDocumentado(supabase, antes.recepcion_item_id, -unidadesAntes)
      await anotar(supabase, { comprobante_id: comprobanteId, detalle_id: antes.id, accion: 'borrar', antes: { ...antes, unidades: unidadesAntes }, despues: null, usuario_id: auth.user.id })
    }
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[renglones DELETE]', error)
    return NextResponse.json({ error: `No se pudo borrar el renglón. Detalle para sistemas: ${error.message || error}` }, { status: 500 })
  }
}
