/**
 * Los archivos de la orden de compra (PDF y Excel), armados desde la misma `OrdenCompleta`:
 * lo que se descarga es exactamente lo que se adjunta al mail al proveedor.
 * Solo servidor.
 */
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer"
import React, { type JSXElementConstructor, type ReactElement } from "react"
import * as XLSX from "xlsx"
import { OrdenCompraPDF, type OrdenCompraPDFData } from "@/lib/pdf/orden-compra-template"
import { fecha, redondear } from "@/lib/formato"
import type { OrdenCompleta } from "@/lib/compras/orden-completa"

export const nombreArchivoOrden = (numero: string) => `OC_${numero}`.replace(/[^a-zA-Z0-9_-]/g, "_")

/**
 * Condición de pago que se le escribe AL PROVEEDOR: una sola línea.
 * Decisión de Juan (17/11/2026): «la orden de compra debe figurar un solo pedido, 10 en negro
 * 5 en blanco, la orden de compra = 15». Lo que recibe el proveedor (PDF, Excel, mail) no separa
 * "con factura / sin factura" ni muestra IVA sobre una parte: artículos, cantidades, precios y
 * un total. La separación queda adentro (provisión, vencimientos estimados, nuestra pantalla).
 */
export function lineasCondicion(oc: OrdenCompleta): string[] {
  const principal = oc.condiciones.find((c) => c.canal === "blanco") ?? oc.condiciones[0]
  return principal ? [principal.texto] : []
}

export async function datosEmpresa(supabase: any): Promise<OrdenCompraPDFData["empresa"]> {
  const { data: e } = await supabase.from("configuracion_empresa").select("*").limit(1).maybeSingle()
  return e ? { razon_social: e.razon_social, cuit: e.cuit, direccion: e.direccion, telefono: e.telefono, email: e.email, logo_url: e.logo_url } : null
}

export function datosPdfOrden(oc: OrdenCompleta, empresa: OrdenCompraPDFData["empresa"]): OrdenCompraPDFData {
  return {
    orden: {
      numero_orden: oc.orden.numero_orden,
      fecha_orden: oc.orden.fecha_orden || "",
      fecha_estimada_recepcion: oc.orden.fecha_estimada_recepcion,
      condicion_pago: lineasCondicion(oc)[0] ?? null,
      observaciones: oc.orden.observaciones,
    },
    empresa,
    proveedor: { nombre: oc.proveedor.nombre, cuit: oc.proveedor.cuit, direccion: oc.proveedor.direccion, telefono: oc.proveedor.telefono, email: oc.proveedor.email },
    detalle: oc.renglones.map((r) => ({
      ean13: r.ean13, sku: r.sku, descripcion: r.descripcion,
      cantidad: r.cantidad_pedida, tipo_cantidad: r.tipo_cantidad,
      unidades_por_bulto: r.unidades_por_bulto, unidades_totales: r.unidades,
      precio_unitario: r.precio_unitario, descuentos: r.descuentos,
      precio_neto: redondear(r.precio_neto), total_linea: r.total,
    })),
    // un solo total: la suma de los renglones, sin impuestos (ver lineasCondicion)
    totales: { total: oc.totales.neto, unidades: oc.totales.unidades },
    condiciones: lineasCondicion(oc),
  }
}

export async function pdfDeOrden(oc: OrdenCompleta, empresa: OrdenCompraPDFData["empresa"]): Promise<Buffer> {
  const element = React.createElement(OrdenCompraPDF, { data: datosPdfOrden(oc, empresa) }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
  return Buffer.from(await renderToBuffer(element))
}

export function excelDeOrden(oc: OrdenCompleta): Buffer {
  const filas: any[] = oc.renglones.map((r) => ({
    "EAN13": r.ean13 || "",
    "SKU": r.sku || "",
    "Descripción": r.descripcion,
    "Cantidad": r.cantidad_pedida,
    "Se pide por": r.tipo_cantidad === "bulto" ? "bulto" : "unidad",
    "Unid. por bulto": r.unidades_por_bulto,
    "Unidades totales": r.unidades,
    "Precio lista x unidad": r.precio_unitario,
    "Desc 1 %": r.descuentos[0],
    "Desc 2 %": r.descuentos[1],
    "Desc 3 %": r.descuentos[2],
    "Desc 4 %": r.descuentos[3],
    "Precio neto x unidad": redondear(r.precio_neto, 4),
    "Total renglón (sin IVA)": r.total,
  }))
  filas.push({})
  filas.push({ "Descripción": "TOTAL (precios sin IVA)", "Unidades totales": oc.totales.unidades, "Total renglón (sin IVA)": oc.totales.neto })
  filas.push({})
  for (const c of lineasCondicion(oc)) filas.push({ "Descripción": `Condición de pago: ${c}` })
  if (oc.orden.fecha_estimada_recepcion) filas.push({ "Descripción": `Entrega pedida: ${fecha(oc.orden.fecha_estimada_recepcion)}` })

  const ws = XLSX.utils.json_to_sheet(filas)
  ws["!cols"] = [{ wch: 15 }, { wch: 9 }, { wch: 48 }, { wch: 9 }, { wch: 11 }, { wch: 13 }, { wch: 14 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 18 }, { wch: 20 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `OC ${oc.orden.numero_orden}`.slice(0, 31))
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
}
