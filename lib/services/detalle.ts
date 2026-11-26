import { MatchingEngine } from '@/lib/matching/matcher';
import { sumarDocumentado } from '@/lib/compras/documentado';
import { faltaLaFuncion } from '@/lib/utils/migracion-pendiente';
import { resolveFactorConversion } from '@/lib/services/conversion';
import { autoVincularPorOrden } from '@/lib/compras/vincular-renglon';

// El OCR a veces devuelve el descuento como MONTO en pesos en vez de %.
// Las columnas descuentoN son numeric(5,2): un monto grande revienta el insert.
// Heurística: >100 no es un porcentaje → convertirlo a % sobre precio × cantidad.
export function normalizarDescuentoPct(descuento: any, precioUnitario: any, cantidad: any): number {
    const d = Number(descuento || 0);
    if (d <= 0) return 0;
    if (d <= 100) return Math.round(d * 100) / 100;
    const base = Number(precioUnitario || 0) * Number(cantidad || 0);
    if (base <= 0) return 0;
    const pct = (d / base) * 100;
    return Math.min(99.99, Math.round(pct * 100) / 100);
}

// Matches OCR items against catalog, creates comprobantes_compra_detalle rows,
// and updates recepciones_items with documented prices/quantities.
// Used by both the ERP documents route and the deposito OCR route.
// Persists EVERY line (matched or not) with suggestion metadata so the
// "Revisar matches" UI can correct them and feed the learning loop.
export async function matchAndCreateDetalle(supabase: any, params: {
    comprobante_id: string;
    recepcion_id: string;
    proveedor_id: string;
    items: any[];
    documento_id?: string;
}) {
    const engine = new MatchingEngine();

    // Buscar items en TODAS las tandas de la OC, no solo la recepción actual:
    // la factura puede llegar en una tanda posterior a la que escaneó la
    // mercadería (multi-tanda) y la documentación debe caer sobre la fila real.
    const { data: recActual } = await supabase
        .from('recepciones')
        .select('orden_compra_id')
        .eq('id', params.recepcion_id)
        .maybeSingle();

    let recepcionIds = [params.recepcion_id];
    if (recActual?.orden_compra_id) {
        const { data: todas } = await supabase
            .from('recepciones')
            .select('id')
            .eq('orden_compra_id', recActual.orden_compra_id)
            .neq('estado', 'cancelada');
        if (todas?.length) recepcionIds = todas.map((r: any) => r.id);
    }

    const { data: recItems } = await supabase
        .from('recepciones_items')
        .select('*, articulo:articulos(id, sku, unidades_por_bulto, precio_compra, iva_compras)')
        .in('recepcion_id', recepcionIds);

    const { data: proveedor } = await supabase
        .from('proveedores')
        .select('default_unidad_factura')
        .eq('id', params.proveedor_id)
        .maybeSingle();

    // iva_porcentaje es NOT NULL sin default: obligatorio en cada fila.
    // Adquisición/Reversa van sin IVA; el resto 21% (único IVA del proyecto).
    const { data: compData } = await supabase
        .from('comprobantes_compra')
        .select('tipo_comprobante')
        .eq('id', params.comprobante_id)
        .maybeSingle();
    const ivaPorcentaje = ['Adquisicion', 'Reversa', 'ADQ', 'REV'].includes(compData?.tipo_comprobante) ? 0 : 21;

    const currentRecItems: any[] = recItems || [];
    // Cada fila = el renglón del comprobante + lo que le suma a la recepción. Se guardan JUNTOS, al
    // final, en una sola transacción (comprobante_detalle_cargar, migración 20261119b): si el
    // servidor se corta a mitad de la lectura no quedan sumas sin renglón.
    const filas: Array<{ detalle: any; crear_linea: boolean; documentado: any | null; aviso?: any }> = [];
    const matched: any[] = [];

    // Artículos de la ORDEN: el matching busca primero ahí, después en el proveedor (lib/matching/compra.ts)
    let ordenArticuloIds: string[] = [];
    if (recActual?.orden_compra_id) {
        const { data: ocDet } = await supabase.from('ordenes_compra_detalle').select('articulo_id').eq('orden_compra_id', recActual.orden_compra_id);
        ordenArticuloIds = [...new Set(((ocDet || []) as any[]).map((d) => d.articulo_id).filter(Boolean))] as string[];
    }

    for (const item of params.items) {
        const matchResult = await engine.resolveItem(
            { description: item.descripcion, code: item.codigo, ean: item.ean, price: item.precio_unitario },
            params.proveedor_id,
            { ordenArticuloIds },
        );

        const best = matchResult.bestCandidate;
        const isMatched = matchResult.status === 'matched' && !!best?.sku_id && !best?.otro_proveedor;
        const isSuggestion = !isMatched && !!best?.sku_id && (best.confidence_level === 'suggestion' || (!!best.otro_proveedor && best.confidence_level !== 'low'));

        // Coherencia de precios contra el IMPORTE de línea (el dato más confiable
        // de la factura). Detecta cuando el OCR extrajo el unitario YA NETO y
        // también las bonificaciones — sin este control se descontaba dos veces.
        let precioUnitario = Number(item.precio_unitario || 0);
        let descuentoPct = normalizarDescuentoPct(item.descuento, item.precio_unitario, item.cantidad);
        const totalLinea = Number(item.total_linea || 0);
        const cantidadItem = Number(item.cantidad || 0);
        if (totalLinea > 0 && cantidadItem > 0 && precioUnitario > 0) {
            const netoReal = totalLinea / cantidadItem;
            const err = (x: number) => Math.abs(x - netoReal) / netoReal;
            if (err(precioUnitario * (1 - descuentoPct / 100)) > 0.01) {
                if (err(precioUnitario) <= 0.01) {
                    // El precio extraído ya venía con las bonificaciones aplicadas
                    descuentoPct = 0;
                } else {
                    // Nada cuadra: confiar en importe ÷ cantidad
                    precioUnitario = Math.round(netoReal * 100) / 100;
                    descuentoPct = 0;
                }
            }
        }
        const precioNeto = Math.round(precioUnitario * (1 - descuentoPct / 100) * 100) / 100;

        const baseRow = {
            comprobante_id: params.comprobante_id,
            cantidad_facturada: item.cantidad || 1,
            precio_unitario: precioUnitario,
            descuento1: descuentoPct,
            descripcion_proveedor: item.descripcion,
            codigo_proveedor: item.codigo,
            iva_porcentaje: ivaPorcentaje,
            match_score: best?.score ?? null,
        };

        if (!isMatched) {
            filas.push({
                detalle: {
                    ...baseRow,
                    articulo_id: null,
                    articulo_sugerido_id: isSuggestion ? best!.sku_id : null,
                    match_estado: isSuggestion ? 'sugerido' : 'sin_match',
                    recepcion_item_id: null,
                    tipo_cantidad: 'unidad',
                    costo_final: precioNeto,
                },
                crear_linea: false,
                documentado: null,
            });
            continue;
        }

        const articuloId = best!.sku_id;
        // Preferir la fila real de la OC (no fuera_de_oc); entre varias tandas,
        // la que tenga recepción física; última opción, cualquiera.
        const candidatas = currentRecItems.filter((ri: any) => ri.articulo_id === articuloId);
        let recItem =
            candidatas.find((ri: any) => !ri.fuera_de_oc && Number(ri.cantidad_fisica || 0) > 0) ||
            candidatas.find((ri: any) => !ri.fuera_de_oc) ||
            candidatas[0];

        // Ítem facturado que no estaba en la OC: la línea de recepción (fuera de la orden) se crea
        // JUNTO con el renglón, para que depósito y verificación la vean. Acá solo se leen los datos
        // del artículo que hacen falta para convertir bultos.
        const crearLinea = !recItem;
        let articulo = recItem?.articulo;
        if (!recItem) {
            const { data: art } = await supabase.from('articulos').select('id, sku, unidades_por_bulto, precio_compra, iva_compras').eq('id', articuloId).maybeSingle();
            articulo = art;
        }

        const conversion = resolveFactorConversion({
            proveedorDefaultUnidad: proveedor?.default_unidad_factura,
            articuloUnidadesPorBulto: articulo?.unidades_por_bulto,
            descripcionOcr: item.descripcion,
            ocrUnidadMedida: item.unidad_medida,
            precioDocumento: item.precio_unitario,
            costoBaseArticulo: articulo?.precio_compra,
        });

        const cantBase = (item.cantidad || 0) * conversion.factor;

        filas.push({
            detalle: {
                ...baseRow,
                articulo_id: articuloId,
                articulo_sugerido_id: null,
                match_estado: 'auto',
                recepcion_item_id: recItem?.id ?? null,
                tipo_cantidad: conversion.factor === 1 ? 'unidad' : 'bulto',
                costo_final: precioNeto,
            },
            crear_linea: crearLinea,
            // Acumular (no pisar): puede haber varios documentos por recepción
            documentado: {
                delta: cantBase,
                precio_documentado: precioNeto,
                precio_real: precioNeto || recItem?.precio_oc || 0,
                cantidad_base: cantBase,
                factor_conversion: conversion.factor,
                conversion_source: conversion.source,
                requires_review: conversion.requiresReview,
            },
            aviso: conversion.requiresReview ? {
                recepcion_id: params.recepcion_id,
                documento_id: params.documento_id,
                proveedor_id: params.proveedor_id,
                articulo_id: articuloId,
                descripcion_ocr: item.descripcion || '',
                cantidad_ocr: item.cantidad,
                warning_type: conversion.warningType || '',
                warning_message: conversion.warningMessage || '',
                conversion_attempted: conversion,
            } : null,
        });

        matched.push({ articulo_id: articuloId, descripcion: item.descripcion });
    }

    // Renglones leídos que NO se pudieron guardar: se devuelven para avisarlos en pantalla
    // (antes solo quedaban en el registro del servidor y el comprobante salía con un renglón menos).
    const descartados: Array<{ descripcion: string; motivo: string }> = [];
    let guardados = 0;
    if (filas.length > 0) {
        const rpc = await supabase.rpc('comprobante_detalle_cargar', {
            p_comprobante_id: params.comprobante_id,
            p_recepcion_id: params.recepcion_id,
            p_filas: filas.map(({ aviso: _aviso, ...f }) => f),
        });
        if (!rpc.error) {
            guardados = Number(rpc.data?.guardados || 0);
            for (const d of (rpc.data?.descartados || []) as any[]) descartados.push({ descripcion: String(d.descripcion || '(sin descripción)'), motivo: String(d.motivo || '') });
        } else if (faltaLaFuncion(rpc.error, 'comprobante_detalle_cargar')) {
            // Sin la migración 20261119b: fila por fila desde el servidor (renglón y, enseguida, su suma)
            for (const f of filas) {
                let itemId: string | null = f.detalle.recepcion_item_id;
                if (!itemId && f.crear_linea) {
                    const { data: existente } = await supabase.from('recepciones_items').select('id').eq('recepcion_id', params.recepcion_id).eq('articulo_id', f.detalle.articulo_id).limit(1);
                    itemId = existente?.[0]?.id ?? null;
                    if (!itemId) {
                        const { data: nueva } = await supabase.from('recepciones_items')
                            .insert({ recepcion_id: params.recepcion_id, articulo_id: f.detalle.articulo_id, cantidad_oc: 0, cantidad_fisica: 0, estado_linea: 'pendiente', fuera_de_oc: true })
                            .select('id').single();
                        itemId = nueva?.id ?? null;
                    }
                }
                const { error: rowError } = await supabase.from('comprobantes_compra_detalle').insert({ ...f.detalle, recepcion_item_id: itemId });
                if (rowError) {
                    console.error('[matchAndCreateDetalle] Fila descartada:', rowError.message, f.detalle.descripcion_proveedor);
                    descartados.push({ descripcion: String(f.detalle.descripcion_proveedor || f.detalle.codigo_proveedor || '(sin descripción)'), motivo: rowError.message });
                    continue;
                }
                guardados++;
                if (itemId && f.documentado) {
                    const { delta, ...datos } = f.documentado;
                    await sumarDocumentado(supabase, itemId, delta, datos);
                }
            }
        } else {
            // No se guardó ninguno (la transacción se deshizo entera): se avisan todos
            console.error('[matchAndCreateDetalle] no se pudieron guardar los renglones:', rpc.error.message);
            for (const f of filas) descartados.push({ descripcion: String(f.detalle.descripcion_proveedor || f.detalle.codigo_proveedor || '(sin descripción)'), motivo: rpc.error.message });
        }

        // Avisos de conversión de bultos (no son plata ni stock: van aparte)
        const avisos = filas.map((f) => f.aviso).filter(Boolean);
        if (avisos.length > 0 && guardados > 0) {
            const { error } = await supabase.from('ocr_conversion_warnings').insert(avisos);
            if (error) console.error('[matchAndCreateDetalle] warning insert error:', error.message);
        }
    }

    // Renglones que el matching no resolvió pero coinciden en cantidad y precio con UN SOLO artículo
    // de la orden: se vinculan solos (aprendiendo la equivalencia), sin esperar a que alguien abra
    // la verificación (lib/compras/vincular-renglon.ts). No tira: si falla quedan para vincular a mano.
    if (guardados > 0 && recActual?.orden_compra_id) {
        await autoVincularPorOrden(supabase, params.comprobante_id);
    }

    return Object.assign(matched, { descartados, renglones_leidos: params.items.length, renglones_guardados: guardados });
}

