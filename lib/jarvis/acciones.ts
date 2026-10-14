/**
 * Acciones que una propuesta de Jarvis puede tener (lo que pasa cuando una
 * persona aprieta "Sí").
 *
 * Regla de oro (PLAN.md §3): la IA NUNCA ejecuta. Ejecuta el sistema, cuando
 * una persona con permiso confirma, por el MISMO camino que usaría esa persona
 * desde la pantalla. Cada ejecución queda en la bitácora (trigger).
 *
 * Etapa 3: solo acciones que no tocan datos del negocio (anotar la decisión,
 * dejar una tarea). Etapa 4 suma: retener entregas, orden de compra prellenada,
 * precio programado propuesto.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

export interface ResultadoAccion { estado: "ok" | "error" | "no_aplica"; detalle: string; abrir?: string }

export interface Accion {
  tipo: string
  /** cómo se lo explica Jarvis al proponerla */
  descripcion: string
  /** mueve plata → solo admin (decisión de Juan, 14/10/2026) */
  mueveDinero: boolean
  ejecutar: (db: SupabaseClient, parametros: Record<string, unknown>, usuarioId: string) => Promise<ResultadoAccion>
}

const ninguna: Accion = {
  tipo: "ninguna",
  descripcion: "Solo dejar anotada la decisión (quién y cuándo). El sistema no cambia nada.",
  mueveDinero: false,
  async ejecutar() { return { estado: "no_aplica", detalle: "Decisión anotada. No requiere cambios en el sistema." } },
}

const tarea: Accion = {
  tipo: "tarea",
  descripcion: "Una tarea para una persona (ej. 'llamar al cliente', 'pedir lista nueva al proveedor'). Con el Sí queda asumida por quien decidió.",
  mueveDinero: false,
  async ejecutar(_db, p) { return { estado: "no_aplica", detalle: `Tarea asumida${p.responsable ? ` por ${String(p.responsable)}` : ""}.` } },
}

export const ACCIONES: Record<string, Accion> = { ninguna, tarea }

export function buscarAccion(tipo: string | null | undefined): Accion {
  return ACCIONES[tipo ?? ""] ?? ninguna
}
