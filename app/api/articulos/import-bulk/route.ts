/**
 * POST /api/articulos/import-bulk
 *
 * Importación masiva de atributos de artículos desde un Excel mapeado.
 *
 * En modo dry_run: devuelve el diff (cambios que se aplicarían) sin tocar la DB.
 * En modo real: aplica los cambios y devuelve estadísticas.
 *
 * Body:
 * {
 *   rows: ArticleUpdateRow[]
 *   dry_run: boolean
 * }
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

export interface ArticleUpdateRow {
  sku: string
  descripcion?: string
  ean13?: string
  unidades_por_bulto?: number
  precio_compra?: number
  descuento_comercial?: string   // e.g. "10+5" o "15"
  descuento_financiero?: string
  descuento_promocional?: string
  porcentaje_ganancia?: number
  precio_base?: number
  precio_base_contado?: number
}

interface DiffRow {
  sku: string
  articulo_id: string | null   // null si es nuevo
  campo: string
  valor_actual: string | number | null
  valor_nuevo: string | number | null
  accion: "actualizar" | "nuevo"
}

// Campos directos que se pueden actualizar en la tabla articulos
const CAMPOS_DIRECTOS = [
  "descripcion",
  "ean13",
  "unidades_por_bulto",
  "precio_compra",
  "porcentaje_ganancia",
  "precio_base",
  "precio_base_contado",
] as const

type CampoDirecto = typeof CAMPOS_DIRECTOS[number]

/** Parsea un string de descuento como "10+5+2" en array de números */
function parseDescuentos(str: string | undefined): number[] {
  if (!str) return []
  return str
    .split("+")
    .map(s => parseFloat(s.trim()))
    .filter(n => !isNaN(n) && n > 0)
}

