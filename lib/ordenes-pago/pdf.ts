/**
 * Los PDF de una orden de pago, armados desde los datos: la orden (qué se paga, cómo, retenciones
 * y neto) y el certificado de retención de Ganancias RG 830. Los usan las rutas que los muestran
 * (/api/ordenes-pago/[id]/pdf y /certificado) y el mail al proveedor: es el MISMO archivo.
 * Solo servidor.
 */
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer"
import React, { type JSXElementConstructor, type ReactElement } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { OrdenPagoPDF, type OrdenPagoPDFData } from "@/lib/pdf/orden-pago-template"
import { RetencionPDF, type RetencionPDFData } from "@/lib/pdf/retencion-template"
import { fecha } from "@/lib/formato"

export interface ArchivoPdf { nombre: string; buffer: Buffer }

// Nombre completo del tipo de comprobante para el PDF (nada de siglas crudas)
function etiquetaTipoComp(tc?: string | null, conAdquisicion = true): string | null {
  if (!tc) return null
  if (conAdquisicion && tc === "Adquisicion") return "ADQUISICIÓN"
  if (conAdquisicion && tc === "Reversa") return "REVERSA"
  if (tc.startsWith("NC")) return `NOTA CRÉDITO ${tc.slice(2)}`.trim()
  if (tc.startsWith("ND")) return `NOTA DÉBITO ${tc.slice(2)}`.trim()
  if (tc.startsWith("F")) return `FACTURA ${tc.slice(1)}`.trim()
  return tc.toUpperCase()
}

const imputacionesParaBases = (imps: any[]) => (imps || []).map((i: any) => ({
  movimiento_cc_id: i.movimiento_cc_id,
  vencimiento_id: i.vencimiento_id,
  comprobante_compra_id: i.comprobante_compra_id,
  monto_imputado: i.monto_imputado,
  retiene_ganancias: i.retiene_ganancias ?? null,
}))

async function render(elemento: unknown): Promise<Buffer> {
  return renderToBuffer(elemento as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>)
}

/** PDF de la orden de pago. null = la orden no existe. */
export async function pdfOrdenPago(supabase: SupabaseClient, id: string): Promise<ArchivoPdf | null> {
  const [{ data: op }, { data: empresa }] = await Promise.all([
    supabase
      .from("ordenes_pago")
      .select("*, proveedores(nombre, cuit, direccion, localidad), ordenes_pago_detalle(*), ordenes_pago_imputaciones(*)")
      .eq("id", id)
      .single(),
    supabase.from("configuracion_empresa").select("*").limit(1).single(),
  ])
  if (!op) return null

  // Etiquetas de imputaciones (mismo resolver que el cálculo de retención)
  const { data: bases } = await supabase.rpc("op_ganancias_bases", { p_imputaciones: imputacionesParaBases(op.ordenes_pago_imputaciones) })

  const { data: cert } = await supabase
    .from("retenciones_emitidas")
    .select("numero_certificado")
    .eq("orden_pago_id", id)
    .eq("estado", "emitida")
    .limit(1)
    .maybeSingle()

  const detalleMedio = (m: any): string => {
    if (m.medio === "cheque" || m.medio === "cheque_propio") {
      return [m.cheque_banco, m.cheque_numero ? `N° ${m.cheque_numero}` : null,
        m.cheque_fecha_vencimiento ? `vto ${fecha(m.cheque_fecha_vencimiento)}` : null]
        .filter(Boolean).join(" · ") || "Cheque"
    }
    if (m.medio === "transferencia") {
      return [m.banco_destino, m.cbu ? `CBU ${m.cbu}` : null,
        m.numero_transferencia ? `op. ${m.numero_transferencia}` : null]
        .filter(Boolean).join(" · ") || "Transferencia bancaria"
    }
    return m.observaciones || "—"
  }

  const data: OrdenPagoPDFData = {
    empresa: {
      razon_social: empresa?.razon_social ?? "—",
      cuit: empresa?.cuit ?? "—",
      direccion: empresa?.direccion,
      logo_url: empresa?.logo_url,
      condicion_iva: empresa?.condicion_iva,
    },
    op: {
      numero_op: op.numero_op,
      fecha: op.fecha,
      estado: op.estado,
      observaciones: op.observaciones,
      monto_total: Number(op.monto_total ?? 0),
      retencion_ganancias: Number(op.retencion_ganancias ?? 0),
      total_retenciones: Number(op.total_retenciones ?? 0),
      neto_a_pagar: Number(op.neto_a_pagar ?? 0),
      total_creditos: Number(op.total_creditos ?? 0),
      numero_certificado: cert?.numero_certificado ?? null,
    },
    proveedor: {
      nombre: op.proveedores?.nombre ?? "—",
      cuit: op.proveedores?.cuit,
      direccion: op.proveedores?.direccion,
      localidad: op.proveedores?.localidad,
    },
    imputaciones: ((bases as any)?.detalle ?? [])
      .filter((b: any) => Number(b.monto_imputado ?? 0) >= 0)
      .map((b: any) => ({
        etiqueta: b.numero ?? b.etiqueta,
        tipo: etiquetaTipoComp(b.tipo_comprobante),
        fecha: b.fecha_comprobante ?? op.fecha,
        monto: Number(b.monto_imputado ?? 0),
      })),
    creditos: ((bases as any)?.detalle ?? [])
      .filter((b: any) => Number(b.monto_imputado ?? 0) < 0)
      .map((b: any) => ({
        etiqueta: b.numero ?? b.etiqueta,
        tipo: etiquetaTipoComp(b.tipo_comprobante),
        fecha: b.fecha_comprobante ?? null,
        monto: Number(b.monto_imputado ?? 0),
      })),
    medios: (op.ordenes_pago_detalle ?? []).map((m: any) => ({
      medio: m.medio,
      monto: Number(m.monto ?? 0),
      detalle: detalleMedio(m),
    })),
  }

  return { nombre: `OP_${op.numero_op}.pdf`, buffer: await render(React.createElement(OrdenPagoPDF, { data })) }
}

