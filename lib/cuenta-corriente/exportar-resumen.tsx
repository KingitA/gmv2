"use client"

// Exportación del resumen de cuenta del cliente (dueño 15/10): Excel y PDF,
// tanto de la vista "Solo saldos" como de la "Cuenta detallada" (extracto).
// Los archivos muestran lo MISMO que la pantalla: filas del más nuevo al más
// viejo y créditos con signo negativo. Formatos según docs/FORMATOS.md
// (fechas dd/mm/aaaa y $ con coma vía lib/formato; en Excel los montos van
// como NÚMEROS para poder sumar/filtrar).

import * as XLSX from "xlsx"
import { fecha as fechaAR, hoyISO, moneda, formatCuit } from "@/lib/formato"

export interface FilaSaldoExport {
  tipo: string
  numero: string
  fecha: string
  pedido: string
  total: number
  saldo: number
  estado: string
  es_credito?: boolean
}

export interface FilaExtractoExport {
  fecha: string
  movimiento: string
  detalle: string
  debe: number
  haber: number
  saldo_acumulado: number
}

export interface DatosResumen {
  cliente: { nombre: string; cuit?: string | null }
  vista: "saldos" | "detallada"
  saldos: FilaSaldoExport[]
  extracto: FilaExtractoExport[]
  saldoFinal: number
  rango?: { desde?: string; hasta?: string }
}

const firmado = (f: FilaSaldoExport, v: number) => (f.es_credito ? -Math.abs(v) : Math.abs(v))

function nombreArchivo(d: DatosResumen, ext: string) {
  const slug = (d.cliente.nombre || "cliente").replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()
  return `resumen-cuenta-${slug}-${hoyISO()}.${ext}`
}

function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}

