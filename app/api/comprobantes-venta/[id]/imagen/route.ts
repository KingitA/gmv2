import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const { id: comprobanteId } = await params

    console.log("[v0] ===== INICIANDO GENERACIÓN DE COMPROBANTE =====")
    console.log("[v0] ID del comprobante:", comprobanteId)

    const supabase = await createClient()

    console.log("[v0] URL de Supabase:", process.env.NEXT_PUBLIC_SUPABASE_URL)

    const { data: comprobanteArray, error: comprobanteError } = await supabase
      .from("comprobantes_venta")
      .select("*")
      .eq("id", comprobanteId)

    console.log("[v0] Resultado de búsqueda:", {
      encontrados: comprobanteArray?.length || 0,
      error: comprobanteError?.message,
    })

    if (comprobanteError) {
      console.error("[v0] Error en consulta:", comprobanteError)
      return NextResponse.json(
        {
          error: "Error al buscar comprobante",
          detalle: comprobanteError.message,
        },
        { status: 500 },
      )
    }

    if (!comprobanteArray || comprobanteArray.length === 0) {
      console.error("[v0] No se encontró el comprobante con ID:", comprobanteId)
      return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 })
    }

    const comprobante = comprobanteArray[0]
    console.log("[v0] Comprobante encontrado:", comprobante.numero_comprobante)

    const { data: cliente } = await supabase
      .from("clientes")
      .select("nombre_razon_social, cuit, direccion, condicion_iva")
      .eq("id", comprobante.cliente_id)
      .single()

    const { data: pedido } = await supabase
      .from("pedidos")
      .select("numero_pedido")
      .eq("id", comprobante.pedido_id)
      .single()

    const { data: detalleArray } = await supabase
      .from("comprobantes_venta_detalle")
      .select(`
        *,
        articulos (
          descripcion,
          sku,
          descuento_propio,
          categoria,
          iva_compras
        )
      `)
      .eq("comprobante_id", comprobanteId)

    const { data: bonificacionesCliente } = await supabase
      .from("bonificaciones")
      .select("tipo, porcentaje, segmento")
      .eq("cliente_id", comprobante.cliente_id)
      .eq("activo", true)
      .in("tipo", ["general", "viajante"])

    const comprobanteCompleto = {
      ...comprobante,
      cliente,
      pedido,
      detalle: detalleArray || [],
      bonificaciones: bonificacionesCliente || [],
    }

    console.log("[v0] Comprobante completo con", detalleArray?.length || 0, "items")

    const { data: empresaArray } = await supabase.from("configuracion_empresa").select("*").limit(1)

    const empresa = empresaArray?.[0] || {
      razon_social: "CIA DE HIGIENE TOTAL S.R.L",
      cuit: "30-71234567-8",
      direccion: "Dirección de la empresa",
      telefono: "Teléfono",
      email: "info@empresa.com",
      condicion_iva: "Responsable Inscripto",
    }

    // Generar HTML para visualizar/imprimir
    const html = generarHTMLComprobante(comprobanteCompleto, empresa)

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    })
  } catch (error: any) {
    console.error("[v0] Error generando comprobante:", error)
    return NextResponse.json({ error: error.message || "Error generando comprobante" }, { status: 500 })
  }
}

function detectarSegmento(art: { categoria?: string | null; iva_compras?: string | null }): string {
  const cat = (art.categoria || "").toUpperCase()
  if (cat.includes("PERFUMERIA") || cat.includes("PERFUMERÍA"))
    return art.iva_compras === "adquisicion_stock" ? "perf0" : "perf_plus"
  return "limpieza_bazar"
}

