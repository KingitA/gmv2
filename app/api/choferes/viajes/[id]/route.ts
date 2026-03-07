import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient();
    const { id } = await params;

    const { data: viaje, error } = await supabase
      .from('viajes')
      .select('id, estado')
      .eq('id', id)
      .single();

    if (error || !viaje) {
      console.error('[v0] Error fetching viaje:', error);
      return NextResponse.json({ error: 'Viaje no encontrado' }, { status: 404 });
    }

    return NextResponse.json(viaje);
  } catch (error) {
    console.error('[v0] Error en API viajes:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
