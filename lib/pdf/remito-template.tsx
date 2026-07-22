/**
 * Template PDF de remitos.
 * Solo se ejecuta server-side (API routes). NO agregar 'use client'.
 * Un solo PDF por remito: una página por copia (ORIGINAL / DUPLICADO / TRIPLICADO).
 * Una vez generado se sube a Supabase Storage y queda congelado (inmutable).
 *
 * REM  (letra R, cód. AFIP 91): remito fiscal, acompaña facturas FA/FB.
 *      Encabezado con datos de la empresa (RG 1415).
 * REMX (letra X): remito de presupuesto. SIN ningún dato de la empresa,
 *      sin valorizar por ítem, con el subtotal aclarado.
 */

import {
  Document, Page, Text, View, StyleSheet, Image,
} from '@react-pdf/renderer'

const fmtARS = (n: number) =>
  Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtFechaISO = (v?: string | null) => {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}

const REMITO_CONFIG: Record<string, { letra: string; nombre: string; color: string }> = {
  REM:  { letra: 'R', nombre: 'REMITO', color: '#004060' },
  REMX: { letra: 'X', nombre: 'REMITO', color: '#28085a' },
}

const CONDICION_ENTREGA_LABEL: Record<string, string> = {
  entregamos_nosotros: 'Entrega con flota propia',
  transporte:          'Envío por transporte',
  retira_mostrador:    'Retira en mostrador',
}

