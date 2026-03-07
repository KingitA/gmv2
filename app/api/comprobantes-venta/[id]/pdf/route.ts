import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const supabase = await createClient();
    const { id } = await params;

    // Fetch voucher data
    const { data: comprobante, error } = await supabase
      .from("comprobantes_venta")
      .select(`
        *,
        clientes!inner(razon_social, nombre, cuit, direccion),
        pedidos(numero_pedido),
        comprobantes_venta_detalle(
          cantidad,
          precio_unitario,
          subtotal,
          articulos(descripcion, sku)
        )
      `)
      .eq("id", id)
      .single();

    if (error || !comprobante) {
      return NextResponse.json(
        { error: "Comprobante no encontrado" },
        { status: 404 }
      );
    }

    // Generate simple HTML for PDF (browser will handle PDF printing)
    const cliente = comprobante.clientes;
    const detalle = comprobante.comprobantes_venta_detalle || [];

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${comprobante.tipo_comprobante} ${comprobante.numero_comprobante}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 20px;
      font-size: 12px;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      border-bottom: 2px solid #000;
      padding-bottom: 10px;
    }
    .company {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 5px;
    }
    .voucher-type {
      font-size: 24px;
      font-weight: bold;
      margin: 10px 0;
    }
    .voucher-number {
      font-size: 18px;
    }
    .section {
      margin: 20px 0;
    }
    .section-title {
      font-weight: bold;
      margin-bottom: 10px;
      border-bottom: 1px solid #ccc;
      padding-bottom: 5px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    th {
      background-color: #f2f2f2;
      font-weight: bold;
    }
    .text-right {
      text-align: right;
    }
    .totals {
      margin-top: 20px;
      text-align: right;
    }
    .totals table {
      margin-left: auto;
      width: 300px;
    }
    .total-row {
      font-weight: bold;
      font-size: 14px;
    }
    @media print {
      body { margin: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="company">SISTEMA ERP</div>
    <div class="voucher-type">${comprobante.tipo_comprobante}</div>
    <div class="voucher-number">N° ${comprobante.numero_comprobante}</div>
  </div>

  <div class="section">
    <div class="section-title">Datos del Cliente</div>
    <p><strong>Razón Social:</strong> ${cliente.razon_social || cliente.nombre}</p>
    <p><strong>CUIT:</strong> ${cliente.cuit || 'N/A'}</p>
    <p><strong>Dirección:</strong> ${cliente.direccion || ''}</p>
  </div>

  <div class="section">
    <div class="section-title">Información del Comprobante</div>
    <p><strong>Fecha:</strong> ${new Date(comprobante.fecha).toLocaleDateString('es-AR')}</p>
    ${comprobante.pedidos ? `<p><strong>Pedido:</strong> ${comprobante.pedidos.numero_pedido}</p>` : ''}
  </div>

  <div class="section">
    <div class="section-title">Detalle</div>
    <table>
      <thead>
        <tr>
          <th>Código</th>
          <th>Descripción</th>
          <th class="text-right">Cantidad</th>
          <th class="text-right">Precio Unit.</th>
          <th class="text-right">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${detalle.map((item: any) => `
          <tr>
            <td>${item.articulos?.sku || ''}</td>
            <td>${item.articulos?.descripcion || ''}</td>
            <td class="text-right">${Number(item.cantidad).toFixed(2)}</td>
            <td class="text-right">$${Number(item.precio_unitario).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
            <td class="text-right">$${Number(item.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <div class="totals">
    <table>
      <tr>
        <td>Subtotal:</td>
        <td class="text-right">$${Number(comprobante.subtotal || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr>
        <td>IVA:</td>
        <td class="text-right">$${Number(comprobante.iva || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr class="total-row">
        <td>TOTAL:</td>
        <td class="text-right">$${Number(comprobante.total_factura).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr>
        <td>Saldo Pendiente:</td>
        <td class="text-right">$${Number(comprobante.saldo_pendiente).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
      </tr>
    </table>
  </div>

  <div class="no-print" style="margin-top: 30px; text-align: center;">
    <button onclick="window.print()" style="padding: 10px 20px; font-size: 14px; cursor: pointer;">
      Imprimir / Guardar como PDF
    </button>
  </div>
</body>
</html>
    `;

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (error: any) {
    console.error("[v0] Error generating PDF:", error);
    return NextResponse.json(
      { error: error.message || "Error generando PDF" },
      { status: 500 }
    );
  }
}
