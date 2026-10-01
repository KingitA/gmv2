import type { SupabaseClient } from "@supabase/supabase-js"
import { getSaldosCliente } from "@/lib/cuenta-corriente/saldo"
import { valorarDevoluciones } from "@/lib/cobranzas/valorar-devoluciones"

// Ficha de UN cliente dentro de un viaje de reparto: lo que ve el chofer al bajar
// del camión (pedido con renglones, comprobantes pendientes, devoluciones y cobros
// de este viaje, saldos). Extraído de GET /api/chofer/viaje/[id]/cliente/[clienteId]
// para compartirlo con la réplica de la app Chofer (lib/mobile/sync/chofer.ts): la
// route llama a esta misma función.

export interface ClienteViaje {
  cliente: any
  pedido: {
    id: string
    numero: string
    fecha: string
    estado: string
    total: number
    bultos: number
    observaciones: string | null
    detalle: any[]
  } | null
  comprobantes_pendientes: any[]
  devoluciones: any[]
  pagos_registrados: any[]
  resumen: {
    saldo_anterior: number
    saldo_real: number
    saldo_proyectado: number
    pendiente_verificacion: number
    total_pedido: number
    total_devuelto: number
    total_cobrado: number
    total_a_cobrar: number
    ya_cobrado: boolean
  }
  viaje_estado: string
}

/** `timestamp` sin zona (la base lo guarda en UTC) → ISO con Z: si no, el equipo lo lee como hora local. */
const comoUtc = (s: string | null | undefined) => (s && !/(Z|[+-]\d\d:?\d\d)$/.test(s) ? `${s}Z` : s)

