import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/pagos-pendientes
// Pagos en estado pendiente_rendicion de los clientes del vendedor, con
// desglose por método para preparar la rendición.
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()

    const { data: pagos, error } = await supabase
      .from("pagos_clientes")
      .select("id, monto, fecha_pago, forma_pago, clientes(id, nombre), pagos_detalle(tipo_pago, monto, color_cheque, cheque_id, cheque:cheque_id(es_echeq))")
      .in("vendedor_id", session.vendedorIds)
      .eq("estado", "pendiente_rendicion")
      .order("fecha_pago", { ascending: true })

    if (error) throw error

    // Excluir pagos ya declarados en una rendición abierta (están "en viaje
    // a oficina", no se vuelven a rendir)
    const declarados = new Set<string>()
    const { data: abiertas } = await supabase
      .from("rendiciones")
      .select("id")
      .in("cobrador_id", session.vendedorIds)
      .eq("estado", "abierta")
    if (abiertas?.length) {
      const { data: items } = await supabase
        .from("rendicion_items")
        .select("pago_id")
        .in("rendicion_id", abiertas.map((r) => r.id))
      for (const it of items || []) declarados.add(it.pago_id)
    }
    const pagosFiltrados = (pagos || []).filter((p: any) => !declarados.has(p.id))

    let totalEfectivo = 0
    let totalOtros = 0
    // FÍSICO (efectivo en pesos + cheques de papel en unidades) vs VIRTUAL (transferencias y
    // echeqs): nunca un total mezclado (Juan, 27/11/2026)
    const chequesFisicos = { cantidad: 0, monto: 0 }
    const echeqs = { cantidad: 0, monto: 0 }
    let transferencias = 0
    // Un cheque = un papel: el compartido entre varios clientes se cuenta UNA vez (como la billetera)
    const papeles = new Set<string>()
    const echeqsVistos = new Set<string>()
    const resultado = pagosFiltrados.map((p: any) => {
      const detalles: any[] = p.pagos_detalle || []
      const efectivo = detalles
        .filter((d) => (d.tipo_pago || "").toLowerCase() === "efectivo")
        .reduce((s, d) => s + Number(d.monto), 0)
      const sinDetalle = !detalles.length && (p.forma_pago || "").toLowerCase() === "efectivo"
      const ef = sinDetalle ? Number(p.monto) : efectivo
      totalEfectivo += ef
      totalOtros += Number(p.monto) - ef
      const fis = { cantidad: 0, monto: 0 }
      const ech = { cantidad: 0, monto: 0 }
      let transf = 0
      for (const d of detalles) {
        const tipo = (d.tipo_pago || "").toLowerCase()
        const m = Number(d.monto) || 0
        // echeq = virtual (mismo criterio que esDetalleDigital de lib/cobranzas/crear.ts)
        if (tipo === "cheque" && ((d.color_cheque || "").toUpperCase() === "ECHEQ" || d.cheque?.es_echeq)) {
          if (!d.cheque_id || !echeqsVistos.has(d.cheque_id)) ech.cantidad++
          if (d.cheque_id) echeqsVistos.add(d.cheque_id)
          ech.monto += m
        } else if (tipo === "cheque") {
          if (!d.cheque_id || !papeles.has(d.cheque_id)) fis.cantidad++
          if (d.cheque_id) papeles.add(d.cheque_id)
          fis.monto += m
        }
        else if (tipo === "transferencia" || tipo === "deposito") transf += m
      }
      chequesFisicos.cantidad += fis.cantidad; chequesFisicos.monto += fis.monto
      echeqs.cantidad += ech.cantidad; echeqs.monto += ech.monto
      transferencias += transf
      return {
        id: p.id,
        monto: Number(p.monto),
        monto_efectivo: ef,
        cheques_fisicos: fis,
        echeqs: ech,
        transferencias: transf,
        fecha_pago: p.fecha_pago,
        cliente_nombre: p.clientes?.nombre || "—",
        metodo_resumen: detalles.length
          ? detalles.map((d) => d.tipo_pago).join(" + ")
          : p.forma_pago || "—",
      }
    })

    // Retiros de efectivo todavía sin rendir: rendicion_crear v4 los descuenta
    // de lo que tiene que llevar, así que la pantalla propone efectivo − retiros
    // (si propone solo el efectivo, rendir sin tocar el número deja el retiro
    // compensado "a su favor" — auditoría 21/10).
    const { data: retiros, error: eRet } = await supabase
      .from("billetera_movimientos")
      .select("monto")
      .in("viajante_id", session.vendedorIds)
      .eq("referencia_tipo", "retiro_efectivo")
      .is("rendicion_id", null)
    if (eRet) throw eRet
    const retirosSinRendir = Math.round((retiros || []).reduce((s, m: any) => s - Number(m.monto || 0), 0) * 100) / 100

    return NextResponse.json({
      pagos: resultado,
      total: resultado.reduce((s, p) => s + p.monto, 0),
      total_efectivo: totalEfectivo,
      total_otros: totalOtros,
      cheques_fisicos: { cantidad: chequesFisicos.cantidad, monto: Math.round(chequesFisicos.monto * 100) / 100 },
      echeqs: { cantidad: echeqs.cantidad, monto: Math.round(echeqs.monto * 100) / 100 },
      transferencias: Math.round(transferencias * 100) / 100,
      retiros_sin_rendir: retirosSinRendir,
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/pagos-pendientes:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
