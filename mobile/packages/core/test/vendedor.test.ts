import { describe, expect, it } from "vitest"
import type { ItemOutbox } from "../src/db/idb"
import { buscarCatalogo, buscarPorCodigo, crearIndice, filtrarLocal, vistaHabituales, vistaOfertas } from "../../../apps/vendedor/src/datos/busqueda"
import { conArticulo, conCantidad, nuevoBorrador, sinArticulo } from "../../../apps/vendedor/src/datos/borradores"
import { clientesVisibles, cuentaVacia, cuentaVisible, pedidosVisibles, viajesVisibles } from "../../../apps/vendedor/src/datos/overlay"
import type { Articulo, Cliente, CuentaCliente, OpPedido, PedidoVendedor, ViajeVendedor } from "../../../apps/vendedor/src/datasets"

// App Vendedor: reglas PURAS que hacen que lo que ve el viajante sin señal sea fiel a
// lo que va a quedar en el servidor (búsqueda local, carrito, overlay de pendientes).

let seq = 0
const op = (tipo: string, payload: unknown, estado: ItemOutbox["estado"] = "pendiente"): ItemOutbox => ({
  key: `k${++seq}`, seq, tipo, payload, capturadoAt: "2026-09-21T12:00:00Z", estado, intentos: 0, proximoIntentoAt: 0,
  error: estado === "rechazado" ? "El cliente fue dado de baja." : null, resultado: null, enviadoAt: null, usuarioId: "yo", etiqueta: null,
})

const art = (n: number, descripcion: string, extra: Partial<Articulo> = {}): Articulo => ({
  id: `a${n}`, sku: String(1000 + n), ean13: [`779000000000${n}`], descripcion, unidades_por_bulto: 12, stock_disponible: 5, descuento_propio: 0, iva_ventas: "factura",
  marca: null, proveedor: "KENVUE", imagen_url: null, rubro_id: "r1", categoria_id: "c1", subcategoria_id: null, rubro_nombre: "Perfumería", categoria_nombre: "Capilar",
  subcategoria_nombre: null, proveedor_id: "kenvue", marca_id: null, codigo_bulto: null, sigla: null, created_at: `2026-09-${String(n).padStart(2, "0")}T00:00:00Z`, ...extra,
})
const CATALOGO = [
  art(1, "SHAMPOO ORIGINAL x400ml"),
  art(2, "SHAMPOO RULOS 200ml"),
  art(3, "SHAMPOO ANTICASPA x350ml", { proveedor: "ALGABO", proveedor_id: "algabo", descuento_propio: 15 }),
  art(4, "JABÓN LÍQUIDO AVENA x221ml", { proveedor: "ALGABO", proveedor_id: "algabo", categoria_id: "c2", categoria_nombre: "Jabones", descuento_propio: 30 }),
  art(5, "LAVANDINA EN GEL x1LTS", { proveedor: "CLOROX", proveedor_id: "clorox", codigo_bulto: "17790000000055", categoria_id: "c3" }),
]

