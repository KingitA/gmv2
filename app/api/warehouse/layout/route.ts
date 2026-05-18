import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('warehouse_layouts')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (error) return NextResponse.json(null, { status: 200 })
  return NextResponse.json(data)
}

export async function PUT(request: Request) {
  const supabase = createAdminClient()
  const body = await request.json()
  const { id, elements } = body

  if (id) {
    const { data, error } = await supabase
      .from('warehouse_layouts')
      .update({ elements, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  const { data, error } = await supabase
    .from('warehouse_layouts')
    .insert({ elements })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
