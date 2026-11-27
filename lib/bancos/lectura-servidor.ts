/**
 * Lectura de movimientos y saldo del banco: lo que toca la base. SOLO SERVIDOR.
 * La lógica (claves, control por saldo, sin duplicar) está en lib/bancos/lectura (pura, con pruebas).
 *
 * Nada de esto toca cuentas corrientes ni el saldo interno (saldos_financieros): solo guarda
 * movimientos del banco (banco_extractos_movimientos, vía importarExtracto → extracto_matchear)
 * y el saldo que informa el banco (banco_saldos, migración 20261127a).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { ahoraISO, finDiaAR, hoyISO, sumarDiasISO } from "@/lib/formato"
import { importarExtracto } from "@/lib/finanzas/extractos-import"
import { fetchMovimientosMP, saldoMP } from "@/lib/finanzas/extracto-fuentes/mp"
import { faltaLaColumna } from "@/lib/utils/migracion-pendiente"
import { aMovImport, bancoDeCuenta, prepararLote, type BancoLectura, type Lectura, type MovExistente, type ResultadoLote, type SaldoLeido } from "./lectura"

type Fila = Record<string, any>

/** ¿Falta la tabla / vista (migración sin aplicar)? */
const faltaTabla = (e: unknown) => {
  const x = e as { code?: string; message?: string } | null
  return !!x && (x.code === "42P01" || x.code === "PGRST205" || /does not exist|could not find the table/i.test(String(x.message ?? "")))
}