describe("Vendedor · búsqueda local del catálogo", () => {
  const ix = crearIndice(CATALOGO)

  it("todas las palabras, en cualquier orden, sin acentos", () => {
    expect(buscarCatalogo(ix, "liquido jabon").map((a) => a.id)).toEqual(["a4"])
    expect(buscarCatalogo(ix, "SHAMPOO").map((a) => a.id).sort()).toEqual(["a1", "a2", "a3"])
  })

  it("código: exacto por sku / EAN / código de bulto, y prefijo de sku", () => {
    expect(buscarPorCodigo(ix, "7790000000005").map((a) => a.id)).toEqual(["a5"])
    expect(buscarPorCodigo(ix, "17790000000055").map((a) => a.id)).toEqual(["a5"])
    expect(buscarCatalogo(ix, "1003")[0]?.id).toBe("a3")
    expect(buscarCatalogo(ix, "100").map((a) => a.id)).toEqual(["a1", "a2", "a3", "a4", "a5"]) // prefijo, por sku
  })

  it("tolera un error de tipeo cuando lo exacto no alcanza", () => {
    expect(buscarCatalogo(ix, "lavandna").map((a) => a.id)).toEqual(["a5"])
    expect(buscarCatalogo(ix, "xyzqq")).toEqual([])
  })

  it("PRIORIDAD POR FILTRO ACTIVO: dentro de un proveedor, shampoo no trae el de otro", () => {
    const kenvue = ix.porProveedor.get("kenvue")!
    const dentro = filtrarLocal(kenvue, "shampoo").map((a) => a.id)
    expect(dentro.sort()).toEqual(["a1", "a2"])
    expect(dentro).not.toContain("a3") // el shampoo de Algabo existe en el catálogo, pero no entra
    expect(filtrarLocal(ix.porProveedor.get("algabo")!, "shampoo").map((a) => a.id)).toEqual(["a3"])
  })

  it("vistas que en la web resolvía el servidor: ofertas (mayor descuento primero) y habituales (orden del servidor)", () => {
    expect(vistaOfertas(ix).map((a) => a.id)).toEqual(["a4", "a3"])
    const h = vistaHabituales(ix, [{ articulo_id: "a2", veces_pedido: 9, cantidad_habitual: 24 }, { articulo_id: "inexistente", veces_pedido: 5, cantidad_habitual: 1 }, { articulo_id: "a1", veces_pedido: 3, cantidad_habitual: 6 }])
    expect(h.map((a) => [a.id, a.cantidad_habitual])).toEqual([["a2", 24], ["a1", 6]])
  })
})

describe("Vendedor · carrito (borrador)", () => {
  const linea = (id: string, cantidad: number) => ({ articuloId: id, cantidad, art: { descripcion: id, sku: null, unidades_por_bulto: null, imagen_url: null } })
  it("agregar un artículo que ya está SUMA; la cantidad es absoluta; menos de 1 no se acepta", () => {
    let b = nuevoBorrador("c1", "Cliente")
    b = conArticulo(b, linea("a1", 6))
    b = conArticulo(b, linea("a1", 12))
    b = conArticulo(b, linea("a2", 1))
    expect(b.items.map((i) => [i.articuloId, i.cantidad])).toEqual([["a1", 18], ["a2", 1]])
    expect(conCantidad(b, "a1", 5).items[0]!.cantidad).toBe(5)
    expect(conCantidad(b, "a1", 0)).toBe(b)
    expect(sinArticulo(b, "a1").items.map((i) => i.articuloId)).toEqual(["a2"])
  })
  it("el id local del pedido no cambia entre ediciones (es la clave de idempotencia del servidor)", () => {
    const b = nuevoBorrador("c1", "Cliente")
    expect(conArticulo(b, linea("a1", 1)).localId).toBe(b.localId)
    expect(nuevoBorrador("c1", "Cliente").localId).not.toBe(b.localId)
  })
})

const opPedido = (extra: Partial<OpPedido> = {}): OpPedido => ({
  local_id: "L1", cliente_id: "c1", items: [{ articulo_id: "a1", cantidad: 6, precio: 100 }], cond: null, observaciones: null, precios_al: "2026-09-21T11:59:00Z",
  vista: { cliente_nombre: "Almacén Don José", total: 600 }, ...extra,
})
const filaPedido = (id: string, estado = "pendiente", total = 1000): PedidoVendedor => ({
  id, comprobantes: [], remitos: [], descuentos: { segmentos: [], condiciones: [], solo_este_pedido: false },
  pedido: { id, numero_pedido: "001500", fecha: "2026-09-20", estado, total, observaciones: null, metodo_facturacion_pedido: null, lista_precio_pedido_id: null, bonif_pedido: null, cliente_id: "c1", created_at: "2026-09-20T10:00:00Z", clientes: { id: "c1", nombre: "Almacén Don José", localidad: null, metodo_facturacion: "Factura", lista_precio_id: null }, pedidos_detalle: [] },
})

