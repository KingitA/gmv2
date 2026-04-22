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
      .select("nombre_razon_social, cuit, direccion, localidad, condicion_iva, telefono, condicion_pago")
      .eq("id", comprobante.cliente_id)
      .single()

    const { data: pedido } = await supabase
      .from("pedidos")
      .select("numero_pedido, condicion_entrega, vendedores(nombre)")
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

// ─── Helpers ───────────────────────────────────────────

function detectarSegmento(art: { categoria?: string | null; iva_compras?: string | null }): string {
  const cat = (art.categoria || "").toUpperCase()
  if (cat.includes("PERFUMERIA") || cat.includes("PERFUMERÍA"))
    return art.iva_compras === "adquisicion_stock" ? "perf0" : "perf_plus"
  return "limpieza_bazar"
}

const FILAS_POR_HOJA = 35

function generarHTMLComprobante(comprobante: any, empresa: any): string {
  const fmtARS = (n: number) =>
    Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // ─── Config por tipo ───
  const tipoConfig: Record<string, { letra: string; nombre: string; colorVar: string; cod: string }> = {
    FA:  { letra: "A", nombre: "Factura",         colorVar: "#0d2e52", cod: "001" },
    FB:  { letra: "B", nombre: "Factura",         colorVar: "#174a0a", cod: "006" },
    FC:  { letra: "C", nombre: "Factura",         colorVar: "#4a0a0a", cod: "011" },
    NCA: { letra: "A", nombre: "Nota de Crédito", colorVar: "#004030", cod: "003" },
    NCB: { letra: "B", nombre: "Nota de Crédito", colorVar: "#004030", cod: "008" },
    NCC: { letra: "C", nombre: "Nota de Crédito", colorVar: "#004030", cod: "013" },
    NDA: { letra: "A", nombre: "Nota de Débito",  colorVar: "#5a2a00", cod: "002" },
    NDB: { letra: "B", nombre: "Nota de Débito",  colorVar: "#5a2a00", cod: "007" },
    NDC: { letra: "C", nombre: "Nota de Débito",  colorVar: "#5a2a00", cod: "012" },
    PRES:{ letra: "X", nombre: "Presupuesto",     colorVar: "#28085a", cod: "—"  },
    REV: { letra: "X", nombre: "Reversa",         colorVar: "#1a1a1a", cod: "—"  },
    REM: { letra: "R", nombre: "Remito",          colorVar: "#004060", cod: "R"  },
  }
  const cfg = tipoConfig[comprobante.tipo_comprobante] || { letra: "X", nombre: comprobante.tipo_comprobante, colorVar: "#333", cod: "—" }

  // ─── Condición IVA de emisor ───
  const esFact = ["FA","FB","FC"].includes(comprobante.tipo_comprobante)
  const esFactA = comprobante.tipo_comprobante === "FA" || comprobante.tipo_comprobante === "NCA"
  const esPresupRev = ["PRES","REV"].includes(comprobante.tipo_comprobante)
  const esFactB = comprobante.tipo_comprobante === "FB" || comprobante.tipo_comprobante === "NCB"
  const condIVAEmisor = esFactA ? "Responsable Inscripto" : esFactB ? "Responsable Inscripto" : "Monotributista"
  const noval = esPresupRev
    ? `DOCUMENTO NO VÁLIDO COMO FACTURA${comprobante.tipo_comprobante === "REV" ? " — USO INTERNO" : ""}`
    : null

  // ─── Datos comprobante ───
  const nro = comprobante.numero_comprobante || "—"
  const fecha = comprobante.fecha
    ? new Date(comprobante.fecha).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })
    : "—"
  const pto = nro.includes("-") ? nro.split("-")[0] : "0001"

  // ─── CAE (vacío si no existe — sin inventar) ───
  const cae: string = comprobante.cae || ""
  const caeVto: string = comprobante.cae_vencimiento
    ? new Date(comprobante.cae_vencimiento).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })
    : ""

  // ─── Cliente ───
  const cli = comprobante.cliente || {}
  const ped = comprobante.pedido || {}
  const vendedor = (ped.vendedores as any)?.nombre || ""
  const direccionCli = [cli.direccion, cli.localidad].filter(Boolean).join(", ") || "—"
  const condEntregaMap: Record<string, string> = {
    entregamos_nosotros: "Flota propia — a domicilio",
    retira_mostrador: "Retira en mostrador",
    transporte: "Transporte a cargo del cliente",
  }
  const condEntrega = condEntregaMap[ped.condicion_entrega] || ped.condicion_entrega || "—"
  const condPago = cli.condicion_pago || "Cuenta Corriente"

  // ─── Separar líneas de detalle ───
  // Positivas = artículos reales
  // Negativas con "Mercad" = bonif mercadería (última línea de artículos)
  // Negativas sin "Mercad" = descuento general/viajante (D1/D2 ya reflejados por línea)
  const todasLineas: any[] = comprobante.detalle || []
  const lineasArt = todasLineas.filter((i: any) => Number(i.precio_unitario || 0) > 0)
  const lineasBonifMerc = todasLineas.filter((i: any) => Number(i.precio_unitario || 0) < 0 && (i.descripcion || "").includes("Mercad"))
  // D1/D2 se muestran por columna, no como líneas separadas

  // ─── D1 / D2 desde bonificaciones del cliente ───
  const bonifs: any[] = comprobante.bonificaciones || []
  const firstArt = lineasArt.find((i: any) => i.articulos)
  const segmento = firstArt?.articulos ? detectarSegmento(firstArt.articulos) : "limpieza_bazar"
  const d1 = bonifs.find((b: any) => b.tipo === "general"  && (!b.segmento || b.segmento === segmento))
  const d2 = bonifs.find((b: any) => b.tipo === "viajante" && (!b.segmento || b.segmento === segmento))
  const d1pct: number = d1?.porcentaje || 0
  const d2pct: number = d2?.porcentaje || 0

  // ─── Precios netos por línea (para columna P. Neto) ───
  // precio_unitario es el precio de lista (pre-D1/D2)
  // P. Neto = precio_unitario * (1 - d1/100 - d2/100)
  const factDesc = 1 - d1pct / 100 - d2pct / 100

  // ─── Generar filas HTML de artículos ───
  const allFilas: string[] = [...lineasArt, ...lineasBonifMerc].map((item: any) => {
    const esBonifMerc = Number(item.precio_unitario || 0) < 0
    const lista = Math.abs(Number(item.precio_unitario || 0))
    const cant = item.cantidad || 0
    const neto = esBonifMerc ? 0 : lista * factDesc
    const sub = esBonifMerc ? Math.abs(Number(item.precio_total || 0)) : neto * cant
    const desc = item.articulos?.descripcion || item.descripcion || "—"
    const sku  = item.articulos?.sku || "—"

    const tdOf  = `<td class="c-of z">—</td>`
    const tdB1  = esBonifMerc
      ? `<td class="c-b1" style="color:#b45309;font-weight:700">100%</td>`
      : d1pct > 0 ? `<td class="c-b1">${d1pct}%</td>` : `<td class="c-b1 z">—</td>`
    const tdB2  = esBonifMerc
      ? `<td class="c-b2 z">—</td>`
      : d2pct > 0 ? `<td class="c-b2">${d2pct}%</td>` : `<td class="c-b2 z">—</td>`

    const rowStyle = esBonifMerc ? ` style="background:#fef3c7"` : ""
    const descStyle = esBonifMerc ? ` style="color:#92400e;font-style:italic"` : ""

    return `<tr${rowStyle}>
      <td class="c-cod">${esBonifMerc ? "" : sku}</td>
      <td class="c-desc"${descStyle}>${desc}</td>
      <td class="c-cant">${esBonifMerc ? "—" : cant}</td>
      <td class="c-lst">${esBonifMerc ? "—" : ("$" + fmtARS(lista))}</td>
      ${tdOf}${tdB1}${tdB2}
      <td class="c-net">${esBonifMerc ? "<span style='color:#dc2626'>-$" + fmtARS(sub) + "</span>" : ("$" + fmtARS(neto))}</td>
      <td class="c-sub">${esBonifMerc ? "<span style='color:#dc2626'>-$" + fmtARS(sub) + "</span>" : ("$" + fmtARS(sub))}</td>
    </tr>`
  })

  // ─── Totales ───
  const totalNeto   = Number(comprobante.total_neto   || 0)
  const totalIva    = Number(comprobante.total_iva    || 0)
  const totalFact   = Number(comprobante.total_factura|| 0)
  const percIva     = Number(comprobante.percepcion_iva  || 0)
  const percIibb    = Number(comprobante.percepcion_iibb || 0)

  let totalesHTML: string
  if (esFactA) {
    totalesHTML = `
      <div class="tf"><span class="tl">Subtotal gravado 21%</span><span class="tv">$${fmtARS(totalNeto)}</span></div>
      <div class="tf dim"><span class="tl">IVA 21%</span><span class="tv">$${fmtARS(totalIva)}</span></div>
      ${percIva > 0 ? `<div class="tf dim"><span class="tl">Percepción IVA</span><span class="tv">$${fmtARS(percIva)}</span></div>` : ""}
      ${percIibb > 0 ? `<div class="tf dim"><span class="tl">Percepción Ing. Brutos</span><span class="tv">$${fmtARS(percIibb)}</span></div>` : ""}
      <div class="tg"><span class="tl">TOTAL</span><span class="tv">$${fmtARS(totalFact)}</span></div>`
  } else if (esFactB) {
    const ivaContenido = Math.round((totalFact / 1.21) * 0.21 * 100) / 100
    totalesHTML = `
      <div class="tf"><span class="tl">Subtotal (IVA incluido)</span><span class="tv">$${fmtARS(totalFact)}</span></div>
      <div class="tf dim"><span class="tl">IVA contenido 21% *</span><span class="tv">$${fmtARS(ivaContenido)}</span></div>
      ${percIibb > 0 ? `<div class="tf dim"><span class="tl">Percepción Ing. Brutos</span><span class="tv">$${fmtARS(percIibb)}</span></div>` : ""}
      <div class="tg"><span class="tl">TOTAL</span><span class="tv">$${fmtARS(totalFact)}</span></div>`
  } else {
    totalesHTML = `
      <div class="tf"><span class="tl">Subtotal</span><span class="tv">$${fmtARS(totalFact)}</span></div>
      ${!esFact ? `<div class="tf dim"><span class="tl">Impuestos no discriminados</span><span class="tv">—</span></div>` : ""}
      <div class="tg"><span class="tl">TOTAL</span><span class="tv">$${fmtARS(totalFact)}</span></div>`
  }

  const transpTxt = esFactA
    ? `IVA discriminado $${fmtARS(totalIva)}${percIva > 0 ? ` · Percep. IVA $${fmtARS(percIva)}` : ""}${percIibb > 0 ? ` · Percep. IIBB $${fmtARS(percIibb)}` : ""}`
    : esFactB
      ? `IVA contenido $${fmtARS(Math.round(totalFact / 1.21 * 0.21 * 100) / 100)} · * incluido en precio, NO es adicional al total`
      : `Impuestos no discriminados`

  // ─── Multipágina ───
  const totalHojas = Math.max(1, Math.ceil(allFilas.length / FILAS_POR_HOJA))

  let paginasHTML = ""
  for (let h = 1; h <= totalHojas; h++) {
    const esHoja1  = h === 1
    const esUltima = h === totalHojas
    const desde = (h - 1) * FILAS_POR_HOJA
    const hasta = Math.min(desde + FILAS_POR_HOJA, allFilas.length)
    const filasHoja = allFilas.slice(desde, hasta)

    // ── Encabezado ──
    let encHTML = ""

    if (noval) encHTML += `<div class="noval">${esHoja1 ? noval : noval + " — HOJA " + h + " DE " + totalHojas}</div>`

    if (esHoja1) {
      const caeBox = esFact || comprobante.tipo_comprobante.startsWith("NC") || comprobante.tipo_comprobante.startsWith("ND")
        ? `<div class="cae-box">
            <div class="cl">CAE — ARCA</div>
            <div class="cv">${cae || "—"}</div>
            <div class="cv2">Vto. CAE: ${caeVto || "—"}</div>
          </div>`
        : ""

      encHTML += `
      <div class="enc-top">
        <div class="em">
          <div class="em-nombre">${empresa.razon_social || "—"}</div>
          <div class="em-rubro">Limpieza · Bazar · Perfumería</div>
          <table class="em-tabla">
            <tr><td class="lbl">CUIT:</td><td>${empresa.cuit || "—"}</td></tr>
            <tr><td class="lbl">Condición IVA:</td><td>${empresa.condicion_iva || condIVAEmisor}</td></tr>
            <tr><td class="lbl">Ing. Brutos:</td><td>${empresa.iibb || "Convenio Multilateral — SIFERE"}</td></tr>
            <tr><td class="lbl">Domicilio:</td><td>${empresa.direccion || "—"}</td></tr>
            <tr><td class="lbl">Teléfono:</td><td>${empresa.telefono || "—"} · Pto. Vta.: ${pto}</td></tr>
          </table>
        </div>
        <div class="tipo-box">
          <div class="letra">${cfg.letra}</div>
          <div class="tipo-nombre">${cfg.nombre}</div>
          <div class="tipo-cod">Cód. ${cfg.cod}</div>
        </div>
        <div class="comp">
          <div class="comp-nro"><span>N°</span> ${nro}</div>
          <table class="comp-tabla">
            <tr><td class="lbl">Fecha:</td><td>${fecha}</td></tr>
            ${ped.numero_pedido ? `<tr><td class="lbl">N° Pedido:</td><td>${ped.numero_pedido}</td></tr>` : ""}
          </table>
          ${caeBox}
        </div>
      </div>
      <div class="enc-cli">
        <div class="cli-col">
          <div class="cli-col-tit">Datos del cliente</div>
          <div class="cli-razon">${cli.nombre_razon_social || "—"}</div>
          <table class="cli-tabla">
            <tr><td class="lbl">CUIT / DNI:</td><td>${cli.cuit || "—"}</td></tr>
            <tr><td class="lbl">Cond. IVA:</td><td>${cli.condicion_iva || "—"}</td></tr>
            <tr><td class="lbl">Domicilio:</td><td>${direccionCli}</td></tr>
            <tr><td class="lbl">Teléfono:</td><td>${cli.telefono || "—"}</td></tr>
          </table>
        </div>
        <div class="cli-col">
          <div class="cli-col-tit">Datos de gestión</div>
          <table class="cli-tabla">
            ${vendedor ? `<tr><td class="lbl">Vendedor:</td><td>${vendedor}</td></tr>` : ""}
            <tr><td class="lbl">Forma de pago:</td><td>${condPago}</td></tr>
            <tr><td class="lbl">Cond. entrega:</td><td>${condEntrega}</td></tr>
          </table>
        </div>
      </div>
      <div class="enc-cond">
        <div class="cond-item"><span class="cond-lbl">Moneda</span><span class="cond-val">Pesos ARS</span></div>
        <div class="cond-item"><span class="cond-lbl">Operación</span><span class="cond-val">Venta de bienes</span></div>
        ${d1pct > 0 ? `<div class="cond-item"><span class="cond-lbl">Bonif. General</span><span class="cond-val">${d1pct}%</span></div>` : ""}
        ${d2pct > 0 ? `<div class="cond-item"><span class="cond-lbl">Bonif. Viajante</span><span class="cond-val">${d2pct}%</span></div>` : ""}
        <div class="cond-item" style="margin-left:auto"><span class="cond-lbl">Lista · Tipo</span><span class="cond-val">${comprobante.tipo_comprobante}</span></div>
      </div>`
    } else {
      encHTML += `<div class="hoja-banner">
        <span>${empresa.razon_social || "—"} &nbsp;·&nbsp; ${cfg.nombre} ${cfg.letra} &nbsp;·&nbsp; N° ${nro} &nbsp;·&nbsp; ${fecha}</span>
        <span>HOJA ${h} DE ${totalHojas}</span>
      </div>`
    }

    // ── Tabla artículos ──
    const tbodyRows = filasHoja.join("")
    const zonaTabla = `<div class="zona-tabla">
      <table class="art">
        <colgroup>
          <col class="c-cod"><col class="c-desc"><col class="c-cant">
          <col class="c-lst"><col class="c-of"><col class="c-b1"><col class="c-b2">
          <col class="c-net"><col class="c-sub">
        </colgroup>
        <thead><tr>
          <th class="l">Código</th>
          <th class="l">Descripción del artículo</th>
          <th>Cant.</th>
          <th>P. Lista</th>
          <th>% Of.</th>
          <th>Bon 1</th>
          <th>Bon 2</th>
          <th>P. Neto</th>
          <th>Subtotal</th>
        </tr></thead>
        <tbody>${tbodyRows}</tbody>
      </table>
    </div>`

    // ── Pie de página ──
    let pieHTML = ""
    if (!esUltima) {
      pieHTML = `
        <div class="sub-parcial">
          <span class="lbl">Ítems ${desde + 1} al ${hasta} de ${allFilas.length}</span>
          <span style="flex:1"></span>
          <span class="cont">→ CONTINÚA EN HOJA ${h + 1}</span>
        </div>
        <div class="pie">
          <div class="pie-legal">${cfg.nombre} ${cfg.letra} · N° ${nro} · Hoja ${h} de ${totalHojas} — continúa en hoja siguiente</div>
        </div>`
    } else {
      const obsHTML = comprobante.observaciones
        ? `<p>${comprobante.observaciones.substring(0, 200)}</p>`
        : `<p>—</p>`

      pieHTML = `
        <div class="zona-tot">
          <div class="tot-obs">
            <div class="t">Observaciones</div>
            ${obsHTML}
            <p class="lg">Crédito fiscal computable solo por Resp. Inscriptos en IVA (RG ARCA 1415). Emitido conforme RG 4291.</p>
          </div>
          <div class="tot-nums">${totalesHTML}</div>
        </div>
        <div class="transp"><strong>Transparencia Fiscal — Ley 27.743:</strong> ${transpTxt}</div>
        <div class="pie">
          <div class="pie-legal">
            Emitido conforme RG ARCA 1415${cae ? ` · CAE: ${cae}` : ""}. <strong>Original para el cliente.</strong><br>
            ${empresa.email || ""} · ${empresa.telefono || ""}
          </div>
          <div class="firma"><div class="linea"></div><div class="lbl">FIRMA Y SELLO — VENDEDOR</div></div>
        </div>`
    }

    paginasHTML += `<div class="pw doc"><div class="stripe" style="background:${cfg.colorVar}"></div><div class="body">${encHTML}${zonaTabla}${pieHTML}</div></div>\n`
  }

  // ─── HTML final ───
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${cfg.nombre} ${cfg.letra} ${nro}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Barlow+Condensed:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--f:'Barlow',sans-serif;--fc:'Barlow Condensed',sans-serif;--borde:#111}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--f);background:#bbb;color:#111;font-size:10px}
.nav{position:fixed;top:0;left:0;right:0;z-index:100;background:#0a0a0a;display:flex;gap:6px;padding:6px 12px;align-items:center}
.btn-print{font-family:var(--fc);font-size:11px;font-weight:600;color:#ffc000;background:#181818;border:1px solid #4a3a00;padding:4px 14px;cursor:pointer;border-radius:2px}
.btn-print:hover{background:#ffc000;color:#000;border-color:#ffc000}
.nav-info{font-family:var(--fc);font-size:10px;color:#555;margin-left:8px}
.pw{display:block;padding:46px 0 28px}
.doc{width:210mm;height:297mm;background:#fff;margin:0 auto;box-shadow:0 4px 24px rgba(0,0,0,.22);display:flex;flex-direction:column;position:relative;overflow:hidden;page-break-after:always;break-after:page}
.stripe{position:absolute;left:0;top:0;bottom:0;width:5px}
.body{margin-left:5px;flex:1;display:flex;flex-direction:column;min-height:0}
/* ── ENCABEZADO ── */
.enc-top{display:grid;grid-template-columns:1fr 80px 152px;border-bottom:2px solid var(--borde)}
.em{padding:8px 10px 7px;border-right:1.5px solid #ccc}
.em-nombre{font-family:var(--fc);font-size:17px;font-weight:700;text-transform:uppercase;letter-spacing:.01em;line-height:1}
.em-rubro{font-family:var(--fc);font-size:8px;font-weight:500;letter-spacing:.09em;text-transform:uppercase;color:#888;margin-bottom:5px}
.em-tabla,.comp-tabla,.cli-tabla{border-collapse:collapse;width:100%}
.em-tabla td,.comp-tabla td{font-size:9px;padding:1.2px 0;vertical-align:top;line-height:1.4;color:#333}
.em-tabla td.lbl,.comp-tabla td.lbl{font-weight:700;color:#111;white-space:nowrap;padding-right:6px;width:1%}
.tipo-box{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5px 4px;border-right:1.5px solid #ccc;gap:2px}
.letra{font-family:var(--fc);font-size:46px;font-weight:700;line-height:1;width:60px;height:60px;border:3px solid currentColor;display:flex;align-items:center;justify-content:center}
.tipo-nombre{font-family:var(--fc);font-size:8px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#666;text-align:center;line-height:1.2}
.tipo-cod{font-size:7.5px;color:#aaa;font-family:var(--fc)}
.comp{padding:8px 10px 7px}
.comp-nro{font-family:var(--fc);font-size:16px;font-weight:700;line-height:1;margin-bottom:4px}
.comp-nro span{font-size:10px;color:#888;font-weight:400}
.cae-box{margin-top:5px;padding:3px 6px;border:1.5px solid #bbb;border-radius:2px;background:#f8f8f8}
.cae-box .cl{font-size:7px;text-transform:uppercase;letter-spacing:.08em;color:#999;font-weight:700}
.cae-box .cv{font-family:var(--fc);font-size:10px;font-weight:700;color:#111;letter-spacing:.04em}
.cae-box .cv2{font-size:8px;color:#555}
/* ── CLIENTE ── */
.enc-cli{display:grid;grid-template-columns:1fr 1fr;border-bottom:2px solid var(--borde)}
.cli-col{padding:6px 10px}
.cli-col:first-child{border-right:1.5px solid #ccc}
.cli-col-tit{font-family:var(--fc);font-size:7.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#aaa;margin-bottom:2px;padding-bottom:2px;border-bottom:1px solid #e8e8e8}
.cli-razon{font-family:var(--fc);font-size:13px;font-weight:700;color:#111;line-height:1;margin-bottom:3px}
.cli-tabla td{font-size:9px;padding:1px 0;vertical-align:top;color:#333;line-height:1.4}
.cli-tabla td.lbl{font-weight:700;color:#111;white-space:nowrap;padding-right:6px;width:1%}
/* ── CONDICIONES ── */
.enc-cond{display:flex;border-bottom:2px solid var(--borde);background:#f2f2f2}
.cond-item{flex:1;padding:3px 8px;border-right:1px solid #ccc}
.cond-item:last-child{border-right:none}
.cond-lbl{font-family:var(--fc);font-size:6.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#888;display:block}
.cond-val{font-family:var(--fc);font-size:9px;font-weight:700;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
/* ── NOVAL ── */
.noval{padding:3px 10px;background:#eee;border-bottom:2px solid #555;font-family:var(--fc);font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#333;text-align:center}
/* ── BANNER hoja adicional ── */
.hoja-banner{padding:4px 10px;background:#111;color:#fff;font-family:var(--fc);font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center}
/* ── TABLA ARTÍCULOS ── */
table.art{width:100%;border-collapse:collapse;table-layout:fixed}
table.art col.c-cod{width:42px}
table.art col.c-desc{width:auto}
table.art col.c-cant{width:30px}
table.art col.c-lst{width:58px}
table.art col.c-of{width:28px}
table.art col.c-b1{width:30px}
table.art col.c-b2{width:30px}
table.art col.c-net{width:58px}
table.art col.c-sub{width:64px}
table.art thead tr{color:#fff;background:#111}
table.art thead th{padding:5px 4px;font-family:var(--fc);font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;text-align:right;white-space:nowrap;border-right:1px solid rgba(255,255,255,.15)}
table.art thead th:last-child{border-right:none}
table.art thead th.l{text-align:left}
table.art tbody tr{border-bottom:1px solid #ddd}
table.art tbody tr:nth-child(even){background:#f5f5f5}
table.art tbody td{padding:3.5px 4px;font-size:9.5px;text-align:right;vertical-align:middle;color:#444;border-right:1px solid #e0e0e0;line-height:1.3}
table.art tbody td:last-child{border-right:none}
td.c-desc{text-align:left;color:#111;font-weight:600;font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
td.c-cod{text-align:center;font-family:var(--fc);font-size:8.5px;color:#888}
td.c-cant{text-align:center;font-family:var(--fc);font-size:11px;font-weight:700;color:#111}
td.c-lst{font-family:var(--fc);font-size:9px;color:#777}
td.c-of,td.c-b1,td.c-b2{text-align:center;font-family:var(--fc);font-size:9px;color:#777}
td.z{color:#ccc}
td.c-net{font-family:var(--fc);font-size:9.5px;font-weight:600;color:#333}
td.c-sub{font-family:var(--fc);font-size:10.5px;font-weight:700;color:#111;border-left:2px solid #bbb}
/* ── TOTALES ── */
.zona-tabla{flex:1;overflow:hidden}
.sub-parcial{border-top:2px solid var(--borde);padding:4px 10px;display:flex;justify-content:flex-end;gap:16px;align-items:baseline;background:#f5f5f5}
.sub-parcial .lbl{font-family:var(--fc);font-size:8.5px;color:#666;text-transform:uppercase;letter-spacing:.05em}
.sub-parcial .cont{font-family:var(--fc);font-size:9px;font-weight:700;color:#555;border:1.5px solid #555;padding:1px 8px;border-radius:2px;letter-spacing:.06em}
.zona-tot{border-top:2px solid var(--borde);display:grid;grid-template-columns:1fr 195px}
.tot-obs{padding:6px 10px;border-right:1.5px solid #ccc;font-size:8px;color:#666;line-height:1.55}
.tot-obs .t{font-family:var(--fc);font-size:7.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#bbb;margin-bottom:2px}
.tot-obs .lg{font-size:7px;color:#bbb;margin-top:3px}
.tot-nums{padding:6px 10px}
.tf{display:flex;justify-content:space-between;align-items:baseline;padding:2px 0;border-bottom:1px solid #eee}
.tf:last-child{border-bottom:none}
.tf .tl{font-size:8.5px;color:#555}
.tf .tv{font-family:var(--fc);font-size:9px;font-weight:600;color:#111}
.tf.dim .tl{color:#aaa}
.tf.dim .tv{font-weight:400;color:#777}
.tg{display:flex;justify-content:space-between;align-items:baseline;margin-top:6px;padding-top:6px;border-top:2.5px solid var(--borde)}
.tg .tl{font-family:var(--fc);font-size:14px;font-weight:700}
.tg .tv{font-family:var(--fc);font-size:17px;font-weight:700}
.transp{padding:3px 10px;font-size:8px;color:#777;background:#f5f5f5;border-top:1px solid #e0e0e0;text-align:center}
.transp strong{color:#333}
.pie{margin-top:auto;border-top:1px solid #ccc;padding:5px 10px;display:flex;justify-content:space-between;align-items:flex-end}
.pie-legal{font-size:7.5px;color:#aaa;line-height:1.55}
.pie-legal strong{color:#888}
.firma{text-align:center;min-width:160px}
.firma .linea{border-top:1px solid #111;margin-top:18px;margin-bottom:2px}
.firma .lbl{font-size:7.5px;color:#888;letter-spacing:.04em}
/* Color de letra según tipo */
.letra{color:inherit}
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  .nav{display:none}
  .pw{display:block!important;padding:0;background:none}
  .doc{width:210mm;height:297mm;box-shadow:none;margin:0}
  body{background:white}
}
</style>
</head>
<body>
<nav class="nav">
  <button class="btn-print" onclick="window.print()">🖨 Imprimir</button>
  <span class="nav-info">${cfg.nombre} ${cfg.letra} · N° ${nro} · ${fecha}</span>
</nav>
<div class="pw">
${paginasHTML}
</div>
</body>
</html>`
}