const s = StyleSheet.create({
  page:        { fontFamily: 'Helvetica', fontSize: 9, padding: 0, backgroundColor: '#fff', flexDirection: 'column' },
  stripe:      { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },

  copiaBand:   { marginLeft: 4, backgroundColor: '#e8e8e8', borderBottom: '1 solid #999', padding: '3 12', alignItems: 'center' },
  copiaText:   { fontSize: 8.5, fontFamily: 'Helvetica-Bold', letterSpacing: 2, color: '#333' },

  headerFixed: { marginLeft: 4, padding: '8 12 0 10' },
  bodyRows:    { marginLeft: 4, padding: '0 12 10 10' },
  footer:      { marginLeft: 4 },
  spacer:      { flex: 1 },

  encTop:      { flexDirection: 'row', borderBottom: '2 solid #111' },
  emBlock:     { flex: 1, paddingRight: 10, borderRight: '1 solid #ccc', paddingBottom: 6 },
  emLogo:      { width: 150, height: 56, marginBottom: 4 },
  emNombre:    { fontSize: 15, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', marginBottom: 3 },
  emRow:       { flexDirection: 'row', marginBottom: 2 },
  emLbl:       { fontFamily: 'Helvetica-Bold', width: 80, fontSize: 8 },
  emVal:       { fontSize: 8, color: '#444', flex: 1 },

  tipoBox:     { width: 80, alignItems: 'center', justifyContent: 'center', borderRight: '1 solid #ccc', paddingVertical: 6 },
  letraBox:    { width: 52, height: 52, border: '3 solid #111', alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  letraText:   { fontSize: 36, fontFamily: 'Helvetica-Bold' },
  tipoNombre:  { fontSize: 6.5, color: '#666', textAlign: 'center', letterSpacing: 0.5 },
  codDoc:      { fontSize: 6, color: '#999', marginTop: 2 },

  compBlock:   { width: 160, paddingLeft: 10, paddingBottom: 6 },
  compNro:     { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  compRow:     { flexDirection: 'row', marginBottom: 2 },
  compLbl:     { fontFamily: 'Helvetica-Bold', width: 55, fontSize: 8 },
  compVal:     { fontSize: 8, color: '#444', flex: 1 },
  hojaText:    { fontSize: 7.5, color: '#555', fontFamily: 'Helvetica-Bold', marginTop: 4 },

  noval:       { backgroundColor: '#eee', padding: '3 8', borderBottom: '2 solid #555' },
  novalText:   { fontSize: 8, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5, textAlign: 'center', color: '#333' },

  encCli:      { flexDirection: 'row', borderBottom: '2 solid #111', paddingVertical: 6 },
  cliCol:      { flex: 1, paddingRight: 8 },
  cliCol2:     { width: 190, paddingLeft: 8, borderLeft: '1 solid #ccc' },
  cliTit:      { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#aaa', letterSpacing: 0.8, marginBottom: 3, borderBottom: '0.5 solid #eee', paddingBottom: 2 },
  cliRazon:    { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  cliRow:      { flexDirection: 'row', marginBottom: 1.5 },
  cliLbl:      { fontFamily: 'Helvetica-Bold', width: 65, fontSize: 8 },
  cliVal:      { fontSize: 8, color: '#444', flex: 1 },

  tableHead:   { flexDirection: 'row', backgroundColor: '#111', padding: '4 3' },
  thText:      { color: '#fff', fontSize: 7.5, fontFamily: 'Helvetica-Bold', letterSpacing: 0.4 },
  tableRow:    { flexDirection: 'row', borderBottom: '0.5 solid #ddd', minHeight: 15, alignItems: 'center', paddingVertical: 2, paddingHorizontal: 3 },
  tableRowAlt: { backgroundColor: '#f5f5f5' },
  tdText:      { fontSize: 8.5, color: '#444' },
  tdBold:      { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: '#111' },
  cCod:        { width: 60 },
  cDesc:       { flex: 1 },
  cCant:       { width: 70, textAlign: 'center', borderLeft: '1.5 solid #bbb' },

  totArea:     { flexDirection: 'row', borderTop: '2 solid #111' },
  transpBlock: { flex: 1, padding: '6 10', borderRight: '1 solid #ccc' },
  transpTit:   { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#bbb', letterSpacing: 0.7, marginBottom: 3 },
  transpRow:   { flexDirection: 'row', marginBottom: 2.5 },
  transpLbl:   { fontFamily: 'Helvetica-Bold', width: 85, fontSize: 8 },
  transpVal:   { fontSize: 8, color: '#444', flex: 1 },
  blank:       { borderBottom: '0.5 solid #888', flex: 1, height: 9 },

  totNums:     { width: 190, padding: '6 10' },
  totRow:      { flexDirection: 'row', justifyContent: 'space-between', borderBottom: '0.5 solid #eee', paddingVertical: 2.5 },
  totLbl:      { fontSize: 8, color: '#555' },
  totVal:      { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111' },
  subGrand:    { flexDirection: 'row', justifyContent: 'space-between', borderTop: '2 solid #111', marginTop: 6, paddingTop: 5 },
  subGLbl:     { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  subGVal:     { fontSize: 14, fontFamily: 'Helvetica-Bold' },

  firmas:      { flexDirection: 'row', borderTop: '0.5 solid #ccc', padding: '4 12 10 12' },
  firmaCol:    { flex: 1, alignItems: 'center', paddingHorizontal: 10 },
  firmaLinea:  { borderTop: '0.5 solid #111', width: '100%', marginBottom: 2, marginTop: 26 },
  firmaLbl:    { fontSize: 6.5, color: '#888', letterSpacing: 0.5, textAlign: 'center' },

  pie:         { padding: '4 12 8 12' },
  pieLegal:    { fontSize: 7, color: '#aaa', lineHeight: 1.5 },
})

export interface RemitoPDFData {
  remito: {
    id: string
    tipo_remito: 'REM' | 'REMX'
    numero_remito: string
    fecha: string
    valor_declarado: number
    bultos?: number | null
    observaciones?: string | null
    comprobante_numero?: string | null   // "s/ Factura A 0007-00000123" (solo REM)
    comprobante_tipo?: string | null
  }
  /** null para REMX: el remito de presupuesto no lleva ningún dato de la empresa */
  empresa: {
    razon_social: string
    cuit: string
    direccion?: string | null
    telefono?: string | null
    condicion_iva?: string | null
    iibb?: string | null
    numero_iibb?: string | null
    inicio_actividades?: string | null
    logo_url?: string | null
  } | null
  cliente: {
    nombre_razon_social: string
    cuit?: string | null
    direccion?: string | null
    localidad?: string | null
    condicion_iva?: string | null
  }
  /** null → líneas en blanco para completar a mano al despachar */
  transporte?: { nombre: string; cuit?: string | null } | null
  condicion_entrega: string
  copias: string[]   // ['ORIGINAL','DUPLICADO'] o ['ORIGINAL','DUPLICADO','TRIPLICADO']
  detalle: Array<{ sku?: string | null; descripcion: string; cantidad: number }>
  numero_pedido?: string | null
}

const TIPO_COMP_LABEL: Record<string, string> = {
  FA: 'Factura A', FB: 'Factura B', PRES: 'Presupuesto',
}

function RemitoPagina({ data, copia }: { data: RemitoPDFData; copia: string }) {
  const { remito, empresa, cliente, transporte, detalle } = data
  const cfg  = REMITO_CONFIG[remito.tipo_remito] ?? REMITO_CONFIG.REM
  const esR  = remito.tipo_remito === 'REM' && empresa != null
  const cantTotal = detalle.reduce((sum, d) => sum + Math.abs(Number(d.cantidad) || 0), 0)

  return (
    <Page size="A4" style={s.page}>
      <View style={[s.stripe, { backgroundColor: cfg.color }]} fixed />

      {/* Banda de copia — se repite en cada hoja de esta copia */}
      <View style={s.copiaBand} fixed>
        <Text style={s.copiaText}>{copia}</Text>
      </View>

      {/* ── Encabezado: se repite en cada hoja (RG 1415) ── */}
      <View style={s.headerFixed} fixed>
        <View style={s.encTop}>
          {esR ? (
            /* Remito R: datos de la empresa emisora */
            <View style={s.emBlock}>
              {empresa!.logo_url
                ? <Image style={s.emLogo} src={empresa!.logo_url} />
                : <Text style={s.emNombre}>{empresa!.razon_social}</Text>}
              <View style={s.emRow}><Text style={s.emLbl}>CUIT:</Text><Text style={s.emVal}>{empresa!.cuit}</Text></View>
              <View style={s.emRow}><Text style={s.emLbl}>Cond. IVA:</Text><Text style={s.emVal}>{empresa!.condicion_iva ?? 'Responsable Inscripto'}</Text></View>
              <View style={s.emRow}><Text style={s.emLbl}>Ing. Brutos:</Text><Text style={s.emVal}>{empresa!.numero_iibb ?? empresa!.iibb ?? '—'}</Text></View>
              {empresa!.inicio_actividades && (
                <View style={s.emRow}><Text style={s.emLbl}>Inicio Act.:</Text><Text style={s.emVal}>{fmtFechaISO(empresa!.inicio_actividades)}</Text></View>
              )}
              <View style={s.emRow}><Text style={s.emLbl}>Domicilio:</Text><Text style={s.emVal}>{empresa!.direccion ?? '—'}</Text></View>
              <View style={s.emRow}><Text style={s.emLbl}>Teléfono:</Text><Text style={s.emVal}>{empresa!.telefono ?? '—'}</Text></View>
            </View>
          ) : (
            /* Remito X: SIN datos de la empresa — encabezado único con el cliente */
            <View style={s.emBlock}>
              <Text style={s.emNombre}>{cliente.nombre_razon_social}</Text>
              <View style={s.emRow}><Text style={s.emLbl}>Dirección:</Text><Text style={s.emVal}>{cliente.direccion ?? '—'}</Text></View>
              <View style={s.emRow}><Text style={s.emLbl}>Localidad:</Text><Text style={s.emVal}>{cliente.localidad ?? '—'}</Text></View>
              <View style={s.emRow}><Text style={s.emLbl}>Entrega:</Text><Text style={s.emVal}>{CONDICION_ENTREGA_LABEL[data.condicion_entrega] ?? data.condicion_entrega}</Text></View>
            </View>
          )}

          {/* Letra */}
          <View style={s.tipoBox}>
            <View style={[s.letraBox, { borderColor: cfg.color }]}>
              <Text style={[s.letraText, { color: cfg.color }]}>{cfg.letra}</Text>
            </View>
            <Text style={s.tipoNombre}>{cfg.nombre}</Text>
            {esR && <Text style={s.codDoc}>COD. 91</Text>}
          </View>

          {/* Número + fecha + referencia */}
          <View style={s.compBlock}>
            <Text style={s.compNro}>N° {remito.numero_remito}</Text>
            <View style={s.compRow}><Text style={s.compLbl}>Fecha:</Text><Text style={s.compVal}>{fmtFechaISO(remito.fecha)}</Text></View>
            {remito.comprobante_numero && (
              <View style={s.compRow}>
                <Text style={s.compLbl}>Ref.:</Text>
                <Text style={s.compVal}>
                  {`${TIPO_COMP_LABEL[remito.comprobante_tipo ?? ''] ?? remito.comprobante_tipo ?? ''} ${remito.comprobante_numero}`.trim()}
                </Text>
              </View>
            )}
            {data.numero_pedido && (
              <View style={s.compRow}><Text style={s.compLbl}>N° Pedido:</Text><Text style={s.compVal}>{data.numero_pedido}</Text></View>
            )}
            <Text style={s.hojaText} render={({ subPageNumber, subPageTotalPages }) =>
              (subPageTotalPages ?? 1) > 1 ? `Hoja ${subPageNumber} de ${subPageTotalPages}` : ''
            } />
          </View>
        </View>

        <View style={s.noval}>
          <Text style={s.novalText}>DOCUMENTO NO VÁLIDO COMO FACTURA</Text>
        </View>

        {/* Destinatario (solo R: en X el cliente ya encabeza el documento) */}
        {esR && (
          <View style={s.encCli}>
            <View style={s.cliCol}>
              <Text style={s.cliTit}>DESTINATARIO</Text>
              <Text style={s.cliRazon}>{cliente.nombre_razon_social}</Text>
              <View style={s.cliRow}><Text style={s.cliLbl}>CUIT:</Text><Text style={s.cliVal}>{cliente.cuit ?? '—'}</Text></View>
              <View style={s.cliRow}><Text style={s.cliLbl}>Cond. IVA:</Text><Text style={s.cliVal}>{cliente.condicion_iva ?? '—'}</Text></View>
            </View>
            <View style={s.cliCol2}>
              <Text style={s.cliTit}>LUGAR DE ENTREGA</Text>
              <View style={s.cliRow}><Text style={s.cliLbl}>Domicilio:</Text><Text style={s.cliVal}>{cliente.direccion ?? '—'}</Text></View>
              <View style={s.cliRow}><Text style={s.cliLbl}>Localidad:</Text><Text style={s.cliVal}>{cliente.localidad ?? '—'}</Text></View>
              <View style={s.cliRow}><Text style={s.cliLbl}>Entrega:</Text><Text style={s.cliVal}>{CONDICION_ENTREGA_LABEL[data.condicion_entrega] ?? data.condicion_entrega}</Text></View>
            </View>
          </View>
        )}

        {/* Tabla — encabezado */}
        <View style={s.tableHead}>
          <Text style={[s.thText, s.cCod]}>Código</Text>
          <Text style={[s.thText, s.cDesc]}>Descripción</Text>
          <Text style={[s.thText, s.cCant]}>Cantidad</Text>
        </View>
      </View>

      {/* Filas — sin precios: el remito acompaña la mercadería, no la valoriza */}
      <View style={s.bodyRows}>
        {detalle.map((item, i) => (
          <View key={i} wrap={false} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
            <Text style={[s.tdText, s.cCod, { fontSize: 7.5, color: '#888' }]}>{item.sku ?? ''}</Text>
            <Text style={[s.tdBold, s.cDesc, { fontSize: 8 }]}>{item.descripcion}</Text>
            <Text style={[s.tdBold, s.cCant]}>{String(Math.abs(Number(item.cantidad) || 0))}</Text>
          </View>
        ))}
      </View>

      <View style={s.spacer} />

      {/* ── Bloque inferior anclado: transporte + totales + firmas ── */}
      <View style={s.footer} wrap={false}>
        <View style={s.totArea}>
          <View style={s.transpBlock}>
            <Text style={s.transpTit}>DATOS DEL TRANSPORTE</Text>
            <View style={s.transpRow}>
              <Text style={s.transpLbl}>Transportista:</Text>
              {transporte?.nombre ? <Text style={s.transpVal}>{transporte.nombre}</Text> : <View style={s.blank} />}
            </View>
            <View style={s.transpRow}>
              <Text style={s.transpLbl}>CUIT transp.:</Text>
              {transporte?.cuit ? <Text style={s.transpVal}>{transporte.cuit}</Text> : <View style={s.blank} />}
            </View>
            <View style={s.transpRow}>
              <Text style={s.transpLbl}>Chofer / Pat.:</Text>
              <View style={s.blank} />
            </View>
            {remito.observaciones ? (
              <View style={s.transpRow}>
                <Text style={s.transpLbl}>Observaciones:</Text>
                <Text style={s.transpVal}>{remito.observaciones}</Text>
              </View>
            ) : null}
          </View>
          <View style={s.totNums}>
            <View style={s.totRow}>
              <Text style={s.totLbl}>Total unidades</Text>
              <Text style={s.totVal}>{String(cantTotal)}</Text>
            </View>
            <View style={s.totRow}>
              <Text style={s.totLbl}>Bultos</Text>
              <Text style={s.totVal}>{remito.bultos && remito.bultos > 0 ? String(remito.bultos) : '________'}</Text>
            </View>
            {esR ? (
              <View style={s.subGrand}>
                <Text style={s.subGLbl}>VALOR DECLARADO</Text>
                <Text style={s.subGVal}>${fmtARS(remito.valor_declarado)}</Text>
              </View>
            ) : (
              <View style={s.subGrand}>
                <Text style={s.subGLbl}>SUBTOTAL</Text>
                <Text style={s.subGVal}>${fmtARS(remito.valor_declarado)}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Recepción */}
        <View style={s.firmas}>
          <View style={s.firmaCol}><View style={s.firmaLinea} /><Text style={s.firmaLbl}>RECIBÍ CONFORME — FIRMA</Text></View>
          <View style={s.firmaCol}><View style={s.firmaLinea} /><Text style={s.firmaLbl}>ACLARACIÓN</Text></View>
          <View style={s.firmaCol}><View style={s.firmaLinea} /><Text style={s.firmaLbl}>DNI</Text></View>
          <View style={s.firmaCol}><View style={s.firmaLinea} /><Text style={s.firmaLbl}>FECHA</Text></View>
        </View>

        <View style={s.pie}>
          <Text style={s.pieLegal}>
            {esR
              ? 'Remito emitido conforme RG ARCA 1415 — documento no válido como factura. La mercadería viaja por cuenta y riesgo del comprador salvo pacto en contrario.'
              : 'Remito de entrega — documento no válido como factura.'}
          </Text>
        </View>
      </View>
    </Page>
  )
}

export function RemitoPDF({ data }: { data: RemitoPDFData }) {
  const cfg = REMITO_CONFIG[data.remito.tipo_remito] ?? REMITO_CONFIG.REM
  return (
    <Document
      title={`Remito ${cfg.letra} ${data.remito.numero_remito}`}
      author={data.empresa?.razon_social ?? data.cliente.nombre_razon_social}
    >
      {data.copias.map((copia) => (
        <RemitoPagina key={copia} data={data} copia={copia} />
      ))}
    </Document>
  )
}
