/**
 * Lógica central para generar NC/REV por pago contado (10% de descuento).
 *
 * Flujo:
 * - Los PRESUPUESTOS (PRES) generan UNA REVERSA (REV) con una línea por comprobante.
 *   Monto = 10% del total_factura del presupuesto. Sin IVA discriminado.
 *   PV 0001, sin CAE, sin QR (documento interno — nunca toca ARCA).
 *
 * - Las FACTURAS (FA→NCA, FB→NCB) generan UNA NOTA DE CRÉDITO FISCAL por tipo IVA:
 *   PV fiscal (configuracion_empresa.arca_punto_venta), CAE de ARCA,
 *   CbtesAsoc = las facturas bonificadas (RG 4540), CondicionIVAReceptorId (RG 5616),
 *   PDF con QR (RG 4892). La NC es proporcional a TODOS los componentes de la
 *   factura: 10% del neto + 10% del IVA + 10% de cada percepción (IVA/IIBB),
 *   de modo que la NC = exactamente 10% del total_factura (definición del
 *   negocio 05/08/2026: "si se vendió a x+21%+percepciones, la NC devuelve
 *   x+21%+percepciones proporcionales"). impTrib y Tributos van a ARCA igual
 *   que en la factura original.
 *   Orden estricto: CAE → insert (si ARCA rechaza, no se crea nada en DB).
 *
 * Si se provee un pago_id, las NC/REV generadas se imputarán automáticamente a ese pago.
 */

import { SupabaseClient } from "@supabase/supabase-js"
import { getBonificacionArticuloId } from "@/lib/articulos/bonificacion"
import { todayArgentina, nowArgentina } from "@/lib/utils"
import { actualizarDescuentoFinancieroKardex } from "@/lib/kardex/insertar-kardex"
import { TIPO_CBTE_ARCA, DOC_TIPO, CONCEPTO, IVA_ID, TRIBUTO_ID, condicionIvaReceptorId, type AmbienteARCA } from "@/lib/arca/tipos"
import { obtenerTAConCache } from "@/lib/arca/cache"
import { ultimoAutorizado, solicitarCAE } from "@/lib/arca/wsfev1"
import { registrarCAEObtenido, marcarComprobanteCreado, marcarHuerfano, mensajeHuerfano } from "@/lib/arca/registro-cae"
import { generarYSubirPDF, buildPDFData, generarQRBase64, buildQRUrl, buildSnapshot } from "@/lib/pdf/generar"

const DESCUENTO_CONTADO_PCT = 10
const IVA_PCT = 0.21
const PUNTO_VENTA_INTERNO = "0001"

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

interface ComprobanteInput {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  total_neto: number
  total_iva: number
  total_factura: number
  percepcion_iva?: number | null
  percepcion_iibb?: number | null
}

interface ComprobanteGenerado {
  id: string
  tipo: string
  numero: string
  total_neto: number
  total_iva: number
  total_factura: number
  cae?: string | null
}

export interface ResultadoBonificacion {
  total_bonificacion: number
  comprobantes_generados: ComprobanteGenerado[]
}

export interface ParamsBonificacion {
  cliente_id: string
  comprobante_ids: string[]
  /** Si se provee, se crean imputaciones ligando las NC/REV a este pago */
  pago_id?: string
}

async function getNextNumero(
  supabase: SupabaseClient,
  tipo: string,
  puntoVenta: string,
): Promise<{ numero: string; puntoVenta: string; nextNum: number }> {
  const { data: num } = await supabase
    .from("numeracion_comprobantes")
    .select("*")
    .eq("tipo_comprobante", tipo)
    .eq("punto_venta", puntoVenta)
    .single()

  if (!num) throw new Error(`Numeración no encontrada para ${tipo} punto de venta ${puntoVenta}`)
  const nextNum = num.ultimo_numero + 1
  const numero = `${num.punto_venta}-${nextNum.toString().padStart(8, "0")}`
  return { numero, puntoVenta: num.punto_venta, nextNum }
}

