import { describe, expect, it } from "vitest"
import type { ItemOutbox } from "../src/db/idb"
import { viajeVisible } from "../../../apps/chofer/src/datos/overlay"
import { vencimientoComprobante } from "../../../apps/chofer/src/datos/cuenta-cobro"
import type { OpCobrar, ParadaHoja, ViajeDetalle } from "../../../apps/chofer/src/datasets"

// App Chofer — condiciones de pago, fase 4 (19/11/2026): freno de ANTICIPADO y vencimientos en el cobro.

let seq = 0
const op = (tipo: string, payload: unknown, estado: ItemOutbox["estado"] = "pendiente"): ItemOutbox => ({
  key: `k${++seq}`, seq, tipo, payload, capturadoAt: "2026-11-19T12:00:00Z", estado, intentos: 0, proximoIntentoAt: 0,
  error: estado === "rechazado" ? "rechazado" : null, resultado: null, enviadoAt: null, usuarioId: "yo", etiqueta: null,
})
const V = "00000000-0000-4000-8000-000000005001"
const parada = (extra: Partial<ParadaHoja> = {}): ParadaHoja => ({
  id: "p1", orden: 1, cliente_id: "c1", cliente_nombre: "Cliente", direccion: "", localidad: "", telefono: "", vendedores: [],
  exigir_cobro_anterior: false, exigir_cobro_actual: false, bloquear_entrega: false, motivo_bloqueo: null, nota_oficina: null,
  estado: "pendiente", bultos_entregados: null, motivo_no_entrega: null, motivo_no_cobro: null, resuelto_at: null,
  pedidos: [{ id: "ped1", numero: "002100", estado: "en_viaje", total: 10000, bultos: 3, vendedor: "", comprobantes: [], remitos: [] }],
  bultos: 3, total_viaje: 10000, saldo_anterior: 0, total_a_cobrar: 10000, minimo_exigido: 0, cobrado: 0, cobrado_anterior: 0, cobrado_viaje: 0, devuelto: 0, cobro_cumplido: true,
  pagos: [], ...extra,
})
const viaje = (p: ParadaHoja): ViajeDetalle => ({
  id: V,
  viaje: { id: V, nombre: "Reparto", fecha: "2026-11-19", estado: "en_curso", zona_nombre: "", es_titular: true, chofer_id: "yo" },
  paradas: [p],
  dinero: { fondo_entregado: 0, fondos: [], gastos: [], gastos_total: 0, cobrado_efectivo: 0, cobrado_cheques: 0, cheques_cantidad: 0, cobrado_transferencias: 0, efectivo_en_mano: 0, saldo_billetera_titular: 0 },
  tripulacion: [],
})
const cobro = (monto: number): OpCobrar => ({
  viaje_id: V, cliente_id: "c1", cliente_nombre: "Cliente", monto_total: monto, metodos: [{ tipo: "efectivo", monto }], imputaciones: [], devolucion_ids: [], comprobante_urls: [],
  pedidos_contado: [], contado_general: false, ajuste_redondeo: 0, cobros_extra: [], fotos_pendientes: [],
})

describe("Anticipado sin cobro: no se entrega", () => {
  it("con un pedido anticipado sin cobro, la parada queda frenada", () => {
    expect(viajeVisible(viaje(parada({ anticipado_sin_cobro: ["002100"] })), []).paradas[0]!.anticipado_bloqueado).toBe(true)
  })
  it("un cobro registrado en el equipo (sin señal, en la cola) ya habilita la entrega", () => {
    expect(viajeVisible(viaje(parada({ anticipado_sin_cobro: ["002100"] })), [op("viaje.cobrar", cobro(5000))]).paradas[0]!.anticipado_bloqueado).toBe(false)
  })
  it("un cobro rechazado no cuenta; sin anticipado no hay freno; réplica vieja tampoco", () => {
    expect(viajeVisible(viaje(parada({ anticipado_sin_cobro: ["002100"] })), [op("viaje.cobrar", cobro(5000), "rechazado")]).paradas[0]!.anticipado_bloqueado).toBe(true)
    expect(viajeVisible(viaje(parada({ anticipado_sin_cobro: [] })), []).paradas[0]!.anticipado_bloqueado).toBe(false)
    expect(viajeVisible(viaje(parada()), []).paradas[0]!.anticipado_bloqueado).toBe(false)
  })
})

describe("Vencimiento de cada comprobante en el cobro", () => {
  it("antes de hoy: VENCIDO; hoy o después: Vence; sin fecha: nada", () => {
    expect(vencimientoComprobante("2026-11-10", "2026-11-19")).toEqual({ texto: "VENCIDO 10/11/2026", vencido: true })
    expect(vencimientoComprobante("2026-11-19", "2026-11-19")).toEqual({ texto: "Vence 19/11/2026", vencido: false })
    expect(vencimientoComprobante(null, "2026-11-19")).toBeNull()
  })
})
