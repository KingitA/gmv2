import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requirePermiso } from "@/lib/auth"
import { estadoConexion } from "@/lib/bancos/credicoop/config"
import { ESTADO_NOMBRE } from "@/lib/bancos/credicoop/nucleo"
import { cuentasCredicoopDelSistema, faltaTablaBancos, TIPO_NOMBRE } from "@/lib/bancos/operaciones"
import { respuestaErrorBanco } from "@/lib/bancos/respuesta"

/**
 * GET /api/bancos/credicoop — estado de la conexión con Credicoop, las cuentas del sistema que
 * son de Credicoop y las últimas operaciones mandadas a firmar. Solo admin. No habla con el banco.
 */
export async function GET() {
  // Mandar plata al banco: mismo permiso que confirmar una orden de pago (solo admin)
  const auth = await requirePermiso("ordenes_pago_confirmar")
  if (auth.error) return auth.error
  try {
    const db = createAdminClient()
    const cuentas = await cuentasCredicoopDelSistema(db)
    let operaciones: any[] = []
    let faltaMigracion = false
    const r = await db.from("bancos_operaciones")
      .select("*, ordenes_pago(numero_op), cuentas_bancarias(nombre)").order("creado_at", { ascending: false }).limit(100)
    if (r.error) { if (!faltaTablaBancos(r.error)) throw new Error(r.error.message); faltaMigracion = true } else operaciones = r.data ?? []
    return NextResponse.json({
      conexion: estadoConexion(), falta_migracion: faltaMigracion,
      cuentas: cuentas.map((c) => ({ id: c.id, nombre: c.nombre, cbu: c.cbu ?? null, tiene_cbu: /^\d{22}$/.test(String(c.cbu ?? "")) })),
      operaciones: operaciones.map((o) => ({
        id: o.id, tipo: o.tipo, tipo_nombre: TIPO_NOMBRE[o.tipo as keyof typeof TIPO_NOMBRE] ?? o.tipo, estado: o.estado,
        estado_nombre: ESTADO_NOMBRE[o.estado as keyof typeof ESTADO_NOMBRE] ?? o.estado, estado_banco: o.estado_banco, motivo: o.motivo,
        ambiente: o.ambiente, beneficiario: o.beneficiario_nombre, monto: Number(o.monto), fecha_pago: o.fecha_pago, numero_vep: o.numero_vep,
        id_operacion_banco: o.id_operacion_banco, orden_pago: o.ordenes_pago?.numero_op ?? null, orden_pago_id: o.orden_pago_id,
        cuenta: o.cuentas_bancarias?.nombre ?? null, creado_at: o.creado_at, firmado_at: o.firmado_at,
      })),
    })
  } catch (e) { return respuestaErrorBanco(e, "estado") }
}
