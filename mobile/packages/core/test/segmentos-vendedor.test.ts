import { describe, expect, it } from "vitest"
import {
  faltaListaMetodo,
  mensajeFaltaListaMetodo,
  prepararMotorCliente,
  resolverListaSegmento,
  resolverListaSegmentoDefinido,
  type ArticuloMotor,
  type InsumosCliente,
} from "@gm/pricing"
import { resumirSegmentos } from "../../../apps/vendedor/src/datos/segmentos"
import { resumenBilletera } from "../../../../lib/vendedor/billetera-saldo"
import { deudaCuentaCorriente } from "../../../../lib/cobranzas/billetera-cc"

// Reclamos de Freije en la semana de prueba (09/10/2026).

// Ficha REAL del cliente LIN XUEJUAN (Naciones Unidas 1040, Cipolletti): general Factura y
// sin lista; por segmento limpieza y perfumería 0 en presupuesto, perfumería plus en factura,
// todo Neco. La app mostraba solo lo general ("STD C/IVA") y el vendedor creía "todo factura".
const FICHA_CHINO = {
  lista_precio_id: null, metodo_facturacion: "Factura",
  lista_limpieza_id: "L-neco", metodo_limpieza: "Presupuesto",
  lista_perf0_id: "L-neco", metodo_perf0: "Presupuesto",
  lista_perf_plus_id: "L-neco", metodo_perf_plus: "Factura",
}
const nombres = (id: string) => ({ "L-neco": "Neco" } as Record<string, string>)[id] ?? null

describe("Vendedor · lista y método por segmento a la vista", () => {
  it("la ficha del chino se ve como es: L/B y P0 en presupuesto, P+ en factura, Neco (no 'STD')", () => {
    const r = resumirSegmentos(FICHA_CHINO, {}, nombres)
    expect(r.filas.map((f) => [f.corto, f.listaNombre, f.metodo])).toEqual([
      ["L/B", "Neco", "Presupuesto"],
      ["P0", "Neco", "Presupuesto"],
      ["P+", "Neco", "Factura"],
    ])
    expect(r.uniforme).toBe(false)
    expect(r.incompleto).toBe(false)
  })

  it("'todo factura' para el pedido (override general) gana sobre la ficha por segmento", () => {
    const r = resumirSegmentos(FICHA_CHINO, { metodo_facturacion_pedido: "Factura" }, nombres)
    expect(r.filas.map((f) => f.metodo)).toEqual(["Factura", "Factura", "Factura"])
    expect(r.uniforme).toBe(true)
    expect(r.filas.every((f) => f.delPedido)).toBe(true)
  })

  it("segmento sin lista o sin método = incompleto (no se puede cerrar el pedido)", () => {
    const r = resumirSegmentos({ metodo_facturacion: null, lista_precio_id: null, lista_limpieza_id: "L-neco", metodo_limpieza: "Factura" }, {}, nombres)
    expect(r.incompleto).toBe(true)
    expect(r.filas.find((f) => f.seg === "perf0")).toMatchObject({ listaId: null, metodo: null })
  })
})

