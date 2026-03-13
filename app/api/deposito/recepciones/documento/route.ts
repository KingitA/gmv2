import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminClient()
    const formData = await request.formData()
    const file = formData.get("file") as File
    const recepcionId = formData.get("recepcion_id") as string
    const tipoDocumento = (formData.get("tipo_documento") as string) || "remito"

    if (!file || !recepcionId) {
      return NextResponse.json({ error: "Faltan datos" }, { status: 400 })
    }

    // Upload to Supabase Storage
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const ext = file.name.split(".").pop() || "jpg"
    const fileName = `recepciones/${recepcionId}/${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from("documentos")
      .upload(fileName, buffer, { contentType: file.type, upsert: false })

    let url_imagen: string | null = null
    if (!uploadError) {
      const { data } = supabase.storage.from("documentos").getPublicUrl(fileName)
      url_imagen = data.publicUrl
    }

    // Register document in DB regardless of upload (URL may be null if storage not configured)
    const { data: doc, error } = await supabase
      .from("recepciones_documentos")
      .insert({
        recepcion_id: recepcionId,
        tipo_documento: tipoDocumento,
        url_imagen,
        procesado: false,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(doc)
  } catch (error: any) {
    console.error("[deposito] Error subiendo documento:", error)
    return NextResponse.json({ error: "Error al subir documento" }, { status: 500 })
  }
}
