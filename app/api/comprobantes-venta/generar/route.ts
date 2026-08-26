import { createAdminClient } from "@/lib/supabase/admin"
import { NextResponse } from "next/server"
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { requireAuth } from "@/lib/auth"
import {
  calcularPrecioFinal,
  articuloToDatosArticulo,
  type DatosLista,
  type MetodoFacturacion,
  type DescuentoTipado,
} from "@/lib/pricing/calculator"
import { generarBonificacionContado } from "@/lib/comprobantes/generar-bonificacion"
import { insertarKardex, vincularKardexAComprobante, distribuirPercepcionesKardex } from "@/lib/kardex/insertar-kardex"
import { determinarTipoFactura, mensajeErrorCondicionIva } from "@/lib/comprobantes/tipo-comprobante"
import { generarYSubirPDF, buildPDFData, generarQRBase64, buildQRUrl, buildSnapshot } from "@/lib/pdf/generar"
import { REQUIERE_CAE, TIPO_CBTE_ARCA, DOC_TIPO, CONCEPTO, IVA_ID, TRIBUTO_ID, condicionIvaReceptorId, type AmbienteARCA } from "@/lib/arca/tipos"
import { calcularPercepciones } from "@/lib/comprobantes/calcular-percepciones"
import { resolverAlicuotaIIBB } from "@/lib/comprobantes/percepcion-iibb"
import { registrarCAEObtenido, marcarComprobanteCreado, marcarHuerfano, mensajeHuerfano } from "@/lib/arca/registro-cae"
import { obtenerTAConCache } from "@/lib/arca/cache"
import { ultimoAutorizado, solicitarCAE } from "@/lib/arca/wsfev1"
import { generarRemitosParaPedido, type ResultadoRemitos } from "@/lib/remitos/generar-remito"
import { postearLibroConAviso } from "@/lib/cuenta-corriente/postear-libro"

type CondicionSegmento = {
  lista_precio_id: string | null
  metodo_facturacion: string | null
  dto_general_pct: number | null
  dto_viajante_pct: number | null
  dto_mercaderia_pct: number | null
}
type CondicionProveedor = CondicionSegmento & { proveedor_id: string }
type CondicionMarca = CondicionSegmento & { marca_id: string }
const CONDICION_PROVEEDOR_COLS =
  "proveedor_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct"
const CONDICION_MARCA_COLS =
  "marca_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct"