// Revierte lo que el OCR de un documento aplicó: resta cantidades documentadas
// de recepciones_items (vía comprobantes_compra_detalle.recepcion_item_id) y
// elimina detalle + comprobante creado por ese documento.
// Devuelve error si el comprobante ya fue validado (tiene CC/vencimientos).
// La deuda que dejó el mail (sin validar) la deshace comprobante_compra_deshacer_deuda (20261119o).
export async function revertirComprobanteOCR(supabase: any, comprobante_id: string, opts: { usuarioId?: string | null } = {}): Promise<{ error?: string }> {
    const { data: comprobante } = await supabase
        .from('comprobantes_compra')
        .select('id, estado')
        .eq('id', comprobante_id)
        .maybeSingle();

    if (!comprobante) return {};
    if (comprobante.estado === 'validado' || comprobante.estado === 'cerrado') {
        return { error: 'El comprobante ya fue validado — anulá la validación antes de eliminar el documento' };
    }

    // Deuda que dejó el mail en la cuenta corriente (referencia_tipo 'comprobante_compra'): ANTES de
    // borrar nada vuelve a la provisión de la orden (o se quita), en una transacción. Antes quedaba
    // huérfana y, al volver a cargar el comprobante, la deuda quedaba dos veces (revisión 19/11).
    // Si después falla el borrado, el comprobante queda sin deuda y al validarlo nace una sola vez.
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const deshacer = await createAdminClient().rpc('comprobante_compra_deshacer_deuda', { p_comprobante_id: comprobante_id, p_usuario_id: opts.usuarioId ?? null });
    if (deshacer.error) {
        if (!faltaLaFuncion(deshacer.error, 'comprobante_compra_deshacer_deuda')) {
            if (deshacer.error.code === 'P0001') return { error: deshacer.error.message };
            return { error: `No se pudo deshacer la deuda del comprobante en la cuenta corriente; no se eliminó nada. Detalle para sistemas: ${deshacer.error.message}` };
        }
        // Migración 20261119o sin aplicar: solo se frena si hay deuda vinculada (borrarlo la dejaría huérfana)
        const { count } = await supabase.from('cuenta_corriente_proveedores')
            .select('id', { count: 'exact', head: true })
            .eq('referencia_tipo', 'comprobante_compra').eq('referencia_id', comprobante_id);
        if ((count ?? 0) > 0) {
            return { error: 'Este comprobante entró por mail y ya tiene su deuda en la cuenta corriente del proveedor: todavía no se puede eliminar sin duplicarla al volver a cargarlo (falta aplicar la migración 20261119o). No se eliminó nada.' };
        }
    }

    const { data: detalle } = await supabase
        .from('comprobantes_compra_detalle')
        .select('id, recepcion_item_id, cantidad_facturada, tipo_cantidad')
        .eq('comprobante_id', comprobante_id);

    for (const det of detalle || []) {
        if (!det.recepcion_item_id) continue;
        const { data: item } = await supabase
            .from('recepciones_items')
            .select('id, cantidad_documentada, factor_conversion, fuera_de_oc, cantidad_fisica')
            .eq('id', det.recepcion_item_id)
            .maybeSingle();
        if (!item) continue;

        // Misma convención que al sumar: solo un renglón 'bulto' se multiplica por el factor de la línea
        const factor = det.tipo_cantidad === 'bulto' ? Number(item.factor_conversion || 1) : 1;
        const restar = Number(det.cantidad_facturada || 0) * factor;
        // La resta también la hace la base en un solo paso (otro documento puede estar sumando)
        const nuevaCant = (await sumarDocumentado(supabase, item.id, -restar)) ?? 0;

        // Línea creada solo por este documento (fuera de OC, sin recepción física): eliminarla.
        // La condición va en el mismo DELETE: si otro documento le sumó recién, no se borra.
        if (item.fuera_de_oc && nuevaCant === 0 && Number(item.cantidad_fisica || 0) === 0) {
            await supabase.from('recepciones_items').delete().eq('id', item.id).eq('cantidad_documentada', 0);
        }
    }

    await supabase.from('comprobantes_compra_detalle').delete().eq('comprobante_id', comprobante_id);
    await supabase.from('comprobantes_compra').delete().eq('id', comprobante_id);
    return {};
}
