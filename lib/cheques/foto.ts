// Foto del cheque en el cliente (navegador / WebView): se achica ANTES de viajar.
// La cámara del NuStar saca 3–6 MB; Vercel corta el body en 4,5 MB y Gemini tarda
// proporcional al tamaño. A 1600 px de lado mayor y JPEG 0,8 un cheque queda en
// ~150–300 KB, se lee igual de bien y sube en un segundo con 3G.

export interface FotoComprimida {
  blob: Blob
  nombre: string
  mime: string
  /** true si se pudo comprimir; false = se manda tal cual (canvas no disponible, formato raro) */
  comprimida: boolean
}

export async function comprimirFoto(file: File | Blob, opts: { maxLado?: number; calidad?: number; nombre?: string } = {}): Promise<FotoComprimida> {
  const maxLado = opts.maxLado ?? 1600
  const calidad = opts.calidad ?? 0.8
  const nombreOriginal = opts.nombre || (file as File).name || "foto.jpg"
  const nombre = nombreOriginal.replace(/\.[^.]+$/, "") + ".jpg"
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") throw new Error("sin canvas")
    // imageOrientation "from-image": respeta el EXIF (la cámara del handheld gira la foto)
    let bmp: ImageBitmap
    try {
      bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions)
    } catch {
      bmp = await createImageBitmap(file)
    }
    const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * escala))
    const h = Math.max(1, Math.round(bmp.height * escala))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("sin contexto 2d")
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", calidad))
    if (!blob || blob.size === 0) throw new Error("toBlob vacío")
    // Si por algún motivo quedó más grande que el original, va el original
    if (blob.size >= file.size && file.type === "image/jpeg") return { blob: file, nombre: nombreOriginal, mime: file.type, comprimida: false }
    return { blob, nombre, mime: "image/jpeg", comprimida: true }
  } catch {
    return { blob: file, nombre: nombreOriginal, mime: file.type || "image/jpeg", comprimida: false }
  }
}

/** Blob → base64 (sin el prefijo data:). Para guardar la foto en el outbox cuando no hay señal. */
export function blobABase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onerror = () => rej(r.error)
    r.onload = () => res(String(r.result).replace(/^data:[^;]+;base64,/, ""))
    r.readAsDataURL(blob)
  })
}

/** Vista previa local de la foto (object URL; liberar con URL.revokeObjectURL al terminar). */
export function urlLocal(blob: Blob): string | null {
  try {
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}
