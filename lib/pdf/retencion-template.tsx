/**
 * Template PDF del Certificado de Retención — Impuesto a las Ganancias RG 830.
 * Solo server-side. Rediseñado para ser legible (el del sistema anterior era
 * ilegible): datos del agente y del sujeto retenido, régimen, base, alícuota,
 * importe en números y letras, y los comprobantes que originaron el pago.
 */

import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'

const fmt = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtFecha = (v?: string | null) => {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}

export interface RetencionPDFData {
  empresa: { razon_social: string; cuit: string; direccion?: string | null; logo_url?: string | null }
  cert: {
    numero_certificado: string; fecha: string
    base_calculo: number; alicuota: number; monto: number
    regimen_descripcion?: string | null
    ajuste_manual?: boolean
  }
  op: { numero_op: string; fecha: string }
  proveedor: { nombre: string; cuit?: string | null; direccion?: string | null; localidad?: string | null }
  comprobantes: Array<{ etiqueta: string; fecha?: string | null; monto: number }>
}

// Monto en letras (es-AR, hasta miles de millones — suficiente para certificados)
function enLetras(n: number): string {
  const U = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte']
  const D = ['', '', 'veinti', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
  const C = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']
  const tramo = (x: number): string => {
    if (x === 0) return ''
    if (x === 100) return 'cien'
    let r = ''
    const c = Math.floor(x / 100), resto = x % 100
    if (c) r += C[c] + ' '
    if (resto <= 20) r += U[resto]
    else {
      const d = Math.floor(resto / 10), u = resto % 10
      if (d === 2) r += 'veinti' + (u ? U[u] : '')
      else r += D[d] + (u ? ' y ' + U[u] : '')
    }
    return r.trim()
  }
  const entero = Math.floor(n)
  const centavos = Math.round((n - entero) * 100)
  let partes: string[] = []
  const mm = Math.floor(entero / 1_000_000), miles = Math.floor((entero % 1_000_000) / 1000), resto = entero % 1000
  if (mm) partes.push(mm === 1 ? 'un millón' : tramo(mm) + ' millones')
  if (miles) partes.push(miles === 1 ? 'mil' : tramo(miles) + ' mil')
  if (resto || partes.length === 0) partes.push(tramo(resto) || 'cero')
  return `${partes.join(' ')} con ${String(centavos).padStart(2, '0')}/100`.toUpperCase()
}

const s = StyleSheet.create({
  page:     { fontFamily: 'Helvetica', fontSize: 9.5, padding: '26 32', backgroundColor: '#fff' },
  enc:      { flexDirection: 'row', borderBottom: '2 solid #111', paddingBottom: 8 },
  emLogo:   { width: 120, height: 44, marginBottom: 3, objectFit: 'contain' },
  emNombre: { fontSize: 13, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase' },
  emSub:    { fontSize: 8, color: '#555', marginTop: 1.5 },
  nroBlock: { width: 190, alignItems: 'flex-end' },
  nroLbl:   { fontSize: 7.5, color: '#777' },
  nroVal:   { fontSize: 14, fontFamily: 'Helvetica-Bold' },

  titulo:   { textAlign: 'center', marginTop: 14, marginBottom: 4, fontSize: 12.5, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },
  subtit:   { textAlign: 'center', fontSize: 9, color: '#555', marginBottom: 14 },

  box:      { border: '1 solid #ccc', borderRadius: 4, padding: '8 12', marginBottom: 10 },
  boxTit:   { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#999', letterSpacing: 0.8, marginBottom: 4 },
  row:      { flexDirection: 'row', marginBottom: 2.5 },
  rLbl:     { width: 130, fontSize: 8.5, color: '#666' },
  rVal:     { flex: 1, fontSize: 9.5, fontFamily: 'Helvetica-Bold' },

  destBox:  { flexDirection: 'row', gap: 10 },
  half:     { flex: 1 },

  montoBox: { border: '2 solid #111', borderRadius: 4, padding: '10 14', marginTop: 4, marginBottom: 10 },
  montoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  montoLbl: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  montoVal: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  letras:   { fontSize: 8, color: '#555', marginTop: 4 },

  th:       { flexDirection: 'row', backgroundColor: '#111', padding: '3 6', marginTop: 4 },
  thT:      { color: '#fff', fontSize: 7, fontFamily: 'Helvetica-Bold' },
  tr:       { flexDirection: 'row', borderBottom: '0.5 solid #ddd', padding: '3 6' },
  td:       { fontSize: 8.5, color: '#333' },

  legal:    { fontSize: 7.5, color: '#666', lineHeight: 1.5, marginTop: 12 },
  firma:    { marginTop: 46, width: 220, alignSelf: 'flex-end', borderTop: '1 solid #999', paddingTop: 4, alignItems: 'center' },
  firmaTxt: { fontSize: 7.5, color: '#666' },
})

export function RetencionPDF({ data }: { data: RetencionPDFData }) {
  const { empresa, cert, op, proveedor, comprobantes } = data
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.enc}>
          <View style={{ flex: 1 }}>
            {empresa.logo_url ? <Image src={empresa.logo_url} style={s.emLogo} /> : null}
            <Text style={s.emNombre}>{empresa.razon_social}</Text>
            <Text style={s.emSub}>CUIT {empresa.cuit} — Agente de Retención</Text>
            {empresa.direccion ? <Text style={s.emSub}>{empresa.direccion}</Text> : null}
          </View>
          <View style={s.nroBlock}>
            <Text style={s.nroLbl}>Certificado N°</Text>
            <Text style={s.nroVal}>{cert.numero_certificado}</Text>
            <Text style={[s.nroLbl, { marginTop: 5 }]}>Fecha de retención</Text>
            <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold' }}>{fmtFecha(cert.fecha)}</Text>
          </View>
        </View>

        <Text style={s.titulo}>CERTIFICADO DE RETENCIÓN</Text>
        <Text style={s.subtit}>Impuesto a las Ganancias — Régimen General de Retención R.G. (AFIP) 830</Text>

        <View style={s.destBox}>
          <View style={[s.box, s.half]}>
            <Text style={s.boxTit}>SUJETO RETENIDO</Text>
            <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>{proveedor.nombre}</Text>
            <Text style={{ fontSize: 8.5, color: '#444' }}>CUIT {proveedor.cuit ?? '—'}</Text>
            {(proveedor.direccion || proveedor.localidad) ? (
              <Text style={{ fontSize: 8.5, color: '#444' }}>{[proveedor.direccion, proveedor.localidad].filter(Boolean).join(' · ')}</Text>
            ) : null}
          </View>
          <View style={[s.box, s.half]}>
            <Text style={s.boxTit}>DATOS DE LA RETENCIÓN</Text>
            <View style={s.row}><Text style={s.rLbl}>Régimen</Text><Text style={s.rVal}>{cert.regimen_descripcion ?? 'RG 830'}</Text></View>
            <View style={s.row}><Text style={s.rLbl}>Orden de pago</Text><Text style={s.rVal}>{op.numero_op} ({fmtFecha(op.fecha)})</Text></View>
            <View style={s.row}><Text style={s.rLbl}>Base de cálculo</Text><Text style={s.rVal}>$ {fmt(cert.base_calculo)}</Text></View>
            <View style={s.row}><Text style={s.rLbl}>Alícuota</Text><Text style={s.rVal}>{Number(cert.alicuota)} %</Text></View>
          </View>
        </View>

        <View style={s.montoBox}>
          <View style={s.montoRow}>
            <Text style={s.montoLbl}>IMPORTE RETENIDO</Text>
            <Text style={s.montoVal}>$ {fmt(cert.monto)}</Text>
          </View>
          <Text style={s.letras}>SON PESOS: {enLetras(cert.monto)}</Text>
        </View>

        {comprobantes.length > 0 && (
          <>
            <View style={s.th}>
              <Text style={[s.thT, { width: 70 }]}>FECHA</Text>
              <Text style={[s.thT, { flex: 1 }]}>COMPROBANTES QUE ORIGINAN EL PAGO</Text>
              <Text style={[s.thT, { width: 90, textAlign: 'right' }]}>IMPORTE</Text>
            </View>
            {comprobantes.map((c, x) => (
              <View key={x} style={s.tr}>
                <Text style={[s.td, { width: 70 }]}>{fmtFecha(c.fecha)}</Text>
                <Text style={[s.td, { flex: 1 }]}>{c.etiqueta}</Text>
                <Text style={[s.td, { width: 90, textAlign: 'right' }]}>$ {fmt(c.monto)}</Text>
              </View>
            ))}
          </>
        )}

        <Text style={s.legal}>
          El presente certificado se emite de acuerdo con lo dispuesto por la Resolución General (AFIP) N° 830/2000,
          sus modificatorias y complementarias. El importe retenido será ingresado e informado a través del sistema
          SICORE. Este comprobante constituye constancia suficiente de la retención practicada a los efectos de su
          cómputo en la declaración jurada del impuesto por parte del sujeto retenido.
        </Text>

        <View style={s.firma}>
          <Text style={s.firmaTxt}>Firma y aclaración — {empresa.razon_social}</Text>
        </View>
      </Page>
    </Document>
  )
}
