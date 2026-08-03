/**
 * Template PDF de la Planilla de Retenciones a las Ganancias del período —
 * el resumen mensual que se le envía al contador (mismas columnas que la
 * planilla del sistema anterior: Fecha, OP, Certificado, Proveedor, CUIT,
 * Base, Alícuota, Importe + total).
 */

import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const fmt = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtFecha = (v?: string | null) => {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}

export interface PlanillaRetencionesData {
  empresa: { razon_social: string; cuit: string; direccion?: string | null }
  desde: string
  hasta: string
  filas: Array<{
    fecha: string; numero_op: string; numero_certificado: string
    proveedor: string; cuit: string; base: number; alicuota: number; importe: number
    anulada?: boolean
  }>
}

const s = StyleSheet.create({
  page:    { fontFamily: 'Helvetica', fontSize: 8.5, padding: '24 28' },
  emNombre:{ fontSize: 14, fontFamily: 'Helvetica-Bold' },
  emSub:   { fontSize: 8, color: '#555', marginTop: 1 },
  fecha:   { position: 'absolute', top: 24, right: 28, fontSize: 8.5, textAlign: 'right' },
  titulo:  { textAlign: 'center', fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 10, textDecoration: 'underline' },
  th:      { flexDirection: 'row', borderTop: '1.5 solid #111', borderBottom: '1.5 solid #111', paddingVertical: 3 },
  thT:     { fontSize: 7.5, fontFamily: 'Helvetica-Bold' },
  tr:      { flexDirection: 'row', borderBottom: '0.5 solid #ddd', paddingVertical: 2.5 },
  td:      { fontSize: 8 },
  anulada: { color: '#b42318', textDecoration: 'line-through' },
  cFecha:  { width: 56 },
  cOp:     { width: 78 },
  cCert:   { width: 78 },
  cProv:   { flex: 1 },
  cCuit:   { width: 82 },
  cBase:   { width: 72, textAlign: 'right' },
  cAlic:   { width: 34, textAlign: 'right' },
  cImp:    { width: 68, textAlign: 'right' },
  totRow:  { flexDirection: 'row', borderTop: '1.5 solid #111', marginTop: 4, paddingTop: 4 },
  totVal:  { fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'right', flex: 1 },
})

export function PlanillaRetencionesPDF({ data }: { data: PlanillaRetencionesData }) {
  const total = data.filas.filter(f => !f.anulada).reduce((s2, f) => s2 + f.importe, 0)
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.emNombre}>{data.empresa.razon_social}</Text>
        <Text style={s.emSub}>CUIT {data.empresa.cuit}{data.empresa.direccion ? ` · ${data.empresa.direccion}` : ''}</Text>
        <Text style={s.fecha}>Emitida: {fmtFecha(new Date().toISOString().slice(0, 10))}</Text>

        <Text style={s.titulo}>
          Planilla de Retenciones a las Ganancias (del {fmtFecha(data.desde)} al {fmtFecha(data.hasta)})
        </Text>

        <View style={s.th}>
          <Text style={[s.thT, s.cFecha]}>Fecha</Text>
          <Text style={[s.thT, s.cOp]}>Ord. Pago</Text>
          <Text style={[s.thT, s.cCert]}>Certificado</Text>
          <Text style={[s.thT, s.cProv]}>Proveedor</Text>
          <Text style={[s.thT, s.cCuit]}>C.U.I.T.</Text>
          <Text style={[s.thT, s.cBase]}>Base</Text>
          <Text style={[s.thT, s.cAlic]}>Alíc.</Text>
          <Text style={[s.thT, s.cImp]}>Importe</Text>
        </View>
        {data.filas.map((f, x) => (
          <View key={x} style={s.tr} wrap={false}>
            <Text style={[s.td, s.cFecha, ...(f.anulada ? [s.anulada] : [])]}>{fmtFecha(f.fecha)}</Text>
            <Text style={[s.td, s.cOp, ...(f.anulada ? [s.anulada] : [])]}>{f.numero_op}</Text>
            <Text style={[s.td, s.cCert, ...(f.anulada ? [s.anulada] : [])]}>{f.numero_certificado}{f.anulada ? ' (anulada)' : ''}</Text>
            <Text style={[s.td, s.cProv, ...(f.anulada ? [s.anulada] : [])]}>{f.proveedor}</Text>
            <Text style={[s.td, s.cCuit, ...(f.anulada ? [s.anulada] : [])]}>{f.cuit}</Text>
            <Text style={[s.td, s.cBase, ...(f.anulada ? [s.anulada] : [])]}>{fmt(f.base)}</Text>
            <Text style={[s.td, s.cAlic, ...(f.anulada ? [s.anulada] : [])]}>{Number(f.alicuota).toFixed(2)}</Text>
            <Text style={[s.td, s.cImp, ...(f.anulada ? [s.anulada] : [])]}>{fmt(f.importe)}</Text>
          </View>
        ))}
        <View style={s.totRow}>
          <Text style={s.totVal}>{fmt(total)}</Text>
        </View>
      </Page>
    </Document>
  )
}
