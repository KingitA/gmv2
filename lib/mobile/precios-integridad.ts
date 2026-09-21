// Re-verificación de precios de un pedido capturado offline.
//
// Regla de negocio (dueño): el pedido se factura a los precios vigentes al
// momento de su CAPTURA (timestamp del dispositivo). Al sincronizar, el servidor
// reconstruye los insumos vigentes a esa hora (historial + programados), corre
// el MISMO motor (lib/pricing/motor.ts) y compara con lo que vio el vendedor.
// Deben coincidir. Si no, es un bug o un dato corrupto: se registra una alerta
// de integridad para el administrador (mobile_alertas_integridad) y se factura
// con el precio del servidor (el dispositivo nunca dicta precios). Al vendedor
// NO se le muestra ninguna "corrección".
//
// La usa el handler de outbox "pedido.crear" (sesión de la app vendedor).

import {
  prepararMotorCliente,
  aplicarProgramados,
  reconstruirAFecha,
  type CambioProgramado,
  type InsumosCliente,
  type OverridesPedido,
  type PrecioArticuloCliente,
  type VersionHistorial,
} from "@/lib/pricing/isomorfico"
import {
  ARTICULO_PRECIO_COLS,
  CLIENTE_LISTAS_COLS,
  CONDICION_MARCA_COLS,
  CONDICION_PROVEEDOR_COLS,
  LISTA_PRECIO_COLS,
} from "@/lib/pricing/cargar-insumos"

/** Tolerancia de comparación (redondeo a centavos en ambos lados ⇒ debería ser 0). */
const TOLERANCIA = 0.005

