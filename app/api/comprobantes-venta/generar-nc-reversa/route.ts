import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { todayArgentina } from "@/lib/utils"
import { requirePermiso } from '@/lib/auth'
import { insertarKardex } from '@/lib/kardex/insertar-kardex'
import { determinarTipoNCADesdeOriginal, determinarTipoFactura, mensajeErrorCondicionIva } from "@/lib/comprobantes/tipo-comprobante"
import { REQUIERE_CAE, TIPO_CBTE_ARCA, DOC_TIPO, CONCEPTO, IVA_ID, TRIBUTO_ID, condicionIvaReceptorId, type AmbienteARCA } from "@/lib/arca/tipos"
import { obtenerTAConCache } from "@/lib/arca/cache"
import { ultimoAutorizado, solicitarCAE } from "@/lib/arca/wsfev1"
import { generarYSubirPDF, buildPDFData, generarQRBase64, buildQRUrl, buildSnapshot } from "@/lib/pdf/generar"
import { registrarCAEObtenido, marcarComprobanteCreado, marcarHuerfano, mensajeHuerfano } from "@/lib/arca/registro-cae"
import { postearLibroConAviso } from "@/lib/cuenta-corriente/postear-libro"
import { TASA_PERCEPCION_IVA_DEVOLUCION, valorDevolucionConOrigen } from "@/lib/cobranzas/valor-devolucion"
import { valorarDevoluciones } from "@/lib/cobranzas/valorar-devoluciones"
import { cuitDigitos, cuitValido, ahoraISO } from "@/lib/formato"

/** Corta la emisión con una respuesta de error (validaciones dentro de una parte). */
class Corte extends Error {
  constructor(public respuesta: NextResponse) { super("corte") }
}
const corte = (body: Record<string, any>, status: number) => new Corte(NextResponse.json(body, { status }))

const TIPOS_NC_FISCAL = ["NCA", "NCB", "NCC"]

