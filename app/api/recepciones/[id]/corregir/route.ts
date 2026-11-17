import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { conversionesDeRecepcion } from '@/lib/deposito/recepciones';
import { aUnidadesBase, cant } from '@/lib/deposito/unidades';
import { insertarKardex } from '@/lib/kardex/insertar-kardex';
import { faltaLaFuncion } from '@/lib/utils/migracion-pendiente';
import { nowArgentina } from '@/lib/utils';
import { netoDocumento } from '@/lib/compras/diferencias';

// POST /api/recepciones/[id]/corregir  { item_id, unidades, motivo }
// Corrige desde la oficina lo que contó el depósito en UNA línea (siempre en unidades).
// Todo lo hace recepcion_corregir_conteo (migración 20261117c) en una transacción: cambia
// el conteo, ajusta el stock por la diferencia si esa línea ya había sumado, y deja el
// registro de quién, cuándo y por qué. Sin la migración no cambia nada y lo dice.
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: recepcion_id } = await params;
        const body = await request.json().catch(() => ({}));
        const unidades = Number(body.unidades);
        const motivo = String(body.motivo || '').trim();
        if (!body.item_id || !Number.isFinite(unidades) || unidades < 0) {
            return NextResponse.json({ error: 'Falta la línea o la cantidad no es válida.' }, { status: 400 });
        }
        if (motivo.length < 3) return NextResponse.json({ error: 'Hay que escribir el motivo de la corrección.' }, { status: 400 });

        const supabase = createAdminClient();
        const { data: item, error: itemErr } = await supabase
            .from('recepciones_items')
            .select('*, articulo:articulos(sku, descripcion, categoria, marca_id, proveedor_id, iva_compras, iva_ventas, precio_compra, descuento1, descuento2, descuento3, descuento4, ultimo_costo)')
            .eq('id', body.item_id)
            .eq('recepcion_id', recepcion_id)
            .maybeSingle();
        if (itemErr) throw itemErr;
        if (!item) return NextResponse.json({ error: 'La línea de la recepción ya no existe.' }, { status: 404 });
        const { data: rec } = await supabase.from('recepciones').select('orden_compra_id, proveedor_id').eq('id', recepcion_id).maybeSingle();

        // Lo que valía la línea en unidades (para líneas anteriores a la migración 20261116a)
        const { porItem } = await conversionesDeRecepcion(supabase, rec?.orden_compra_id ?? null, [item]);
        const antes = item.cantidad_fisica_base != null ? Number(item.cantidad_fisica_base) : aUnidadesBase(item.cantidad_fisica, porItem.get(item.id)?.factorConteo ?? 1);

        // La pantalla muestra (y corrige) el TOTAL recibido del artículo en la orden. Si llegó en más
        // de una entrega, el cambio se aplica a esta línea: total nuevo − lo de las otras entregas.
        let enOtrasEntregas = 0;
        if (rec?.orden_compra_id) {
            const { data: recs } = await supabase.from('recepciones').select('id').eq('orden_compra_id', rec.orden_compra_id).neq('estado', 'cancelada');
            const otrasIds = (recs || []).map((x: any) => x.id);
            const { data: otras, error: otrasErr } = otrasIds.length
                ? await supabase.from('recepciones_items').select('*').in('recepcion_id', otrasIds).eq('articulo_id', item.articulo_id).neq('id', item.id)
                : { data: [], error: null };
            if (otrasErr) throw otrasErr;
            const filas: any[] = (otras || []).filter((o: any) => !o.fuera_de_oc || item.fuera_de_oc);
            const conv = await conversionesDeRecepcion(supabase, rec.orden_compra_id, filas);
            for (const o of filas) {
                enOtrasEntregas += o.cantidad_fisica_base != null ? Number(o.cantidad_fisica_base) : aUnidadesBase(o.cantidad_fisica, conv.porItem.get(o.id)?.factorConteo ?? 1);
            }
        }
        const paraEstaLinea = Math.round((unidades - enOtrasEntregas) * 10000) / 10000;
        if (paraEstaLinea < 0) {
            return NextResponse.json({ error: `De este artículo ya entraron ${cant(enOtrasEntregas)} unidades en otras entregas de la orden: el total no puede ser menor.`, codigo: 'menor_a_otras_entregas' }, { status: 422 });
        }

        const rpc = await supabase.rpc('recepcion_corregir_conteo', {
            p_item_id: item.id, p_unidades: paraEstaLinea, p_unidades_antes: antes, p_usuario_id: auth.user.id, p_motivo: motivo,
        });
        if (rpc.error) {
            if (faltaLaFuncion(rpc.error, 'recepcion_corregir_conteo')) {
                return NextResponse.json({ error: 'Todavía no se puede corregir lo recibido desde acá: falta una actualización del sistema (migración 20261117c). No se cambió nada.', codigo: 'falta_migracion' }, { status: 409 });
            }
            if (rpc.error.code === 'P0001' || rpc.error.code === 'P0002') return NextResponse.json({ error: rpc.error.message, codigo: rpc.error.details }, { status: 422 });
            throw rpc.error;
        }
        const r: any = rpc.data;
        const ajuste = Number(r.ajuste_stock || 0);

        // Kardex del ajuste (solo si se movió stock). Valorizado al NETO, igual que la compra que
        // corrige: el neto con el que quedó esa compra en el kardex de esta recepción (el de la
        // factura si ya se validó); si no hay, el último costo; si no, lista menos descuentos.
        if (ajuste !== 0) {
            const a: any = Array.isArray(item.articulo) ? item.articulo[0] : item.articulo;
            const lista = Number(a?.precio_compra || 0);
            let precio = 0;
            try {
                const { data: compra } = await supabase.from('kardex').select('precio_unitario_final')
                    .eq('recepcion_id', recepcion_id).eq('articulo_id', item.articulo_id).eq('tipo_movimiento', 'compra')
                    .order('fecha', { ascending: false }).limit(1);
                precio = Number(compra?.[0]?.precio_unitario_final || 0);
            } catch { /* sigue con el costo del artículo */ }
            if (!(precio > 0)) precio = Number(a?.ultimo_costo || 0);
            if (!(precio > 0)) precio = netoDocumento(lista, [a?.descuento1, a?.descuento2, a?.descuento3, a?.descuento4].map((x: unknown) => Number(x) || 0));
            const subtotal = Math.round(precio * Math.abs(ajuste) * 100) / 100;
            try {
                await insertarKardex(supabase, {
                    tipo_movimiento: ajuste > 0 ? 'ajuste_entrada' : 'ajuste_salida',
                    estado: 'confirmado',
                    fecha: nowArgentina(),
                    articulo_id: item.articulo_id,
                    cantidad: Math.abs(ajuste),
                    precio_lista: lista > 0 ? lista : precio,
                    precio_unitario_final: precio,
                    subtotal_neto: subtotal,
                    subtotal_total: subtotal,
                    proveedor_id: rec?.proveedor_id || undefined,
                    recepcion_id,
                    orden_compra_id: rec?.orden_compra_id || undefined,
                    stock_antes: r.stock_antes ?? undefined,
                    stock_despues: r.stock_antes != null ? Number(r.stock_antes) + ajuste : undefined,
                    operador_id: auth.user.id,
                }, { sku: a?.sku, descripcion: a?.descripcion, categoria: a?.categoria, marca_id: a?.marca_id, proveedor_id: a?.proveedor_id, iva_compras: a?.iva_compras, iva_ventas: a?.iva_ventas });
            } catch (e: any) {
                console.error('[corregir conteo] kardex:', e?.message || e);
            }
        }

        const totalAntes = Number(r.unidades_antes || 0) + enOtrasEntregas;
        const mensaje = ajuste === 0
            ? `Lo recibido pasó de ${cant(totalAntes)} a ${cant(unidades)} unidades. El stock no cambió${r.ya_habia_sumado_stock ? '' : ' (la recepción todavía no se finalizó)'}.`
            : `Lo recibido pasó de ${cant(totalAntes)} a ${cant(unidades)} unidades y el stock ${ajuste > 0 ? `subió ${cant(ajuste)}` : `bajó ${cant(-ajuste)}`}.`;
        return NextResponse.json({ success: true, ...r, mensaje });
    } catch (error: any) {
        console.error('[corregir conteo] Error:', error);
        return NextResponse.json({ error: `No se pudo corregir y no se cambió nada. Detalle para sistemas: ${error.message || error}` }, { status: 500 });
    }
}
