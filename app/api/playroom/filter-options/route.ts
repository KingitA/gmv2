import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { fetchAllRows } from '@/lib/playroom/queries'

export async function GET() {
  try {
    const supabase = createAdminClient()

    const data = await fetchAllRows(() => supabase
      .from('clientes')
      .select('id, localidad, zona')
      .not('localidad', 'is', null))

    const localidades = [...new Set(data.map((r: any) => r.localidad).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es'))

    const zonas = [...new Set(data.map((r: any) => r.zona).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es'))

    return NextResponse.json({ localidades, zonas })
  } catch (err: any) {
    return NextResponse.json({ localidades: [], zonas: [] })
  }
}
