/**
 * POST /api/articulos/imagen
 * Sube la imagen de un artículo al bucket `articulos-imagenes` usando el service role
 * (evita depender de políticas RLS de storage desde el navegador). Acepta cualquier
 * formato de imagen y sin límite de tamaño impuesto por la app.
 *
 * Body (multipart/form-data): file (obligatorio), articuloId (opcional)
 * Respuesta: { url }
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from "@/lib/auth"

const BUCKET = "articulos-imagenes"

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const articuloId = (formData.get("articuloId") as string | null)?.trim() || null

    if (!file) return NextResponse.json({ error: "No se recibió ninguna imagen." }, { status: 400 })
    if (file.type && !file.type.startsWith("image/")) {
      return NextResponse.json({ error: "El archivo no es una imagen." }, { status: 400 })
    }

    const nombre = (file.name || "").toLowerCase()
    const ext = (nombre.includes(".") ? nombre.split(".").pop() : "")
      || (file.type.split("/")[1] || "jpg")

    // Ruta estable por artículo (al re-subir, reemplaza la anterior y no deja huérfanas).
    const path = articuloId ? `art-${articuloId}.${ext}` : `nuevo-${Date.now()}.${ext}`

    const buffer = Buffer.from(await file.arrayBuffer())
    const supabase = createAdminClient()
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      upsert: true,
      contentType: file.type || "image/jpeg",
    })
    if (error) {
      console.error("[articulos/imagen] upload:", error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    // ?v= para invalidar el caché del navegador cuando se reemplaza la imagen
    const url = `${data.publicUrl}?v=${Date.now()}`
    return NextResponse.json({ url })
  } catch (e: any) {
    console.error("[articulos/imagen] error:", e?.message)
    return NextResponse.json({ error: e?.message || "Error subiendo la imagen." }, { status: 500 })
  }
}
