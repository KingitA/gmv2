import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import * as XLSX from 'xlsx';
import { processWithGemini } from '@/lib/services/ocr';
import { parseFecha } from '@/lib/formato';
import { descuentosDeLectura, filasDeListaExcel, precioPorEnTitulos, type FilaLista, type PrecioPor } from '@/lib/compras/lista-proveedor';
import { normalizarDescuentoPct } from '@/lib/services/detalle';
import { crearListaProveedor } from '@/lib/compras/listas-servidor';

// POST /api/listas-proveedores/importar   (formulario: file, proveedor_id, nombre, fecha_vigencia, fecha_fin, observaciones)
// Carga una lista de precios de proveedor desde Excel / CSV, una foto o un PDF (E-20). NO cambia
// ningún precio: deja la lista "pendiente" con su vista previa; los precios cambian al aplicarla.
//   · Excel / CSV: precio vacío = no tocar; descuento vacío = no tocar; descuento 0 = cero.
//   · Foto o PDF: lectura automática (la misma de los comprobantes).
//   · El archivo queda en el almacenamiento privado; el enlace se firma al mostrarlo.
export async function POST(request: NextRequest) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const proveedor_id = (formData.get('proveedor_id') as string) || null;
        const nombre = (formData.get('nombre') as string) || '';
        const fecha_vigencia = parseFecha(formData.get('fecha_vigencia') as string);
        const fecha_fin = parseFecha((formData.get('fecha_fin') as string) || '');
        const observaciones = (formData.get('observaciones') as string) || null;
        // En qué viene el precio: lo que eligió quien carga; si no dijo nada, lo que digan los títulos
        // del archivo; si no, lo guardado para ese proveedor; si no, por unidad.
        const precioPorElegido = formData.get('precio_por') as string | null;
        let precioPor: PrecioPor | null = precioPorElegido === 'bulto' ? 'bulto' : precioPorElegido === 'unidad' ? 'unidad' : null;

        if (!file) return NextResponse.json({ error: 'Falta el archivo de la lista.' }, { status: 400 });
        if (!fecha_vigencia) return NextResponse.json({ error: 'Falta la fecha desde la que rige la lista.' }, { status: 400 });
        if (!proveedor_id) return NextResponse.json({ error: 'Elegí el proveedor de la lista: los descuentos se aplican como dice su ficha y los artículos se buscan primero entre los suyos.' }, { status: 400 });

        const supabase = createAdminClient();
        const { data: prov } = await supabase.from('proveedores').select('id, nombre').eq('id', proveedor_id).maybeSingle();
        if (!prov) return NextResponse.json({ error: 'El proveedor no existe.' }, { status: 404 });

        // 1. Leer el archivo
        const nombreArchivo = file.name || 'lista';
        const esPlanilla = /\.(xlsx|xls|csv)$/i.test(nombreArchivo) || file.type.includes('sheet') || file.type.includes('excel') || file.type.includes('csv');
        const esImagen = file.type.includes('image') || /\.(jpg|jpeg|png|webp)$/i.test(nombreArchivo);
        const esPdf = file.type.includes('pdf') || /\.pdf$/i.test(nombreArchivo);
        let items: FilaLista[] = [];
        const avisos: string[] = [];
        if (esPlanilla) {
            const libro = XLSX.read(await file.arrayBuffer(), { type: 'array' });
            const hoja = libro.Sheets[libro.SheetNames[0]];
            const filasHoja = XLSX.utils.sheet_to_json(hoja, { header: 1, blankrows: false, defval: '' }) as unknown[][];
            items = filasDeListaExcel(filasHoja);
            if (!precioPor) {
                precioPor = precioPorEnTitulos(filasHoja);
                if (precioPor === 'bulto') avisos.push('Los títulos del archivo dicen que el precio es POR BULTO: se va a dividir por las unidades por bulto de cada artículo. Si no es así, cambialo en la vista previa.');
            }
            if (libro.SheetNames.length > 1) avisos.push(`El archivo tiene ${libro.SheetNames.length} hojas: se leyó solo la primera ("${libro.SheetNames[0]}").`);
        } else if (esImagen || esPdf) {
            const r = await processWithGemini(file, { proveedorNombre: prov.nombre, tipoDocumento: 'Lista de Precios' });
            if (r.error) return NextResponse.json({ error: `No se pudo leer el archivo. Probá de nuevo o cargá la lista en Excel. Detalle para sistemas: ${r.error}` }, { status: 422 });
            items = (r.items || []).map((it: any) => ({
                codigo: it.codigo ? String(it.codigo).trim() : null,
                descripcion: it.descripcion ? String(it.descripcion).trim() : null,
                precio_compra: it.precio_unitario != null && Number(it.precio_unitario) > 0 ? Number(it.precio_unitario) : null,
                // La lectura devuelve UN descuento por renglón, el equivalente de todos: es el descuento
                // COMPLETO, así que va en el 1 y los otros tres en 0 explícito (si quedaran "sin tocar", un
                // artículo con 10 + 5 que ahora viene con 14,5 quedaría con 14,5 + 5). Sin descuento leído: no se toca.
                ...(() => {
                    const d = descuentosDeLectura(it.descuento != null && it.descuento !== '' ? normalizarDescuentoPct(it.descuento, it.precio_unitario, it.cantidad) : null);
                    return { descuento1: d[0], descuento2: d[1], descuento3: d[2], descuento4: d[3] };
                })(),
            }));
            avisos.push(...(r.avisos || []));
            avisos.push('La lista se leyó de una foto o un PDF: controlá los precios contra el archivo antes de aplicarla.');
        } else {
            return NextResponse.json({ error: 'Formato no soportado. Subí un Excel (.xlsx, .xls, .csv), un PDF o una foto.' }, { status: 400 });
        }
        if (items.length === 0) {
            return NextResponse.json({ error: 'No se encontró ningún renglón con precio o descuento en el archivo. Revisá que tenga una fila de títulos (código, descripción, precio, descuento).' }, { status: 422 });
        }

        // 2. Guardar el archivo (bucket privado)
        const ext = (nombreArchivo.split('.').pop() || 'dat').toLowerCase().replace(/[^a-z0-9]/g, '');
        const storagePath = `listas/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('comprobantes').upload(storagePath, file, { contentType: file.type || undefined });
        if (uploadError) avisos.push('La lista se cargó, pero no se pudo guardar el archivo original.');

        // 3. Lista + renglones (misma función que usan las listas que llegan por mail)
        const r = await crearListaProveedor(supabase, {
            proveedor_id, nombre: nombre || `Lista ${prov.nombre} ${fecha_vigencia}`, fecha_vigencia, fecha_fin, observaciones,
            storage_path: uploadError ? null : storagePath,
            archivos: uploadError ? null : [{ nombre: nombreArchivo, ruta: storagePath }],
            origen: 'manual', creado_por: auth.user.id, items, precio_por: precioPor,
        });

        return NextResponse.json({
            success: true,
            lista_id: r.lista_id,
            precio_por: r.precio_por,
            stats: { total: r.stats.total, matched: r.stats.pendientes, revisar: r.stats.revisar, sin_match: r.stats.sin_articulo },
            avisos,
        });
    } catch (error: any) {
        console.error('[Importar Lista] Error:', error);
        return NextResponse.json({ error: `No se pudo cargar la lista. Detalle para sistemas: ${error.message || error}` }, { status: 500 });
    }
}
