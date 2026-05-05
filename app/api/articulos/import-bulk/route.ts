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
  descuento_propio?: number      // % ya incluido en el precio base, sólo para mostrar en comprobantes
  marca_codigo?: string          // se resuelve a marca_id antes de guardar
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
  "descuento_propio",
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

    // Cargar marcas para resolver marca_codigo → marca_id
    const marcasMap: Map<string, string> = new Map()
    const { data: marcasData } = await supabase.from("marcas").select("id,codigo")
    for (const m of marcasData || []) {
      marcasMap.set(m.codigo.toUpperCase(), m.id)
    }

    // Obtener todos los SKUs de la importación.
    // Para cada SKU del Excel también incluimos la versión sin ceros iniciales,
    // así "000370" (texto en Excel) puede matchear "370" (en DB) y viceversa.
    const skusRaw = rows.map(r => r.sku.trim().toUpperCase())
    const stripLeadingZeros = (s: string) => s.replace(/^0+/, "") || s
    const skus = [...new Set(skusRaw.flatMap(s => {
      const stripped = stripLeadingZeros(s)
      return stripped !== s ? [s, stripped] : [s]
    }))]

    // Cargar artículos existentes en chunks
    const articulosMap: Map<string, any> = new Map()
    for (let i = 0; i < skus.length; i += CHUNK_SIZE) {
      const chunk = skus.slice(i, i + CHUNK_SIZE)
      const { data } = await supabase
        .from("articulos")
        .select(`
          id, sku, descripcion, ean13, unidades_por_bulto,
          precio_compra, porcentaje_ganancia, precio_base, precio_base_contado,
          descuento_propio, marca_id
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
      const skuStripped = stripLeadingZeros(skuNorm)
      // Buscar primero por coincidencia exacta, luego sin ceros iniciales
      // (cubre "000370" en Excel vs "370" en DB, y también "370" en Excel vs "000370" en DB)
      // Fallback solo cuando el Excel tiene ceros iniciales ("000370" → busca "370").
      // Si el Excel tiene "370" y DB tiene "000370", NO matchea (no hay inverso).
      const existente = articulosMap.get(skuNorm)
        ?? (skuStripped !== skuNorm ? articulosMap.get(skuStripped) : undefined)
        ?? null
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

      // marca_codigo → diff
      if (row.marca_codigo !== undefined) {
        const marcaIdNuevo = marcasMap.get(row.marca_codigo.trim().toUpperCase()) || null
        const marcaIdActual = existente?.marca_id || null
        if (marcaIdActual !== marcaIdNuevo) {
          diffs.push({
            sku: row.sku,
            articulo_id: articuloId,
            campo: "marca_codigo",
            valor_actual: marcaIdActual,
            valor_nuevo: row.marca_codigo || null,
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
    // Separar en dos grupos: existentes (update) y nuevos (insert)
    const paraActualizar = rowsParaActualizar.filter(x => x.articulo !== null)
    const paraNuevos     = rowsParaActualizar.filter(x => x.articulo === null)

    let actualizados = 0
    let nuevosCreados = 0
    let errores = 0
    const erroresDetalle: Array<{ sku: string; error: string }> = []

    // ── 1. Bulk update de campos directos (upsert por id en batches de 200) ──
    // Agrupa por sku→id y envía updates en batches paralelos
    const updateBatch: Array<{ id: string; sku: string; campos: Record<string,any> }> = []
    for (const { row, articulo } of paraActualizar) {
      const camposUpdate: Record<string, any> = {}
      for (const campo of CAMPOS_DIRECTOS) {
        if (row[campo as keyof ArticleUpdateRow] !== undefined) {
          camposUpdate[campo] = row[campo as keyof ArticleUpdateRow]
        }
      }
      if (row.marca_codigo !== undefined) {
        camposUpdate["marca_id"] = marcasMap.get(row.marca_codigo.trim().toUpperCase()) || null
      }
      if (Object.keys(camposUpdate).length > 0) {
        updateBatch.push({ id: articulo!.id, sku: row.sku, campos: camposUpdate })
      } else {
        actualizados++ // sin cambios de campos directos, igual se cuenta
      }
    }

    // Ejecutar updates en paralelo con batches de 50
    const BATCH = 50
    for (let i = 0; i < updateBatch.length; i += BATCH) {
      const chunk = updateBatch.slice(i, i + BATCH)
      const results = await Promise.allSettled(
        chunk.map(({ id, campos }) =>
          supabase.from("articulos").update(campos).eq("id", id)
        )
      )
      for (let j = 0; j < results.length; j++) {
        const r = results[j]
        if (r.status === "fulfilled" && !r.value.error) {
          actualizados++
        } else {
          errores++
          const msg = r.status === "rejected" ? r.reason?.message : (r.value.error?.message || "Error")
          erroresDetalle.push({ sku: chunk[j].sku, error: msg })
        }
      }
    }

    // ── 2. Insert de artículos nuevos (también en batches) ──
    for (let i = 0; i < paraNuevos.length; i += BATCH) {
      const chunk = paraNuevos.slice(i, i + BATCH)
      const results = await Promise.allSettled(
        chunk.map(({ row }) => {
          const camposUpdate: Record<string, any> = {}
          for (const campo of CAMPOS_DIRECTOS) {
            if (row[campo as keyof ArticleUpdateRow] !== undefined) {
              camposUpdate[campo] = row[campo as keyof ArticleUpdateRow]
            }
          }
          if (row.marca_codigo !== undefined) {
            camposUpdate["marca_id"] = marcasMap.get(row.marca_codigo.trim().toUpperCase()) || null
          }
          return supabase.from("articulos").insert({
            sku: row.sku.trim().toUpperCase(),
            activo: true,
            precio_compra: 0,
            ...camposUpdate,
          }).select("id").single()
        })
      )
      for (let j = 0; j < results.length; j++) {
        const r = results[j]
        if (r.status === "fulfilled" && !r.value.error && r.value.data) {
          nuevosCreados++
          // Guardar id del nuevo artículo para descuentos
          ;(paraNuevos[i + j] as any).__newId = r.value.data.id
        } else {
          errores++
          const msg = r.status === "rejected" ? r.reason?.message : (r.value.error?.message || "Error")
          erroresDetalle.push({ sku: paraNuevos[i + j].row.sku, error: msg })
        }
      }
    }

    // ── 3. Descuentos tipados (solo para filas que los traen) ──
    // Construir lista de operaciones de descuento
    const descOps: Array<{ articuloId: string; tipoDesc: string; nuevosDesc: number[] }> = []
    for (const { row, articulo } of rowsParaActualizar) {
      const articuloId = articulo?.id || (row as any).__newId
      if (!articuloId) continue
      for (const tipoDesc of ["comercial", "financiero", "promocional"] as const) {
        const key = `descuento_${tipoDesc}` as keyof ArticleUpdateRow
        if (row[key] === undefined) continue
        descOps.push({ articuloId, tipoDesc, nuevosDesc: parseDescuentos(row[key] as string) })
      }
    }
    // Ejecutar en batches
    for (let i = 0; i < descOps.length; i += BATCH) {
      await Promise.allSettled(
        descOps.slice(i, i + BATCH).map(async ({ articuloId, tipoDesc, nuevosDesc }) => {
          await supabase.from("articulos_descuentos")
            .delete().eq("articulo_id", articuloId).eq("tipo", tipoDesc)
          if (nuevosDesc.length > 0) {
            await supabase.from("articulos_descuentos").insert(
              nuevosDesc.map((pct, idx) => ({
                articulo_id: articuloId, tipo: tipoDesc, porcentaje: pct, orden: idx + 1,
              }))
            )
          }
        })
      )
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
