/**
 * La orden de compra completa, armada UNA vez para la pantalla de detalle, el PDF, el Excel
 * y el mail al proveedor: todos muestran exactamente los mismos números (E-12, E-97).
 * Solo lee.
 */
import { redondear } from "@/lib/formato"
import { unidadesPorBultoDe } from "@/lib/deposito/unidades"
import { acuerdoDeProveedorConLegado, acuerdoDelCanal, normalizarAcuerdo, textoCanal, textoCondicionPago, type AcuerdoPago, type CanalPago } from "@/lib/compras/acuerdo-pago"
import { netoRenglon, precioNeto, regimenDe, totalesOC, unidadesRenglon, type RegimenCompra, type TotalesOC } from "@/lib/compras/oc-totales"
import { ESTADOS_OC_ABIERTA, mailsParaOrden } from "@/lib/compras/orden-compra"

export interface RenglonOrden {
  articulo_id: string
  sku: string | null
  ean13: string | null
  descripcion: string
  cantidad_pedida: number
  tipo_cantidad: "bulto" | "unidad"
  unidades_por_bulto: number
  /** Unidades totales del renglón */
  unidades: number
  /** Precio de lista POR UNIDAD */
  precio_unitario: number
  descuentos: [number, number, number, number]
  /** Precio neto POR UNIDAD (con descuentos), sin redondear */
  precio_neto: number
  /** Precio neto por bulto (precio_neto × unidades por bulto), si se pide por bulto */
  precio_neto_bulto: number | null
  /** Neto del renglón, sin impuestos */
  total: number
  iva_compras: RegimenCompra
  /** Precio neto que tenía el artículo en su ficha al guardar la orden (null en órdenes viejas) */
  precio_neto_ficha: number | null
  /** El precio pactado en la orden no es el de la ficha del artículo */
  difiere_de_ficha: boolean
}

export interface PagoOrden {
  id: string
  canal: CanalPago
  concepto: string
  fecha: string
  monto: number
  forma_pago: string | null
  fecha_validez: string | null
  estado: string
}