export async function cargarClienteViaje(supabase: SupabaseClient, viajeId: string, clienteId: string, viajeEstado: string): Promise<ClienteViaje> {
  // Pedidos del viaje para este cliente. Pueden ser VARIOS (dos pedidos del mismo cliente en la
  // parada) o ninguno (cliente agregado a un cobro conjunto, o parada "solo cobrar"): antes se leía
  // con maybeSingle() y con dos pedidos la ficha quedaba sin pedido NI nombre del cliente.
  const [{ data: pedidosCli }, { data: cli }] = await Promise.all([
    supabase
      .from("pedidos")
      .select("id, numero_pedido, fecha, estado, total, bultos, observaciones")
      .eq("viaje_id", viajeId)
      .eq("cliente_id", clienteId)
      .neq("estado", "eliminado")
      .order("numero_pedido", { ascending: true }),
    supabase.from("clientes").select("nombre, razon_social, nombre_razon_social, direccion, telefono, cuit, condicion_pago").eq("id", clienteId).maybeSingle(),
  ])
  const pedidos = pedidosCli || []
  const cliente = cli
    ? {
        nombre: cli.nombre || cli.nombre_razon_social || cli.razon_social || null,
        razon_social: cli.razon_social || cli.nombre_razon_social || null,
        direccion: cli.direccion,
        telefono: cli.telefono,
        cuit: cli.cuit,
        condicion_pago: cli.condicion_pago,
      }
    : null

  // Detalle de los pedidos (artículos), con el pedido de cada renglón
  let pedido_detalle: any[] = []
  if (pedidos.length) {
    const { data: detalle } = await supabase
      .from("pedidos_detalle")
      .select(`
        id, pedido_id, cantidad, precio_final, subtotal, es_bonificado,
        articulo_id, articulos(sku, descripcion, unidades_por_bulto)
      `)
      .in("pedido_id", pedidos.map((p) => p.id))
    pedido_detalle = detalle || []
  }
  // La ficha muestra UN "pedido": con varios, se presentan juntos (números unidos, totales sumados)
  const pedido = pedidos.length
    ? {
        id: pedidos[0].id,
        numero_pedido: pedidos.map((p) => p.numero_pedido).join(" + "),
        fecha: pedidos[0].fecha,
        estado: pedidos[0].estado,
        total: pedidos.reduce((s, p) => s + (Number(p.total) || 0), 0),
        bultos: pedidos.reduce((s, p) => s + (Number(p.bultos) || 0), 0),
        observaciones: pedidos.map((p) => p.observaciones).filter(Boolean).join(" · ") || null,
      }
    : null

  // Comprobantes pendientes del cliente (saldo anterior)
  const { data: comprobantes } = await supabase
    .from("comprobantes_venta")
    .select("id, tipo_comprobante, numero_comprobante, fecha, total_factura, saldo_pendiente")
    .eq("cliente_id", clienteId)
    .gt("saldo_pendiente", 0)
    // Un comprobante anulado no se cobra (mismo filtro que vendedor y ERP)
    .is("anulado_en", null)
    .neq("estado_pago", "anulado")
    .order("fecha", { ascending: true })

  // Cobros ya registrados del chofer para este cliente en este viaje
  const { data: pagos_registrados } = await supabase
    .from("pagos_clientes")
    .select("id, monto, estado, created_at")
    .eq("viaje_id", viajeId)
    .eq("cliente_id", clienteId)
    .in("estado", ["pendiente_rendicion", "confirmado"])

  // Devoluciones registradas en este viaje para este cliente
  const { data: devoluciones } = await supabase
    .from("devoluciones")
    .select(`
      id, numero_devolucion, monto_total, estado,
      devoluciones_detalle(
        id, articulo_id, cantidad, precio_venta_original, motivo, es_vendible, condicion,
        articulos(sku, descripcion)
      )
    `)
    .eq("viaje_id", viajeId)
    .eq("cliente_id", clienteId)

  // Doble saldo: real (libro mayor, confirmado) y proyectado (real − pendientes)
  const saldos = await getSaldosCliente(supabase, clienteId)
  const saldo_anterior = saldos.saldo_real

  // Valor de cada devolución EN UN COBRO (regla única valor-devolucion:
  // precio de factura, neto del 10% si la factura fue contado) + lo ya
  // descontado en cobros anteriores (anti doble uso).
  const devIds = (devoluciones || []).map((d: any) => d.id)
  const [valores, { data: descuentosPrevios }] = await Promise.all([
    valorarDevoluciones(supabase, { clienteId, devolucionIds: devIds }),
    devIds.length
      ? supabase.from("devoluciones_descuentos").select("devolucion_id, monto").in("devolucion_id", devIds)
      : Promise.resolve({ data: [] as any[] }),
  ])
  const descontadoDe = new Map<string, number>()
  for (const u of descuentosPrevios || [])
    descontadoDe.set(u.devolucion_id, (descontadoDe.get(u.devolucion_id) || 0) + Number(u.monto))
  const devolucionesValoradas = (devoluciones || []).map((d: any) => {
    const v = valores.get(d.id)
    const valorTotal = v?.total ?? (Number(d.monto_total) || 0)
    const descontado = Math.round((descontadoDe.get(d.id) || 0) * 100) / 100
    return {
      ...d,
      aplica_10: v?.aplica_10 ?? false,
      valor_total: valorTotal,
      valor_descontado: descontado,
      // Lo que se puede descontar en ESTE cobro (coincide con la NC futura)
      valor_cobro: Math.max(0, Math.round((valorTotal - descontado) * 100) / 100),
    }
  })
  const total_devuelto = (devoluciones || []).reduce((s, d) => s + Number(d.monto_total), 0)
  const total_cobrado = (pagos_registrados || []).reduce((s, p) => s + Number(p.monto), 0)

  return {
    cliente,
    pedido: pedido
      ? {
          id: pedido.id,
          numero: pedido.numero_pedido,
          fecha: pedido.fecha,
          estado: pedido.estado,
          total: Number(pedido.total),
          bultos: pedido.bultos,
          observaciones: pedido.observaciones,
          detalle: pedido_detalle,
        }
      : null,
    comprobantes_pendientes: comprobantes || [],
    devoluciones: devolucionesValoradas,
    pagos_registrados: (pagos_registrados || []).map((p) => ({ ...p, created_at: comoUtc(p.created_at) })),
    resumen: {
      saldo_anterior,
      saldo_real: saldos.saldo_real,
      saldo_proyectado: saldos.saldo_proyectado,
      pendiente_verificacion: saldos.pendiente_verificacion,
      total_pedido: Number(pedido?.total) || 0,
      total_devuelto,
      total_cobrado,
      total_a_cobrar: saldo_anterior + (Number(pedido?.total) || 0) - total_devuelto,
      ya_cobrado: total_cobrado > 0,
    },
    viaje_estado: viajeEstado,
  }
}

