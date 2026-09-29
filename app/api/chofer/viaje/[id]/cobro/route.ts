import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { marcaAjuste } from "@/lib/cobranzas/ajuste"
import { baseTopeAjuste, cierreDeParadaPorCobro, normalizarAnticipos, pedidosContadoValidos, resolverAjuste } from "@/lib/cobranzas/reglas-cobro"
import { armarHojaRuta } from "@/lib/viajes/hoja-ruta"
import { MARCA_CONTADO } from "@/lib/constants"
import { esTripulante } from "@/lib/viajes/chofer"
import { todayArgentina, nowArgentina } from "@/lib/utils"
import { colorOverride, derivarColorCheque, COLOR_PENDIENTE } from "@/lib/actions/color-cheque"
import { crearCobranza, recortarImputaciones, type DetalleInput } from "@/lib/cobranzas/crear"
import { ErrorReglaCobranza, mensajeParaUsuario } from "@/lib/cobranzas/errores"
import { controlarContadoDuplicado } from "@/lib/cobranzas/contado-duplicado"
import { valorarDevoluciones } from "@/lib/cobranzas/valorar-devoluciones"

// POST /api/chofer/viaje/[id]/cobro
// Registra un cobro del chofer con estado='pendiente_rendicion'.
// Crea imputaciones en estado='pendiente' - se confirman al aprobar la rendición.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id: viajeId } = await params
    const body = await request.json()

    const {
      cliente_id,
      monto_total,
      metodos,          // [{ tipo, monto, ...campos específicos }]
      imputaciones,     // [{ comprobante_id, monto_imputado }]
      devolucion_ids,   // [uuid] devolucion pendiente a acreditar en rendición
      observaciones,
      comprobante_urls, // [{url, nombre}] fotos de comprobantes
      cobros_extra,     // [{ cliente_id, monto, metodos, imputaciones }] otros clientes en la misma cobranza
      pedidos_contado,  // string[] pedidos sin facturar anticipados con 10% contado
      pedidos_anticipo, // [{ pedido_id, monto }] anticipos a pedidos sin facturar SELECCIONADOS (clientes nuevos)
      contado_general,  // bool: 10% contado sobre los comprobantes saldados (NC al confirmar)
      ajuste_redondeo,  // número con signo: +falta (crédito, tope 1%) / −sobra (débito, nunca rebota)
      idempotency_key,  // uuid del front: reintentos/doble tap devuelven el MISMO pago
    } = body

    if (!cliente_id || !monto_total || !metodos?.length) {
      return NextResponse.json(
        { error: "cliente_id, monto_total y metodos son requeridos" },
        { status: 400 }
      )
    }

    // Verificar que el viaje es del chofer y está en_viaje
    const { data: viaje } = await supabase
      .from("viajes")
      .select("id, chofer_id, estado")
      .eq("id", viajeId)
      .single()

    if (!viaje || !(await esTripulante(supabase, viajeId, auth.user.id, viaje.chofer_id))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }
    // Fase C: el chofer puede registrar/corregir cobros también durante
    // 'en_rendicion' (hasta que oficina confirme la rendición).
    if (!["despachado", "en_curso", "en_rendicion"].includes(viaje.estado)) {
      return NextResponse.json({ error: "El viaje no está activo" }, { status: 400 })
    }

    // ── Armar detalles por método ──
    // Color de cheques: derivado de las imputaciones del cobro (>50% a PRES ⇒
    // NEGRO, sino BLANCO); override manual si vino explícito; sin imputaciones
    // ⇒ PENDIENTE (oficina asigna al confirmar la rendición).
    const colorCobro = (await derivarColorCheque(supabase, imputaciones)) || COLOR_PENDIENTE
    const detalles: DetalleInput[] = (metodos as any[]).map((metodo: any) => {
      const colorMetodo = colorOverride(metodo.color_cheque) || colorCobro
      return {
        tipo_pago: metodo.tipo,
        monto: Number(metodo.monto),
        caja_id: metodo.tipo === "efectivo" ? metodo.caja_id || null : null,
        cuenta_bancaria_id: metodo.tipo === "transferencia" ? metodo.cuenta_bancaria_id || null : null,
        fecha_transferencia: metodo.tipo === "transferencia" ? metodo.fecha_transferencia || null : null,
        numero_comprobante_pago: metodo.tipo === "transferencia" ? metodo.numero_comprobante || null : null,
        banco: metodo.tipo === "cheque" ? metodo.banco_emisor || null : null,
        numero_cheque: metodo.tipo === "cheque" ? metodo.numero_cheque || null : null,
        fecha_cheque: metodo.tipo === "cheque" ? metodo.fecha_cheque || null : null,
        cuit_emisor: metodo.tipo === "cheque" ? metodo.cuit_emisor || null : null,
        color_cheque: metodo.tipo === "cheque" ? colorMetodo : null,
        cheque: metodo.tipo === "cheque"
          ? {
              banco: metodo.banco_emisor || "",
              numero: metodo.numero_cheque || "",
              fecha_emision: metodo.fecha_emision || null,
              fecha_vencimiento: metodo.fecha_cheque || todayArgentina(),
              monto: Number(metodo.monto),
              color: colorMetodo,
              es_echeq: metodo.color_cheque === "ECHEQ" || Boolean(metodo.es_echeq),
            }
          : null,
      }
    })

    // ── Alta transaccional del pago (pendiente_rendicion) ──
    // Σ imputaciones se recorta al monto: el excedente queda como saldo del
    // comprobante hasta que lo cubra la NC (devolución/10%) o un pago futuro.
    const impsCompletas = ((imputaciones as any[]) || [])
      .filter((i: any) => i?.comprobante_id)
      .map((i: any) => ({ comprobante_id: i.comprobante_id, monto_imputado: Number(i.monto_imputado) }))

    // Ajuste por redondeo (lib/cobranzas/reglas-cobro.ts). Viaja como marca y se asienta al
    // confirmar la rendición.
    //  · Tope 1 % SOLO para el ajuste en contra (perdonar saldo): más que eso → oficina.
    //  · El sobrante nunca rebota: chico ⇒ ajuste a favor; grande ⇒ queda a cuenta + aviso.
    //  · Base = todo lo seleccionado: comprobantes + anticipos a pedidos sin facturar (que no
    //    viajan como imputaciones: con solo pedidos seleccionados la base daba $0).
    const anticipos = normalizarAnticipos(pedidos_anticipo)
    const ajusteResuelto = resolverAjuste(
      Number(ajuste_redondeo || 0),
      baseTopeAjuste({
        imputado: impsCompletas.reduce((x, i) => x + (Number(i.monto_imputado) || 0), 0),
        anticipos: (anticipos || []).reduce((x, a) => x + a.monto, 0),
        montoTotal: Number(monto_total),
        ajuste: Number(ajuste_redondeo || 0),
      }),
    )
    if (ajusteResuelto.rechazo) {
      return NextResponse.json({ error: ajusteResuelto.rechazo, mensaje: ajusteResuelto.rechazo, codigo: "regla_negocio", reintentable: false }, { status: 422 })
    }
    const montoAjuste = ajusteResuelto.ajuste
    const conContado = Boolean(contado_general)
    // Un comprobante jamás recibe el 10 % dos veces: si TODOS los seleccionados ya lo tienen,
    // rechazo definitivo (422: la app no lo reintenta); si algunos, se registra y se avisa.
    let avisoContado: string | null = null
    if (conContado) {
      const ctl = await controlarContadoDuplicado(supabase, cliente_id, impsCompletas.map((i) => i.comprobante_id))
      if (ctl.rechazo) return NextResponse.json({ error: ctl.rechazo, mensaje: ctl.rechazo, codigo: "regla_negocio", reintentable: false }, { status: 422 })
      avisoContado = ctl.aviso
    }
    const obsPago = [observaciones, conContado ? MARCA_CONTADO : "", marcaAjuste(montoAjuste)].filter(Boolean).join(" · ") || null

    // Con 10% contado el recorte es proporcional (cada comprobante recibe su
    // 90%; la NC del 10% lo salda al confirmar). Sin contado, secuencial.
    const impsRecortadas = recortarImputaciones(impsCompletas, Number(monto_total), conContado ? "proporcional" : "secuencial")

    // ── Devoluciones descontadas en este cobro: validar y VALUAR con la regla
    // única (precio de factura, neto del 10% si la factura fue contado).
    // Antes `devolucion_ids` se descartaba: el descuento no quedaba asentado
    // y la misma devolución podía descontarse dos veces (chofer y vendedor).
    const devolucionesADescontar: Array<{ devolucion_id: string; monto: number }> = []
    if (Array.isArray(devolucion_ids) && devolucion_ids.length) {
      const devIds = [...new Set(devolucion_ids as string[])]
      const [{ data: devs }, { data: usados }, valores] = await Promise.all([
        supabase.from("devoluciones").select("id, cliente_id, estado, monto_total").in("id", devIds),
        supabase.from("devoluciones_descuentos").select("devolucion_id, monto").in("devolucion_id", devIds),
        valorarDevoluciones(supabase, { clienteId: cliente_id, devolucionIds: devIds }),
      ])
      const devMap = new Map((devs || []).map((d: any) => [d.id, d]))
      const usadoPorDev = new Map<string, number>()
      for (const u of usados || [])
        usadoPorDev.set(u.devolucion_id, (usadoPorDev.get(u.devolucion_id) || 0) + Number(u.monto))
      for (const devId of devIds) {
        const dev = devMap.get(devId)
        if (!dev) return NextResponse.json({ error: "Devolución inexistente" }, { status: 400 })
        if (dev.cliente_id !== cliente_id)
          return NextResponse.json({ error: "La devolución no es de este cliente" }, { status: 400 })
        if (dev.estado !== "pendiente")
          return NextResponse.json({ error: "La devolución ya fue procesada por la oficina" }, { status: 400 })
        const valorTotal = valores.get(devId)?.total ?? (Number(dev.monto_total) || 0)
        const restante = Math.round((valorTotal - (usadoPorDev.get(devId) || 0)) * 100) / 100
        if (restante <= 0.01)
          return NextResponse.json({ error: "La devolución ya fue descontada en otro cobro" }, { status: 400 })
        devolucionesADescontar.push({ devolucion_id: devId, monto: restante })
      }
    }

    const { pago_id, dedup } = await crearCobranza(supabase, {
      idempotency_key: idempotency_key || null,
      cliente_id,
      vendedor_id: null, // chofer = usuario (profiles), no vendedor; se traza por creado_por/viaje
      viaje_id: viajeId,
      cobrador_tipo: "chofer",
      monto: Number(monto_total),
      fecha_pago: todayArgentina(),
      observaciones: obsPago,
      estado: "pendiente_rendicion",
      creado_por: auth.user.id,
      detalles,
      imputaciones: impsRecortadas,
    })
    const pago = { id: pago_id }

    if (dedup) {
      return NextResponse.json({
        success: true,
        pago_id,
        estado: "pendiente_rendicion",
        dedup: true,
        mensaje: "Cobro ya registrado (reintento detectado).",
      })
    }

    // Asentar el vínculo devolución ↔ cobro (anti doble uso; se libera al
    // anular el cobro — lib/actions/cobranzas.ts)
    if (devolucionesADescontar.length) {
      const { error: devErr } = await supabase.from("devoluciones_descuentos").insert(
        devolucionesADescontar.map((d) => ({ devolucion_id: d.devolucion_id, pago_id: pago.id, monto: d.monto })),
      )
      if (devErr) console.error("[chofer/cobro] devoluciones_descuentos:", devErr.message)
    }

    // Marcar pedidos anticipados con 10% contado (NC automática al facturar): SOLO los
    // seleccionados en este cobro y del cliente del cobro — nunca toda la lista.
    const pedidosContado = pedidosContadoValidos(pedidos_contado, anticipos)
    if (pedidosContado.length) {
      await supabase
        .from("pedidos")
        .update({ pago_contado_10: true, anticipo_pago_id: pago.id })
        .in("id", pedidosContado)
        .eq("cliente_id", cliente_id)
    }

    // Fotos de comprobantes (cheque/transferencia) cargadas por el chofer
    if (Array.isArray(comprobante_urls) && comprobante_urls.length) {
      const fotos = comprobante_urls
        .filter((c: any) => c?.url)
        .map((c: any) => ({ pago_id: pago.id, url: c.url, nombre: c.nombre || null }))
      if (fotos.length) {
        const { error: fErr } = await supabase.from("pago_comprobantes").insert(fotos)
        if (fErr) console.error("[chofer/cobro] guardar fotos:", fErr.message)
      }
    }

    // ── Clientes adicionales en la misma cobranza (cobro conjunto en la calle) ──
    if (Array.isArray(cobros_extra) && cobros_extra.length) {
      for (let exIdx = 0; exIdx < cobros_extra.length; exIdx++) {
        const ex = cobros_extra[exIdx]
        if (!ex?.cliente_id || !ex?.metodos?.length) continue
        const montoEx = ex.metodos.reduce((s: number, m: any) => s + Number(m.monto), 0)
        const colorEx = (await derivarColorCheque(supabase, ex.imputaciones)) || COLOR_PENDIENTE

        const detallesEx: DetalleInput[] = (ex.metodos as any[]).map((m: any) => {
          const colorMetodoEx = colorOverride(m.color_cheque) || colorEx
          return {
            tipo_pago: m.tipo,
            monto: Number(m.monto),
            caja_id: m.caja_id || null,
            cuenta_bancaria_id: m.cuenta_bancaria_id || null,
            fecha_transferencia: m.fecha_transferencia || null,
            numero_comprobante_pago: m.numero_comprobante || null,
            banco: m.banco_emisor || null,
            numero_cheque: m.numero_cheque || null,
            fecha_cheque: m.fecha_cheque || null,
            cuit_emisor: m.cuit_emisor || null,
            color_cheque: m.tipo === "cheque" ? colorMetodoEx : null,
            cheque: m.tipo === "cheque"
              ? {
                  banco: m.banco_emisor || "",
                  numero: m.numero_cheque || "",
                  fecha_emision: m.fecha_emision || null,
                  fecha_vencimiento: m.fecha_cheque || todayArgentina(),
                  monto: Number(m.monto),
                  color: colorMetodoEx,
                  es_echeq: m.color_cheque === "ECHEQ" || Boolean(m.es_echeq),
                }
              : null,
          }
        })

        try {
          await crearCobranza(supabase, {
            // Clave derivada del submit para el cobro extra N: se pisa el nibble
            // de versión (pos 14) con 'e' — un uuid v4 del front jamás colisiona —
            // y los últimos 2 dígitos con el índice. Reintentos no duplican extras.
            idempotency_key: idempotency_key
              ? idempotency_key.slice(0, 14) + "e" + idempotency_key.slice(15, 34) + String(10 + exIdx)
              : null,
            cliente_id: ex.cliente_id,
            vendedor_id: null,
            viaje_id: viajeId,
            cobrador_tipo: "chofer",
            monto: montoEx,
            fecha_pago: todayArgentina(),
            observaciones: observaciones || null,
            estado: "pendiente_rendicion",
            creado_por: auth.user.id,
            detalles: detallesEx,
            imputaciones: recortarImputaciones(
              ((ex.imputaciones as any[]) || [])
                .filter((i: any) => i?.comprobante_id)
                .map((i: any) => ({ comprobante_id: i.comprobante_id, monto_imputado: Number(i.monto_imputado) })),
              montoEx,
            ),
          })
        } catch (exErr: any) {
          console.error("[chofer/cobro] cobro extra falló:", ex.cliente_id, exErr?.message)
        }
      }
    }

    // Registrar en billetera del chofer
    await supabase.from("billetera_movimientos").insert({
      viajante_id: viaje.chofer_id, // titular: el acompañante cobra contra su billetera
      tipo: "cobro_cliente",
      medio:
        metodos[0]?.tipo === "efectivo"
          ? "efectivo"
          : metodos[0]?.tipo === "cheque"
          ? "cheque"
          : "transferencia",
      monto: monto_total,
      concepto: `Cobro cliente`,
      referencia_id: viajeId,
      referencia_tipo: "viaje",
      creado_por: auth.user.id,
      fecha: nowArgentina(),
    })

    // ── Cobrar CIERRA la parada (lib/cobranzas/reglas-cobro.ts) ──
    // Si la parada del cliente estaba pendiente queda "entregado" (o "solo cobro" si no llevaba
    // mercadería). Nunca pisa un resultado ya cargado y nunca hace fallar el cobro: la plata ya
    // está registrada; si esto falla la parada queda en "Visitados · falta cerrar la parada".
    let paradaCerrada: string | null = null
    if (["despachado", "en_curso"].includes(viaje.estado)) {
      try {
        const { data: fila } = await supabase
          .from("viajes_paradas")
          .select("id, estado")
          .eq("viaje_id", viajeId)
          .eq("cliente_id", cliente_id)
          .maybeSingle()
        if (fila?.estado === "pendiente") {
          const hoja = await armarHojaRuta(supabase, viajeId)
          const par = hoja?.paradas.find((p) => p.id === fila.id)
          const cierre = par
            ? cierreDeParadaPorCobro({ estado: par.estado, bultos: par.bultos, tienePedidos: par.pedidos.length > 0, minimoExigido: par.minimo_exigido, cobrado: par.cobrado })
            : null
          if (cierre) {
            const { error: cierreErr } = await supabase
              .from("viajes_paradas")
              .update({
                estado: cierre.estado,
                bultos_entregados: cierre.bultos_entregados,
                motivo_no_entrega: null,
                motivo_no_cobro: cierre.motivo_no_cobro,
                resuelto_at: new Date().toISOString(),
                resuelto_por: auth.user.id,
              })
              .eq("id", fila.id)
              .eq("viaje_id", viajeId)
              .eq("estado", "pendiente")
            if (cierreErr) throw cierreErr
            paradaCerrada = cierre.estado
          }
        }
      } catch (cierreError: any) {
        console.error("[chofer/cobro] no se pudo cerrar la parada:", cierreError?.message)
      }
    }

    return NextResponse.json({
      success: true,
      pago_id: pago.id,
      estado: "pendiente_rendicion",
      mensaje: "Cobro registrado. Se imputará al confirmar la rendición del viaje.",
      aviso_contado: avisoContado,
      aviso_ajuste: ajusteResuelto.aviso,
      parada_cerrada: paradaCerrada,
    })
  } catch (error: any) {
    console.error("[chofer] Error en POST cobro:", error)
    // Rechazo por REGLA DE NEGOCIO de la RPC (comprobante anulado, no es del cliente…):
    // respuesta DEFINITIVA. 422 y no 500 para que la app Chofer (que encola los cobros
    // hechos sin señal) no lo reintente para siempre ni trabe lo que viene detrás.
    // La web muestra `error` igual que antes.
    if (error instanceof ErrorReglaCobranza) {
      return NextResponse.json(
        { error: error.message, mensaje: mensajeParaUsuario(error), codigo: error.codigo, reintentable: false },
        { status: 422 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