/** PDF del certificado de retención emitido al confirmar la orden. null = la orden no tiene certificado. */
export async function pdfCertificadoRetencion(supabase: SupabaseClient, id: string): Promise<ArchivoPdf | null> {
  const { data: cert } = await supabase
    .from("retenciones_emitidas")
    .select("*, retencion_regimenes(descripcion), proveedores(nombre, cuit, direccion, localidad), ordenes_pago(numero_op, fecha, ordenes_pago_imputaciones(*))")
    .eq("orden_pago_id", id)
    .eq("estado", "emitida")
    .limit(1)
    .maybeSingle()
  if (!cert) return null

  const { data: empresa } = await supabase.from("configuracion_empresa").select("*").limit(1).single()
  const { data: bases } = await supabase.rpc("op_ganancias_bases", { p_imputaciones: imputacionesParaBases(cert.ordenes_pago?.ordenes_pago_imputaciones) })

  const data: RetencionPDFData = {
    empresa: {
      razon_social: empresa?.razon_social ?? "—",
      cuit: empresa?.cuit ?? "—",
      direccion: empresa?.direccion,
      logo_url: empresa?.logo_url,
    },
    cert: {
      numero_certificado: cert.numero_certificado,
      fecha: cert.fecha,
      base_calculo: Number(cert.base_calculo ?? 0),
      alicuota: Number(cert.alicuota ?? 0),
      monto: Number(cert.monto ?? 0),
      regimen_descripcion: cert.retencion_regimenes?.descripcion,
      ajuste_manual: cert.ajuste_manual,
    },
    op: {
      numero_op: cert.ordenes_pago?.numero_op ?? "—",
      fecha: cert.ordenes_pago?.fecha ?? cert.fecha,
    },
    proveedor: {
      nombre: cert.proveedores?.nombre ?? "—",
      cuit: cert.proveedores?.cuit,
      direccion: cert.proveedores?.direccion,
      localidad: cert.proveedores?.localidad,
    },
    // SOLO comprobantes FISCALES (facturas/ND que integran la base y NC que la restan).
    // Adquisiciones, reversas y pagos a cuenta JAMÁS figuran en el certificado.
    comprobantes: ((bases as any)?.detalle ?? [])
      .filter((b: any) => b.tipo === "factura" || b.tipo === "nota_credito")
      .map((b: any) => ({
        etiqueta: [etiquetaTipoComp(b.tipo_comprobante, false), b.numero ?? b.etiqueta].filter(Boolean).join(" "),
        fecha: b.fecha_comprobante ?? cert.ordenes_pago?.fecha,
        monto: Number(b.monto_imputado ?? 0),
      })),
  }

  return { nombre: `RET_${cert.numero_certificado}.pdf`, buffer: await render(React.createElement(RetencionPDF, { data })) }
}
