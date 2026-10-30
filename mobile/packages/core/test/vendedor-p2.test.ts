import { describe, expect, it } from "vitest"
import { saldoVisible } from "../../../apps/vendedor/src/datos/saldo"
import { limpiarArbolesCatalogo } from "../../../apps/vendedor/src/pantallas/pedido-nuevo/contexto"

// App Vendedor — 2ª prueba integral de salida (29/10/2026, docs/PENDIENTES-APPS-SALIDA.md).

describe("P2-42 — el 10 % contado nunca se ve como saldo a favor", () => {
  it("debía y el cobro contado en camino deja el proyectado negativo: se ve $0", () => {
    // URQUIZA: real $250.615,20; cobro $225.500 + 10 % $25.061,52 sin confirmar → proyectado −$25.061,52 (mal)
    expect(saldoVisible(250615.2, -25061.52)).toBe(0)
  })
  it("si todavía debe, se ve lo que debe", () => {
    expect(saldoVisible(100, 90)).toBe(90)
  })
  it("plata a favor de verdad (saldo real negativo) se sigue viendo", () => {
    expect(saldoVisible(-15972.14, -15972.14)).toBe(-15972.14)
  })
  it("sin proyectado, el real", () => {
    expect(saldoVisible(500, null)).toBe(500)
  })
})

describe("P2-13 — cada pedido arranca con el catálogo cerrado", () => {
  it("borra solo lo abierto del catálogo", () => {
    const datos = new Map<string, string>([
      ["gm.vendedor.arbol:home:r", "[\"limpieza\"]"],
      ["gm.vendedor.arbol:filtro:novedades:c", "[\"x\"]"],
      ["gm.vendedor.orden", "precio_asc"],
    ])
    const almacen = {
      get length() { return datos.size },
      key: (i: number) => [...datos.keys()][i] ?? null,
      removeItem: (k: string) => { datos.delete(k) },
    }
    limpiarArbolesCatalogo(almacen)
    expect([...datos.keys()]).toEqual(["gm.vendedor.orden"])
  })
})
