import { describe, expect, it } from "vitest"
import { chequesRepetidos, claveBanco, mismoCheque, transferenciasRepetidas, filaVacia } from "@gm/cheques"
import { problemaMetodos } from "../../../apps/vendedor/src/datos/cobro-metodos"
import { descontarRetiro, textoFisico, textoVirtual, type BilleteraData } from "../../../apps/vendedor/src/datos/billetera"
import { codigoPrincipal } from "../../../../lib/vendedor/codigo-principal"

// Rendición única, retiro y cheques del vendedor (rendición real de Freije, 27/11/2026).

describe("Cheques repetidos", () => {
  it("el banco se compara normalizado: Patagonia = BANCO PATAGONIA", () => {
    expect(claveBanco("BANCO PATAGONIA S.A.")).toBe("patagonia")
    expect(claveBanco("Patagonia")).toBe("patagonia")
    expect(claveBanco("Bco. de la Nación Argentina")).toBe("nacion")
    expect(mismoCheque({ banco: "Patagonia", numero: "30530452" }, { banco: "BANCO PATAGONIA", numero: "0030530452" })).toBe(true)
    expect(mismoCheque({ banco: "Patagonia", numero: "30530452" }, { banco: "Galicia", numero: "30530452" })).toBe(false)
  })
  it("en el mismo cobro: el segundo igual se marca; bancos distintos se aceptan", () => {
    const filas = [
      { tipo: "cheque", banco: "BANCO PATAGONIA", numero_cheque: "30530452" },
      { tipo: "cheque", banco: "Patagonia", numero_cheque: "30530452" },
      { tipo: "cheque", banco: "Galicia", numero_cheque: "30530452" },
    ]
    expect(chequesRepetidos(filas)).toEqual([1])
    expect(transferenciasRepetidas([
      { tipo: "transferencia", referencia_transferencia: "123 45", cuenta_bancaria_id: "c1" },
      { tipo: "transferencia", referencia_transferencia: "12345", cuenta_bancaria_id: "c1" },
    ])).toEqual([1])
  })
})

describe("Cobro: falta un dato → mensaje corto y el campo en rojo", () => {
  it("Falta monto del cheque", () => {
    const f = { ...filaVacia("a"), banco: "Galicia", numero_cheque: "111", fecha_cheque: "2026-12-10" }
    const p = problemaMetodos([f])!
    expect(p.texto).toBe("Falta monto del cheque 111.")
    expect(p.errores.a).toEqual(["monto"])
    expect(p.idx).toBe(0)
  })
  it("transferencia sin cuenta destino; cheque repetido", () => {
    const t = { ...filaVacia("t", "transferencia"), monto: 5000 }
    expect(problemaMetodos([t])!.texto).toBe("Falta cuenta destino de la transferencia.")
    const c1 = { ...filaVacia("c1"), monto: 750000, banco: "BANCO PATAGONIA", numero_cheque: "30530452", fecha_cheque: "2026-12-10" }
    const c2 = { ...c1, id: "c2", monto: 1, banco: "Patagonia" }
    const p = problemaMetodos([c1, c2])!
    expect(p.texto).toMatch(/ya está cargado/)
    expect(p.errores.c2).toEqual(["banco", "numero_cheque"])
    expect(problemaMetodos([c1])).toBeNull()
  })
})

describe("Físico vs virtual (nunca un total mezclado)", () => {
  it("Efectivo $X · 1 cheque $Y; lo virtual aparte", () => {
    expect(textoFisico(2114893, { cantidad: 1, monto: 750000 })).toBe("Efectivo $2.114.893,00 · 1 cheque $750.000,00")
    expect(textoFisico(1000, { cantidad: 0, monto: 0 })).toBe("Efectivo $1.000,00")
    expect(textoVirtual(50000, { cantidad: 2, monto: 30000 })).toBe("Transferencias $50.000,00 · 2 echeqs $30.000,00")
    expect(textoVirtual(0, null)).toBe("")
  })
})

describe("Retiro: se ve descontado en el momento", () => {
  it("retira 1.114.893 de 2.114.893 → queda 1.000.000 para la oficina", () => {
    const b = { balance: 2114893, retiros_sin_rendir: 0, desglose: { efectivo: 2114893, cheques: 0, transferencias: 0 }, pagos_sin_rendir: 4, en_viaje: { total: 0, cantidad: 0 }, comisiones_pendientes: [], total_pendiente_comisiones: 0, historial: [], cuenta_personal: null } as BilleteraData
    const d = descontarRetiro(b, 1114893)
    expect(d.balance).toBe(1000000)
    expect(d.retiros_sin_rendir).toBe(1114893)
  })
})

describe("Rendición única: un código principal por usuario", () => {
  it("siempre el mismo, sin importar el orden ni cuánto efectivo tenga cada código", () => {
    const freije = ["d7f2ec52-2ded-48f6-8802-5d5802beda22", "65f69dfe-0000-4000-8000-000000000000"]
    expect(codigoPrincipal(freije)).toBe("65f69dfe-0000-4000-8000-000000000000")
    expect(codigoPrincipal([...freije].reverse())).toBe(codigoPrincipal(freije))
  })
})
