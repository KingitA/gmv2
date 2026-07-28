import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import React, { type JSXElementConstructor, type ReactElement } from 'react';
import * as XLSX from 'xlsx';
import { OrdenCompraPDF, type OrdenCompraPDFData, type OrdenCompraPDFLinea } from '@/lib/pdf/orden-compra-template';

// GET /api/ordenes-compra/[id]/pdf            → descarga PDF de la OC
// GET /api/ordenes-compra/[id]/pdf?formato=xlsx → descarga Excel de la OC
// Un solo archivo con las cantidades totales: EAN13, SKU, descripción,
// cantidad, precios (lista, descuentos, neto), IVA y totales.
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: ordenId } = await params;
        const formato = new URL(request.url).searchParams.get('formato') || 'pdf';
        const supabase = createAdminClient();

        const { data: orden, error: ordenErr } = await supabase
            .from('ordenes_compra')
            .select('*, proveedor:proveedores(nombre, cuit, direccion, localidad, telefono, email)')
            .eq('id', ordenId)
            .maybeSingle();

        if (ordenErr) {
            console.error('[OC PDF] Error cargando orden:', ordenErr.message);
            return NextResponse.json({ error: ordenErr.message }, { status: 500 });
        }
        if (!orden) return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });

        const { data: detalle } = await supabase
            .from('ordenes_compra_detalle')
            .select('*, articulo:articulos(sku, ean13, descripcion, unidades_por_bulto)')
            .eq('orden_compra_id', ordenId)
            .order('created_at', { ascending: true });

        const { data: empresa } = await supabase
            .from('configuracion_empresa')
            .select('*')
            .limit(1)
            .maybeSingle();

        const lineas: OrdenCompraPDFLinea[] = (detalle || []).map((d: any) => {
            const descuentos = [d.descuento1, d.descuento2, d.descuento3, d.descuento4].map((x: any) => Number(x || 0));
            const precioLista = Number(d.precio_unitario || 0);
            const precioNeto = descuentos.reduce((p, desc) => p * (1 - desc / 100), precioLista);
            const cantidad = Number(d.cantidad_pedida || 0);
            // El precio es POR UNIDAD; si se pide por bulto, las unidades reales
            // son cantidad × unidades_por_bulto (misma lógica que la pantalla de OC).
            const unidadesPorBulto = Number(d.articulo?.unidades_por_bulto || 1);
            const unidadesTotales = d.tipo_cantidad === 'bulto' ? cantidad * unidadesPorBulto : cantidad;
            const ean = Array.isArray(d.articulo?.ean13) ? d.articulo.ean13[0] : d.articulo?.ean13;
            return {
                ean13: ean || null,
                sku: d.articulo?.sku || null,
                descripcion: d.articulo?.descripcion || '—',
                cantidad,
                tipo_cantidad: d.tipo_cantidad,
                unidades_por_bulto: unidadesPorBulto,
                unidades_totales: unidadesTotales,
                precio_unitario: precioLista,
                descuentos,
                precio_neto: Math.round(precioNeto * 100) / 100,
                total_linea: Math.round(precioNeto * unidadesTotales * 100) / 100,
            };
        });

        const subtotal = Math.round(lineas.reduce((s, l) => s + l.total_linea, 0) * 100) / 100;
        const iva = Math.round(subtotal * 0.21 * 100) / 100;
        const data: OrdenCompraPDFData = {
            orden: {
                numero_orden: orden.numero_orden,
                fecha_orden: orden.fecha_orden,
                fecha_estimada_recepcion: orden.fecha_estimada_recepcion,
                condicion_pago: orden.condicion_pago || orden.plazo_pago,
                observaciones: orden.observaciones,
            },
            empresa: empresa ? {
                razon_social: empresa.razon_social,
                cuit: empresa.cuit,
                direccion: empresa.direccion,
                telefono: empresa.telefono,
                email: empresa.email,
                logo_url: empresa.logo_url,
            } : null,
            proveedor: {
                nombre: orden.proveedor?.nombre || '—',
                cuit: orden.proveedor?.cuit,
                direccion: [orden.proveedor?.direccion, orden.proveedor?.localidad].filter(Boolean).join(', ') || null,
                telefono: orden.proveedor?.telefono,
                email: orden.proveedor?.email,
            },
            detalle: lineas,
            totales: {
                subtotal_neto: subtotal,
                iva,
                total: Math.round((subtotal + iva) * 100) / 100,
                unidades: lineas.reduce((s, l) => s + l.unidades_totales, 0),
            },
        };

        const nombreBase = `OC_${orden.numero_orden}`.replace(/[^a-zA-Z0-9_-]/g, '_');

        if (formato === 'xlsx') {
            const filas = lineas.map((l) => ({
                'EAN13': l.ean13 || '',
                'SKU': l.sku || '',
                'Descripción': l.descripcion,
                'Cantidad': l.cantidad,
                'Tipo': l.tipo_cantidad || 'unidad',
                'Unid/Bulto': l.unidades_por_bulto,
                'Unidades': l.unidades_totales,
                'Precio Lista': l.precio_unitario,
                'Desc 1 %': l.descuentos[0],
                'Desc 2 %': l.descuentos[1],
                'Desc 3 %': l.descuentos[2],
                'Desc 4 %': l.descuentos[3],
                'Precio Neto': l.precio_neto,
                'Total Línea': l.total_linea,
            }));
            filas.push({} as any);
            filas.push({ 'Descripción': 'SUBTOTAL NETO', 'Total Línea': subtotal } as any);
            filas.push({ 'Descripción': 'IVA 21%', 'Total Línea': iva } as any);
            filas.push({ 'Descripción': 'TOTAL', 'Total Línea': data.totales.total } as any);

            const ws = XLSX.utils.json_to_sheet(filas);
            ws['!cols'] = [
                { wch: 15 }, { wch: 8 }, { wch: 45 }, { wch: 9 }, { wch: 8 },
                { wch: 10 }, { wch: 10 },
                { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
                { wch: 12 }, { wch: 12 },
            ];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, `OC ${orden.numero_orden}`.slice(0, 31));
            const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

            return new NextResponse(buf, {
                headers: {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': `attachment; filename="${nombreBase}.xlsx"`,
                },
            });
        }

        const element = React.createElement(OrdenCompraPDF, { data }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>;
        const buffer = await renderToBuffer(element);

        return new NextResponse(new Uint8Array(buffer), {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${nombreBase}.pdf"`,
            },
        });
    } catch (error: any) {
        console.error('[OC PDF] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