describe("Vendedor · overlay de pedidos", () => {
  it("un pedido tomado sin señal se ve como pendiente de enviar, arriba, con su total", () => {
    const v = pedidosVisibles([filaPedido("p1")], [op("pedido.crear", opPedido())])
    expect(v.map((p) => [p.id, p.total, p.local?.estado ?? null])).toEqual([["local:L1", 600, "pendiente"], ["p1", 1000, null]])
    expect(v[0]!.numero_pedido).toBeNull() // el número lo da la oficina
  })
  it("una edición pendiente cambia el total mostrado; la ÚLTIMA manda; un rechazo no", () => {
    const e1 = op("pedido.editar", opPedido({ pedido_id: "p1", vista: { cliente_nombre: "x", total: 1200 } }))
    const e2 = op("pedido.editar", opPedido({ pedido_id: "p1", vista: { cliente_nombre: "x", total: 1500 } }))
    expect(pedidosVisibles([filaPedido("p1")], [e1, e2])[0]!.total).toBe(1500)
    const rech = op("pedido.editar", opPedido({ pedido_id: "p1", vista: { cliente_nombre: "x", total: 9 } }), "rechazado")
    const v = pedidosVisibles([filaPedido("p1")], [rech])[0]!
    expect([v.total, v.cambios?.estado]).toEqual([1000, "rechazado"])
  })
  it("un pedido con eliminación pendiente desaparece de la lista", () => {
    expect(pedidosVisibles([filaPedido("p1"), filaPedido("p2")], [op("pedido.eliminar", { pedido_id: "p1" })]).map((p) => p.id)).toEqual(["p2"])
  })
})

const cliente = (id: string, extra: Partial<Cliente> = {}): Cliente => ({
  id, nombre: `Cliente ${id}`, razon_social: null, cuit: null, codigo_cliente: null, direccion: null, localidad: null, localidad_id: null, provincia: null, telefono: null, mail: null,
  condicion_iva: null, condicion_pago: null, condicion_entrega: null, metodo_facturacion: "Factura", vendedor_id: "v1", lista_precio_id: "L-neco", saldo_actual: 1000, saldo_proyectado: 1000,
  pagos_sin_rendir: 0, bonificaciones: { viajante: {}, mercaderia: {} }, ...extra,
})
const cobro = (extra: Record<string, unknown> = {}) => ({
  clientes: [{ cliente_id: "c1", imputaciones: [{ comprobante_id: "f1", monto: 600 }], pedidos: [], pago_a_cuenta: 0, bonificacion_proyectada: 0, creditos: [], ajuste_redondeo: 0, devoluciones: [] }],
  metodos: [{ tipo: "efectivo", monto: 600 }], comprobante_urls: [], observaciones: null, ...extra,
})

