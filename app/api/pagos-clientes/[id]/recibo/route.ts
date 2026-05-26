import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

const fmtARS = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtFecha = (d: string | null | undefined) => {
  if (!d) return ""
  return new Date(d).toLocaleDateString("es-AR")
}

function labelMetodo(det: any, cajaMap: Map<string, string>, bancoMap: Map<string, string>): string {
  switch (det.tipo_pago) {
    case "efectivo":
      return "Efectivo"
    case "transferencia": {
      const banco = det.cuenta_bancaria_id ? bancoMap.get(det.cuenta_bancaria_id) || "" : ""
      const fecha = det.fecha_transferencia ? ` — ${fmtFecha(det.fecha_transferencia)}` : ""
      const ref = det.numero_comprobante_pago ? ` Nro. ${det.numero_comprobante_pago}` : ""
      return `Transferencia${banco ? ` (${banco})` : ""}${fecha}${ref}`
    }
    case "cheque": {
      const num = det.numero_cheque ? ` ${det.numero_cheque}` : ""
      const banco = det.banco ? ` (${det.banco})` : ""
      const fecha = det.fecha_cheque ? ` — vto. ${fmtFecha(det.fecha_cheque)}` : ""
      return `Cheque${num}${banco}${fecha}`
    }
    case "deposito": {
      const banco = det.cuenta_bancaria_id ? bancoMap.get(det.cuenta_bancaria_id) || "" : ""
      return `Depósito${banco ? ` — ${banco}` : ""}`
    }
    default:
      return det.tipo_pago || ""
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id } = await params

    // Cargar pago completo
    const { data: pago, error } = await supabase
      .from("pagos_clientes")
      .select(`
        *,
        clientes(nombre, razon_social, cuit, direccion),
        pagos_detalle(*),
        retenciones(*),
        recibos(numero_recibo, fecha, monto_total)
      `)
      .eq("id", id)
      .single()

    if (error || !pago) {
      return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 })
    }

    // Cargar imputaciones con comprobantes
    const { data: imputaciones } = await supabase
      .from("imputaciones")
      .select(`
        monto_imputado,
        comprobante:comprobantes_venta(tipo_comprobante, numero_comprobante, fecha, total_factura)
      `)
      .eq("pago_id", id)

    // Cargar cajas y bancos para labels
    const detalles: any[] = pago.pagos_detalle || []
    const cajaIds = detalles.filter((d) => d.caja_id).map((d) => d.caja_id)
    const bancoIds = detalles.filter((d) => d.cuenta_bancaria_id).map((d) => d.cuenta_bancaria_id)

    const [{ data: cajas }, { data: bancos }] = await Promise.all([
      cajaIds.length
        ? supabase.from("cajas_financieras").select("id, nombre").in("id", cajaIds)
        : Promise.resolve({ data: [] }),
      bancoIds.length
        ? supabase.from("cuentas_bancarias").select("id, nombre, banco").in("id", bancoIds)
        : Promise.resolve({ data: [] }),
    ])

    const cajaMap = new Map((cajas || []).map((c: any) => [c.id, c.nombre]))
    const bancoMap = new Map((bancos || []).map((b: any) => [b.id, `${b.banco} — ${b.nombre}`]))

    // Cargar items de depósito
    const depositoDetalleIds = detalles
      .filter((d) => d.tipo_pago === "deposito")
      .map((d) => d.id)

    let depositoItemsMap: Map<string, any[]> = new Map()
    if (depositoDetalleIds.length) {
      const { data: ditems } = await supabase
        .from("pago_deposito_items")
        .select("*")
        .in("pago_detalle_id", depositoDetalleIds)
      for (const it of ditems || []) {
        if (!depositoItemsMap.has(it.pago_detalle_id)) depositoItemsMap.set(it.pago_detalle_id, [])
        depositoItemsMap.get(it.pago_detalle_id)!.push(it)
      }
    }

    const cliente = pago.clientes as any
    const recibo = (pago.recibos as any[])?.[0] || pago.recibos
    const numeroRecibo = recibo?.numero_recibo || pago.id.slice(0, 8).toUpperCase()
    const fechaRecibo = fmtFecha(pago.fecha_pago)
    const totalRetenciones = (pago.retenciones || []).reduce(
      (s: number, r: any) => s + Number(r.monto),
      0
    )
    const totalMetodos = detalles.reduce((s: number, d: any) => s + Number(d.monto), 0)
    const netoCobrado = totalMetodos - totalRetenciones

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Recibo ${numeroRecibo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 24px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; margin-bottom: 16px; }
    .company { font-size: 18px; font-weight: bold; }
    .recibo-title { font-size: 22px; font-weight: bold; text-align: right; }
    .recibo-num { font-size: 14px; color: #555; text-align: right; }
    .section { margin-bottom: 14px; }
    .section-title { font-weight: bold; font-size: 10px; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 3px; margin-bottom: 6px; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f5f5f5; font-size: 10px; font-weight: bold; text-align: left; padding: 5px 7px; border: 1px solid #ddd; }
    td { padding: 5px 7px; border: 1px solid #ddd; vertical-align: top; }
    .tr { text-align: right; }
    .totals-table { margin-left: auto; width: 280px; margin-top: 8px; }
    .totals-table td { border: none; padding: 3px 6px; }
    .totals-table .total-row td { font-weight: bold; font-size: 13px; border-top: 1px solid #1a1a1a; padding-top: 6px; }
    .badge { display: inline-block; background: #f0f0f0; border-radius: 3px; padding: 1px 5px; font-size: 10px; }
    .firma-area { margin-top: 40px; display: flex; justify-content: space-between; }
    .firma-line { border-top: 1px solid #555; width: 180px; text-align: center; padding-top: 4px; font-size: 10px; color: #555; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>

<div class="header">
  <div>
    <div class="company">GM DISTRIBUIDORA</div>
    <div style="font-size:11px; color:#555; margin-top:3px;">Fecha: ${fechaRecibo}</div>
  </div>
  <div>
    <div class="recibo-title">RECIBO DE PAGO</div>
    <div class="recibo-num">${numeroRecibo}</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Datos del cliente</div>
  <table style="border:none;">
    <tr>
      <td style="border:none; padding:2px 0; width:50%;"><strong>Cliente:</strong> ${cliente?.razon_social || cliente?.nombre || ""}</td>
      <td style="border:none; padding:2px 0;"><strong>CUIT:</strong> ${cliente?.cuit || "—"}</td>
    </tr>
    ${cliente?.direccion ? `<tr><td colspan="2" style="border:none; padding:2px 0;"><strong>Dirección:</strong> ${cliente.direccion}</td></tr>` : ""}
  </table>
</div>

${(imputaciones || []).length > 0 ? `
<div class="section">
  <div class="section-title">Comprobantes cancelados / afectados</div>
  <table>
    <thead>
      <tr>
        <th>Comprobante</th>
        <th>Fecha</th>
        <th class="tr">Total</th>
        <th class="tr">Cancelado</th>
      </tr>
    </thead>
    <tbody>
      ${(imputaciones || []).map((imp: any) => {
        const comp = imp.comprobante
        return `<tr>
          <td><span class="badge">${comp?.tipo_comprobante || ""}</span> ${comp?.numero_comprobante || ""}</td>
          <td>${fmtFecha(comp?.fecha)}</td>
          <td class="tr">$${fmtARS(comp?.total_factura)}</td>
          <td class="tr"><strong>$${fmtARS(imp.monto_imputado)}</strong></td>
        </tr>`
      }).join("")}
    </tbody>
  </table>
</div>
` : `
<div class="section">
  <div class="section-title">Aplicación del pago</div>
  <p style="color:#666; padding:6px 0;">Pago a cuenta — sin imputación a comprobantes específicos</p>
</div>
`}

<div class="section">
  <div class="section-title">Forma de pago</div>
  <table>
    <thead>
      <tr>
        <th>Detalle</th>
        <th class="tr">Importe</th>
      </tr>
    </thead>
    <tbody>
      ${detalles.map((det: any) => {
        const label = labelMetodo(det, cajaMap, bancoMap)
        const items = depositoItemsMap.get(det.id) || []
        let extraRows = ""
        if (det.tipo_pago === "deposito" && items.length > 0) {
          extraRows = items.map((it: any) => {
            const itLabel = it.tipo_item === "cheque"
              ? `  └ Cheque ${it.numero_cheque || ""} ${it.banco_emisor ? `(${it.banco_emisor})` : ""} vto. ${fmtFecha(it.fecha_pago_cheque)}`
              : `  └ Efectivo — Nro. dep. ${it.nro_comprobante_deposito_ef || ""}`
            return `<tr style="background:#fafafa;">
              <td style="padding-left:20px; color:#555;">${itLabel}</td>
              <td class="tr">$${fmtARS(it.monto)}</td>
            </tr>`
          }).join("")
        }
        return `<tr>
          <td>${label}</td>
          <td class="tr">$${fmtARS(det.monto)}</td>
        </tr>${extraRows}`
      }).join("")}
    </tbody>
  </table>
</div>

${(pago.retenciones || []).length > 0 ? `
<div class="section">
  <div class="section-title">Retenciones</div>
  <table>
    <thead>
      <tr>
        <th>Tipo</th>
        <th>Fecha</th>
        <th>Nro. Comprobante</th>
        <th class="tr">Importe</th>
      </tr>
    </thead>
    <tbody>
      ${(pago.retenciones || []).map((r: any) => `<tr>
        <td>${r.tipo}</td>
        <td>${fmtFecha(r.fecha)}</td>
        <td>${r.numero_comprobante || "—"}</td>
        <td class="tr">$${fmtARS(r.monto)}</td>
      </tr>`).join("")}
    </tbody>
  </table>
</div>
` : ""}

<table class="totals-table">
  <tr>
    <td>Total recibido:</td>
    <td class="tr">$${fmtARS(totalMetodos)}</td>
  </tr>
  ${totalRetenciones > 0 ? `<tr>
    <td>Retenciones:</td>
    <td class="tr">— $${fmtARS(totalRetenciones)}</td>
  </tr>` : ""}
  <tr class="total-row">
    <td>Neto cobrado:</td>
    <td class="tr">$${fmtARS(netoCobrado)}</td>
  </tr>
</table>

<div class="firma-area">
  <div class="firma-line">Firma y aclaración cliente</div>
  <div class="firma-line">Firma y sello empresa</div>
</div>

<div class="no-print" style="margin-top:30px; text-align:center;">
  <button onclick="window.print()" style="padding:10px 24px; font-size:13px; cursor:pointer; background:#1a1a1a; color:white; border:none; border-radius:4px;">
    Imprimir / Guardar como PDF
  </button>
</div>

</body>
</html>`

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  } catch (error: any) {
    console.error("[recibo] GET error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
