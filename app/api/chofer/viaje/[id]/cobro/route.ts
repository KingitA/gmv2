import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { marcaAjuste } from "@/lib/cobranzas/ajuste"
import { baseTopeAjuste, cierreDeParadaPorCobro, normalizarAnticipos, pedidosContadoValidos, resolverAjuste } from "@/lib/cobranzas/reglas-cobro"
import { armarHojaRuta } from "@/lib/viajes/hoja-ruta"
import { asentarCobroEnBilletera } from "@/lib/cobranzas/billetera-chofer"
import { MARCA_CONTADO } from "@/lib/constants"
import { esTripulante } from "@/lib/viajes/chofer"
import { todayArgentina, nowArgentina } from "@/lib/utils"
import { colorOverride, derivarColorCheque, COLOR_PENDIENTE } from "@/lib/actions/color-cheque"
import { crearCobranza, recortarImputaciones, type DetalleInput } from "@/lib/cobranzas/crear"
import { ErrorReglaCobranza, mensajeParaUsuario } from "@/lib/cobranzas/errores"
import { controlarContadoDuplicado } from "@/lib/cobranzas/contado-duplicado"
import { claveDelCliente, montoDelPrincipal, repartirMetodos, validarCobroConjunto } from "@/lib/cobranzas/cobro-conjunto"
import { anularCobranza } from "@/lib/actions/cobranzas"
import type { User } from "@supabase/supabase-js"

// POST /api/chofer/viaje/[id]/cobro
// Registra un cobro del chofer con estado='pendiente_rendicion'.
// Crea imputaciones en estado='pendiente' - se confirman al aprobar la rendición.
//
// Con `clientes_extra` es un COBRO CONJUNTO (lib/cobranzas/cobro-conjunto.ts): los mismos medios
// de pago cubren a varios clientes; cada cliente lleva su propia selección (comprobantes, pedidos,
// 10 %, devoluciones) y queda UN pago por cliente bajo una cabecera `cobranzas`.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { id: viajeId } = await params
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 })
  }
  if (Array.isArray(body?.clientes_extra) && body.clientes_extra.length) return cobrarConjunto(auth.user, viajeId, body)
  return cobrarUno(auth.user, viajeId, body)
}

/** Opciones internas del cobro conjunto (no vienen del cliente HTTP). */
interface OpcionesInternas {
  /** Cabecera que agrupa los pagos del cobro conjunto */
  cobranzaId?: string | null
  /** Cliente agregado: su parada NO se cierra (el chofer no estuvo ahí) */
  esClienteAgregado?: boolean
}

