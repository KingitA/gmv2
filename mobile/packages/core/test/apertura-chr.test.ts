import { describe, expect, it } from "vitest"
import { agruparPorCliente, leerReporteImpagos, numeroPresSistemaViejo } from "../../../../lib/apertura/parsear-chr"

// Reglas del dueño del 26/10 (prueba integral de salida): saldo bueno = columna
// 31 (#8), texto libre = ajuste (#6), PRES viejos al punto de venta 2 (#18).

/** Arma un renglón del reporte .chr con lo que importa en cada columna */
function renglon(o: { cli: string; nombre: string; numero: string; desc: string; fecha: string; importe: number; pendiente: number; s30: number; s31: number }) {
  const c: string[] = Array.from({ length: 34 }, () => "")
  c[6] = "23/10/2026"
  c[11] = "Viajante: 00022 - FREIJE DANIEL"
  c[20] = o.cli
  c[21] = o.nombre
  c[22] = "20-12345678-6"
  c[24] = o.numero
  c[25] = `${o.desc} 30`
  c[26] = o.fecha
  c[27] = o.fecha
  c[28] = String(o.importe)
  c[29] = String(o.pendiente)
  c[30] = String(o.s30)
  c[31] = String(o.s31)
  return c.map((v) => `"${v}"`).join(",")
}

describe("lector del reporte de impagos (apertura)", () => {
  const texto = [
    renglon({ cli: "00169", nombre: "DELLI GUSTAVO", numero: "0001-00117929", desc: "Presupuesto", fecha: "01/09/2026", importe: 2000000, pendiente: 2000000, s30: 2923875.09, s31: 2804921.57 }),
    renglon({ cli: "00169", nombre: "DELLI GUSTAVO", numero: "0002-00047800", desc: "Fact.A Electronica", fecha: "05/09/2026", importe: 900000, pendiente: 900000, s30: 2923875.09, s31: 2804921.57 }),
    renglon({ cli: "00169", nombre: "DELLI GUSTAVO", numero: "0000-23122024", desc: "CHEQUE RECH (YASH)", fecha: "23/12/2024", importe: 4921.57, pendiente: 4921.57, s30: 2923875.09, s31: 2804921.57 }),
    renglon({ cli: "00169", nombre: "DELLI GUSTAVO", numero: "0000-01102025", desc: "10%", fecha: "01/10/2025", importe: -100000, pendiente: -100000, s30: 2923875.09, s31: 2804921.57 }),
  ].join("\r\n")

  const r = leerReporteImpagos(texto)

  it("el texto libre no es error: entra como AJUSTE con su signo", () => {
    expect(r.errores).toEqual([])
    const aj = r.renglones.filter((x) => x.tipo === "AJUSTE")
    expect(aj.map((x) => [x.descripcion, x.pendiente])).toEqual([["CHEQUE RECH (YASH)", 4921.57], ["10%", -100000]])
  })

  it("el PRES viejo pasa al punto de venta 2 y guarda el número original", () => {
    const pres = r.renglones.find((x) => x.tipo === "PRES")!
    expect(pres.numero).toBe("0002-00117929")
    expect(pres.numero_original).toBe("0001-00117929")
    // Las facturas quedan como vinieron
    expect(r.renglones.find((x) => x.tipo === "FA")!.numero).toBe("0002-00047800")
    expect(numeroPresSistemaViejo("0001-00000005")).toBe("0002-00000005")
  })

  it("controla contra la columna 31 (DELLI 169 debe 2.804.921,57, no 2.923.875,09)", () => {
    const [g] = agruparPorCliente(r.renglones)
    expect(g.codigo_cliente).toBe("169")
    expect(g.saldo_reporte).toBe(2804921.57)
    expect(g.suma).toBe(2804921.57)
    expect(g.cuadra).toBe(true)
  })
})
