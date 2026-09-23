// Fotos de comprobantes de cobro (cheques / transferencias): bucket público
// `comprobantes-pago`. Lo usan la ruta de OCR (foto que llega por multipart) y el
// handler `cobro.registrar` del outbox (foto capturada sin señal, viaja en base64).

const BUCKET_COMPROBANTES = "comprobantes-pago"

export interface FotoSubida {
  url: string
  nombre: string
}

export async function subirFotoComprobante(
  admin: any,
  buffer: Buffer,
  opts: { mime?: string | null; nombre?: string | null },
): Promise<FotoSubida> {
  const mime = opts.mime || "image/jpeg"
  const ext = (opts.nombre?.split(".").pop() || (mime.includes("png") ? "png" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg"
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await admin.storage.from(BUCKET_COMPROBANTES).upload(path, buffer, { contentType: mime, upsert: false })
  if (error) throw new Error(`No se pudo guardar la foto: ${error.message}`)
  const { data } = admin.storage.from(BUCKET_COMPROBANTES).getPublicUrl(path)
  if (!data?.publicUrl) throw new Error("No se pudo obtener la URL de la foto")
  return { url: data.publicUrl, nombre: opts.nombre || path }
}

/** Foto que la app guardó en el equipo (sin señal) y manda dentro del cobro. */
export interface FotoPendiente {
  /** base64 sin prefijo data: */
  b64: string
  mime?: string | null
  nombre?: string | null
}

/** Tope por foto (ya comprimida en el equipo: ~200 KB) y por cobro; Vercel corta el body en 4,5 MB. */
export const FOTO_PENDIENTE_MAX_B64 = 1_500_000
export const FOTOS_PENDIENTES_MAX = 8

/** Sube las fotos pendientes de un cobro; una que falla no frena a las demás (queda registrado en el log). */
export async function subirFotosPendientes(admin: any, fotos: FotoPendiente[] | null | undefined): Promise<FotoSubida[]> {
  if (!Array.isArray(fotos) || !fotos.length) return []
  const out: FotoSubida[] = []
  for (const f of fotos.slice(0, FOTOS_PENDIENTES_MAX)) {
    if (!f || typeof f.b64 !== "string" || !f.b64 || f.b64.length > FOTO_PENDIENTE_MAX_B64) continue
    try {
      out.push(await subirFotoComprobante(admin, Buffer.from(f.b64, "base64"), { mime: f.mime, nombre: f.nombre }))
    } catch (e: any) {
      console.error("[cobranzas/fotos] foto pendiente:", e?.message)
    }
  }
  return out
}