export async function POST(request: Request) {
  try {
    const auth = await requirePermiso("emitir_comprobantes")
    if (auth.error) return auth.error
    const cookieStore = await cookies()
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
      },
    })

    const body = await request.json()
    const {
      devolucion_id,
      // El tipo lo decide el origen de cada renglón (regla del dueño 21/10/2026:
      // tal cual fue facturado). Se acepta el campo por compatibilidad.
      motivo_ajuste,
      asociados_manual, // [{ tipo: 'FA'|'FB'|..., numero: 'PPPP-NNNNNNNN' }] — para devoluciones sin comprobante original detectable (RG 4540)
    } = body

    const { data: devolucion, error: devError } = await supabase
      .from("devoluciones")
      .select(`
        *,
        pedido_id,
        cliente:clientes!devoluciones_cliente_id_fkey(
          id,
          nombre_razon_social,
          condicion_iva,
          metodo_facturacion,
          cuit,
          exento_iva,
          exento_iibb,
          percepcion_iibb,
          vendedor_id,
          provincia
        ),
        detalle:devoluciones_detalle(
          *,
          articulo:articulos!devoluciones_detalle_articulo_id_fkey(
            id,
            descripcion,
            sku,
            categoria,
            marca_id,
            proveedor_id,
            iva_compras,
            iva_ventas
          ),
          comprobante_original:comprobantes_venta!devoluciones_detalle_comprobante_venta_id_fkey(
            id,
            tipo_comprobante,
            numero_comprobante
          )
        )
      `)
      .eq("id", devolucion_id)
      .single()

    if (devError || !devolucion) {
      return NextResponse.json({ error: "Devolución no encontrada" }, { status: 404 })
    }

    if (devolucion.estado === "facturado") {
      return NextResponse.json({
        error: "Esta devolución ya tiene un comprobante generado. No se puede facturar dos veces.",
        error_code: "DEVOLUCION_YA_FACTURADA",
      }, { status: 422 })
    }

    if (devolucion.estado === "rechazado") {
      return NextResponse.json({
        error: "Esta devolución fue rechazada. No se puede generar comprobante.",
        error_code: "DEVOLUCION_RECHAZADA",
      }, { status: 422 })
    }

    // Regla del dueño (16/10/2026): la NC/REV sale solo de una devolución que
    // depósito (u oficina) ya revisó y aceptó, y solo por lo aceptado.
    if (devolucion.estado !== "confirmado") {
      return NextResponse.json({
        error: "La devolución todavía no fue aceptada por depósito. Primero hay que revisar la mercadería; recién después se emite la NC/Reversa.",
        error_code: "DEVOLUCION_NO_ACEPTADA",
        estado: devolucion.estado,
      }, { status: 422 })
    }

    devolucion.detalle = (devolucion.detalle ?? []).filter(
      (item: any) => item.estado_renglon !== "rechazado" && Number(item.cantidad) > 0,
    )
    if (devolucion.detalle.length === 0) {
      return NextResponse.json({
        error: "La devolución no tiene renglones aceptados: no hay nada para acreditar.",
        error_code: "DEVOLUCION_SIN_ACEPTADOS",
      }, { status: 422 })
    }

    // ── VALOR — regla única (lib/cobranzas/valor-devolucion, 21/10/2026): cada
    // renglón tal cual fue facturado en SU comprobante de origen: neto e IVA del
    // renglón, percepción IVA si ese comprobante la llevó, IIBB vigente, −10% si
    // fue cobrado contado. Es el MISMO número que se descontó en el cobro.
    const valoracion = (await valorarDevoluciones(supabase, {
      clienteId: devolucion.cliente_id,
      devolucionIds: [devolucion.id],
      cliente: devolucion.cliente,
    })).get(devolucion.id)!
    const origenDe = new Map(valoracion.renglones.map((r) => [r.id, r.origen]))
    const alicuotaIIBB = valoracion.alicuota_iibb

    // Partes: lo que se facturó con factura → NC A/B; lo de presupuesto → REV
    const partes = [
      { fiscal: true, items: devolucion.detalle.filter((it: any) => origenDe.get(it.id)?.fiscal) },
      { fiscal: false, items: devolucion.detalle.filter((it: any) => !origenDe.get(it.id)?.fiscal) },
    ].filter((p) => p.items.length > 0)

    // Reintento: una parte ya emitida (NC o REV viva con esta devolución) no se repite
    const prefijoObs = `Devolución ${devolucion.numero_devolucion || devolucion.id}`
    const { data: yaEmitidos } = await supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, numero_comprobante, total_factura, observaciones")
      .eq("cliente_id", devolucion.cliente_id)
      .in("tipo_comprobante", [...TIPOS_NC_FISCAL, "REV"])
      .is("anulado_en", null)
      .ilike("observaciones", `${prefijoObs}%`)
    const emitidoDe = (fiscal: boolean) =>
      (yaEmitidos || []).find((c: any) => {
        const obs = String(c.observaciones || "")
        const esDeEsta = obs === prefijoObs || obs.startsWith(prefijoObs + " ")
        return esDeEsta && (fiscal ? TIPOS_NC_FISCAL.includes(c.tipo_comprobante) : c.tipo_comprobante === "REV")
      })

    const { data: empresaConfig } = await supabase
      .from('configuracion_empresa')
      .select('cuit, arca_ambiente, arca_punto_venta')
      .single()

    const emitidos: Array<{ id: string; tipo: string; numero: string; total: number; ya_existia?: boolean }> = []
    const avisos: string[] = []

    // ─── Emisión de UNA parte (NC fiscal o REV) ───
    const emitirParte = async (parte: { fiscal: boolean; items: any[] }) => {
      const previo = emitidoDe(parte.fiscal)
      if (previo) {
        emitidos.push({ id: previo.id, tipo: previo.tipo_comprobante, numero: previo.numero_comprobante, total: Math.abs(Number(previo.total_factura) || 0), ya_existia: true })
        return
      }

      // Tipo: el del comprobante de origen (FA → NCA, FB → NCB); sin origen
      // fiscal en el sistema, por la condición de IVA del cliente.
      let tipoFinal: string
      if (!parte.fiscal) {
        tipoFinal = "REV"
      } else {
        const tipoOrig = parte.items.map((it: any) => origenDe.get(it.id)?.tipo_comprobante).find((t: any) => t === "FA" || t === "FB")
        const desdeOrig = tipoOrig ? determinarTipoNCADesdeOriginal(tipoOrig) : null
        if (desdeOrig) {
          tipoFinal = desdeOrig
        } else {
          const tipoFactura = determinarTipoFactura(devolucion.cliente.condicion_iva)
          if (!tipoFactura) {
            throw corte({
              error: mensajeErrorCondicionIva(devolucion.cliente.nombre_razon_social),
              error_code: "CLIENTE_SIN_CONDICION_IVA",
              cliente_id: devolucion.cliente_id,
              cliente_nombre: devolucion.cliente.nombre_razon_social,
            }, 422)
          }
          tipoFinal = tipoFactura === "FA" ? "NCA" : "NCB"
        }
      }

      // Valor de esta parte: misma función que el total de la devolución
      const renglonesValor = parte.items.map((it: any) => ({
        cantidad: Number(it.cantidad) || 0,
        precio_venta_original: Number(it.precio_venta_original) || 0,
        origen: origenDe.get(it.id),
      }))
      const v = valorDevolucionConOrigen(renglonesValor, alicuotaIIBB)
      const netoRenglon = v.netoPorRenglon
      const ivaRenglon = v.ivaPorRenglon
      const aplica10 = parte.items.some((it: any) => origenDe.get(it.id)?.bonificado_contado)
      const totalNeto = parte.fiscal ? v.fiscal.neto : v.rev.total
      const totalIva = parte.fiscal ? v.fiscal.iva : 0
      const percIVA = parte.fiscal ? v.fiscal.percepcionIva : 0
      const percIIBB = parte.fiscal ? v.fiscal.percepcionIibb : 0
      const totalTrib = Math.round((percIVA + percIIBB) * 100) / 100
      const totalComprobante = parte.fiscal ? v.fiscal.total : v.rev.total

      // ─── Configuración ARCA ───
      const esFiscal = REQUIERE_CAE.has(tipoFinal)
      if (esFiscal && !empresaConfig?.arca_punto_venta) {
        throw corte({ error: 'configuracion_empresa.arca_punto_venta no está configurado. No se puede emitir la NC fiscal.' }, 500)
      }
      const puntoVenta = esFiscal
        ? String(empresaConfig!.arca_punto_venta).padStart(4, '0')
        : '0001'

      // Validaciones del receptor y comprobantes asociados ANTES de pedir CAE
      let clienteCuit = ""
      let condIvaReceptor: number | null = null
      const cbteAsoc: { tipo: number; ptoVta: number; nro: number }[] = []
      // Sin comprobante asociado: período del mes de emisión (PeriodoAsoc, RG 4540)
      let periodoAsoc: { desde: string; hasta: string } | undefined
      const origenIds: string[] = [...new Set(parte.items.map((it: any) => it.comprobante_venta_id).filter(Boolean) as string[])]
      if (esFiscal) {
        if (!devolucion.cliente?.cuit || devolucion.cliente.cuit.trim() === '') {
          throw corte({
            error: `El cliente "${devolucion.cliente?.nombre_razon_social ?? ''}" no tiene CUIT configurado. Sin CUIT no se puede emitir un comprobante fiscal.`,
            error_code: 'CLIENTE_SIN_CUIT',
            cliente_id: devolucion.cliente_id,
            cliente_nombre: devolucion.cliente?.nombre_razon_social,
          }, 422)
        }
        if (!cuitValido(devolucion.cliente.cuit)) {
          throw corte({
            error: `El CUIT del cliente "${devolucion.cliente?.nombre_razon_social ?? ''}" no es válido (${devolucion.cliente.cuit}): corregilo en la ficha del cliente.`,
            error_code: 'CLIENTE_CUIT_INVALIDO',
            cliente_id: devolucion.cliente_id,
            cliente_nombre: devolucion.cliente?.nombre_razon_social,
          }, 422)
        }
        clienteCuit = cuitDigitos(devolucion.cliente.cuit)

        // RG 5616/2024: condición IVA del receptor obligatoria
        condIvaReceptor = condicionIvaReceptorId(devolucion.cliente?.condicion_iva)
        if (condIvaReceptor === null) {
          throw corte({
            error: `El cliente "${devolucion.cliente?.nombre_razon_social ?? ''}" tiene condición de IVA "${devolucion.cliente?.condicion_iva ?? 'sin cargar'}" que no mapea a ningún código de receptor de ARCA (RG 5616). Corregí la condición de IVA del cliente antes de emitir.`,
            error_code: 'CONDICION_IVA_NO_MAPEA',
          }, 422)
        }

        // CbteAsoc (RG 4540): los comprobantes originales distintos de los renglones
        // de esta parte, más los ingresados manualmente.
        const asocVistos = new Set<string>()
        for (const item of parte.items) {
          const orig = item.comprobante_original
          if (!orig?.numero_comprobante || !TIPO_CBTE_ARCA[orig.tipo_comprobante]) continue
          const clave = `${orig.tipo_comprobante}|${orig.numero_comprobante}`
          if (asocVistos.has(clave)) continue
          asocVistos.add(clave)
          cbteAsoc.push({
            tipo:   TIPO_CBTE_ARCA[orig.tipo_comprobante],
            ptoVta: parseInt(orig.numero_comprobante.split('-')[0], 10),
            nro:    parseInt(orig.numero_comprobante.split('-')[1] ?? '0', 10),
          })
        }

        // Asociados ingresados manualmente (caso migración: el original no está en el sistema)
        for (const asoc of (asociados_manual ?? [])) {
          const tipoArca = TIPO_CBTE_ARCA[asoc?.tipo]
          const partesNro = String(asoc?.numero ?? '').trim().split('-')
          const ptoVta   = parseInt(partesNro[0], 10)
          const nro      = parseInt(partesNro[1] ?? '', 10)
          if (!tipoArca || isNaN(ptoVta) || isNaN(nro)) {
            throw corte({
              error: `Comprobante asociado inválido: "${asoc?.tipo ?? ''} ${asoc?.numero ?? ''}". Formato esperado: tipo FA/FB/NDA/NDB y número PPPP-NNNNNNNN (ej: FA 0007-00000123).`,
              error_code: 'ASOCIADO_INVALIDO',
            }, 422)
          }
          const clave = `${asoc.tipo}|${asoc.numero}`
          if (asocVistos.has(clave)) continue
          asocVistos.add(clave)
          cbteAsoc.push({ tipo: tipoArca, ptoVta, nro })
        }

        // RG 4540: la NC informa el comprobante asociado O el período asociado.
        // Lo devuelto sin comprobante con ese artículo (#28: venta del sistema
        // viejo o nunca facturada) sale con PERÍODO, sin inventar un asociado ni
        // para ARCA ni para el sistema (Juan 26/10). Período = del 1° del mes a la
        // fecha de emisión: con percepciones ARCA exige el mismo mes/año (10217)
        // y la fecha "hasta" no puede pasar la de emisión.
        if (cbteAsoc.length === 0) {
          const hoyNc = todayArgentina()
          periodoAsoc = { desde: `${hoyNc.slice(0, 7).replace("-", "")}01`, hasta: hoyNc.replace(/-/g, "") }
        }
      }

      const { data: numeracion, error: numError } = await supabase
        .from("numeracion_comprobantes")
        .select("*")
        .eq("tipo_comprobante", tipoFinal)
        .eq("punto_venta", puntoVenta)
        .single()

      if (numError) {
        throw corte({ error: `Numeración no encontrada para ${tipoFinal} PV ${puntoVenta}` }, 500)
      }

      let nuevoNumero = numeracion.ultimo_numero + 1

      // ─── Obtener TA y sincronizar numeración con ARCA ───
      let arcaTa: { token: string; sign: string } | null = null
      if (esFiscal && empresaConfig) {
        const ambiente = (empresaConfig.arca_ambiente ?? 'produccion') as AmbienteARCA
        arcaTa = await obtenerTAConCache(supabase, ambiente)
        const cbteTipo = TIPO_CBTE_ARCA[tipoFinal]
        if (cbteTipo) {
          const ultimoEnArca = await ultimoAutorizado(
            ambiente, arcaTa.token, arcaTa.sign,
            cuitDigitos(empresaConfig.cuit),
            parseInt(puntoVenta, 10), cbteTipo,
          )
          if (ultimoEnArca !== numeracion.ultimo_numero) {
            await supabase.from('numeracion_comprobantes')
              .update({ ultimo_numero: ultimoEnArca })
              .eq('tipo_comprobante', tipoFinal)
              .eq('punto_venta', puntoVenta)
            nuevoNumero = ultimoEnArca + 1
          }
        }
      }

      const numeroComprobante = `${puntoVenta}-${nuevoNumero.toString().padStart(8, "0")}`

      // ─── Solicitar CAE a ARCA (solo NCA/NCB, no REV) ───
      let cae: string | null = null
      let vencimientoCae: string | null = null

      if (esFiscal && empresaConfig && arcaTa) {
        const ambiente = (empresaConfig.arca_ambiente ?? 'produccion') as AmbienteARCA
        const fecha = todayArgentina().replace(/-/g, '')
        const tributos = []
        if (percIVA > 0) {
          // Percepción IVA espejo de la del comprobante de origen: base = neto de
          // los renglones cuyo comprobante la llevó (aunque esta NC sea chica)
          tributos.push({ id: TRIBUTO_ID.PERCEPCION_IVA, desc: 'Percepcion IVA RG 5329', baseImp: v.fiscal.baseIva, alic: TASA_PERCEPCION_IVA_DEVOLUCION, importe: percIVA })
        }
        if (percIIBB > 0) {
          tributos.push({ id: TRIBUTO_ID.PERCEPCION_IIBB, desc: 'Percepcion IIBB', baseImp: totalNeto, alic: alicuotaIIBB, importe: percIIBB })
        }

        const respCAE = await solicitarCAE({
          ambiente,
          token:    arcaTa.token,
          sign:     arcaTa.sign,
          cuit:     cuitDigitos(empresaConfig.cuit),
          ptoVta:   parseInt(puntoVenta, 10),
          cbteTipo: TIPO_CBTE_ARCA[tipoFinal],
          cbteDesde: nuevoNumero,
          cbteHasta: nuevoNumero,
          concepto:  CONCEPTO.PRODUCTOS,
          docTipo:   DOC_TIPO.CUIT,
          docNro:    clienteCuit,
          fecha,
          impTotal:   totalComprobante,
          impTotConc: 0,
          impNeto:    totalNeto,
          impOpEx:    0,
          impIva:     totalIva,
          impTrib:    totalTrib,
          iva: totalIva > 0
            ? [{ id: IVA_ID.IVA_21, baseImp: totalNeto, importe: totalIva }]
            : [{ id: IVA_ID.EXENTO,  baseImp: totalNeto, importe: 0 }],
          cbteAsoc,
          periodoAsoc,
          tributos: tributos.length > 0 ? tributos : undefined,
          condicionIVAReceptorId: condIvaReceptor!,
        })
        cae            = respCAE.cae
        vencimientoCae = respCAE.vencimientoCae
      }

      const comprobanteInsert = {
        tipo_comprobante:   tipoFinal,
        numero_comprobante: numeroComprobante,
        punto_venta:        puntoVenta,
        fecha:              todayArgentina(),
        cliente_id:         devolucion.cliente_id,
        pedido_id:          devolucion.pedido_id || null,
        total_neto:         -Math.abs(totalNeto),
        total_iva:          -Math.abs(totalIva),
        percepcion_iva:     -Math.abs(percIVA),
        percepcion_iibb:    -Math.abs(percIIBB),
        total_factura:      -Math.abs(totalComprobante),
        saldo_pendiente:    -Math.abs(totalComprobante),
        estado_pago:        "pendiente",
        motivo_ajuste:      motivo_ajuste,
        observaciones:      `${prefijoObs}${aplica10 ? " (renglones bonificados 10% contado — la factura original fue cobrada con el descuento)" : ""}${periodoAsoc ? ` (sin comprobante asociado: período ${periodoAsoc.desde.slice(6, 8)}/${periodoAsoc.desde.slice(4, 6)}/${periodoAsoc.desde.slice(0, 4)} al ${periodoAsoc.hasta.slice(6, 8)}/${periodoAsoc.hasta.slice(4, 6)}/${periodoAsoc.hasta.slice(0, 4)} informado a ARCA)` : ""}`,
        ...(cae            ? { cae }                             : {}),
        ...(vencimientoCae ? { vencimiento_cae: vencimientoCae } : {}),
      }

      const detallePayload = parte.items.map((item: any, idx: number) => {
        const bonif = origenDe.get(item.id)?.bonificado_contado
        return {
          articulo_id: item.articulo_id,
          descripcion: item.articulo.descripcion + (bonif ? " (bonif. 10% contado)" : ""),
          cantidad: -Math.abs(item.cantidad), // Negativo
          precio_unitario: item.precio_venta_original || 0,
          // Con 10% contado: el renglón sale bonificado (mismo redondeo por renglón
          // que usó el descuento en el cobro — coinciden al centavo)
          precio_total: -Math.abs(netoRenglon[idx] ?? 0),
        }
      })

      const logId = cae ? await registrarCAEObtenido(supabase, {
        tipo: tipoFinal, puntoVenta, numero: numeroComprobante,
        cae, vencimientoCae, importe: Math.abs(totalComprobante),
        clienteCuit: devolucion.cliente?.cuit ?? null,
        payload: { comprobante: comprobanteInsert, detalle: detallePayload },
      }) : null

      const { data: comprobante, error: comprobanteError } = await supabase
        .from("comprobantes_venta")
        .insert(comprobanteInsert)
        .select('id, tipo_comprobante, numero_comprobante, fecha, total_neto, total_iva, percepcion_iva, percepcion_iibb, total_factura, cae, vencimiento_cae, observaciones, motivo_ajuste')
        .single()

      if (comprobanteError) {
        if (cae) {
          await marcarHuerfano(supabase, logId, comprobanteError.message)
          throw corte({ error: mensajeHuerfano(tipoFinal, numeroComprobante, cae) }, 500)
        }
        throw corte({ error: "Error creando comprobante: " + comprobanteError.message }, 500)
      }

      await marcarComprobanteCreado(supabase, logId, comprobante.id)

      const detalleInserts = detallePayload.map((d: any) => ({ ...d, comprobante_id: comprobante.id }))

      const { error: detalleError } = await supabase.from("comprobantes_venta_detalle").insert(detalleInserts)

      if (detalleError) {
        throw corte({ error: "Error creando detalle del comprobante" }, 500)
      }

      // Kardex: registrar movimiento por cada ítem de la NC/Reversa
      // No-vendible: no afecta stock, no se registra en kardex
      const esNC = tipoFinal.startsWith("NC")
      const colorDinero = esNC ? "BLANCO" : "NEGRO"
      const metodoFact = esNC ? "Factura" : "Presupuesto"
      for (const [idx, item] of parte.items.entries()) {
        if (item.es_vendible === false) continue
        // Neto e IVA del renglón tal como salen en la NC/REV
        const cantidadAbs = Math.abs(item.cantidad || 1)
        const precioNeto = Math.abs(netoRenglon[idx] ?? 0)
        const ivaMonto = esNC ? Math.abs(ivaRenglon[idx] ?? 0) : 0
        const ivaPct = esNC && precioNeto > 0 ? Math.round((ivaMonto / precioNeto) * 10000) / 100 : 0
        const precioUnitNeto = cantidadAbs > 0 ? precioNeto / cantidadAbs : 0
        const art = item.articulo
        await insertarKardex(
          supabase,
          {
            tipo_movimiento: 'nota_credito_venta',
            fecha: ahoraISO(), // kardex.fecha es timestamptz: "AAAA-MM-DD" a secas quedaba el día anterior
            articulo_id: item.articulo_id,
            cantidad: cantidadAbs,
            precio_lista: precioUnitNeto,
            precio_unitario_final: precioUnitNeto,
            iva_porcentaje: ivaPct,
            iva_monto_unitario: cantidadAbs > 0 ? ivaMonto / cantidadAbs : 0,
            iva_incluido: !esNC,
            subtotal_neto: precioNeto,
            subtotal_iva: ivaMonto,
            subtotal_total: Math.round((precioNeto + ivaMonto) * 100) / 100,
            cliente_id: devolucion.cliente_id,
            vendedor_id: devolucion.cliente?.vendedor_id ?? null,
            provincia_destino: devolucion.cliente?.provincia ?? null,
            pedido_id: devolucion.pedido_id ?? null,
            comprobante_venta_id: comprobante.id,
            tipo_comprobante: tipoFinal,
            numero_comprobante: numeroComprobante,
            metodo_facturacion: metodoFact,
            color_dinero: colorDinero,
            operador_id: auth.user.id,
          },
          {
            sku: art?.sku,
            descripcion: art?.descripcion,
            categoria: art?.categoria,
            marca_id: art?.marca_id,
            proveedor_id: art?.proveedor_id,
            iva_compras: art?.iva_compras,
            iva_ventas: art?.iva_ventas,
          },
        )
      }

      await supabase
        .from("numeracion_comprobantes")
        .update({ ultimo_numero: nuevoNumero })
        .eq("tipo_comprobante", tipoFinal)
        .eq("punto_venta", numeracion.punto_venta)

      // Libro mayor: la NC/Reversa acredita al cliente (haber). Fuente única del
      // saldo (v_saldo_clientes); si falla, la advertencia viaja en la respuesta.
      const ccAviso = await postearLibroConAviso(supabase, {
        p_cliente_id:         devolucion.cliente_id,
        p_tipo_movimiento:    'nota_credito',
        p_debe:               0,
        p_haber:              Math.abs(totalComprobante),
        p_referencia_tipo:    'comprobante_venta',
        p_referencia_id:      comprobante.id,
        p_numero_comprobante: numeroComprobante,
        p_observaciones:      `${tipoFinal} ${numeroComprobante} — Devolución${motivo_ajuste ? ': ' + motivo_ajuste : ''}`,
        p_usuario_id:         auth.user.id,
      }, `${tipoFinal} ${numeroComprobante}`)
      if (ccAviso) avisos.push(ccAviso)

      // Imputación automática NC↔FA (Fase A3): aplicar el crédito contra los
      // comprobantes de origen de ESTA parte hasta agotarlo. Sin origen, el
      // crédito queda disponible para imputación manual (cc_imputar_credito).
      try {
        for (const origenId of origenIds) {
          const { data: impRes, error: impErr } = await supabase.rpc("cc_imputar_credito", {
            p_credito_id: comprobante.id,
            p_debito_id: origenId,
            p_monto: null,
            p_usuario_id: auth.user.id,
          })
          if (impErr) {
            // "sin saldo disponible/pendiente" es esperable cuando el crédito se
            // agotó o el origen ya no debe nada (el PRES de respaldo 0002-00000001
            // está en $0, #28): se sigue con el próximo origen, no se corta.
            console.warn("[cc_imputar_credito] NC", comprobante.id, "→", origenId, impErr.message)
            continue
          }
          if (Number(impRes?.credito_saldo_restante) >= 0) break // crédito agotado
        }
      } catch (impError: any) {
        console.error("[cc_imputar_credito] NC/REV", comprobante.id, impError.message)
      }

      emitidos.push({ id: comprobante.id, tipo: tipoFinal, numero: numeroComprobante, total: totalComprobante })

      // ─── Generar PDF con QR y subirlo al bucket ───
      try {
        const { data: empresaData } = await supabase.from('configuracion_empresa').select('*').single()
        const { data: marcasTbl }   = await supabase.from('marcas').select('id, descripcion').eq('activo', true)
        const marcaDesc = new Map((marcasTbl ?? []).map((m: any) => [m.id, m.descripcion ?? '']))

        let qrDataUrl: string | undefined
        let qrUrl: string | undefined
        if (cae && devolucion.cliente?.cuit) {
          try {
            const qrParams = {
              cuit:       empresaData?.cuit ?? '',
              ptoVta:     puntoVenta,
              tipoCmp:    tipoFinal,
              nroCmp:     numeroComprobante,
              importe:    Math.abs(totalComprobante),
              fecha:      todayArgentina(),
              tipoDocRec: 80,
              nroDocRec:  devolucion.cliente.cuit,
              cae:        cae,
            }
            qrUrl     = buildQRUrl(qrParams)
            qrDataUrl = await generarQRBase64(qrParams)
          } catch (qrErr: any) {
            console.error('[NC QR] Error generando QR:', qrErr.message)
          }
        }

        // Detalle para el PDF (mismos importes que el detalle de la NC)
        const detalleNC = parte.items.map((item: any, idx: number) => ({
          articulo_id:     item.articulo_id,
          descripcion:     item.articulo?.descripcion ?? item.descripcion ?? '—',
          sku:             item.articulo?.sku ?? '',
          cantidad:        -Math.abs(item.cantidad ?? 0),
          precio_unitario: item.precio_venta_original ?? 0,
          precio_total:    -Math.abs(netoRenglon[idx] ?? 0),
          marca:           marcaDesc.get(item.articulo?.marca_id) ?? '',
          descuento_propio: 0,
        }))

        const pdfData = buildPDFData({
          comprobante: comprobante,
          cliente:     devolucion.cliente,
          empresa:     empresaData,
          detalle:     detalleNC,
          pedido:      null,
          bonificaciones: [],
          marcaDesc,
          qrDataUrl,
        })

        const { pdfUrl, pdfPath, pdfHash } = await generarYSubirPDF(supabase, pdfData)
        const snapshot = buildSnapshot(pdfData)

        await supabase.from('comprobantes_venta').update({
          pdf_url:              pdfUrl,
          pdf_path:             pdfPath,
          pdf_hash:             pdfHash,
          fecha_generacion_pdf: new Date().toISOString(),
          estado_pdf:           'generado',
          pdf_snapshot:         snapshot,
          qr_url:               qrUrl ?? null,
        }).eq('id', comprobante.id)
      } catch (pdfErr: any) {
        console.error('[NC PDF] Error generando PDF:', pdfErr.message)
        const { error: pdfMarkErr } = await supabase.from('comprobantes_venta').update({ estado_pdf: 'error' }).eq('id', comprobante.id)
        if (pdfMarkErr) console.error('[NC PDF] marcando error:', pdfMarkErr.message)
      }
    }

    // Fiscal primero (si ARCA falla, no queda una REV suelta de una devolución a medias)
    for (const parte of partes) {
      try {
        await emitirParte(parte)
      } catch (e) {
        if (e instanceof Corte) {
          if (!emitidos.length) return e.respuesta
          // Una parte ya salió: se informa lo emitido y el error de lo que falta.
          // Reintentar emite solo la parte pendiente (no duplica).
          const err = await e.respuesta.json()
          return NextResponse.json({ ...err, error: `${err.error} (ya se emitió ${emitidos.map((c) => `${c.tipo} ${c.numero}`).join(", ")}; al reintentar se emite solo lo que falta)`, emitidos }, { status: e.respuesta.status })
        }
        throw e
      }
    }

    // Marcar la devolución como facturada para que no pueda generar otra NC
    await supabase
      .from("devoluciones")
      .update({ estado: "facturado" })
      .eq("id", devolucion_id)

    // Comisión: la NC no es plata, así que la devolución ya descuenta comisión
    // sola (lib/comisiones/liquidar.ts reconcilia los comprobantes de origen).
    try {
      const { liquidarComisiones } = await import("@/lib/comisiones/liquidar")
      const origen = [...new Set((devolucion.detalle ?? []).map((i: any) => i.comprobante_venta_id).filter(Boolean) as string[])]
      if (origen.length) await liquidarComisiones(supabase, origen, auth.user.id)
    } catch (comErr) {
      console.error("[generar-nc-reversa] comisiones:", comErr)
    }

    const principal = emitidos[0]
    return NextResponse.json({
      success: true,
      ...(avisos.length ? { advertencia_libro_mayor: avisos.join(" · ") } : {}),
      comprobante: {
        id: principal.id,
        tipo: emitidos.map((c) => c.tipo).join(" + "),
        numero: emitidos.map((c) => c.numero).join(" + "),
        total: Math.round(emitidos.reduce((s, c) => s + c.total, 0) * 100) / 100,
      },
      comprobantes: emitidos,
    })
  } catch (error: any) {
    console.error("[v0] Error generando NC/Reversa:", error)
    return NextResponse.json({ error: error.message || "Error generando comprobante" }, { status: 500 })
  }
}
