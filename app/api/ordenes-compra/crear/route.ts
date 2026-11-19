import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requirePermiso } from '@/lib/auth';
import { hoyISO, parseFecha } from '@/lib/formato';
import { acuerdoDeProveedorConLegado, normalizarAcuerdo, textoCondicionPago } from '@/lib/compras/acuerdo-pago';
import { regimenDe } from '@/lib/compras/oc-totales';
import { diasEntregaDeProveedor, errorDeFuncion, fechaEntregaEstimada, mensajeMigracionOC } from '@/lib/compras/orden-compra';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pctValido = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
};

/**
 * POST /api/ordenes-compra/crear — crea o edita una orden de compra (E-07, E-08).
 *
 * Body: { orden_id?, proveedor_id, observaciones, fecha_estimada_recepcion?, acuerdo_pago?, clave?,
 *         items: [{ articulo_id, cantidad_pedida, tipo_cantidad, precio_unitario, descuento1..4 }] }
 *
 * Todo lo que escribe (número, cabecera, detalle, provisión en la cuenta corriente, vencimientos
 * estimados, stock en camino) lo hace la función SQL `oc_guardar` en UNA transacción. Esta ruta
 * solo prepara el pedido:
 *   · fecha estimada de entrega: la que eligió el usuario o, si no vino, el promedio real del
 *     proveedor (nunca más los días de pago, E-10);
 *   · acuerdo de pago: el que vino de la pantalla o, si no vino (OC de faltantes, Jarvis), el de
 *     la ficha del proveedor (E-04);
 *   · NO pisa el precio de compra ni los descuentos del artículo (E-11): el costo lo actualiza
 *     la factura validada.
 * Las unidades por bulto, el régimen de IVA y las percepciones los lee la función de la base:
 * nada de eso se le cree al navegador (E-13).
 */
