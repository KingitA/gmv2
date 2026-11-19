import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { cambiosDeCostoDeLista, vistaPreviaLista, type FiltroLista } from '@/lib/compras/listas-servidor';

// GET /api/listas-proveedores/[id]?umbral=15&filtro=cambian&pagina=1
// (las cuentas del resumen son de toda la lista; los renglones vienen de a 200 y ya filtrados)
// La lista con su VISTA PREVIA armada en el servidor (lib/compras/listas-servidor.ts): por artículo,
// costo actual → nuevo, % de cambio, alertas de subas o bajas grandes, qué precios de venta quedan
// desactualizados y el enlace firmado al archivo.
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    try {
        const { id } = await params;
        const q = new URL(request.url).searchParams;
        const umbral = Number(q.get('umbral'));
        const pagina = Number(q.get('pagina'));
        const FILTROS = ['todos', 'cambian', 'alertas', 'frenados', 'venta', 'revisar', 'sin_articulo', 'errores'];
        const vista = await vistaPreviaLista(createAdminClient(), id, {
            umbral_pct: Number.isFinite(umbral) && umbral > 0 ? umbral : null,
            filtro: FILTROS.includes(q.get('filtro') || '') ? (q.get('filtro') as FiltroLista) : 'todos',
            pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
        });
        if (!vista) return NextResponse.json({ error: 'La lista no existe (puede que la hayan eliminado).' }, { status: 404 });
        return NextResponse.json(vista);
    } catch (error: any) {
        console.error('[Lista] Error:', error);
        return NextResponse.json({ error: `No se pudo cargar la lista. Detalle para sistemas: ${error.message || error}` }, { status: 500 });
    }
}

// PATCH /api/listas-proveedores/[id]
//   { item_id, accion: 'confirmar', articulo_id? }  el renglón "por revisar" queda vinculado (al sugerido o al que se mande) y se aplica
//   { item_id, accion: 'ignorar' }                  el renglón no se aplica
//   { item_id, accion: 'incluir' }                  un renglón ignorado que tiene artículo vuelve a aplicarse
//   { item_id, accion: 'confirmar_tope' }           el renglón supera el tope de cambio y se confirma igual
//   { accion: 'desprogramar' }                      una lista programada vuelve a pendiente
//   { accion: 'precio_por', valor: 'unidad'|'bulto', guardar_en_proveedor?: boolean }   en qué viene el precio de la lista
//   { accion: 'tope', valor: 50 }                   tope de cambio que no se aplica sin confirmar
// Nada de esto cambia precios: solo prepara la lista. Una lista aplicada no se toca.
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    try {
        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        const supabase = createAdminClient();
        const { data: lista } = await supabase.from('listas_proveedores').select('id, estado, proveedor_id').eq('id', id).maybeSingle();
        if (!lista) return NextResponse.json({ error: 'La lista no existe.' }, { status: 404 });
        if (lista.estado === 'aplicada') return NextResponse.json({ error: 'La lista ya está aplicada: no se puede cambiar.' }, { status: 409 });

        if (body.accion === 'desprogramar') {
            const { data, error } = await supabase.from('listas_proveedores').update({ estado: 'pendiente' }).eq('id', id).eq('estado', 'programada').select('id');
            if (error) throw error;
            if (!data?.length) return NextResponse.json({ error: 'La lista ya no está programada.' }, { status: 409 });
            return NextResponse.json({ success: true });
        }

        const faltaMigracion = (e: any) => !!e && (e.code === 'PGRST204' || e.code === '42703');
        const sinMigracion = () => NextResponse.json({ error: 'Falta aplicar una actualización del sistema (migración 20261119a) para guardar este dato. No se cambió nada.', codigo: 'falta_migracion' }, { status: 409 });

        if (body.accion === 'precio_por') {
            const valor = body.valor === 'bulto' ? 'bulto' : 'unidad';
            const { error } = await supabase.from('listas_proveedores').update({ precio_por: valor }).eq('id', id);
            if (faltaMigracion(error)) return sinMigracion();
            if (error) throw error;
            // Los renglones frenados o salteados por esta cuenta vuelven a "pendiente": se evalúan de nuevo
            await supabase.from('listas_proveedores_items').update({ estado_item: 'pendiente', error: null }).eq('lista_id', id).eq('estado_item', 'revisar').not('articulo_id', 'is', null);
            // Valor por defecto para las próximas listas de ese proveedor
            if (body.guardar_en_proveedor !== false && lista.proveedor_id) {
                const { error: provErr } = await supabase.from('proveedores').update({ lista_precio_por: valor }).eq('id', lista.proveedor_id);
                if (provErr && !faltaMigracion(provErr)) console.warn('[Lista] no se guardó el valor por defecto del proveedor:', provErr.message);
            }
            return NextResponse.json({ success: true });
        }
        if (body.accion === 'tope') {
            const valor = Number(body.valor);
            if (!(valor > 0)) return NextResponse.json({ error: 'El tope tiene que ser un porcentaje mayor a 0.' }, { status: 400 });
            const { error } = await supabase.from('listas_proveedores').update({ tope_pct: valor }).eq('id', id);
            if (faltaMigracion(error)) return sinMigracion();
            if (error) throw error;
            return NextResponse.json({ success: true });
        }

        if (!body.item_id) return NextResponse.json({ error: 'Falta el renglón.' }, { status: 400 });
        const { data: item } = await supabase.from('listas_proveedores_items').select('*').eq('id', body.item_id).eq('lista_id', id).maybeSingle();
        if (!item) return NextResponse.json({ error: 'Ese renglón ya no existe.' }, { status: 404 });
        if (item.estado_item === 'aplicado') return NextResponse.json({ error: 'Ese renglón ya se aplicó.' }, { status: 409 });

        let cambios: Record<string, unknown> | null = null;
        if (body.accion === 'confirmar') {
            const articuloId = body.articulo_id || item.articulo_sugerido_id || item.articulo_id;
            if (!articuloId) return NextResponse.json({ error: 'Elegí el artículo al que corresponde el renglón.' }, { status: 400 });
            cambios = { articulo_id: articuloId, articulo_sugerido_id: null, estado_item: 'pendiente', error: null };
        } else if (body.accion === 'confirmar_tope') {
            // Supera el tope de cambio y alguien dice que está bien: se aplica igual (queda anotado en el renglón)
            if (!item.articulo_id) return NextResponse.json({ error: 'El renglón no tiene artículo: primero hay que vincularlo.' }, { status: 400 });
            cambios = { confirmado_tope: true, estado_item: 'pendiente', error: null };
        } else if (body.accion === 'ignorar') {
            cambios = { estado_item: 'ignorado' };
        } else if (body.accion === 'incluir') {
            if (!item.articulo_id) return NextResponse.json({ error: 'El renglón no tiene artículo: primero hay que vincularlo.' }, { status: 400 });
            cambios = { estado_item: 'pendiente', error: null };
        } else {
            return NextResponse.json({ error: 'Acción no reconocida.' }, { status: 400 });
        }
        let upd = await supabase.from('listas_proveedores_items').update(cambios).eq('id', item.id);
        if (upd.error && (upd.error.code === 'PGRST204' || upd.error.code === '42703')) {
            // sin la migración 20261119a no existen error / articulo_sugerido_id
            if (body.accion === 'confirmar_tope') return sinMigracion();
            const { error: _e, articulo_sugerido_id: _s, ...basico } = cambios as any;
            upd = await supabase.from('listas_proveedores_items').update(basico).eq('id', item.id);
        }
        if (upd.error) throw upd.error;
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Lista PATCH] Error:', error);
        return NextResponse.json({ error: `No se pudo guardar el cambio. Detalle para sistemas: ${error.message || error}` }, { status: 500 });
    }
}