describe("Vendedor · overlay de clientes y cuenta corriente", () => {
  it("alta de cliente sin señal: aparece en la cartera marcado sin enviar y ya se le puede levantar pedido", () => {
    const v = clientesVisibles([cliente("c1")], [op("cliente.crear", { id: "nuevo", nombre: "Kiosco Nuevo", metodo_facturacion: "Final", lista_precio_id: "L-neco" })])
    const n = v.find((c) => c.id === "nuevo")!
    expect([n.nombre, n.sinEnviar, n.metodo_facturacion, n.saldo_actual]).toEqual(["Kiosco Nuevo", true, "Final", 0])
  })
  it("edición de ficha y bonificaciones pendientes se ven al instante; un rechazo no", () => {
    const ops = [
      op("cliente.editar", { cliente_id: "c1", cambios: { telefono: { antes: null, despues: "2262-555" }, metodo_facturacion: { antes: "Factura", despues: "Final" } } }),
      op("cliente.bonificaciones", { cliente_id: "c1", viajante: { perf_plus: 5 }, mercaderia: {} }),
      op("cliente.editar", { cliente_id: "c1", cambios: { direccion: { antes: null, despues: "NO" } } }, "rechazado"),
    ]
    const c = clientesVisibles([cliente("c1")], ops)[0]!
    expect([c.telefono, c.metodo_facturacion, c.bonificaciones.viajante.perf_plus, c.direccion]).toEqual(["2262-555", "Final", 5, null])
  })
  it("un cobro sin enviar RESERVA el comprobante (no se puede cobrar dos veces) y baja el saldo proyectado", () => {
    const cc: CuentaCliente = { ...cuentaVacia(cliente("c1")), comprobantes: [{ id: "f1", tipo_comprobante: "FA", numero_comprobante: "1", fecha: "2026-09-01", total_factura: 1000, saldo_pendiente: 1000, estado_pago: "pendiente", pedido_id: null, en_cobro: 0, en_cobro_contado: 0 }] }
    const v = cuentaVisible(cc, [op("cobro.registrar", cobro())])
    expect(v.comprobantes[0]!.en_cobro).toBe(600) // saldo cobrable = 1000 − 600
    expect(v.cliente.saldo_proyectado).toBe(400)
    expect(v.pagos_recientes[0]).toMatchObject({ estado: "sin_enviar", monto: 600, eliminable: false })
    expect(clientesVisibles([cliente("c1")], [op("cobro.registrar", cobro())])[0]).toMatchObject({ saldo_proyectado: 400, pagos_sin_rendir: 1 })
    // Marcado 10% contado: también cuenta como "en cobro contado"
    expect(cuentaVisible(cc, [op("cobro.registrar", cobro({ observaciones: "[10% CONTADO]" }))]).comprobantes[0]!.en_cobro_contado).toBe(600)
  })
  it("una devolución sin enviar ya se puede descontar en el próximo cobro; anular un cobro lo saca de la lista", () => {
    const base = { ...cuentaVacia(cliente("c1")), pagos_recientes: [{ id: "pg1", fecha_pago: "2026-09-20", monto: 100, estado: "pendiente_rendicion", forma_pago: "efectivo", verificado: false, eliminable: true }] }
    const v = cuentaVisible(base, [
      op("devolucion.registrar", { id: "d1", cliente_id: "c1", items: [{ articulo_id: "a1", cantidad: 3, precio_venta_original: 50 }] }),
      op("cobro.anular", { pago_id: "pg1", cliente_id: "c1" }),
    ])
    expect(v.devoluciones_pendientes[0]).toMatchObject({ id: "d1", monto_total: 150, restante: 150 })
    expect(v.pagos_recientes).toEqual([])
  })
})

describe("Vendedor · overlay de viajes", () => {
  const viaje: ViajeVendedor = {
    id: "v1", resumen: { id: "v1", nombre: "Levantamiento", estado: "en_curso", fecha_inicio: "2026-09-21", fecha_fin_estimada: null, zonas: [] },
    clientes: [
      { id: "c1", nombre: "Uno", localidad: null, saldo_actual: 0, estado_viaje: "pendiente", pedido: null },
      { id: "c2", nombre: "Dos", localidad: null, saldo_actual: 0, estado_viaje: "pendiente", pedido: null },
    ],
  }
  it("pedido tomado sin señal = pedido levantado; no va gana aunque haya pedido (igual que el servidor)", () => {
    const v = viajesVisibles([viaje], [op("pedido.crear", opPedido()), op("viaje.cliente_no_va", { viaje_id: "v1", cliente_id: "c2", no_va: true })])[0]!
    expect(v.clientes!.map((c) => c.estado_viaje)).toEqual(["pedido_levantado", "no_va"])
    const v2 = viajesVisibles([viaje], [op("pedido.crear", opPedido()), op("viaje.cliente_no_va", { viaje_id: "v1", cliente_id: "c1", no_va: true })])[0]!
    expect(v2.clientes![0]!.estado_viaje).toBe("no_va")
  })
  it("viaje creado y completado sin señal", () => {
    const v = viajesVisibles([], [op("viaje.crear", { id: "v9", fecha_inicio: "2026-09-21", zona_ids: ["z1"], vista: { nombre: "Levantamiento SUR", zonas: [{ id: "z1", nombre: "SUR" }] } }), op("viaje.estado", { viaje_id: "v9", estado: "completado" })])
    expect(v[0]).toMatchObject({ id: "v9", sinEnviar: true, resumen: { nombre: "Levantamiento SUR", estado: "completado" } })
  })
})
