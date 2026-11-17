/**
 * /api/proveedores/importar-datos — importador del Excel "proveedores-para-completar".
 *
 * GET  → { admin: boolean }   (para que la pantalla sepa si muestra el botón)
 * GET ?plantilla=1 → la plantilla para completar: una fila por proveedor con lo que tiene
 *        cargado hoy y la hoja de ayuda (solo admin). El navegador arma el Excel.
 * POST → { accion: "previsualizar" | "guardar", filas: FilaCruda[], archivo?: string }
 *
 * El Excel se lee en el navegador; acá llega JSON con el texto de cada celda. TODO se valida
 * y se compara contra la base en el servidor, con la misma función pura para la vista previa
 * y para el guardado (`analizarImportacion` de lib/proveedores/importar-datos.ts): "guardar"
 * vuelve a validar y a calcular los cambios antes de escribir.
 *
 * Solo rol admin. Lo vacío no se modifica. Una fila con error no se importa. No crea proveedores.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAuth, getUserRoles } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { faltaLaColumna } from "@/lib/utils/migracion-pendiente"
import { guardarHistorialImportacion } from "@/lib/import/guardar-historial"
import {
  COLUMNAS_PLANTILLA, COLUMNAS_PROVEEDOR, analizarImportacion, ayudaPlantilla, filaPlantilla, limpiarFilaCruda, textoValor, updateDeCambios,
  type FilaAnalizada, type ProveedorActual,
} from "@/lib/proveedores/importar-datos"

const MAX_FILAS = 5000
const FALTA_MIGRACION = "Falta aplicar la migración 20261117m_proveedores_datos_compra.sql. No se guardó nada."

/** Usuario admin, o la respuesta de error (401 sin sesión, 403 sin rol). */
async function exigirAdmin() {
  const auth = await requireAuth()
  if (auth.error) return { user: null, error: auth.error }
  const roles = await getUserRoles(auth.user.id)
  if (!roles.includes("admin")) {
    return {
      user: null,
      error: NextResponse.json({ error: "Solo un administrador puede importar los datos de compra de los proveedores.", error_code: "SIN_PERMISO" }, { status: 403 }),
    }
  }
  return { user: auth.user, error: null }
}

export async function GET(request: NextRequest) {
  if (new URL(request.url).searchParams.get("plantilla") === "1") return plantilla()
  const auth = await requireAuth()
  if (auth.error) return NextResponse.json({ admin: false })
  const roles = await getUserRoles(auth.user.id)
  return NextResponse.json({ admin: roles.includes("admin") })
}

/**
 * La plantilla: mismas columnas y mismos textos que entiende el importador, con los datos de
 * hoy. Se lee con `select *` para que sirva aunque todavía no esté la migración 20261117m
 * (las columnas nuevas salen vacías y se avisa).
 */
async function plantilla() {
  const auth = await exigirAdmin()
  if (auth.error) return auth.error
  try {
    const sb = createAdminClient()
    const proveedores: ProveedorActual[] = []
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await sb.from("proveedores").select("*").order("nombre").order("id").range(desde, desde + 999)
      if (error) throw error
      proveedores.push(...((data || []) as unknown as ProveedorActual[]))
      if (!data || data.length < 1000) break
    }
    const activos = proveedores.filter((p) => p.activo !== false)
    const sinMigracion = activos.length > 0 && !("mail_ordenes_compra" in activos[0])
    return NextResponse.json({
      columnas: COLUMNAS_PLANTILLA.map((c) => ({ encabezado: c.encabezado, ancho: c.ancho })),
      filas: activos.map((p) => { const f = filaPlantilla(p); return COLUMNAS_PLANTILLA.map((c) => f[c.clave] ?? "") }),
      ayuda: ayudaPlantilla(),
      aviso: sinMigracion ? "Todavía falta aplicar la migración 20261117m_proveedores_datos_compra.sql: las columnas nuevas salen vacías y no se van a poder importar hasta aplicarla." : null,
    })
  } catch (e: any) {
    console.error("[Importar proveedores] plantilla:", e)
    return NextResponse.json({ error: e?.message || "No se pudo armar la plantilla." }, { status: 500 })
  }
}

/** Todos los proveedores con las columnas que se comparan (de a 1000). */
async function leerProveedores(sb: ReturnType<typeof createAdminClient>): Promise<{ proveedores: ProveedorActual[]; error: any }> {
  const proveedores: ProveedorActual[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from("proveedores").select(COLUMNAS_PROVEEDOR.join(", ")).order("id").range(desde, desde + 999)
    if (error) return { proveedores: [], error }
    proveedores.push(...((data || []) as unknown as ProveedorActual[]))
    if (!data || data.length < 1000) break
  }
  return { proveedores, error: null }
}