// DELETE /api/listas-proveedores/[id]
// Elimina una lista (con sus renglones y su archivo) SOLO si no cambió ningún costo: una pendiente,
// una programada, o una aplicada en la que todos los renglones ya estaban igual (una de prueba).
// Si cambió el costo de algún artículo NO se elimina: es el respaldo de ese cambio en el historial.
export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    try {
        const { id } = await params;
        const supabase = createAdminClient();
        const { data: lista } = await supabase.from('listas_proveedores').select('*').eq('id', id).maybeSingle();
        if (!lista) return NextResponse.json({ success: true, ya_eliminada: true });

        const cambios = await cambiosDeCostoDeLista(supabase, id);
        if (cambios === null) {
            return NextResponse.json({ error: 'No se pudo comprobar si la lista cambió algún costo (falta la migración 20261119a o falló la consulta). No se eliminó.', codigo: 'no_se_pudo_comprobar' }, { status: 409 });
        }
        if (cambios > 0) {
            return NextResponse.json({ error: `Esta lista cambió el costo de ${cambios} artículo(s): no se puede eliminar, es el respaldo de esos cambios en el historial de costo.`, codigo: 'cambio_costos' }, { status: 409 });
        }

        // Los renglones se van con la lista (ON DELETE CASCADE). Si justo otra persona la estaba aplicando,
        // la comprobación de abajo lo deja en el registro del servidor.
        const { data: borradas, error } = await supabase.from('listas_proveedores').delete().eq('id', id).select('id');
        if (error) throw error;
        if (!borradas?.length) return NextResponse.json({ success: true, ya_eliminada: true });
        const despues = await cambiosDeCostoDeLista(supabase, id);
        if (despues && despues > 0) console.error(`[Lista DELETE] la lista ${id} se eliminó pero quedó historial de costo con su id (${despues})`);

        // El archivo original (bucket privado)
        const rutas: string[] = [];
        if (Array.isArray(lista.archivos)) for (const a of lista.archivos) if (a?.ruta) rutas.push(String(a.ruta));
        if (rutas.length === 0 && lista.storage_path) rutas.push(String(lista.storage_path));
        for (const r of rutas) {
            const enAdjuntos = r.startsWith('attachments:');
            // los adjuntos de un mail no se borran: son del mail, no de la lista
            if (!enAdjuntos) await supabase.storage.from('comprobantes').remove([r]).then(() => null, () => null);
        }
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Lista DELETE] Error:', error);
        return NextResponse.json({ error: `No se pudo eliminar la lista. Detalle para sistemas: ${error.message || error}` }, { status: 500 });
    }
}
