/**
 * Template PDF del Recibo de Pago de clientes (reemplaza al HTML imprimible).
 * Mismo contenido: cliente, comprobantes cancelados, forma de pago con
 * sub-ítems (depósitos mixtos, cheques compartidos entre clientes),
 * retenciones que nos practicaron y totales.
 */

import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'

const fmt = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtFecha = (v?: string | null) => {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}

export interface ReciboPDFData {
  empresa: { razon_social: string; cuit: string; direccion?: string | null; logo_url?: string | null }
  recibo: { numero: string; fecha: string }
  cliente: { nombre: string; cuit?: string | null; direccion?: string | null }
  imputaciones: Array<{ tipo?: string | null; numero?: string | null; fecha?: string | null; total: number; cancelado: number }>
  metodos: Array<{ label: string; monto: number; subItems?: string[]; nota?: string }>
  retenciones: Array<{ tipo: string; fecha?: string | null; numero?: string | null; monto: number }>
  totales: { recibido: number; retenciones: number; neto: number }
}

const s = StyleSheet.create({
  page:     { fontFamily: 'Helvetica', fontSize: 9, padding: '24 28' },
  enc:      { flexDirection: 'row', borderBottom: '2 solid #111', paddingBottom: 8 },
  emLogo:   { width: 120, height: 44, marginBottom: 3, objectFit: 'contain' },
  emNombre: { fontSize: 14, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase' },
  emSub:    { fontSize: 8, color: '#555', marginTop: 1.5 },
  docBlock: { width: 180, alignItems: 'flex-end' },
  docTit:   { fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#0a5c36' },
  docNro:   { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  docFecha: { fontSize: 9, color: '#555', marginTop: 3 },

  secTit:   { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#0a5c36', letterSpacing: 0.8, marginTop: 11, marginBottom: 4, textTransform: 'uppercase' },
  cliNom:   { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  cliDato:  { fontSize: 8.5, color: '#444', marginTop: 1.5 },

  th:       { flexDirection: 'row', backgroundColor: '#111', padding: '3 6' },
  thT:      { color: '#fff', fontSize: 7, fontFamily: 'Helvetica-Bold' },
  tr:       { flexDirection: 'row', borderBottom: '0.5 solid #ddd', padding: '3.5 6' },
  sub:      { backgroundColor: '#fafafa', padding: '2.5 6 2.5 18', borderBottom: '0.5 solid #eee' },
  nota:     { backgroundColor: '#fffbe6', padding: '4 8', borderBottom: '0.5 solid #eee' },
  notaTxt:  { fontSize: 7.5, color: '#664d03', lineHeight: 1.4 },
  td:       { fontSize: 8.5, color: '#333' },
  cComp:    { flex: 1 },
  cFecha:   { width: 62 },
  cTotal:   { width: 80, textAlign: 'right' },
  cCanc:    { width: 80, textAlign: 'right' },

  tots:     { width: 240, alignSelf: 'flex-end', marginTop: 10 },
  totRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5, borderBottom: '0.5 solid #eee' },
  totLbl:   { fontSize: 8.5, color: '#555' },
  totVal:   { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  grand:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingTop: 5, borderTop: '2 solid #111' },
  grandLbl: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  grandVal: { fontSize: 13, fontFamily: 'Helvetica-Bold' },

  firmas:   { flexDirection: 'row', marginTop: 42, gap: 40 },
  firma:    { flex: 1, borderTop: '1 solid #999', paddingTop: 4, alignItems: 'center' },
  firmaTxt: { fontSize: 7.5, color: '#666' },
})

export function ReciboPDF({ data }: { data: ReciboPDFData }) {
  const { empresa, recibo, cliente, imputaciones, metodos, retenciones, totales } = data
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.enc}>
          <View style={{ flex: 1 }}>
            {empresa.logo_url ? <Image src={empresa.logo_url} style={s.emLogo} /> : null}
            <Text style={s.emNombre}>{empresa.razon_social}</Text>
            <Text style={s.emSub}>CUIT {empresa.cuit}{empresa.direccion ? ` · ${empresa.direccion}` : ''}</Text>
          </View>
          <View style={s.docBlock}>
            <Text style={s.docTit}>RECIBO DE PAGO</Text>
            <Text style={s.docNro}>{recibo.numero}</Text>
            <Text style={s.docFecha}>Fecha: {fmtFecha(recibo.fecha)}</Text>
          </View>
        </View>

        <Text style={s.secTit}>Cliente</Text>
        <Text style={s.cliNom}>{cliente.nombre}</Text>
        <Text style={s.cliDato}>CUIT {cliente.cuit ?? '—'}{cliente.direccion ? ` · ${cliente.direccion}` : ''}</Text>

        <Text style={s.secTit}>{imputaciones.length ? 'Comprobantes cancelados / afectados' : 'Aplicación del pago'}</Text>
        {imputaciones.length === 0 ? (
          <Text style={{ fontSize: 8.5, color: '#666' }}>Pago a cuenta — sin imputación a comprobantes específicos</Text>
        ) : (
          <>
            <View style={s.th}>
              <Text style={[s.thT, s.cComp]}>COMPROBANTE</Text>
              <Text style={[s.thT, s.cFecha]}>FECHA</Text>
              <Text style={[s.thT, s.cTotal]}>TOTAL</Text>
              <Text style={[s.thT, s.cCanc]}>CANCELADO</Text>
            </View>
            {imputaciones.map((i, x) => (
              <View key={x} style={s.tr}>
                <Text style={[s.td, s.cComp]}>{[i.tipo, i.numero].filter(Boolean).join(' ')}</Text>
                <Text style={[s.td, s.cFecha]}>{fmtFecha(i.fecha)}</Text>
                <Text style={[s.td, s.cTotal]}>$ {fmt(i.total)}</Text>
                <Text style={[s.td, s.cCanc, { fontFamily: 'Helvetica-Bold' }]}>$ {fmt(i.cancelado)}</Text>
              </View>
            ))}
          </>
        )}

        <Text style={s.secTit}>Forma de pago</Text>
        <View style={s.th}>
          <Text style={[s.thT, { flex: 1 }]}>DETALLE</Text>
          <Text style={[s.thT, { width: 90, textAlign: 'right' }]}>IMPORTE</Text>
        </View>
        {metodos.map((m, x) => (
          <View key={x}>
            <View style={s.tr}>
              <Text style={[s.td, { flex: 1 }]}>{m.label}</Text>
              <Text style={[s.td, { width: 90, textAlign: 'right' }]}>$ {fmt(m.monto)}</Text>
            </View>
            {(m.subItems ?? []).map((si, y) => (
              <View key={y} style={s.sub}><Text style={[s.td, { color: '#555' }]}>{si}</Text></View>
            ))}
            {m.nota ? <View style={s.nota}><Text style={s.notaTxt}>{m.nota}</Text></View> : null}
          </View>
        ))}

        {retenciones.length > 0 && (
          <>
            <Text style={s.secTit}>Retenciones</Text>
            <View style={s.th}>
              <Text style={[s.thT, { width: 100 }]}>TIPO</Text>
              <Text style={[s.thT, s.cFecha]}>FECHA</Text>
              <Text style={[s.thT, { flex: 1 }]}>N° COMPROBANTE</Text>
              <Text style={[s.thT, { width: 90, textAlign: 'right' }]}>IMPORTE</Text>
            </View>
            {retenciones.map((r, x) => (
              <View key={x} style={s.tr}>
                <Text style={[s.td, { width: 100 }]}>{r.tipo}</Text>
                <Text style={[s.td, s.cFecha]}>{fmtFecha(r.fecha)}</Text>
                <Text style={[s.td, { flex: 1 }]}>{r.numero ?? '—'}</Text>
                <Text style={[s.td, { width: 90, textAlign: 'right' }]}>$ {fmt(r.monto)}</Text>
              </View>
            ))}
          </>
        )}

        <View style={s.tots}>
          <View style={s.totRow}><Text style={s.totLbl}>Total recibido</Text><Text style={s.totVal}>$ {fmt(totales.recibido)}</Text></View>
          {totales.retenciones > 0 && (
            <View style={s.totRow}><Text style={s.totLbl}>Retenciones</Text><Text style={s.totVal}>− $ {fmt(totales.retenciones)}</Text></View>
          )}
          <View style={s.grand}><Text style={s.grandLbl}>NETO COBRADO</Text><Text style={s.grandVal}>$ {fmt(totales.neto)}</Text></View>
        </View>

        <View style={s.firmas}>
          <View style={s.firma}><Text style={s.firmaTxt}>Firma y aclaración cliente</Text></View>
          <View style={s.firma}><Text style={s.firmaTxt}>Firma y sello empresa</Text></View>
        </View>
      </Page>
    </Document>
  )
}
