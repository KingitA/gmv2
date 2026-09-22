import { describe, expect, it } from "vitest"
import { CARTEL_PRECIOS_VENCIDOS, preciosVencidos, vigenciaDelPedido } from "@gm/vendedor"
import { ErrorReglaCobranza, errorDeRpcCobranza, esReglaDeNegocio, mensajeParaUsuario } from "../../../../lib/cobranzas/errores"
import { Outbox } from "../src/sync/outbox"
import { cuentaVacia, cuentaVisible } from "../../../apps/vendedor/src/datos/overlay"
import type { Cliente } from "../../../apps/vendedor/src/datasets"
import { apiFalsa, dbNueva, type Manejador } from "./helpers"

// Dos reglas decididas por el dueño antes del merge de la app Vendedor (21/09/2026):
//  1. Tope de 24 hs a la vigencia de precios del pedido.
//  2. Un cobro rechazado por regla de negocio es DEFINITIVO: se le muestra al vendedor y
//     sale de la cola sin trabar lo que cargó después.

const H = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()

describe("Vendedor · vigencia de precios con tope de 24 hs", () => {
  const ahora = Date.parse("2026-09-21T15:00:00Z")

  it("precios frescos: se factura a lo que el vendedor tenía a la vista (precios_al), garantizado", () => {
    const v = vigenciaDelPedido(iso(ahora - 10 * 60_000), iso(ahora - 3 * H), ahora)
    expect(v).toEqual({ vigenciaAt: iso(ahora - 3 * H), garantizada: true })
  })

  it("justo en el límite (24 hs exactas) todavía vale; pasado el límite, no", () => {
    const captura = ahora - 5 * 60_000
    expect(vigenciaDelPedido(iso(captura), iso(captura - 24 * H), ahora).garantizada).toBe(true)
    expect(vigenciaDelPedido(iso(captura), iso(captura - 24 * H - 1000), ahora).garantizada).toBe(false)
  })

  it("más de 24 hs sin actualizar AL CAPTURAR: rige el precio del sistema cuando INGRESA el pedido", () => {
    const v = vigenciaDelPedido(iso(ahora - 2 * H), iso(ahora - 30 * H), ahora)
    expect(v).toEqual({ vigenciaAt: iso(ahora), garantizada: false })
  })

  it("lo que cuenta es la antigüedad al CAPTURAR, no cuánto tardó en sincronizar", () => {
    // Pedido tomado con precios de hace 2 hs, que recién pudo salir 3 días después: se respeta
    const captura = ahora - 72 * H
    const v = vigenciaDelPedido(iso(captura), iso(captura - 2 * H), ahora)
    expect(v).toEqual({ vigenciaAt: iso(captura - 2 * H), garantizada: true })
  })

  it("reloj del equipo adelantado: la vigencia nunca es el futuro; sin precios_al = regla original", () => {
    expect(vigenciaDelPedido(iso(ahora + 5 * H), iso(ahora - H), ahora).vigenciaAt).toBe(iso(ahora - H))
    expect(vigenciaDelPedido(iso(ahora - H), null, ahora)).toEqual({ vigenciaAt: iso(ahora - H), garantizada: true })
  })

  it("el cartel de la app usa la MISMA regla y el texto exacto que pidió el dueño", () => {
    expect(preciosVencidos(iso(ahora - 23 * H), ahora)).toBe(false)
    expect(preciosVencidos(iso(ahora - 25 * H), ahora)).toBe(true)
    expect(CARTEL_PRECIOS_VENCIDOS).toBe("HACE MAS DE 24HS NO SE ACTUALIZAN DATOS, LA EMPRESA NO SE RESPONSABILIZA POR DIFERENCIA DE PRECIOS")
  })
})

describe("Cobranzas · rechazo de negocio vs error transitorio", () => {
  it("RAISE EXCEPTION de la RPC (SQLSTATE P0001) = regla de negocio: definitivo", () => {
    const e = errorDeRpcCobranza("cobranza_crear", { code: "P0001", message: "el comprobante 0001-00001072 está anulado — no se puede cobrar" })
    expect(e).toBeInstanceOf(ErrorReglaCobranza)
    expect((e as ErrorReglaCobranza).codigo).toBe("regla_negocio")
    // Retrocompatible: el mensaje que ve la web es el de siempre
    expect(e.message).toBe("cobranza_crear: el comprobante 0001-00001072 está anulado — no se puede cobrar")
    expect(mensajeParaUsuario(e)).toBe("el comprobante 0001-00001072 está anulado — no se puede cobrar")
  })

  it("el RAISE real ya trae el prefijo de la RPC (verificado contra producción): no se duplica", () => {
    const e = errorDeRpcCobranza("cobranza_crear", { code: "P0001", message: "cobranza_crear: el monto debe ser mayor a 0" })
    expect(e.message).toBe("cobranza_crear: el monto debe ser mayor a 0")
    expect(mensajeParaUsuario(e)).toBe("el monto debe ser mayor a 0")
    expect(mensajeParaUsuario(new Error("cobranza_crear: cobranza_crear: x"))).toBe("x")
  })

  it("todo lo demás es transitorio (se reintenta): timeout, deadlock, serialización, PostgREST caído, sin código", () => {
    for (const code of ["57014", "40P01", "40001", "PGRST301", "08006", "", undefined, null]) {
      const e = errorDeRpcCobranza("cobranza_crear", { code, message: "x" })
      expect(e).not.toBeInstanceOf(ErrorReglaCobranza)
      expect(esReglaDeNegocio({ code })).toBe(false)
    }
    expect(esReglaDeNegocio(null)).toBe(false)
  })

  it("también clasifica la anulación", () => {
    expect(errorDeRpcCobranza("cobranza_anular", { code: "P0001", message: "el pago ya fue rendido" })).toBeInstanceOf(ErrorReglaCobranza)
  })
})

