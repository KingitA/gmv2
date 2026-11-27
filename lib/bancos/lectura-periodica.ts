/**
 * Lectura periódica de los bancos con API (cada 30 minutos, de 7 a 22). SOLO SERVIDOR.
 * La dispara la base (pg_cron → bancos_lectura_periodica(), migración 20261127a) llamando a
 * /api/cron/bancos-lectura.
 *
 *  - MercadoPago: si hay MP_ACCESS_TOKEN, últimos 3 días + saldo. Sin token: "no conectado".
 *  - Credicoop: SOLO con el banco real (ambiente producción). En homologación / simulador no se
 *    lee nada: los movimientos de prueba no son de la cuenta y no deben entrar a la conciliación.
 *    Horario bancario (lunes a viernes de 8 a 20): el banco limita los pedidos por minuto.
 *
 * Todo entra por importarExtracto (idempotente; corre extracto_matchear). No concilia nada solo.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { hoyISO, sumarDiasISO } from "@/lib/formato"
import { estadoConexion } from "./credicoop/config"
import { esHorarioBancario } from "./credicoop/confirmacion"
import { cuentasCredicoopDelSistema, traerMovimientos } from "./operaciones"
import { leerMercadoPago } from "./lectura-servidor"

export async function lecturaPeriodica(db: SupabaseClient, o: { forzar?: boolean; ahora?: Date } = {}) {
  const resultado: Record<string, unknown> = {}

  try {
    resultado.mercadopago = await leerMercadoPago(db, { dias: 3 })
  } catch (e) {
    console.error("[bancos] lectura MercadoPago", e)
    resultado.mercadopago = { error: (e as Error)?.message ?? "Falló la lectura de MercadoPago" }
  }

  const conexion = estadoConexion()
  if (!conexion.conectado) resultado.credicoop = { leido: false, motivo: "Credicoop no está conectado." }
  else if (conexion.ambiente !== "produccion") resultado.credicoop = { leido: false, motivo: `Credicoop en ${conexion.ambiente}: no se leen movimientos de prueba.` }
  else if (!o.forzar && !esHorarioBancario(o.ahora ?? new Date())) resultado.credicoop = { leido: false, motivo: "Fuera del horario bancario." }
  else {
    const hoy = hoyISO()
    const cuentas = await cuentasCredicoopDelSistema(db)
    const porCuenta: unknown[] = []
    for (const c of cuentas) {
      try {
        const r = await traerMovimientos(db, { cuentaBancariaId: c.id, desde: sumarDiasISO(hoy, -3), hasta: hoy }, null)
        porCuenta.push({ cuenta: r.cuenta, traidos: r.traidos, importados: r.importado?.importados ?? 0, saldo: r.saldo, parcial: r.parcial })
      } catch (e) {
        console.error("[bancos] lectura Credicoop", c.nombre, e)
        porCuenta.push({ cuenta: c.nombre, error: (e as Error)?.message ?? "Falló" })
      }
    }
    resultado.credicoop = { leido: true, cuentas: porCuenta }
  }
  return resultado
}
