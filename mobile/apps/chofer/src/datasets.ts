import type { DefDataset } from "@gm/core"

// Datasets que replica la app chofer (servidor: lib/mobile/sync/datasets.ts).
// ESQUELETO de la fundación: identidad + viajes. La sesión de la app chofer
// agrega lo que falte (saldos, remitos, precio histórico para devoluciones).
export const DATASETS: DefDataset[] = [
  { nombre: "chofer_me", prioridad: 1, cadaMs: 5 * 60_000 },
  { nombre: "chofer_viajes", prioridad: 2, cadaMs: 5 * 60_000 },
]

// Formas de las filas (= respuestas de /api/chofer/me y /api/chofer/viaje/[id])
export interface ViajeResumen {
  id: string
  nombre: string | null
  fecha: string
  estado: string
  zonas?: { nombre: string } | null
}

export interface ChoferMe {
  id: "me"
  usuario: { id: string; nombre: string | null; email: string | null }
  viaje_activo: ViajeResumen | null
  historial: ViajeResumen[]
}

export interface PedidoViaje {
  id: string
  numero: string
  estado: string
  estado_entrega: "pendiente" | "cobrado" | "devolucion_registrada"
  cliente_id: string
  cliente_nombre: string
  direccion: string
  telefono: string
  localidad: string
  bultos: number
  total_pedido: number
  saldo_anterior: number
  total_a_cobrar: number
  cobrado: number
  devuelto: number
}

export interface ViajeDetalle {
  id: string
  viaje: ViajeResumen & { zona_nombre: string; vehiculo: string | null }
  pedidos: PedidoViaje[]
  resumen: { total_pedidos: number; total_a_cobrar: number; total_cobrado: number; pendientes: number; cobrados: number }
}