async function avanzarNumeracion(
  supabase: SupabaseClient,
  tipo: string,
  puntoVenta: string,
  nextNum: number,
): Promise<void> {
  await supabase
    .from("numeracion_comprobantes")
    .update({ ultimo_numero: nextNum })
    .eq("tipo_comprobante", tipo)
    .eq("punto_venta", puntoVenta)
}

async function crearComprobante(
  supabase: SupabaseClient,
  params: {
    tipo: string
    numero: string
    puntoVenta: string
    cliente_id: string
    total_neto: number
    total_iva: number
    total_factura: number
    percepcion_iva?: number
    percepcion_iibb?: number
    observaciones?: string
    cae?: string | null
    vencimiento_cae?: string | null
  },
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("comprobantes_venta")
    .insert({
      tipo_comprobante: params.tipo,
      numero_comprobante: params.numero,
      punto_venta: params.puntoVenta,
      fecha: todayArgentina(),
      cliente_id: params.cliente_id,
      total_neto: -Math.abs(params.total_neto),
      total_iva: -Math.abs(params.total_iva),
      percepcion_iva: -Math.abs(params.percepcion_iva ?? 0),
      percepcion_iibb: -Math.abs(params.percepcion_iibb ?? 0),
      total_factura: -Math.abs(params.total_factura),
      saldo_pendiente: -Math.abs(params.total_factura),
      estado_pago: "pendiente",
      observaciones: params.observaciones || "Bonificación pago contado 10%",
      ...(params.cae ? { cae: params.cae } : {}),
      ...(params.vencimiento_cae ? { vencimiento_cae: params.vencimiento_cae } : {}),
    })
    .select("id")
    .single()

  if (error || !data) {
    throw new Error(`Error creando comprobante ${params.tipo}: ${error?.message}`)
  }

  // Libro mayor: la NC/REV de bonificación acredita al cliente (haber).
  // Junto al pago (haber) cancela la factura (debe): FA − pago − NC = 0.
  const { error: ccError } = await supabase.rpc("cc_postear", {
    p_cliente_id:         params.cliente_id,
    p_tipo_movimiento:    "nota_credito",
    p_debe:               0,
    p_haber:              Math.abs(params.total_factura),
    p_referencia_tipo:    "comprobante_venta",
    p_referencia_id:      data.id,
    p_numero_comprobante: params.numero,
    p_observaciones:      params.observaciones || "Bonificación pago contado",
    p_usuario_id:         null,
  })
  if (ccError) console.error("[cc_postear] bonificación", data.id, ccError.message)

  return data
}

async function crearDetalle(
  supabase: SupabaseClient,
  comprobante_id: string,
  bonificacion_articulo_id: string,
  lineas: Array<{
    descripcion: string
    precio_neto: number
  }>,
): Promise<void> {
  const inserts = lineas.map(l => ({
    comprobante_id,
    articulo_id: bonificacion_articulo_id,
    descripcion: l.descripcion,
    cantidad: 1,
    precio_unitario: -Math.abs(l.precio_neto),
    precio_total: -Math.abs(l.precio_neto),
  }))

  const { error } = await supabase.from("comprobantes_venta_detalle").insert(inserts)
  if (error) throw new Error(`Error creando detalle: ${error.message}`)
}

async function crearImputacion(
  supabase: SupabaseClient,
  pago_id: string,
  comprobante_id: string,
  monto: number,
): Promise<void> {
  await supabase.from("imputaciones").insert({
    pago_id,
    comprobante_id,
    monto_imputado: Math.abs(monto),
    tipo_comprobante: "venta",
    estado: "confirmado",
  })
  // Marcar la NC/REV como pagada: saldo_pendiente=0, estado_pago='pagado'
  await supabase
    .from("comprobantes_venta")
    .update({ saldo_pendiente: 0, estado_pago: "pagado" })
    .eq("id", comprobante_id)
}

