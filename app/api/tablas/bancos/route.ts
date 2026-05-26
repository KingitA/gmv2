import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("cuentas_bancarias")
      .select("*")
      .order("nombre")

    if (error) throw error
    return NextResponse.json(data || [])
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const body = await request.json()
    const { banco, nombre, alias, cbu, cvu, cuenta } = body

    if (!banco || !nombre) {
      return NextResponse.json({ error: "banco y nombre son requeridos" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("cuentas_bancarias")
      .insert({ banco, nombre, alias: alias || null, cbu: cbu || null, cvu: cvu || null, cuenta: cuenta || null, activo: true })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const body = await request.json()
    const { id, banco, nombre, alias, cbu, cvu, cuenta, activo } = body

    if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 })

    const { data, error } = await supabase
      .from("cuentas_bancarias")
      .update({ banco, nombre, alias: alias || null, cbu: cbu || null, cvu: cvu || null, cuenta: cuenta || null, activo })
      .eq("id", id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 })

    const { error } = await supabase.from("cuentas_bancarias").delete().eq("id", id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