export interface OrdenCompleta {
  orden: {
    id: string
    numero_orden: string
    estado: string
    fecha_orden: string | null
    fecha_estimada_recepcion: string | null
    observaciones: string | null
    condicion_pago: string
    acuerdo_pago: AcuerdoPago
    /** La orden no tenía acuerdo guardado (orden vieja): se muestra el de la ficha del proveedor */
    acuerdo_de_ficha: boolean
    creada_por: string | null
    enviada_at: string | null
    enviada_por: string | null
    enviada_a: string | null
    enviada_cc: string | null
    envios: number
    cambio_sin_enviar: boolean
    cancelada_at: string | null
    motivo_cancelacion: string | null
  }
  proveedor: {
    id: string
    nombre: string
    cuit: string | null
    direccion: string | null
    telefono: string | null
    email: string | null
    mail_ordenes_compra: string | null
    mail_vendedor: string | null
    mail_oficina: string | null
    mails_sugeridos: ReturnType<typeof mailsParaOrden>
    percepcion_iva: number
    percepcion_iibb: number
  }
  renglones: RenglonOrden[]
  totales: TotalesOC
  /** Texto de la condición por canal, para mostrar e imprimir */
  condiciones: { canal: CanalPago; texto: string; total: number }[]
  /** Vencimientos estimados que generó la orden (los que se ven en el calendario) */
  pagos: PagoOrden[]
  recepciones: number
  comprobantes: number
  puede: { editar: boolean; enviar: boolean; cancelar: boolean; motivo: string | null }
}

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function cargarOrdenCompleta(supabase: any, ordenId: string): Promise<OrdenCompleta | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ordenId)) return null
  const { data: o, error } = await supabase.from("ordenes_compra").select("*").eq("id", ordenId).maybeSingle()
  if (error) throw error
  if (!o) return null

  const [prov, det, vencs, recs, comps] = await Promise.all([
    supabase.from("proveedores").select("*").eq("id", o.proveedor_id).maybeSingle(),
    supabase.from("ordenes_compra_detalle").select("*, articulo:articulos(sku, ean13, descripcion, unidades_por_bulto, iva_compras)").eq("orden_compra_id", ordenId).limit(2000),
    supabase.from("vencimientos").select("id, canal, concepto, monto, fecha_vencimiento, forma_pago, fecha_validez, estado, es_estimado")
      .eq("referencia_tipo", "orden_compra").eq("referencia_id", ordenId).neq("estado", "cancelado").order("fecha_vencimiento", { ascending: true }),
    supabase.from("recepciones").select("id, estado").eq("orden_compra_id", ordenId),
    supabase.from("comprobantes_compra").select("id, estado").eq("orden_compra_id", ordenId),
  ])
  if (det.error) throw det.error
  const p: any = prov.data || {}

  const usuarios = [o.usuario_creador, o.enviada_por].filter((u) => typeof u === "string" && /^[0-9a-f-]{36}$/i.test(u))
  const { data: us } = usuarios.length ? await supabase.from("usuarios").select("id, nombre").in("id", usuarios) : { data: [] as any[] }
  const nombre = (id: unknown) => (us || []).find((u: any) => u.id === id)?.nombre ?? null

  const filas: any[] = [...(det.data || [])].sort((a, b) =>
    (a.orden ?? 1e9) - (b.orden ?? 1e9) || String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.articulo?.descripcion || "").localeCompare(String(b.articulo?.descripcion || ""), "es"))

  const renglones: RenglonOrden[] = filas.map((d) => {
    const base = {
      cantidad_pedida: num(d.cantidad_pedida),
      tipo_cantidad: d.tipo_cantidad === "unidad" ? "unidad" as const : "bulto" as const,
      precio_unitario: num(d.precio_unitario),
      descuento1: num(d.descuento1), descuento2: num(d.descuento2), descuento3: num(d.descuento3), descuento4: num(d.descuento4),
      // las unidades por bulto son las del artículo HOY (misma regla que el stock y la función SQL)
      unidades_por_bulto: unidadesPorBultoDe(d.articulo?.unidades_por_bulto),
      iva_compras: d.iva_compras || d.articulo?.iva_compras,
    }
    const neto = precioNeto(base)
    const netoFicha = d.precio_neto_ficha != null ? num(d.precio_neto_ficha) : null
    const ean = Array.isArray(d.articulo?.ean13) ? d.articulo.ean13[0] : d.articulo?.ean13
    return {
      articulo_id: d.articulo_id,
      sku: d.articulo?.sku ?? null,
      ean13: ean || null,
      descripcion: d.articulo?.descripcion || "—",
      cantidad_pedida: base.cantidad_pedida,
      tipo_cantidad: base.tipo_cantidad,
      unidades_por_bulto: base.unidades_por_bulto,
      unidades: unidadesRenglon(base),
      precio_unitario: base.precio_unitario,
      descuentos: [base.descuento1, base.descuento2, base.descuento3, base.descuento4],
      precio_neto: neto,
      precio_neto_bulto: base.tipo_cantidad === "bulto" && base.unidades_por_bulto > 1 ? neto * base.unidades_por_bulto : null,
      total: netoRenglon(base),
      iva_compras: regimenDe(base.iva_compras),
      precio_neto_ficha: netoFicha,
      difiere_de_ficha: netoFicha != null && Math.abs(netoFicha - neto) > 0.005,
    }
  })

  const totales = totalesOC(filas.map((d) => ({
    cantidad_pedida: num(d.cantidad_pedida), tipo_cantidad: d.tipo_cantidad, precio_unitario: num(d.precio_unitario),
    descuento1: d.descuento1, descuento2: d.descuento2, descuento3: d.descuento3, descuento4: d.descuento4,
    unidades_por_bulto: d.articulo?.unidades_por_bulto, iva_compras: d.iva_compras || d.articulo?.iva_compras,
  })), p)

  const guardado = normalizarAcuerdo(o.acuerdo_pago)
  const acuerdo = guardado ?? acuerdoDeProveedorConLegado(p)
  const hay = { blanco: totales.total_blanco > 0 || totales.total_negro <= 0, negro: totales.total_negro > 0 }
  const condiciones: OrdenCompleta["condiciones"] = []
  if (hay.blanco) condiciones.push({ canal: "blanco", texto: textoCanal(acuerdoDelCanal(acuerdo, "blanco")), total: totales.total_blanco })
  if (hay.negro) condiciones.push({ canal: "negro", texto: textoCanal(acuerdoDelCanal(acuerdo, "negro")), total: totales.total_negro })

  const recepciones = (recs.data || []).filter((r: any) => r.estado === "en_proceso" || r.estado === "finalizada").length
  const comprobantes = (comps.data || []).filter((c: any) => c.estado !== "esperada").length
  const abierta = (ESTADOS_OC_ABIERTA as readonly string[]).includes(o.estado)
  let motivo: string | null = null
  if (o.estado === "cancelada") motivo = "La orden está cancelada."
  else if (!abierta) motivo = "La orden ya se recibió en depósito."
  else if (recepciones > 0) motivo = "La orden ya tiene una recepción en depósito."
  else if (comprobantes > 0) motivo = `La orden tiene ${comprobantes} comprobante(s) cargado(s): no se puede editar ni cancelar. Para cambiarla, eliminá primero los comprobantes desde la verificación.`

  return {
    orden: {
      id: o.id,
      numero_orden: o.numero_orden,
      estado: o.estado,
      fecha_orden: o.fecha_orden ?? null,
      fecha_estimada_recepcion: o.fecha_estimada_recepcion ? String(o.fecha_estimada_recepcion).slice(0, 10) : null,
      observaciones: o.observaciones ?? null,
      condicion_pago: guardado && o.condicion_pago ? o.condicion_pago : textoCondicionPago(acuerdo, hay),
      acuerdo_pago: acuerdo,
      acuerdo_de_ficha: !guardado,
      creada_por: nombre(o.usuario_creador),
      enviada_at: o.enviada_at ?? null,
      enviada_por: nombre(o.enviada_por),
      enviada_a: o.enviada_a ?? null,
      enviada_cc: o.enviada_cc ?? null,
      envios: o.envios ?? 0,
      cambio_sin_enviar: !!(o.enviada_at && o.editada_at && new Date(o.editada_at).getTime() > new Date(o.enviada_at).getTime()),
      cancelada_at: o.cancelada_at ?? null,
      motivo_cancelacion: o.motivo_cancelacion ?? null,
    },
    proveedor: {
      id: o.proveedor_id,
      nombre: p.nombre || "—",
      cuit: p.cuit ?? null,
      direccion: [p.direccion, p.localidad].filter(Boolean).join(", ") || null,
      telefono: p.telefono_vendedor || p.telefono_oficina || p.telefono || null,
      email: p.email ?? null,
      mail_ordenes_compra: p.mail_ordenes_compra ?? null,
      mail_vendedor: p.mail_vendedor ?? null,
      mail_oficina: p.mail_oficina ?? null,
      mails_sugeridos: mailsParaOrden(p),
      percepcion_iva: num(p.percepcion_iva),
      percepcion_iibb: num(p.percepcion_iibb),
    },
    renglones,
    totales,
    condiciones,
    pagos: (vencs.data || []).filter((v: any) => v.es_estimado).map((v: any) => ({
      id: v.id, canal: v.canal === "negro" ? "negro" : "blanco", concepto: v.concepto, fecha: String(v.fecha_vencimiento).slice(0, 10),
      monto: redondear(num(v.monto)), forma_pago: v.forma_pago ?? null, fecha_validez: v.fecha_validez ?? null, estado: v.estado,
    })),
    recepciones,
    comprobantes,
    puede: {
      // con un comprobante cargado (aunque no esté validado) no se edita ni se cancela: la factura
      // que entra por mail ya convirtió la provisión en deuda (misma regla que oc_guardar / oc_cancelar)
      editar: abierta && recepciones === 0 && comprobantes === 0,
      enviar: abierta,
      cancelar: abierta && recepciones === 0 && comprobantes === 0,
      motivo,
    },
  }
}
