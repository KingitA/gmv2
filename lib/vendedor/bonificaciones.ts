// Bonificaciones del cliente por TIPO (viajante / mercadería) y SEGMENTO, en la
// forma que consume el módulo vendedor. Extraído de
// /api/vendedor/cliente/[id]/bonificaciones para compartirlo con la réplica móvil.

import { SEGMENTOS_BONIF, type SegmentoBonif } from "@/lib/pricing/segmento"

const TIPOS = ["viajante", "mercaderia"] as const
type Tipo = (typeof TIPOS)[number]
type PorSeg = Record<SegmentoBonif, number>
const vacio = (): PorSeg => ({ limpieza_bazar: 0, perf0: 0, perf_plus: 0 })

/** Filas ACTIVAS de `bonificaciones` de UN cliente → { viajante: {seg: %}, mercaderia: {seg: %} }. */
export function bonificacionesDesdeFilas(data: Array<{ tipo: string; segmento: string | null; porcentaje: number }> | null): Record<Tipo, PorSeg> {
  const out: Record<Tipo, PorSeg> = { viajante: vacio(), mercaderia: vacio() }
  const general: Record<Tipo, number> = { viajante: 0, mercaderia: 0 }
  for (const b of data || []) {
    const tipo = b.tipo as Tipo
    if (!TIPOS.includes(tipo)) continue
    if (b.segmento && SEGMENTOS_BONIF.includes(b.segmento as SegmentoBonif)) out[tipo][b.segmento as SegmentoBonif] = Number(b.porcentaje)
    else if (!b.segmento) general[tipo] = Number(b.porcentaje)
  }
  // Una bonificación sin segmento aplica a todos los que no tengan la suya
  for (const tipo of TIPOS) for (const s of SEGMENTOS_BONIF) if (!out[tipo][s] && general[tipo]) out[tipo][s] = general[tipo]
  return out
}

export async function leerBonificaciones(supabase: any, clienteId: string): Promise<Record<Tipo, PorSeg>> {
  const { data } = await supabase
    .from("bonificaciones")
    .select("tipo, segmento, porcentaje")
    .eq("cliente_id", clienteId)
    .in("tipo", TIPOS as unknown as string[])
    .eq("activo", true)
  return bonificacionesDesdeFilas(data)
}
