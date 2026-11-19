"use client"

// Exportación del padrón de clientes desde /clientes (pedido de Juan, 13/11/2026):
// Excel y PDF con EXACTAMENTE las filas que se ven en pantalla (estado, búsqueda,
// filtros por columna y orden). Formatos según docs/FORMATOS.md:
//   - Excel: montos como número, fecha de alta como fecha real, CUIT xx-xxxxxxxx-x;
//     un dato que falta queda en blanco (nunca un valor supuesto).
//   - PDF: listado compacto apaisado, fechas dd/mm/aaaa (hora AR) y $ vía lib/formato.

import * as XLSX from "xlsx"
import { entero, fecha as fechaAR, fechaHora, fechaISO, formatCuit, hoyISO } from "@/lib/formato"

export interface FilaClienteExport {
  codigo: string | null
  nombre: string | null
  razon_social: string | null
  cuit: string | null
  condicion_iva: string | null
  direccion: string | null
  localidad: string | null
  provincia: string | null
  zona: string | null
  vendedor: string | null
  telefono: string | null
  email: string | null
  lista: string | null
  metodo_facturacion: string | null
  condicion_pago: string | null
  codigo_postal: string | null
  condicion_entrega: string | null
  canal: string | null
  nivel: string | null
  activo: boolean
  /** null = la página no tiene el saldo de este cliente */
  saldo: number | null
  /** instante de alta (created_at) */
  alta: string | null
}

export interface InfoExport {
  /** Filtros aplicados en texto: ["Estado: Activos", "Viajante: JUAN CRUZ", …] */
  filtros: string[]
  /** true si hay algo más que la vista por defecto (para el nombre del archivo) */
  filtrado: boolean
}

const vacio = (v: string | null | undefined) => {
  const s = (v ?? "").toString().trim()
  return s === "" ? null : s
}

/** "clientes_13-11-2026" (+ "_filtrado") */
function nombreArchivo(info: InfoExport, ext: string) {
  const [a, m, d] = hoyISO().split("-")
  return `clientes_${d}-${m}-${a}${info.filtrado ? "_filtrado" : ""}.${ext}`
}

function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}

/** Día de calendario "AAAA-MM-DD" → número de serie de Excel (fecha real, sin hora ni huso) */
function serialExcel(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number)
  return (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000
}

// ── Excel ────────────────────────────────────────────────────────────────────
const COLUMNAS_XLSX: { titulo: string; ancho: number; valor: (f: FilaClienteExport) => string | number | null; tipo?: "monto" | "fecha" }[] = [
  { titulo: "Código", ancho: 9, valor: (f) => (f.codigo && /^\d+$/.test(f.codigo.trim()) ? Number(f.codigo.trim()) : vacio(f.codigo)) },
  { titulo: "Nombre", ancho: 32, valor: (f) => vacio(f.nombre) },
  { titulo: "Razón social", ancho: 32, valor: (f) => vacio(f.razon_social) },
  { titulo: "CUIT", ancho: 15, valor: (f) => vacio(formatCuit(f.cuit)) },
  { titulo: "Condición IVA", ancho: 22, valor: (f) => vacio(f.condicion_iva) },
  { titulo: "Dirección", ancho: 32, valor: (f) => vacio(f.direccion) },
  { titulo: "Localidad", ancho: 20, valor: (f) => vacio(f.localidad) },
  { titulo: "Código postal", ancho: 9, valor: (f) => vacio(f.codigo_postal) },
  { titulo: "Provincia", ancho: 16, valor: (f) => vacio(f.provincia) },
  { titulo: "Zona", ancho: 16, valor: (f) => vacio(f.zona) },
  { titulo: "Vendedor", ancho: 20, valor: (f) => vacio(f.vendedor) },
  { titulo: "Teléfono", ancho: 16, valor: (f) => vacio(f.telefono) },
  { titulo: "Email", ancho: 28, valor: (f) => vacio(f.email) },
  { titulo: "Lista de precios", ancho: 18, valor: (f) => vacio(f.lista) },
  { titulo: "Método de facturación", ancho: 14, valor: (f) => vacio(f.metodo_facturacion) },
  { titulo: "Condición de pago", ancho: 34, valor: (f) => vacio(f.condicion_pago) },
  { titulo: "Condición de entrega", ancho: 20, valor: (f) => vacio(f.condicion_entrega) },
  { titulo: "Canal", ancho: 14, valor: (f) => vacio(f.canal) },
  { titulo: "Nivel", ancho: 10, valor: (f) => vacio(f.nivel) },
  { titulo: "Activo", ancho: 8, valor: (f) => (f.activo ? "Sí" : "No") },
  { titulo: "Saldo", ancho: 15, valor: (f) => f.saldo, tipo: "monto" },
  { titulo: "Alta", ancho: 11, valor: (f) => (f.alta ? fechaISO(f.alta) || null : null), tipo: "fecha" },
]

