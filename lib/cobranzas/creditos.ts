import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Aplicación de CRÉDITOS EXISTENTES dentro de un cobro (igual que el sistema
 * viejo de Recibos: se tildan débitos Y créditos, el crédito descuenta).
 *
 * Un crédito puede ser:
 *  - 'nc': un comprobante de crédito vivo (NC/NCA/NCB/NCC/REV con saldo)
 *  - 'ac': plata a cuenta (un pago confirmado con disponible sin imputar)
 *
 * El endpoint de alta asigna los créditos a los débitos seleccionados por
 * orden (FIFO) y guarda los pares como instrucción en las observaciones del
 * pago con la marca [CREDITOS:{...}]. La ejecución ocurre en la CONFIRMACIÓN
 * (post-confirmación): así un cobro de calle rechazado no consume créditos.
 *
 * Regla de negocio (25/08): los débitos cubiertos (total o parcialmente) por
 * un crédito NO entran en el 10% de pago contado — el descuento es solo por
 * plata nueva.
 */

export interface CreditoSeleccionado {
  /** 'nc' = comprobante de crédito · 'ac' = plata a cuenta (pago) */
  tipo: "nc" | "ac"
  id: string
  /** cuánto usar de este crédito (tope: su disponible) */
  monto: number
}

export interface ParCredito {
  tipo: "nc" | "ac"
  credito_id: string
  debito_id: string
  monto: number
}

const MARCA_INICIO = "[CREDITOS:"

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Asigna los créditos seleccionados contra los débitos seleccionados, por
 * orden (FIFO), y devuelve:
 *  - pares (crédito → débito, monto)
 *  - débitos restantes (lo que debe cubrir la plata nueva del pago)
 *  - debitosConCredito: ids excluidos del 10% contado
 */
export function asignarCreditosFIFO(
  debitos: Array<{ comprobante_id: string; monto_imputado: number }>,
  creditos: CreditoSeleccionado[],
): {
  pares: ParCredito[]
  debitosRestantes: Array<{ comprobante_id: string; monto_imputado: number }>
  debitosConCredito: Set<string>
} {
  const pares: ParCredito[] = []
  const restantes = debitos.map((d) => ({ ...d, monto_imputado: r2(Number(d.monto_imputado)) }))
  const conCredito = new Set<string>()

  for (const cr of creditos) {
    let disponible = r2(Number(cr.monto))
    for (const d of restantes) {
      if (disponible <= 0.005) break
      if (d.monto_imputado <= 0.005) continue
      const aplica = r2(Math.min(disponible, d.monto_imputado))
      pares.push({ tipo: cr.tipo, credito_id: cr.id, debito_id: d.comprobante_id, monto: aplica })
      d.monto_imputado = r2(d.monto_imputado - aplica)
      disponible = r2(disponible - aplica)
      conCredito.add(d.comprobante_id)
    }
  }
  return {
    pares,
    debitosRestantes: restantes.filter((d) => d.monto_imputado > 0.005),
    debitosConCredito: conCredito,
  }
}

/**
 * Valida que cada crédito exista, sea del cliente y tenga disponible
 * suficiente. Lanza Error con mensaje claro si algo no cierra.
 */
