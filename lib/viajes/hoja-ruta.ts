import type { SupabaseClient } from "@supabase/supabase-js"
import { getSaldosClientes } from "@/lib/cuenta-corriente/saldo"

/**
 * HOJA DE RUTA — vista calculada de un viaje. Única función para la pantalla
 * del ERP, el PDF y la app del chofer: no hay importes guardados, todo sale de
 * pedidos / comprobantes / remitos / libro de cuenta corriente / billetera.
 * Lo único persistido es viajes_paradas (orden, instrucción de oficina y
 * resultado de la entrega).
 */

export interface PedidoHoja {
  id: string
  numero: string
  estado: string
  total: number
  bultos: number
  vendedor: string
  comprobantes: Array<{ id: string; tipo: string; numero: string; total: number; saldo: number }>
  remitos: Array<{ id: string; tipo_remito: string; numero_remito: string; estado_pdf: string }>
}

export interface ParadaHoja {
  id: string
  orden: number
  cliente_id: string
  cliente_nombre: string
  direccion: string
  localidad: string
  telefono: string
  vendedores: string[]
  // instrucción de oficina
  exigir_cobro_anterior: boolean
  exigir_cobro_actual: boolean
  bloquear_entrega: boolean
  motivo_bloqueo: string | null
  nota_oficina: string | null
  // resultado
  estado: string
  bultos_entregados: number | null
  motivo_no_entrega: string | null
  motivo_no_cobro: string | null
  resuelto_at: string | null
  // calculado
  pedidos: PedidoHoja[]
  bultos: number
  total_viaje: number      // Σ pedidos de este viaje
  saldo_anterior: number   // saldo real del cliente SIN lo de este viaje
  total_a_cobrar: number   // saldo_anterior + total_viaje
  minimo_exigido: number   // lo que oficina marcó como "cobrar sí o sí"
  cobrado: number
  devuelto: number
  cobro_cumplido: boolean  // cobrado >= minimo_exigido
}

