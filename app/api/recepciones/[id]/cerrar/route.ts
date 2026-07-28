import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { insertarKardex } from '@/lib/kardex/insertar-kardex';
import { nowArgentina } from '@/lib/utils';

// POST /api/recepciones/[id]/cerrar
// Body: {
//   decisions: [{
//     item_id: string,
//     tipo: 'precio' | 'mercaderia',
//     accion: 'A' | 'B' | 'C' | 'D',  // A=empresa, B=transporte, C=proveedor, D=descuento fuera de factura (solo precio)
//     transporte_id?: string,    // for accion B
//     valor_real: number,        // real quantity or price
//     descripcion?: string,
//   }]
// }
//
// Las imputaciones al proveedor NO acreditan la CC directamente: crean una NC
// 'esperada' (comprobantes_compra estado=esperada, origen_nc) que se confirma
// con ncp_registrar cuando llega el documento y se imputa contra la factura
// con ccp_imputar_credito. Así la CC refleja la deuda real hasta que la NC llega.

async function crearNCEsperada(supabase: any, params: {
    proveedor_id: string;
    orden_compra_id?: string | null;
    monto: number;
    origen: 'descuento_fuera_factura' | 'faltante' | 'devolucion' | 'diferencia_precio';
    descripcion?: string;
    ajusta_stock?: boolean;
}) {
    // Factura asociada: el último débito validado/cargado de la OC
    let asociadoId: string | null = null;
    if (params.orden_compra_id) {
        const { data: fa } = await supabase
            .from('comprobantes_compra')
            .select('id')
            .eq('orden_compra_id', params.orden_compra_id)
            .not('tipo_comprobante', 'in', '(NC,NCA,NCB,NCC,Reversa)')
            .neq('estado', 'esperada')
            .order('fecha_comprobante', { ascending: false })
            .limit(1)
            .maybeSingle();
        asociadoId = fa?.id || null;
    }

    const { data: nc, error } = await supabase.from('comprobantes_compra').insert({
        orden_compra_id: params.orden_compra_id || null,
        proveedor_id: params.proveedor_id,
        tipo_comprobante: 'NC',
        numero_comprobante: `ESPERADA-${Date.now()}`,
        fecha_comprobante: nowArgentina().slice(0, 10),
        total_factura_declarado: Math.round(params.monto * 100) / 100,
        total_neto: Math.round(params.monto * 100) / 100,
        total_iva: 0,
        estado: 'esperada',
        origen_nc: params.origen,
        comprobante_asociado_id: asociadoId,
        ajusta_stock: params.ajusta_stock ?? false,
        foto_url: null,
    }).select('id').single();

    if (error) console.error('[cerrar] Error creando NC esperada:', error.message);
    return nc?.id || null;
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: recepcion_id } = await params;
        const body = await request.json();
        const { decisions } = body as { decisions: any[] };

        if (!decisions || decisions.length === 0) {
            return NextResponse.json({ error: 'decisions es requerido' }, { status: 400 });
        }

        const supabase = createAdminClient();

        const { data: recepcion } = await supabase
            .from('recepciones')
            .select('proveedor_id, transporte_id, orden_compra:ordenes_compra(id, proveedor_id)')
            .eq('id', recepcion_id)
            .single();

        const proveedorId = recepcion?.proveedor_id || (recepcion?.orden_compra as any)?.proveedor_id;
        const ocId = (recepcion?.orden_compra as any)?.id;
        // Transporte por defecto: el registrado en el control de bultos de la recepción
        const transporteDefault = recepcion?.transporte_id || null;

        const results = [];

        for (const decision of decisions) {
            const { item_id, tipo, accion, transporte_id, valor_real, descripcion } = decision;

            const { data: item } = await supabase
                .from('recepciones_items')
                .select(`articulo_id, precio_real, precio_oc, precio_documentado, cantidad_documentada, cantidad_fisica,
                    articulo:articulos(sku, descripcion, categoria, marca_id, proveedor_id, iva_compras, iva_ventas, stock_actual)`)
                .eq('id', item_id)
                .single();

            if (!item) { results.push({ item_id, error: 'Not found' }); continue; }

            const articuloInfo = Array.isArray(item.articulo) ? item.articulo[0] : item.articulo;
            const precioBase = item.precio_real || item.precio_documentado || item.precio_oc || 0;

            if (tipo === 'precio') {
                // Precio facturado real: lo documentado por OCR, o lo que mande el front
                const precioFacturado = Number(item.precio_documentado || valor_real || 0);
                const precioAcordado = Number(item.precio_oc || 0);
                // Cantidad: lo documentado en factura; si no hay, lo recibido físico.
                const cantidadNC = Number(item.cantidad_documentada || item.cantidad_fisica || 0);
                const montoDif = Math.abs(Math.round((precioFacturado - precioAcordado) * cantidadNC * 100) / 100);

                if (accion === 'A') {
                    // Asumir: update precio_compra on articulo
                    const nuevoPrecio = precioFacturado || valor_real;
                    await supabase.from('articulos').update({ precio_compra: nuevoPrecio }).eq('id', item.articulo_id);
                    await supabase.from('recepciones_items').update({ precio_real: nuevoPrecio, precio_verificado: true }).eq('id', item_id);
                } else if (accion === 'B' || accion === 'C') {
                    // Reclamo al proveedor: NC esperada por diferencia de precio
                    if (proveedorId && montoDif > 0) {
                        await crearNCEsperada(supabase, {
                            proveedor_id: proveedorId,
                            orden_compra_id: ocId,
                            monto: montoDif,
                            origen: 'diferencia_precio',
                            descripcion,
                        });
                    }
                    await supabase.from('recepciones_items').update({ precio_verificado: true }).eq('id', item_id);
                } else if (accion === 'D') {
                    // Descuento fuera de factura: compré a 95, factura llega a 100,
                    // la NC del 5% llega a fin de mes/trimestre. La factura se paga
                    // completa; queda la NC esperada para reclamar e imputar.
                    if (proveedorId && montoDif > 0) {
                        await crearNCEsperada(supabase, {
                            proveedor_id: proveedorId,
                            orden_compra_id: ocId,
                            monto: montoDif,
                            origen: 'descuento_fuera_factura',
                            descripcion,
                        });
                    }
                    await supabase.from('recepciones_items').update({ precio_verificado: true }).eq('id', item_id);
                }
            } else if (tipo === 'mercaderia') {
                const cantidadDif = Math.abs(valor_real); // cantidad faltante en unidades

                if (accion === 'A') {
                    // Empresa absorbs: just adjust, no extra movement
                    await supabase.from('recepciones_items').update({ cantidad_diferencia_destino: 'empresa' }).eq('id', item_id);

                } else if (accion === 'B' && (transporte_id || transporteDefault)) {
                    // Transporte: create CC transporte entry
                    await supabase.from('cuenta_corriente_transportes').insert({
                        transporte_id: transporte_id || transporteDefault,
                        tipo_movimiento: 'faltante_mercaderia',
                        monto: Math.round(precioBase * cantidadDif * 100) / 100,
                        descripcion: descripcion || `Faltante ${cantidadDif} unidades artículo ${articuloInfo?.sku}`,
                        referencia_id: recepcion_id,
                        referencia_tipo: 'recepcion',
                        creado_por: auth.user.id,
                    });
                    await supabase.from('recepciones_items').update({ cantidad_diferencia_destino: 'transporte' }).eq('id', item_id);

                } else if (accion === 'C') {
                    // Proveedor: devolucion_compra kardex + CC proveedor
                    const stockActual = articuloInfo?.stock_actual || 0;

                    await insertarKardex(
                        supabase,
                        {
                            tipo_movimiento: 'devolucion_compra',
                            estado: 'confirmado',
                            fecha: nowArgentina(),
                            articulo_id: item.articulo_id,
                            cantidad: cantidadDif,
                            precio_lista: precioBase,
                            precio_unitario_final: precioBase,
                            subtotal_neto: Math.round(precioBase * cantidadDif * 100) / 100,
                            subtotal_total: Math.round(precioBase * cantidadDif * 100) / 100,
                            proveedor_id: proveedorId,
                            recepcion_id,
                            orden_compra_id: ocId,
                            stock_antes: stockActual,
                            stock_despues: Math.max(0, stockActual - cantidadDif),
                            operador_id: auth.user.id,
                        },
                        {
                            sku: articuloInfo?.sku,
                            descripcion: articuloInfo?.descripcion,
                            categoria: articuloInfo?.categoria,
                            marca_id: articuloInfo?.marca_id,
                            proveedor_id: articuloInfo?.proveedor_id,
                            iva_compras: articuloInfo?.iva_compras,
                            iva_ventas: articuloInfo?.iva_ventas,
                        }
                    );

                    // Adjust stock
                    const { error: rpcErr } = await supabase.rpc('actualizar_stock', { p_articulo_id: item.articulo_id, p_cantidad: -cantidadDif });
                    if (rpcErr) {
                        const { data: art } = await supabase.from('articulos').select('stock_actual').eq('id', item.articulo_id).single();
                        if (art) await supabase.from('articulos').update({ stock_actual: Math.max(0, (art.stock_actual || 0) - cantidadDif) }).eq('id', item.articulo_id);
                    }

                    // NC esperada del proveedor por el faltante/devolución.
                    // El stock ya se ajustó arriba (la mercadería no está/se devuelve);
                    // la CC se acredita recién cuando llega la NC (ncp_registrar).
                    if (proveedorId) {
                        await crearNCEsperada(supabase, {
                            proveedor_id: proveedorId,
                            orden_compra_id: ocId,
                            monto: Math.round(precioBase * cantidadDif * 100) / 100,
                            origen: 'faltante',
                            descripcion: descripcion || `Devolución ${cantidadDif} unidades al proveedor`,
                            ajusta_stock: false,
                        });
                    }

                    await supabase.from('recepciones_items').update({ cantidad_diferencia_destino: 'proveedor' }).eq('id', item_id);
                }
            }

            results.push({ item_id, tipo, accion, success: true });
        }

        return NextResponse.json({ success: true, results });

    } catch (error: any) {
        console.error('[Cerrar Recepción] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
