/**
 * Consulta periódica a Credicoop (cada 15 minutos, en horario bancario). SOLO SERVIDOR.
 *
 * Actualiza las operaciones que esperan la firma (o quedaron en duda) sin que nadie tenga que
 * tocar "Actualizar estado", y confirma solas las órdenes cuyo pago el banco ya procesó.
 * La dispara la base (pg_cron → bancos_consulta_periodica(), migración 20261119e) llamando a
 * /api/cron/bancos-credicoop.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { confirmarSiElBancoTermino, ordenesParaConfirmarSolas } from "./confirmar-sola"
import { estadoConexion } from "./credicoop/config"
import { esHorarioBancario } from "./credicoop/confirmacion"
import { ErrorCredicoop, estaHecha, type EstadoOperacion } from "./credicoop/nucleo"
import { actualizarOperacion, faltaTablaBancos } from "./operaciones"

/** Tope por corrida: el banco admite 50 pedidos por minuto y un endoso gasta más de uno. */
const MAXIMO_POR_CORRIDA = 25

export async function consultaPeriodica(db: SupabaseClient, o: { forzar?: boolean; ahora?: Date } = {}) {
  if (!o.forzar && !esHorarioBancario(o.ahora ?? new Date())) return { hecho: false, motivo: "Fuera del horario bancario (lunes a viernes de 8 a 20)." }
  const conexion = estadoConexion()
  if (!conexion.conectado || !conexion.ambiente) return { hecho: false, motivo: "Credicoop no está conectado." }

  const desde = new Date(Date.now() - 15 * 24 * 3600_000).toISOString()
  const { data, error } = await db.from("bancos_operaciones").select("id, orden_pago_id, estado")
    .in("estado", ["enviada_a_firma", "en_proceso", "error"]).eq("ambiente", conexion.ambiente).gte("creado_at", desde)
    .order("actualizado_at", { ascending: true }).limit(MAXIMO_POR_CORRIDA)
  if (error) {
    if (faltaTablaBancos(error)) return { hecho: false, motivo: "Falta aplicar la migración 20261119d_bancos_operaciones.sql." }
    throw new Error(error.message)
  }

  let consultadas = 0, cambiaron = 0, fallaron = 0
  let cortada: string | null = null
  const ordenes = new Set<string>()
  for (const op of (data ?? []) as Array<{ id: string; orden_pago_id: string | null; estado: string }>) {
    try {
      const nueva = await actualizarOperacion(db, op.id, null)
      consultadas++
      if (nueva.estado !== op.estado) cambiaron++
      if (estaHecha(nueva.estado as EstadoOperacion) && nueva.orden_pago_id) ordenes.add(nueva.orden_pago_id)
    } catch (e) {
      fallaron++
      // Sin conexión, sin permiso o por encima del límite de pedidos: no tiene sentido seguir con las demás
      if (e instanceof ErrorCredicoop && (e.clase === "LIMITE" || e.clase === "SIN_CONEXION" || e.clase === "AUTORIZACION")) { cortada = e.message; break }
      console.warn("[bancos] consulta periódica:", op.id, (e as Error)?.message)
    }
  }

  // Órdenes que el banco ya terminó y siguen pendientes (por si la firma se vio en otra consulta)
  for (const id of await ordenesParaConfirmarSolas(db)) ordenes.add(id)
  const confirmaciones: Array<{ orden_pago_id: string; estado: string; mensaje: string | null }> = []
  for (const id of ordenes) {
    const r = await confirmarSiElBancoTermino(db, id)
    if (r.estado !== "nada") confirmaciones.push({ orden_pago_id: id, estado: r.estado, mensaje: r.mensaje })
  }
  return { hecho: true, ambiente: conexion.ambiente, consultadas, cambiaron, fallaron, cortada, confirmaciones }
}