// ─── Lo que el selector de cobro lee HOY con supabase-js desde el navegador ───
// (components/pagos/ComprobantesSelector.tsx). Misma lógica, misma forma, para que
// la app lo tenga replicado y pueda armar el cobro sin señal.

export interface CuentaCobro {
  /** Débitos cobrables (FA/FB/FC/PRES/ND*), pendientes o parciales, no anulados */
  comprobantes: Array<{ id: string; tipo_comprobante: string; numero_comprobante: string; fecha: string; total_neto: number; total_factura: number; saldo_pendiente: number; estado_pago: string; pedido_id: string | null }>
  /** Pedidos vivos del cliente (para agrupar comprobantes y anticipar los sin facturar) */
  pedidos: Array<{ id: string; numero_pedido: string; fecha: string; total: number; estado: string; pago_contado_10?: boolean | null; anticipo_pago_id?: string | null }>
  /** Pedidos que ya tienen algún comprobante (facturados), tengan o no saldo */
  pedidos_facturados: string[]
  /** Comprobantes que ya tienen la bonificación contado hecha (NC/REV viva) */
  dtos_hechos: string[]
}

export async function cargarCuentaCobro(supabase: SupabaseClient, clienteId: string): Promise<CuentaCobro> {
  const [{ data: comps }, { data: ncs }, { data: peds }, { data: facturados }] = await Promise.all([
    supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, numero_comprobante, fecha, total_neto, total_factura, saldo_pendiente, estado_pago, pedido_id")
      .eq("cliente_id", clienteId)
      .in("estado_pago", ["pendiente", "parcial"])
      .in("tipo_comprobante", ["FA", "FB", "FC", "PRES", "ND", "NDA", "NDB", "NDC"])
      .is("anulado_en", null)
      .order("fecha", { ascending: true }),
    supabase
      .from("comprobantes_venta")
      .select("observaciones")
      .eq("cliente_id", clienteId)
      .in("tipo_comprobante", ["REV", "NCA", "NCB", "NCC"])
      .is("anulado_en", null)
      .neq("estado_pago", "anulado")
      .ilike("observaciones", "%Bonificación contado%"),
    supabase
      .from("pedidos")
      .select("id, numero_pedido, fecha, total, estado, pago_contado_10, anticipo_pago_id")
      .eq("cliente_id", clienteId)
      .neq("estado", "eliminado")
      .order("fecha", { ascending: true }),
    supabase.from("comprobantes_venta").select("pedido_id").eq("cliente_id", clienteId).not("pedido_id", "is", null),
  ])
  const lista = (comps || []).map((c: any) => ({ ...c, total_neto: Number(c.total_neto) || 0, total_factura: Number(c.total_factura) || 0, saldo_pendiente: Number(c.saldo_pendiente) || 0 }))
  const ncsObs = (ncs || []).map((n: any) => String(n.observaciones || ""))
  const dtos = lista.filter((c) => ncsObs.some((o) => o.includes(c.numero_comprobante))).map((c) => c.id)
  return {
    comprobantes: lista,
    pedidos: (peds || []).map((p: any) => ({ ...p, total: Number(p.total) || 0 })),
    pedidos_facturados: [...new Set((facturados || []).map((f: any) => f.pedido_id as string).filter(Boolean))],
    dtos_hechos: dtos,
  }
}