export async function POST(request: Request) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const supabase = createAdminClient()
    const body = await request.json()
    const { pedido_id, pago_contado } = body

    // ─── 1. Obtener pedido con cliente y detalles ───
    // Prices are already stored in pedidos_detalle (calculated when the order was created).
    // precio_final = precio al cliente con IVA incluido (siempre)
    // precio_base  = precio neto antes de IVA
    const { data: pedido, error: pedidoError } = await supabase
      .from("pedidos")
      .select(`
        *,
        cliente:clientes!pedidos_cliente_id_fkey(
          id, nombre_razon_social, condicion_iva, metodo_facturacion,
          cuit, direccion, exento_iva, exento_iibb, provincia, percepcion_iibb, vendedor_id
        ),
        detalle:pedidos_detalle(
          id, articulo_id, cantidad, precio_final, precio_base, es_bonificado, estado_item, metodo_facturacion_item,
          precio_lista, descuento_propio_pct, bonif_general_pct, bonif_viajante_pct,
          articulo:articulos!pedidos_detalle_articulo_id_fkey(
            id, descripcion, sku, iva_ventas, categoria, iva_compras, marca_id, proveedor_id, segmento_precio
          )
        )
      `)
      .eq("id", pedido_id)
      .single()

    if (pedidoError || !pedido) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 })
    }

    // ─── Guard: el pedido ya tiene comprobantes vigentes → no regenerar ───
    // Evita la doble emisión por doble click / UI desactualizada. Para volver
    // a generar hay que anular los comprobantes existentes primero.
    const { data: yaEmitidos } = await supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, numero_comprobante")
      .eq("pedido_id", pedido_id)
      .is("anulado_en", null)
    if (yaEmitidos?.length) {
      return NextResponse.json(
        {
          error: `El pedido ya tiene comprobantes emitidos: ${yaEmitidos
            .map((c: any) => `${c.tipo_comprobante} ${c.numero_comprobante}`)
            .join(", ")}. Para regenerar, primero anulá los existentes.`,
          error_code: "PEDIDO_YA_FACTURADO",
          comprobantes: yaEmitidos,
        },
        { status: 409 },
      )
    }

    // ─── Validaciones del cliente antes de continuar ───
    if (!pedido.cliente.cuit || pedido.cliente.cuit.trim() === "") {
      return NextResponse.json({
        error: `El cliente "${pedido.cliente.nombre_razon_social}" no tiene CUIT configurado. Sin CUIT no se puede emitir un comprobante fiscal.`,
        error_code: "CLIENTE_SIN_CUIT",
        cliente_id: pedido.cliente.id,
        cliente_nombre: pedido.cliente.nombre_razon_social,
      }, { status: 422 })
    }

    // ─── 2. Determinar método de facturación ───
    const metodoRaw = pedido.metodo_facturacion_pedido || pedido.cliente.metodo_facturacion || "Final"
    const metodoFacturacion: MetodoFacturacion =
      metodoRaw === "Factura (21% IVA)" || metodoRaw === "Factura" ? "Factura" :
      metodoRaw === "Presupuesto" ? "Presupuesto" : "Final"

    // ─── Condiciones por proveedor (Feature 1): override del pedido > ficha del cliente ───
    // El proveedor sólo identifica QUÉ mercadería recibe estas condiciones. Su mercadería
    // se factura SIEMPRE en comprobante aparte y con la lista/método/descuentos del proveedor.
    const condProvMap = new Map<string, CondicionProveedor>()
    {
      const { data: cliCond } = await supabase
        .from("cliente_proveedor_condicion")
        .select(CONDICION_PROVEEDOR_COLS)
        .eq("cliente_id", pedido.cliente.id)
      for (const r of cliCond || []) condProvMap.set(r.proveedor_id, r as CondicionProveedor)
      const { data: pedCond } = await supabase
        .from("pedido_proveedor_condicion")
        .select(CONDICION_PROVEEDOR_COLS)
        .eq("pedido_id", pedido_id)
      for (const r of pedCond || []) condProvMap.set(r.proveedor_id, r as CondicionProveedor)
    }
    // Condiciones por MARCA (ganan sobre proveedor): override del pedido > ficha del cliente
    const condMarcaMap = new Map<string, CondicionMarca>()
    {
      const { data: cliCond } = await supabase
        .from("cliente_marca_condicion")
        .select(CONDICION_MARCA_COLS)
        .eq("cliente_id", pedido.cliente.id)
      for (const r of cliCond || []) condMarcaMap.set(r.marca_id, r as CondicionMarca)
      const { data: pedCond } = await supabase
        .from("pedido_marca_condicion")
        .select(CONDICION_MARCA_COLS)
        .eq("pedido_id", pedido_id)
      for (const r of pedCond || []) condMarcaMap.set(r.marca_id, r as CondicionMarca)
    }
    // Resuelve la condición de segmento de un ítem/artículo: MARCA gana sobre PROVEEDOR.
    const segCondDe = (marcaId: string | null, proveedorId: string | null): { cond: CondicionSegmento | null; segKey: string } => {
      const m = marcaId ? condMarcaMap.get(marcaId) : null
      if (m) return { cond: m, segKey: `marca:${marcaId}` }
      const p = proveedorId ? condProvMap.get(proveedorId) : null
      if (p) return { cond: p, segKey: `prov:${proveedorId}` }
      return { cond: null, segKey: "" }
    }
    const metodoDesdeRaw = (raw: string | null | undefined): MetodoFacturacion =>
      raw === "Factura (21% IVA)" || raw === "Factura" ? "Factura" :
      raw === "Presupuesto" ? "Presupuesto" : "Final"

    // ─── 3. Build items using stored prices ───
    // precio_final = lo que el cliente paga (IVA incluido en presupuesto, neto en factura)
    // Para factura A: discriminamos IVA retrocalculando desde el precio almacenado.
    type ItemCalculado = {
      detalle_id: string
      articulo_id: string
      descripcion: string
      sku: string
      cantidad: number
      precioUnitario: number    // precio en la línea del comprobante
      precioAntesIva: number    // neto (= precioUnitario para factura)
      precioBase: number        // precio neto real antes de IVA (det.precio_base)
      precioFinal: number       // precio con IVA al cliente (det.precio_final)
      ivaUnitario: number       // IVA por unidad
      ivaIncluido: boolean
      subtotalNeto: number
      subtotalIva: number
      subtotalFinal: number
      descNegroAplicado: boolean
      vaEnComprobante: "factura" | "presupuesto"
      segmento: string
      esBonificado: boolean
      // Desglose por línea (para el detalle del comprobante + PDF)
      precioListaDisplay: number    // P.Lista bruto pre-cascada
      descuentoPropioPct: number
      bonifGeneralPct: number
      bonifViajantePct: number
      marcaId: string | null
      proveedorId: string | null
      ivaCompras: string | null
      ivaVentas: string | null
    }

    const IVA_RATE = 0.21

    const itemsCalculados: ItemCalculado[] = []
    for (const det of pedido.detalle) {
      const art = det.articulo
      if (!art) continue
      if (det.estado_item === "FALTANTE" || (det.cantidad ?? 0) <= 0) continue

      // El método del ítem se decidió al CREAR el pedido (resolverListaSegmento: incluye
      // la condición por segmento y por proveedor) y quedó en metodo_facturacion_item.
      // Se usa ese; si falta (ítems viejos/agregados aparte), se cae al del pedido.
      const condItem = segCondDe((art as any).marca_id ?? null, (art as any).proveedor_id ?? null).cond
      const metodoRawItem = det.metodo_facturacion_item || condItem?.metodo_facturacion || metodoRaw
      const metodoItem: MetodoFacturacion = metodoDesdeRaw(metodoRawItem)
      const esPresupuesto = art.iva_ventas === "presupuesto" || metodoItem === "Presupuesto"
      const vaEnComprobante: "factura" | "presupuesto" =
        metodoItem === "Presupuesto" ? "presupuesto" :
        metodoItem === "Factura"     ? "factura"     :
        esPresupuesto ? "presupuesto" : "factura"

      // precio_final = precio final al cliente (IVA siempre incluido)
      // precio_base  = precio neto antes de IVA (YA con oferta+general+viajante aplicados)
      const esBonificado = det.es_bonificado === true
      const precioAlCliente = det.precio_final || 0
      const precioNeto = det.precio_base > 0
        ? det.precio_base
        : round2(precioAlCliente / (1 + IVA_RATE))

      let precioUnitario: number
      let ivaUnitario: number
      let ivaIncluido: boolean

      if (esBonificado) {
        // Mercadería bonificada: línea a $0 (P.Lista real, 100% Of.). No suma a la boleta.
        precioUnitario = 0
        ivaUnitario    = 0
        ivaIncluido    = vaEnComprobante !== "factura"
      } else if (vaEnComprobante === "factura") {
        // Factura: la línea muestra el neto, el IVA se discrimina al pie
        // precio_final = $100 (con IVA) → línea = $82.64, IVA = $17.36
        precioUnitario = precioNeto
        ivaUnitario    = round2(precioAlCliente - precioNeto)
        ivaIncluido    = false
      } else {
        // Presupuesto/Reversa: precio final con IVA incluido, sin discriminar.
        // Para perfumería se usa precio_base porque precio_final puede estar mal guardado
        // en pedidos anteriores al fix del coeficiente IVA (iva_compras no afecta perfumería).
        const esPerf = art.segmento_precio === "perfumeria"
        precioUnitario = esPerf ? precioNeto : precioAlCliente
        ivaUnitario    = 0
        ivaIncluido    = true
      }

      const subtotalNeto  = round2(precioUnitario * det.cantidad)
      const subtotalIva   = round2(ivaUnitario * det.cantidad)
      const subtotalFinal = round2(subtotalNeto + subtotalIva)

      const segmento = detectarSegmento(art)
      const precioBase = det.precio_base > 0 ? det.precio_base : round2(precioAlCliente / (1 + IVA_RATE))
      // P.Lista bruto a mostrar: el guardado en pedidos_detalle, o el neto si no hay.
      const precioListaDisplay = (det.precio_lista && det.precio_lista > 0)
        ? det.precio_lista
        : (vaEnComprobante === "factura" ? precioBase : precioAlCliente)
      itemsCalculados.push({
        detalle_id: det.id,
        articulo_id: det.articulo_id,
        descripcion: art.descripcion || "",
        sku: art.sku || "",
        cantidad: det.cantidad,
        precioUnitario,
        precioAntesIva: precioUnitario,
        precioBase,
        precioFinal: precioAlCliente,
        ivaUnitario,
        ivaIncluido,
        subtotalNeto,
        subtotalIva,
        subtotalFinal,
        descNegroAplicado: false,
        vaEnComprobante,
        segmento,
        esBonificado,
        precioListaDisplay,
        descuentoPropioPct: Number(det.descuento_propio_pct ?? 0),
        bonifGeneralPct: Number(det.bonif_general_pct ?? 0),
        bonifViajantePct: Number(det.bonif_viajante_pct ?? 0),
        marcaId: (art as any).marca_id ?? null,
        proveedorId: (art as any).proveedor_id ?? null,
        ivaCompras: art.iva_compras ?? null,
        ivaVentas: art.iva_ventas ?? null,
      })
    }

    // ─── 4. Cargar bonificaciones general + viajante del cliente ───
    const { data: bonificacionesCliente } = await supabase
      .from("bonificaciones")
      .select("tipo, porcentaje, segmento")
      .eq("cliente_id", pedido.cliente.id)
      .eq("activo", true)
      .in("tipo", ["general", "viajante"])

    // ─── Agrupar items por (vaEnComprobante, perfil de descuento) ───
    // La mercadería bonificada NO se agrupa: se reparte luego entre los comprobantes
    // normales (no-especial) proporcional al neto de cada uno, como ÚLTIMO ítem.
    // Clave de grupo de un ítem: vaEnComprobante + perfil de descuento + segmento (marca/prov).
    // Cada segmento (marca o proveedor con condición) → su propio comprobante aparte.
    const keyDeItem = (item: typeof itemsCalculados[number]) => {
      const { cond, segKey } = segCondDe(item.marcaId, item.proveedorId)
      const bonifProfile = cond
        ? `seg:${cond.dto_general_pct || 0}:${cond.dto_viajante_pct || 0}`
        : getBonifProfile(item.segmento, bonificacionesCliente || [])
      return { key: `${item.vaEnComprobante}__${bonifProfile}__${segKey}`, esSegmento: !!cond }
    }

    const grupos = new Map<string, typeof itemsCalculados>()
    const itemsBonificados: typeof itemsCalculados = []
    for (const item of itemsCalculados) {
      const { key, esSegmento } = keyDeItem(item)
      // La mercadería bonificada de un SEGMENTO va a su propio comprobante (como último ítem).
      // La de nivel pedido (sin segmento) se reparte luego entre los comprobantes normales.
      if (item.esBonificado && !esSegmento) { itemsBonificados.push(item); continue }
      if (!grupos.has(key)) grupos.set(key, [])
      grupos.get(key)!.push(item)
    }

    // Repartir la mercadería bonificada de NIVEL PEDIDO entre los grupos NORMALES (sin
    // segmento), proporcional al neto de cada grupo. Cada artículo bonificado se divide y
    // se agrega al FINAL de cada comprobante normal.
    if (itemsBonificados.length > 0) {
      const grupoEsProv = (items: typeof itemsCalculados) =>
        !!(items[0] && segCondDe(items[0].marcaId, items[0].proveedorId).cond)
      const netoGrupo = (items: typeof itemsCalculados) => round2(items.reduce((s, i) => s + i.subtotalNeto, 0))
      const normales = [...grupos.values()].filter(g => !grupoEsProv(g))
      const netos = normales.map(netoGrupo)
      const netoTotal = round2(netos.reduce((s, n) => s + n, 0))
      if (normales.length > 0 && netoTotal > 0) {
        for (const bonif of itemsBonificados) {
          const Q = Math.abs(bonif.cantidad)
          let asignado = 0
          for (let i = 0; i < normales.length; i++) {
            const esUltimo = i === normales.length - 1
            const qtyG = esUltimo ? (Q - asignado) : Math.round(Q * netos[i] / netoTotal)
            asignado += qtyG
            if (qtyG > 0) normales[i].push({ ...bonif, cantidad: qtyG })
          }
        }
      } else if (normales.length === 0 && grupos.size > 0) {
        // Sin grupos normales (todo especial): la bonificación va al primero como último ítem.
        ;[...grupos.values()][0].push(...itemsBonificados)
      }
    }

    const tipoFactura = determinarTipoFactura(pedido.cliente.condicion_iva)
    if (!tipoFactura) {
      return NextResponse.json({
        error: mensajeErrorCondicionIva(pedido.cliente.nombre_razon_social),
        error_code: "CLIENTE_SIN_CONDICION_IVA",
        cliente_id: pedido.cliente.id,
        cliente_nombre: pedido.cliente.nombre_razon_social,
      }, { status: 422 })
    }

    // ─── Configuración ARCA ───
    // Se lee una vez y se reutiliza para todos los comprobantes del pedido.
    const { data: empresaConfig } = await supabase
      .from('configuracion_empresa')
      .select('cuit, arca_ambiente, arca_punto_venta')
      .single()

    let arcaParams: ArcaParams | null = null
    const certDisponible = !!(process.env.ARCA_CERTIFICADO && process.env.ARCA_CLAVE_PRIVADA)

    // Determinar qué tipos de comprobante se van a generar realmente.
    // PRES y REV son documentos internos — NUNCA deben contactar ARCA.
    // Solo buscamos el TA si al menos un grupo genera FA o FB.
    const tiposReales = [...grupos.keys()].map(key => {
      const vaEnComp = key.split("__")[0]
      return vaEnComp === "factura" ? tipoFactura : "PRES"
    })
    const algunGrupoNecesitaCAE = tiposReales.some(t => t !== null && REQUIERE_CAE.has(t))

    // Bloqueo duro: si hay que pedir CAE y falta el certificado o la config,
    // se aborta TODO. Jamás degradar a comprobante sin CAE / PV interno.
    if (algunGrupoNecesitaCAE && (!certDisponible || !empresaConfig)) {
      return NextResponse.json(
        {
          error: !certDisponible
            ? 'Certificado ARCA no configurado (ARCA_CERTIFICADO / ARCA_CLAVE_PRIVADA). No se puede emitir comprobantes fiscales — avisá al administrador.'
            : 'configuracion_empresa no encontrada. No se puede emitir comprobantes fiscales.',
          error_code: 'ARCA_NO_CONFIGURADO',
        },
        { status: 500 },
      )
    }

    if (certDisponible && empresaConfig && algunGrupoNecesitaCAE) {
      // Única fuente del PV fiscal: configuracion_empresa. Sin default — si falta, error explícito.
      if (!empresaConfig.arca_punto_venta) {
        return NextResponse.json(
          { error: 'configuracion_empresa.arca_punto_venta no está configurado. No se puede emitir comprobantes fiscales.' },
          { status: 500 },
        )
      }
      const ambiente = (empresaConfig.arca_ambiente ?? 'produccion') as AmbienteARCA
      const ta = await obtenerTAConCache(supabase, ambiente)
      arcaParams = {
        ambiente,
        puntoVenta: String(empresaConfig.arca_punto_venta).padStart(4, '0'),
        token:       ta.token,
        sign:        ta.sign,
        cuitEmpresa: (empresaConfig.cuit ?? '').replace(/-/g, ''),
      }
    }

    const comprobantesGenerados: Array<any & { _segmento?: string }> = []

    // ─── 5. Generar un comprobante por grupo ───
    // Los descuentos general/viajante YA vienen aplicados en el neto por línea
    // (pedidos_detalle), y la mercadería bonificada se emite como línea a $0.
    // No hay más líneas negativas de descuento al pie del comprobante.
    for (const [key, grupoItems] of grupos) {
      const vaEnComp = key.split("__")[0] as "factura" | "presupuesto"
      const tipo = vaEnComp === "factura" ? tipoFactura : "PRES"
      const segmentoGrupo = grupoItems[0].segmento

      const resultado = await generarComprobante(
        supabase, pedido, grupoItems, tipo, auth.user.id, arcaParams,
      )
      comprobantesGenerados.push({ ...resultado, _segmento: segmentoGrupo, _items: grupoItems })
    }

    // ── Kardex: vincular entradas existentes o crear si no existen ────────────
    // Entries may already exist from createPedido (session client, may have failed
    // silently due to RLS). Here we use admin client so it always succeeds.
    const { count: kardexCount } = await supabase
      .from('kardex')
      .select('id', { count: 'exact', head: true })
      .eq('pedido_id', pedido_id)

    if ((kardexCount ?? 0) > 0) {
      // Entries exist: link each comprobante ONLY with the kardex lines of the
      // articles it contains (a pedido facturado en varios comprobantes antes
      // vinculaba todas las líneas al primero).
      for (const comp of comprobantesGenerados) {
        if (!comp.id) continue
        const esP = comp.tipo_comprobante === 'PRES'
        await vincularKardexAComprobante(
          supabase, pedido_id, comp.id, comp.tipo_comprobante,
          comp.numero, esP ? 'Presupuesto' : 'Factura', esP ? 'NEGRO' : 'BLANCO',
          auth.user.id,
          (comp._items as ItemCalculado[]).map((i) => i.articulo_id).filter(Boolean),
        )
      }
    } else {
      // No entries: create them now with full comprobante data (admin client bypasses RLS)
      for (const comp of comprobantesGenerados) {
        if (!comp.id) continue
        const esP = comp.tipo_comprobante === 'PRES'
        const colorDinero = esP ? 'NEGRO' : 'BLANCO'
        const metodoFact = esP ? 'Presupuesto' : 'Factura'
        for (const item of (comp._items as ItemCalculado[])) {
          const ivaPct = !item.ivaIncluido && item.ivaUnitario > 0 ? 21 : 0
          await insertarKardex(supabase, {
            tipo_movimiento: 'venta',
            fecha: nowArgentina(),
            articulo_id: item.articulo_id,
            cantidad: item.cantidad,
            precio_lista: item.precioBase,
            precio_unitario_final: item.precioFinal,
            iva_porcentaje: ivaPct,
            iva_monto_unitario: item.ivaUnitario,
            iva_incluido: item.ivaIncluido,
            subtotal_neto: round2(item.precioBase * item.cantidad),
            subtotal_iva: item.subtotalIva,
            subtotal_total: item.subtotalFinal,
            cliente_id: pedido.cliente.id,
            vendedor_id: (pedido.cliente as any).vendedor_id ?? null,
            pedido_id: pedido_id,
            comprobante_venta_id: comp.id,
            tipo_comprobante: comp.tipo_comprobante,
            numero_comprobante: comp.numero,
            metodo_facturacion: metodoFact,
            color_dinero: colorDinero,
            va_en_comprobante: item.vaEnComprobante,
            provincia_destino: (pedido.cliente as any).provincia ?? null,
            facturador_id: auth.user.id,
          }, {
            sku: item.sku,
            descripcion: item.descripcion,
            categoria: item.segmento,
            marca_id: item.marcaId,
            proveedor_id: item.proveedorId,
            iva_compras: item.ivaCompras,
            iva_ventas: item.ivaVentas,
          })
        }
      }
    }

    // ── Distribuir percepciones IVA/IIBB del comprobante entre ítems del kardex
    const percIva = comprobantesGenerados.reduce((s: number, c: any) => s + (c.percepcion_iva ?? 0), 0)
    const percIibb = comprobantesGenerados.reduce((s: number, c: any) => s + (c.percepcion_iibb ?? 0), 0)
    if (percIva > 0 || percIibb > 0) {
      await distribuirPercepcionesKardex(supabase, pedido_id, percIva, percIibb)
    }

    // ── Vincular comisiones a SU comprobante (por artículo) ──────────────────
    // Antes: todas al primero — mismo bug que el vínculo de kardex.
    for (const comp of comprobantesGenerados) {
      if (!comp.id) continue
      const artIds = (comp._items as ItemCalculado[]).map((i) => i.articulo_id).filter(Boolean)
      if (!artIds.length) continue
      await supabase
        .from("comisiones")
        .update({ comprobante_venta_id: comp.id })
        .eq("pedido_id", pedido_id)
        .is("comprobante_venta_id", null)
        .in("articulo_id", artIds)
    }

    // ─── 6. Total del pedido (informativo) ───
    // La comisión del viajante ya se calculó con la fórmula única al crear el pedido
    // (base = neto final, tasa = comisión% − viajante%, una sola vez). No se reduce de nuevo.
    const totalPedido = itemsCalculados.reduce((sum, i) => sum + i.subtotalFinal, 0)

    // ─── 7. Generar bonificación pago contado si corresponde ───
    // Aplica si se pidió en la facturación (pago_contado) O si el pedido fue
    // anticipado con 10% contado (pago_contado_10): en ese caso la NC se imputa
    // al pago anticipo (anticipo_pago_id) para netear el saldo a favor.
    let bonificacion = null
    const contadoPorAnticipo = !!(pedido as any).pago_contado_10
    if ((pago_contado || contadoPorAnticipo) && comprobantesGenerados.length > 0) {
      const comprobanteIds = comprobantesGenerados.map((c: any) => c.id).filter(Boolean)
      bonificacion = await generarBonificacionContado(supabase, {
        cliente_id: pedido.cliente.id,
        comprobante_ids: comprobanteIds,
        pago_id: contadoPorAnticipo ? (pedido as any).anticipo_pago_id : undefined,
      })
      // Limpiar el flag para no regenerar la NC si se reintenta la facturación
      if (contadoPorAnticipo) {
        await supabase.from("pedidos").update({ pago_contado_10: false }).eq("id", pedido_id)
      }
    }

    // ─── 8. Marcar el pedido como FACTURADO acá, en el servidor ───
    // Antes lo hacía la pantalla desde el navegador en un segundo paso; si ese paso
    // no llegaba (permisos, pestaña cerrada, red), el comprobante quedaba emitido
    // pero el pedido seguía "impreso" y editable. Con comprobante emitido, el pedido
    // queda bloqueado sí o sí (lib/pedidos/estados.ts).
    if (comprobantesGenerados.length > 0) {
      const { error: estadoErr } = await supabase
        .from("pedidos").update({ estado: "facturado" }).eq("id", pedido_id)
      if (estadoErr) console.error("[generar] No se pudo marcar el pedido como facturado:", estadoErr)
    }

    // ─── 9. Generar PDFs y subirlos al bucket ───
    // Se hace en background — si falla no bloquea el comprobante ya emitido con CAE.
    const { data: empresaData } = await supabase.from('configuracion_empresa').select('*').single()
    const { data: marcasTbl } = await supabase.from('marcas').select('id, descripcion').eq('activo', true)
    const marcaDesc = new Map((marcasTbl ?? []).map((m: any) => [m.id, m.descripcion ?? '']))

    for (const comp of comprobantesGenerados) {
      if (!comp.id) continue
      try {
        const { data: compFull } = await supabase
          .from('comprobantes_venta')
          .select('*, clientes(*), pedidos(numero_pedido, condicion_entrega, vendedores(nombre)), comprobantes_venta_detalle(*, articulos(descripcion, sku, descuento_propio, marca_id, rubro_id, categoria_id, subcategoria_id))')
          .eq('id', comp.id)
          .single()

        if (!compFull) continue

        // Generar QR ARCA (RG 4892/2020) — solo para comprobantes con CAE
        let qrDataUrl: string | undefined
        let qrUrl: string | undefined
        if (compFull.cae && compFull.clientes?.cuit && compFull.punto_venta) {
          try {
            const qrParams = {
              cuit:       empresaData?.cuit ?? '',
              ptoVta:     compFull.punto_venta,
              tipoCmp:    compFull.tipo_comprobante,
              nroCmp:     compFull.numero_comprobante,
              importe:    Math.abs(Number(compFull.total_factura ?? 0)),
              fecha:      compFull.fecha,
              tipoDocRec: 80,
              nroDocRec:  compFull.clientes.cuit,
              cae:        compFull.cae,
            }
            qrUrl     = buildQRUrl(qrParams)
            qrDataUrl = await generarQRBase64(qrParams)
          } catch (qrErr: any) {
            console.error('[QR] Error generando QR:', qrErr.message)
          }
        }

        const pdfData = buildPDFData({
          comprobante:    compFull,
          cliente:        compFull.clientes,
          empresa:        empresaData,
          detalle:        compFull.comprobantes_venta_detalle ?? [],
          pedido:         compFull.pedidos,
          bonificaciones: bonificacionesCliente ?? [],
          marcaDesc,
          qrDataUrl,
        })

        const { pdfUrl, pdfPath, pdfHash } = await generarYSubirPDF(supabase, pdfData)
        const snapshot = buildSnapshot(pdfData)

        await supabase
          .from('comprobantes_venta')
          .update({
            pdf_url:              pdfUrl,
            pdf_path:             pdfPath,
            pdf_hash:             pdfHash,
            fecha_generacion_pdf: new Date().toISOString(),
            estado_pdf:           'generado',
            pdf_snapshot:         snapshot,
            qr_url:               qrUrl ?? null,
          })
          .eq('id', comp.id)
      } catch (pdfErr: any) {
        console.error('[Generar PDF] Error en comprobante', comp.id, pdfErr.message)
        // Marcar error — el comprobante ya tiene CAE, el PDF requiere intervención manual
        await supabase
          .from('comprobantes_venta')
          .update({ estado_pdf: 'error' })
          .eq('id', comp.id)
          .catch(() => {})
      }
    }

    // ─── 10. Remitos según condición de entrega ───
    // entregamos_nosotros → orig+dup · transporte → orig+dup+trip · mostrador → sin remito.
    // Nunca bloquea la facturación: los comprobantes ya tienen CAE. Si falla,
    // queda registrado en remitos.errores y se reintenta con POST /api/remitos/generar.
    let remitos: ResultadoRemitos = { generados: [], omitidos: [], errores: [] }
    try {
      remitos = await generarRemitosParaPedido(supabase, pedido_id, auth.user.id)
    } catch (remErr: any) {
      console.error('[Remitos] Error generando remitos del pedido', pedido_id, remErr.message)
      remitos.errores.push(remErr.message)
    }

    // Asientos de libro mayor que no entraron: advertencia visible, nunca silenciosa
    const advertenciasLibro = comprobantesGenerados
      .map((c: any) => c.cc_aviso)
      .filter(Boolean)

    return NextResponse.json({
      success: true,
      comprobantes: comprobantesGenerados,
      metodo_facturacion: metodoFacturacion,
      total_pedido: round2(totalPedido),
      bonificacion_contado: bonificacion,
      remitos,
      ...(advertenciasLibro.length ? { advertencias_libro_mayor: advertenciasLibro } : {}),
    })
  } catch (error: any) {
    console.error("[Generar Comprobantes] Error:", error)
    return NextResponse.json({ error: error.message || "Error generando comprobantes" }, { status: 500 })
  }
}