const CHUNK_SIZE = 500

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { rows, dry_run } = body as { rows: ArticleUpdateRow[]; dry_run: boolean }

    if (!rows || !Array.isArray(rows)) {
      return NextResponse.json({ error: "rows es requerido y debe ser un array" }, { status: 400 })
    }

    // Validar que todos tengan sku
    const rowsSinSku = rows.filter(r => !r.sku?.trim())
    if (rowsSinSku.length > 0) {
      return NextResponse.json(
        { error: `${rowsSinSku.length} filas no tienen SKU. El SKU es obligatorio.` },
        { status: 400 },
      )
    }

    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )

    // Obtener todos los SKUs de la importación
    const skus = [...new Set(rows.map(r => r.sku.trim().toUpperCase()))]

    // Cargar artículos existentes en chunks
    const articulosMap: Map<string, any> = new Map()
    for (let i = 0; i < skus.length; i += CHUNK_SIZE) {
      const chunk = skus.slice(i, i + CHUNK_SIZE)
      const { data } = await supabase
        .from("articulos")
        .select(`
          id, sku, descripcion, ean13, unidades_por_bulto,
          precio_compra, porcentaje_ganancia, precio_base, precio_base_contado
        `)
        .in("sku", chunk)

      for (const art of data || []) {
        articulosMap.set(art.sku.toUpperCase(), art)
      }
    }

    // Cargar descuentos actuales para los artículos existentes
    const articuloIds = [...articulosMap.values()].map(a => a.id)
    const descuentosActualesMap: Map<string, any[]> = new Map()
    if (articuloIds.length > 0) {
      for (let i = 0; i < articuloIds.length; i += CHUNK_SIZE) {
        const chunk = articuloIds.slice(i, i + CHUNK_SIZE)
        const { data } = await supabase
          .from("articulos_descuentos")
          .select("articulo_id, tipo, porcentaje, orden")
          .in("articulo_id", chunk)

        for (const d of data || []) {
          if (!descuentosActualesMap.has(d.articulo_id)) {
            descuentosActualesMap.set(d.articulo_id, [])
          }
          descuentosActualesMap.get(d.articulo_id)!.push(d)
        }
      }
    }

    // Construir diff
    const diffs: DiffRow[] = []
    const rowsParaActualizar: Array<{ row: ArticleUpdateRow; articulo: any | null }> = []

    for (const row of rows) {
      const skuNorm = row.sku.trim().toUpperCase()
      const existente = articulosMap.get(skuNorm) || null
      const articuloId = existente?.id || null

      // Campos directos
      for (const campo of CAMPOS_DIRECTOS) {
        if (row[campo as keyof ArticleUpdateRow] === undefined) continue
        const valorNuevo = row[campo as keyof ArticleUpdateRow] as any
        const valorActual = existente ? existente[campo as CampoDirecto] : null

        // Comparar: solo agregar al diff si cambió
        const cambiado = String(valorActual ?? "") !== String(valorNuevo ?? "")
        if (cambiado) {
          diffs.push({
            sku: row.sku,
            articulo_id: articuloId,
            campo,
            valor_actual: valorActual ?? null,
            valor_nuevo: valorNuevo ?? null,
            accion: existente ? "actualizar" : "nuevo",
          })
        }
      }

      // Descuentos
      for (const tipoDesc of ["comercial", "financiero", "promocional"] as const) {
        const key = `descuento_${tipoDesc}` as keyof ArticleUpdateRow
        if (row[key] === undefined) continue

        const nuevosDesc = parseDescuentos(row[key] as string)
        const actualesDesc = articuloId
          ? (descuentosActualesMap.get(articuloId) || [])
              .filter((d: any) => d.tipo === tipoDesc)
              .sort((a: any, b: any) => a.orden - b.orden)
              .map((d: any) => d.porcentaje)
          : []

        const actualStr = actualesDesc.join("+") || "—"
        const nuevoStr = nuevosDesc.join("+") || "—"

        if (actualStr !== nuevoStr) {
          diffs.push({
            sku: row.sku,
            articulo_id: articuloId,
            campo: `descuento_${tipoDesc}`,
            valor_actual: actualStr,
            valor_nuevo: nuevoStr,
            accion: existente ? "actualizar" : "nuevo",
          })
        }
      }

      rowsParaActualizar.push({ row, articulo: existente })
    }

    if (dry_run) {
      const nuevos = [...new Set(diffs.filter(d => d.accion === "nuevo").map(d => d.sku))].length
      const actualizados = [...new Set(diffs.filter(d => d.accion === "actualizar").map(d => d.sku))].length
      const sinCambios = rows.length - nuevos - actualizados

      return NextResponse.json({
        dry_run: true,
        total_filas: rows.length,
        articulos_nuevos: nuevos,
        articulos_actualizados: actualizados,
        articulos_sin_cambios: sinCambios,
        cambios_totales: diffs.length,
        diffs,
      })
    }

    // ─── Aplicar cambios ──────────────────────────────────────────────────────
    let actualizados = 0
    let nuevosCreados = 0
    let errores = 0
    const erroresDetalle: Array<{ sku: string; error: string }> = []

    for (const { row, articulo } of rowsParaActualizar) {
      try {
        // Construir objeto con campos directos que trae el row
        const camposUpdate: Record<string, any> = {}
        for (const campo of CAMPOS_DIRECTOS) {
          if (row[campo as keyof ArticleUpdateRow] !== undefined) {
            camposUpdate[campo] = row[campo as keyof ArticleUpdateRow]
          }
        }

        let articuloId: string

        if (articulo) {
          // Actualizar artículo existente
          if (Object.keys(camposUpdate).length > 0) {
            const { error } = await supabase
              .from("articulos")
              .update(camposUpdate)
              .eq("id", articulo.id)

            if (error) throw new Error(error.message)
          }
          articuloId = articulo.id
          actualizados++
        } else {
          // Crear nuevo artículo
          const { data: nuevo, error } = await supabase
            .from("articulos")
            .insert({
              sku: row.sku.trim().toUpperCase(),
              activo: true,
              precio_compra: 0,
              ...camposUpdate,
            })
            .select("id")
            .single()

          if (error || !nuevo) throw new Error(error?.message || "Error creando artículo")
          articuloId = nuevo.id
          nuevosCreados++
        }

        // Manejar descuentos tipados
        for (const tipoDesc of ["comercial", "financiero", "promocional"] as const) {
          const key = `descuento_${tipoDesc}` as keyof ArticleUpdateRow
          if (row[key] === undefined) continue

          const nuevosDesc = parseDescuentos(row[key] as string)

          // Eliminar descuentos anteriores del mismo tipo
          await supabase
            .from("articulos_descuentos")
            .delete()
            .eq("articulo_id", articuloId)
            .eq("tipo", tipoDesc)

          // Insertar nuevos
          if (nuevosDesc.length > 0) {
            await supabase.from("articulos_descuentos").insert(
              nuevosDesc.map((pct, idx) => ({
                articulo_id: articuloId,
                tipo: tipoDesc,
                porcentaje: pct,
                orden: idx + 1,
              })),
            )
          }
        }
      } catch (e: any) {
        errores++
        erroresDetalle.push({ sku: row.sku, error: e.message })
      }
    }

    return NextResponse.json({
      success: true,
      dry_run: false,
      total_filas: rows.length,
      articulos_actualizados: actualizados,
      articulos_nuevos: nuevosCreados,
      errores,
      errores_detalle: erroresDetalle,
    })
  } catch (error: any) {
    console.error("[import-bulk] Error:", error)
    return NextResponse.json(
      { error: error.message || "Error procesando importación" },
      { status: 500 },
    )
  }
}
