import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { fetchAllRows, fetchByIds } from "@/lib/supabase/fetch-all"
import { todayArgentina, startOfDayArgentina, endOfDayArgentina } from "@/lib/utils"

// ─── La Caja del Día — Etapa 1 (lectura) ────────────────────────────────────
// Feed unificado del libro diario de plata para /caja. Combina en TS (sin SQL
// nuevo) tres fuentes ya existentes:
//   1. kardex_contable del día (movimientos confirmados: cobros, OPs,
//      transferencias, egresos, rendiciones, cheques).
//   2. pagos_clientes pendiente / pendiente_rendicion (filas "por confirmar";
//      de los pendiente_rendicion solo la parte transferencia/echeq — el
//      efectivo y cheques físicos viajan dentro de su rendición).
//   3. rendiciones abiertas ("Esperando la plata": lo físico declarado que
//      todavía no llegó a la oficina; no suma al arqueo hasta confirmarse).
// El enriquecimiento de nombres se resuelve acá con fetchByIds para que la
// pantalla no haga N consultas.

type Estado = { tipo: "ok" | "info" | "accion" | "esperando" | "error"; texto: string }

interface FilaCaja {
  id: string
  fuente: "kardex" | "pago" | "rendicion"
  categoria: "cobro" | "transferencia" | "echeq" | "proveedor" | "rendicion" | "interno"
  hora: string | null // ISO — la pantalla la muestra en hora argentina
  quien: string
  sub: string
  medio: string
  entrada: number | null
  salida: number | null
  neutro: number | null // montos informativos sin signo (movimientos internos ajenos a caja chica)
  estado: Estado
  cliente_id?: string | null
  pago_id?: string | null
  rendicion_id?: string | null
  orden_pago_id?: string | null
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const num = (v: unknown) => Number(v ?? 0)

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const fecha = searchParams.get("fecha") || todayArgentina()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json({ error: "fecha inválida (YYYY-MM-DD)" }, { status: 400 })
    }
    const desde = startOfDayArgentina(fecha)
    const hasta = endOfDayArgentina(fecha)

    const [kardex, pendientesRes, rendicionesRes, cajasRes, bancosRes, saldosRes] = await Promise.all([
      fetchAllRows<any>(
        () =>
          supabase
            .from("kardex_contable")
            .select(
              "id, fecha, created_at, tipo_movimiento, concepto, monto, gastos, color, metodo, origen_tipo, origen_id, destino_tipo, destino_id, referencia_tipo, referencia_id, pago_id, cheque_id, cliente_id, verificado"
            )
            .gte("fecha", desde)
            .lte("fecha", hasta)
            .neq("tipo_movimiento", "APERTURA_SALDO"),
        "created_at"
      ),
      supabase
        .from("pagos_clientes")
        .select(
          "id, cliente_id, monto, fecha_pago, estado, cobrador_tipo, creado_por, created_at, observaciones, clientes(nombre), pagos_detalle(tipo_pago, monto, banco, numero_cheque, fecha_cheque, color_cheque, referencia, numero_comprobante_pago, fecha_transferencia)"
        )
        .in("estado", ["pendiente", "pendiente_rendicion"])
        .order("created_at", { ascending: true }),
      supabase
        .from("rendiciones")
        .select(
          "id, cobrador_id, cobrador_tipo, fecha, efectivo_declarado, efectivo_registrado, diferencia, observaciones, created_at, rendicion_items(pago_id)"
        )
        .eq("estado", "abierta")
        .order("created_at", { ascending: true }),
      supabase.from("cajas_financieras").select("id, nombre").eq("activo", true),
      supabase.from("cuentas_bancarias").select("id, nombre, banco").eq("activo", true),
      supabase.from("saldos_financieros").select("cuenta_tipo, cuenta_id, color, saldo"),
    ])
    if (pendientesRes.error) throw pendientesRes.error
    if (rendicionesRes.error) throw rendicionesRes.error

    const pendientes = pendientesRes.data || []
    const rendiciones = rendicionesRes.data || []
    const cajas = cajasRes.data || []
    const bancos = bancosRes.data || []
    const saldos = saldosRes.data || []

    // ── Mapas de nombres de cuentas (CAJA / BANCO / BILLETERA / INVERSION) ──
    const nombreCuenta = new Map<string, string>()
    for (const c of cajas) nombreCuenta.set(`CAJA:${c.id}`, c.nombre)
    for (const b of bancos) nombreCuenta.set(`BANCO:${b.id}`, b.nombre)

    const billeteraIds = [
      ...new Set(
        kardex
          .flatMap((k) => [
            k.origen_tipo === "BILLETERA" ? k.origen_id : null,
            k.destino_tipo === "BILLETERA" ? k.destino_id : null,
          ])
          .filter(Boolean) as string[]
      ),
    ]
    if (billeteraIds.length) {
      const vend = await fetchByIds<any>(
        (chunk) => supabase.from("vendedores").select("id, nombre").in("id", chunk),
        billeteraIds
      )
      for (const v of vend) nombreCuenta.set(`BILLETERA:${v.id}`, `Billetera ${v.nombre}`)
    }
    const cuenta = (tipo?: string | null, id?: string | null) => {
      if (!tipo) return ""
      if (tipo === "EN_CARTERA") return "Cartera de cheques"
      if (tipo === "EXTERNO") return "Externo"
      if (tipo === "GASTO") return "Gasto"
      if (!id) return cap(tipo.toLowerCase())
      return nombreCuenta.get(`${tipo}:${id}`) ?? cap(tipo.toLowerCase())
    }

    // ── Enriquecimiento por lotes: clientes, proveedores, cheques, OPs ──
    const clienteIds = [
      ...new Set(kardex.map((k) => k.cliente_id).filter(Boolean) as string[]),
    ]
    const proveedorIds = [
      ...new Set(
        kardex
          .flatMap((k) => [
            k.origen_tipo === "PROVEEDOR" ? k.origen_id : null,
            k.destino_tipo === "PROVEEDOR" ? k.destino_id : null,
          ])
          .filter(Boolean) as string[]
      ),
    ]
    const chequeIds = [...new Set(kardex.map((k) => k.cheque_id).filter(Boolean) as string[])]
    const opIds = [
      ...new Set(
        kardex
          .filter((k) => k.referencia_tipo === "orden_pago" && k.referencia_id)
          .map((k) => k.referencia_id as string)
      ),
    ]
    const cobradorIds = [
      ...new Set(rendiciones.map((r: any) => r.cobrador_id).filter(Boolean) as string[]),
    ]

    const [clientesArr, proveedoresArr, chequesArr, opsArr, vendedoresArr, profilesArr] =
      await Promise.all([
        clienteIds.length
          ? fetchByIds<any>((c) => supabase.from("clientes").select("id, nombre").in("id", c), clienteIds)
          : [],
        proveedorIds.length
          ? fetchByIds<any>((c) => supabase.from("proveedores").select("id, nombre").in("id", c), proveedorIds)
          : [],
        chequeIds.length
          ? fetchByIds<any>(
              (c) =>
                supabase
                  .from("cheques")
                  .select("id, banco, numero, monto, fecha_vencimiento, es_echeq")
                  .in("id", c),
              chequeIds
            )
          : [],
        opIds.length
          ? fetchByIds<any>(
              (c) => supabase.from("ordenes_pago").select("id, numero_op, proveedor_id").in("id", c),
              opIds
            )
          : [],
        cobradorIds.length
          ? fetchByIds<any>((c) => supabase.from("vendedores").select("id, nombre").in("id", c), cobradorIds)
          : [],
        cobradorIds.length
          ? fetchByIds<any>((c) => supabase.from("profiles").select("id, nombre").in("id", c), cobradorIds)
          : [],
      ])

    const clienteNombre = new Map(clientesArr.map((c) => [c.id, c.nombre]))
    const proveedorNombre = new Map(proveedoresArr.map((p) => [p.id, p.nombre]))
    const chequeDe = new Map(chequesArr.map((c) => [c.id, c]))
    const opDe = new Map(opsArr.map((o) => [o.id, o]))
    const cobradorNombre = new Map<string, string>()
    for (const v of vendedoresArr) cobradorNombre.set(v.id, v.nombre)
    for (const p of profilesArr) cobradorNombre.set(p.id, p.nombre)

    // Caja chica: referencia del arqueo diario
    const cajaChica = cajas.find((c) => c.nombre?.toLowerCase().includes("chica")) || null
    const saldoCajaChica = cajaChica
      ? saldos
          .filter((s) => s.cuenta_tipo === "CAJA" && s.cuenta_id === cajaChica.id && s.color === "BLANCO")
          .reduce((acc, s) => acc + num(s.saldo), 0)
      : 0

    // ── 1) Filas desde kardex ──
    const filas: FilaCaja[] = []
    for (const k of kardex) {
      const monto = Math.abs(num(k.monto))
      const cheque = k.cheque_id ? chequeDe.get(k.cheque_id) : null
      const chequeTxt = cheque
        ? `${cheque.es_echeq ? "⚡ Echeq" : "📄 Cheque"} ${cheque.banco} ${cheque.numero} · venc ${cheque.fecha_vencimiento?.split("-").reverse().join("/") ?? "—"}`
        : null
      const esDeCajaChica = cajaChica && k.origen_tipo === "CAJA" && k.origen_id === cajaChica.id
      const haciaCajaChica = cajaChica && k.destino_tipo === "CAJA" && k.destino_id === cajaChica.id

      const base: FilaCaja = {
        id: `k-${k.id}`,
        fuente: "kardex",
        categoria: "interno",
        hora: k.created_at ?? k.fecha,
        quien: k.concepto || cap((k.tipo_movimiento || "").replaceAll("_", " ").toLowerCase()),
        sub: "",
        medio: "",
        entrada: null,
        salida: null,
        neutro: null,
        estado: { tipo: "ok", texto: "✓ Registrado" },
        cliente_id: k.cliente_id,
        pago_id: k.pago_id,
      }

      switch (k.tipo_movimiento) {
        case "COBRO_CLIENTE": {
          const esTransf = k.metodo === "TRANSFERENCIA"
          const esEcheq = !!cheque?.es_echeq
          const esCheque = k.metodo === "CHEQUE_TERCERO" || k.metodo === "CHEQUE_PROPIO"
          base.categoria = esEcheq ? "echeq" : esTransf ? "transferencia" : "cobro"
          base.quien = (k.cliente_id && clienteNombre.get(k.cliente_id)) || k.concepto || "Cobro"
          base.sub = "Cobro"
          base.medio = esTransf
            ? `🏦 Transferencia → ${cuenta(k.destino_tipo, k.destino_id)}`
            : esCheque
              ? (chequeTxt ?? "📄 Cheque")
              : `💵 Efectivo → ${cuenta(k.destino_tipo, k.destino_id)}`
          base.entrada = monto
          base.estado = k.verificado
            ? { tipo: "ok", texto: "✓ Asentado" }
            : { tipo: "info", texto: "En caja · se imputa al cierre" }
          break
        }
        case "RENDICION_VIAJE": {
          base.categoria = "rendicion"
          base.quien = k.concepto || "Rendición"
          base.sub = "Rendición confirmada"
          base.medio = `💵 Efectivo → ${cuenta(k.destino_tipo, k.destino_id)}`
          base.entrada = monto
          base.estado = { tipo: "ok", texto: "✓ Rendición confirmada" }
          break
        }
        case "PAGO_PROVEEDOR": {
          const op = k.referencia_tipo === "orden_pago" ? opDe.get(k.referencia_id) : null
          const provId = k.destino_tipo === "PROVEEDOR" ? k.destino_id : op?.proveedor_id
          base.categoria = "proveedor"
          base.quien = (provId && proveedorNombre.get(provId)) || k.concepto || "Pago a proveedor"
          base.sub = op ? `Orden de pago ${op.numero_op}` : "Pago a proveedor"
          base.medio =
            k.metodo === "TRANSFERENCIA"
              ? `🏦 Transferencia desde ${cuenta(k.origen_tipo, k.origen_id)}`
              : k.metodo === "EFECTIVO"
                ? `💵 Efectivo de ${cuenta(k.origen_tipo, k.origen_id)}`
                : (chequeTxt ?? cap((k.metodo || "").replaceAll("_", " ").toLowerCase()))
          base.salida = monto
          base.estado = { tipo: "ok", texto: "OP confirmada" }
          base.orden_pago_id = op?.id ?? null
          break
        }
        case "TRANSFERENCIA_INTERNA": {
          base.categoria = "interno"
          base.quien = k.concepto || `A ${cuenta(k.destino_tipo, k.destino_id)}`
          base.sub = "Movimiento interno"
          base.medio = `${cuenta(k.origen_tipo, k.origen_id)} → ${cuenta(k.destino_tipo, k.destino_id)}`
          if (esDeCajaChica) base.salida = monto
          else if (haciaCajaChica) base.entrada = monto
          else base.neutro = monto
          base.estado = { tipo: "info", texto: "✓ Movido" }
          break
        }
        case "EGRESO_GENERAL":
        case "GASTO_BANCARIO": {
          base.categoria = "interno"
          base.quien = k.concepto || "Egreso"
          base.sub = k.tipo_movimiento === "GASTO_BANCARIO" ? "Gasto bancario" : "Egreso"
          base.medio = `💵 ${cuenta(k.origen_tipo, k.origen_id)}`
          base.salida = monto
          base.estado = { tipo: "info", texto: "✓ Registrado" }
          break
        }
        case "RETIRO_BILLETERA": {
          base.categoria = "interno"
          base.quien = k.concepto || "Retiro de billetera"
          base.sub = "Retiro"
          base.medio = `💵 ${cuenta(k.origen_tipo, k.origen_id)}`
          base.salida = monto
          base.estado = { tipo: "info", texto: "✓ Registrado" }
          break
        }
        case "DEPOSITO_CHEQUE":
        case "ACREDITACION_CHEQUE": {
          base.categoria = "interno"
          base.quien = k.concepto || (k.tipo_movimiento === "DEPOSITO_CHEQUE" ? "Depósito de cheque" : "Acreditación de cheque")
          base.sub = k.tipo_movimiento === "DEPOSITO_CHEQUE" ? "Cheque al banco" : "Cheque acreditado"
          base.medio = chequeTxt ?? `${cuenta(k.origen_tipo, k.origen_id)} → ${cuenta(k.destino_tipo, k.destino_id)}`
          base.neutro = monto
          base.estado = { tipo: "info", texto: k.tipo_movimiento === "DEPOSITO_CHEQUE" ? "✓ Depositado" : "✓ Acreditado" }
          break
        }
        case "ANULACION_COBRO": {
          base.categoria = "cobro"
          base.quien = (k.cliente_id && clienteNombre.get(k.cliente_id)) || k.concepto || "Anulación"
          base.sub = "Cobro anulado"
          base.medio = k.concepto || ""
          base.salida = monto
          base.estado = { tipo: "error", texto: "✗ Anulado" }
          break
        }
        case "DEBITO_CHEQUE_RECHAZADO": {
          base.categoria = "cobro"
          base.quien = (k.cliente_id && clienteNombre.get(k.cliente_id)) || k.concepto || "Cheque rechazado"
          base.sub = "Cheque rechazado · vuelve a la deuda del cliente"
          base.medio = chequeTxt ?? ""
          base.salida = monto
          base.estado = { tipo: "error", texto: "✗ Rechazado" }
          break
        }
        case "AJUSTE_CAJA": {
          base.categoria = "interno"
          base.quien = k.concepto || "Ajuste de caja"
          base.sub = "Ajuste auditado"
          base.medio = `${cuenta(k.destino_tipo ?? k.origen_tipo, k.destino_id ?? k.origen_id)}`
          if (num(k.monto) >= 0) base.entrada = monto
          else base.salida = monto
          base.estado = { tipo: "info", texto: "Ajuste" }
          break
        }
        default: {
          base.neutro = monto
          base.medio = `${cuenta(k.origen_tipo, k.origen_id)} → ${cuenta(k.destino_tipo, k.destino_id)}`
        }
      }
      filas.push(base)
    }

    // ── 2) Filas desde pagos pendientes ──
    // Los pagos dentro de una rendición abierta viajan con su rendición (no se duplican).
    const pagosEnRendicion = new Set(
      rendiciones.flatMap((r: any) => (r.rendicion_items || []).map((i: any) => i.pago_id))
    )
    const pendPanel = { echeqs: 0, transferencias: 0 }
    const filasPend: FilaCaja[] = []
    const filasPendAnteriores: FilaCaja[] = []

    for (const p of pendientes as any[]) {
      if (pagosEnRendicion.has(p.id)) continue
      const detalles: any[] = p.pagos_detalle || []
      const esEcheq = (d: any) => d.tipo_pago === "cheque" && d.color_cheque === "ECHEQ"
      // De un pago en la calle solo mostramos lo que ya viaja por canales digitales;
      // el efectivo y los cheques físicos llegan con la rendición.
      const relevantes =
        p.estado === "pendiente_rendicion"
          ? detalles.filter((d) => d.tipo_pago === "transferencia" || d.tipo_pago === "deposito" || esEcheq(d))
          : detalles
      if (!relevantes.length) continue

      const montoRelevante = relevantes.reduce((s, d) => s + num(d.monto), 0)
      const tieneEcheq = relevantes.some(esEcheq)
      const tieneTransf = relevantes.some((d) => d.tipo_pago === "transferencia" || d.tipo_pago === "deposito")
      const tieneCheque = relevantes.some((d) => d.tipo_pago === "cheque" && !esEcheq(d))
      if (tieneEcheq) pendPanel.echeqs++
      if (tieneTransf) pendPanel.transferencias++

      const partes = relevantes.map((d) => {
        if (d.tipo_pago === "transferencia")
          return `🏦 Transferencia${d.banco ? ` → ${d.banco}` : ""}${d.numero_comprobante_pago || d.referencia ? ` · op. ${d.numero_comprobante_pago || d.referencia}` : ""}`
        if (d.tipo_pago === "deposito") return `🏧 Depósito${d.banco ? ` → ${d.banco}` : ""}`
        if (esEcheq(d))
          return `⚡ Echeq${d.banco ? ` · ${d.banco}` : ""}${d.numero_cheque ? ` ${d.numero_cheque}` : ""}${d.fecha_cheque ? ` · vence ${d.fecha_cheque.split("-").reverse().join("/")}` : ""}`
        if (d.tipo_pago === "cheque")
          return `📄 Cheque${d.banco ? ` ${d.banco}` : ""}${d.numero_cheque ? ` ${d.numero_cheque}` : ""}`
        return `💵 Efectivo`
      })

      const origen =
        p.cobrador_tipo && p.cobrador_tipo !== "oficina"
          ? `cargó ${p.cobrador_tipo}`
          : "Cobro en oficina"
      const fila: FilaCaja = {
        id: `p-${p.id}`,
        fuente: "pago",
        categoria: tieneEcheq ? "echeq" : tieneTransf ? "transferencia" : "cobro",
        hora: p.created_at,
        quien: p.clientes?.nombre ?? "Cliente",
        sub: origen,
        medio: partes.join("  +  "),
        entrada: montoRelevante,
        salida: null,
        neutro: null,
        estado: {
          tipo: "accion",
          texto: tieneEcheq ? "Aceptar echeq" : tieneTransf ? "Confirmar" : tieneCheque ? "Confirmar cheque" : "En caja · se imputa al cierre",
        },
        cliente_id: p.cliente_id,
        pago_id: p.id,
      }
      if (p.fecha_pago === fecha) filasPend.push(fila)
      else if (p.fecha_pago < fecha) filasPendAnteriores.push(fila)
    }

    // ── 3) Rendiciones abiertas: "Esperando la plata" ──
    // Lo físico declarado = efectivo + cheques papel de sus pagos.
    const pagosRendIds = [...pagosEnRendicion] as string[]
    const detallesRend = pagosRendIds.length
      ? await fetchByIds<any>(
          (chunk) =>
            supabase
              .from("pagos_detalle")
              .select("pago_id, tipo_pago, monto, color_cheque")
              .in("pago_id", chunk),
          pagosRendIds
        )
      : []
    const fisicoPorPago = new Map<string, { cheques: number; cantCheques: number }>()
    for (const d of detallesRend) {
      if (d.tipo_pago === "cheque" && d.color_cheque !== "ECHEQ") {
        const f = fisicoPorPago.get(d.pago_id) ?? { cheques: 0, cantCheques: 0 }
        f.cheques += num(d.monto)
        f.cantCheques++
        fisicoPorPago.set(d.pago_id, f)
      }
    }

    const filasRend: FilaCaja[] = rendiciones.map((r: any) => {
      const items: any[] = r.rendicion_items || []
      let cheques = 0
      let cantCheques = 0
      for (const i of items) {
        const f = fisicoPorPago.get(i.pago_id)
        if (f) {
          cheques += f.cheques
          cantCheques += f.cantCheques
        }
      }
      const efectivo = num(r.efectivo_declarado)
      const partes: string[] = []
      if (efectivo) partes.push(`💵 ${efectivo.toLocaleString("es-AR")} efectivo`)
      if (cantCheques) partes.push(`📄 ${cantCheques} cheque${cantCheques > 1 ? "s" : ""} físico${cantCheques > 1 ? "s" : ""} ($ ${cheques.toLocaleString("es-AR")})`)
      return {
        id: `r-${r.id}`,
        fuente: "rendicion",
        categoria: "rendicion",
        hora: r.created_at ?? r.fecha,
        quien: `RENDICIÓN · ${cobradorNombre.get(r.cobrador_id) ?? "cobrador"}`,
        sub: `${r.cobrador_tipo} · ${items.length} pago${items.length !== 1 ? "s" : ""} declarados`,
        medio: partes.join("  +  ") || "Sin plata física declarada",
        entrada: null,
        salida: null,
        neutro: efectivo + cheques,
        estado: { tipo: "esperando", texto: "⏳ Esperando la plata" },
        rendicion_id: r.id,
      }
    })

    // ── Armado final ──
    const delDia = [...filas, ...filasPend].sort((a, b) => (a.hora ?? "").localeCompare(b.hora ?? ""))
    const totales = {
      entrada: delDia.reduce((s, f) => s + num(f.entrada), 0),
      salida: delDia.reduce((s, f) => s + num(f.salida), 0),
    }

    return NextResponse.json({
      fecha,
      filas: delDia,
      pendientes_anteriores: filasPendAnteriores.sort((a, b) => (a.hora ?? "").localeCompare(b.hora ?? "")),
      rendiciones_abiertas: filasRend,
      totales,
      arqueo: {
        caja_chica_id: cajaChica?.id ?? null,
        caja_chica_nombre: cajaChica?.nombre ?? null,
        efectivo_esperado: saldoCajaChica,
      },
      panel_pendientes: {
        echeqs_por_aceptar: pendPanel.echeqs,
        transferencias_por_confirmar: pendPanel.transferencias,
        rendiciones_en_camino: filasRend.length,
      },
    })
  } catch (error: any) {
    console.error("[caja] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
