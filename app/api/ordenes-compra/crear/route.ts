import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { insertarKardex } from '@/lib/kardex/insertar-kardex';
import { nowArgentina } from '@/lib/utils';

async function calcularFechaEstimadaRecepcion(supabase: any, proveedorId: string): Promise<string> {
    // Try AVG of actual receipt times for this provider
    const { data: avg } = await supabase.rpc('calcular_avg_dias_recepcion', { p_proveedor_id: proveedorId }).single();
    const avgDias = avg?.avg_dias;

    if (avgDias && avgDias > 0) {
        const fecha = new Date();
        fecha.setDate(fecha.getDate() + Math.round(avgDias));
        return fecha.toISOString().split('T')[0];
    }

    // Fallback: proveedor.dias_vencimiento
    const { data: proveedor } = await supabase
        .from('proveedores')
        .select('dias_vencimiento')
        .eq('id', proveedorId)
        .single();

    const dias = proveedor?.dias_vencimiento || 7;
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + dias);
    return fecha.toISOString().split('T')[0];
}

export async function POST(request: NextRequest) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const body = await request.json();
        const { proveedor_id, observaciones, items } = body;
        // items: Array<{ articulo_id, cantidad_pedida, tipo_cantidad, precio_unitario, descuento1-4 }>

        if (!proveedor_id || !items || items.length === 0) {
            return NextResponse.json({ error: 'proveedor_id e items son requeridos' }, { status: 400 });
        }

        const supabase = createAdminClient();

        // 1. Generate OC number
        const { data: ultimaOrden } = await supabase
            .from('ordenes_compra')
            .select('numero_orden')
            .order('numero_orden', { ascending: false })
            .limit(1);

        const numeroOrden = ultimaOrden && ultimaOrden[0]
            ? `OC-${String(Number.parseInt(ultimaOrden[0].numero_orden.split('-')[1]) + 1).padStart(6, '0')}`
            : 'OC-000001';

        // 2. Calculate estimated reception date
        let fechaEstimada: string;
        try {
            fechaEstimada = await calcularFechaEstimadaRecepcion(supabase, proveedor_id);
        } catch {
            // If RPC doesn't exist yet, fallback to 7 days
            const fecha = new Date();
            fecha.setDate(fecha.getDate() + 7);
            fechaEstimada = fecha.toISOString().split('T')[0];
        }

        // 3. Create OC
        const { data: orden, error: errorOrden } = await supabase
            .from('ordenes_compra')
            .insert({
                numero_orden: numeroOrden,
                proveedor_id,
                fecha_orden: nowArgentina(),
                fecha_estimada_recepcion: fechaEstimada,
                estado: 'pendiente',
                observaciones: observaciones || null,
                usuario_creador: auth.user.id,
            })
            .select()
            .single();

        if (errorOrden || !orden) throw new Error(errorOrden?.message || 'Error creando orden');

        // 4. Create detalle
        const detalleParaInsertar = items.map((item: any) => ({
            orden_compra_id: orden.id,
            articulo_id: item.articulo_id,
            cantidad_pedida: item.cantidad_pedida,
            tipo_cantidad: item.tipo_cantidad || 'bulto',
            precio_unitario: item.precio_unitario,
            descuento1: item.descuento1 || 0,
            descuento2: item.descuento2 || 0,
            descuento3: item.descuento3 || 0,
            descuento4: item.descuento4 || 0,
        }));

        const { error: errorDetalle } = await supabase.from('ordenes_compra_detalle').insert(detalleParaInsertar);
        if (errorDetalle) throw new Error(errorDetalle.message);

        // 5. Calculate total and create provisional CC entry
        const totalOrden = items.reduce((sum: number, item: any) => {
            const cantidadBase = item.tipo_cantidad === 'bulto'
                ? item.cantidad_pedida * (item.articulo?.unidades_por_bulto || 1)
                : item.cantidad_pedida;
            let precio = item.precio_unitario || 0;
            precio *= (1 - (item.descuento1 || 0) / 100);
            precio *= (1 - (item.descuento2 || 0) / 100);
            precio *= (1 - (item.descuento3 || 0) / 100);
            precio *= (1 - (item.descuento4 || 0) / 100);
            return sum + precio * cantidadBase;
        }, 0);

        // La provisión anticipa la deuda REAL: neto + IVA + percepciones del
        // proveedor (misma fórmula que el desglose de comprobantes). Al validar
        // la factura, la provisión se reemplaza por los comprobantes reales.
        const { data: provPercep } = await supabase
            .from('proveedores')
            .select('percepcion_iva, percepcion_iibb, retencion_ganancias')
            .eq('id', proveedor_id)
            .maybeSingle();
        const factorImpuestos = 1 + 0.21
            + (Number(provPercep?.percepcion_iva) || 0) / 100
            + (Number(provPercep?.percepcion_iibb) || 0) / 100
            + (Number(provPercep?.retencion_ganancias) || 0) / 100;
        const totalProvision = Math.round(totalOrden * factorImpuestos * 100) / 100;

        await supabase.from('cuenta_corriente_proveedores').insert({
            proveedor_id,
            tipo_movimiento: 'orden_compra',
            monto: totalProvision,
            descripcion: `Provisión OC: ${numeroOrden} (neto ${Math.round(totalOrden * 100) / 100} + imp. estimados)`,
            referencia_id: orden.id,
            referencia_tipo: 'orden_compra',
            fecha: nowArgentina(),
        });

        // 6. Insert kardex pendiente for each item + update articulos prices
        for (const item of items) {
            // Quantity in units
            const cantidadBase = item.tipo_cantidad === 'bulto'
                ? item.cantidad_pedida * (item.articulo?.unidades_por_bulto || 1)
                : item.cantidad_pedida;

            let precioFinal = item.precio_unitario || 0;
            precioFinal *= (1 - (item.descuento1 || 0) / 100);
            precioFinal *= (1 - (item.descuento2 || 0) / 100);
            precioFinal *= (1 - (item.descuento3 || 0) / 100);
            precioFinal *= (1 - (item.descuento4 || 0) / 100);

            // Get article info for denormalization
            const { data: artInfo } = await supabase
                .from('articulos')
                .select('sku, descripcion, categoria, marca_id, proveedor_id, iva_compras, iva_ventas')
                .eq('id', item.articulo_id)
                .single();

            await insertarKardex(
                supabase,
                {
                    tipo_movimiento: 'compra',
                    estado: 'pendiente',
                    fecha: fechaEstimada + 'T00:00:00.000Z',
                    articulo_id: item.articulo_id,
                    cantidad: cantidadBase,
                    precio_lista: item.precio_unitario || 0,
                    precio_unitario_final: precioFinal,
                    subtotal_neto: Math.round(precioFinal * cantidadBase * 100) / 100,
                    subtotal_total: Math.round(precioFinal * cantidadBase * 100) / 100,
                    proveedor_id,
                    orden_compra_id: orden.id,
                    descuento_proveedor_pct: item.descuento1 || null,
                    descuento_proveedor_financiero_pct: item.descuento2 || null,
                    descuento_proveedor_comercial_pct: item.descuento3 || null,
                    comprador_id: auth.user.id,
                    operador_id: auth.user.id,
                },
                {
                    sku: artInfo?.sku,
                    descripcion: artInfo?.descripcion,
                    categoria: artInfo?.categoria,
                    marca_id: artInfo?.marca_id,
                    proveedor_id: artInfo?.proveedor_id,
                    iva_compras: artInfo?.iva_compras,
                    iva_ventas: artInfo?.iva_ventas,
                }
            );

            // Update article prices
            await supabase
                .from('articulos')
                .update({
                    precio_compra: item.precio_unitario,
                    descuento1: item.descuento1 || 0,
                    descuento2: item.descuento2 || 0,
                    descuento3: item.descuento3 || 0,
                    descuento4: item.descuento4 || 0,
                })
                .eq('id', item.articulo_id);
        }

        return NextResponse.json({ success: true, orden, numeroOrden, fechaEstimada });

    } catch (error: any) {
        console.error('[OC Crear] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
