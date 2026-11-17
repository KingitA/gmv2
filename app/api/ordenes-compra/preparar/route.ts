import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { hoyISO, parseFecha, sumarDiasISO } from '@/lib/formato';
import { acuerdoDeProveedorConLegado } from '@/lib/compras/acuerdo-pago';
import { datosParaPedir, diasEntregaDeProveedor, fechaEntregaEstimada, idsArticulosDeProveedor, mailsParaOrden } from '@/lib/compras/orden-compra';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/ordenes-compra/preparar?proveedor_id=…[&fecha_desde&fecha_hasta&tipo_venta&dias_objetivo&orden_id&extra=id,id]
 *
 * Todo lo que necesita el diálogo de la orden de compra en UNA llamada (E-10, E-12, E-14):
 *   · los artículos del proveedor (ficha + vinculados: una sola fuente) con stock actual, en
 *     camino, venta del período y sugerencia, todo en unidades y la sugerencia también en bultos;
 *   · el acuerdo de pago de la ficha (para copiarlo a la orden) y las percepciones;
 *   · cuántos días tarda en entregar (promedio real / ficha / 7) y la fecha estimada.
 * `extra` = artículos de otro proveedor que el usuario sumó a mano o que ya están en la orden.
 */
export async function GET(request: NextRequest) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const sp = new URL(request.url).searchParams;
        const proveedorId = sp.get('proveedor_id') || '';
        if (!UUID.test(proveedorId)) return NextResponse.json({ error: 'Falta el proveedor.' }, { status: 400 });

        const hoy = hoyISO();
        const fechaHasta = parseFecha(sp.get('fecha_hasta')) || hoy;
        const fechaDesde = parseFecha(sp.get('fecha_desde')) || sumarDiasISO(fechaHasta, -90);
        const tipoVenta = sp.get('tipo_venta') === 'facturada' ? 'facturada' : 'vendida';
        const diasObjetivo = Math.min(365, Math.max(1, Number.parseInt(sp.get('dias_objetivo') || '45', 10) || 45));
        const ordenId = UUID.test(sp.get('orden_id') || '') ? sp.get('orden_id') : null;
        const extra = (sp.get('extra') || '').split(',').filter((x) => UUID.test(x));

        const supabase = createAdminClient();
        const { data: proveedor, error } = await supabase.from('proveedores').select('*').eq('id', proveedorId).maybeSingle();
        if (error) throw error;
        if (!proveedor) return NextResponse.json({ error: 'El proveedor no existe.' }, { status: 404 });

        const [idsProveedor, entrega] = await Promise.all([
            idsArticulosDeProveedor(supabase, proveedorId),
            diasEntregaDeProveedor(supabase, proveedorId, proveedor),
        ]);
        const ids = [...new Set([...idsProveedor, ...extra])];
        const { articulos, diasPeriodo } = await datosParaPedir(supabase, ids, {
            proveedorId, fechaDesde, fechaHasta, tipoVenta, diasObjetivo, excluirOrdenId: ordenId, conservarInactivos: extra,
        });

        return NextResponse.json({
            proveedor: {
                id: proveedor.id,
                nombre: proveedor.nombre,
                percepcion_iva: Number(proveedor.percepcion_iva) || 0,
                percepcion_iibb: Number(proveedor.percepcion_iibb) || 0,
                mails: mailsParaOrden(proveedor),
            },
            acuerdo_pago: acuerdoDeProveedorConLegado(proveedor),
            entrega: { ...entrega, fecha: fechaEntregaEstimada(entrega) },
            periodo: { desde: fechaDesde, hasta: fechaHasta, dias: diasPeriodo, tipo_venta: tipoVenta, dias_objetivo: diasObjetivo },
            articulos,
        });
    } catch (error: any) {
        console.error('[OC Preparar] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
    }
}