/** Genera el PDF con QR de la NC fiscal y lo sube al bucket (no bloqueante). */
async function generarPDFNC(
  supabase: SupabaseClient,
  params: {
    comprobante_id: string
    tipo: string
    numero: string
    puntoVenta: string
    cliente: any
    total_neto: number
    total_iva: number
    percepcion_iva?: number
    percepcion_iibb?: number
    total_factura: number
    /** null = documento interno (REV): PDF sin CAE ni QR */
    cae: string | null
    vencimiento_cae: string | null
    lineas: Array<{ descripcion: string; precio_neto: number }>
    observaciones: string
  },
): Promise<void> {
  try {
    const { data: empresaData } = await supabase.from("configuracion_empresa").select("*").single()

    let qrDataUrl: string | undefined
    let qrUrl: string | undefined
    if (params.cae && params.cliente?.cuit) {
      try {
        const qrParams = {
          cuit:       empresaData?.cuit ?? "",
          ptoVta:     params.puntoVenta,
          tipoCmp:    params.tipo,
          nroCmp:     params.numero,
          importe:    Math.abs(params.total_factura),
          fecha:      todayArgentina(),
          tipoDocRec: 80,
          nroDocRec:  params.cliente.cuit,
          cae:        params.cae,
        }
        qrUrl     = buildQRUrl(qrParams)
        qrDataUrl = await generarQRBase64(qrParams)
      } catch (qrErr: any) {
        console.error("[Bonif NC QR] Error generando QR:", qrErr.message)
      }
    }

    const pdfData = buildPDFData({
      comprobante: {
        id:                 params.comprobante_id,
        tipo_comprobante:   params.tipo,
        numero_comprobante: params.numero,
        fecha:              todayArgentina(),
        total_neto:         -Math.abs(params.total_neto),
        total_iva:          -Math.abs(params.total_iva),
        percepcion_iva:     -Math.abs(params.percepcion_iva ?? 0),
        percepcion_iibb:    -Math.abs(params.percepcion_iibb ?? 0),
        total_factura:      -Math.abs(params.total_factura),
        cae:                params.cae,
        vencimiento_cae:    params.vencimiento_cae,
        observaciones:      params.observaciones,
      },
      cliente: params.cliente,
      empresa: empresaData,
      detalle: params.lineas.map(l => ({
        articulo_id:      null,
        descripcion:      l.descripcion,
        sku:              "",
        cantidad:         1,
        precio_unitario:  -Math.abs(l.precio_neto),
        precio_total:     -Math.abs(l.precio_neto),
        marca:            "",
        descuento_propio: 0,
      })),
      qrDataUrl,
    })

    const { pdfUrl, pdfPath, pdfHash } = await generarYSubirPDF(supabase, pdfData)
    const snapshot = buildSnapshot(pdfData)

    await supabase.from("comprobantes_venta").update({
      pdf_url:              pdfUrl,
      pdf_path:             pdfPath,
      pdf_hash:             pdfHash,
      fecha_generacion_pdf: new Date().toISOString(),
      estado_pdf:           "generado",
      pdf_snapshot:         snapshot,
      qr_url:               qrUrl ?? null,
    }).eq("id", params.comprobante_id)
  } catch (pdfErr: any) {
    console.error("[Bonif NC PDF] Error generando PDF:", pdfErr.message)
    await supabase.from("comprobantes_venta").update({ estado_pdf: "error" }).eq("id", params.comprobante_id)
  }
}

