import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { faltaLaColumna } from '@/lib/utils/migracion-pendiente';
import { MIGRACION_OC } from '@/lib/compras/orden-compra';
import { totalesOC } from '@/lib/compras/oc-totales';
import { fetchAllRows, fetchByIds } from '@/lib/supabase/fetch-all';

const COLS_NUEVAS = 'id, numero_orden, proveedor_id, fecha_orden, fecha_estimada_recepcion, estado, observaciones, condicion_pago, usuario_creador, total_neto, total_estimado, cantidad_renglones, editada_at, enviada_at, enviada_a, envios, prueba_enviada_at, prueba_enviada_a, cancelada_at, motivo_cancelacion';
const COLS_VIEJAS = 'id, numero_orden, proveedor_id, fecha_orden, fecha_estimada_recepcion, estado, observaciones, condicion_pago, usuario_creador';
const COLS_PROVEEDOR = 'id, nombre, sigla, percepcion_iva, percepcion_iibb, tipo_descuento';

/**
 * GET /api/ordenes-compra/listado — el listado de órdenes, liviano (E-12, E-96).
 *
 * Antes la pantalla pedía `select *` de la orden + TODO el detalle de TODAS las órdenes con
 * sus artículos + los comprobantes: ~7 segundos en blanco. Acá van solo las columnas que se
 * muestran; el total viene guardado en la cabecera (lo calcula `oc_guardar`). Para las órdenes
 * viejas, que no lo tienen, se calcula con el detalle de ESAS órdenes nada más.
 */
export async function GET() {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const supabase = createAdminClient();
        let migracionPendiente = false;

        let { data: ordenes, error } = await supabase.from('ordenes_compra').select(COLS_NUEVAS)
            .order('fecha_orden', { ascending: false }).limit(500);
        if (error && faltaLaColumna(error)) {
            migracionPendiente = true;
            ({ data: ordenes, error } = await supabase.from('ordenes_compra').select(COLS_VIEJAS)
                .order('fecha_orden', { ascending: false }).limit(500) as any);
        }
        if (error) throw error;
        const lista: any[] = ordenes || [];

        const provIds = [...new Set(lista.map((o) => o.proveedor_id).filter(Boolean))];
        const userIds = [...new Set(lista.map((o) => o.usuario_creador).filter((u) => typeof u === 'string' && /^[0-9a-f-]{36}$/i.test(u)))];
        const sinTotal = lista.filter((o) => o.total_estimado == null).map((o) => o.id);

        // Sin .in() con cientos de ids en la URL ni límites que PostgREST corta en 1000:
        //  · proveedores y usuarios: por tandas de 200 ids (son pocos);
        //  · comprobantes: todos los que tienen orden, paginados (no se filtra por lista de ids);
        //  · detalle: SOLO de las órdenes viejas sin total guardado (las nuevas lo traen en la
        //    cabecera), por tandas de 100 órdenes y cada tanda paginada.
        const detalleDe = async (ids: string[]) => {
            const out: any[] = [];
            for (let i = 0; i < ids.length; i += 100) {
                const tanda = ids.slice(i, i + 100);
                out.push(...await fetchAllRows(() => supabase.from('ordenes_compra_detalle')
                    .select('id, orden_compra_id, cantidad_pedida, tipo_cantidad, precio_unitario, descuento1, descuento2, descuento3, descuento4, articulo:articulos(unidades_por_bulto, iva_compras)')
                    .in('orden_compra_id', tanda)));
            }
            return out;
        };
        const [provData, usuariosData, detalleData, comprobantesData] = await Promise.all([
            fetchByIds<any>((ids) => supabase.from('proveedores').select(COLS_PROVEEDOR).in('id', ids), provIds),
            fetchByIds<any>((ids) => supabase.from('usuarios').select('id, nombre').in('id', ids), userIds),
            detalleDe(sinTotal),
            lista.length ? fetchAllRows<any>(() => supabase.from('comprobantes_compra').select('id, orden_compra_id, estado').not('orden_compra_id', 'is', null)) : Promise.resolve([] as any[]),
        ]);
        const provs = { data: provData }, usuarios = { data: usuariosData }, detalle = { data: detalleData }, comprobantes = { data: comprobantesData };

        const provPorId = new Map<string, any>((provs.data || []).map((p: any) => [p.id, p]));
        const nombrePorUsuario = new Map<string, string>((usuarios.data || []).map((u: any) => [u.id, u.nombre]));
        const detPorOrden = new Map<string, any[]>();
        for (const d of (detalle.data || []) as any[]) {
            const arr = detPorOrden.get(d.orden_compra_id) || [];
            arr.push({ ...d, unidades_por_bulto: d.articulo?.unidades_por_bulto, iva_compras: d.articulo?.iva_compras });
            detPorOrden.set(d.orden_compra_id, arr);
        }
        const compPorOrden = new Map<string, { total: number; validados: number }>();
        for (const c of (comprobantes.data || []) as any[]) {
            if (c.estado === 'esperada') continue;
            const x = compPorOrden.get(c.orden_compra_id) || { total: 0, validados: 0 };
            x.total++;
            if (c.estado === 'validado' || c.estado === 'cerrado') x.validados++;
            compPorOrden.set(c.orden_compra_id, x);
        }

        const filas = lista.map((o) => {
            const prov = provPorId.get(o.proveedor_id);
            let total = o.total_estimado != null ? Number(o.total_estimado) : null;
            let neto = o.total_neto != null ? Number(o.total_neto) : null;
            let renglones = o.cantidad_renglones ?? null;
            if (total == null) {
                const t = totalesOC(detPorOrden.get(o.id) || [], { ...prov, mixto_pct_factura: o.mixto_pct_factura ?? null });
                total = t.total; neto = t.neto; renglones = t.renglones;
            }
            const comp = compPorOrden.get(o.id) || { total: 0, validados: 0 };
            return {
                id: o.id,
                numero_orden: o.numero_orden,
                proveedor_id: o.proveedor_id,
                proveedor_nombre: prov?.nombre ?? '—',
                fecha_orden: o.fecha_orden,
                fecha_estimada_recepcion: o.fecha_estimada_recepcion,
                estado: o.estado,
                observaciones: o.observaciones,
                condicion_pago: o.condicion_pago,
                creada_por: nombrePorUsuario.get(o.usuario_creador) ?? null,
                total, neto, renglones,
                enviada_at: o.enviada_at ?? null,
                enviada_a: o.enviada_a ?? null,
                envios: o.envios ?? 0,
                // se mandó solo en MODO PRUEBA (a la dirección de prueba): al proveedor no le llegó
                prueba_enviada_at: o.prueba_enviada_at ?? null,
                prueba_enviada_a: o.prueba_enviada_a ?? null,
                // se cambió después de mandársela al proveedor: tiene una versión vieja
                cambio_sin_enviar: !!(o.enviada_at && o.editada_at && new Date(o.editada_at).getTime() > new Date(o.enviada_at).getTime()),
                cancelada_at: o.cancelada_at ?? null,
                motivo_cancelacion: o.motivo_cancelacion ?? null,
                comprobantes: comp.total,
                comprobantes_validados: comp.validados,
            };
        });

        return NextResponse.json({
            ordenes: filas,
            migracion_pendiente: migracionPendiente ? `Falta aplicar la migración ${MIGRACION_OC}: no se pueden crear, editar, cancelar ni enviar órdenes hasta entonces.` : null,
        });
    } catch (error: any) {
        console.error('[OC Listado] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
    }
}