// ─── Helpers ───────────────────────────────────────────

function detectarSegmento(art: { segmento_precio?: string | null; iva_ventas?: string | null }): string {
  if (art.segmento_precio === "perfumeria")
    return art.iva_ventas === "presupuesto" ? "perf0" : "perf_plus"
  return "limpieza_bazar"
}

function getBonifProfile(itemSegmento: string, bonificaciones: any[]): string {
  const aplicables = bonificaciones.filter((b: any) => !b.segmento || b.segmento === itemSegmento)
  return aplicables
    .sort((a: any, b: any) => a.tipo.localeCompare(b.tipo))
    .map((b: any) => `${b.tipo}:${b.porcentaje}`)
    .join("|")
}


function round2(n: number): number {
  return Math.round(n * 100) / 100
}

interface ArcaParams {
  ambiente:    AmbienteARCA
  puntoVenta:  string
  token:       string
  sign:        string
  cuitEmpresa: string
}

async function generarComprobante(
  supabase: any,
  pedido: any,
  items: Array<{
    articulo_id: string; descripcion: string; sku: string
    cantidad: number; precioUnitario: number; precioAntesIva: number
    ivaUnitario: number; ivaIncluido: boolean
    subtotalNeto: number; subtotalIva: number; subtotalFinal: number
    descNegroAplicado: boolean
    esBonificado?: boolean
    precioListaDisplay?: number
    descuentoPropioPct?: number
    bonifGeneralPct?: number
    bonifViajantePct?: number
  }>,
  tipoComprobante: string,
  creadoPor?: string,
  arca?: ArcaParams | null,
) {
  // Determinar punto de venta: fiscal (ARCA) o interno (PRES/REM/REV)
  const esFiscal   = REQUIERE_CAE.has(tipoComprobante)
  const puntoVenta = esFiscal && arca ? arca.puntoVenta : '0001'

  // ─── Numeración ───
  const { data: numeracion, error: numError } = await supabase
    .from('numeracion_comprobantes')
    .select('*')
    .eq('tipo_comprobante', tipoComprobante)
    .eq('punto_venta', puntoVenta)
    .single()

  if (numError) throw new Error(
    `Numeración no encontrada para ${tipoComprobante} punto de venta ${puntoVenta}. ` +
    `Verificá la tabla numeracion_comprobantes.`
  )

  // ─── Sincronizar con ARCA antes de asignar el número ───
  // FECompUltimoAutorizado garantiza que nuestro número local no diverge de ARCA.
  let nuevoNumero = numeracion.ultimo_numero + 1

  if (esFiscal && arca) {
    const cbteTipo = TIPO_CBTE_ARCA[tipoComprobante]
    if (!cbteTipo) throw new Error(`Tipo de comprobante ${tipoComprobante} no tiene código ARCA definido.`)

    const ultimoEnArca = await ultimoAutorizado(
      arca.ambiente, arca.token, arca.sign, arca.cuitEmpresa,
      parseInt(puntoVenta, 10), cbteTipo,
    )

    if (ultimoEnArca !== numeracion.ultimo_numero) {
      // Sincronizamos nuestra DB con el estado real de ARCA
      await supabase
        .from('numeracion_comprobantes')
        .update({ ultimo_numero: ultimoEnArca })
        .eq('tipo_comprobante', tipoComprobante)
        .eq('punto_venta', puntoVenta)
      nuevoNumero = ultimoEnArca + 1
    }
  }

  const numeroComprobante = `${puntoVenta}-${nuevoNumero.toString().padStart(8, '0')}`

  // ─── Calcular totales ───
  const esPresupuesto = tipoComprobante === 'PRES'
  let totalNeto = 0
  let totalIva  = 0

  for (const item of items) {
    if (esPresupuesto) {
      totalNeto += item.subtotalNeto
    } else {
      totalNeto += round2(item.precioAntesIva * item.cantidad)
      totalIva  += item.subtotalIva
    }
  }
  totalNeto = round2(totalNeto)
  totalIva  = round2(totalIva)
  // Los descuentos general/viajante ya vienen en el neto por línea; la mercadería
  // bonificada es una línea a $0. El neto declarado = Σ(líneas). No hay líneas negativas.

  // ─── Percepciones (IVA 3% RG 5329/2023 + IIBB según padrón provincial) ───
  // Se calculan sobre el neto YA descontado (incluido el mínimo de $3.000)
  // La alícuota IIBB se resuelve: override manual → padrón vigente → alícuota general
  const tasaIIBBResuelta = esFiscal ? await resolverAlicuotaIIBB(supabase, pedido.cliente) : 0
  const percResult = calcularPercepciones(totalNeto, { ...pedido.cliente, percepcion_iibb: tasaIIBBResuelta }, esFiscal)
  const percIVA    = percResult.percepcion_iva
  const percIIBB   = percResult.percepcion_iibb
  const totalTrib  = round2(percIVA + percIIBB)
  const totalFactura = (
    Math.round(totalNeto * 100) +
    Math.round(totalIva  * 100) +
    Math.round(totalTrib * 100)
  ) / 100

  // ─── Solicitar CAE a ARCA (solo comprobantes fiscales) ───
  let cae: string | null = null
  let vencimientoCae: string | null = null

  if (esFiscal && arca) {
    const clienteCuit = (pedido.cliente.cuit ?? '').replace(/-/g, '')
    const fecha = todayArgentina().replace(/-/g, '') // YYYYMMDD

    // RG 5616/2024: condición IVA del receptor es obligatoria — sin mapeo no se emite
    const condIvaReceptor = condicionIvaReceptorId(pedido.cliente.condicion_iva)
    if (condIvaReceptor === null) {
      throw new Error(
        `El cliente "${pedido.cliente.nombre_razon_social ?? pedido.cliente.nombre ?? ''}" tiene condición de IVA ` +
        `"${pedido.cliente.condicion_iva ?? 'sin cargar'}" que no mapea a ningún código de receptor de ARCA (RG 5616). ` +
        `Corregí la condición de IVA del cliente antes de emitir.`
      )
    }

    // Armar array de tributos (percepciones) para ARCA
    const tributos = []
    if (percIVA > 0) {
      tributos.push({ id: TRIBUTO_ID.PERCEPCION_IVA, desc: 'Percepcion IVA RG 5329', baseImp: totalNeto, alic: percResult.tasa_iva_aplicada, importe: percIVA })
    }
    if (percIIBB > 0) {
      tributos.push({ id: TRIBUTO_ID.PERCEPCION_IIBB, desc: 'Percepcion IIBB', baseImp: totalNeto, alic: percResult.tasa_iibb_aplicada, importe: percIIBB })
    }

    const respCAE = await solicitarCAE({
      ambiente:    arca.ambiente,
      token:       arca.token,
      sign:        arca.sign,
      cuit:        arca.cuitEmpresa,
      ptoVta:      parseInt(puntoVenta, 10),
      cbteTipo:    TIPO_CBTE_ARCA[tipoComprobante],
      cbteDesde:   nuevoNumero,
      cbteHasta:   nuevoNumero,
      concepto:    CONCEPTO.PRODUCTOS,
      docTipo:     DOC_TIPO.CUIT,
      docNro:      clienteCuit,
      fecha,
      impTotal:    totalFactura,
      impTotConc:  0,
      impNeto:     totalNeto,
      impOpEx:     0,
      impIva:      totalIva,
      impTrib:     totalTrib,
      iva: totalIva > 0
        ? [{ id: IVA_ID.IVA_21, baseImp: totalNeto, importe: totalIva }]
        : [{ id: IVA_ID.EXENTO,  baseImp: totalNeto, importe: 0 }],
      tributos: tributos.length > 0 ? tributos : undefined,
      condicionIVAReceptorId: condIvaReceptor,
    })

    cae            = respCAE.cae
    vencimientoCae = respCAE.vencimientoCae

    if (respCAE.observaciones.length) {
      console.warn(`[ARCA] Obs ${tipoComprobante} ${numeroComprobante}:`, respCAE.observaciones.join(' | '))
    }
  }

  // ─── Crear comprobante en DB (con CAE si corresponde) ───
  const comprobanteInsert = {
    tipo_comprobante:  tipoComprobante,
    numero_comprobante: numeroComprobante,
    punto_venta:       puntoVenta,
    fecha:             todayArgentina(),
    cliente_id:        pedido.cliente_id,
    pedido_id:         pedido.id,
    total_neto:        totalNeto,
    total_iva:         totalIva,
    percepcion_iva:    percIVA,
    percepcion_iibb:   percIIBB,
    total_factura:     totalFactura,
    saldo_pendiente:   totalFactura,
    estado_pago:       'pendiente',
    ...(cae            ? { cae }                                  : {}),
    ...(vencimientoCae ? { vencimiento_cae: vencimientoCae }      : {}),
    ...(creadoPor      ? { creado_por: creadoPor }                : {}),
  }

  // Detalle: una línea por ítem. Los descuentos general/viajante ya están en el
  // neto; la mercadería bonificada es una línea a $0 (P.Lista real, 100% Of.).
  // Se persiste el desglose por línea (precio_lista + % de cada descuento) para el
  // PDF y para reconstrucción/auditoría AFIP.
  const detallePayload = items.map(item => ({
    articulo_id:          item.articulo_id,
    descripcion:          item.descripcion,
    cantidad:             item.cantidad,
    precio_unitario:      item.precioUnitario,
    precio_total:         item.subtotalNeto,
    precio_lista:         item.precioListaDisplay ?? null,
    descuento_propio_pct: item.descuentoPropioPct ?? 0,
    bonif_general_pct:    item.bonifGeneralPct ?? 0,
    bonif_viajante_pct:   item.bonifViajantePct ?? 0,
    es_bonificado:        item.esBonificado === true,
  }))

  // Registro durable del CAE antes del insert (solo fiscales con CAE)
  const logId = cae ? await registrarCAEObtenido(supabase, {
    tipo: tipoComprobante, puntoVenta, numero: numeroComprobante,
    cae, vencimientoCae, importe: totalFactura,
    clienteCuit: pedido.cliente.cuit ?? null,
    payload: { comprobante: comprobanteInsert, detalle: detallePayload },
  }) : null

  const { data: comprobante, error: compError } = await supabase
    .from('comprobantes_venta')
    .insert(comprobanteInsert)
    .select('id, percepcion_iva, percepcion_iibb')
    .single()

  if (compError) {
    if (cae) {
      await marcarHuerfano(supabase, logId, compError.message)
      throw new Error(mensajeHuerfano(tipoComprobante, numeroComprobante, cae))
    }
    throw new Error('Error creando comprobante: ' + compError.message)
  }

  await marcarComprobanteCreado(supabase, logId, comprobante.id)

  const detalleInserts = detallePayload.map(d => ({ ...d, comprobante_id: comprobante.id }))

  const { error: detError } = await supabase.from('comprobantes_venta_detalle').insert(detalleInserts)
  if (detError) throw new Error('Error creando detalle: ' + detError.message)

  // ─── Libro mayor (cuenta corriente del cliente) ───
  // El comprobante incrementa la deuda del cliente: debe = total_factura.
  // Fuente única del saldo (v_saldo_clientes). Si falla, no se aborta el
  // comprobante (ya tiene CAE) pero la advertencia viaja en la respuesta.
  const ccAviso = await postearLibroConAviso(supabase, {
    p_cliente_id:         pedido.cliente_id,
    p_tipo_movimiento:    tipoComprobante === 'PRES' ? 'presupuesto' : 'factura',
    p_debe:               totalFactura,
    p_haber:              0,
    p_referencia_tipo:    'comprobante_venta',
    p_referencia_id:      comprobante.id,
    p_numero_comprobante: numeroComprobante,
    p_observaciones:      `${tipoComprobante} ${numeroComprobante}`,
    p_usuario_id:         creadoPor ?? null,
  }, `${tipoComprobante} ${numeroComprobante}`)

  // ─── Stock ───
  for (const item of items) {
    await supabase.rpc('increment_stock_actual', {
      p_articulo_id: item.articulo_id,
      p_cantidad:    -item.cantidad,
    }).then(() => {})

    await supabase.from('movimientos_stock').insert({
      articulo_id:     item.articulo_id,
      tipo_movimiento: 'salida',
      cantidad:        item.cantidad,
      precio_unitario: item.precioUnitario,
      fecha_movimiento: nowArgentina(),
      observaciones:   `Venta - ${tipoComprobante} ${numeroComprobante}`,
    })
  }

  // ─── Avanzar numeración ───
  await supabase
    .from('numeracion_comprobantes')
    .update({ ultimo_numero: nuevoNumero })
    .eq('tipo_comprobante', tipoComprobante)
    .eq('punto_venta', puntoVenta)

  return {
    tipo:              'comprobante',
    id:                comprobante.id,
    tipo_comprobante:  tipoComprobante,
    numero:            numeroComprobante,
    total_neto:        totalNeto,
    total_iva:         totalIva,
    total:             totalFactura,
    percepcion_iva:    comprobante.percepcion_iva  ?? 0,
    percepcion_iibb:   comprobante.percepcion_iibb ?? 0,
    cae:               cae ?? null,
    vencimiento_cae:   vencimientoCae ?? null,
    cc_aviso:          ccAviso,
  }
}
