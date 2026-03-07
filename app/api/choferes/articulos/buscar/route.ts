import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');

    if (!query || query.length < 3) {
      return NextResponse.json([]);
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: articulos, error } = await supabase
      .from('articulos')
      .select('id, descripcion, sku')
      .or(`descripcion.ilike.%${query}%,sku.ilike.%${query}%`)
      .limit(10);

    if (error) {
      console.error('[v0] Error buscando artículos:', error);
      return NextResponse.json({ error: 'Error buscando artículos' }, { status: 500 });
    }

    return NextResponse.json(articulos || []);
  } catch (error) {
    console.error('[v0] Error en API buscar artículos:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
