"use server"

// Ficha COMERCIAL del cliente: lista/método (general o por segmento),
// descuentos (general / viajante / mercadería) y contado, por segmento o
// "todos", y la segmentación por proveedor/marca. ÚNICO camino del ERP para
// guardarlos (ficha /clientes/[id] y "Guardar en la ficha" al tomar un pedido):
// antes había tres maneras distintas que se pisaban entre sí.
//
// Bonificaciones: baja LÓGICA (activo=false) de lo que cambió + alta de lo nuevo
// (misma semántica que la app vendedor). Lo que no cambió no se toca y las filas
// con proveedor (cargas viejas) tampoco.
//
// Los pedidos ya tomados NO se re-precian: su precio y condiciones se cerraron
// al tomarlos (lib/pedidos/condiciones-pedido.ts). La ficha nueva rige desde el
// próximo pedido; para llevar uno a precios de hoy está "Repreciar".

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { CONTADO_PCT, SEGMENTOS_BONIF } from "@/lib/pricing/segmento"
import { limpiarCentinela } from "@/lib/pricing/resolver"

const TIPOS = ["general", "viajante", "mercaderia", "contado"] as const
type Tipo = (typeof TIPOS)[number]

export interface ListasFichaInput {
  metodo_facturacion: string | null
  lista_precio_id: string | null
  lista_limpieza_id: string | null
  metodo_limpieza: string | null
  lista_perf0_id: string | null
  metodo_perf0: string | null
  lista_perf_plus_id: string | null
  metodo_perf_plus: string | null
}

export interface DescuentosFichaInput {
  /** true = por segmento (limpieza_bazar / perf0 / perf_plus); false = "todos" */
  porSegmento: boolean
  /** clave `${segmento|"todos"}__${tipo}` → %. contado: > 0 = sí (siempre 10%) */
  valores: Record<string, number>
  /** tipos a guardar (default: los 4) */
  tipos?: Tipo[]
}

export interface CondicionFichaInput {
  ref_id: string
  lista_precio_id: string | null
  metodo_facturacion: string | null
  dto_general_pct: number | null
  dto_viajante_pct: number | null
  dto_mercaderia_pct: number | null
  contado: boolean | null
}

async function sesion() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")
  return { supabase, user }
}

const nulo = (v: unknown) => (v === "" || v === undefined || v === "__none__" || v === "__heredar__" ? null : v)

/** Guarda listas/métodos y/o descuentos+contado de la ficha. */
export async function guardarFichaComercial(
  clienteId: string,
  input: { listas?: ListasFichaInput | null; descuentos?: DescuentosFichaInput | null },
) {
  const { supabase, user } = await sesion()

  if (input.listas) {
    const l = input.listas
    const upd: Record<string, unknown> = {}
    for (const k of Object.keys(l) as Array<keyof ListasFichaInput>) {
      upd[k] = limpiarCentinela((nulo(l[k]) as string | null) ?? undefined) ?? null
    }
    const { error } = await supabase
      .from("clientes")
      .update({ ...upd, actualizado_por: user.id, actualizado_at: new Date().toISOString() })
      .eq("id", clienteId)
    if (error) throw new Error(`No se pudo guardar la lista/método: ${error.message}`)
  }

  if (input.descuentos) {
    const d = input.descuentos
    const tipos = d.tipos?.length ? d.tipos : [...TIPOS]
    const segs: Array<string | null> = d.porSegmento ? [...SEGMENTOS_BONIF] : [null]
    const deseadas: Array<{ tipo: Tipo; segmento: string | null; porcentaje: number }> = []
    for (const tipo of tipos) {
      for (const seg of segs) {
        const raw = Number(d.valores[`${seg ?? "todos"}__${tipo}`]) || 0
        const pct = tipo === "contado" ? (raw > 0 ? CONTADO_PCT : 0) : Math.max(0, Math.min(100, raw))
        if (pct > 0) deseadas.push({ tipo, segmento: seg, porcentaje: pct })
      }
    }

    const { data: actuales, error: errAct } = await supabase
      .from("bonificaciones")
      .select("id, tipo, segmento, porcentaje")
      .eq("cliente_id", clienteId)
      .eq("activo", true)
      .is("proveedor_id", null)
      .in("tipo", tipos)
    if (errAct) throw new Error(errAct.message)

    const clave = (t: string, s: string | null, p: number) => `${t}|${s ?? ""}|${Number(p)}`
    const deseadasClaves = new Set(deseadas.map((x) => clave(x.tipo, x.segmento, x.porcentaje)))
    const actualesClaves = new Set<string>()
    const apagar: string[] = []
    for (const a of actuales || []) {
      const k = clave(a.tipo, a.segmento || null, a.porcentaje)
      if (deseadasClaves.has(k) && !actualesClaves.has(k)) actualesClaves.add(k)
      else apagar.push(a.id) // cambió, sobra o está duplicada
    }
    if (apagar.length) {
      const { error } = await supabase.from("bonificaciones").update({ activo: false }).in("id", apagar)
      if (error) throw new Error(`No se pudieron actualizar los descuentos: ${error.message}`)
    }
    const nuevas = deseadas
      .filter((x) => !actualesClaves.has(clave(x.tipo, x.segmento, x.porcentaje)))
      .map((x) => ({ cliente_id: clienteId, tipo: x.tipo, segmento: x.segmento, porcentaje: x.porcentaje, activo: true }))
    if (nuevas.length) {
      const { error } = await supabase.from("bonificaciones").insert(nuevas)
      if (error) throw new Error(`No se pudieron guardar los descuentos: ${error.message}`)
    }
  }

  revalidatePath(`/clientes/${clienteId}`)
  return { success: true }
}

/** Reemplaza la segmentación por proveedor y por marca de la ficha. */
export async function guardarSegmentacionCliente(
  clienteId: string,
  seg: { proveedor: CondicionFichaInput[]; marca: CondicionFichaInput[] },
) {
  const { supabase } = await sesion()
  const fila = (r: CondicionFichaInput) => ({
    lista_precio_id: limpiarCentinela(r.lista_precio_id ?? undefined) ?? null,
    metodo_facturacion: limpiarCentinela(r.metodo_facturacion ?? undefined) ?? null,
    dto_general_pct: r.dto_general_pct ?? null,
    dto_viajante_pct: r.dto_viajante_pct ?? null,
    dto_mercaderia_pct: r.dto_mercaderia_pct ?? null,
    contado: r.contado ?? null,
  })

  const { error: delP } = await supabase.from("cliente_proveedor_condicion").delete().eq("cliente_id", clienteId)
  if (delP) throw new Error(delP.message)
  const { error: delM } = await supabase.from("cliente_marca_condicion").delete().eq("cliente_id", clienteId)
  if (delM) throw new Error(delM.message)

  const prov = (seg.proveedor || []).filter((r) => r?.ref_id).map((r) => ({ cliente_id: clienteId, proveedor_id: r.ref_id, ...fila(r) }))
  if (prov.length) {
    const { error } = await supabase.from("cliente_proveedor_condicion").insert(prov)
    if (error) throw new Error(error.message)
  }
  const marca = (seg.marca || []).filter((r) => r?.ref_id).map((r) => ({ cliente_id: clienteId, marca_id: r.ref_id, ...fila(r) }))
  if (marca.length) {
    const { error } = await supabase.from("cliente_marca_condicion").insert(marca)
    if (error) throw new Error(error.message)
  }
  revalidatePath(`/clientes/${clienteId}`)
  return { success: true }
}