describe("Regla del dueño: ningún pedido con lista o método en blanco", () => {
  it("el resolver 'definido' no inventa el método Final; el de siempre lo sigue usando (precio igual)", () => {
    expect(resolverListaSegmentoDefinido("perf0", {}, { lista_precio_id: "L-neco" })).toEqual({ listaId: "L-neco", metodoRaw: null })
    expect(resolverListaSegmento("perf0", {}, { lista_precio_id: "L-neco" })).toEqual({ listaId: "L-neco", metodoRaw: "Final" })
  })

  const LISTA = { id: "L-neco", codigo: "neco", recargo_limpieza_bazar: 20, recargo_perfumeria_negro: 10, recargo_perfumeria_blanco: 15 }
  const art = (id: string, extra: Partial<ArticuloMotor>): ArticuloMotor => ({
    id, precio_compra: 0, precio_base: 1000, categoria: "LIMPIEZA", iva_compras: "factura", iva_ventas: "factura", descuentos: [], proveedor_id: "P1", marca_id: "M1", ...extra,
  })
  const insumos = (cliente: InsumosCliente["cliente"]): InsumosCliente => ({ cliente, listas: [LISTA], reglas: [], condicionesProveedor: [], condicionesMarca: [], bonificaciones: [] })
  const limpieza = art("A1", {})
  const perf0 = art("A2", { categoria: "PERFUMERIA", iva_ventas: "presupuesto" })

  it("el motor marca el renglón sin lista / sin método y faltaListaMetodo junta los segmentos", () => {
    const motor = prepararMotorCliente(insumos({ lista_precio_id: null, metodo_facturacion: null, lista_limpieza_id: "L-neco", metodo_limpieza: "Factura" }))
    const pl = motor.precio(limpieza)
    const pp = motor.precio(perf0)
    expect([pl.sinLista, pl.sinMetodo]).toEqual([false, false])
    expect([pp.sinLista, pp.sinMetodo]).toEqual([true, true])
    const f = faltaListaMetodo([pl, pp])
    expect(f).toEqual({ sinLista: ["perf0"], sinMetodo: ["perf0"] })
    expect(mensajeFaltaListaMetodo(f!)).toContain("sin lista de precios (Perfumería 0)")
    expect(mensajeFaltaListaMetodo(f!)).toContain("sin método de facturación (Perfumería 0)")
  })

  it("con lista y método para el pedido, ya no falta nada", () => {
    const motor = prepararMotorCliente(insumos({ lista_precio_id: null, metodo_facturacion: null }), { lista_precio_pedido_id: "L-neco", metodo_facturacion_pedido: "Presupuesto" })
    expect(faltaListaMetodo([motor.precio(limpieza), motor.precio(perf0)])).toBeNull()
  })
})

describe("Billetera · un solo saldo para el inicio y la pantalla Billetera", () => {
  /** Supabase de mentira: from(tabla).select().in().eq() → { data } (thenable) */
  function supabaseFalso(tablas: Record<string, any[]>) {
    return {
      from(t: string) {
        let filas = [...(tablas[t] || [])]
        const q: any = {
          select: () => q,
          in: (col: string, vals: any[]) => { filas = filas.filter((f) => col in f ? vals.includes(f[col]) : true); return q },
          eq: (col: string, v: any) => { filas = filas.filter((f) => f[col] === v); return q },
          then: (ok: any, err: any) => Promise.resolve({ data: filas, error: null }).then(ok, err),
        }
        return q
      },
    }
  }

  it("caso Freije: rendición devuelta + ajuste manual netean a $0 (el inicio mostraba −$674.500)", async () => {
    const sb = supabaseFalso({
      pagos_clientes: [],
      rendiciones: [],
      billetera_movimientos: [
        { viajante_id: "V1", monto: -674500, referencia_tipo: "rendicion_saldo_declarado" },
        { viajante_id: "V1", monto: 674500, referencia_tipo: "rendicion_devuelta" },
        { viajante_id: "V1", monto: 1000, referencia_tipo: "manual" },
        { viajante_id: "V1", monto: -1000, referencia_tipo: "manual" },
      ],
    })
    const r = await resumenBilletera(sb, ["V1"])
    expect(r.saldo).toBe(0)
    expect(r.deuda_rendiciones).toBe(deudaCuentaCorriente([{ monto: -674500, referencia_tipo: "rendicion_saldo_declarado" }, { monto: 674500, referencia_tipo: "rendicion_devuelta" }]))
  })

  it("efectivo en la calle suma; cheque cuenta papeles; echeq y transferencia van al banco; lo declarado está en viaje", async () => {
    const sb = supabaseFalso({
      pagos_clientes: [
        { id: "p1", vendedor_id: "V1", estado: "pendiente_rendicion", monto: 1500, pagos_detalle: [{ tipo_pago: "efectivo", monto: 1000 }, { tipo_pago: "cheque", monto: 500 }] },
        { id: "p2", vendedor_id: "V1", estado: "pendiente_rendicion", monto: 700, pagos_detalle: [{ tipo_pago: "cheque", monto: 700, color_cheque: "ECHEQ" }] },
        { id: "p3", vendedor_id: "V1", estado: "pendiente_rendicion", monto: 300, forma_pago: "efectivo", pagos_detalle: [] },
        { id: "p4", vendedor_id: "V1", estado: "pendiente_rendicion", monto: 999, pagos_detalle: [{ tipo_pago: "efectivo", monto: 999 }] },
      ],
      rendiciones: [{ id: "r1", cobrador_id: "V1", estado: "abierta" }],
      rendicion_items: [{ rendicion_id: "r1", pago_id: "p4" }],
      billetera_movimientos: [{ viajante_id: "V1", monto: 200, referencia_tipo: "rendicion_diferencia" }],
    })
    const r = await resumenBilletera(sb, ["V1"])
    expect(r.balance).toBe(1300)
    expect(r.saldo).toBe(1500)
    expect(r.cheques_cantidad).toBe(1)
    expect(r.desglose.transferencias).toBe(700)
    expect(r.en_viaje).toEqual({ total: 999, cantidad: 1 })
    expect(r.pagos_sin_rendir).toBe(3)
  })
})

