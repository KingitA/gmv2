import { describe, expect, it } from "vitest"
import { devolucionDescuentaEnCobro, origenDeRenglon, vaContra, type OrigenDevolucionCobro } from "@gm/vendedor"
import { altoReferencia } from "../src/ui/teclado"
import { clientesVisibles } from "../../../apps/vendedor/src/datos/overlay"

// App Vendedor — tanda P2b (30/10/2026).

const pres = (id: string, numero: string, ata = true): OrigenDevolucionCobro => ({ comprobante_venta_id: id, comprobante: `PRES ${numero}`, ata })

describe("P2-29 — la devolución descuenta solo de su comprobante", () => {
  it("CHEN: la devolución del PRES 0028 no descuenta si se cobra solo el 0026", () => {
    const origenes = [pres("p28", "0001-00000028")]
    expect(devolucionDescuentaEnCobro(origenes, { p26: 36513.45 })).toEqual({ descuenta: false, faltan: ["PRES 0001-00000028"] })
    expect(devolucionDescuentaEnCobro(origenes, { p26: 36513.45, p28: 1000 }).descuenta).toBe(true)
    expect(vaContra(origenes)).toBe("Va contra PRES 0001-00000028")
  })
  it("lo ya pagado, el respaldo, sin origen o rechazado no frenan", () => {
    expect(devolucionDescuentaEnCobro([pres("p27", "0001-00000027", false)], {}).descuenta).toBe(true)
    expect(devolucionDescuentaEnCobro([], {}).descuenta).toBe(true)
    expect(devolucionDescuentaEnCobro(undefined, {}).descuenta).toBe(true) // ficha vieja: como antes
    expect(vaContra([pres("p27", "0001-00000027", false)])).toBeNull()
  })
  it("arma el origen del renglón igual que el servidor", () => {
    const R = "0002-00000001"
    expect(origenDeRenglon({ comprobante_venta_id: "a", comprobante: { tipo_comprobante: "PRES", numero_comprobante: "0001-00000028", saldo_pendiente: 500 } }, R)).toEqual({ comprobante_venta_id: "a", comprobante: "PRES 0001-00000028", ata: true })
    expect(origenDeRenglon({ comprobante_venta_id: "a", comprobante: { tipo_comprobante: "PRES", numero_comprobante: "0001-00000028", saldo_pendiente: 0 } }, R)?.ata).toBe(false)
    expect(origenDeRenglon({ comprobante_venta_id: "b", comprobante: { tipo_comprobante: "PRES", numero_comprobante: R, saldo_pendiente: 0 } }, R)?.ata).toBe(false)
    expect(origenDeRenglon({ comprobante_venta_id: "c", comprobante: { tipo_comprobante: "FA", numero_comprobante: "0007-1", saldo_pendiente: 10, anulado_en: "2026-10-30" } }, R)?.ata).toBe(false)
    expect(origenDeRenglon({ comprobante_venta_id: null }, R)).toBeNull()
    expect(origenDeRenglon({ comprobante_venta_id: "d", estado_renglon: "rechazado" }, R)).toBeNull()
  })
})

describe("P2-10 — el cliente dado de alta sin señal se ve como lo guarda el servidor", () => {
  it("sin espacios de más y en mayúsculas", () => {
    const ops = [{ tipo: "cliente.crear", estado: "pendiente", payload: { id: "c-nuevo", nombre: "  almacén   don josé " } }] as never
    expect(clientesVisibles([], ops)[0]!.nombre).toBe("ALMACÉN DON JOSÉ")
  })
})

describe("Core — teclado ya abierto al arrancar la app", () => {
  it("el alto de referencia es el de la pantalla aunque lo visible arranque chico", () => {
    expect(altoReferencia(420, 420, 800)).toBe(800)
    expect(altoReferencia(760, 760, undefined)).toBe(760)
  })
})
