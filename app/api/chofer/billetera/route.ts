import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// GET /api/chofer/billetera — la billetera del chofer, con el mismo criterio
// que la del vendedor: la plata EN MANO sale de los cobros sin rendir
// (pagos_clientes + pagos_detalle) más la plata a cuenta de viaje menos los
// gastos. El saldo es SOLO efectivo; los cheques van aparte como papeles en
// mano (echeq y transferencias las ve la oficina).
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const userId = auth.user.id

    // Viajes donde es titular: sus cobros (propios o del acompañante) son de esta billetera
    const { data: viajesTitular } = await supabase.from("viajes").select("id, nombre").eq("chofer_id", userId)
    const viajeIds = (viajesTitular || []).map((v: any) => v.id as string)
    const nombreViaje = new Map((viajesTitular || []).map((v: any) => [v.id, v.nombre as string]))

    const [{ data: pagos }, { data: movimientos }, { data: fondos }, { data: gastos }] = await Promise.all([
      viajeIds.length
        ? supabase
            .from("pagos_clientes")
            .select("id, viaje_id, cliente_id, monto, estado, created_at, clientes(nombre, razon_social, nombre_razon_social), pagos_detalle(tipo_pago, monto, banco, numero_cheque, fecha_cheque)")
            .in("viaje_id", viajeIds)
            .in("estado", ["pendiente_rendicion", "confirmado"])
            .order("created_at", { ascending: false })
            .limit(300)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from("billetera_movimientos")
        .select("id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, created_at")
        .eq("viajante_id", userId)
        .order("fecha", { ascending: false })
        .limit(150),
      viajeIds.length
        ? supabase.from("viajes_fondos").select("id, viaje_id, monto, created_at").in("viaje_id", viajeIds).order("created_at", { ascending: false }).limit(50)
        : Promise.resolve({ data: [] as any[] }),
      viajeIds.length
        ? supabase.from("viajes_gastos").select("id, viaje_id, categoria, monto, estado, observaciones, created_at").in("viaje_id", viajeIds).neq("estado", "rechazado").order("created_at", { ascending: false }).limit(100)
        : Promise.resolve({ data: [] as any[] }),
    ])

    // Rendiciones abiertas: esos cobros ya fueron declarados (van camino a oficina)
    const { data: abiertas } = await supabase.from("rendiciones").select("id").eq("cobrador_id", userId).eq("estado", "abierta")
    const declarados = new Set<string>()
    if (abiertas?.length) {
      const { data: items } = await supabase.from("rendicion_items").select("pago_id").in("rendicion_id", abiertas.map((r: any) => r.id))
      for (const it of items || []) declarados.add(it.pago_id)
    }

    let efectivo = 0
    let chequesCantidad = 0
    let chequesMonto = 0
    let transferencias = 0
    let enViaje = 0
    const cobros: any[] = []
    for (const p of (pagos || []) as any[]) {
      const cli = p.clientes?.nombre_razon_social || p.clientes?.razon_social || p.clientes?.nombre || "Cliente"
      const detalles: any[] = p.pagos_detalle || []
      const metodos = detalles.map((d) => {
        const t = (d.tipo_pago || "").toLowerCase()
        if (t === "cheque") return `Cheque ${d.banco || ""} ${d.numero_cheque || ""}`.trim()
        if (t === "transferencia") return "Transferencia"
        if (t === "deposito") return "Depósito"
        return "Efectivo"
      })
      const sinRendir = p.estado === "pendiente_rendicion"
      const declarado = declarados.has(p.id)
      if (sinRendir && !declarado) {
        for (const d of detalles) {
          const t = (d.tipo_pago || "").toLowerCase()
          if (t === "efectivo") efectivo += Number(d.monto)
          else if (t === "cheque") { chequesCantidad += 1; chequesMonto += Number(d.monto) }
          else transferencias += Number(d.monto)
        }
      } else if (sinRendir && declarado) enViaje += Number(p.monto)
      cobros.push({
        id: p.id,
        fecha: p.created_at,
        cliente: cli,
        viaje: nombreViaje.get(p.viaje_id) || "",
        monto: Number(p.monto),
        metodos: [...new Set(metodos)],
        estado: p.estado === "confirmado" ? "rendido" : declarado ? "en_rendicion" : "en_mano",
      })
    }

    // Fondo de viaje y gastos: solo de viajes todavía no rendidos (el resto ya pasó por caja)
    const { data: viajesVivos } = viajeIds.length
      ? await supabase.from("viajes").select("id").in("id", viajeIds).in("estado", ["programado", "despachado", "en_curso"])
      : { data: [] as any[] }
    const vivos = new Set((viajesVivos || []).map((v: any) => v.id))
    const fondoEnMano = (fondos || []).filter((f: any) => vivos.has(f.viaje_id)).reduce((s: number, f: any) => s + Number(f.monto), 0)
    const gastosEnMano = (gastos || []).filter((g: any) => vivos.has(g.viaje_id)).reduce((s: number, g: any) => s + Number(g.monto), 0)

    const r2 = (n: number) => Math.round(n * 100) / 100
    const efectivoEnMano = r2(efectivo + fondoEnMano - gastosEnMano)

    // Saldo de la cuenta corriente del chofer (diferencias de rendición: lo que debe o tiene a favor)
    const saldoCC = r2(
      (movimientos || [])
        .filter((m: any) => ["rendicion_diferencia", "rendicion_saldo_declarado", "viaje_gasto_rechazado"].includes(m.referencia_tipo))
        .reduce((s: number, m: any) => s + Number(m.monto), 0),
    )

    return NextResponse.json({
      efectivo: efectivoEnMano,
      desglose: {
        cobros_efectivo: r2(efectivo),
        fondo_viaje: r2(fondoEnMano),
        gastos: r2(gastosEnMano),
        cheques_monto: r2(chequesMonto),
        transferencias: r2(transferencias),
        en_rendicion: r2(enViaje),
      },
      cheques_cantidad: chequesCantidad,
      saldo_cuenta_corriente: saldoCC,
      cobros,
      gastos: (gastos || []).map((g: any) => ({ ...g, viaje: nombreViaje.get(g.viaje_id) || "" })),
      fondos: (fondos || []).map((f: any) => ({ ...f, viaje: nombreViaje.get(f.viaje_id) || "" })),
      movimientos: movimientos || [],
    })
  } catch (error: any) {
    console.error("[chofer] Error en GET billetera:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