export function exportarClientesExcel(filas: FilaClienteExport[], info: InfoExport) {
  const aoa: (string | number | null)[][] = [COLUMNAS_XLSX.map((c) => c.titulo)]
  for (const f of filas) aoa.push(COLUMNAS_XLSX.map((c) => c.valor(f)))
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Saldo como número con 2 decimales; alta como fecha real (dd/mm/aaaa)
  COLUMNAS_XLSX.forEach((c, ci) => {
    if (!c.tipo) return
    for (let ri = 1; ri < aoa.length; ri++) {
      const ref = XLSX.utils.encode_cell({ r: ri, c: ci })
      const cel = ws[ref]
      if (!cel) continue
      if (c.tipo === "monto" && typeof cel.v === "number") cel.z = "#,##0.00"
      if (c.tipo === "fecha" && typeof cel.v === "string") ws[ref] = { t: "n", v: serialExcel(cel.v), z: "dd/mm/yyyy" }
    }
  })
  ws["!cols"] = COLUMNAS_XLSX.map((c) => ({ wch: c.ancho }))
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoa.length - 1, 0), c: COLUMNAS_XLSX.length - 1 } }) }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Clientes")
  const wsInfo = XLSX.utils.aoa_to_sheet([
    ["Exportado", fechaHora(new Date())],
    ["Clientes", filas.length],
    ["Filtros", info.filtros.length ? info.filtros.join(" · ") : "Sin filtros"],
  ])
  wsInfo["!cols"] = [{ wch: 12 }, { wch: 80 }]
  XLSX.utils.book_append_sheet(wb, wsInfo, "Filtros")

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" })
  descargar(new Blob([out], { type: "application/octet-stream" }), nombreArchivo(info, "xlsx"))
}

// ── PDF (@react-pdf/renderer, cargado recién al exportar) ────────────────────
export async function exportarClientesPdf(filas: FilaClienteExport[], info: InfoExport) {
  const { pdf, Document, Page, Text, View, StyleSheet, Font } = await import("@react-pdf/renderer")
  // Sin cortar palabras con guion ("VIED-MA-PATAGONES"): si no entra, baja entera
  Font.registerHyphenationCallback((palabra) => [palabra])

  const st = StyleSheet.create({
    page: { paddingTop: 24, paddingBottom: 30, paddingHorizontal: 22, fontSize: 7.5, fontFamily: "Helvetica", color: "#111" },
    enc: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderBottomWidth: 1.5, borderBottomColor: "#111", paddingBottom: 4, marginBottom: 4 },
    titulo: { fontSize: 14, fontFamily: "Helvetica-Bold" },
    sub: { fontSize: 8, color: "#444" },
    filtros: { fontSize: 7.5, color: "#333", marginBottom: 6 },
    cab: { flexDirection: "row", backgroundColor: "#111", color: "#fff", fontFamily: "Helvetica-Bold", paddingVertical: 3, paddingHorizontal: 2 },
    fila: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ccc", paddingVertical: 2.5, paddingHorizontal: 2 },
    par: { backgroundColor: "#f4f4f4" },
    inactivo: { color: "#888" },
    pie: { position: "absolute", bottom: 12, left: 22, right: 22, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#666" },
  })

  // A4 apaisado: 842 pt de ancho − 44 de márgenes
  const COLS: { titulo: string; w: number; valor: (f: FilaClienteExport) => string }[] = [
    { titulo: "Código", w: 36, valor: (f) => f.codigo ?? "" },
    { titulo: "Nombre", w: 160, valor: (f) => f.nombre || f.razon_social || "" },
    { titulo: "CUIT", w: 64, valor: (f) => formatCuit(f.cuit) },
    { titulo: "Dirección", w: 145, valor: (f) => f.direccion ?? "" },
    { titulo: "Localidad", w: 100, valor: (f) => f.localidad ?? "" },
    { titulo: "Zona", w: 92, valor: (f) => f.zona ?? "" },
    { titulo: "Vendedor", w: 112, valor: (f) => f.vendedor ?? "" },
    { titulo: "Teléfono", w: 89, valor: (f) => f.telefono ?? "" },
  ]
  const emitido = fechaHora(new Date())

  const doc = (
    <Document title="Clientes">
      <Page size="A4" orientation="landscape" style={st.page}>
        <View style={st.enc} fixed>
          <Text style={st.titulo}>Clientes</Text>
          <Text style={st.sub}>{fechaAR(new Date())} · {entero(filas.length)} cliente{filas.length === 1 ? "" : "s"}</Text>
        </View>
        <Text style={st.filtros}>{info.filtros.length ? `Filtros: ${info.filtros.join(" · ")}` : "Sin filtros"}</Text>
        <View style={st.cab} fixed>
          {COLS.map((c) => <Text key={c.titulo} style={{ width: c.w, paddingRight: 4 }}>{c.titulo}</Text>)}
        </View>
        {filas.map((f, i) => (
          <View key={i} style={[st.fila, i % 2 === 1 ? st.par : {}, f.activo ? {} : st.inactivo]} wrap={false}>
            {COLS.map((c) => <Text key={c.titulo} style={{ width: c.w, paddingRight: 4 }}>{c.valor(f)}</Text>)}
          </View>
        ))}
        <View style={st.pie} fixed>
          <Text>Emitido el {emitido}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )

  const blob = await pdf(doc).toBlob()
  descargar(blob, nombreArchivo(info, "pdf"))
}