/** Fila para la pantalla: los valores ya vienen en texto (formato argentino). */
function filaParaPantalla(f: FilaAnalizada) {
  return {
    fila: f.fila,
    codigo: f.codigo,
    nombre_excel: f.nombre_excel,
    nombre_sistema: f.nombre_sistema,
    estado: f.estado,
    cambios: f.cambios.map((c) => ({ campo: c.campo, etiqueta: c.etiqueta, antes: textoValor(c.campo, c.antes), despues: textoValor(c.campo, c.despues) })),
    errores: f.errores,
    avisos: f.avisos,
  }
}

export async function POST(request: NextRequest) {
  const auth = await exigirAdmin()
  if (auth.error) return auth.error

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: "El pedido no se pudo leer." }, { status: 400 }) }
  const accion = body?.accion
  if (accion !== "previsualizar" && accion !== "guardar") {
    return NextResponse.json({ error: 'Falta la acción ("previsualizar" o "guardar").' }, { status: 400 })
  }
  if (!Array.isArray(body?.filas) || body.filas.length === 0) {
    return NextResponse.json({ error: "No llegó ninguna fila del Excel." }, { status: 400 })
  }
  if (body.filas.length > MAX_FILAS) {
    return NextResponse.json({ error: `El Excel tiene demasiadas filas (${body.filas.length}; el máximo es ${MAX_FILAS}).` }, { status: 400 })
  }
  const crudas = (body.filas as unknown[]).map((x, i) => limpiarFilaCruda(x, i))

  try {
    const sb = createAdminClient()
    const leido = await leerProveedores(sb)
    if (leido.error) {
      if (faltaLaColumna(leido.error)) return NextResponse.json({ error: FALTA_MIGRACION, error_code: "FALTA_MIGRACION" }, { status: 409 })
      throw leido.error
    }
    const { filas, resumen } = analizarImportacion(crudas, leido.proveedores)

    if (accion === "previsualizar") {
      return NextResponse.json({ resumen, filas: filas.map(filaParaPantalla) })
    }

    // ── Guardar: un UPDATE por proveedor, solo con las columnas que cambian ──
    const guardadas: { fila: number; codigo: string | null; nombre: string | null; campos: number }[] = []
    const fallidas: { fila: number; codigo: string | null; nombre: string | null; mensaje: string }[] = []
    let sinCambios = 0
    for (const f of filas) {
      const nombre = f.nombre_sistema ?? f.nombre_excel
      if (f.estado === "error" || f.estado === "no_existe") {
        fallidas.push({ fila: f.fila, codigo: f.codigo, nombre, mensaje: f.errores.map((e) => `${e.columna}: ${e.mensaje}`).join(" · ") })
        continue
      }
      if (f.estado === "sin_cambios" || !f.proveedor_id) { sinCambios++; continue }
      const { data, error } = await sb.from("proveedores").update(updateDeCambios(f.cambios)).eq("id", f.proveedor_id).select("id")
      if (error) {
        const mensaje = faltaLaColumna(error)
          ? "Falta aplicar la migración 20261117m_proveedores_datos_compra.sql"
          : /prov_pago_(blanco|negro)_medio_check/.test(String(error.message || ""))
            ? 'La base todavía no acepta el medio de pago "echeq": falta aplicar la migración 20261117m_proveedores_datos_compra.sql'
            : String(error.message || "No se pudo guardar")
        fallidas.push({ fila: f.fila, codigo: f.codigo, nombre, mensaje })
        continue
      }
      if (!data || data.length === 0) {
        fallidas.push({ fila: f.fila, codigo: f.codigo, nombre, mensaje: "El proveedor ya no existe en el sistema" })
        continue
      }
      guardadas.push({ fila: f.fila, codigo: f.codigo, nombre, campos: f.cambios.length })
    }

    const idsGuardados = new Set(guardadas.map((g) => g.fila))
    await guardarHistorialImportacion({
      modulo: "proveedores",
      archivo_nombre: typeof body.archivo === "string" ? body.archivo.slice(0, 200) : null,
      usuario_id: auth.user.id,
      conector: "codigo_proveedor",
      filas: filas.map((f) => {
        const falla = fallidas.find((x) => x.fila === f.fila)
        return {
          clave: f.codigo,
          nombre: f.nombre_sistema ?? f.nombre_excel,
          status: idsGuardados.has(f.fila) ? "actualizado" : f.estado === "no_existe" ? "no_encontrado" : falla ? "error" : "sin_cambios",
          cambios: idsGuardados.has(f.fila) ? f.cambios.map((c) => ({ campo: c.campo, actual: c.antes, nuevo: c.despues })) : [],
          ...(falla ? { error: falla.mensaje } : {}),
        }
      }),
    })

    return NextResponse.json({ guardados: guardadas.length, sin_cambios: sinCambios, fallidos: fallidas.length, guardadas, fallidas })
  } catch (error: any) {
    console.error("[proveedores/importar-datos] Error:", error)
    return NextResponse.json({ error: error?.message || "No se pudo procesar la importación." }, { status: 500 })
  }
}
