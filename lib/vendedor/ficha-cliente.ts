// Ficha del cliente + cuenta corriente para el módulo vendedor.
// Extraído de GET /api/vendedor/cliente/[id] (misma lógica, misma respuesta) para
// que también lo use la réplica de la app Vendedor (lib/mobile/sync/vendedor.ts)
// sin re-autenticar por cliente. Ver MOBILE.md → "Vendedor".

import { disponibleDePago } from "@/lib/cuenta-corriente/pago-disponible"
import { enCobroPorComprobante } from "@/lib/cobranzas/en-cobro"
import { reservasDeCreditos } from "@/lib/cobranzas/creditos"
import { PREFIJO_AJUSTE_APERTURA } from "@/lib/apertura/parsear-chr"
import { bonificacionPendientePorComprobante } from "@/lib/cobranzas/bonif-pendiente"
import { valorarDevoluciones } from "@/lib/cobranzas/valorar-devoluciones"
import { getSaldosCliente } from "@/lib/cuenta-corriente/saldo"
import { MARCA_CONTADO } from "@/lib/constants"
import { hoyISO, sumarDiasISO } from "@/lib/formato"

export interface SesionFicha {
  vendedorIds: string[]
  user: { id: string }
}

/** null = cliente inexistente o no asignado a los vendedores de la sesión. */
export async function cargarFichaCliente(supabase: any, session: SesionFicha, id: string) {
  const { data: cliente } = await supabase
    .from("clientes")
    .select(
      "id, nombre, razon_social, cuit, direccion, localidad, localidad_id, provincia, telefono, mail, condicion_iva, condicion_pago, condicion_entrega, metodo_facturacion, vendedor_id, codigo_cliente, lista_precio_id, lista:lista_precio_id(nombre), lista_limpieza_id, metodo_limpieza, lista_perf0_id, metodo_perf0, lista_perf_plus_id, metodo_perf_plus"
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
  // Fórmula única con la cuenta de cobro del chofer (lib/cobranzas/en-cobro.ts).
  // Parte del "en cobro" que viajó marcada [10% CONTADO]: si esas entregas
  // más lo de hoy completan el comprobante, el 10% bonifica el total.
  const { enCobro: enCobroPorComp, enCobroContado: enCobroContadoPorComp } = await enCobroPorComprobante(supabase, compIds, MARCA_CONTADO)
  // 10% contado que TODAVÍA le queda a cada comprobante (regla 07/10: 10% del TOTAL, una sola
  // vez; 0 si ya tiene su NC/REV de bonificación o si no bonifica). Misma función que usa el
  // servidor al registrar el cobro (lib/cobranzas/bonif-pendiente.ts): la app estima igual.
  const ncPendiente = compIds.length
    ? await bonificacionPendientePorComprobante(supabase, id, (comprobantes || []).map((c: any) => ({ comprobante_id: c.id, monto_imputado: 0 })))
    : {}
  const comprobantesConReserva = (comprobantes || []).map((c: any) => ({
    ...c,
    en_cobro: Math.round((enCobroPorComp.get(c.id) || 0) * 100) / 100,
    en_cobro_contado: Math.round((enCobroContadoPorComp.get(c.id) || 0) * 100) / 100,
    nc_contado: ncPendiente[c.id] ?? 0,
  }))

  // Pedidos cobrables sin facturar (anticipo, mismo criterio que el ERP):
  // sin comprobantes emitidos, sin anticipo previo, y ya confirmados (no en_venta)
  const { data: pedidosCliente } = await supabase
    .from("pedidos")
    .select("id, numero_pedido, fecha, estado, total, pago_contado_10, anticipo_pago_id")
    .eq("cliente_id", id)
    .is("eliminado_at", null)
    .not("estado", "in", "(eliminado,en_venta,sistema_viejo)")
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
  const { data: creditosVivosDb } = await supabase
    .from("comprobantes_venta")
    .select("id, tipo_comprobante, numero_comprobante, fecha, saldo_pendiente")
    .eq("cliente_id", id)
    .lt("saldo_pendiente", -0.005)
    .is("anulado_en", null)
    .neq("estado_pago", "anulado")
    .order("fecha", { ascending: true })
  // Lo que ya tomaron cobros sin confirmar no está disponible: se descuenta
  // de cada crédito (auditoría 21/10, créditos usados dos veces). La app
  // muestra este número tal cual.
  const reservas = await reservasDeCreditos(supabase, id)
  const creditosVivos = (creditosVivosDb || [])
    .map((c: any) => ({
      ...c,
      saldo_pendiente: -Math.round(Math.max(0, -Number(c.saldo_pendiente) - (reservas.get(c.id) ?? 0)) * 100) / 100,
    }))
    .filter((c: any) => Number(c.saldo_pendiente) < -0.005)

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
  const cutoffRechazadas = sumarDiasISO(hoyISO(), -30)
  const aCuenta = (pagosConfirmados || [])
    .map((p: any) => ({
      pago_id: p.id,
      fecha: p.fecha_pago,
      estado: p.estado as string,
      monto: Number(p.monto) || 0,
      // ¿La tiene este usuario? (para el rótulo "en tu poder")
      mia: session.vendedorIds.includes(p.vendedor_id) || p.creado_por === session.user.id,
      disponible: Math.round(Math.max(0, disponibleDePago(
        p.monto,
        (impsPorPagoConf.get(p.id) || []).map((i: any) => ({
          monto_imputado: i.monto_imputado,
          estado: i.estado,
          tipo_comprobante_destino: (i.comprobante as any)?.tipo_comprobante ?? null,
        })),
      ) - (reservas.get(p.id) ?? 0)) * 100) / 100,
    }))
    .filter((p: any) =>
      p.estado === "rechazado"
        ? (p.fecha || "") >= cutoffRechazadas
        : p.disponible > 0.005
    )
  // Ajustes de APERTURA (texto libre del sistema viejo, #6/#7): parte del saldo
  // sin comprobante. La app los puede listar para que lo pendiente sume el saldo.
  const { data: ajustesApDb } = await supabase
    .from("cuenta_corriente_clientes")
    .select("id, fecha, debe, haber, numero_comprobante, observaciones")
    .eq("cliente_id", id)
    .ilike("observaciones", `${PREFIJO_AJUSTE_APERTURA}%`)
    .order("fecha", { ascending: true })
  const ajustesApertura = (ajustesApDb || []).map((a: any) => ({
    id: a.id,
    fecha: a.fecha,
    concepto: String(a.observaciones || "").replace(`${PREFIJO_AJUSTE_APERTURA} — `, "").replace(/\s*\(importe.*$/, ""),
    numero: a.numero_comprobante,
    monto: Math.round((Number(a.debe || 0) - Number(a.haber || 0)) * 100) / 100,
  }))

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
  // Valor en cobro con la regla única (precio de factura, neto del 10% si la
  // factura original fue contado): es lo que descuenta la pantalla y lo que
  // va a acreditar la NC futura, al centavo.
  const valoresDev = await valorarDevoluciones(supabase, { clienteId: id, devolucionIds: devIds })
  const devolucionesConRestante = (devolucionesPendientes || []).map((d: any) => {
    const descontado = Math.round((descontadoPorDev.get(d.id) || 0) * 100) / 100
    const v = valoresDev.get(d.id)
    const valorTotal = v?.total ?? (Number(d.monto_total) || 0)
    return {
      ...d,
      descontado,
      // restante ahora en términos de VALOR (los descuentos también se asientan por valor)
      restante: Math.max(0, Math.round((valorTotal - descontado) * 100) / 100),
      aplica_10: v?.aplica_10 ?? false,
      valor_total: valorTotal,
      valor_cobro: Math.max(0, Math.round((valorTotal - descontado) * 100) / 100),
    }
  })

  // ── Saldo REAL y PROYECTADO: UNA sola fórmula para todas las pantallas
  // (lib/cuenta-corriente/saldo.ts). El proyectado descuenta exactamente lo
  // que los cobros pendientes van a hacer al confirmarse (plata + NC 10%
  // real + ajuste − débito 10% s/créditos) y las devoluciones en proceso (sin
  // NC todavía) por su valor: regla del dueño 16/10, apenas se cargan ya descuentan.
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
      devoluciones_en_proceso: saldos.devoluciones_en_proceso,
      actualizado_at: actualizadoAt,
      actualizado_por_nombre: actualizadoPorNombre,
    },
    comprobantes: comprobantesConReserva,
    creditos: creditosVivos || [],
    a_cuenta: aCuenta,
    ajustes_apertura: ajustesApertura,
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
