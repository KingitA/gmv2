import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { netoCompra, tipoDescuentoDe } from '@/lib/compras/neto-compra'

export const dynamic = 'force-dynamic'

// GET /api/articulos/[id]/historial-costo
// Evolución del costo de compra de un artículo (precios_compra_historial): cada cambio de precio de
// lista / descuentos (al aplicar una lista o al aceptar el precio de una factura) y de último costo
// (al validar una factura), con de dónde salió, quién y cuándo. Lo más nuevo primero.
const ORIGEN: Record<string, string> = {
  lista: 'Lista de precios',
  factura: 'Factura validada',
  diferencia_precio: 'Se aceptó el precio facturado',
  bonificado: 'Mercadería bonificada',
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const { data: art } = await supabase.from('articulos').select('id, sku, descripcion, precio_compra, descuento1, descuento2, descuento3, descuento4, ultimo_costo, proveedor:proveedores(tipo_descuento)').eq('id', id).maybeSingle()
    if (!art) return NextResponse.json({ error: 'El artículo no existe.' }, { status: 404 })
    const prov: any = Array.isArray(art.proveedor) ? art.proveedor[0] : art.proveedor
    const tipo = tipoDescuentoDe(prov?.tipo_descuento)

    const { data: filas, error } = await supabase
      .from('precios_compra_historial')
      .select('*')
      .eq('articulo_id', id)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error

    const idsProv = [...new Set((filas || []).map((f: any) => f.proveedor_id).filter(Boolean))]
    const idsUsr = [...new Set((filas || []).map((f: any) => f.usuario_id).filter(Boolean))]
    const [provs, usrs] = await Promise.all([
      idsProv.length ? supabase.from('proveedores').select('id, nombre').in('id', idsProv) : Promise.resolve({ data: [] as any[] }),
      idsUsr.length ? supabase.from('usuarios').select('id, nombre').in('id', idsUsr) : Promise.resolve({ data: [] as any[] }),
    ])
    const nombreProv = new Map<string, string>(((provs as any).data || []).map((p: any) => [p.id, p.nombre]))
    const nombreUsr = new Map<string, string>(((usrs as any).data || []).map((u: any) => [u.id, u.nombre]))
    const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

    return NextResponse.json({
      articulo: { id: art.id, sku: art.sku, descripcion: art.descripcion },
      tipo_descuento: tipo,
      actual: {
        precio_compra: n(art.precio_compra), descuentos: [art.descuento1, art.descuento2, art.descuento3, art.descuento4].map(n),
        neto: netoCompra(art.precio_compra, [art.descuento1, art.descuento2, art.descuento3, art.descuento4], tipo), ultimo_costo: n(art.ultimo_costo),
      },
      historial: (filas || []).map((f: any) => {
        const desc = [f.descuento1, f.descuento2, f.descuento3, f.descuento4].map(n)
        const antes = f.precio_compra_anterior != null
          ? { precio_compra: n(f.precio_compra_anterior), descuentos: [f.descuento1_anterior, f.descuento2_anterior, f.descuento3_anterior, f.descuento4_anterior].map(n) }
          : null
        return {
          id: f.id,
          fecha: f.created_at || f.fecha_desde,
          origen: ORIGEN[f.origen] || (f.origen ? String(f.origen) : 'Cambio de costo'),
          detalle: f.detalle ?? null,
          proveedor: f.proveedor_id ? nombreProv.get(f.proveedor_id) ?? null : null,
          usuario: f.usuario_id ? nombreUsr.get(f.usuario_id) ?? null : null,
          precio_compra: n(f.precio_compra), descuentos: desc, neto: netoCompra(f.precio_compra, desc, tipo),
          antes: antes ? { ...antes, neto: netoCompra(antes.precio_compra, antes.descuentos, tipo) } : null,
          ultimo_costo: f.ultimo_costo != null ? n(f.ultimo_costo) : null,
          lista_proveedor_id: f.lista_proveedor_id ?? null,
          orden_compra_id: f.orden_compra_id ?? null,
        }
      }),
    })
  } catch (error: any) {
    console.error('[historial de costo]', error)
    return NextResponse.json({ error: `No se pudo cargar el historial de costo. Detalle para sistemas: ${error.message || error}` }, { status: 500 })
  }
}
