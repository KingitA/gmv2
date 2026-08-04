/**
 * Template PDF de la Orden de Pago a proveedor.
 * Solo server-side (API routes). Muestra: qué se paga (imputaciones), cómo se
 * paga (medios con detalle de cheques/transferencia/efectivo), retenciones y
 * neto, con firmas de emisión y recepción.
 */

import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'

const fmt = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtFecha = (v?: string | null) => {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}

export interface OrdenPagoPDFData {
  empresa: { razon_social: string; cuit: string; direccion?: string | null; logo_url?: string | null; condicion_iva?: string | null }
  op: {
    numero_op: string; fecha: string; estado: string; observaciones?: string | null
    monto_total: number; retencion_ganancias: number; total_retenciones: number; neto_a_pagar: number; total_creditos: number
    numero_certificado?: string | null
  }
  proveedor: { nombre: string; cuit?: string | null; direccion?: string | null; localidad?: string | null }
  imputaciones: Array<{ etiqueta: string; fecha?: string | null; monto: number }>
  creditos: Array<{ etiqueta: string; monto: number }>
  medios: Array<{ medio: string; monto: number; detalle: string }>
}

const s = StyleSheet.create({
  page:     { fontFamily: 'Helvetica', fontSize: 9, padding: '24 28', backgroundColor: '#fff' },
  encTop:   { flexDirection: 'row', borderBottom: '2 solid #111', paddingBottom: 8 },
  emBlock:  { flex: 1 },
  emLogo:   { width: 130, height: 48, marginBottom: 3, objectFit: 'contain' },
  emNombre: { fontSize: 14, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase' },
  emSub:    { fontSize: 8, color: '#555', marginTop: 2 },
  docBlock: { width: 190, alignItems: 'flex-end' },
  docTit:   { fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#1e3a8a' },
  docNro:   { fontSize: 14, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  docFecha: { fontSize: 9, color: '#555', marginTop: 3 },
  estado:   { fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 3, textTransform: 'uppercase' },

  provBox:  { flexDirection: 'row', borderBottom: '1 solid #ccc', paddingVertical: 7 },
  lbl:      { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#999', letterSpacing: 0.7, marginBottom: 2 },
  provNom:  { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  provDato: { fontSize: 8.5, color: '#444', marginTop: 1.5 },

  secTit:   { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#1e3a8a', letterSpacing: 0.8, marginTop: 12, marginBottom: 4, textTransform: 'uppercase' },
  th:       { flexDirection: 'row', backgroundColor: '#111', padding: '3 6' },
  thT:      { color: '#fff', fontSize: 7, fontFamily: 'Helvetica-Bold' },
  tr:       { flexDirection: 'row', borderBottom: '0.5 solid #ddd', padding: '3.5 6' },
  td:       { fontSize: 8.5, color: '#333' },
  cFecha:   { width: 64 },
  cDesc:    { flex: 1 },
  cMonto:   { width: 90, textAlign: 'right' },

  totBox:   { flexDirection: 'row', marginTop: 14, borderTop: '2 solid #111', paddingTop: 8 },
  obs:      { flex: 1, paddingRight: 12 },
  obsTxt:   { fontSize: 8, color: '#555', lineHeight: 1.4 },
  tots:     { width: 230 },
  totRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5, borderBottom: '0.5 solid #eee' },
  totLbl:   { fontSize: 8.5, color: '#555' },
  totVal:   { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  grand:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5, paddingTop: 5, borderTop: '2 solid #111' },
  grandLbl: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  grandVal: { fontSize: 13, fontFamily: 'Helvetica-Bold' },

  firmas:   { flexDirection: 'row', marginTop: 44, gap: 30 },
  firma:    { flex: 1, borderTop: '1 solid #999', paddingTop: 4, alignItems: 'center' },
  firmaTxt: { fontSize: 7.5, color: '#666' },
  pie:      { position: 'absolute', bottom: 18, left: 28, right: 28, fontSize: 6.5, color: '#aaa', textAlign: 'center' },
})

const MEDIO_LABEL: Record<string, string> = {
  efectivo: 'Efectivo', cheque: 'Cheque', cheque_propio: 'Cheque propio',
  transferencia: 'Transferencia', deposito: 'Depósito',
}

export function OrdenPagoPDF({ data }: { data: OrdenPagoPDFData }) {
  const { empresa, op, proveedor, imputaciones, creditos, medios } = data
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.encTop}>
          <View style={s.emBlock}>
            {empresa.logo_url ? <Image src={empresa.logo_url} style={s.emLogo} /> : null}
            <Text style={s.emNombre}>{empresa.razon_social}</Text>
            <Text style={s.emSub}>CUIT {empresa.cuit} · {empresa.condicion_iva ?? 'Responsable Inscripto'}</Text>
            {empresa.direccion ? <Text style={s.emSub}>{empresa.direccion}</Text> : null}
          </View>
          <View style={s.docBlock}>
            <Text style={s.docTit}>ORDEN DE PAGO</Text>
            <Text style={s.docNro}>N° {op.numero_op}</Text>
            <Text style={s.docFecha}>Fecha: {fmtFecha(op.fecha)}</Text>
            <Text style={[s.estado, { color: op.estado === 'pagada' ? '#0a7a3d' : op.estado === 'anulada' ? '#b42318' : '#92600a' }]}>
              {op.estado === 'pagada' ? 'PAGADA' : op.estado === 'anulada' ? 'ANULADA' : 'PENDIENTE'}
            </Text>
          </View>
        </View>

        <View style={s.provBox}>
          <View style={{ flex: 1 }}>
            <Text style={s.lbl}>PROVEEDOR</Text>
            <Text style={s.provNom}>{proveedor.nombre}</Text>
            <Text style={s.provDato}>CUIT {proveedor.cuit ?? '—'}{proveedor.direccion ? ` · ${proveedor.direccion}` : ''}{proveedor.localidad ? ` · ${proveedor.localidad}` : ''}</Text>
          </View>
        </View>

        <Text style={s.secTit}>Qué se paga</Text>
        <View style={s.th}>
          <Text style={[s.thT, s.cFecha]}>FECHA</Text>
          <Text style={[s.thT, s.cDesc]}>COMPROBANTE / CONCEPTO</Text>
          <Text style={[s.thT, s.cMonto]}>IMPORTE</Text>
        </View>
        {imputaciones.length === 0 ? (
          <View style={s.tr}><Text style={[s.td, s.cDesc]}>Pago a cuenta</Text><Text style={[s.td, s.cMonto]}>$ {fmt(op.neto_a_pagar + op.total_retenciones)}</Text></View>
        ) : imputaciones.map((i, x) => (
          <View key={x} style={s.tr}>
            <Text style={[s.td, s.cFecha]}>{fmtFecha(i.fecha)}</Text>
            <Text style={[s.td, s.cDesc]}>{i.etiqueta}</Text>
            <Text style={[s.td, s.cMonto]}>$ {fmt(i.monto)}</Text>
          </View>
        ))}

        {creditos.length > 0 && (
          <>
            <Text style={s.secTit}>Notas de crédito / Reversas descontadas</Text>
            {creditos.map((c, x) => (
              <View key={x} style={s.tr}>
                <Text style={[s.td, s.cFecha]}></Text>
                <Text style={[s.td, s.cDesc]}>{c.etiqueta}</Text>
                <Text style={[s.td, s.cMonto]}>− $ {fmt(Math.abs(c.monto))}</Text>
              </View>
            ))}
          </>
        )}

        <Text style={s.secTit}>Cómo se paga</Text>
        <View style={s.th}>
          <Text style={[s.thT, { width: 90 }]}>MEDIO</Text>
          <Text style={[s.thT, s.cDesc]}>DETALLE</Text>
          <Text style={[s.thT, s.cMonto]}>IMPORTE</Text>
        </View>
        {medios.map((m, x) => (
          <View key={x} style={s.tr}>
            <Text style={[s.td, { width: 90, fontFamily: 'Helvetica-Bold' }]}>{MEDIO_LABEL[m.medio] ?? m.medio}</Text>
            <Text style={[s.td, s.cDesc]}>{m.detalle}</Text>
            <Text style={[s.td, s.cMonto]}>$ {fmt(m.monto)}</Text>
          </View>
        ))}

        <View style={s.totBox}>
          <View style={s.obs}>
            {op.retencion_ganancias > 0 && (
              <Text style={s.obsTxt}>
                Se practicó retención del Impuesto a las Ganancias (RG 830) por $ {fmt(op.retencion_ganancias)}
                {op.numero_certificado ? ` — Certificado N° ${op.numero_certificado} (se adjunta)` : ''}.
              </Text>
            )}
            {op.observaciones ? <Text style={[s.obsTxt, { marginTop: 4 }]}>{op.observaciones}</Text> : null}
          </View>
          <View style={s.tots}>
            <View style={s.totRow}><Text style={s.totLbl}>Total bruto</Text><Text style={s.totVal}>$ {fmt(op.monto_total + op.total_creditos)}</Text></View>
            {op.total_creditos > 0.009 && (
              <View style={s.totRow}><Text style={s.totLbl}>Notas de crédito / Reversas</Text><Text style={s.totVal}>− $ {fmt(op.total_creditos)}</Text></View>
            )}
            <View style={s.totRow}><Text style={s.totLbl}>Retención Ganancias</Text><Text style={s.totVal}>− $ {fmt(op.retencion_ganancias)}</Text></View>
            {op.total_retenciones - op.retencion_ganancias > 0.009 && (
              <View style={s.totRow}><Text style={s.totLbl}>Otras retenciones</Text><Text style={s.totVal}>− $ {fmt(op.total_retenciones - op.retencion_ganancias)}</Text></View>
            )}
            <View style={s.grand}><Text style={s.grandLbl}>NETO PAGADO</Text><Text style={s.grandVal}>$ {fmt(op.neto_a_pagar)}</Text></View>
          </View>
        </View>

        <View style={s.firmas}>
          <View style={s.firma}><Text style={s.firmaTxt}>Emitió (tesorería)</Text></View>
          <View style={s.firma}><Text style={s.firmaTxt}>Autorizó</Text></View>
          <View style={s.firma}><Text style={s.firmaTxt}>Recibí conforme (proveedor) — aclaración y DNI</Text></View>
        </View>

        <Text style={s.pie}>{empresa.razon_social} · CUIT {empresa.cuit} · Orden de pago {op.numero_op} — documento no válido como factura</Text>
      </Page>
    </Document>
  )
}
