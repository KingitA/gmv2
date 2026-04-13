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
          descuento_propio
        )
      `)
      .eq("comprobante_id", comprobanteId)

    const comprobanteCompleto = {
      ...comprobante,
      cliente,
      pedido,
      detalle: detalleArray || [],
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

function generarHTMLComprobante(comprobante: any, empresa: any): string {
  const tipoComprobante = ({
    FA: "FACTURA A",
    FB: "FACTURA B",
    FC: "FACTURA C",
    NCA: "NOTA DE CRÉDITO A",
    NCB: "NOTA DE CRÉDITO B",
    NCC: "NOTA DE CRÉDITO C",
    PRES: "PRESUPUESTO",
    REM: "REMITO",
    REV: "REVERSA",
  } as Record<string, string>)[comprobante.tipo_comprobante]

  const hayDescuentos = comprobante.detalle?.some((i: any) => (i.articulos?.descuento_propio || 0) > 0)

  const fmtARS = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const detalleHTML = comprobante.detalle
    ?.map(
      (item: any) => {
        const dto = Number(item.articulos?.descuento_propio || 0)
        const precioFinal = Number(item.precio_unitario || 0)
        // Si tiene descuento propio, el precio "de lista" es el que se muestra inflado
        // precio_lista = precio_final * 100 / (100 - dto)
        const precioLista = dto > 0 ? precioFinal * 100 / (100 - dto) : precioFinal
        return `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 8px; text-align: center;">${item.articulos?.sku || "-"}</td>
      <td style="padding: 8px;">${item.articulos?.descripcion || item.descripcion}</td>
      <td style="padding: 8px; text-align: center;">${item.cantidad}</td>
      ${hayDescuentos ? `
      <td style="padding: 8px; text-align: right; color: #6b7280; text-decoration: ${dto > 0 ? "line-through" : "none"};">$${fmtARS(precioLista)}</td>
      <td style="padding: 8px; text-align: center; color: #dc2626; font-weight: 600;">${dto > 0 ? dto + "%" : "—"}</td>
      <td style="padding: 8px; text-align: right; font-weight: 700;">$${fmtARS(precioFinal)}</td>
      ` : `
      <td style="padding: 8px; text-align: right; font-weight: 600;">$${fmtARS(precioFinal)}</td>
      `}
      <td style="padding: 8px; text-align: right; font-weight: 600;">$${fmtARS(Number(item.precio_total || 0))}</td>
    </tr>`
      },
    )
    .join("")

  const mostrarIVA = comprobante.tipo_comprobante === "FA" || comprobante.tipo_comprobante === "FB"

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tipoComprobante} ${comprobante.numero_comprobante}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: Arial, sans-serif;
      padding: 20px;
      font-size: 12px;
      background: #f5f5f5;
    }
    
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border: 2px solid #000;
      padding: 20px;
    }
    
    .header {
      display: grid;
      grid-template-columns: 1fr 100px 1fr;
      gap: 20px;
      border-bottom: 2px solid #000;
      padding-bottom: 15px;
      margin-bottom: 15px;
      align-items: start;
    }
    
    .empresa h2 {
      font-size: 16px;
      margin-bottom: 5px;
    }
    
    .empresa p {
      margin: 3px 0;
      font-size: 11px;
    }
    
    .tipo-comprobante {
      border: 2px solid #000;
      padding: 15px 10px;
      text-align: center;
      font-size: 32px;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .datos-comprobante {
      text-align: right;
    }
    
    .datos-comprobante h3 {
      font-size: 14px;
      margin-bottom: 5px;
    }
    
    .datos-comprobante p {
      margin: 3px 0;
      font-size: 11px;
    }
    
    .cliente-section {
      border: 1px solid #000;
      padding: 10px;
      margin-bottom: 15px;
    }
    
    .cliente-section h4 {
      margin-bottom: 8px;
      font-size: 12px;
    }
    
    .cliente-section p {
      margin: 3px 0;
      font-size: 11px;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }
    
    th {
      background-color: #f3f4f6;
      padding: 10px;
      text-align: left;
      border: 1px solid #000;
      font-weight: bold;
      font-size: 11px;
    }
    
    td {
      padding: 8px;
      border: 1px solid #e5e7eb;
      font-size: 11px;
    }
    
    .totales {
      margin-top: 20px;
      display: flex;
      justify-content: flex-end;
    }
    
    .totales table {
      width: 300px;
      margin: 0;
    }
    
    .total-final {
      font-size: 14px;
      font-weight: bold;
      background-color: #f3f4f6;
    }
    
    .observaciones {
      margin-top: 20px;
      padding: 10px;
      border: 1px solid #e5e7eb;
      font-size: 11px;
    }
    
    .footer {
      margin-top: 30px;
      padding-top: 15px;
      border-top: 1px solid #000;
      font-size: 10px;
      text-align: center;
      color: #666;
    }
    
    .footer p {
      margin: 3px 0;
    }
    
    .actions {
      position: fixed;
      top: 20px;
      right: 20px;
      display: flex;
      gap: 10px;
      background: white;
      padding: 10px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      z-index: 1000;
    }
    
    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .btn-print {
      background: #3b82f6;
      color: white;
    }
    
    .btn-print:hover {
      background: #2563eb;
    }
    
    @media print {
      body {
        background: white;
        padding: 0;
      }
      
      .actions {
        display: none;
      }
      
      .container {
        border: none;
        max-width: 100%;
      }
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
        <p>Tel: ${empresa?.telefono || "-"}</p>
        <p>${empresa?.condicion_iva || "Responsable Inscripto"}</p>
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
      <h4>DATOS DEL CLIENTE</h4>
      <p><strong>Razón Social:</strong> ${comprobante.cliente?.nombre_razon_social || "Cliente"}</p>
      <p><strong>CUIT:</strong> ${comprobante.cliente?.cuit || "-"}</p>
      <p><strong>Dirección:</strong> ${comprobante.cliente?.direccion || "-"}</p>
      <p><strong>Condición IVA:</strong> ${comprobante.cliente?.condicion_iva || "-"}</p>
    </div>

    <!-- DETALLE DE ITEMS -->
    <table>
      <thead>
        <tr>
          <th style="width: 10%; text-align: center;">Código</th>
          <th style="width: ${hayDescuentos ? "30%" : "40%"};">Descripción</th>
          <th style="width: 8%; text-align: center;">Cantidad</th>
          ${hayDescuentos ? `
          <th style="width: 13%; text-align: right;">P. Lista</th>
          <th style="width: 7%; text-align: center;">Dto.</th>
          <th style="width: 13%; text-align: right;">P. c/Dto.</th>
          ` : `
          <th style="width: 15%; text-align: right;">Precio Unit.</th>
          `}
          <th style="width: 15%; text-align: right;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${detalleHTML}
      </tbody>
    </table>

    <!-- TOTALES -->
    <div class="totales">
      <table>
        ${mostrarIVA
      ? `
        <tr>
          <td style="padding: 5px; text-align: right;"><strong>Subtotal (Neto):</strong></td>
          <td style="padding: 5px; text-align: right;">$${comprobante.total_neto?.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 5px; text-align: right;"><strong>IVA 21%:</strong></td>
          <td style="padding: 5px; text-align: right;">$${comprobante.total_iva?.toFixed(2)}</td>
        </tr>
        ${comprobante.percepcion_iva > 0
        ? `
        <tr>
          <td style="padding: 5px; text-align: right;"><strong>Percepción IVA:</strong></td>
          <td style="padding: 5px; text-align: right;">$${comprobante.percepcion_iva?.toFixed(2)}</td>
        </tr>
        `
        : ""
      }
        ${comprobante.percepcion_iibb > 0
        ? `
        <tr>
          <td style="padding: 5px; text-align: right;"><strong>Percepción IIBB:</strong></td>
          <td style="padding: 5px; text-align: right;">$${comprobante.percepcion_iibb?.toFixed(2)}</td>
        </tr>
        `
        : ""
      }
        `
      : ""
    }
        <tr class="total-final">
          <td style="padding: 10px; text-align: right;"><strong>TOTAL:</strong></td>
          <td style="padding: 10px; text-align: right;"><strong>$${comprobante.total_factura?.toFixed(2)}</strong></td>
        </tr>
      </table>
    </div>

    ${comprobante.observaciones
      ? `
    <div class="observaciones">
      <strong>Observaciones:</strong> ${comprobante.observaciones}
    </div>
    `
      : ""
    }

    <!-- FOOTER -->
    <div class="footer">
      <p>Este comprobante fue generado electrónicamente por el Sistema ERP+CRM</p>
      <p>Para consultas: ${empresa?.email || "info@empresa.com"} | Tel: ${empresa?.telefono || "-"}</p>
    </div>
  </div>
</body>
</html>
  `
}