export async function validarCreditos(
  supabase: SupabaseClient,
  clienteId: string,
  creditos: CreditoSeleccionado[],
): Promise<void> {
  for (const cr of creditos) {
    if (!(Number(cr.monto) > 0)) throw new Error("Crédito con monto inválido")
    if (cr.tipo === "nc") {
      const { data: nc } = await supabase
        .from("comprobantes_venta")
        .select("id, cliente_id, tipo_comprobante, numero_comprobante, saldo_pendiente, anulado_en, estado_pago")
        .eq("id", cr.id)
        .single()
      if (!nc) throw new Error("Crédito inexistente")
      if (nc.cliente_id !== clienteId) throw new Error(`El crédito ${nc.numero_comprobante} no es de este cliente`)
      if (nc.anulado_en || nc.estado_pago === "anulado") throw new Error(`El crédito ${nc.numero_comprobante} está anulado`)
      if (!["NC", "NCA", "NCB", "NCC", "REV"].includes(nc.tipo_comprobante))
        throw new Error(`${nc.numero_comprobante} no es un comprobante de crédito`)
      const disponible = Math.max(0, -Number(nc.saldo_pendiente))
      if (Number(cr.monto) > disponible + 0.01)
        throw new Error(`El crédito ${nc.numero_comprobante} tiene $${disponible.toFixed(2)} disponibles (pediste $${Number(cr.monto).toFixed(2)})`)
    } else {
      const { data: pg } = await supabase
        .from("pagos_clientes")
        .select("id, cliente_id, estado, monto")
        .eq("id", cr.id)
        .single()
      if (!pg) throw new Error("Pago a cuenta inexistente")
      if (pg.cliente_id !== clienteId) throw new Error("El pago a cuenta no es de este cliente")
      if (pg.estado !== "confirmado") throw new Error("El pago a cuenta no está confirmado")
      const { data: imps } = await supabase
        .from("imputaciones")
        .select("monto_imputado, estado")
        .eq("pago_id", cr.id)
        .neq("estado", "anulado")
      const usado = (imps || []).reduce((s: number, i: any) => s + Number(i.monto_imputado), 0)
      const disponible = r2(Number(pg.monto) - usado)
      if (Number(cr.monto) > disponible + 0.01)
        throw new Error(`La plata a cuenta tiene $${disponible.toFixed(2)} disponibles (pediste $${Number(cr.monto).toFixed(2)})`)
    }
  }
}

/** Serializa los pares como marca para las observaciones del pago. */
export function marcaCreditos(pares: ParCredito[]): string {
  if (!pares.length) return ""
  return `${MARCA_INICIO}${JSON.stringify(pares.map((p) => [p.tipo, p.credito_id, p.debito_id, p.monto]))}]`
}

/** Extrae y parsea la marca [CREDITOS:...] de unas observaciones. */
export function parsearMarcaCreditos(obs: string | null | undefined): ParCredito[] {
  const s = obs || ""
  const i = s.indexOf(MARCA_INICIO)
  if (i < 0) return []
  const j = s.indexOf("]]", i)
  if (j < 0) return []
  try {
    const arr = JSON.parse(s.slice(i + MARCA_INICIO.length, j + 1))
    return (arr as any[]).map((p) => ({ tipo: p[0], credito_id: p[1], debito_id: p[2], monto: Number(p[3]) }))
  } catch {
    return []
  }
}

export function quitarMarcaCreditos(obs: string): string {
  const i = obs.indexOf(MARCA_INICIO)
  if (i < 0) return obs
  const j = obs.indexOf("]]", i)
  if (j < 0) return obs
  return (obs.slice(0, i) + obs.slice(j + 2)).trim()
}

/**
 * Ejecuta los créditos de un pago confirmado (llamada desde post-confirmación):
 *  - 'nc' → cc_imputar_credito (crédito ↔ débito, atómico en SQL)
 *  - 'ac' → imputación pendiente al pago viejo + cobranza_confirmar de ese
 *    pago (idempotente: solo aplica las imputaciones nuevas)
 * Los fallos no frenan la cobranza: se devuelven como avisos.
 */
export async function ejecutarCreditosDePago(
  supabase: SupabaseClient,
  pares: ParCredito[],
): Promise<string[]> {
  const avisos: string[] = []
  for (const p of pares) {
    try {
      if (p.tipo === "nc") {
        const { error } = await supabase.rpc("cc_imputar_credito", {
          p_credito_id: p.credito_id,
          p_debito_id: p.debito_id,
          p_monto: p.monto,
          p_usuario_id: null,
        })
        if (error) throw new Error(error.message)
      } else {
        const { error: insErr } = await supabase.from("imputaciones").insert({
          pago_id: p.credito_id,
          comprobante_id: p.debito_id,
          tipo_comprobante: "venta",
          monto_imputado: p.monto,
          estado: "pendiente",
        })
        if (insErr) throw new Error(insErr.message)
        const { error: confErr } = await supabase.rpc("cobranza_confirmar", {
          p_pago_id: p.credito_id,
          p_usuario_id: null,
        })
        if (confErr) throw new Error(confErr.message)
      }
    } catch (e: any) {
      avisos.push(`Crédito ${p.credito_id.slice(0, 8)} → ${p.debito_id.slice(0, 8)} por $${p.monto}: ${e.message}`)
    }
  }
  return avisos
}
