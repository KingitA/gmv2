import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { requireAuth } from '@/lib/auth'
import { insertarKardex } from '@/lib/kardex/insertar-kardex'
import { getComisionPorcentaje, getPrecioNeto } from "@/lib/comisiones/calcular"
import { determinarTipoNCADesdeOriginal, determinarTipoFactura, mensajeErrorCondicionIva } from "@/lib/comprobantes/tipo-comprobante"
import { REQUIERE_CAE, TIPO_CBTE_ARCA, DOC_TIPO, CONCEPTO, IVA_ID, TRIBUTO_ID, condicionIvaReceptorId, type AmbienteARCA } from "@/lib/arca/tipos"
import { obtenerTAConCache } from "@/lib/arca/cache"
import { ultimoAutorizado, solicitarCAE } from "@/lib/arca/wsfev1"
import { calcularPercepciones } from "@/lib/comprobantes/calcular-percepciones"
import { generarYSubirPDF, buildPDFData, generarQRBase64, buildQRUrl, buildSnapshot } from "@/lib/pdf/generar"

export async function POST(request: Request) {
  try {
    const auth = await requireAuth()
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
      tipo_comprobante, // 'NC' o 'REV'
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

    let tipoFinal = tipo_comprobante

    if (tipo_comprobante === "auto") {
      // Prioridad 1: usar el tipo del comprobante original referenciado
      const compOriginal = devolucion.detalle.length > 0
        ? devolucion.detalle[0].comprobante_original
        : null

      if (compOriginal) {
        const tipoDesdeOriginal = determinarTipoNCADesdeOriginal(compOriginal.tipo_comprobante)
        if (tipoDesdeOriginal) {
          tipoFinal = tipoDesdeOriginal
        } else {
          return NextResponse.json({
            error: `No se puede determinar el tipo de NC para el comprobante original tipo "${compOriginal.tipo_comprobante}".`,
            error_code: "TIPO_ORIGINAL_DESCONOCIDO",
          }, { status: 422 })
        }
      } else {
        // Sin comprobante original: derivar desde condición IVA del cliente
        const metodo = devolucion.cliente.metodo_facturacion?.toLowerCase() || "factura"
        if (metodo.includes("presupuesto") || metodo.includes("remito")) {
          tipoFinal = "REV"
        } else {
          const tipoFactura = determinarTipoFactura(devolucion.cliente.condicion_iva)
          if (!tipoFactura) {
            return NextResponse.json({
              error: mensajeErrorCondicionIva(devolucion.cliente.nombre_razon_social),
              error_code: "CLIENTE_SIN_CONDICION_IVA",
              cliente_id: devolucion.cliente_id,
              cliente_nombre: devolucion.cliente.nombre_razon_social,
            }, { status: 422 })
          }
          tipoFinal = tipoFactura === "FA" ? "NCA" : "NCB"
        }
      }
    }

    // ─── Configuración ARCA ───
    const { data: empresaConfig } = await supabase
      .from('configuracion_empresa')
      .select('cuit, arca_ambiente, arca_punto_venta')
      .single()

    const esFiscal = REQUIERE_CAE.has(tipoFinal)
    if (esFiscal && !empresaConfig?.arca_punto_venta) {
      return NextResponse.json(
        { error: 'configuracion_empresa.arca_punto_venta no está configurado. No se puede emitir la NC fiscal.' },
        { status: 500 },
      )
    }
    const puntoVenta = esFiscal
      ? String(empresaConfig!.arca_punto_venta).padStart(4, '0')
      : '0001'

    const { data: numeracion, error: numError } = await supabase
      .from("numeracion_comprobantes")
      .select("*")
      .eq("tipo_comprobante", tipoFinal)
      .eq("punto_venta", puntoVenta)
      .single()

    if (numError) {
      return NextResponse.json({ error: `Numeración no encontrada para ${tipoFinal} PV ${puntoVenta}` }, { status: 500 })
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
          (empresaConfig.cuit ?? '').replace(/-/g, ''),
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

    let totalNeto = 0

    devolucion.detalle.forEach((item: any) => {
      totalNeto += Number(item.subtotal) || 0
    })
    totalNeto = Math.round(totalNeto * 100) / 100

    // precio_venta_original es el precio NETO (igual que en la FA original)
    // el IVA se calcula como 21% del neto, no como complemento del total
    const totalIva = !devolucion.cliente.exento_iva && tipoFinal.startsWith("NC")
      ? Math.round(totalNeto * 21 / 100 * 100) / 100
      : 0

    // ─── Percepciones en NC (se incluyen en negativo, espejo de la factura original) ───
    const percResult    = calcularPercepciones(totalNeto, devolucion.cliente, esFiscal)
    const percIVA       = percResult.percepcion_iva
    const percIIBB      = percResult.percepcion_iibb
    const totalTrib     = Math.round((percIVA + percIIBB) * 100) / 100
    // Integer-cent arithmetic guarantees ImpTotal == ImpNeto + ImpIva + ImpTrib in ARCA's decimal validation
    const totalComprobante = (
      Math.round(totalNeto * 100) +
      Math.round(totalIva  * 100) +
      Math.round(totalTrib * 100)
    ) / 100

    // ─── Solicitar CAE a ARCA (solo NCA/NCB, no REV) ───
    let cae: string | null = null
    let vencimientoCae: string | null = null

    if (esFiscal && empresaConfig && arcaTa) {
      const ambiente = (empresaConfig.arca_ambiente ?? 'produccion') as AmbienteARCA
      const ta = arcaTa
      const clienteCuit = (devolucion.cliente?.cuit ?? '').replace(/-/g, '') || '0'
      const fecha = todayArgentina().replace(/-/g, '')

      // RG 5616/2024: condición IVA del receptor obligatoria
      const condIvaReceptor = condicionIvaReceptorId(devolucion.cliente?.condicion_iva)
      if (condIvaReceptor === null) {
        return NextResponse.json({
          error: `El cliente "${devolucion.cliente?.nombre_razon_social ?? ''}" tiene condición de IVA "${devolucion.cliente?.condicion_iva ?? 'sin cargar'}" que no mapea a ningún código de receptor de ARCA (RG 5616). Corregí la condición de IVA del cliente antes de emitir.`,
          error_code: 'CONDICION_IVA_NO_MAPEA',
        }, { status: 422 })
      }

      // CbteAsoc (RG 4540): TODOS los comprobantes originales distintos referenciados
      // por los ítems de la devolución, más los ingresados manualmente.
      const asocVistos = new Set<string>()
      const cbteAsoc: { tipo: number; ptoVta: number; nro: number }[] = []

      for (const item of devolucion.detalle) {
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
        const partes   = String(asoc?.numero ?? '').trim().split('-')
        const ptoVta   = parseInt(partes[0], 10)
        const nro      = parseInt(partes[1] ?? '', 10)
        if (!tipoArca || isNaN(ptoVta) || isNaN(nro)) {
          return NextResponse.json({
            error: `Comprobante asociado inválido: "${asoc?.tipo ?? ''} ${asoc?.numero ?? ''}". Formato esperado: tipo FA/FB/NDA/NDB y número PPPP-NNNNNNNN (ej: FA 0007-00000123).`,
            error_code: 'ASOCIADO_INVALIDO',
          }, { status: 422 })
        }
        const clave = `${asoc.tipo}|${asoc.numero}`
        if (asocVistos.has(clave)) continue
        asocVistos.add(clave)
        cbteAsoc.push({ tipo: tipoArca, ptoVta, nro })
      }

      // RG 4540: una NC/ND fiscal no puede emitirse sin comprobante asociado
      if (cbteAsoc.length === 0) {
        return NextResponse.json({
          error: 'No se detectó ningún comprobante original asociado a esta devolución (RG 4540). Ingresá manualmente el/los comprobantes que esta NC ajusta antes de emitir.',
          error_code: 'NC_SIN_ASOCIADO',
        }, { status: 422 })
      }

      const tributos = []
      if (percIVA > 0) {
        tributos.push({ id: TRIBUTO_ID.PERCEPCION_IVA, desc: 'Percepcion IVA RG 5329', baseImp: totalNeto, alic: percResult.tasa_iva_aplicada, importe: percIVA })
      }
      if (percIIBB > 0) {
        tributos.push({ id: TRIBUTO_ID.PERCEPCION_IIBB, desc: 'Percepcion IIBB', baseImp: totalNeto, alic: percResult.tasa_iibb_aplicada, importe: percIIBB })
      }

      const respCAE = await solicitarCAE({
        ambiente,
        token:    ta.token,
        sign:     ta.sign,
        cuit:     (empresaConfig.cuit ?? '').replace(/-/g, ''),
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
        tributos: tributos.length > 0 ? tributos : undefined,
        condicionIVAReceptorId: condIvaReceptor,
      })
      cae            = respCAE.cae
      vencimientoCae = respCAE.vencimientoCae
    }

    const { data: comprobante, error: comprobanteError } = await supabase
      .from("comprobantes_venta")
      .insert({
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
        observaciones:      `Devolución ${devolucion.numero_devolucion || devolucion.id}`,
        ...(cae            ? { cae }                             : {}),
        ...(vencimientoCae ? { vencimiento_cae: vencimientoCae } : {}),
      })
      .select('id, tipo_comprobante, numero_comprobante, fecha, total_neto, total_iva, percepcion_iva, percepcion_iibb, total_factura, cae, vencimiento_cae, observaciones, motivo_ajuste')
      .single()

    if (comprobanteError) {
      return NextResponse.json(
        {
          error: "Error creando comprobante: " + comprobanteError.message,
        },
        { status: 500 },
      )
    }

    const detalleInserts = devolucion.detalle.map((item: any) => ({
      comprobante_id: comprobante.id,
      articulo_id: item.articulo_id,
      descripcion: item.articulo.descripcion,
      cantidad: -Math.abs(item.cantidad), // Negativo
      precio_unitario: item.precio_venta_original || 0,
      precio_total: -Math.abs(item.subtotal || 0),
    }))

    const { error: detalleError } = await supabase.from("comprobantes_venta_detalle").insert(detalleInserts)

    if (detalleError) {
      return NextResponse.json(
        {
          error: "Error creando detalle del comprobante",
        },
        { status: 500 },
      )
    }

    // Kardex: registrar movimiento por cada ítem de la NC/Reversa
    // No-vendible: no afecta stock, no se registra en kardex
    const esNC = tipoFinal.startsWith("NC")
    const colorDinero = esNC ? "BLANCO" : "NEGRO"
    const metodoFact = esNC ? "Factura" : "Presupuesto"
    for (const item of devolucion.detalle) {
      if (item.es_vendible === false) continue
      // subtotal es NETO (precio_venta_original × cantidad, sin IVA)
      const subtotal = Math.abs(item.subtotal || 0)
      const cantidadAbs = Math.abs(item.cantidad || 1)
      const precioNeto = subtotal
      let ivaMonto: number
      let ivaPct: number
      if (esNC && !devolucion.cliente.exento_iva) {
        ivaMonto = Math.round(subtotal * 21) / 100
        ivaPct = 21
      } else {
        ivaMonto = 0
        ivaPct = 0
      }
      const precioUnitNeto = cantidadAbs > 0 ? precioNeto / cantidadAbs : 0
      const art = item.articulo
      await insertarKardex(
        supabase,
        {
          tipo_movimiento: 'nota_credito_venta',
          fecha: todayArgentina(),
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

    await supabase.from("cuenta_corriente_ajustes").insert({
      cliente_id: devolucion.cliente_id,
      tipo_movimiento: "haber",
      tipo_comprobante: tipoFinal,
      numero_comprobante: numeroComprobante,
      monto: Math.abs(totalComprobante),
      fecha: todayArgentina(),
      concepto: "Devolución",
      descripcion: motivo_ajuste,
    })

    // Marcar la devolución como facturada para que no pueda generar otra NC
    await supabase
      .from("devoluciones")
      .update({ estado: "facturado" })
      .eq("id", devolucion_id)

    // Comisiones negativas tipo='cobrada' para la NC/Reversa
    try {
      if (devolucion.pedido_id) {
        const { data: pedidoData } = await supabase
          .from("pedidos")
          .select("clientes(vendedor_id)")
          .eq("id", devolucion.pedido_id)
          .single()
        const viajanteId = (pedidoData?.clientes as any)?.vendedor_id as string | null

        if (viajanteId) {
          const { data: ncItems } = await supabase
            .from("comprobantes_venta_detalle")
            .select("articulo_id, cantidad, precio_unitario, articulos(segmento_precio, iva_ventas)")
            .eq("comprobante_id", comprobante.id)

          const { data: vendedor } = await supabase
            .from("vendedores")
            .select("comision_limpieza_bazar, comision_perfumeria_0, comision_perfumeria_plus")
            .eq("id", viajanteId)
            .single()

          const metodo = tipoFinal === "REV" ? "presupuesto" : "factura"
          const negativas = (ncItems ?? [])
            .filter((item: any) => item.articulos?.segmento_precio && vendedor)
            .map((item: any) => {
              const { segmento_precio, iva_ventas } = item.articulos
              const porcentaje = getComisionPorcentaje(vendedor!, segmento_precio, iva_ventas)
              const precioNeto = getPrecioNeto(Math.abs(Number(item.precio_unitario)), metodo, iva_ventas)
              const cantAbs = Math.abs(Number(item.cantidad))
              return {
                viajante_id: viajanteId,
                pedido_id: devolucion.pedido_id,
                comprobante_venta_id: comprobante.id,
                tipo: "cobrada",
                articulo_id: item.articulo_id,
                segmento: segmento_precio,
                cantidad: -cantAbs,
                precio_neto_unitario: precioNeto,
                porcentaje,
                monto: -((precioNeto * cantAbs * porcentaje) / 100),
                comprobante_cobrado: true,
                fecha_comprobante_cobrado: nowArgentina(),
                pagado: false,
              }
            })
            .filter((c: any) => c.porcentaje > 0)

          if (negativas.length) {
            await supabase.from("comisiones").insert(negativas)
          }
        }
      }
    } catch (comErr) {
      console.error("Error creando comisiones negativas NC:", comErr)
    }

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

      // Detalle para el PDF
      const detalleNC = (devolucion.detalle ?? []).map((item: any) => ({
        articulo_id:     item.articulo_id,
        descripcion:     item.articulo?.descripcion ?? item.descripcion ?? '—',
        sku:             item.articulo?.sku ?? '',
        cantidad:        -Math.abs(item.cantidad ?? 0),
        precio_unitario: item.precio_venta_original ?? 0,
        precio_total:    -Math.abs(item.subtotal ?? 0),
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
      await supabase.from('comprobantes_venta').update({ estado_pdf: 'error' }).eq('id', comprobante.id).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      comprobante: {
        id: comprobante.id,
        tipo: tipoFinal,
        numero: numeroComprobante,
        total: totalComprobante,
      },
    })
  } catch (error: any) {
    console.error("[v0] Error generando NC/Reversa:", error)
    return NextResponse.json({ error: error.message || "Error generando comprobante" }, { status: 500 })
  }
}
