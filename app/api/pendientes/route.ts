import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requirePermiso, tienePermiso } from "@/lib/auth"
import { diasEntre, hoyISO } from "@/lib/formato"
import { disponibleDePago } from "@/lib/cuenta-corriente/pago-disponible"

// GET /api/pendientes — la BANDEJA de la oficina (regla del dueño 16/10/2026):
// todo lo que está esperando que alguien lo revise, con hace cuántos días.
//   1. Cobros sin confirmar (cargados en oficina, vendedor o chofer)
//   2. Entregas a cuenta sin decidir (imputar a lo más viejo o dejar a cuenta)
//   3. Anticipos esperando la factura del pedido (informativo)
//   4. Devoluciones esperando que depósito las revise
//   5. Devoluciones aceptadas sin NC (la emite una persona de la oficina)
//   6. Rendiciones abiertas (rojo si pasan la semana)
// Solo lectura: no cambia nada. Vive dentro de Caja: solo admin (dueño 21/10);
// las acciones de plata (imputar, dejar a cuenta, confirmar) también.
export async function GET() {
  const auth = await requirePermiso("caja")
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const hoy = hoyISO()
    const dias = (f: string | null | undefined) => (f ? Math.max(0, diasEntre(f, hoy) || 0) : 0)

    const [pendRes, confRes, devRes, rendRes] = await Promise.all([
      supabase
        .from("pagos_clientes")
        .select("id, cliente_id, monto, estado, cobrador_tipo, created_at, fecha_pago, creado_por, pagos_detalle(tipo_pago)")
        .in("estado", ["pendiente", "pendiente_rendicion"])
        .order("created_at", { ascending: true }),
      supabase
        .from("pagos_clientes")
        .select("id, cliente_id, monto, created_at, fecha_pago, a_cuenta_decidido_at, observaciones, imputaciones(monto_imputado, estado, comprobantes_venta!imputaciones_comprobante_id_fkey(tipo_comprobante))")
        .eq("estado", "confirmado")
        .is("a_cuenta_decidido_at", null)
        .order("created_at", { ascending: true }),
      supabase
        .from("devoluciones")
        .select("id, numero_devolucion, cliente_id, monto_total, estado, created_at, fecha_confirmacion, confirmado_por, retira_viajante, viaje_id")
        .in("estado", ["pendiente", "confirmado"])
        .order("created_at", { ascending: true }),
      supabase
        .from("rendiciones")
        .select("id, cobrador_id, cobrador_tipo, created_at, efectivo_declarado, viaje_id")
        .eq("estado", "abierta")
        .order("created_at", { ascending: true }),
    ])
    for (const r of [pendRes, confRes, devRes, rendRes]) if (r.error) throw r.error

    // Entregas a cuenta: pagos confirmados con plata sin aplicar
    const conDisponible = (confRes.data || [])
      .map((p: any) => ({
        ...p,
        disponible: disponibleDePago(
          p.monto,
          (p.imputaciones || []).map((i: any) => ({
            monto_imputado: i.monto_imputado,
            estado: i.estado,
            tipo_comprobante_destino: i.comprobantes_venta?.tipo_comprobante ?? null,
          })),
        ),
      }))
      .filter((p: any) => p.disponible > 0.009)

    // ¿Es anticipo de un pedido todavía sin facturar? → espera la factura
    const idsDisp = conDisponible.map((p: any) => p.id)
    const anticipoDe = new Map<string, string[]>()
    if (idsDisp.length) {
      const { data: peds } = await supabase
        .from("pedidos")
        .select("numero_pedido, anticipo_pago_id, estado")
        .in("anticipo_pago_id", idsDisp)
        .neq("estado", "facturado")
        .neq("estado", "eliminado")
      for (const p of peds || []) {
        if (!anticipoDe.has(p.anticipo_pago_id)) anticipoDe.set(p.anticipo_pago_id, [])
        anticipoDe.get(p.anticipo_pago_id)!.push(String(p.numero_pedido))
      }
    }

    // Nombres de clientes y usuarios
    const clienteIds = [
      ...new Set([
        ...(pendRes.data || []).map((p: any) => p.cliente_id),
        ...conDisponible.map((p: any) => p.cliente_id),
        ...(devRes.data || []).map((d: any) => d.cliente_id),
      ].filter(Boolean)),
    ]
    // Cobros ya declarados en una rendición abierta: el cobrador ya rindió, la
    // plata está "en camino a oficina" (antes decía "sin rendir" y confundía).
    const enCamino = new Set<string>()
    if (rendRes.data?.length) {
      const { data: items, error } = await supabase
        .from("rendicion_items")
        .select("pago_id")
        .in("rendicion_id", rendRes.data.map((r: any) => r.id))
      if (error) throw error
      for (const it of items || []) enCamino.add(it.pago_id)
    }

    // confirmado_por de devoluciones es texto: hoy guarda el id del usuario
    const esUuid = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s)
    const usuarioIds = [
      ...new Set([
        ...(pendRes.data || []).map((p: any) => p.creado_por),
        ...(rendRes.data || []).map((r: any) => r.cobrador_id),
        ...(devRes.data || []).map((d: any) => d.confirmado_por).filter(esUuid),
      ].filter(Boolean)),
    ]
    const [{ data: clientes }, { data: perfiles }] = await Promise.all([
      clienteIds.length
        ? supabase.from("clientes").select("id, nombre, nombre_razon_social").in("id", clienteIds)
        : Promise.resolve({ data: [] as any[] }),
      usuarioIds.length
        ? supabase.from("profiles").select("id, nombre, email").in("id", usuarioIds)
        : Promise.resolve({ data: [] as any[] }),
    ])
    const cliente = new Map((clientes || []).map((c: any) => [c.id, c.nombre || c.nombre_razon_social || "Cliente"]))
    const usuario = new Map((perfiles || []).map((u: any) => [u.id, u.nombre || u.email || "—"]))

    const cobros = (pendRes.data || []).map((p: any) => ({
      pago_id: p.id,
      cliente_id: p.cliente_id,
      cliente: cliente.get(p.cliente_id) || "Cliente",
      monto: Number(p.monto) || 0,
      estado: p.estado,
      en_camino: enCamino.has(p.id),
      quien: p.cobrador_tipo === "chofer" ? "Chofer" : p.cobrador_tipo === "viajante" ? "Vendedor" : "Oficina",
      cargado_por: usuario.get(p.creado_por) || null,
      medios: [...new Set((p.pagos_detalle || []).map((d: any) => d.tipo_pago))],
      desde: p.created_at,
      dias: dias(p.created_at),
    }))

    const aCuenta = conDisponible
      .filter((p: any) => !anticipoDe.has(p.id))
      .map((p: any) => ({
        pago_id: p.id,
        cliente_id: p.cliente_id,
        cliente: cliente.get(p.cliente_id) || "Cliente",
        monto: Number(p.monto) || 0,
        disponible: p.disponible,
        desde: p.created_at,
        dias: dias(p.created_at),
      }))

    const anticipos = conDisponible
      .filter((p: any) => anticipoDe.has(p.id))
      .map((p: any) => ({
        pago_id: p.id,
        cliente_id: p.cliente_id,
        cliente: cliente.get(p.cliente_id) || "Cliente",
        disponible: p.disponible,
        pedidos: anticipoDe.get(p.id) || [],
        desde: p.created_at,
        dias: dias(p.created_at),
      }))

    const devs = (devRes.data || []).map((d: any) => ({
      devolucion_id: d.id,
      numero: d.numero_devolucion,
      cliente_id: d.cliente_id,
      cliente: cliente.get(d.cliente_id) || "Cliente",
      monto: Number(d.monto_total) || 0,
      estado: d.estado,
      aceptada_por: (esUuid(d.confirmado_por) ? usuario.get(d.confirmado_por) : d.confirmado_por) || null,
      desde: d.estado === "confirmado" ? d.fecha_confirmacion || d.created_at : d.created_at,
      dias: dias(d.estado === "confirmado" ? d.fecha_confirmacion || d.created_at : d.created_at),
    }))

    const rendiciones = (rendRes.data || []).map((r: any) => ({
      rendicion_id: r.id,
      quien: usuario.get(r.cobrador_id) || (r.cobrador_tipo === "chofer" ? "Chofer" : "Vendedor"),
      tipo: r.cobrador_tipo,
      efectivo: Number(r.efectivo_declarado) || 0,
      desde: r.created_at,
      dias: dias(r.created_at),
      vencida: dias(r.created_at) > 7,
    }))

    return NextResponse.json({
      puede_operar_caja: tienePermiso(auth.roles, "caja"),
      cobros_sin_confirmar: cobros,
      a_cuenta_sin_decidir: aCuenta,
      anticipos_esperando_factura: anticipos,
      devoluciones_en_deposito: devs.filter((d) => d.estado === "pendiente"),
      devoluciones_sin_nc: devs.filter((d) => d.estado === "confirmado"),
      rendiciones_abiertas: rendiciones,
    })
  } catch (error: any) {
    console.error("[pendientes] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
