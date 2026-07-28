/**
 * Template PDF de órdenes de compra (pedido al proveedor).
 * Solo se ejecuta server-side (API routes). NO agregar 'use client'.
 * Un solo archivo con las cantidades totales del pedido: EAN13, SKU,
 * descripción, cantidad, precio neto, descuentos, IVA y totales.
 */

import {
  Document, Page, Text, View, StyleSheet, Image,
} from '@react-pdf/renderer'

const fmtARS = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtFechaISO = (v?: string | null) => {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}

const s = StyleSheet.create({
  page:      { fontFamily: 'Helvetica', fontSize: 9, padding: 0, backgroundColor: '#fff', flexDirection: 'column' },
  stripe:    { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: '#0a4d2c' },

  headerFixed: { marginLeft: 4, padding: '10 12 0 10' },
  encTop:    { flexDirection: 'row', borderBottom: '2 solid #111' },
  emBlock:   { flex: 1, paddingRight: 10, borderRight: '1 solid #ccc', paddingBottom: 6 },
  emLogo:    { width: 150, height: 56, marginBottom: 4 },
  emNombre:  { fontSize: 15, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', marginBottom: 3 },
  emRow:     { flexDirection: 'row', marginBottom: 2 },
  emLbl:     { fontFamily: 'Helvetica-Bold', width: 70, fontSize: 8 },
  emVal:     { fontSize: 8, color: '#444', flex: 1 },

  compBlock: { width: 180, paddingLeft: 10, paddingBottom: 6 },
  tituloDoc: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#0a4d2c', marginBottom: 4 },
  compNro:   { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  compRow:   { flexDirection: 'row', marginBottom: 2 },
  compLbl:   { fontFamily: 'Helvetica-Bold', width: 70, fontSize: 8 },
  compVal:   { fontSize: 8, color: '#444', flex: 1 },
  hojaText:  { fontSize: 7.5, color: '#555', fontFamily: 'Helvetica-Bold', marginTop: 4 },

  encProv:   { flexDirection: 'row', borderBottom: '2 solid #111', paddingVertical: 6 },
  provCol:   { flex: 1 },
  provTit:   { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#aaa', letterSpacing: 0.8, marginBottom: 3 },
  provRazon: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  provRow:   { flexDirection: 'row', marginBottom: 1.5 },
  provLbl:   { fontFamily: 'Helvetica-Bold', width: 75, fontSize: 8 },
  provVal:   { fontSize: 8, color: '#444', flex: 1 },

  tableHead: { flexDirection: 'row', backgroundColor: '#111', padding: '4 3' },
  thText:    { color: '#fff', fontSize: 7, fontFamily: 'Helvetica-Bold', letterSpacing: 0.3 },
  bodyRows:  { marginLeft: 4, padding: '0 12 10 10' },
  tableRow:  { flexDirection: 'row', borderBottom: '0.5 solid #ddd', minHeight: 14, alignItems: 'center', paddingVertical: 2, paddingHorizontal: 3 },
  rowAlt:    { backgroundColor: '#f5f5f5' },
  td:        { fontSize: 7.5, color: '#444' },
  tdBold:    { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#111' },
  cEan:      { width: 72 },
  cSku:      { width: 42 },
  cDesc:     { flex: 1 },
  cCant:     { width: 38, textAlign: 'center' },
  cPrecio:   { width: 52, textAlign: 'right' },
  cDesc4:    { width: 52, textAlign: 'center' },
  cNeto:     { width: 52, textAlign: 'right' },
  cTotal:    { width: 60, textAlign: 'right' },

  spacer:    { flex: 1 },
  footer:    { marginLeft: 4 },
  totArea:   { flexDirection: 'row', borderTop: '2 solid #111' },
  obsBlock:  { flex: 1, padding: '6 10', borderRight: '1 solid #ccc' },
  obsTit:    { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#bbb', letterSpacing: 0.7, marginBottom: 3 },
  obsText:   { fontSize: 8, color: '#444', lineHeight: 1.4 },
  totNums:   { width: 200, padding: '6 10' },
  totRow:    { flexDirection: 'row', justifyContent: 'space-between', borderBottom: '0.5 solid #eee', paddingVertical: 2.5 },
  totLbl:    { fontSize: 8, color: '#555' },
  totVal:    { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111' },
  grand:     { flexDirection: 'row', justifyContent: 'space-between', borderTop: '2 solid #111', marginTop: 6, paddingTop: 5 },
  grandLbl:  { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  grandVal:  { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  pie:       { padding: '4 12 8 12' },
  pieLegal:  { fontSize: 7, color: '#aaa', lineHeight: 1.5 },
})

export interface OrdenCompraPDFLinea {
  ean13?: string | null
  sku?: string | null
  descripcion: string
  cantidad: number
  tipo_cantidad?: string | null
  precio_unitario: number       // precio de lista (neto, sin IVA)
  descuentos: number[]          // [d1, d2, d3, d4] en %
  precio_neto: number           // precio post-descuentos (sin IVA)
  total_linea: number           // precio_neto * cantidad
}

export interface OrdenCompraPDFData {
  orden: {
    numero_orden: string
    fecha_orden: string
    fecha_estimada_recepcion?: string | null
    condicion_pago?: string | null
    observaciones?: string | null
  }
  empresa: {
    razon_social: string
    cuit?: string | null
    direccion?: string | null
    telefono?: string | null
    email?: string | null
    logo_url?: string | null
  } | null
  proveedor: {
    nombre: string
    cuit?: string | null
    direccion?: string | null
    telefono?: string | null
    email?: string | null
  }
  detalle: OrdenCompraPDFLinea[]
  totales: {
    subtotal_neto: number
    iva: number
    total: number
    unidades: number
  }
}

export function OrdenCompraPDF({ data }: { data: OrdenCompraPDFData }) {
  const { orden, empresa, proveedor, detalle, totales } = data
  const fmtDesc = (ds: number[]) => {
    const activos = ds.filter(d => d > 0)
    return activos.length > 0 ? activos.map(d => `${d}%`).join('+') : '—'
  }

  return (
    <Document title={`Orden de Compra ${orden.numero_orden}`} author={empresa?.razon_social ?? 'GM'}>
      <Page size="A4" style={s.page}>
        <View style={s.stripe} fixed />

        <View style={s.headerFixed} fixed>
          <View style={s.encTop}>
            <View style={s.emBlock}>
              {empresa?.logo_url
                ? <Image style={s.emLogo} src={empresa.logo_url} />
                : <Text style={s.emNombre}>{empresa?.razon_social ?? '—'}</Text>}
              {empresa?.cuit && <View style={s.emRow}><Text style={s.emLbl}>CUIT:</Text><Text style={s.emVal}>{empresa.cuit}</Text></View>}
              {empresa?.direccion && <View style={s.emRow}><Text style={s.emLbl}>Domicilio:</Text><Text style={s.emVal}>{empresa.direccion}</Text></View>}
              {empresa?.telefono && <View style={s.emRow}><Text style={s.emLbl}>Teléfono:</Text><Text style={s.emVal}>{empresa.telefono}</Text></View>}
              {empresa?.email && <View style={s.emRow}><Text style={s.emLbl}>Email:</Text><Text style={s.emVal}>{empresa.email}</Text></View>}
            </View>
            <View style={s.compBlock}>
              <Text style={s.tituloDoc}>ORDEN DE COMPRA</Text>
              <Text style={s.compNro}>N° {orden.numero_orden}</Text>
              <View style={s.compRow}><Text style={s.compLbl}>Fecha:</Text><Text style={s.compVal}>{fmtFechaISO(orden.fecha_orden)}</Text></View>
              {orden.fecha_estimada_recepcion && (
                <View style={s.compRow}><Text style={s.compLbl}>Entrega est.:</Text><Text style={s.compVal}>{fmtFechaISO(orden.fecha_estimada_recepcion)}</Text></View>
              )}
              {orden.condicion_pago && (
                <View style={s.compRow}><Text style={s.compLbl}>Cond. pago:</Text><Text style={s.compVal}>{orden.condicion_pago}</Text></View>
              )}
              <Text style={s.hojaText} render={({ pageNumber, totalPages }) =>
                (totalPages ?? 1) > 1 ? `Hoja ${pageNumber} de ${totalPages}` : ''
              } />
            </View>
          </View>

          <View style={s.encProv}>
            <View style={s.provCol}>
              <Text style={s.provTit}>PROVEEDOR</Text>
              <Text style={s.provRazon}>{proveedor.nombre}</Text>
              <View style={s.provRow}><Text style={s.provLbl}>CUIT:</Text><Text style={s.provVal}>{proveedor.cuit ?? '—'}</Text></View>
              {proveedor.direccion && <View style={s.provRow}><Text style={s.provLbl}>Domicilio:</Text><Text style={s.provVal}>{proveedor.direccion}</Text></View>}
              {proveedor.telefono && <View style={s.provRow}><Text style={s.provLbl}>Teléfono:</Text><Text style={s.provVal}>{proveedor.telefono}</Text></View>}
            </View>
          </View>

          <View style={s.tableHead}>
            <Text style={[s.thText, s.cEan]}>EAN13</Text>
            <Text style={[s.thText, s.cSku]}>SKU</Text>
            <Text style={[s.thText, s.cDesc]}>Descripción</Text>
            <Text style={[s.thText, s.cCant]}>Cant.</Text>
            <Text style={[s.thText, s.cPrecio]}>P. Lista</Text>
            <Text style={[s.thText, s.cDesc4]}>Desc.</Text>
            <Text style={[s.thText, s.cNeto]}>P. Neto</Text>
            <Text style={[s.thText, s.cTotal]}>Total</Text>
          </View>
        </View>

        <View style={s.bodyRows}>
          {detalle.map((l, i) => (
            <View key={i} wrap={false} style={[s.tableRow, i % 2 === 1 ? s.rowAlt : {}]}>
              <Text style={[s.td, s.cEan, { fontSize: 7, color: '#888' }]}>{l.ean13 ?? ''}</Text>
              <Text style={[s.td, s.cSku, { fontSize: 7, color: '#888' }]}>{l.sku ?? ''}</Text>
              <Text style={[s.tdBold, s.cDesc]}>{l.descripcion}</Text>
              <Text style={[s.tdBold, s.cCant]}>{String(l.cantidad)}{l.tipo_cantidad === 'bulto' ? ' blt' : ''}</Text>
              <Text style={[s.td, s.cPrecio]}>${fmtARS(l.precio_unitario)}</Text>
              <Text style={[s.td, s.cDesc4]}>{fmtDesc(l.descuentos)}</Text>
              <Text style={[s.td, s.cNeto]}>${fmtARS(l.precio_neto)}</Text>
              <Text style={[s.tdBold, s.cTotal]}>${fmtARS(l.total_linea)}</Text>
            </View>
          ))}
        </View>

        <View style={s.spacer} />

        <View style={s.footer} wrap={false}>
          <View style={s.totArea}>
            <View style={s.obsBlock}>
              <Text style={s.obsTit}>OBSERVACIONES</Text>
              <Text style={s.obsText}>{orden.observaciones || '—'}</Text>
            </View>
            <View style={s.totNums}>
              <View style={s.totRow}>
                <Text style={s.totLbl}>Total unidades / bultos</Text>
                <Text style={s.totVal}>{String(totales.unidades)}</Text>
              </View>
              <View style={s.totRow}>
                <Text style={s.totLbl}>Subtotal neto</Text>
                <Text style={s.totVal}>${fmtARS(totales.subtotal_neto)}</Text>
              </View>
              <View style={s.totRow}>
                <Text style={s.totLbl}>IVA 21%</Text>
                <Text style={s.totVal}>${fmtARS(totales.iva)}</Text>
              </View>
              <View style={s.grand}>
                <Text style={s.grandLbl}>TOTAL</Text>
                <Text style={s.grandVal}>${fmtARS(totales.total)}</Text>
              </View>
            </View>
          </View>
          <View style={s.pie}>
            <Text style={s.pieLegal}>
              Orden de compra — documento no válido como factura. Precios netos sin IVA salvo indicación. Sujeta a confirmación del proveedor.
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