export async function POST(request: NextRequest) {
    const auth = await requirePermiso('compras');
    if (auth.error) return auth.error;

    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 });

        const ordenId: string | null = typeof body.orden_id === 'string' && UUID.test(body.orden_id) ? body.orden_id : null;
        const proveedorId: string | null = typeof body.proveedor_id === 'string' && UUID.test(body.proveedor_id) ? body.proveedor_id : null;
        const itemsCrudos: any[] = Array.isArray(body.items) ? body.items : [];

        if (!ordenId && !proveedorId) return NextResponse.json({ error: 'Elegí el proveedor de la orden.' }, { status: 400 });
        if (itemsCrudos.length === 0) return NextResponse.json({ error: 'La orden no tiene artículos con cantidad.' }, { status: 400 });

        // Mensajes claros antes de ir a la base (la función vuelve a controlar todo)
        const sinArticulo = itemsCrudos.filter((it) => !it || typeof it.articulo_id !== 'string' || !UUID.test(it.articulo_id)).length;
        if (sinArticulo > 0) {
            return NextResponse.json({
                error: `Hay ${sinArticulo} renglón${sinArticulo > 1 ? 'es' : ''} sin artículo vinculado. Vinculalos a un artículo del catálogo o sacalos de la orden antes de guardarla.`,
                codigo: 'items_sin_articulo',
            }, { status: 400 });
        }
        const cantidadInvalida = itemsCrudos.filter((it) => !(Number(it.cantidad_pedida) > 0)).length;
        if (cantidadInvalida > 0) {
            return NextResponse.json({ error: `Hay ${cantidadInvalida} renglón${cantidadInvalida > 1 ? 'es' : ''} con cantidad en cero o inválida.`, codigo: 'cantidad_invalida' }, { status: 400 });
        }

        const supabase = createAdminClient();
        const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
        const items = itemsCrudos.map((it) => ({
            articulo_id: String(it.articulo_id).toLowerCase(),
            cantidad_pedida: Number(it.cantidad_pedida),
            tipo_cantidad: it.tipo_cantidad === 'unidad' ? 'unidad' : 'bulto',
            precio_unitario: num(it.precio_unitario),
            descuento1: num(it.descuento1), descuento2: num(it.descuento2), descuento3: num(it.descuento3), descuento4: num(it.descuento4),
        }));

        // Proveedor: el de la orden si se edita, el elegido si se crea
        let provId = proveedorId;
        let ordenActual: any = null;
        if (ordenId) {
            const { data, error } = await supabase.from('ordenes_compra').select('*').eq('id', ordenId).maybeSingle();
            if (error) throw error;
            if (!data) return NextResponse.json({ error: 'La orden no existe (puede que la hayan eliminado).' }, { status: 404 });
            ordenActual = data;
            provId = data.proveedor_id;
        }
        const { data: proveedor, error: provErr } = await supabase.from('proveedores').select('*').eq('id', provId).maybeSingle();
        if (provErr) throw provErr;
        if (!proveedor) return NextResponse.json({ error: 'El proveedor no existe.' }, { status: 400 });

        // Fecha estimada de entrega
        let fechaEstimada = parseFecha(body.fecha_estimada_recepcion);
        if (fechaEstimada && fechaEstimada < hoyISO() && !ordenId) {
            return NextResponse.json({ error: 'La fecha estimada de entrega no puede ser anterior a hoy.', codigo: 'fecha_pasada' }, { status: 400 });
        }
        if (!fechaEstimada) {
            fechaEstimada = ordenActual?.fecha_estimada_recepcion
                ? String(ordenActual.fecha_estimada_recepcion).slice(0, 10)
                : fechaEntregaEstimada(await diasEntregaDeProveedor(supabase, provId!, proveedor));
        }

        // Acuerdo de pago: pantalla → orden actual → ficha del proveedor
        const acuerdo = normalizarAcuerdo(body.acuerdo_pago)
            ?? normalizarAcuerdo(ordenActual?.acuerdo_pago)
            ?? acuerdoDeProveedorConLegado(proveedor);

        // Para el texto de la condición: ¿la orden tiene parte con factura, sin factura, o las dos?
        const ids = [...new Set(items.map((i) => i.articulo_id))];
        const regimenes = new Set<string>();
        for (let i = 0; i < ids.length; i += 200) {
            const { data: arts, error } = await supabase.from('articulos').select('id, iva_compras').in('id', ids.slice(i, i + 200));
            if (error) throw error;
            for (const a of arts || []) regimenes.add(regimenDe(a.iva_compras));
        }
        const hay = {
            blanco: regimenes.has('factura') || regimenes.has('mixto') || regimenes.size === 0,
            negro: regimenes.has('adquisicion_stock') || regimenes.has('mixto'),
        };

        const { data: res, error } = await supabase.rpc('oc_guardar', {
            p_orden_id: ordenId,
            p_usuario_id: auth.user.id,
            p_datos: {
                proveedor_id: provId,
                observaciones: typeof body.observaciones === 'string' ? body.observaciones : '',
                fecha_estimada_recepcion: fechaEstimada,
                condicion_pago: textoCondicionPago(acuerdo, hay),
                acuerdo_pago: acuerdo,
                // % con factura de los artículos mixtos: pantalla → orden actual → ficha del proveedor (null = 50)
                mixto_pct_factura: pctValido(body.mixto_pct_factura) ?? pctValido(ordenActual?.mixto_pct_factura) ?? pctValido((proveedor as any).mixto_pct_factura),
                clave: typeof body.clave === 'string' && UUID.test(body.clave) ? body.clave : null,
                items,
            },
        });

        if (error) {
            const migracion = mensajeMigracionOC(error);
            if (migracion) return NextResponse.json({ error: migracion, codigo: 'migracion_pendiente' }, { status: 503 });
            const e = errorDeFuncion(error);
            if (e.status === 500) console.error('[OC Guardar] Error:', error);
            return NextResponse.json({ error: e.mensaje, codigo: e.codigo }, { status: e.status });
        }

        const r: any = res || {};
        const { data: orden } = await supabase.from('ordenes_compra').select('*').eq('id', r.orden_id).maybeSingle();

        return NextResponse.json({
            success: true,
            repetida: !!r.repetida,
            editada: !!ordenId,
            // nombres que ya usaban la pantalla y la verificación ("OC de faltantes")
            orden, numeroOrden: r.numero_orden, fechaEstimada: orden?.fecha_estimada_recepcion ?? fechaEstimada,
            totales: {
                neto: r.total_neto, iva: r.total_iva, percepciones: r.total_percepciones,
                total_blanco: r.total_blanco, total_negro: r.total_negro, total: r.total_estimado,
            },
            vencimientos_estimados: r.vencimientos_estimados ?? 0,
        });
    } catch (error: any) {
        const migracion = mensajeMigracionOC(error);
        if (migracion) return NextResponse.json({ error: migracion, codigo: 'migracion_pendiente' }, { status: 503 });
        console.error('[OC Guardar] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
    }
}
