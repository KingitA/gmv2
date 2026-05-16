import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { processWithGemini, parseExcel } from '@/lib/services/ocr';
import { MatchingEngine } from '@/lib/matching/matcher';
import { ImportItemRaw } from '@/lib/matching/types';
import { nowArgentina } from '@/lib/utils';

export async function POST(request: NextRequest) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const proveedor_id = formData.get('proveedor_id') as string;
        const nombre = formData.get('nombre') as string;
        const fecha_vigencia = formData.get('fecha_vigencia') as string;
        const fecha_fin = formData.get('fecha_fin') as string | null;
        const observaciones = formData.get('observaciones') as string | null;

        if (!file || !fecha_vigencia) {
            return NextResponse.json({ error: 'file y fecha_vigencia son requeridos' }, { status: 400 });
        }

        const supabase = createAdminClient();

        // 1. Parse file
        let items: any[] = [];
        if (file.type.includes('image') || file.name.match(/\.(jpg|jpeg|png|webp)$/i)) {
            const context = { proveedorNombre: '', tipoDocumento: 'Lista de Precios' };
            const result = await processWithGemini(file, context);
            items = result.items || [];
        } else if (file.type.includes('sheet') || file.name.match(/\.(xlsx|xls|csv)$/i)) {
            const result = await parseExcel(file);
            items = result.items || [];
        } else {
            return NextResponse.json({ error: 'Formato no soportado' }, { status: 400 });
        }

        // 2. Upload file to storage
        const fileExt = file.name.split('.').pop();
        const fileName = `listas/${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('comprobantes').upload(fileName, file);
        const archivo_url = uploadError
            ? null
            : supabase.storage.from('comprobantes').getPublicUrl(fileName).data.publicUrl;

        // 3. Create lista header
        const { data: lista, error: listaError } = await supabase
            .from('listas_proveedores')
            .insert({
                proveedor_id: proveedor_id || null,
                nombre: nombre || `Lista ${fecha_vigencia}`,
                fecha_vigencia,
                fecha_fin: fecha_fin || null,
                archivo_url,
                observaciones,
                estado: 'pendiente',
                creado_por: auth.user.id,
            })
            .select()
            .single();

        if (listaError || !lista) throw new Error(listaError?.message || 'Error creando lista');

        // 4. Match items against catalog
        const engine = new MatchingEngine();
        const itemsParaInsertar = [];

        for (const item of items) {
            const rawItem: ImportItemRaw = {
                description: item.descripcion || item.descripcion_proveedor,
                code: item.codigo || item.codigo_proveedor,
                ean: item.ean,
                price: item.precio_unitario || item.precio_compra,
                ...item
            };

            let articulo_id: string | null = null;
            try {
                const matchResult = await engine.resolveItem(rawItem, proveedor_id || '');
                if (matchResult.status === 'matched' && matchResult.bestCandidate?.sku_id) {
                    articulo_id = matchResult.bestCandidate.sku_id;
                }
            } catch { /* skip match errors */ }

            // Get current price if matched
            let precioAnterior = null;
            if (articulo_id) {
                const { data: art } = await supabase.from('articulos').select('precio_compra').eq('id', articulo_id).single();
                precioAnterior = art?.precio_compra || null;
            }

            itemsParaInsertar.push({
                lista_id: lista.id,
                articulo_id,
                codigo_proveedor: item.codigo || item.codigo_proveedor || null,
                descripcion_proveedor: item.descripcion || item.descripcion_proveedor || null,
                precio_compra: item.precio_unitario || item.precio_compra || null,
                descuento1: item.descuento1 || item.descuento || null,
                descuento2: item.descuento2 || null,
                descuento3: item.descuento3 || null,
                descuento4: item.descuento4 || null,
                iva_compras: item.iva || null,
                precio_anterior: precioAnterior,
                estado_item: articulo_id ? 'pendiente' : 'ignorado',
            });
        }

        if (itemsParaInsertar.length > 0) {
            await supabase.from('listas_proveedores_items').insert(itemsParaInsertar);
        }

        const matched = itemsParaInsertar.filter(i => i.articulo_id).length;
        const sinMatch = itemsParaInsertar.filter(i => !i.articulo_id).length;

        return NextResponse.json({
            success: true,
            lista_id: lista.id,
            stats: { total: items.length, matched, sin_match: sinMatch }
        });

    } catch (error: any) {
        console.error('[Importar Lista] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