export async function generarBonificacionContado(
  supabase: SupabaseClient,
  params: ParamsBonificacion,
): Promise<ResultadoBonificacion> {
  const { cliente_id, comprobante_ids, pago_id } = params

  if (!comprobante_ids || comprobante_ids.length === 0) {
    return { total_bonificacion: 0, comprobantes_generados: [] }
  }

  // Cargar comprobantes
  const { data: comprobantes, error: compError } = await supabase
    .from("comprobantes_venta")
    .select("id, tipo_comprobante, numero_comprobante, total_neto, total_iva, total_factura, percepcion_iva, percepcion_iibb")
    .in("id", comprobante_ids)

  if (compError || !comprobantes) {
    throw new Error(`Error cargando comprobantes: ${compError?.message}`)
  }

  const bonificacionId = await getBonificacionArticuloId(supabase)

  // Separar por tipo
  const presupuestos: ComprobanteInput[] = comprobantes.filter(c => c.tipo_comprobante === "PRES")
  const facturasA: ComprobanteInput[] = comprobantes.filter(c => c.tipo_comprobante === "FA")
  const facturasB: ComprobanteInput[] = comprobantes.filter(c => c.tipo_comprobante === "FB")
  const facturasC: ComprobanteInput[] = comprobantes.filter(c => c.tipo_comprobante === "FC")

  const comprobantesGenerados: ComprobanteGenerado[] = []
  let totalBonificacion = 0

  // ─── PRESUPUESTOS → REV (documento interno: PV 0001, sin CAE, sin QR) ──────
  if (presupuestos.length > 0) {
    const { numero, puntoVenta, nextNum } = await getNextNumero(supabase, "REV", PUNTO_VENTA_INTERNO)

    const lineas = presupuestos.map(c => ({
      descripcion: `BONIF. ${DESCUENTO_CONTADO_PCT}% ${c.tipo_comprobante} ${c.numero_comprobante}`,
      precio_neto: r2(Math.abs(c.total_factura) * DESCUENTO_CONTADO_PCT / 100),
    }))

    const totalNeto = r2(lineas.reduce((s, l) => s + l.precio_neto, 0))

    const { id } = await crearComprobante(supabase, {
      tipo: "REV",
      numero,
      puntoVenta,
      cliente_id,
      total_neto: totalNeto,
      total_iva: 0,
      total_factura: totalNeto,
      observaciones: `Bonificación contado 10% — presupuestos ${presupuestos.map(c => c.numero_comprobante).join(", ")}`,
    })

    await crearDetalle(supabase, id, bonificacionId, lineas)
    await avanzarNumeracion(supabase, "REV", PUNTO_VENTA_INTERNO, nextNum)

    if (pago_id) await crearImputacion(supabase, pago_id, id, totalNeto)

    // PDF de la REV (documento interno: sin CAE ni QR). Antes solo las NC
    // fiscales generaban PDF y la REV quedaba "pendiente" sin poder verse.
    const { data: clienteRev } = await supabase
      .from("clientes")
      .select("id, nombre_razon_social, nombre, cuit, condicion_iva, direccion, localidad_id, provincia")
      .eq("id", cliente_id)
      .single()
    await generarPDFNC(supabase, {
      comprobante_id: id,
      tipo: "REV",
      numero,
      puntoVenta,
      cliente: clienteRev,
      total_neto: totalNeto,
      total_iva: 0,
      total_factura: totalNeto,
      cae: null,
      vencimiento_cae: null,
      lineas,
      observaciones: `Bonificación contado 10% — presupuestos ${presupuestos.map(c => c.numero_comprobante).join(", ")}`,
    })

    comprobantesGenerados.push({ id, tipo: "REV", numero, total_neto: totalNeto, total_iva: 0, total_factura: totalNeto })
    totalBonificacion += totalNeto
  }

  // ─── FACTURAS → NC FISCAL (FA→NCA, FB→NCB) con CAE, asociados y QR ─────────
  async function procesarFacturas(facturas: ComprobanteInput[], tipoNC: string) {
    if (facturas.length === 0) return

    const cbteTipo = TIPO_CBTE_ARCA[tipoNC]
    if (!cbteTipo) throw new Error(`Tipo ${tipoNC} no tiene código ARCA definido`)

    // Cliente: CUIT y condición IVA obligatorios (RG 5616)
    const { data: cliente } = await supabase
      .from("clientes")
      .select("id, nombre_razon_social, nombre, cuit, condicion_iva, direccion, localidad_id, provincia")
      .eq("id", cliente_id)
      .single()

    if (!cliente?.cuit) {
      throw new Error("El cliente no tiene CUIT configurado. No se puede emitir la NC fiscal por pago contado.")
    }
    const condIvaReceptor = condicionIvaReceptorId(cliente.condicion_iva)
    if (condIvaReceptor === null) {
      throw new Error(
        `El cliente "${cliente.nombre_razon_social ?? cliente.nombre ?? ""}" tiene condición de IVA ` +
        `"${cliente.condicion_iva ?? "sin cargar"}" que no mapea a ningún código de receptor de ARCA (RG 5616).`
      )
    }

    // Config ARCA: PV fiscal sin defaults
    const { data: empresaConfig } = await supabase
      .from("configuracion_empresa")
      .select("cuit, arca_ambiente, arca_punto_venta")
      .single()

    if (!empresaConfig?.arca_punto_venta) {
      throw new Error("configuracion_empresa.arca_punto_venta no está configurado. No se puede emitir la NC fiscal.")
    }
    const puntoVentaFiscal = String(empresaConfig.arca_punto_venta).padStart(4, "0")
    const ambiente = (empresaConfig.arca_ambiente ?? "produccion") as AmbienteARCA
    const cuitEmpresa = (empresaConfig.cuit ?? "").replace(/-/g, "")

    // Numeración fiscal + sync con ARCA
    const ta = await obtenerTAConCache(supabase, ambiente)
    const { data: num } = await supabase
      .from("numeracion_comprobantes")
      .select("*")
      .eq("tipo_comprobante", tipoNC)
      .eq("punto_venta", puntoVentaFiscal)
      .single()

    if (!num) throw new Error(`Numeración no encontrada para ${tipoNC} punto de venta ${puntoVentaFiscal}`)

    let nuevoNumero = num.ultimo_numero + 1
    const ultimoEnArca = await ultimoAutorizado(
      ambiente, ta.token, ta.sign, cuitEmpresa, parseInt(puntoVentaFiscal, 10), cbteTipo,
    )
    if (ultimoEnArca !== num.ultimo_numero) {
      await supabase.from("numeracion_comprobantes")
        .update({ ultimo_numero: ultimoEnArca })
        .eq("tipo_comprobante", tipoNC)
        .eq("punto_venta", puntoVentaFiscal)
      nuevoNumero = ultimoEnArca + 1
    }
    const numero = `${puntoVentaFiscal}-${nuevoNumero.toString().padStart(8, "0")}`

    // Totales: 10% de CADA componente de la factura (neto, IVA, percepciones)
    // → la NC devuelve exactamente el 10% del total facturado.
    const lineas = facturas.map(c => ({
      descripcion: `BONIF. ${DESCUENTO_CONTADO_PCT}% ${c.tipo_comprobante} ${c.numero_comprobante}`,
      precio_neto: r2(Math.abs(c.total_neto) * DESCUENTO_CONTADO_PCT / 100),
    }))
    const totalNeto = r2(lineas.reduce((s, l) => s + l.precio_neto, 0))
    const totalIva = r2(totalNeto * IVA_PCT)
    const percepIva = r2(facturas.reduce((s, c) => s + Math.abs(Number(c.percepcion_iva ?? 0)), 0) * DESCUENTO_CONTADO_PCT / 100)
    const percepIibb = r2(facturas.reduce((s, c) => s + Math.abs(Number(c.percepcion_iibb ?? 0)), 0) * DESCUENTO_CONTADO_PCT / 100)
    const totalTrib = r2(percepIva + percepIibb)
    const totalFactura =
      (Math.round(totalNeto * 100) + Math.round(totalIva * 100) + Math.round(percepIva * 100) + Math.round(percepIibb * 100)) / 100

    // Tributos para ARCA — mismo formato que la factura original
    const tributos = []
    if (percepIva > 0) {
      tributos.push({
        id: TRIBUTO_ID.PERCEPCION_IVA,
        desc: "Percepcion IVA RG 5329",
        baseImp: totalNeto,
        alic: r2((percepIva / totalNeto) * 100),
        importe: percepIva,
      })
    }
    if (percepIibb > 0) {
      tributos.push({
        id: TRIBUTO_ID.PERCEPCION_IIBB,
        desc: "Percepcion IIBB",
        baseImp: totalNeto,
        alic: r2((percepIibb / totalNeto) * 100),
        importe: percepIibb,
      })
    }

    // CbtesAsoc (RG 4540): las facturas que se bonifican
    const cbteAsoc = facturas.map(c => ({
      tipo:   TIPO_CBTE_ARCA[c.tipo_comprobante],
      ptoVta: parseInt(c.numero_comprobante.split("-")[0], 10),
      nro:    parseInt(c.numero_comprobante.split("-")[1], 10),
    }))

    // CAE — si ARCA rechaza, acá se corta y NO se crea nada en DB
    const respCAE = await solicitarCAE({
      ambiente,
      token:     ta.token,
      sign:      ta.sign,
      cuit:      cuitEmpresa,
      ptoVta:    parseInt(puntoVentaFiscal, 10),
      cbteTipo,
      cbteDesde: nuevoNumero,
      cbteHasta: nuevoNumero,
      concepto:  CONCEPTO.PRODUCTOS,
      docTipo:   DOC_TIPO.CUIT,
      docNro:    cliente.cuit.replace(/-/g, ""),
      fecha:     todayArgentina().replace(/-/g, ""),
      impTotal:   totalFactura,
      impTotConc: 0,
      impNeto:    totalNeto,
      impOpEx:    0,
      impIva:     totalIva,
      impTrib:    totalTrib,
      iva: [{ id: IVA_ID.IVA_21, baseImp: totalNeto, importe: totalIva }],
      tributos: tributos.length > 0 ? tributos : undefined,
      cbteAsoc,
      condicionIVAReceptorId: condIvaReceptor,
    })

    const observaciones = `Bonificación contado 10% — facturas ${facturas.map(c => c.numero_comprobante).join(", ")}`

    // Registro durable del CAE antes del insert local
    const logId = await registrarCAEObtenido(supabase, {
      tipo: tipoNC, puntoVenta: puntoVentaFiscal, numero,
      cae: respCAE.cae, vencimientoCae: respCAE.vencimientoCae,
      importe: totalFactura, clienteCuit: cliente.cuit,
      payload: {
        comprobante: {
          tipo_comprobante: tipoNC,
          numero_comprobante: numero,
          punto_venta: puntoVentaFiscal,
          fecha: todayArgentina(),
          cliente_id,
          total_neto: -Math.abs(totalNeto),
          total_iva: -Math.abs(totalIva),
          percepcion_iva: -Math.abs(percepIva),
          percepcion_iibb: -Math.abs(percepIibb),
          total_factura: -Math.abs(totalFactura),
          saldo_pendiente: -Math.abs(totalFactura),
          estado_pago: "pendiente",
          observaciones,
          cae: respCAE.cae,
          vencimiento_cae: respCAE.vencimientoCae,
        },
        detalle: lineas.map(l => ({
          articulo_id: bonificacionId,
          descripcion: l.descripcion,
          cantidad: 1,
          precio_unitario: -Math.abs(l.precio_neto),
          precio_total: -Math.abs(l.precio_neto),
        })),
      },
    })

    let id: string
    try {
      const res = await crearComprobante(supabase, {
        tipo: tipoNC,
        numero,
        puntoVenta: puntoVentaFiscal,
        cliente_id,
        total_neto: totalNeto,
        total_iva: totalIva,
        percepcion_iva: percepIva,
        percepcion_iibb: percepIibb,
        total_factura: totalFactura,
        observaciones,
        cae: respCAE.cae,
        vencimiento_cae: respCAE.vencimientoCae,
      })
      id = res.id
    } catch (insErr: any) {
      await marcarHuerfano(supabase, logId, insErr.message)
      throw new Error(mensajeHuerfano(tipoNC, numero, respCAE.cae))
    }

    await marcarComprobanteCreado(supabase, logId, id)

    await crearDetalle(supabase, id, bonificacionId, lineas)
    await avanzarNumeracion(supabase, tipoNC, puntoVentaFiscal, nuevoNumero)

    if (pago_id) await crearImputacion(supabase, pago_id, id, totalFactura)

    await generarPDFNC(supabase, {
      comprobante_id: id,
      tipo: tipoNC,
      numero,
      puntoVenta: puntoVentaFiscal,
      cliente,
      total_neto: totalNeto,
      total_iva: totalIva,
      percepcion_iva: percepIva,
      percepcion_iibb: percepIibb,
      total_factura: totalFactura,
      cae: respCAE.cae,
      vencimiento_cae: respCAE.vencimientoCae,
      lineas,
      observaciones,
    })

    comprobantesGenerados.push({ id, tipo: tipoNC, numero, total_neto: totalNeto, total_iva: totalIva, total_factura: totalFactura, cae: respCAE.cae })
    totalBonificacion += totalFactura
  }

  await procesarFacturas(facturasA, "NCA")
  await procesarFacturas(facturasB, "NCB")
  await procesarFacturas(facturasC, "NCC")

  // Marcar descuento financiero en kardex de los comprobantes bonificados
  await actualizarDescuentoFinancieroKardex(supabase, comprobante_ids)

  // Débito de comisión por financiero ya cobrado: si la comisión del comprobante ya
  // estaba "cobrada", el 10% financiero reduce la venta real → se debita el 10% de la
  // comisión al vendedor ("debía cobrar 90, cobró 100, nos debe 10").
  await debitarComisionPorFinanciero(supabase, comprobante_ids)

  return {
    total_bonificacion: r2(totalBonificacion),
    comprobantes_generados: comprobantesGenerados,
  }
}

