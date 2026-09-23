import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { normalizarMonto, resultadoConDatos, sanearCheque, sanearTransferencia, type ResultadoOcr } from "@/lib/cheques/isomorfico"
import { leerComprobantesConGemini, leerTitularConGemini } from "@/lib/cheques/ocr-gemini"
import { subirFotoComprobante, type FotoSubida } from "@/lib/cobranzas/fotos"

// POST /api/pagos-clientes/ocr — multipart `files[]` (una o varias fotos).
//
// Por cada foto, EN PARALELO: la sube al bucket y la lee con Gemini (lib/cheques/ocr-gemini).
// La respuesta devuelve, por archivo, la URL de la foto y los comprobantes leídos YA
// VALIDADOS (lib/cheques: CUIT por dígito verificador, fecha y monto por formato/rango).
// Lo que no valida no viaja como dato: viaja como pista ("leído X, no cierra") y el
// cliente lo carga a mano. Nunca un dato inventado.
//
// Si a un cheque le falta el CUIT o la fecha de pago después de la primera pasada, se
// hace una segunda pasada corta (texto plano, foco en la línea del titular y las fechas).
//
// `solo_subir=1`: guarda la foto sin OCR (reintento de adjuntar cuando la lectura
// falló, o el usuario ya cargó los datos).
//
// Contrato de salida (retrocompatible con la app vendedor v0.2.x y las pantallas
// de oficina): { success, resultados[], total_encontrados, archivos[], errores? }.
// Cada resultado trae además `archivo_index` (a qué foto pertenece).

export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Resultado en el formato que ya consumen los clientes viejos (nombres de campo del prompt). */
interface OCRResultLegacy {
  tipo: "cheque" | "transferencia" | "deposito"
  archivo_index?: number
  monto?: number
  numero_cheque?: string
  banco_emisor?: string
  fecha_emision?: string
  fecha_cheque?: string
  cuit_emisor?: string
  cuits_titulares?: string[]
  color_cheque?: "ECHEQ"
  cbu_destino?: string
  cvu_destino?: string
  fecha_transferencia?: string
  numero_comprobante?: string
  cuenta_bancaria_id?: string | null
  banco_nombre?: string | null
  fecha_deposito?: string
  items?: any[]
}

/**
 * Valida cada resultado crudo del modelo. Cheques y transferencias pasan por
 * lib/cheques (campo que no valida ⇒ no viaja). Los depósitos (solo oficina) se
 * dejan pasar con los montos normalizados.
 */
function sanear(crudos: any[], bancos: any[], archivoIndex: number): { legacy: OCRResultLegacy[]; saneados: ResultadoOcr[] } {
  const legacy: OCRResultLegacy[] = []
  const saneados: ResultadoOcr[] = []
  for (const r of crudos) {
    if (!r || typeof r !== "object") continue
    if (r.tipo === "cheque") {
      const s = sanearCheque(r)
      const res: ResultadoOcr = { tipo: "cheque", ...s }
      if (!resultadoConDatos(res)) continue
      saneados.push(res)
      legacy.push({
        tipo: "cheque",
        archivo_index: archivoIndex,
        monto: s.monto,
        numero_cheque: s.numero_cheque,
        banco_emisor: s.banco,
        fecha_emision: s.fecha_emision,
        fecha_cheque: s.fecha_cheque,
        cuit_emisor: s.cuit_emisor,
        cuits_titulares: s.cuits_titulares,
        color_cheque: s.es_echeq ? "ECHEQ" : undefined,
      })
    } else if (r.tipo === "transferencia") {
      const cbu = String(r.cbu_destino || r.cvu_destino || "").replace(/\D/g, "")
      const match = cbu.length === 22 ? bancos.find((b: any) => (b.cbu && String(b.cbu).trim() === cbu) || (b.cvu && String(b.cvu).trim() === cbu)) : null
      const s = sanearTransferencia({ ...r, cuenta_bancaria_id: match?.id, banco_nombre: match ? `${match.banco} — ${match.nombre}` : undefined })
      const res: ResultadoOcr = { tipo: "transferencia", ...s }
      if (!resultadoConDatos(res)) continue
      saneados.push(res)
      legacy.push({
        tipo: "transferencia",
        archivo_index: archivoIndex,
        monto: s.monto,
        cbu_destino: cbu.length === 22 ? cbu : undefined,
        fecha_transferencia: s.fecha_transferencia,
        numero_comprobante: s.numero_comprobante,
        cuenta_bancaria_id: s.cuenta_bancaria_id ?? null,
        banco_nombre: s.banco_nombre ?? null,
      })
    } else if (r.tipo === "deposito") {
      const items = (Array.isArray(r.items) ? r.items : [])
        .map((it: any) => ({ ...it, monto: normalizarMonto(it?.monto) ?? 0 }))
        .filter((it: any) => it.monto > 0)
      legacy.push({ tipo: "deposito", archivo_index: archivoIndex, fecha_deposito: r.fecha_deposito || undefined, items, cuenta_bancaria_id: null, banco_nombre: null })
    }
  }
  return { legacy, saneados }
}

