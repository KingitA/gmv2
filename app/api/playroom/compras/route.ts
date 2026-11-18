import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requirePermiso, tienePermiso } from "@/lib/auth"
import { hoyISO, parseFecha, sumarDiasISO } from "@/lib/formato"
import { buscarArticuloParaReporte, buscarProveedorParaReporte } from "@/lib/jarvis/herramientas"
import { FaltaMigracion, REPORTES_COMPRAS, type ReporteCompras } from "@/lib/jarvis/reportes-compras"

/**
 * GET /api/playroom/compras?reporte=…&desde=&hasta=&proveedor=&articulo=
 *
 * Reportes de compras de Playroom (E-81). Solo lectura. Las cuentas se hacen en la base
 * (funciones jarvis_* de 20261119c_jarvis_compras.sql), las mismas que usa Jarvis.
 *
 * Permisos: los reportes de Playroom (admin y administrativo). El de retenciones, además,
 * solo admin (mismo permiso que las órdenes de pago).
 *
 * reporte: compras_proveedor_mes | costo_articulo | deuda_proveedores | retenciones |
 *          oc_pendientes | cumplimiento_proveedor | notas_esperadas
 */
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const auth = await requirePermiso("reportes_playroom")
  if (auth.error) return auth.error

  const q = new URL(req.url).searchParams
  const id = String(q.get("reporte") ?? "") as ReporteCompras
  const def = REPORTES_COMPRAS[id]
  if (!def) return NextResponse.json({ error: "Reporte desconocido." }, { status: 400 })
  if (def.soloAdmin && !tienePermiso(auth.roles, "ordenes_pago")) {
    return NextResponse.json({ error: "Este reporte solo lo puede ver un administrador.", error_code: "SIN_PERMISO" }, { status: 403 })
  }

  const hoy = hoyISO()
  let desde = parseFecha(q.get("desde")) ?? sumarDiasISO(hoy, -364)
  let hasta = parseFecha(q.get("hasta")) ?? hoy
  if (desde > hasta) [desde, hasta] = [hasta, desde]

  try {
    const db = createAdminClient()
    const textoProv = (q.get("proveedor") ?? "").trim()
    const textoArt = (q.get("articulo") ?? "").trim()
    // En el reporte de notas, el artículo es una búsqueda por palabras (no hace falta que exista uno solo)
    const prov = textoProv ? await buscarProveedorParaReporte(db, textoProv) : null
    const art = textoArt && id !== "notas_esperadas" ? await buscarArticuloParaReporte(db, textoArt) : null
    const tabla = await def.fn(db, {
      desde, hasta,
      proveedorId: prov?.id ?? null, proveedorNombre: prov?.nombre,
      articuloId: art?.id ?? null, articuloNombre: art ? `${art.sku} ${art.descripcion}` : undefined,
      texto: id === "notas_esperadas" ? textoArt || null : null,
    })
    return NextResponse.json(tabla)
  } catch (e: any) {
    // "No encontré…" / "hay varios que coinciden…": se le muestra tal cual a la persona
    if (e?.name === "ErrorHerramienta" || e instanceof FaltaMigracion) return NextResponse.json({ error: e.message }, { status: 422 })
    console.error("[playroom/compras]", id, e)
    return NextResponse.json({ error: e?.message ?? "No se pudo armar el reporte." }, { status: 500 })
  }
}