// ── Excel ────────────────────────────────────────────────────────────────────
export function exportarResumenExcel(d: DatosResumen) {
  const wb = XLSX.utils.book_new()

  if (d.vista === "detallada") {
    const filas = d.extracto.map((m) => ({
      Fecha: fechaAR(m.fecha),
      Movimiento: m.movimiento,
      Detalle: m.detalle,
      "Debe (+)": m.debe > 0 ? m.debe : "",
      "Haber (−)": m.haber > 0 ? -m.haber : "",
      Saldo: m.saldo_acumulado,
    }))
    filas.unshift({ Fecha: "", Movimiento: "SALDO ACTUAL", Detalle: "", "Debe (+)": "", "Haber (−)": "", Saldo: d.saldoFinal })
    const ws = XLSX.utils.json_to_sheet(filas)
    ws["!cols"] = [{ wch: 12 }, { wch: 30 }, { wch: 45 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, ws, "Extracto")
  }

  const filasSaldos = d.saldos.map((f) => ({
    Tipo: f.tipo,
    Número: f.numero,
    Fecha: fechaAR(f.fecha),
    Pedido: f.pedido === "-" ? "" : f.pedido,
    Total: firmado(f, f.total),
    Saldo: firmado(f, f.saldo),
    Estado: f.estado,
  }))
  const wsS = XLSX.utils.json_to_sheet(filasSaldos)
  wsS["!cols"] = [{ wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, wsS, d.vista === "detallada" ? "Comprobantes" : "Saldos pendientes")

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" })
  descargar(new Blob([out], { type: "application/octet-stream" }), nombreArchivo(d, "xlsx"))
}

// ── PDF (@react-pdf/renderer, cargado recién al exportar) ────────────────────
export async function exportarResumenPdf(d: DatosResumen) {
  const { pdf, Document, Page, Text, View, StyleSheet } = await import("@react-pdf/renderer")

  const st = StyleSheet.create({
    page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
    titulo: { fontSize: 14, fontFamily: "Helvetica-Bold" },
    sub: { fontSize: 9, color: "#555", marginTop: 2 },
    seccion: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 4 },
    fila: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ddd", paddingVertical: 3 },
    cab: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#333", paddingVertical: 3, fontFamily: "Helvetica-Bold" },
    num: { textAlign: "right" },
    saldoFinal: { flexDirection: "row", paddingVertical: 5, borderTopWidth: 1, borderTopColor: "#333", fontFamily: "Helvetica-Bold" },
  })

  const colS = [50, 80, 55, 80, 85, 85, 70] // saldos
  const colE = [55, 120, 155, 70, 70, 70] // extracto

  const C = ({ w, children, num }: { w: number; children?: any; num?: boolean }) => (
    <Text style={[{ width: w, paddingRight: 4 }, num ? st.num : {}]}>{children ?? ""}</Text>
  )

  const rango =
    d.rango?.desde || d.rango?.hasta
      ? ` · período ${d.rango?.desde ? fechaAR(d.rango.desde) : "inicio"} a ${d.rango?.hasta ? fechaAR(d.rango.hasta) : "hoy"}`
      : ""

  const doc = (
    <Document>
      <Page size="A4" style={st.page}>
        <Text style={st.titulo}>Resumen de cuenta — {d.cliente.nombre}</Text>
        <Text style={st.sub}>
          {d.cliente.cuit ? `CUIT ${formatCuit(d.cliente.cuit)} · ` : ""}emitido el {fechaAR(hoyISO())}
          {rango} · Saldo actual: {moneda(d.saldoFinal)} {d.saldoFinal > 0 ? "(debe)" : d.saldoFinal < 0 ? "(a favor)" : ""}
        </Text>

        {d.vista === "detallada" && (
          <>
            <Text style={st.seccion}>Extracto (del más nuevo al más viejo)</Text>
            <View style={st.cab}>
              <C w={colE[0]}>Fecha</C>
              <C w={colE[1]}>Movimiento</C>
              <C w={colE[2]}>Detalle</C>
              <C w={colE[3]} num>Debe (+)</C>
              <C w={colE[4]} num>Haber (−)</C>
              <C w={colE[5]} num>Saldo</C>
            </View>
            <View style={st.saldoFinal}>
              <C w={colE[0] + colE[1] + colE[2] + colE[3] + colE[4]}>SALDO ACTUAL</C>
              <C w={colE[5]} num>{moneda(d.saldoFinal)}</C>
            </View>
            {d.extracto.map((m, i) => (
              <View key={i} style={st.fila} wrap={false}>
                <C w={colE[0]}>{fechaAR(m.fecha)}</C>
                <C w={colE[1]}>{m.movimiento}</C>
                <C w={colE[2]}>{m.detalle}</C>
                <C w={colE[3]} num>{m.debe > 0 ? moneda(m.debe) : ""}</C>
                <C w={colE[4]} num>{m.haber > 0 ? `−${moneda(m.haber)}` : ""}</C>
                <C w={colE[5]} num>{moneda(m.saldo_acumulado)}</C>
              </View>
            ))}
          </>
        )}

        <Text style={st.seccion}>{d.vista === "detallada" ? "Comprobantes" : "Saldos pendientes"}</Text>
        <View style={st.cab}>
          <C w={colS[0]}>Tipo</C>
          <C w={colS[1]}>Número</C>
          <C w={colS[2]}>Fecha</C>
          <C w={colS[3]}>Pedido</C>
          <C w={colS[4]} num>Total</C>
          <C w={colS[5]} num>Saldo</C>
          <C w={colS[6]}>Estado</C>
        </View>
        {d.saldos.map((f, i) => (
          <View key={i} style={st.fila} wrap={false}>
            <C w={colS[0]}>{f.tipo}</C>
            <C w={colS[1]}>{f.numero}</C>
            <C w={colS[2]}>{fechaAR(f.fecha)}</C>
            <C w={colS[3]}>{f.pedido === "-" ? "" : f.pedido}</C>
            <C w={colS[4]} num>{moneda(firmado(f, f.total))}</C>
            <C w={colS[5]} num>{moneda(firmado(f, f.saldo))}</C>
            <C w={colS[6]}>{f.estado}</C>
          </View>
        ))}
        {d.vista === "saldos" && (
          <View style={st.saldoFinal}>
            <C w={colS[0] + colS[1] + colS[2] + colS[3] + colS[4]}>SALDO ACTUAL</C>
            <C w={colS[5]} num>{moneda(d.saldoFinal)}</C>
            <C w={colS[6]} />
          </View>
        )}
      </Page>
    </Document>
  )

  const blob = await pdf(doc).toBlob()
  descargar(blob, nombreArchivo(d, "pdf"))
}