describe("Vendedor · un cobro rechazado no traba la cola", () => {
  /** Servidor: responde 422 a los cobros (regla de negocio) o 500 (como ANTES del fix) y aplica el resto. */
  function servidor(statusCobro: number) {
    const recibidas: string[] = []
    const manejador: Manejador = ({ body }) => {
      recibidas.push(body.tipo)
      if (body.tipo === "cobro.registrar") {
        return statusCobro === 422
          ? { status: 422, body: { estado: "rechazado", error: "el comprobante 0001-00001072 está anulado — no se puede cobrar", codigo: "regla_negocio" } }
          : { status: statusCobro, body: { error: "Error transitorio, se reintentará." } }
      }
      return { status: 200, body: { estado: "aplicado", resultado: { ok: true } } }
    }
    return { manejador, recibidas }
  }
  const crear = async (manejador: Manejador) => {
    const { api } = apiFalsa(manejador)
    const reloj = { t: 1_000_000 }
    const ob = new Outbox(await dbNueva(), api, { app: "vendedor", deviceId: "d", appVersion: "t", usuarioActual: () => "u1", autoEnviar: false }, () => reloj.t)
    return { ob, reloj }
  }
  const cobro = { clientes: [{ cliente_id: "c1", imputaciones: [{ comprobante_id: "f1", monto: 600 }] }], metodos: [{ tipo: "efectivo", monto: 600 }] }

  it("422 = rechazado: queda a la vista con el motivo, sale de la cola y lo de atrás se envía", async () => {
    const srv = servidor(422)
    const { ob } = await crear(srv.manejador)
    const c = await ob.encolar({ tipo: "cobro.registrar", payload: cobro, etiqueta: "Cobro Almacén $ 600" })
    const p = await ob.encolar({ tipo: "pedido.crear", payload: { local_id: "L1" } })
    await ob.enviar()
    expect((await ob.item(c.key))).toMatchObject({ estado: "rechazado", error: "el comprobante 0001-00001072 está anulado — no se puede cobrar" })
    expect((await ob.item(p.key))?.estado).toBe("enviado") // NO quedó trabado detrás del cobro
    expect(ob.contadores).toMatchObject({ pendientes: 0, rechazados: 1 })
    // No se reintenta nunca más
    await ob.enviar({ forzar: true })
    expect(srv.recibidas.filter((t) => t === "cobro.registrar")).toHaveLength(1)
    // El vendedor lo descarta cuando ya lo vio
    await ob.descartar(c.key)
    expect(ob.contadores.rechazados).toBe(0)
  })

  it("el cobro rechazado deja de reservar el comprobante: se puede volver a cobrar bien", () => {
    const cliente = { id: "c1", nombre: "Almacén", saldo_actual: 1000, saldo_proyectado: 1000, pagos_sin_rendir: 0, bonificaciones: { viajante: {}, mercaderia: {} } } as unknown as Cliente
    const cc = { ...cuentaVacia(cliente), comprobantes: [{ id: "f1", tipo_comprobante: "FA", numero_comprobante: "1", fecha: "2026-09-01", total_factura: 1000, saldo_pendiente: 1000, estado_pago: "pendiente", pedido_id: null, en_cobro: 0, en_cobro_contado: 0 }] }
    const op = (estado: "pendiente" | "rechazado") => ({ key: "k", seq: 1, tipo: "cobro.registrar", payload: cobro, capturadoAt: "2026-09-21T12:00:00Z", estado, intentos: 1, proximoIntentoAt: 0, error: null, resultado: null, enviadoAt: null, usuarioId: "u1", etiqueta: null })
    expect(cuentaVisible(cc, [op("pendiente")]).comprobantes[0]!.en_cobro).toBe(600)
    expect(cuentaVisible(cc, [op("rechazado")]).comprobantes[0]!.en_cobro).toBe(0)
    expect(cuentaVisible(cc, [op("rechazado")]).pagos_recientes).toEqual([])
  })

  it("REGRESIÓN que se corrige: con el 500 de antes, el cobro quedaba reintentando y TRABABA el pedido de atrás", async () => {
    const srv = servidor(500)
    const { ob, reloj } = await crear(srv.manejador)
    await ob.encolar({ tipo: "cobro.registrar", payload: cobro })
    const p = await ob.encolar({ tipo: "pedido.crear", payload: { local_id: "L1" } })
    await ob.enviar()
    reloj.t += 10 * 60_000
    await ob.enviar()
    expect((await ob.item(p.key))?.estado).toBe("pendiente")
    expect(srv.recibidas).toEqual(["cobro.registrar", "cobro.registrar"])
  })
})
