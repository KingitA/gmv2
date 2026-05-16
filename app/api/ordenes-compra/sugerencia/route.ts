import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const proveedor_id = searchParams.get('proveedor_id');
    const fecha_desde = searchParams.get('fecha_desde');
    const fecha_hasta = searchParams.get('fecha_hasta');
    const tipo_venta = searchParams.get('tipo_venta') || 'vendida'; // 'vendida' | 'facturada'
    const dias_objetivo = parseInt(searchParams.get('dias_objetivo') || '45');

    if (!proveedor_id || !fecha_desde || !fecha_hasta) {
        return NextResponse.json({ error: 'proveedor_id, fecha_desde y fecha_hasta son requeridos' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // 1. Get articulos associated with this provider
    const { data: articulosProveedor } = await supabase
        .from('articulos_proveedores')
        .select('articulo_id')
        .eq('proveedor_id', proveedor_id);

    const articuloIds = (articulosProveedor || []).map((a: any) => a.articulo_id);

    if (articuloIds.length === 0) {
        return NextResponse.json({ items: [] });
    }

    // 2. Calculate sales volume per article in the period
    let kardexQuery = supabase
        .from('kardex')
        .select('articulo_id, cantidad')
        .eq('tipo_movimiento', 'venta')
        .eq('signo', -1)
        .in('articulo_id', articuloIds)
        .gte('fecha', fecha_desde)
        .lte('fecha', fecha_hasta);

    if (tipo_venta === 'facturada') {
        kardexQuery = kardexQuery.not('comprobante_venta_id', 'is', null);
    }

    const { data: ventas } = await kardexQuery;

    // Aggregate sales by article
    const ventasPorArticulo: Record<string, number> = {};
    for (const v of (ventas || [])) {
        ventasPorArticulo[v.articulo_id] = (ventasPorArticulo[v.articulo_id] || 0) + Number(v.cantidad);
    }

    // 3. Get stock en camino (OC active, kardex pendiente)
    const { data: stockEnCamino } = await supabase
        .from('kardex')
        .select('articulo_id, cantidad')
        .eq('tipo_movimiento', 'compra')
        .eq('estado', 'pendiente')
        .in('articulo_id', articuloIds);

    const stockEnCaminoPorArticulo: Record<string, number> = {};
    for (const s of (stockEnCamino || [])) {
        stockEnCaminoPorArticulo[s.articulo_id] = (stockEnCaminoPorArticulo[s.articulo_id] || 0) + Number(s.cantidad);
    }

    // 4. Get current stock and article details
    const { data: articulos } = await supabase
        .from('articulos')
        .select('id, sku, descripcion, precio_compra, stock_actual, unidades_por_bulto')
        .in('id', articuloIds);

    // 5. Calculate suggestions
    const fechaDesdeDate = new Date(fecha_desde);
    const fechaHastaDate = new Date(fecha_hasta);
    const diasPeriodo = Math.max(1, Math.round((fechaHastaDate.getTime() - fechaDesdeDate.getTime()) / (1000 * 60 * 60 * 24)));

    const items = (articulos || []).map((articulo: any) => {
        const totalVendido = ventasPorArticulo[articulo.id] || 0;
        const stockActual = Number(articulo.stock_actual || 0);
        const stockCamino = stockEnCaminoPorArticulo[articulo.id] || 0;
        const ventaDiaria = totalVendido / diasPeriodo;
        const cantidadSugerida = Math.max(0, Math.ceil(ventaDiaria * dias_objetivo - stockActual - stockCamino));

        return {
            articulo_id: articulo.id,
            sku: articulo.sku,
            descripcion: articulo.descripcion,
            precio_compra: articulo.precio_compra,
            unidades_por_bulto: articulo.unidades_por_bulto,
            stock_actual: stockActual,
            stock_en_camino: stockCamino,
            total_vendido: totalVendido,
            venta_diaria: Math.round(ventaDiaria * 100) / 100,
            cantidad_sugerida: cantidadSugerida,
        };
    }).filter((i: any) => i.total_vendido > 0 || i.stock_actual > 0);

    // Sort by suggested quantity desc, then by sales desc
    items.sort((a: any, b: any) => b.cantidad_sugerida - a.cantidad_sugerida || b.total_vendido - a.total_vendido);

    return NextResponse.json({ items, diasPeriodo });
}