function generarHTMLComprobante(comprobante: any, empresa: any): string {
  const tipoLabel: Record<string, string> = {
    FA: "FACTURA A", FB: "FACTURA B", FC: "FACTURA C",
    NCA: "NOTA DE CRÉDITO A", NCB: "NOTA DE CRÉDITO B", NCC: "NOTA DE CRÉDITO C",
    PRES: "PRESUPUESTO", REM: "REMITO", REV: "REVERSA",
  }
  const tipoComprobante = tipoLabel[comprobante.tipo_comprobante] || comprobante.tipo_comprobante

  const fmtARS = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const mostrarIVA = comprobante.tipo_comprobante === "FA" || comprobante.tipo_comprobante === "FB"

  // Split lines: positive = articles, negative = discounts
  const lineasPositivas: any[] = (comprobante.detalle || []).filter((i: any) => Number(i.precio_unitario || 0) > 0)
  const lineasNegativas: any[] = (comprobante.detalle || []).filter((i: any) => Number(i.precio_unitario || 0) < 0)

  // Separate bonif mercadería (shown as last article) from general/viajante (shown in footer)
  const lineasBonifMerc = lineasNegativas.filter((i: any) => (i.descripcion || "").includes("Mercad"))
  const lineasDescFooter = lineasNegativas.filter((i: any) => !(i.descripcion || "").includes("Mercad"))

  // Detect D1/D2 from bonificaciones loaded for this comprobante
  const bonificaciones: any[] = comprobante.bonificaciones || []

  // Detect the segment from the first regular article
  const firstRegular = lineasPositivas.find((i: any) => i.articulos?.categoria !== undefined || i.articulos?.iva_compras !== undefined)
  const segmento = firstRegular?.articulos ? detectarSegmento(firstRegular.articulos) : "limpieza_bazar"

  const d1 = bonificaciones.find((b: any) => b.tipo === "general" && (!b.segmento || b.segmento === segmento))
  const d2 = bonificaciones.find((b: any) => b.tipo === "viajante" && (!b.segmento || b.segmento === segmento))

  const hayD1 = !!d1
  const hayD2 = !!d2

  // Column widths
  const colDesc = hayD1 || hayD2 ? "28%" : "38%"

  const detalleHTML = [...lineasPositivas, ...lineasBonifMerc].map((item: any) => {
    const precio = Number(item.precio_unitario || 0)
    const total = Number(item.precio_total || 0)
    const esBonifMerc = precio < 0  // comes from lineasBonifMerc
    const label = item.articulos?.descripcion || item.descripcion || "-"
    const sku = item.articulos?.sku || "-"
    return `
    <tr style="border-bottom: 1px solid #e5e7eb;${esBonifMerc ? " background: #fef3c7;" : ""}">
      <td style="padding: 7px 8px; text-align: center; font-size: 10px; color: #555;">${esBonifMerc ? "" : sku}</td>
      <td style="padding: 7px 8px; font-weight: ${esBonifMerc ? "600" : "normal"}; color: ${esBonifMerc ? "#92400e" : "inherit"};">${label}</td>
      <td style="padding: 7px 8px; text-align: center;">${esBonifMerc ? "—" : item.cantidad}</td>
      ${hayD1 ? `<td style="padding: 7px 8px; text-align: center; color: #dc2626; font-weight: 600;">${esBonifMerc ? "100%" : (d1.porcentaje + "%")}</td>` : ""}
      ${hayD2 ? `<td style="padding: 7px 8px; text-align: center; color: #7c3aed; font-weight: 600;">${esBonifMerc ? "" : (d2.porcentaje + "%")}</td>` : ""}
      <td style="padding: 7px 8px; text-align: right;">${esBonifMerc ? "—" : ("$" + fmtARS(Math.abs(precio)))}</td>
      <td style="padding: 7px 8px; text-align: right; font-weight: 600; color: ${esBonifMerc ? "#dc2626" : "inherit"};">$${fmtARS(Math.abs(total))}</td>
    </tr>`
  }).join("")

  // Footer totals
  const subtotalArticulos = lineasPositivas.reduce((s: number, i: any) => s + Number(i.precio_total || 0), 0)
  const totalBonifMerc = lineasBonifMerc.reduce((s: number, i: any) => s + Math.abs(Number(i.precio_total || 0)), 0)
  const totalDescs = lineasDescFooter.reduce((s: number, i: any) => s + Math.abs(Number(i.precio_total || 0)), 0)

  const lineasFooterHTML = lineasDescFooter.map((i: any) => `
        <tr>
          <td style="padding: 5px 8px; text-align: right; color: #6b7280;">${i.descripcion || i.articulos?.descripcion || "Descuento"}:</td>
          <td style="padding: 5px 8px; text-align: right; color: #dc2626;">−$${fmtARS(Math.abs(Number(i.precio_total || 0)))}</td>
        </tr>`).join("")

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tipoComprobante} ${comprobante.numero_comprobante}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; background: #f5f5f5; }
    .container { max-width: 820px; margin: 0 auto; background: white; border: 2px solid #000; padding: 20px; }
    .header { display: grid; grid-template-columns: 1fr 80px 1fr; gap: 16px; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 12px; align-items: start; }
    .empresa h2 { font-size: 15px; margin-bottom: 4px; }
    .empresa p { margin: 2px 0; font-size: 10px; }
    .tipo-comprobante { border: 2px solid #000; padding: 12px 8px; text-align: center; font-size: 28px; font-weight: bold; display: flex; align-items: center; justify-content: center; }
    .datos-comprobante { text-align: right; }
    .datos-comprobante h3 { font-size: 13px; margin-bottom: 4px; }
    .datos-comprobante p { margin: 2px 0; font-size: 10px; }
    .cliente-section { border: 1px solid #000; padding: 8px 10px; margin-bottom: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; }
    .cliente-section p { margin: 2px 0; font-size: 10px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th { background-color: #1e293b; color: white; padding: 8px; text-align: left; font-size: 10px; font-weight: 600; letter-spacing: 0.03em; }
    th.right { text-align: right; }
    th.center { text-align: center; }
    td { padding: 7px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
    .totales { margin-top: 16px; display: flex; justify-content: flex-end; }
    .totales table { width: 280px; margin: 0; border: 1px solid #e5e7eb; }
    .totales td { border-bottom: 1px solid #f1f5f9; padding: 5px 8px; font-size: 11px; }
    .total-final { background-color: #1e293b; color: white; font-size: 13px; font-weight: bold; }
    .total-final td { color: white !important; border-bottom: none; }
    .observaciones { margin-top: 16px; padding: 8px; border: 1px solid #e5e7eb; font-size: 10px; }
    .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #000; font-size: 9px; text-align: center; color: #888; }
    .footer p { margin: 2px 0; }
    .actions { position: fixed; top: 20px; right: 20px; display: flex; gap: 10px; background: white; padding: 10px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); z-index: 1000; }
    .btn { padding: 10px 20px; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .btn-print { background: #3b82f6; color: white; }
    .btn-print:hover { background: #2563eb; }
    @media print {
      body { background: white; padding: 0; }
      .actions { display: none; }
      .container { border: none; max-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="actions">
    <button class="btn btn-print" onclick="window.print()">🖨️ Imprimir</button>
  </div>

  <div class="container">
    <!-- HEADER -->
    <div class="header">
      <div class="empresa">
        <h2>${empresa?.razon_social || "CIA DE HIGIENE TOTAL S.R.L"}</h2>
        <p>CUIT: ${empresa?.cuit || "30-71234567-8"}</p>
        <p>${empresa?.direccion || "Dirección de la empresa"}</p>
        <p>Tel: ${empresa?.telefono || "-"} · ${empresa?.condicion_iva || "Responsable Inscripto"}</p>
      </div>
      <div class="tipo-comprobante">
        ${comprobante.tipo_comprobante.charAt(comprobante.tipo_comprobante.length - 1) || "X"}
      </div>
      <div class="datos-comprobante">
        <h3>${tipoComprobante}</h3>
        <p><strong>Nº:</strong> ${comprobante.numero_comprobante}</p>
        <p><strong>Fecha:</strong> ${new Date(comprobante.fecha).toLocaleDateString("es-AR")}</p>
        ${comprobante.pedido ? `<p><strong>Pedido:</strong> ${comprobante.pedido.numero_pedido}</p>` : ""}
      </div>
    </div>

    <!-- DATOS DEL CLIENTE -->
    <div class="cliente-section">
      <p><strong>Razón Social:</strong> ${comprobante.cliente?.nombre_razon_social || "Cliente"}</p>
      <p><strong>CUIT:</strong> ${comprobante.cliente?.cuit || "-"}</p>
      <p><strong>Dirección:</strong> ${comprobante.cliente?.direccion || "-"}</p>
      <p><strong>Condición IVA:</strong> ${comprobante.cliente?.condicion_iva || "-"}</p>
    </div>

    <!-- DETALLE DE ITEMS -->
    <table>
      <thead>
        <tr>
          <th style="width: 9%;" class="center">Código</th>
          <th style="width: ${colDesc};">Descripción</th>
          <th style="width: 7%;" class="center">Cant.</th>
          ${hayD1 ? `<th style="width: 7%;" class="center">D1<br><span style="font-weight:400;font-size:9px;">General</span></th>` : ""}
          ${hayD2 ? `<th style="width: 7%;" class="center">D2<br><span style="font-weight:400;font-size:9px;">Viajante</span></th>` : ""}
          <th style="width: 14%;" class="right">P. Neto</th>
          <th style="width: 14%;" class="right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${detalleHTML}
      </tbody>
    </table>

    <!-- TOTALES -->
    <div class="totales">
      <table>
        <tr>
          <td style="text-align: right;">Subtotal artículos:</td>
          <td style="text-align: right;">$${fmtARS(subtotalArticulos)}</td>
        </tr>
        ${totalBonifMerc > 0 ? `
        <tr>
          <td style="text-align: right; color: #92400e;">Bonif. Mercadería 100%:</td>
          <td style="text-align: right; color: #dc2626;">−$${fmtARS(totalBonifMerc)}</td>
        </tr>` : ""}
        ${lineasFooterHTML}
        ${(totalBonifMerc > 0 || totalDescs > 0) ? `
        <tr style="border-top: 1px solid #cbd5e1;">
          <td style="text-align: right; font-weight: 600;">Subtotal c/desc.:</td>
          <td style="text-align: right; font-weight: 600;">$${fmtARS(subtotalArticulos - totalBonifMerc - totalDescs)}</td>
        </tr>` : ""}
        ${mostrarIVA ? `
        <tr>
          <td style="text-align: right; color: #6b7280;">Neto 21%:</td>
          <td style="text-align: right; color: #6b7280;">$${fmtARS(Number(comprobante.total_neto || 0))}</td>
        </tr>
        <tr>
          <td style="text-align: right; color: #6b7280;">IVA 21%:</td>
          <td style="text-align: right; color: #6b7280;">$${fmtARS(Number(comprobante.total_iva || 0))}</td>
        </tr>` : ""}
        ${(comprobante.percepcion_iva || 0) > 0 ? `
        <tr>
          <td style="text-align: right; color: #6b7280;">Percepción IVA:</td>
          <td style="text-align: right; color: #6b7280;">$${fmtARS(Number(comprobante.percepcion_iva))}</td>
        </tr>` : ""}
        ${(comprobante.percepcion_iibb || 0) > 0 ? `
        <tr>
          <td style="text-align: right; color: #6b7280;">Percepción IIBB:</td>
          <td style="text-align: right; color: #6b7280;">$${fmtARS(Number(comprobante.percepcion_iibb))}</td>
        </tr>` : ""}
        <tr class="total-final">
          <td style="text-align: right; padding: 10px 8px;"><strong>TOTAL:</strong></td>
          <td style="text-align: right; padding: 10px 8px;"><strong>$${fmtARS(Number(comprobante.total_factura || 0))}</strong></td>
        </tr>
      </table>
    </div>

    ${comprobante.observaciones ? `
    <div class="observaciones"><strong>Observaciones:</strong> ${comprobante.observaciones}</div>` : ""}

    <!-- FOOTER -->
    <div class="footer">
      <p>Comprobante generado por Sistema ERP+CRM</p>
      <p>${empresa?.email || "info@empresa.com"} | Tel: ${empresa?.telefono || "-"}</p>
    </div>
  </div>
</body>
</html>`
}
