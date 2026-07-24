"use client"

import { useRef, useState } from "react"

// Búsqueda de artículos con la cámara, para la tablet del vendedor:
// 1) Si la foto tiene un código de barras legible, se lee EN el dispositivo
//    (BarcodeDetector nativo de Android/Chrome) y se busca por EAN exacto.
// 2) Si no, la foto viaja al backend y Claude identifica el producto
//    (marca, medida, color) para sugerir artículos del catálogo.

interface Sugerencia {
  id: string
  descripcion: string
  marca: string | null
  imagen_url: string | null
  stock_disponible: number
  unidades_por_bulto: number | null
  [k: string]: any
}

interface Props {
  onSelect: (articulo: Sugerencia) => void
  onClose: () => void
}

// Reduce la foto a ≤1280px JPEG antes de subirla (las fotos de la tablet
// pesan varios MB y la detección no necesita más resolución).
async function comprimirImagen(file: File): Promise<{ blob: Blob; bitmap: ImageBitmap }> {
  const bitmap = await createImageBitmap(file)
  const max = 1280
  const escala = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * escala)
  const h = Math.round(bitmap.height * escala)
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b as Blob), "image/jpeg", 0.85)
  )
  return { blob, bitmap }
}

async function detectarCodigoBarras(bitmap: ImageBitmap): Promise<string | null> {
  try {
    const BD = (window as any).BarcodeDetector
    if (!BD) return null
    const detector = new BD({ formats: ["ean_13", "ean_8", "upc_a", "code_128"] })
    const codigos = await detector.detect(bitmap)
    return codigos?.[0]?.rawValue || null
  } catch {
    return null
  }
}

export function BuscarPorFoto({ onSelect, onClose }: Props) {
  const camaraRef = useRef<HTMLInputElement>(null)
  const galeriaRef = useRef<HTMLInputElement>(null)
  const [estado, setEstado] = useState<"inicio" | "analizando" | "resultados">("inicio")
  const [preview, setPreview] = useState<string | null>(null)
  const [deteccion, setDeteccion] = useState<string | null>(null)
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([])
  const [error, setError] = useState<string | null>(null)

  const procesar = async (file: File | null | undefined) => {
    if (!file) return
    setError(null)
    setEstado("analizando")
    setPreview(URL.createObjectURL(file))
    try {
      const { blob, bitmap } = await comprimirImagen(file)
      const fd = new FormData()

      // Primero: intento local de código de barras (gratis e instantáneo)
      const ean = await detectarCodigoBarras(bitmap)
      if (ean) fd.append("ean", ean)
      else fd.append("image", blob, "producto.jpg")

      const res = await fetch("/api/vendedor/buscar-foto", { method: "POST", body: fd })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || "No se pudo analizar la foto.")

      setDeteccion(d.descripcion_detectada || null)
      setSugerencias(d.articulos || [])
      setEstado("resultados")
    } catch (e: any) {
      setError(e?.message || "Error al analizar la foto.")
      setEstado("inicio")
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="bg-white w-full rounded-t-3xl p-5 max-w-2xl mx-auto space-y-4 max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="font-bold text-gray-900 text-lg">📷 Buscar con la cámara</p>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none px-1">✕</button>
        </div>

        <input
          ref={camaraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            procesar(e.target.files?.[0])
            e.target.value = ""
          }}
        />
        <input
          ref={galeriaRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            procesar(e.target.files?.[0])
            e.target.value = ""
          }}
        />

        {estado === "inicio" && (
          <>
            <p className="text-gray-500 text-sm">
              Sacale una foto al producto o a su código de barras, o elegí una imagen que te
              mandaron. El sistema detecta de qué artículo se trata.
            </p>
            {error && (
              <p className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => camaraRef.current?.click()}
                className="bg-emerald-600 text-white rounded-2xl py-6 font-bold text-lg active:scale-[0.97] transition-transform"
              >
                📷 Sacar foto
              </button>
              <button
                onClick={() => galeriaRef.current?.click()}
                className="bg-white border-2 border-emerald-600 text-emerald-700 rounded-2xl py-6 font-bold text-lg active:scale-[0.97] transition-transform"
              >
                🖼 Galería
              </button>
            </div>
          </>
        )}

        {estado === "analizando" && (
          <div className="text-center py-6 space-y-4">
            {preview && (
              <img src={preview} alt="" className="h-40 mx-auto rounded-xl object-contain bg-gray-50" />
            )}
            <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-gray-500">Identificando el artículo...</p>
          </div>
        )}

        {estado === "resultados" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {preview && (
                <img src={preview} alt="" className="w-14 h-14 rounded-xl object-cover bg-gray-50 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Detectado</p>
                <p className="font-bold text-gray-900 leading-snug">{deteccion || "Sin identificar"}</p>
              </div>
            </div>

            {sugerencias.length ? (
              <div className="space-y-2">
                {sugerencias.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => onSelect(a)}
                    className="w-full bg-white rounded-xl border border-gray-200 p-3 text-left flex items-center gap-3 active:scale-[0.98] transition-transform"
                  >
                    {a.imagen_url ? (
                      <img src={a.imagen_url} alt="" className="w-12 h-12 rounded-lg object-cover bg-gray-100 shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-gray-100 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-gray-900 text-sm leading-snug">{a.descripcion}</p>
                      <p className="text-gray-400 text-xs">
                        {[a.marca, a.unidades_por_bulto ? `${a.unidades_por_bulto} u/bulto` : null]
                          .filter(Boolean)
                          .join(" · ")}
                        {` · Stock: ${a.stock_disponible}`}
                      </p>
                    </div>
                    <span className="text-emerald-600 text-xl shrink-0">›</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="bg-gray-50 rounded-xl p-4 text-center text-gray-500 text-sm">
                No se encontraron artículos parecidos en el catálogo. Probá con otra foto o buscá por texto.
              </p>
            )}

            <button
              onClick={() => {
                setEstado("inicio")
                setPreview(null)
                setSugerencias([])
                setDeteccion(null)
              }}
              className="w-full border border-gray-300 text-gray-600 rounded-xl py-3 font-bold"
            >
              📷 Probar con otra foto
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
