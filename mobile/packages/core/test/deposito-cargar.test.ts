import { describe, expect, it } from "vitest"
import type { ItemOutbox } from "../src/db/idb"
import {
  borradorDesdePayload, buscarClientes, cantidadDe, faltaParaCerrar, nuevoBorrador, payloadCarga, ponerCantidad, quitarRenglon, resultadoCierre,
} from "../../../apps/deposito/src/datos/cargar"

// App Depósito · "Cargar pedido" (05/11/2026): pedido nuevo para mí o para un cliente.

const CLIENTES = [
  { id: "c1", codigo: "1190", nombre: "Distribuidora Urquiza", localidad: "Punta Alta", direccion: "Urquiza 120" },
  { id: "c2", codigo: "119", nombre: "Almacén Don José", localidad: "Bahía Blanca", direccion: "Alsina 45" },
  { id: "c3", codigo: "556", nombre: "Chen Songmei", localidad: "General Roca", direccion: "San Martín 900" },
  { id: "c4", codigo: null, nombre: "Kiosco Punta", localidad: "Bahía Blanca", direccion: null },
]

describe("Cargar pedido · buscador de clientes", () => {
  it("por código: el exacto primero, después los que empiezan igual", () => {
    expect(buscarClientes(CLIENTES, "119").map((c) => c.id)).toEqual(["c2", "c1"])
  })
  it("por nombre, localidad o dirección, sin acentos y con todas las palabras", () => {
    expect(buscarClientes(CLIENTES, "almacen jose").map((c) => c.id)).toEqual(["c2"])
    expect(buscarClientes(CLIENTES, "punta").map((c) => c.id)).toEqual(["c1", "c4"])
    expect(buscarClientes(CLIENTES, "bahia kiosco").map((c) => c.id)).toEqual(["c4"])
  })
  it("con menos de 2 letras no lista nada (salvo un número de código)", () => {
    expect(buscarClientes(CLIENTES, "a")).toEqual([])
    expect(buscarClientes(CLIENTES, "5").map((c) => c.id)).toEqual(["c3"])
  })
})

describe("Cargar pedido · borrador", () => {
  const b0 = nuevoBorrador("cliente", CLIENTES[0]!, "L1")

  it("la cantidad es absoluta: escanear de nuevo la corrige; 0 lo saca", () => {
    let b = ponerCantidad(b0, "a1", 6)
    b = ponerCantidad(b, "a2", 2)
    b = ponerCantidad(b, "a1", 10)
    expect(b.items).toEqual([{ articulo_id: "a1", cantidad: 10 }, { articulo_id: "a2", cantidad: 2 }])
    expect(cantidadDe(b, "a1")).toBe(10)
    expect(ponerCantidad(b, "a1", 0).items.map((i) => i.articulo_id)).toEqual(["a2"])
    expect(quitarRenglon(b, "a2").items.map((i) => i.articulo_id)).toEqual(["a1"])
  })

  it("no se puede cerrar vacío ni 'para un cliente' sin cliente", () => {
    expect(faltaParaCerrar(b0)).toBe("Cargá al menos un artículo")
    expect(faltaParaCerrar(ponerCantidad(nuevoBorrador("cliente", null, "L2"), "a1", 1))).toBe("Elegí el cliente")
    expect(faltaParaCerrar(ponerCantidad(nuevoBorrador("propio", null, "L3"), "a1", 1))).toBeNull()
  })

  it("payload del contrato: sin precios; cliente_id solo para un cliente", () => {
    const b = ponerCantidad(b0, "a1", 3)
    expect(payloadCarga(b)).toEqual({ local_id: "L1", modo: "cliente", cliente_id: "c1", items: [{ articulo_id: "a1", cantidad: 3 }] })
    const p = payloadCarga(ponerCantidad(nuevoBorrador("propio", CLIENTES[0]!, "L4"), "a1", 1))
    expect(p).toEqual({ local_id: "L4", modo: "propio", items: [{ articulo_id: "a1", cantidad: 1 }] })
  })

  it("un rechazo vuelve a ser borrador con el MISMO local_id (el servidor no lo duplica)", () => {
    const p = payloadCarga(ponerCantidad(b0, "a1", 3))
    const b = borradorDesdePayload(p, CLIENTES[0]!)
    expect(b).toMatchObject({ local_id: "L1", modo: "cliente", cliente: { id: "c1" }, items: [{ articulo_id: "a1", cantidad: 3 }] })
  })
})

describe("Cargar pedido · resultado del cierre", () => {
  const it0 = (extra: Partial<ItemOutbox>): ItemOutbox => ({
    key: "k", seq: 1, tipo: "pedido.cargar_deposito", payload: {}, capturadoAt: "", estado: "pendiente", intentos: 0, proximoIntentoAt: 0,
    error: null, resultado: null, enviadoAt: null, usuarioId: "u", etiqueta: null, ...extra,
  })
  it("OK del servidor: el número y el cliente para el cartel", () => {
    expect(resultadoCierre(it0({ estado: "enviado", resultado: { pedido_id: "p", numero_pedido: "002031", cliente_nombre: "Urquiza" } })))
      .toEqual({ tipo: "ok", pedido_id: "p", numero_pedido: "002031", cliente_nombre: "Urquiza" })
  })
  it("rechazo: el mensaje tal cual (ej. artículo sin precio)", () => {
    expect(resultadoCierre(it0({ estado: "rechazado", error: "Sin precio: JABON X" }))).toEqual({ tipo: "rechazo", mensaje: "Sin precio: JABON X" })
  })
  it("sigue pendiente (sin señal o servidor caído): queda guardado", () => {
    expect(resultadoCierre(it0({ estado: "pendiente" }))).toEqual({ tipo: "sin_senal" })
    expect(resultadoCierre(null)).toEqual({ tipo: "sin_senal" })
  })
})