export async function cuentaBancaria(db: SupabaseClient, id: string): Promise<(Fila & { banco_lectura: BancoLectura }) | null> {
  const { data, error } = await db.from("cuentas_bancarias").select("*").eq("id", id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? { ...data, banco_lectura: bancoDeCuenta(data) } : null
}

/** Movimientos ya guardados de la cuenta entre dos fechas (para no duplicar y para controlar el saldo). */
export async function movimientosExistentes(db: SupabaseClient, cuentaId: string, desde: string, hasta: string): Promise<MovExistente[]> {
  const leer = (cols: string) => {
    const filas: Fila[] = []
    const pagina = async (de: number): Promise<{ error: unknown }> => {
      const { data, error } = await db.from("banco_extractos_movimientos").select(cols)
        .eq("cuenta_bancaria_id", cuentaId).gte("fecha", desde).lte("fecha", hasta).order("fecha").range(de, de + 999)
      if (error) return { error }
      filas.push(...((data ?? []) as unknown as Fila[]))
      return (data ?? []).length === 1000 ? pagina(de + 1000) : { error: null }
    }
    return pagina(0).then((r) => ({ filas, error: r.error }))
  }
  let r = await leer("referencia_externa, fecha, monto, fuente_detalle, saldo_banco")
  if (r.error && faltaLaColumna(r.error)) r = await leer("referencia_externa, fecha, monto")
  if (r.error) throw new Error((r.error as { message?: string }).message ?? "No se pudieron leer los movimientos")
  return r.filas.map((f) => ({
    referencia_externa: String(f.referencia_externa), fecha: String(f.fecha), monto: Number(f.monto),
    fuente_detalle: (f.fuente_detalle ?? null) as MovExistente["fuente_detalle"], saldo_banco: f.saldo_banco == null ? null : Number(f.saldo_banco),
  }))
}

/** Guarda el saldo que informa el banco. Sin la migración 20261127a no hace nada (no frena la lectura). */
export async function guardarSaldoBanco(db: SupabaseClient, p: { cuentaId: string; saldo: number; al: string; fuente: string; detalle?: string | null; usuarioId?: string | null }) {
  const { error } = await db.from("banco_saldos").insert({
    cuenta_bancaria_id: p.cuentaId, saldo: p.saldo, al: p.al, fuente: p.fuente, detalle: p.detalle ?? null, registrado_por: p.usuarioId ?? null,
  })
  if (error && !faltaTabla(error)) console.warn("[bancos] no se pudo guardar el saldo del banco:", error.message)
}

/** "ahora" → instante actual; un día → fin de ese día en hora argentina. */
const instanteDe = (s: SaldoLeido) => (s.al === "ahora" ? ahoraISO() : finDiaAR(s.al))

/** Rango de fechas del lote, con unos días antes para encontrar el saldo anterior. */
function rangoDe(lecturas: Lectura[], banco: BancoLectura) {
  const fechas: string[] = []
  const lote = prepararLote(banco, lecturas, [])
  for (const f of lote.filas) if (f.fecha) fechas.push(f.fecha)
  fechas.sort()
  if (!fechas.length) return null
  return { desde: sumarDiasISO(fechas[0], -10), hasta: fechas[fechas.length - 1] }
}

export interface ResultadoGuardado {
  lote: ResultadoLote
  guardados: number
  extracto_id: string | null
  matching: unknown
  saldo_guardado: boolean
}

/**
 * Vista previa (guardar = false) o guardado de un lote de capturas / archivos de UNA cuenta.
 * Al guardar entran los "nuevo" y los "sin control" que no estén en `excluir` (claves).
 * Se recalcula todo en el servidor contra la base (nunca se confía en lo que mandó la pantalla).
 */
export async function procesarLote(db: SupabaseClient, p: { cuentaId: string; lecturas: Lectura[]; guardar: boolean; excluir?: string[]; usuarioId?: string | null }): Promise<ResultadoGuardado> {
  const cuenta = await cuentaBancaria(db, p.cuentaId)
  if (!cuenta) throw new Error("No se encontró la cuenta")
  const banco = cuenta.banco_lectura
  const rango = rangoDe(p.lecturas, banco)
  const existentes = rango ? await movimientosExistentes(db, cuenta.id, rango.desde, rango.hasta) : []
  const lote = prepararLote(banco, p.lecturas, existentes)
  if (!p.guardar) return { lote, guardados: 0, extracto_id: null, matching: null, saldo_guardado: false }

  const excluir = new Set(p.excluir ?? [])
  const aGuardar = lote.filas.filter((f) => (f.estado === "nuevo" || f.estado === "sin_control") && !excluir.has(f.clave))
  let guardados = 0, extracto_id: string | null = null, matching: unknown = null
  if (aGuardar.length) {
    const origenes = new Set(aGuardar.map((f) => f.origen))
    const fuente = origenes.has("captura") ? "captura" : origenes.has("pdf") ? "pdf" : "excel"
    const archivo = p.lecturas.find((l) => l.origen !== "captura")
    const res = await importarExtracto(db, {
      cuenta_bancaria_id: cuenta.id, fuente, movimientos: aGuardar.map(aMovImport),
      periodo_desde: archivo?.periodo_desde ?? null, periodo_hasta: archivo?.periodo_hasta ?? null,
      saldo_inicial: archivo?.saldo_inicial ?? null, saldo_final: archivo?.saldo_final ?? null,
      importado_por: p.usuarioId ?? null,
    })
    guardados = res.importados
    extracto_id = res.extracto_id
    matching = res.matching
  }
  let saldo_guardado = false
  if (lote.saldo) {
    await guardarSaldoBanco(db, { cuentaId: cuenta.id, saldo: lote.saldo.saldo, al: instanteDe(lote.saldo), fuente: lote.saldo.fuente, usuarioId: p.usuarioId })
    saldo_guardado = true
  }
  return { lote, guardados, extracto_id, matching, saldo_guardado }
}

// ─── MercadoPago por API ─────────────────────────────────────────────────────

export const mpConectado = () => !!process.env.MP_ACCESS_TOKEN

/**
 * Lee MercadoPago por API (últimos `dias` días) y lo carga como extracto (mismo circuito,
 * idempotente por el id de MP). También guarda el saldo si MP lo informa.
 */
export async function leerMercadoPago(db: SupabaseClient, o: { dias?: number; desde?: string; hasta?: string; usuarioId?: string | null } = {}) {
  if (!mpConectado()) return { conectado: false as const, mensaje: "MercadoPago no conectado" }
  const { data: cuenta } = await db.from("cuentas_bancarias").select("id, nombre").ilike("banco", "%mercado%pago%").eq("activo", true).limit(1).maybeSingle()
  if (!cuenta) return { conectado: true as const, mensaje: "No hay cuenta bancaria MercadoPago activa" }
  const hasta = o.hasta ?? hoyISO()
  const desde = o.desde ?? sumarDiasISO(hasta, -(o.dias ?? 7))
  const { movimientos, fuente_detalle } = await fetchMovimientosMP(desde, hasta)
  const res = movimientos.length
    ? await importarExtracto(db, { cuenta_bancaria_id: cuenta.id, fuente: "api_mp", movimientos, periodo_desde: desde, periodo_hasta: hasta, importado_por: o.usuarioId ?? null })
    : null
  const saldo = await saldoMP().catch(() => null)
  if (saldo != null) await guardarSaldoBanco(db, { cuentaId: cuenta.id, saldo, al: ahoraISO(), fuente: "api_mp", usuarioId: o.usuarioId })
  return { conectado: true as const, cuenta: cuenta.nombre, desde, hasta, fuente_detalle, traidos: movimientos.length, importados: res?.importados ?? 0, duplicados: res?.duplicados ?? 0, matching: res?.matching ?? null, saldo }
}
