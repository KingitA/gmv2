/**
 * POST /api/clientes/import-bulk
 *
 * Actualización masiva de datos de clientes desde un Excel mapeado.
 *
 * A diferencia de /api/clientes/import (importación tradicional con plantilla fija),
 * este endpoint:
 *   - Usa una COLUMNA CONECTORA (codigo_cliente o cuit) para encontrar al cliente.
 *   - Solo actualiza los campos que el usuario mapeó y que traen valor (no pisa el resto).
 *   - NO crea clientes nuevos: las filas cuyo conector no existe se reportan como
 *     "no encontrado" (evita duplicados y datos basura).
 *   - Devuelve un reporte fila por fila: código, nombre y qué se actualizó / por qué no.
 *
 * Body: { connector: "codigo_cliente" | "cuit", rows: Array<Record<string,any>>, dry_run?: boolean }
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from "@/lib/auth"
import { guardarHistorialImportacion } from "@/lib/import/guardar-historial"

// Campos que el importador puede actualizar (whitelist — nada fuera de acá se escribe)
const ALLOWED_FIELDS = new Set<string>([
  "codigo_cliente", "cuit", "nombre_razon_social", "nombre", "direccion", "localidad",
  "provincia", "telefono", "mail", "condicion_iva", "metodo_facturacion", "condicion_pago",
  "tipo_canal", "nro_iibb", "percepcion_iibb", "exento_iibb", "exento_iva", "dias_credito",
  "limite_credito", "zona", "observaciones",
])

const NUMERIC_FIELDS = new Set<string>(["percepcion_iibb", "limite_credito", "dias_credito"])
const BOOLEAN_FIELDS = new Set<string>(["exento_iibb", "exento_iva"])
const CONNECTORS = new Set<string>(["codigo_cliente", "cuit"])

const CHUNK = 500
const UPDATE_BATCH = 50

type Status = "actualizado" | "actualizar" | "sin_cambios" | "no_encontrado" | "error"

interface FilaReporte {
  clave: string | null       // código de cliente o CUIT usado para matchear
  nombre: string | null
  status: Status
  cambios: { campo: string; actual: any; nuevo: any }[]
  error?: string
}

/** Convierte el valor crudo del Excel al tipo correcto del campo. Devuelve null si está vacío. */
function coerce(field: string, raw: any): any {
  if (raw === null || raw === undefined) return null
  const str = String(raw).trim()
  if (str === "") return null

  if (NUMERIC_FIELDS.has(field)) {
    const n = parseFloat(str.replace(",", "."))
    return isNaN(n) ? null : n
  }
  if (BOOLEAN_FIELDS.has(field)) {
    return /^(si|sí|1|true|verdadero|x)$/i.test(str)
  }
  return str
}

/** Compara dos valores ya normalizados para decidir si hay cambio real. */
function sonIguales(field: string, a: any, b: any): boolean {
  if (NUMERIC_FIELDS.has(field)) {
    if (a == null || b == null) return a === b
    return Math.round(Number(a) * 100) === Math.round(Number(b) * 100)
  }
  if (BOOLEAN_FIELDS.has(field)) {
    return Boolean(a) === Boolean(b)
  }
  return String(a ?? "").trim() === String(b ?? "").trim()
}