// ─── Cobro conjunto ──────────────────────────────────────────────────────────
// Los clientes agregados se registran PRIMERO y el principal al final: así la parada (que cierra
// el pago del principal) solo se cierra cuando todo lo demás ya entró. Si uno falla, los pagos
// ya creados en este envío se anulan (reversa completa) y se devuelve el error: nunca queda medio
// cheque registrado.
async function cobrarConjunto(user: User, viajeId: string, body: any) {
  const extras: any[] = body.clientes_extra
  const total = Number(body.monto_total)
  const motivo = validarCobroConjunto(String(body.cliente_id || ""), total, extras.map((e) => ({ cliente_id: String(e?.cliente_id || ""), monto: Number(e?.monto) })))
  if (motivo) return NextResponse.json({ error: motivo, mensaje: motivo, codigo: "regla_negocio", reintentable: false }, { status: 422 })

  const montos = [montoDelPrincipal(total, extras.map((e) => Number(e.monto))), ...extras.map((e) => Number(e.monto))]
  let reparto: any[][]
  try {
    reparto = repartirMetodos(body.metodos || [], montos)
  } catch (e: any) {
    return NextResponse.json({ error: e.message, mensaje: e.message, codigo: "regla_negocio", reintentable: false }, { status: 422 })
  }

  const supabase = await createClient()
  const claves = montos.map((_, i) => claveDelCliente(body.idempotency_key, i))

  // Cabecera: una por envío. En un reintento se reutiliza la del primer pago que ya exista.
  let cobranzaId: string | null = null
  const clavesValidas = claves.filter((k): k is string => !!k)
  if (clavesValidas.length) {
    const { data: previos } = await supabase.from("pagos_clientes").select("cobranza_id").in("idempotency_key", clavesValidas).not("cobranza_id", "is", null).limit(1)
    cobranzaId = previos?.[0]?.cobranza_id ?? null
  }
  if (!cobranzaId) {
    const { data: cab, error: cabErr } = await supabase
      .from("cobranzas")
      .insert({ fecha: todayArgentina(), estado: "pendiente", origen: "VIAJE", viaje_id: viajeId, cobrador_id: user.id, total, observaciones: body.observaciones || null, creado_por: user.id })
      .select("id")
      .single()
    if (cabErr) return NextResponse.json({ error: cabErr.message }, { status: 500 })
    cobranzaId = cab.id
  }

  const creados: string[] = []
  const pagos: Array<{ cliente_id: string; pago_id: string; monto: number; dedup?: boolean }> = []
  const avisos: string[] = []
  const deshacer = async () => {
    for (const pagoId of creados) {
      try {
        await anularCobranza(supabase, { pagoId, usuarioId: user.id, motivo: "Cobro conjunto incompleto: otro cliente del mismo envío fue rechazado" })
      } catch (e: any) {
        console.error("[chofer/cobro] no se pudo deshacer el pago", pagoId, e?.message)
      }
    }
  }

  // Agregados primero (índices 1..n), principal al final
  const orden = [...extras.map((_, i) => i + 1), 0]
  let respuestaPrincipal: any = null
  for (const i of orden) {
    const esPrincipal = i === 0
    const ex = esPrincipal ? null : extras[i - 1]
    const cuerpo = esPrincipal
      ? { ...body, monto_total: montos[0], metodos: reparto[0], clientes_extra: undefined, cobros_extra: undefined, idempotency_key: claves[0] }
      : {
          cliente_id: ex.cliente_id,
          monto_total: montos[i],
          metodos: reparto[i],
          imputaciones: ex.imputaciones || [],
          devolucion_ids: ex.devolucion_ids || [],
          pedidos_contado: ex.pedidos_contado || [],
          pedidos_anticipo: ex.pedidos_anticipo,
          contado_general: !!ex.contado_general,
          ajuste_redondeo: 0, // la diferencia del cobro es siempre del cliente principal
          observaciones: body.observaciones,
          comprobante_urls: [], // las fotos van con el pago del principal
          idempotency_key: claves[i],
        }
    const res = await cobrarUno(user, viajeId, cuerpo, { cobranzaId, esClienteAgregado: !esPrincipal })
    const datos: any = await res.json().catch(() => ({}))
    if (!res.ok || !datos.success) {
      await deshacer()
      const quien = esPrincipal ? "" : ` (cliente agregado ${i})`
      const texto = `${datos.mensaje || datos.error || "No se pudo registrar el cobro"}${quien}`
      return NextResponse.json({ ...datos, error: texto, mensaje: texto }, { status: res.status >= 400 ? res.status : 500 })
    }
    if (!datos.dedup) creados.push(datos.pago_id)
    pagos.push({ cliente_id: cuerpo.cliente_id, pago_id: datos.pago_id, monto: montos[i], ...(datos.dedup ? { dedup: true } : {}) })
    if (datos.aviso_contado) avisos.push(datos.aviso_contado)
    if (esPrincipal) respuestaPrincipal = datos
  }

  return NextResponse.json({
    ...respuestaPrincipal,
    cobranza_id: cobranzaId,
    pagos,
    aviso_contado: avisos.join(" ") || null,
    mensaje: `Cobro conjunto registrado: ${pagos.length} clientes. Se imputará al confirmar la rendición del viaje.`,
  })
}

// ─── Un cliente ──────────────────────────────────────────────────────────────
async function cobrarUno(user: User, viajeId: string, body: any, interno: OpcionesInternas = {}) {
  const auth = { user }
  try {
    const supabase = await createClient()

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

    const { pago_id, dedup } = await crearCobranza(supabase, {
      idempotency_key: idempotency_key || null,
      cliente_id,
      vendedor_id: null, // chofer = usuario (profiles), no vendedor; se traza por creado_por/viaje
      viaje_id: viajeId,
      cobranza_id: interno.cobranzaId ?? null,
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
          const extra = await crearCobranza(supabase, {
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
          // Billetera del titular: también la plata del cliente extra (la rendición la debita)
          if (!extra.dedup) {
            await asentarCobroEnBilletera(supabase, { titularId: viaje.chofer_id, pagoId: extra.pago_id, monto: montoEx, metodos: ex.metodos, usuarioId: auth.user.id, fecha: nowArgentina() })
          }
        } catch (exErr: any) {
          console.error("[chofer/cobro] cobro extra falló:", ex.cliente_id, exErr?.message)
        }
      }
    }

    // Billetera del chofer: referenciada AL PAGO, para que cobranza_anular la revierta al anular
    // (lib/cobranzas/billetera-chofer.ts). Antes iba referenciada al viaje y la anulación no la tocaba.
    await asentarCobroEnBilletera(supabase, { titularId: viaje.chofer_id, pagoId: pago.id, monto: Number(monto_total), metodos, usuarioId: auth.user.id, fecha: nowArgentina() })

    // ── Cobrar CIERRA la parada (lib/cobranzas/reglas-cobro.ts) ──
    // Si la parada del cliente estaba pendiente queda "entregado" (o "solo cobro" si no llevaba
    // mercadería). Nunca pisa un resultado ya cargado y nunca hace fallar el cobro: la plata ya
    // está registrada; si esto falla la parada queda en "Visitados · falta cerrar la parada".
    let paradaCerrada: string | null = null
    if (!interno.esClienteAgregado && ["despachado", "en_curso"].includes(viaje.estado)) {
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
