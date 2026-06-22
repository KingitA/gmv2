/**
 * POST /api/proveedores/import-bulk
 *
 * Actualización masiva de proveedores desde un Excel mapeado. Mismo criterio que
 * clientes: matchea por columna conectora (codigo_proveedor o cuit), solo toca los
 * campos mapeados con valor, NO crea proveedores nuevos (evita duplicados) y devuelve
 * un reporte fila por fila. Guarda historial en importaciones_historial.
 *
 * Body: { connector: "codigo_proveedor" | "cuit", rows: Array<Record<string,any>>, dry_run?: boolean, archivo?: string }
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from "@/lib/auth"
import { guardarHistorialImportacion } from "@/lib/import/guardar-historial"

const ALLOWED_FIELDS = new Set<string>([
  "codigo_proveedor", "cuit", "nombre", "sigla", "email", "mail_oficina", "mail_vendedor",
  "telefono", "telefono_oficina", "telefono_vendedor", "direccion", "localidad", "provincia",
  "codigo_postal", "condicion_pago", "condicion_pago_tipo", "plazo_dias", "dias_vencimiento",
  "tipo_proveedor", "percepcion_iva", "percepcion_iibb", "retencion_iibb", "retencion_ganancias",
  "margen_ganancia", "banco_nombre", "banco_cuenta", "banco_numero_cuenta", "banco_tipo_cuenta",
])

const NUMERIC_FIELDS = new Set<string>([
  "percepcion_iva", "percepcion_iibb", "retencion_iibb", "retencion_ganancias", "margen_ganancia",
  "plazo_dias", "dias_vencimiento",
])
const CONNECTORS = new Set<string>(["codigo_proveedor", "cuit"])

const CHUNK = 500
const UPDATE_BATCH = 50

type Status = "actualizado" | "sin_cambios" | "no_encontrado" | "error"

interface FilaReporte {
  clave: string | null
  nombre: string | null
  status: Status
  cambios: { campo: string; actual: any; nuevo: any }[]
  error?: string
}

function coerce(field: string, raw: any): any {
  if (raw === null || raw === undefined) return null
  const str = String(raw).trim()
  if (str === "") return null
  if (NUMERIC_FIELDS.has(field)) {
    const n = parseFloat(str.replace(",", "."))
    return isNaN(n) ? null : n
  }
  return str
}

function sonIguales(field: string, a: any, b: any): boolean {
  if (NUMERIC_FIELDS.has(field)) {
    if (a == null || b == null) return a === b
    return Math.round(Number(a) * 100) === Math.round(Number(b) * 100)
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
      return NextResponse.json({ error: "Columna conectora inválida. Debe ser 'codigo_proveedor' o 'cuit'." }, { status: 400 })
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No se recibieron filas para procesar." }, { status: 400 })
    }

    const supabase = createAdminClient()
    const esCodigo = connector === "codigo_proveedor"

    const connValues: string[] = []
    for (const row of rows) {
      const v = row[connector]
      if (v !== null && v !== undefined && String(v).trim() !== "") connValues.push(String(v).trim())
    }

    const queryValues = new Set<string>()
    for (const v of connValues) {
      queryValues.add(v)
      if (esCodigo) queryValues.add(stripLeadingZeros(v))
    }

    const usedFields = new Set<string>(["id", "codigo_proveedor", "cuit", "nombre"])
    for (const row of rows) {
      for (const k of Object.keys(row)) if (ALLOWED_FIELDS.has(k)) usedFields.add(k)
    }
    const selectCols = Array.from(usedFields).join(",")

    const existingMap = new Map<string, any>()
    const queryArr = Array.from(queryValues)
    for (let i = 0; i < queryArr.length; i += CHUNK) {
      const chunk = queryArr.slice(i, i + CHUNK)
      const { data, error } = await supabase.from("proveedores").select(selectCols).in(connector, chunk)
      if (error) return NextResponse.json({ error: `Error consultando proveedores: ${error.message}` }, { status: 500 })
      for (const p of (data || []) as any[]) {
        const key = String(p[connector] ?? "").trim()
        if (key) {
          existingMap.set(key, p)
          if (esCodigo) existingMap.set(stripLeadingZeros(key), p)
        }
      }
    }

    const lookup = (connVal: string) =>
      existingMap.get(connVal) ?? (esCodigo ? existingMap.get(stripLeadingZeros(connVal)) : undefined) ?? null

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
        if (field === connector) continue
        const nuevo = coerce(field, row[field])
        if (nuevo === null) continue
        const actual = coerce(field, existing[field])
        if (!sonIguales(field, nuevo, actual)) {
          cambios.push({ campo: field, actual: existing[field] ?? null, nuevo })
          payload[field] = nuevo
        }
      }

      const baseInfo = { clave: existing.codigo_proveedor ?? existing.cuit ?? connVal, nombre: existing.nombre ?? null }
      if (cambios.length === 0) {
        filas.push({ ...baseInfo, status: "sin_cambios", cambios: [] })
      } else {
        const idx = filas.push({ ...baseInfo, status: "actualizado", cambios }) - 1
        updates.push({ id: existing.id, payload, idx })
      }
    }

    if (!dry_run && updates.length > 0) {
      for (let i = 0; i < updates.length; i += UPDATE_BATCH) {
        const batch = updates.slice(i, i + UPDATE_BATCH)
        const results = await Promise.allSettled(
          batch.map(u => supabase.from("proveedores").update(u.payload).eq("id", u.id))
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
      actualizados: filas.filter(f => f.status === "actualizado").length,
      sin_cambios: filas.filter(f => f.status === "sin_cambios").length,
      no_encontrados: filas.filter(f => f.status === "no_encontrado").length,
      errores: filas.filter(f => f.status === "error").length,
    }

    if (!dry_run) {
      await guardarHistorialImportacion({
        modulo: "proveedores",
        archivo_nombre: archivo ?? null,
        usuario_id: auth.user?.id ?? null,
        conector: connector,
        filas,
      })
    }

    return NextResponse.json({ dry_run: !!dry_run, total_filas: rows.length, resumen, filas })
  } catch (error: any) {
    console.error("[proveedores/import-bulk] Error:", error)
    return NextResponse.json({ error: error.message || "Error procesando la importación." }, { status: 500 })
  }
}
