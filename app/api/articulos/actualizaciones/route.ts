import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

// GET — List importaciones with optional filters
export async function GET(request: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const estado = searchParams.get('estado') // pendiente | aplicada | all
    const id = searchParams.get('id') // single import detail

    // Single import detail with all linked items
    if (id) {
        const { data, error } = await supabase
            .from('importaciones_articulos')
            .select('*, proveedores:proveedor_id(nombre)')
            .eq('id', id)
            .single()

        if (error) return NextResponse.json({ error: error.message }, { status: 404 })

        // If we have proveedor_id, load ALL articles from that provider for comparison
        let articulosProveedor: any[] = []
        if (data.proveedor_id) {
            const { data: arts } = await supabase
                .from('articulos')
                .select('id, sku, descripcion, precio_compra, ean13, unidades_por_bulto, porcentaje_ganancia, categoria, rubro, iva_compras, iva_ventas, descuento1, descuento2, descuento3, descuento4, proveedor_id')
                .eq('proveedor_id', data.proveedor_id)
                .eq('activo', true)
                .order('descripcion')
            articulosProveedor = arts || []

            // Also load descuentos tipados for these articles
            if (articulosProveedor.length > 0) {
                const artIds = articulosProveedor.map((a: any) => a.id)
                const { data: descs } = await supabase
                    .from('articulos_descuentos')
                    .select('articulo_id, tipo, porcentaje, orden')
                    .in('articulo_id', artIds)
                    .order('orden')

                const descMap: Record<string, any[]> = {}
                for (const d of (descs || [])) {
                    if (!descMap[d.articulo_id]) descMap[d.articulo_id] = []
                    descMap[d.articulo_id].push(d)
                }
                articulosProveedor = articulosProveedor.map((a: any) => ({
                    ...a,
                    descuentos_tipados: descMap[a.id] || []
                }))
            }
        }

        return NextResponse.json({ importacion: data, articulosProveedor })
    }

    // List all importaciones
    let query = supabase
        .from('importaciones_articulos')
        .select('id, archivo_nombre, tipo, estado, fecha_vigencia, proveedor_id, registros_nuevos, registros_actualizados, source, created_at, columnas_afectadas, proveedores:proveedor_id(nombre)')
        .order('created_at', { ascending: false })

    if (estado && estado !== 'all') {
        query = query.eq('estado', estado)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(data || [])
}

// PATCH — Update priority (order) or apply import
export async function PATCH(request: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const supabase = createAdminClient()
    const body = await request.json()

    // Apply import: update articles with new data
    if (body.action === 'aplicar') {
        const { importacion_id, fecha_efectiva, cambios } = body
        // cambios: Array<{ articulo_id, campo, valor_nuevo }>

        if (!importacion_id || !cambios || !Array.isArray(cambios)) {
            return NextResponse.json({ error: 'Faltan datos: importacion_id y cambios[]' }, { status: 400 })
        }

        let updated = 0
        let errors: string[] = []

        for (const cambio of cambios) {
            const { articulo_id, updates } = cambio
            // updates is an object like { precio_compra: 1500, ean13: '7790123456789' }

            if (!articulo_id || !updates || Object.keys(updates).length === 0) continue

            // Separate descuento updates from article field updates
            const descuentoUpdates: any[] = []
            const articuloUpdates: Record<string, any> = {}

            for (const [key, value] of Object.entries(updates)) {
                if (key.startsWith('descuento_tipado_')) {
                    // Format: descuento_tipado_comercial, descuento_tipado_financiero, descuento_tipado_promocional
                    const tipo = key.replace('descuento_tipado_', '')
                    descuentoUpdates.push({ tipo, porcentajes: value })
                } else {
                    articuloUpdates[key] = value
                }
            }

            // Update article fields
            if (Object.keys(articuloUpdates).length > 0) {
                const { error } = await supabase.from('articulos').update(articuloUpdates).eq('id', articulo_id)
                if (error) {
                    errors.push(`${articulo_id}: ${error.message}`)
                } else {
                    updated++
                }
            }

            // Update typed discounts
            for (const desc of descuentoUpdates) {
                // Delete existing discounts of this type
                await supabase.from('articulos_descuentos')
                    .delete()
                    .eq('articulo_id', articulo_id)
                    .eq('tipo', desc.tipo)

                // Insert new ones (porcentajes is array like [10, 5])
                const porcentajes = Array.isArray(desc.porcentajes) ? desc.porcentajes : [desc.porcentajes]
                const inserts = porcentajes.filter((p: number) => p > 0).map((p: number, i: number) => ({
                    articulo_id,
                    tipo: desc.tipo,
                    porcentaje: p,
                    orden: i + 1,
                }))
                if (inserts.length > 0) {
                    await supabase.from('articulos_descuentos').insert(inserts)
                }
            }
        }

        // Mark import as applied
        await supabase.from('importaciones_articulos').update({
            estado: 'aplicada',
            fecha_aplicacion: fecha_efectiva || new Date().toISOString(),
            registros_actualizados: updated,
        }).eq('id', importacion_id)

        return NextResponse.json({ success: true, updated, errors })
    }

    // Update priority order (for drag & drop)
    if (body.action === 'reorder') {
        const { ordered_ids } = body // Array of import IDs in priority order
        if (!ordered_ids || !Array.isArray(ordered_ids)) {
            return NextResponse.json({ error: 'Falta ordered_ids[]' }, { status: 400 })
        }

        // We use a 'prioridad' field — need to check if it exists, if not we store in a simple way
        for (let i = 0; i < ordered_ids.length; i++) {
            await supabase.from('importaciones_articulos')
                .update({ prioridad: i + 1 })
                .eq('id', ordered_ids[i])
        }

        return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
}