async function historialDesde(admin: any, tabla: string, refs: string[] | null, fecha: string): Promise<VersionHistorial<any>[]> {
  let q = admin
    .from("precio_insumos_historial")
    .select("tabla, registro_id, datos, vigente_desde, vigente_hasta")
    .eq("tabla", tabla)
    .or(`vigente_hasta.is.null,vigente_hasta.gt.${fecha}`)
  if (refs) q = q.in("ref_id", refs)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

async function programadosHasta(admin: any, fecha: string): Promise<CambioProgramado[]> {
  const { data, error } = await admin
    .from("precios_programados")
    .select("id, tabla, registro_id, cambios, vigencia_desde, estado")
    .eq("estado", "pendiente")
    .lte("vigencia_desde", fecha)
  if (error) throw error
  return data || []
}

/** Insumos de un cliente + artículos tal como estaban vigentes en `fecha`. */
export async function insumosAFecha(admin: any, clienteId: string, articuloIds: string[], fecha: string) {
  const [cliRes, listasRes, reglasRes, cpRes, cmRes, boRes, artRes, descRes] = await Promise.all([
    admin.from("clientes").select(CLIENTE_LISTAS_COLS).eq("id", clienteId),
    admin.from("listas_precio").select(LISTA_PRECIO_COLS),
    admin.from("listas_precio_reglas").select("id,grupo_precio,iva_compras,iva_ventas,formulas"),
    admin.from("cliente_proveedor_condicion").select(`id,${CONDICION_PROVEEDOR_COLS}`).eq("cliente_id", clienteId),
    admin.from("cliente_marca_condicion").select(`id,${CONDICION_MARCA_COLS}`).eq("cliente_id", clienteId),
    admin.from("bonificaciones").select("id,tipo,segmento,porcentaje,activo").eq("cliente_id", clienteId),
    admin.from("articulos").select(ARTICULO_PRECIO_COLS).in("id", articuloIds),
    admin.from("articulos_descuentos").select("id,articulo_id,tipo,porcentaje,orden").in("articulo_id", articuloIds),
  ])
  for (const r of [cliRes, listasRes, reglasRes, cpRes, cmRes, boRes, artRes, descRes]) if (r.error) throw r.error

  const [hCli, hListas, hReglas, hCp, hCm, hBo, hArt, hDesc, programados] = await Promise.all([
    historialDesde(admin, "clientes", [clienteId], fecha),
    historialDesde(admin, "listas_precio", null, fecha),
    historialDesde(admin, "listas_precio_reglas", null, fecha),
    historialDesde(admin, "cliente_proveedor_condicion", [clienteId], fecha),
    historialDesde(admin, "cliente_marca_condicion", [clienteId], fecha),
    historialDesde(admin, "bonificaciones", [clienteId], fecha),
    historialDesde(admin, "articulos", articuloIds, fecha),
    historialDesde(admin, "articulos_descuentos", articuloIds, fecha),
    programadosHasta(admin, fecha),
  ])

  const at = <T extends { id: string }>(tabla: string, actuales: T[], hist: VersionHistorial<any>[]) =>
    aplicarProgramados(reconstruirAFecha(actuales, hist, fecha), programados, tabla, fecha)

  const cliente = at("clientes", cliRes.data, hCli)[0]
  if (!cliente) throw new Error("Cliente inexistente a la fecha de captura")

  const insumos: InsumosCliente = {
    cliente,
    listas: at("listas_precio", listasRes.data, hListas),
    reglas: at("listas_precio_reglas", reglasRes.data, hReglas),
    condicionesProveedor: at("cliente_proveedor_condicion", cpRes.data, hCp),
    condicionesMarca: at("cliente_marca_condicion", cmRes.data, hCm),
    bonificaciones: at("bonificaciones", boRes.data, hBo).filter(
      (b: any) => b.activo !== false && (b.tipo === "general" || b.tipo === "viajante"),
    ),
  }
  const descuentos = at("articulos_descuentos", descRes.data, hDesc)
  const articulos = at("articulos", artRes.data, hArt).map((a: any) => ({
    ...a,
    descuentos: descuentos
      .filter((d: any) => d.articulo_id === a.id)
      .sort((x: any, y: any) => x.orden - y.orden)
      .map((d: any) => ({ tipo: d.tipo, porcentaje: d.porcentaje, orden: d.orden })),
  }))
  return { insumos, articulos }
}

export interface ItemCapturado {
  articulo_id: string
  /** Precio unitario que mostró el dispositivo (precioAlCliente) */
  precio: number
}

export interface Verificacion {
  ok: boolean
  /** Precio del servidor por artículo (el que se factura) */
  precios: Map<string, PrecioArticuloCliente>
  diferencias: Array<{ articulo_id: string; dispositivo: number; servidor: number | null }>
}

export async function verificarPreciosCapturados(
  admin: any,
  args: {
    clienteId: string
    capturadoAt: string
    overrides: OverridesPedido
    items: ItemCapturado[]
    contexto: { usuarioId: string; deviceId: string | null; idempotencyKey: string; tipo: string }
    /** Insumos ya reconstruidos a `capturadoAt` (el handler los reusa para crear el pedido) */
    precargado?: Awaited<ReturnType<typeof insumosAFecha>>
  },
): Promise<Verificacion> {
  const ids = [...new Set(args.items.map((i) => i.articulo_id))]
  const { insumos, articulos } = args.precargado ?? (await insumosAFecha(admin, args.clienteId, ids, args.capturadoAt))
  const motor = prepararMotorCliente(insumos, args.overrides)
  const porId = new Map(articulos.map((a: any) => [a.id, a]))

  const precios = new Map<string, PrecioArticuloCliente>()
  const diferencias: Verificacion["diferencias"] = []
  for (const it of args.items) {
    const art = porId.get(it.articulo_id)
    const p = art ? motor.precio(art) : null
    if (p) precios.set(it.articulo_id, p)
    if (!p || Math.abs(p.precio - it.precio) > TOLERANCIA) {
      diferencias.push({ articulo_id: it.articulo_id, dispositivo: it.precio, servidor: p?.precio ?? null })
    }
  }

  if (diferencias.length) {
    // Nunca bloquea la operación: la alerta es para el administrador.
    await admin
      .from("mobile_alertas_integridad")
      .insert({
        tipo: "precio_distinto",
        operacion: args.contexto.tipo,
        idempotency_key: args.contexto.idempotencyKey,
        usuario_id: args.contexto.usuarioId,
        device_id: args.contexto.deviceId,
        cliente_id: args.clienteId,
        capturado_at: args.capturadoAt,
        detalle: { diferencias, overrides: args.overrides },
      })
      .then(() => {}, () => {})
  }
  return { ok: diferencias.length === 0, precios, diferencias }
}