/**
 * Por cada comprobante con comisión ya COBRADA, inserta un ajuste negativo del 10%
 * (descuento financiero). Idempotente: no debita dos veces el mismo comprobante.
 */
async function debitarComisionPorFinanciero(supabase: any, comprobante_ids: string[]) {
  if (!comprobante_ids?.length) return
  const MOTIVO = "Débito por NC financiera 10% (descuento contado) sobre comisión ya cobrada"
  for (const compId of comprobante_ids) {
    const { data: cobradas } = await supabase
      .from("comisiones")
      .select("id, viajante_id, pedido_id, monto, motivo")
      .eq("comprobante_venta_id", compId)
      .eq("tipo", "cobrada")
    if (!cobradas?.length) continue
    // Evitar doble débito
    if (cobradas.some((c: any) => (c.motivo ?? "") === MOTIVO)) continue
    // Solo las comisiones reales (excluye un eventual ajuste previo)
    const totalComision = cobradas
      .filter((c: any) => (c.motivo ?? "") !== MOTIVO)
      .reduce((s: number, c: any) => s + Number(c.monto || 0), 0)
    const debito = r2(totalComision * 0.10)
    if (debito === 0) continue
    await supabase.from("comisiones").insert({
      viajante_id: cobradas[0].viajante_id,
      pedido_id: cobradas[0].pedido_id ?? null,
      comprobante_venta_id: compId,
      tipo: "cobrada",
      monto: -debito,
      porcentaje: 10,
      comprobante_cobrado: true,
      fecha_comprobante_cobrado: nowArgentina(),
      pagado: false,
      motivo: MOTIVO,
    })
  }
}