export interface HojaRuta {
  viaje: {
    id: string
    nombre: string
    fecha: string
    estado: string
    tipo_transporte: string | null
    observaciones: string | null
    zonas: string[]
    vehiculo: string
    transporte: string
    titular_id: string | null
    choferes: Array<{ usuario_id: string; nombre: string; rol: string }>
    despachado_at: string | null
    presupuesto: { nafta: number; peon: number; hotel: number; otros: number; total: number }
  }
  paradas: ParadaHoja[]
  totales: {
    paradas: number
    pedidos: number
    bultos: number
    total_viaje: number
    saldo_anterior: number
    total_a_cobrar: number
    minimo_exigido: number
    cobrado: number
    resueltas: number
    pedidos_sin_facturar: number
    pedidos_sin_remito: number
  }
  dinero: {
    fondo_entregado: number
    fondos: Array<{ id: string; monto: number; origen: string; retirado_por: string; entregado_por: string; fecha: string }>
    gastos: Array<{ id: string; categoria: string; monto: number; observaciones: string | null; estado: string; cargado_por: string; foto_url: string | null; fecha: string }>
    gastos_total: number          // declarados + aprobados (los rechazados no cuentan)
    cobrado_efectivo: number
    cobrado_cheques: number
    cobrado_transferencias: number
    efectivo_en_mano: number      // fondo + cobrado_efectivo − gastos
    saldo_billetera_titular: number
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const PEDIDO_FACTURADO = ["facturado", "listo_para_enviar", "listo_para_retirar", "en_viaje", "entregado"]

export async function armarHojaRuta(supabase: SupabaseClient, viajeId: string): Promise<HojaRuta | null> {
  const { data: v } = await supabase
    .from("viajes")
    .select(`
      id, nombre, fecha, estado, tipo_transporte, observaciones, chofer_id, despachado_at,
      dinero_nafta, gastos_peon, gastos_hotel, gastos_adicionales,
      vehiculos(nombre, patente), transportes(nombre),
      viaje_zonas(zonas(nombre)),
      viajes_choferes(usuario_id, rol)
    `)
    .eq("id", viajeId)
    .single()
  if (!v) return null
  const viaje = v as any

  const [{ data: paradasRaw }, { data: pedidosRaw }, { data: pagos }, { data: devoluciones }, { data: fondos }, { data: gastos }] =
    await Promise.all([
      supabase.from("viajes_paradas").select("*").eq("viaje_id", viajeId).order("orden", { ascending: true }),
      supabase
        .from("pedidos")
        .select("id, numero_pedido, estado, total, bultos, cliente_id, vendedores(nombre)")
        .eq("viaje_id", viajeId)
        .neq("estado", "eliminado")
        .order("numero_pedido", { ascending: true }),
      supabase
        .from("pagos_clientes")
        .select("id, cliente_id, monto, estado, pagos_detalle(tipo_pago, monto)")
        .eq("viaje_id", viajeId)
        .in("estado", ["pendiente_rendicion", "confirmado"]),
      supabase.from("devoluciones").select("cliente_id, monto_total").eq("viaje_id", viajeId),
      supabase.from("viajes_fondos").select("*").eq("viaje_id", viajeId).order("created_at", { ascending: true }),
      supabase.from("viajes_gastos").select("*").eq("viaje_id", viajeId).order("created_at", { ascending: true }),
    ])

  const paradas = (paradasRaw || []) as any[]
  const pedidos = (pedidosRaw || []) as any[]
  const pedidoIds = pedidos.map((p) => p.id)
  const clienteIds = [...new Set([...paradas.map((p) => p.cliente_id), ...pedidos.map((p) => p.cliente_id)])] as string[]

  const usuarioIds = [
    ...new Set([
      ...(viaje.viajes_choferes || []).map((c: any) => c.usuario_id),
      ...(fondos || []).flatMap((f: any) => [f.retirado_por, f.entregado_por]),
      ...(gastos || []).map((g: any) => g.cargado_por),
    ]),
  ].filter(Boolean) as string[]

  const [{ data: clientes }, { data: comprobantes }, { data: remitos }, { data: usuarios }, saldos, { data: cajas }, { data: bancos }, { data: saldoBill }] =
    await Promise.all([
      clienteIds.length
        ? supabase
            .from("clientes")
            .select("id, nombre, razon_social, nombre_razon_social, direccion, telefono, localidades(nombre)")
            .in("id", clienteIds)
        : Promise.resolve({ data: [] as any[] }),
      pedidoIds.length
        ? supabase
            .from("comprobantes_venta")
            .select("id, pedido_id, tipo_comprobante, punto_venta, numero_comprobante, total_factura, saldo_pendiente")
            .in("pedido_id", pedidoIds)
            .is("anulado_en", null)
            .neq("estado_pago", "anulado")
        : Promise.resolve({ data: [] as any[] }),
      pedidoIds.length
        ? supabase
            .from("remitos")
            .select("id, pedido_id, tipo_remito, numero_remito, estado_pdf")
            .in("pedido_id", pedidoIds)
            .eq("estado", "activo")
        : Promise.resolve({ data: [] as any[] }),
      usuarioIds.length
        ? supabase.from("usuarios").select("id, nombre").in("id", usuarioIds)
        : Promise.resolve({ data: [] as any[] }),
      getSaldosClientes(supabase, clienteIds),
      supabase.from("cajas_financieras").select("id, nombre"),
      supabase.from("cuentas_bancarias").select("id, nombre"),
      viaje.chofer_id
        ? supabase
            .from("saldos_financieros")
            .select("saldo")
            .eq("cuenta_tipo", "BILLETERA")
            .eq("cuenta_id", viaje.chofer_id)
        : Promise.resolve({ data: [] as any[] }),
    ])

  const nombreUsuario = new Map((usuarios || []).map((u: any) => [u.id, u.nombre as string]))
  const nombreCuenta = new Map<string, string>([
    ...(cajas || []).map((c: any) => [`CAJA:${c.id}`, c.nombre] as [string, string]),
    ...(bancos || []).map((b: any) => [`BANCO:${b.id}`, b.nombre] as [string, string]),
  ])
  const clienteMap = new Map((clientes || []).map((c: any) => [c.id, c]))

  const compsPorPedido = new Map<string, any[]>()
  for (const c of comprobantes || []) {
    if (!compsPorPedido.has(c.pedido_id)) compsPorPedido.set(c.pedido_id, [])
    compsPorPedido.get(c.pedido_id)!.push(c)
  }
  const remitosPorPedido = new Map<string, any[]>()
  for (const r of remitos || []) {
    if (!remitosPorPedido.has(r.pedido_id)) remitosPorPedido.set(r.pedido_id, [])
    remitosPorPedido.get(r.pedido_id)!.push(r)
  }
  const cobradoPorCliente = new Map<string, number>()
  for (const p of pagos || []) cobradoPorCliente.set(p.cliente_id, (cobradoPorCliente.get(p.cliente_id) || 0) + Number(p.monto))
  const devueltoPorCliente = new Map<string, number>()
  for (const d of devoluciones || [])
    devueltoPorCliente.set(d.cliente_id, (devueltoPorCliente.get(d.cliente_id) || 0) + Number(d.monto_total))

  const paradasHoja: ParadaHoja[] = paradas.map((pa) => {
    const c: any = clienteMap.get(pa.cliente_id) || {}
    const peds = pedidos.filter((p) => p.cliente_id === pa.cliente_id)
    const pedidosHoja: PedidoHoja[] = peds.map((p) => ({
      id: p.id,
      numero: p.numero_pedido,
      estado: p.estado,
      total: Number(p.total) || 0,
      bultos: p.bultos || 0,
      vendedor: p.vendedores?.nombre || "",
      comprobantes: (compsPorPedido.get(p.id) || []).map((x) => ({
        id: x.id,
        tipo: x.tipo_comprobante,
        numero: `${x.punto_venta || ""}${x.punto_venta ? "-" : ""}${x.numero_comprobante || ""}`,
        total: Number(x.total_factura) || 0,
        saldo: Number(x.saldo_pendiente) || 0,
      })),
      remitos: (remitosPorPedido.get(p.id) || []).map((x) => ({
        id: x.id, tipo_remito: x.tipo_remito, numero_remito: x.numero_remito, estado_pdf: x.estado_pdf,
      })),
    }))

    // Lo de ESTE viaje: si el pedido ya está facturado manda el comprobante
    // (incluye percepciones); si no, el total del pedido.
    const totalViaje = r2(
      pedidosHoja.reduce((s, p) => s + (p.comprobantes.length ? p.comprobantes.reduce((x, k) => x + k.total, 0) : p.total), 0),
    )
    // Lo de este viaje que YA pesa en el libro (saldo de sus comprobantes)
    const propioEnLibro = pedidosHoja.reduce((s, p) => s + p.comprobantes.reduce((x, k) => x + k.saldo, 0), 0)
    const saldoReal = saldos.get(pa.cliente_id)?.saldo_real ?? 0
    const saldoAnterior = r2(saldoReal - propioEnLibro)

    const cobrado = r2(cobradoPorCliente.get(pa.cliente_id) || 0)
    const minimo = r2(
      (pa.exigir_cobro_anterior ? Math.max(saldoAnterior, 0) : 0) + (pa.exigir_cobro_actual ? totalViaje : 0),
    )

    return {
      id: pa.id,
      orden: pa.orden,
      cliente_id: pa.cliente_id,
      cliente_nombre: c.nombre_razon_social || c.razon_social || c.nombre || "Sin nombre",
      direccion: c.direccion || "",
      localidad: c.localidades?.nombre || "",
      telefono: c.telefono || "",
      vendedores: [...new Set(pedidosHoja.map((p) => p.vendedor).filter(Boolean))],
      exigir_cobro_anterior: pa.exigir_cobro_anterior,
      exigir_cobro_actual: pa.exigir_cobro_actual,
      bloquear_entrega: pa.bloquear_entrega,
      motivo_bloqueo: pa.motivo_bloqueo,
      nota_oficina: pa.nota_oficina,
      estado: pa.estado,
      bultos_entregados: pa.bultos_entregados,
      motivo_no_entrega: pa.motivo_no_entrega,
      motivo_no_cobro: pa.motivo_no_cobro,
      resuelto_at: pa.resuelto_at,
      pedidos: pedidosHoja,
      bultos: pedidosHoja.reduce((s, p) => s + p.bultos, 0),
      total_viaje: totalViaje,
      saldo_anterior: saldoAnterior,
      total_a_cobrar: r2(saldoAnterior + totalViaje),
      minimo_exigido: minimo,
      cobrado,
      devuelto: r2(devueltoPorCliente.get(pa.cliente_id) || 0),
      cobro_cumplido: cobrado + 0.01 >= minimo,
    }
  })

  const detalles = (pagos || []).flatMap((p: any) => p.pagos_detalle || [])
  const sumaTipo = (tipos: string[]) =>
    r2(detalles.filter((d: any) => tipos.includes(d.tipo_pago)).reduce((s: number, d: any) => s + Number(d.monto), 0))
  const fondoEntregado = r2((fondos || []).reduce((s: number, f: any) => s + Number(f.monto), 0))
  const gastosVigentes = (gastos || []).filter((g: any) => g.estado !== "rechazado")
  const gastosTotal = r2(gastosVigentes.reduce((s: number, g: any) => s + Number(g.monto), 0))
  const cobradoEfectivo = sumaTipo(["efectivo"])

  const presupuesto = {
    nafta: Number(viaje.dinero_nafta) || 0,
    peon: Number(viaje.gastos_peon) || 0,
    hotel: Number(viaje.gastos_hotel) || 0,
    otros: Number(viaje.gastos_adicionales) || 0,
    total: 0,
  }
  presupuesto.total = r2(presupuesto.nafta + presupuesto.peon + presupuesto.hotel + presupuesto.otros)

  const todosPedidos = paradasHoja.flatMap((p) => p.pedidos)

  return {
    viaje: {
      id: viaje.id,
      nombre: viaje.nombre,
      fecha: viaje.fecha,
      estado: viaje.estado,
      tipo_transporte: viaje.tipo_transporte,
      observaciones: viaje.observaciones,
      zonas: (viaje.viaje_zonas || []).map((z: any) => z.zonas?.nombre).filter(Boolean),
      vehiculo: viaje.vehiculos ? [viaje.vehiculos.nombre, viaje.vehiculos.patente].filter(Boolean).join(" · ") : "",
      transporte: viaje.transportes?.nombre || "",
      titular_id: viaje.chofer_id,
      choferes: (viaje.viajes_choferes || [])
        .map((c: any) => ({ usuario_id: c.usuario_id, rol: c.rol, nombre: nombreUsuario.get(c.usuario_id) || "" }))
        .sort((a: any, b: any) => (a.rol === "titular" ? -1 : b.rol === "titular" ? 1 : 0)),
      despachado_at: viaje.despachado_at,
      presupuesto,
    },
    paradas: paradasHoja,
    totales: {
      paradas: paradasHoja.length,
      pedidos: todosPedidos.length,
      bultos: paradasHoja.reduce((s, p) => s + p.bultos, 0),
      total_viaje: r2(paradasHoja.reduce((s, p) => s + p.total_viaje, 0)),
      saldo_anterior: r2(paradasHoja.reduce((s, p) => s + p.saldo_anterior, 0)),
      total_a_cobrar: r2(paradasHoja.reduce((s, p) => s + p.total_a_cobrar, 0)),
      minimo_exigido: r2(paradasHoja.reduce((s, p) => s + p.minimo_exigido, 0)),
      cobrado: r2(paradasHoja.reduce((s, p) => s + p.cobrado, 0)),
      resueltas: paradasHoja.filter((p) => p.estado !== "pendiente").length,
      pedidos_sin_facturar: todosPedidos.filter((p) => !PEDIDO_FACTURADO.includes(p.estado)).length,
      pedidos_sin_remito: todosPedidos.filter((p) => p.remitos.length === 0).length,
    },
    dinero: {
      fondo_entregado: fondoEntregado,
      fondos: (fondos || []).map((f: any) => ({
        id: f.id,
        monto: Number(f.monto),
        origen: nombreCuenta.get(`${f.origen_tipo}:${f.origen_id}`) || f.origen_tipo,
        retirado_por: nombreUsuario.get(f.retirado_por) || "",
        entregado_por: nombreUsuario.get(f.entregado_por) || "",
        fecha: f.created_at,
      })),
      gastos: (gastos || []).map((g: any) => ({
        id: g.id,
        categoria: g.categoria,
        monto: Number(g.monto),
        observaciones: g.observaciones,
        estado: g.estado,
        cargado_por: nombreUsuario.get(g.cargado_por) || "",
        foto_url: g.foto_url,
        fecha: g.created_at,
      })),
      gastos_total: gastosTotal,
      cobrado_efectivo: cobradoEfectivo,
      cobrado_cheques: sumaTipo(["cheque"]),
      cobrado_transferencias: sumaTipo(["transferencia", "deposito"]),
      efectivo_en_mano: r2(fondoEntregado + cobradoEfectivo - gastosTotal),
      saldo_billetera_titular: r2(((saldoBill || []) as any[]).reduce((s, x) => s + Number(x.saldo), 0)),
    },
  }
}
