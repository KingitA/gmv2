"use client"

// Lectura de fotos de cheques/transferencias en la WEB (chofer y vendedor), en
// segundo plano. La fila del formulario se crea al instante (lib/cheques/fila) y se
// completa cuando el OCR responde. Acá vive lo que comparten las dos páginas:
//  - leerFotoComprobante: comprime, sube y lee UNA foto (con timeout), devuelve
//    resultados ya validados por el servidor.
//  - useLectorFotos: orquesta filas + lecturas; el formulario solo pinta.
//  - Chips/estilos para marcar qué campo vino del OCR.

import { useCallback, useEffect, useRef } from "react"
import {
  aplicarOcr,
  filaDesdeFoto,
  marcarFalloOcr,
  marcarFotoAdjunta,
  marcarSinDatos,
  resultadoConDatos,
  type CampoCheque,
  type FilaCheque,
  type ResultadoOcr,
} from "@/lib/cheques/isomorfico"
import { comprimirFoto, urlLocal } from "@/lib/cheques/foto"

const OCR_TIMEOUT_MS = 45_000

export interface LecturaFoto {
  /** URL de la foto en el bucket (null si no se pudo subir) */
  url: string | null
  resultados: ResultadoOcr[]
  error: string | null
}

/** Comprime, sube y lee una foto. Nunca lanza: el error va en `error`. */
export async function leerFotoComprobante(file: File | Blob, opts: { soloSubir?: boolean; nombre?: string } = {}): Promise<LecturaFoto> {
  try {
    const foto = await comprimirFoto(file, { nombre: opts.nombre })
    const fd = new FormData()
    fd.append("files", foto.blob, foto.nombre)
    if (opts.soloSubir) fd.append("solo_subir", "1")
    const res = await fetch("/api/pagos-clientes/ocr", { method: "POST", body: fd, signal: AbortSignal.timeout(OCR_TIMEOUT_MS) })
    const d = await res.json().catch(() => null)
    if (!res.ok || !d || d.error) return { url: null, resultados: [], error: d?.error || `Error ${res.status}` }
    const url: string | null = d.archivos_por_indice?.[0]?.url ?? d.archivos?.[0]?.url ?? null
    const resultados: ResultadoOcr[] = Array.isArray(d.saneados) ? d.saneados.filter(resultadoConDatos) : []
    const error = !opts.soloSubir && !resultados.length ? (Array.isArray(d.errores) && d.errores[0] ? String(d.errores[0]).replace(/^[^:]*:\s*/, "") : null) : null
    return { url, resultados, error }
  } catch (e: any) {
    const timeout = e?.name === "TimeoutError" || e?.name === "AbortError"
    return { url: null, resultados: [], error: timeout ? "el servidor tardó demasiado" : "sin conexión" }
  }
}

let seq = 0
const nuevoId = () => `foto-${Date.now().toString(36)}-${(seq++).toString(36)}`

/**
 * Orquesta fotos → filas. `setFilas` es el setState del formulario. Por cada foto:
 * fila nueva al instante (con vista previa) → OCR en segundo plano → la fila se
 * completa (o queda para carga manual). Si una foto trae varios comprobantes, los
 * extra van en filas nuevas. Las lecturas siguen aunque el formulario se cierre.
 */
export function useLectorFotos(setFilas: (fn: (prev: FilaCheque[]) => FilaCheque[]) => void) {
  const vivo = useRef(true)
  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
    }
  }, [])

  // Archivo original por fila: para "reintentar adjuntar" si la subida falló
  const archivos = useRef(new Map<string, File>())

  const reintentarSubida = useCallback(
    (filaId: string) => {
      const file = archivos.current.get(filaId)
      if (!file) return
      setFilas((prev) => prev.map((f) => (f.id === filaId ? { ...f, ocr: { ...f.ocr, estado: "leyendo", detalle: null } } : f)))
      void leerFotoComprobante(file, { soloSubir: true }).then((lect) => {
        if (!vivo.current) return
        setFilas((prev) => prev.map((f) => (f.id === filaId ? (lect.url ? marcarFotoAdjunta(f, lect.url) : marcarFalloOcr(f, null, lect.error || undefined)) : f)))
      })
    },
    [setFilas],
  )

  const leer = useCallback(
    (files: FileList | File[] | null | undefined, opts: { filaId?: string } = {}) => {
      if (!files || !files.length) return
      for (const file of Array.from(files)) {
        const id = opts.filaId || nuevoId()
        archivos.current.set(id, file)
        const local = urlLocal(file)
        if (opts.filaId) {
          setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, ocr: { ...f.ocr, estado: "leyendo", foto_local: local, detalle: null } } : f)))
        } else {
          setFilas((prev) => [...prev, filaDesdeFoto(id, local)])
        }
        void leerFotoComprobante(file).then((lect) => {
          if (!vivo.current) return
          setFilas((prev) => {
            const idx = prev.findIndex((f) => f.id === id)
            if (idx < 0) return prev
            const fila = prev[idx]
            if (!lect.resultados.length) {
              const nueva = lect.error && lect.error !== "no se detectaron datos" ? marcarFalloOcr(fila, lect.url, lect.error) : marcarSinDatos(fila, lect.url)
              return prev.map((f, i) => (i === idx ? nueva : f))
            }
            const [primero, ...resto] = lect.resultados
            const out = prev.map((f, i) => (i === idx ? aplicarOcr(fila, primero, lect.url) : f))
            // Varios comprobantes en la misma foto: filas nuevas, misma foto
            const extras = resto.map((r) => aplicarOcr(filaDesdeFoto(nuevoId(), local), r, lect.url))
            return [...out, ...extras]
          })
        })
      }
    },
    [setFilas],
  )

  return { leer, reintentarSubida }
}

// ─── UI compartida ───────────────────────────────────────────────────────────

/** Clase extra para un input cuyo valor vino del OCR (ámbar hasta que el usuario lo pisa). */
export const clsOcr = (fila: FilaCheque, campo: CampoCheque, base = "") =>
  `${base} ${fila.ocr.deOcr.includes(campo) ? "border-amber-400 bg-amber-50" : ""}`.trim()

/** Estado de la foto/OCR de una fila: leyendo · leído · sin datos · falló. */
export function EstadoFoto({ fila, onReintentar }: { fila: FilaCheque; onReintentar?: () => void }) {
  const o = fila.ocr
  if (o.estado === "sin_foto") return null
  const preview = o.foto_url || o.foto_local
  return (
    <div className="flex items-start gap-2 text-xs">
      {preview && (
        <a href={preview} target="_blank" rel="noreferrer" className="shrink-0">
          <img src={preview} alt="Foto del comprobante" className="h-12 w-16 rounded-lg border border-gray-200 object-cover" />
        </a>
      )}
      <div className="min-w-0 flex-1">
        {o.estado === "leyendo" && (
          <p className="flex items-center gap-1.5 text-gray-500">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
            Leyendo la foto… podés cargar los datos mientras tanto.
          </p>
        )}
        {o.estado === "ok" && (
          <p className="text-amber-700">
            <span className="rounded bg-amber-100 px-1 font-bold">OCR</span> Los campos en ámbar vinieron de la foto: revisalos y corregí lo que haga falta.
          </p>
        )}
        {o.pista && <p className="mt-0.5 font-medium text-red-700">{o.pista}</p>}
        {(o.estado === "sin_datos" || o.estado === "fallo") && (
          <p className="text-gray-600">
            {o.detalle}
            {onReintentar && !o.foto_url && (
              <button type="button" onClick={onReintentar} className="ml-1 font-bold text-blue-700 underline">
                Reintentar adjuntar
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
