/**
 * Acciones que una propuesta de Jarvis puede tener (lo que pasa cuando una
 * persona aprieta "Sí").
 *
 * Regla de oro (PLAN.md §3): la IA NUNCA ejecuta. Ejecuta el sistema, cuando
 * una persona con permiso confirma, por el MISMO camino que usaría esa persona
 * desde la pantalla. Cada ejecución queda en la bitácora (trigger).
 *
 * - ninguna / tarea: no tocan datos del negocio.
 * - retener_entregas / liberar_entregas: lib/viajes/retencion.ts (el mismo
 *   candado "NO ENTREGAR SIN COBRAR" que oficina pone a mano en la hoja de ruta).
 * - armar_orden_compra: NO crea la orden (crearla mueve la cuenta del proveedor
 *   y el kardex). Abre el formulario de siempre ya cargado con la sugerencia del
 *   sistema; la revisa y la guarda una persona.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { liberarCliente, retenerCliente } from "@/lib/viajes/retencion"

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

const retenerEntregas: Accion = {
  tipo: "retener_entregas",
  descripcion: "Retener las entregas al cliente: en cada viaje su parada sale con \"NO ENTREGAR SIN COBRAR\" y \"cobrar lo anterior\", también en los viajes ya armados que no terminaron. Se libera con otra decisión.",
  mueveDinero: false,
  async ejecutar(db, p, usuarioId) {
    const clienteId = String(p.cliente_id ?? "")
    if (!clienteId) return { estado: "error", detalle: "Falta el cliente." }
    const r = await retenerCliente(db, clienteId, String(p.motivo ?? "deuda vencida"), usuarioId)
    return { estado: "ok", detalle: `Entregas retenidas${p.cliente ? ` a ${p.cliente}` : ""}.${r.paradasBloqueadas ? ` Se bloquearon ${r.paradasBloqueadas} parada(s) de viajes ya armados.` : " Se aplica en el próximo viaje que se arme."}` }
  },
}

const liberarEntregas: Accion = {
  tipo: "liberar_entregas",
  descripcion: "Volver a entregarle normalmente al cliente (saca el candado que puso la retención; los que puso oficina a mano se respetan).",
  mueveDinero: false,
  async ejecutar(db, p, usuarioId) {
    const clienteId = String(p.cliente_id ?? "")
    if (!clienteId) return { estado: "error", detalle: "Falta el cliente." }
    const r = await liberarCliente(db, clienteId, usuarioId)
    return { estado: "ok", detalle: `Entregas liberadas${p.cliente ? ` a ${p.cliente}` : ""}.${r.paradasLiberadas ? ` Se destrabaron ${r.paradasLiberadas} parada(s).` : ""}` }
  },
}

const armarOrdenCompra: Accion = {
  tipo: "armar_orden_compra",
  descripcion: "Abrir el formulario de orden de compra del proveedor ya cargado con la cantidad sugerida por el sistema (ventas y stock). No se guarda nada hasta que la persona la revisa y la guarda.",
  mueveDinero: false,
  async ejecutar(_db, p) {
    const proveedorId = String(p.proveedor_id ?? "")
    if (!proveedorId) return { estado: "error", detalle: "Falta el proveedor." }
    return {
      estado: "ok",
      detalle: `Te abro la orden de compra${p.proveedor ? ` de ${p.proveedor}` : ""} con lo sugerido. Revisala y guardala vos.`,
      abrir: `/ordenes-compra?nueva=1&proveedor=${encodeURIComponent(proveedorId)}&sugerir=1&origen=jarvis`,
    }
  },
}

export const ACCIONES: Record<string, Accion> = { ninguna, tarea, retener_entregas: retenerEntregas, liberar_entregas: liberarEntregas, armar_orden_compra: armarOrdenCompra }

/** Acciones que necesitan saber de qué cliente o proveedor se trata. */
export const ACCION_PIDE: Record<string, "cliente" | "proveedor"> = { retener_entregas: "cliente", liberar_entregas: "cliente", armar_orden_compra: "proveedor" }

export function buscarAccion(tipo: string | null | undefined): Accion {
  return ACCIONES[tipo ?? ""] ?? ninguna
}