// ─── Ficha por segmento desde la app + revisión de oficina (09/10/2026) ──────
import { patchListasMetodos, validarListasMetodos } from "../../../../lib/vendedor/ficha-listas"
import { esPedidoEditable, ESTADO_LABEL, puedeCambiarEstado } from "../../../../lib/pedidos/estados"
import { readFileSync } from "node:fs"
import { clienteListasDe, fichaListasDe } from "../../../apps/vendedor/src/datos/segmentos"

describe("Ficha · lista y método por segmento desde la app (como el ERP)", () => {
  const sesion = { puedeCambiarLista: true, listasPermitidas: ["L-neco", "L-viaj"] }

  it("acepta lista y método por segmento dentro de lo permitido", () => {
    expect(validarListasMetodos({ lista_perf0_id: "L-viaj", metodo_perf0: "Presupuesto", metodo_facturacion: "" }, sesion)).toBeNull()
    expect(patchListasMetodos({ lista_perf0_id: "L-viaj", metodo_perf0: "Presupuesto", metodo_facturacion: "", nombre: "x" }))
      .toEqual({ lista_perf0_id: "L-viaj", metodo_perf0: "Presupuesto", metodo_facturacion: null })
  })

  it("rechaza listas no habilitadas, sin permiso, y métodos inventados", () => {
    expect(validarListasMetodos({ lista_limpieza_id: "L-bahia" }, sesion)).toMatch(/no está habilitada/)
    expect(validarListasMetodos({ lista_limpieza_id: "L-neco" }, { ...sesion, puedeCambiarLista: false })).toMatch(/permiso/)
    expect(validarListasMetodos({ metodo_perf_plus: "Negro" }, sesion)).toMatch(/inválido/)
  })

  it("la ficha local (alta sin señal) cotiza con sus segmentos, no solo con lo general", () => {
    const f = fichaListasDe({ lista_precio_id: "L-neco", metodo_facturacion: "", metodo_perf0: "Presupuesto", metodo_limpieza: "Factura", metodo_perf_plus: "Factura", extra: 1 })
    const r = resumirSegmentos(clienteListasDe(f), {}, nombres)
    expect(r.filas.map((x) => x.metodo)).toEqual(["Factura", "Presupuesto", "Factura"])
    expect(r.incompleto).toBe(false)
  })
})

describe("Revisión de oficina: estado en_revision", () => {
  it("es editable, depósito NO lo prepara y la oficina lo libera a pendiente", () => {
    expect(ESTADO_LABEL.en_revision).toBe("En Revisión")
    expect(esPedidoEditable("en_revision")).toBe(true)
    // lib/deposito/picking.ts importa cosas del ERP que no corren en los tests: se lee la constante del fuente
    const preparables = /ESTADOS_PREPARABLES = \[([^\]]*)\]/.exec(readFileSync(new URL("../../../../lib/deposito/picking.ts", import.meta.url), "utf8"))![1]!
    expect(preparables).toContain('"pendiente"')
    expect(preparables).not.toContain("en_revision")
    expect(puedeCambiarEstado("en_revision", "pendiente")).toBe(true)
  })
})