/**
 * Lee una foto: pasada 1 (JSON) y, si a algún cheque le falta CUIT válido o fecha de
 * pago, pasada 2 (texto con foco). La pasada 2 solo APORTA lo que faltaba: nunca pisa
 * lo que la primera ya leyó bien.
 */
async function leerFoto(base64: string, mime: string, nombre: string): Promise<any[]> {
  const crudos = await leerComprobantesConGemini(base64, mime)
  const cheques = crudos.filter((r) => r?.tipo === "cheque")
  console.log(`[pagos-clientes/ocr] lectura ${nombre}:`, JSON.stringify(cheques.map((r) => ({ numero: r.numero_cheque, banco: r.banco_emisor, monto: r.monto, fecha_emision: r.fecha_emision, fecha_cheque: r.fecha_cheque, cuit: r.cuit_emisor, titulares: r.cuits_titulares, linea_titular: r.linea_titular }))))
  const incompletos = cheques.filter((r) => {
    const s = sanearCheque(r)
    return !s.cuit_emisor || !s.fecha_cheque
  })
  if (incompletos.length === 1) {
    const t = await leerTitularConGemini(base64, mime)
    console.log(`[pagos-clientes/ocr] segunda pasada ${nombre}:`, JSON.stringify(t))
    const r = incompletos[0]
    if (t.linea_titular) r.linea_titular = [r.linea_titular, t.linea_titular].filter(Boolean).join(" | ")
    if (t.fecha_pago && !sanearCheque(r).fecha_cheque) r.fecha_cheque = t.fecha_pago
    if (t.fecha_emision && !sanearCheque(r).fecha_emision) r.fecha_emision = t.fecha_emision
  }
  return crudos
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const formData = await request.formData()
    const files = formData.getAll("files") as File[]
    if (!files.length) return NextResponse.json({ error: "Se requiere al menos un archivo" }, { status: 400 })
    const soloSubir = ["1", "true"].includes(String(formData.get("solo_subir") || ""))

    const { data: bancos } = soloSubir ? { data: [] as any[] } : await supabase.from("cuentas_bancarias").select("id, nombre, banco, cbu, cvu").eq("activo", true)
    const bancosActivos = bancos || []
    const admin = createAdminClient()

    const archivos: (FotoSubida | null)[] = []
    const resultados: OCRResultLegacy[] = []
    const saneados: (ResultadoOcr & { archivo_index: number })[] = []
    const errores: string[] = []

    const porArchivo = await Promise.all(
      files.map(async (file, i) => {
        const buffer = Buffer.from(await file.arrayBuffer())
        const nombre = file.name || `archivo ${i + 1}`
        // Subida y lectura EN PARALELO: la foto queda guardada aunque el OCR falle o tarde
        const subida = subirFotoComprobante(admin, buffer, { mime: file.type, nombre: file.name }).catch((e: any) => {
          console.error("[pagos-clientes/ocr] upload:", e?.message)
          return null
        })
        const lectura = soloSubir
          ? Promise.resolve<{ ok: true; crudos: any[] } | { ok: false; error: string }>({ ok: true, crudos: [] })
          : leerFoto(buffer.toString("base64"), file.type, nombre)
              .then((crudos) => ({ ok: true as const, crudos }))
              .catch((e: any) => {
                console.error("[pagos-clientes/ocr] archivo", nombre, e?.message)
                return { ok: false as const, error: String(e?.message || "no se pudo leer") }
              })
        const [foto, r] = await Promise.all([subida, lectura])
        return { i, foto, r, nombre }
      }),
    )

    for (const { i, foto, r, nombre } of porArchivo) {
      archivos[i] = foto
      if (!r.ok) {
        errores.push(`${nombre}: ${r.error}`)
        continue
      }
      const s = sanear(r.crudos, bancosActivos, i)
      for (const x of s.saneados) if (x.tipo === "cheque" && (x.descartados || x.no_encontrados?.length)) console.warn(`[pagos-clientes/ocr] ${nombre} sin validar:`, JSON.stringify({ descartados: x.descartados, no_encontrados: x.no_encontrados }))
      if (!soloSubir && !s.legacy.length) errores.push(`${nombre}: no se detectaron datos`)
      resultados.push(...s.legacy)
      saneados.push(...s.saneados.map((x) => ({ ...x, archivo_index: i })))
    }

    return NextResponse.json({
      success: true,
      resultados,
      total_encontrados: resultados.length,
      /** URLs de las fotos guardadas (orden = orden de `files`; las que fallaron no figuran) */
      archivos: archivos.filter((a): a is FotoSubida => !!a),
      /** Misma posición que `files`: null si esa foto no se pudo guardar */
      archivos_por_indice: archivos,
      /** Cheques/transferencias ya validados (lib/cheques), para los clientes nuevos */
      saneados,
      errores: errores.length ? errores : undefined,
    })
  } catch (error: any) {
    console.error("[pagos-clientes/ocr] POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
