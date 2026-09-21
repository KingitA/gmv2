// Ficha del cliente + cuenta corriente para el módulo vendedor.
// Extraído de GET /api/vendedor/cliente/[id] (misma lógica, misma respuesta) para
// que también lo use la réplica de la app Vendedor (lib/mobile/sync/vendedor.ts)
// sin re-autenticar por cliente. Ver MOBILE.md → "Vendedor".

import { disponibleDePago } from "@/lib/cuenta-corriente/pago-disponible"
import { getSaldosCliente } from "@/lib/cuenta-corriente/saldo"
import { MARCA_CONTADO } from "@/lib/constants"

export interface SesionFicha {
  vendedorIds: string[]
  user: { id: string }
}

/** null = cliente inexistente o no asignado a los vendedores de la sesión. */
export async function cargarFichaCliente(supabase: any, session: SesionFicha, id: string) {
  const { data: cliente } = await supabase
    .from("clientes")
    .select(
      "id, nombre, razon_social, cuit, direccion, localidad, localidad_id, provincia, telefono, mail, condicion_iva, condicion_pago, condicion_entrega, metodo_facturacion, vendedor_id, codigo_cliente, lista_precio_id, lista:lista_precio_id(nombre)"
    )
    .eq("id", id)
    .in("vendedor_id", session.vendedorIds)
    .maybeSingle()

  if (!cliente) return null

  // Auditoría de la ficha (best-effort: requiere la migración
  // 20260707_clientes_auditoria; hasta entonces la query falla y queda null)
  let actualizadoAt: string | null = null
  let actualizadoPorNombre: string | null = null
  const { data: audit } = await supabase
    .from("clientes")
    .select("actualizado_por, actualizado_at")
    .eq("id", id)
    .maybeSingle()
  if (audit?.actualizado_at) actualizadoAt = audit.actualizado_at
  if (audit?.actualizado_por) {
    const { data: perfil } = await supabase
      .from("profiles")
      .select("nombre")
      .eq("id", audit.actualizado_por)
      .maybeSingle()
    actualizadoPorNombre = perfil?.nombre || null
  }

  const { data: saldo } = await supabase
    .from("v_saldo_clientes")
    .select("saldo_actual")
    .eq("cliente_id", id)
    .maybeSingle()

  // Comprobantes con saldo pendiente, más viejos primero (FIFO)
  const { data: comprobantes } = await supabase
    .from("comprobantes_venta")
    .select(
      "id, tipo_comprobante, numero_comprobante, fecha, total_factura, saldo_pendiente, estado_pago, pedido_id, pedido:pedido_id(numero_pedido)"
    )
    .eq("cliente_id", id)
    .gt("saldo_pendiente", 0)
    .in("estado_pago", ["pendiente", "parcial"])
    // Un comprobante anulado no se cobra (su NC inversa lo cancela)
    .is("anulado_en", null)
    .order("fecha", { ascending: true })

  // ── EN COBRO: imputaciones PENDIENTES de pagos vivos sobre estos
  // comprobantes (cobros ya registrados que la oficina aún no confirmó).
  // El front las resta del saldo mostrado/seleccionable: sin esto el
  // vendedor puede cobrar dos veces el mismo comprobante.
  const compIds = (comprobantes || []).map((c: any) => c.id)
  const enCobroPorComp = new Map<string, number>()
  // Parte del "en cobro" que viajó marcada [10% CONTADO]: si esas entregas
  // más lo de hoy completan el comprobante, el 10% bonifica el total.
  const enCobroContadoPorComp = new Map<string, number>()
  if (compIds.length) {
    const { data: impPend } = await supabase
      .from("imputaciones")
      .select("comprobante_id, monto_imputado, pago_id")
      .in("comprobante_id", compIds)
      .eq("estado", "pendiente")
    const pagoIdsPend = [...new Set((impPend || []).map((i: any) => i.pago_id).filter(Boolean))]
    const estadoPago = new Map<string, string>()
    const contadoPago = new Set<string>()
    if (pagoIdsPend.length) {
      const { data: pgs } = await supabase
        .from("pagos_clientes")
        .select("id, estado, observaciones")
        .in("id", pagoIdsPend)
      for (const p of pgs || []) {
        estadoPago.set(p.id, p.estado)
        if ((p.observaciones || "").includes(MARCA_CONTADO)) contadoPago.add(p.id)
      }
    }
    for (const i of impPend || []) {
      const est = estadoPago.get(i.pago_id)
      if (est === "pendiente" || est === "pendiente_rendicion") {
        enCobroPorComp.set(i.comprobante_id, (enCobroPorComp.get(i.comprobante_id) || 0) + Number(i.monto_imputado))
        if (contadoPago.has(i.pago_id))
          enCobroContadoPorComp.set(i.comprobante_id, (enCobroContadoPorComp.get(i.comprobante_id) || 0) + Number(i.monto_imputado))
      }
    }
  }
  const comprobantesConReserva = (comprobantes || []).map((c: any) => ({
    ...c,
    en_cobro: Math.round((enCobroPorComp.get(c.id) || 0) * 100) / 100,
    en_cobro_contado: Math.round((enCobroContadoPorComp.get(c.id) || 0) * 100) / 100,
  }))

  // Pedidos cobrables sin facturar (anticipo, mismo criterio que el ERP):
  // sin comprobantes emitidos, sin anticipo previo, y ya confirmados (no en_venta)
  const { data: pedidosCliente } = await supabase
    .from("pedidos")
    .select("id, numero_pedido, fecha, estado, total, pago_contado_10, anticipo_pago_id")
    .eq("cliente_id", id)
    .is("eliminado_at", null)
    .not("estado", "in", "(eliminado,en_venta)")
    .order("fecha", { ascending: true })

  const { data: compsDePedidos } = await supabase
    .from("comprobantes_venta")
    .select("pedido_id")
    .eq("cliente_id", id)
    .not("pedido_id", "is", null)
  const pedidosFacturados = new Set((compsDePedidos || []).map((c: any) => c.pedido_id))

  const pedidosCobrables = (pedidosCliente || []).filter(
    (p: any) => !pedidosFacturados.has(p.id) && !p.anticipo_pago_id && Number(p.total || 0) > 0
  )

  const { data: pagosRecientes } = await supabase
    .from("pagos_clientes")
    .select("id, fecha_pago, monto, estado, forma_pago, verificado_por, cobrador_tipo, vendedor_id, creado_por")
    .eq("cliente_id", id)
    .order("fecha_pago", { ascending: false })
    .limit(10)

  // ── PLATA A FAVOR del cliente (el vendedor debe verla al cobrar: sin esto
  // podría cobrar la deuda bruta cuando el cliente tiene crédito) ──
  // a) Créditos documento vivos: NC/REV con saldo disponible
  const { data: creditosVivos } = await supabase
    .from("comprobantes_venta")
    .select("id, tipo_comprobante, numero_comprobante, fecha, saldo_pendiente")
    .eq("cliente_id", id)
    .lt("saldo_pendiente", -0.005)
    .is("anulado_en", null)
    .neq("estado_pago", "anulado")
    .order("fecha", { ascending: true })

  // b) Entregas a cuenta con disponible sin imputar. No solo confirmadas:
  // también las que están EN VIAJE (sin rendir) o EN OFICINA (sin confirmar)
  // — el movimiento existe y el vendedor debe poder tildarlo para no cobrar
  // dos veces. Las rechazadas de los últimos 30 días se listan informativas
  // (NO descuentan).
  const { data: pagosConfirmados } = await supabase
    .from("pagos_clientes")
    .select("id, monto, fecha_pago, estado, vendedor_id, creado_por")
    .eq("cliente_id", id)
    .in("estado", ["confirmado", "pendiente", "pendiente_rendicion", "rechazado"])
  const confIds = (pagosConfirmados || []).map((p: any) => p.id)
  const impsPorPagoConf = new Map<string, any[]>()
  if (confIds.length) {
    const { data: impsConf } = await supabase
      .from("imputaciones")
      .select("pago_id, monto_imputado, estado, comprobante:comprobantes_venta!imputaciones_comprobante_id_fkey(tipo_comprobante)")
      .in("pago_id", confIds)
    for (const i of impsConf || []) {
      if (!impsPorPagoConf.has(i.pago_id)) impsPorPagoConf.set(i.pago_id, [])
      impsPorPagoConf.get(i.pago_id)!.push(i)
    }
  }
  const cutoffRechazadas = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const aCuenta = (pagosConfirmados || [])
    .map((p: any) => ({
      pago_id: p.id,
      fecha: p.fecha_pago,
      estado: p.estado as string,
      monto: Number(p.monto) || 0,
      // ¿La tiene este usuario? (para el rótulo "en tu poder")
      mia: session.vendedorIds.includes(p.vendedor_id) || p.creado_por === session.user.id,
      disponible: disponibleDePago(
        p.monto,
        (impsPorPagoConf.get(p.id) || []).map((i: any) => ({
          monto_imputado: i.monto_imputado,
          estado: i.estado,
          tipo_comprobante_destino: (i.comprobante as any)?.tipo_comprobante ?? null,
        })),
      ),
    }))
    .filter((p: any) =>
      p.estado === "rechazado"
        ? (p.fecha || "") >= cutoffRechazadas
        : p.disponible > 0.005
    )
  const totalAFavor = Math.round((
    (creditosVivos || []).reduce((s: number, c: any) => s + Math.abs(Number(c.saldo_pendiente)), 0)
    + aCuenta.filter((p: any) => p.estado !== "rechazado").reduce((s: number, p: any) => s + p.disponible, 0)
  ) * 100) / 100

  // Devoluciones sin confirmar (todavía no tienen NC/reversa emitida), con
  // cuánto ya se descontó en cobros anteriores (se puede descontar parcial).
  const { data: devolucionesPendientes } = await supabase
    .from("devoluciones")
    .select("id, numero_devolucion, pedido_id, monto_total, created_at")
    .eq("cliente_id", id)
    .eq("estado", "pendiente")
    .order("created_at", { ascending: false })

  const devIds = (devolucionesPendientes || []).map((d: any) => d.id)
  const descontadoPorDev = new Map<string, number>()
  if (devIds.length) {
    const { data: descuentos } = await supabase
      .from("devoluciones_descuentos")
      .select("devolucion_id, monto")
      .in("devolucion_id", devIds)
    for (const d of descuentos || [])
      descontadoPorDev.set(d.devolucion_id, (descontadoPorDev.get(d.devolucion_id) || 0) + Number(d.monto))
  }
  const devolucionesConRestante = (devolucionesPendientes || []).map((d: any) => ({
    ...d,
    descontado: Math.round((descontadoPorDev.get(d.id) || 0) * 100) / 100,
    restante: Math.max(0, Math.round((Number(d.monto_total || 0) - (descontadoPorDev.get(d.id) || 0)) * 100) / 100),
  }))

  // ── Saldo REAL y PROYECTADO: UNA sola fórmula para todas las pantallas
  // (lib/cuenta-corriente/saldo.ts). El proyectado descuenta exactamente lo
  // que los cobros pendientes van a hacer al confirmarse (plata + NC 10%
  // real + ajuste − débito 10% s/créditos). Las devoluciones en proceso NO
  // entran (todavía no son documento): se muestran aparte como estimado.
  const saldos = await getSaldosCliente(supabase, id)

  // Vista unificada para la pantalla de cobro: TODOS los pedidos vigentes
  // del cliente con su estado; el front les asocia comprobantes (por
  // pedido_id) y devoluciones. "cobrable" = sin facturar y sin anticipo
  // previo (se puede cobrar el pedido completo como anticipo).
  const pedidosCobro = (pedidosCliente || [])
    .map((p: any) => ({
      id: p.id,
      numero_pedido: p.numero_pedido,
      fecha: p.fecha,
      estado: p.estado,
      total: Number(p.total || 0),
      pago_contado_10: !!p.pago_contado_10,
      anticipo_pago_id: p.anticipo_pago_id || null,
      facturado: pedidosFacturados.has(p.id),
      cobrable: !pedidosFacturados.has(p.id) && !p.anticipo_pago_id && Number(p.total || 0) > 0,
    }))
    .sort((a: any, b: any) => (a.fecha < b.fecha ? 1 : -1))

  return {
    cliente: {
      ...cliente,
      saldo_actual: saldos.saldo_real,
      saldo_proyectado: saldos.saldo_proyectado,
      pendiente_verificacion: saldos.pendiente_verificacion,
      devoluciones_en_proceso: devolucionesConRestante.reduce((s: number, d: any) => s + Number(d.restante || 0), 0),
      actualizado_at: actualizadoAt,
      actualizado_por_nombre: actualizadoPorNombre,
    },
    comprobantes: comprobantesConReserva,
    creditos: creditosVivos || [],
    a_cuenta: aCuenta,
    total_a_favor: totalAFavor,
    pedidos_cobrables: pedidosCobrables,
    pedidos_cobro: pedidosCobro,
    devoluciones_pendientes: devolucionesConRestante,
    pagos_recientes: (pagosRecientes || []).map((p: any) => ({
      ...p,
      // Verificado = SEGUNDA firma real (verificado_por), no la confirmación:
      // antes se usaba confirmado_por y todo pago confirmado salía "Verificado".
      verificado: p.estado === "confirmado" && !!p.verificado_por,
      // El vendedor puede eliminar su cobro SOLO mientras esté en su poder
      // (sin rendir); el server DELETE valida además que no esté declarado.
      eliminable:
        p.estado === "pendiente_rendicion" &&
        p.cobrador_tipo === "viajante" &&
        (session.vendedorIds.includes(p.vendedor_id) || p.creado_por === session.user.id),
    })),
  }
}