const stripLeadingZeros = (s: string) => s.replace(/^0+/, "") || s

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const body = await req.json()
    const { connector, rows, dry_run, archivo } = body as {
      connector: string
      rows: Record<string, any>[]
      dry_run?: boolean
      archivo?: string
    }

    if (!CONNECTORS.has(connector)) {
      return NextResponse.json({ error: "Columna conectora inválida. Debe ser 'codigo_cliente' o 'cuit'." }, { status: 400 })
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No se recibieron filas para procesar." }, { status: 400 })
    }

    const supabase = createAdminClient()

    // ── 1. Cargar clientes existentes por la columna conectora ──
    const esCodigo = connector === "codigo_cliente"
    const connValues: string[] = []
    for (const row of rows) {
      const v = row[connector]
      if (v !== null && v !== undefined && String(v).trim() !== "") connValues.push(String(v).trim())
    }

    // Valores a consultar: el valor tal cual y, para código, su versión sin ceros iniciales
    const queryValues = new Set<string>()
    for (const v of connValues) {
      queryValues.add(v)
      if (esCodigo) queryValues.add(stripLeadingZeros(v))
    }

    // Columnas a traer: id + identificadores + los campos que vamos a comparar
    const usedFields = new Set<string>(["id", "codigo_cliente", "cuit", "nombre", "nombre_razon_social"])
    for (const row of rows) {
      for (const k of Object.keys(row)) if (ALLOWED_FIELDS.has(k)) usedFields.add(k)
    }
    const selectCols = Array.from(usedFields).join(",")

    const existingMap = new Map<string, any>()
    const queryArr = Array.from(queryValues)
    for (let i = 0; i < queryArr.length; i += CHUNK) {
      const chunk = queryArr.slice(i, i + CHUNK)
      const { data, error } = await supabase.from("clientes").select(selectCols).in(connector, chunk)
      if (error) {
        return NextResponse.json({ error: `Error consultando clientes: ${error.message}` }, { status: 500 })
      }
      for (const c of (data || []) as any[]) {
        const key = String(c[connector] ?? "").trim()
        if (key) {
          existingMap.set(key, c)
          if (esCodigo) existingMap.set(stripLeadingZeros(key), c) // también por versión sin ceros
        }
      }
    }

    const lookup = (connVal: string) =>
      existingMap.get(connVal) ?? (esCodigo ? existingMap.get(stripLeadingZeros(connVal)) : undefined) ?? null

    // ── 2. Procesar cada fila: calcular cambios ──
    const filas: FilaReporte[] = []
    const updates: { id: string; payload: Record<string, any>; idx: number }[] = []

    for (const row of rows) {
      const connVal = String(row[connector] ?? "").trim()

      if (!connVal) {
        filas.push({ clave: null, nombre: null, status: "error", cambios: [], error: "Fila sin valor en la columna conectora." })
        continue
      }

      const existing = lookup(connVal)
      if (!existing) {
        filas.push({ clave: connVal, nombre: null, status: "no_encontrado", cambios: [] })
        continue
      }

      const cambios: FilaReporte["cambios"] = []
      const payload: Record<string, any> = {}

      for (const field of Object.keys(row)) {
        if (!ALLOWED_FIELDS.has(field)) continue
        if (field === connector) continue // la conectora no se actualiza
        const nuevo = coerce(field, row[field])
        if (nuevo === null) continue // celda vacía → no tocar ese campo
        const actual = coerce(field, existing[field])
        if (!sonIguales(field, nuevo, actual)) {
          cambios.push({ campo: field, actual: existing[field] ?? null, nuevo })
          payload[field] = nuevo
        }
      }

      // Mantener sincronizados nombre / nombre_razon_social
      if (payload.nombre_razon_social && !payload.nombre) payload.nombre = payload.nombre_razon_social
      if (payload.nombre && !payload.nombre_razon_social) payload.nombre_razon_social = payload.nombre

      const baseInfo = {
        clave: existing.codigo_cliente ?? existing.cuit ?? connVal,
        nombre: existing.nombre || existing.nombre_razon_social || null,
      }

      if (cambios.length === 0) {
        filas.push({ ...baseInfo, status: "sin_cambios", cambios: [] })
      } else {
        const idx = filas.push({ ...baseInfo, status: dry_run ? "actualizar" : "actualizado", cambios }) - 1
        updates.push({ id: existing.id, payload, idx })
      }
    }

    // ── 3. Aplicar (salvo dry_run) ──
    if (!dry_run && updates.length > 0) {
      for (let i = 0; i < updates.length; i += UPDATE_BATCH) {
        const batch = updates.slice(i, i + UPDATE_BATCH)
        const results = await Promise.allSettled(
          batch.map(u => supabase.from("clientes").update(u.payload).eq("id", u.id))
        )
        results.forEach((r, j) => {
          const u = batch[j]
          const ok = r.status === "fulfilled" && !(r.value as any).error
          if (!ok) {
            const msg = r.status === "rejected" ? (r.reason?.message || "Error") : ((r.value as any).error?.message || "Error")
            filas[u.idx].status = "error"
            filas[u.idx].error = msg
          }
        })
      }
    }

    const resumen = {
      actualizados: filas.filter(f => f.status === "actualizado" || f.status === "actualizar").length,
      sin_cambios: filas.filter(f => f.status === "sin_cambios").length,
      no_encontrados: filas.filter(f => f.status === "no_encontrado").length,
      errores: filas.filter(f => f.status === "error").length,
    }

    // Guardar en historial (solo cuando se aplicó de verdad)
    if (!dry_run) {
      await guardarHistorialImportacion({
        modulo: "clientes",
        archivo_nombre: archivo ?? null,
        usuario_id: auth.user?.id ?? null,
        conector: connector,
        filas,
      })
    }

    return NextResponse.json({ dry_run: !!dry_run, total_filas: rows.length, resumen, filas })
  } catch (error: any) {
    console.error("[clientes/import-bulk] Error:", error)
    return NextResponse.json({ error: error.message || "Error procesando la importación." }, { status: 500 })
  }
}
