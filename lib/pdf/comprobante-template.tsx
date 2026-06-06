/**
 * Template PDF de comprobantes de venta.
 * Solo se ejecuta server-side (API routes). NO agregar 'use client'.
 * Generado server-side con @react-pdf/renderer.
 * Una vez generado se sube a Supabase Storage y queda congelado.
 */

import {
  Document, Page, Text, View, StyleSheet, Font,
} from '@react-pdf/renderer'

// ─── Helpers ────────────────────────────────────────────
const fmtARS = (n: number) =>
  Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const r2 = (n: number) => Math.round(n * 100) / 100

const TIPO_CONFIG: Record<string, { letra: string; nombre: string; color: string }> = {
  FA:  { letra: 'A', nombre: 'FACTURA',         color: '#0d2e52' },
  FB:  { letra: 'B', nombre: 'FACTURA',         color: '#174a0a' },
  NCA: { letra: 'A', nombre: 'NOTA DE CRÉDITO', color: '#004030' },
  NCB: { letra: 'B', nombre: 'NOTA DE CRÉDITO', color: '#004030' },
  NDA: { letra: 'A', nombre: 'NOTA DE DÉBITO',  color: '#5a2a00' },
  NDB: { letra: 'B', nombre: 'NOTA DE DÉBITO',  color: '#5a2a00' },
  PRES:{ letra: 'X', nombre: 'PRESUPUESTO',     color: '#28085a' },
  REV: { letra: 'X', nombre: 'REVERSA',         color: '#1a1a1a' },
  REM: { letra: 'R', nombre: 'REMITO',          color: '#004060' },
}

// ─── Estilos ─────────────────────────────────────────────
const s = StyleSheet.create({
  page:        { fontFamily: 'Helvetica', fontSize: 9, paddingTop: 0, paddingBottom: 0, paddingHorizontal: 0, backgroundColor: '#fff' },
  stripe:      { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  body:        { marginLeft: 4, padding: '10 12 10 10', flex: 1, display: 'flex', flexDirection: 'column' },

  // Encabezado empresa + tipo + número
  encTop:      { flexDirection: 'row', borderBottom: '2 solid #111', marginBottom: 0 },
  emBlock:     { flex: 1, paddingRight: 10, borderRight: '1 solid #ccc' },
  emNombre:    { fontSize: 16, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', marginBottom: 2 },
  emRubro:     { fontSize: 7, color: '#888', marginBottom: 5, letterSpacing: 1 },
  emRow:       { flexDirection: 'row', marginBottom: 2 },
  emLbl:       { fontFamily: 'Helvetica-Bold', width: 80, fontSize: 8 },
  emVal:       { fontSize: 8, color: '#444' },

  tipoBox:     { width: 80, alignItems: 'center', justifyContent: 'center', borderRight: '1 solid #ccc', paddingVertical: 6 },
  letraBox:    { width: 52, height: 52, border: '3 solid #111', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  letraText:   { fontSize: 36, fontFamily: 'Helvetica-Bold' },
  tipoNombre:  { fontSize: 6.5, color: '#666', textAlign: 'center', letterSpacing: 0.5 },

  compBlock:   { width: 160, paddingLeft: 10 },
  compNro:     { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  compRow:     { flexDirection: 'row', marginBottom: 2 },
  compLbl:     { fontFamily: 'Helvetica-Bold', width: 50, fontSize: 8 },
  compVal:     { fontSize: 8, color: '#444' },
  caeBox:      { marginTop: 6, padding: '4 6', border: '1 solid #bbb', backgroundColor: '#f8f8f8' },
  caeLbl:      { fontSize: 6.5, color: '#999', letterSpacing: 0.6, marginBottom: 1 },
  caeNro:      { fontFamily: 'Helvetica-Bold', fontSize: 10, letterSpacing: 0.5 },
  caeVto:      { fontSize: 7.5, color: '#555' },

  // Cliente
  encCli:      { flexDirection: 'row', borderBottom: '2 solid #111', paddingVertical: 7 },
  cliCol:      { flex: 1, paddingRight: 8 },
  cliCol2:     { width: 180, paddingLeft: 8, borderLeft: '1 solid #ccc' },
  cliTit:      { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#aaa', letterSpacing: 0.8, marginBottom: 3, borderBottom: '0.5 solid #eee', paddingBottom: 2 },
  cliRazon:    { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  cliRow:      { flexDirection: 'row', marginBottom: 1.5 },
  cliLbl:      { fontFamily: 'Helvetica-Bold', width: 65, fontSize: 8 },
  cliVal:      { fontSize: 8, color: '#444', flex: 1 },

  // Condiciones
  encCond:     { flexDirection: 'row', borderBottom: '2 solid #111', backgroundColor: '#f2f2f2', paddingVertical: 3 },
  condItem:    { flex: 1, paddingHorizontal: 8, borderRight: '0.5 solid #ccc' },
  condLbl:     { fontSize: 6, color: '#888', letterSpacing: 0.7, marginBottom: 1 },
  condVal:     { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },

  // Noval
  noval:       { backgroundColor: '#eee', padding: '3 8', borderBottom: '2 solid #555' },
  novalText:   { fontSize: 8, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5, textAlign: 'center', color: '#333' },

  // Tabla artículos
  tableHead:   { flexDirection: 'row', backgroundColor: '#111', padding: '4 3' },
  thText:      { color: '#fff', fontSize: 7.5, fontFamily: 'Helvetica-Bold', letterSpacing: 0.4 },
  tableRow:    { flexDirection: 'row', borderBottom: '0.5 solid #ddd', minHeight: 14, alignItems: 'center', paddingVertical: 1.5, paddingHorizontal: 3 },
  tableRowAlt: { backgroundColor: '#f5f5f5' },
  tdText:      { fontSize: 8.5, color: '#444' },
  tdBold:      { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: '#111' },

  // Anchos columnas (mm total usable ~185mm)
  cCod:  { width: 38 },
  cDesc: { flex: 1 },
  cMarca:{ width: 48 },
  cCant: { width: 28, textAlign: 'center' },
  cLst:  { width: 52, textAlign: 'right' },
  cOf:   { width: 26, textAlign: 'center' },
  cB1:   { width: 26, textAlign: 'center' },
  cB2:   { width: 26, textAlign: 'center' },
  cNet:  { width: 52, textAlign: 'right' },
  cSub:  { width: 58, textAlign: 'right', borderLeft: '1.5 solid #bbb', paddingLeft: 4 },

  // Totales
  totArea:     { flexDirection: 'row', borderTop: '2 solid #111' },
  totObs:      { flex: 1, padding: '6 10', borderRight: '1 solid #ccc' },
  totObsTit:   { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#bbb', letterSpacing: 0.7, marginBottom: 3 },
  totObsText:  { fontSize: 8, color: '#555', lineHeight: 1.5 },
  totObsLegal: { fontSize: 7, color: '#bbb', marginTop: 4, lineHeight: 1.4 },
  totNums:     { width: 180, padding: '6 10' },
  totRow:      { flexDirection: 'row', justifyContent: 'space-between', borderBottom: '0.5 solid #eee', paddingVertical: 2 },
  totLbl:      { fontSize: 8, color: '#555' },
  totVal:      { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111' },
  totRowDim:   { opacity: 0.6 },
  totGrand:    { flexDirection: 'row', justifyContent: 'space-between', borderTop: '2 solid #111', marginTop: 6, paddingTop: 5 },
  totGLbl:     { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  totGVal:     { fontSize: 16, fontFamily: 'Helvetica-Bold' },

  transpRow:   { padding: '3 10', backgroundColor: '#f5f5f5', borderTop: '0.5 solid #e0e0e0' },
  transpText:  { fontSize: 7.5, color: '#777', textAlign: 'center' },

  pie:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', padding: '5 12', borderTop: '0.5 solid #ccc' },
  pieLegal:    { fontSize: 7, color: '#aaa', lineHeight: 1.5, flex: 1 },
  firmaBox:    { width: 140, alignItems: 'center' },
  firmaLinea:  { borderTop: '0.5 solid #111', width: '100%', marginBottom: 2, marginTop: 18 },
  firmaLbl:    { fontSize: 6.5, color: '#888', letterSpacing: 0.5 },

  spacer:      { flex: 1 },
})

// ─── Tipos ───────────────────────────────────────────────
export interface ComprobantePDFData {
  comprobante: {
    id: string
    tipo_comprobante: string
    numero_comprobante: string
    fecha: string
    total_neto: number
    total_iva: number
    percepcion_iva: number
    percepcion_iibb: number
    total_factura: number
    cae?: string | null
    vencimiento_cae?: string | null
    observaciones?: string | null
    motivo_ajuste?: string | null
    anulado_en?: string | null
  }
  cliente: {
    nombre_razon_social: string
    cuit: string
    direccion?: string | null
    localidad?: string | null
    condicion_iva?: string | null
    telefono?: string | null
    condicion_pago?: string | null
  }
  empresa: {
    razon_social: string
    cuit: string
    direccion?: string | null
    telefono?: string | null
    email?: string | null
    condicion_iva?: string | null
  }
  pedido?: {
    numero_pedido?: string
    condicion_entrega?: string
    vendedor?: string
  } | null
  detalle: Array<{
    articulo_id?: string
    descripcion: string
    sku?: string
    cantidad: number
    precio_unitario: number
    precio_total: number
    marca?: string
    descuento_propio?: number
  }>
  bonificaciones?: Array<{ tipo: string; porcentaje: number; segmento?: string }>
}

// ─── Componente principal ─────────────────────────────────
export function ComprobantePDF({ data }: { data: ComprobantePDFData }) {
  const { comprobante: comp, cliente, empresa, pedido, detalle, bonificaciones = [] } = data
  const cfg = TIPO_CONFIG[comp.tipo_comprobante] ?? { letra: 'X', nombre: comp.tipo_comprobante, color: '#333' }

  const esFactA    = ['FA', 'NCA', 'NDA'].includes(comp.tipo_comprobante)
  const esPresRev  = ['PRES', 'REV'].includes(comp.tipo_comprobante)
  const esNC_ND    = ['NCA', 'NCB', 'NDA', 'NDB'].includes(comp.tipo_comprobante)

  const nro   = comp.numero_comprobante
  const pto   = nro.includes('-') ? nro.split('-')[0] : '0001'
  const fecha = comp.fecha
    ? new Date(comp.fecha).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
    : '—'
  const caeVto = comp.vencimiento_cae
    ? new Date(comp.vencimiento_cae).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
    : ''

  // D1/D2
  const segmento = 'limpieza_bazar'
  const d1 = bonificaciones.find(b => b.tipo === 'general'  && (!b.segmento || b.segmento === segmento))
  const d2 = bonificaciones.find(b => b.tipo === 'viajante' && (!b.segmento || b.segmento === segmento))
  const d1pct = d1?.porcentaje ?? 0
  const d2pct = d2?.porcentaje ?? 0
  const factDesc = 1 - d1pct / 100 - d2pct / 100

  const totalNeto  = Math.abs(comp.total_neto)
  const totalIva   = Math.abs(comp.total_iva ?? 0)
  const percIva    = Math.abs(comp.percepcion_iva ?? 0)
  const percIibb   = Math.abs(comp.percepcion_iibb ?? 0)
  const totalFact  = Math.abs(comp.total_factura)

  const condEntregaMap: Record<string, string> = {
    entregamos_nosotros: 'Flota propia',
    retira_mostrador:    'Retira mostrador',
    transporte:          'Transporte cliente',
  }

  return (
    <Document title={`${cfg.nombre} ${cfg.letra} ${nro}`} author={empresa.razon_social}>
      <Page size="A4" style={s.page} wrap={false}>
        {/* Franja de color lateral */}
        <View style={[s.stripe, { backgroundColor: cfg.color }]} fixed />

        <View style={s.body}>
          {/* ── Encabezado: empresa | tipo | número ── */}
          <View style={s.encTop}>
            {/* Empresa */}
            <View style={s.emBlock}>
              <Text style={s.emNombre}>{empresa.razon_social}</Text>
              <Text style={s.emRubro}>LIMPIEZA · BAZAR · PERFUMERÍA</Text>
              <View style={s.emRow}><Text style={s.emLbl}>CUIT:</Text><Text style={s.emVal}>{empresa.cuit}</Text></View>
              <View style={s.emRow}><Text style={s.emLbl}>Cond. IVA:</Text><Text style={s.emVal}>{empresa.condicion_iva ?? 'Responsable Inscripto'}</Text></View>
              <View style={s.emRow}><Text style={s.emLbl}>Ing. Brutos:</Text><Text style={s.emVal}>Convenio Multilateral — SIFERE</Text></View>
              <View style={s.emRow}><Text style={s.emLbl}>Domicilio:</Text><Text style={s.emVal}>{empresa.direccion ?? '—'}</Text></View>
              <View style={s.emRow}><Text style={s.emLbl}>Teléfono:</Text><Text style={s.emVal}>{empresa.telefono ?? '—'} · Pto. Vta.: {pto}</Text></View>
            </View>

            {/* Tipo (letra en caja) */}
            <View style={s.tipoBox}>
              <View style={[s.letraBox, { borderColor: cfg.color }]}>
                <Text style={[s.letraText, { color: cfg.color }]}>{cfg.letra}</Text>
              </View>
              <Text style={s.tipoNombre}>{cfg.nombre}</Text>
            </View>

            {/* Número + CAE */}
            <View style={s.compBlock}>
              <Text style={s.compNro}>N° {nro}</Text>
              <View style={s.compRow}><Text style={s.compLbl}>Fecha:</Text><Text style={s.compVal}>{fecha}</Text></View>
              {pedido?.numero_pedido && (
                <View style={s.compRow}><Text style={s.compLbl}>N° Pedido:</Text><Text style={s.compVal}>{pedido.numero_pedido}</Text></View>
              )}
              {comp.cae && (
                <View style={s.caeBox}>
                  <Text style={s.caeLbl}>CAE — ARCA</Text>
                  <Text style={s.caeNro}>{comp.cae}</Text>
                  <Text style={s.caeVto}>Vto. CAE: {caeVto}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Aviso si no es comprobante fiscal */}
          {esPresRev && (
            <View style={s.noval}>
              <Text style={s.novalText}>DOCUMENTO NO VÁLIDO COMO FACTURA</Text>
            </View>
          )}

          {/* ── Cliente ── */}
          <View style={s.encCli}>
            <View style={s.cliCol}>
              <Text style={s.cliTit}>DATOS DEL CLIENTE</Text>
              <Text style={s.cliRazon}>{cliente.nombre_razon_social}</Text>
              <View style={s.cliRow}><Text style={s.cliLbl}>CUIT / DNI:</Text><Text style={s.cliVal}>{cliente.cuit}</Text></View>
              <View style={s.cliRow}><Text style={s.cliLbl}>Cond. IVA:</Text><Text style={s.cliVal}>{cliente.condicion_iva ?? '—'}</Text></View>
              <View style={s.cliRow}><Text style={s.cliLbl}>Domicilio:</Text><Text style={s.cliVal}>{[cliente.direccion, cliente.localidad].filter(Boolean).join(', ') || '—'}</Text></View>
              <View style={s.cliRow}><Text style={s.cliLbl}>Teléfono:</Text><Text style={s.cliVal}>{cliente.telefono ?? '—'}</Text></View>
            </View>
            <View style={s.cliCol2}>
              <Text style={s.cliTit}>DATOS DE GESTIÓN</Text>
              {pedido?.vendedor && <View style={s.cliRow}><Text style={s.cliLbl}>Vendedor:</Text><Text style={s.cliVal}>{pedido.vendedor}</Text></View>}
              <View style={s.cliRow}><Text style={s.cliLbl}>Forma pago:</Text><Text style={s.cliVal}>{cliente.condicion_pago ?? 'Cuenta Corriente'}</Text></View>
              {pedido?.condicion_entrega && (
                <View style={s.cliRow}><Text style={s.cliLbl}>Entrega:</Text><Text style={s.cliVal}>{condEntregaMap[pedido.condicion_entrega] ?? pedido.condicion_entrega}</Text></View>
              )}
            </View>
          </View>

          {/* ── Condiciones rápidas ── */}
          <View style={s.encCond}>
            <View style={s.condItem}><Text style={s.condLbl}>MONEDA</Text><Text style={s.condVal}>Pesos ARS</Text></View>
            <View style={s.condItem}><Text style={s.condLbl}>OPERACIÓN</Text><Text style={s.condVal}>Venta de bienes</Text></View>
            {d1pct > 0 && <View style={s.condItem}><Text style={s.condLbl}>BONIF. GENERAL</Text><Text style={s.condVal}>{d1pct}%</Text></View>}
            {d2pct > 0 && <View style={s.condItem}><Text style={s.condLbl}>BONIF. VIAJANTE</Text><Text style={s.condVal}>{d2pct}%</Text></View>}
          </View>

          {/* ── Tabla de artículos ── */}
          {/* Encabezado */}
          <View style={s.tableHead}>
            <Text style={[s.thText, s.cCod]}>Código</Text>
            <Text style={[s.thText, s.cDesc]}>Descripción</Text>
            <Text style={[s.thText, s.cMarca]}>Marca</Text>
            <Text style={[s.thText, s.cCant, { textAlign: 'center' }]}>Cant.</Text>
            <Text style={[s.thText, s.cLst,  { textAlign: 'right' }]}>P. Lista</Text>
            <Text style={[s.thText, s.cOf,   { textAlign: 'center' }]}>% Of.</Text>
            <Text style={[s.thText, s.cB1,   { textAlign: 'center' }]}>Bon 1</Text>
            <Text style={[s.thText, s.cB2,   { textAlign: 'center' }]}>Bon 2</Text>
            <Text style={[s.thText, s.cNet,  { textAlign: 'right' }]}>P. Neto</Text>
            <Text style={[s.thText, s.cSub,  { textAlign: 'right' }]}>Subtotal</Text>
          </View>

          {/* Filas */}
          {detalle.map((item, i) => {
            const esBonifMerc = item.precio_unitario < 0
            const precioOferta = Math.abs(item.precio_unitario)
            const ofPct = item.descuento_propio ?? 0
            const lista = ofPct > 0 && !esBonifMerc ? r2(precioOferta / (1 - ofPct / 100)) : precioOferta
            const neto  = esBonifMerc ? 0 : precioOferta * factDesc
            const sub   = esBonifMerc ? Math.abs(item.precio_total) : r2(neto * Math.abs(item.cantidad))
            const isAlt = i % 2 === 1

            return (
              <View key={i} style={[s.tableRow, isAlt ? s.tableRowAlt : {}, esBonifMerc ? { backgroundColor: '#fef3c7' } : {}]}>
                <Text style={[s.tdText, s.cCod, { fontSize: 7.5, color: '#888' }]}>{esBonifMerc ? '' : (item.sku ?? '')}</Text>
                <Text style={[s.tdBold, s.cDesc, { fontSize: 8 }]}>{item.descripcion}</Text>
                <Text style={[s.tdText, s.cMarca, { fontSize: 7.5, color: '#666' }]}>{item.marca ?? ''}</Text>
                <Text style={[s.tdBold, s.cCant]}>{esBonifMerc ? '—' : String(Math.abs(item.cantidad))}</Text>
                <Text style={[s.tdText, s.cLst, { color: '#777', fontSize: 8 }]}>{esBonifMerc ? '—' : `$${fmtARS(lista)}`}</Text>
                <Text style={[s.tdText, s.cOf,  { color: ofPct > 0 ? '#b45309' : '#ccc', fontSize: 8 }]}>{ofPct > 0 && !esBonifMerc ? `${ofPct}%` : '—'}</Text>
                <Text style={[s.tdText, s.cB1,  { color: esBonifMerc ? '#b45309' : d1pct > 0 ? '#555' : '#ccc', fontSize: 8 }]}>{esBonifMerc ? '100%' : d1pct > 0 ? `${d1pct}%` : '—'}</Text>
                <Text style={[s.tdText, s.cB2,  { color: d2pct > 0 && !esBonifMerc ? '#555' : '#ccc', fontSize: 8 }]}>{d2pct > 0 && !esBonifMerc ? `${d2pct}%` : '—'}</Text>
                <Text style={[s.tdText, s.cNet, { fontFamily: 'Helvetica-Bold', fontSize: 8.5 }]}>{esBonifMerc ? `−$${fmtARS(sub)}` : `$${fmtARS(neto)}`}</Text>
                <Text style={[s.tdBold, s.cSub, { fontSize: 9 }]}>{esBonifMerc ? `−$${fmtARS(sub)}` : `$${fmtARS(sub)}`}</Text>
              </View>
            )
          })}

          {/* Spacer — empuja el pie al fondo */}
          <View style={s.spacer} />

          {/* ── Totales + Observaciones ── */}
          <View style={s.totArea}>
            <View style={s.totObs}>
              <Text style={s.totObsTit}>OBSERVACIONES</Text>
              <Text style={s.totObsText}>{comp.observaciones || '—'}</Text>
              <Text style={s.totObsLegal}>
                Crédito fiscal computable solo para Resp. Inscriptos en IVA (RG ARCA 1415). Emitido conforme RG 4291.
              </Text>
            </View>
            <View style={s.totNums}>
              {esFactA ? (
                <>
                  <View style={s.totRow}><Text style={s.totLbl}>Subtotal gravado 21%</Text><Text style={s.totVal}>${fmtARS(totalNeto)}</Text></View>
                  <View style={[s.totRow, s.totRowDim]}><Text style={s.totLbl}>IVA 21%</Text><Text style={s.totVal}>${fmtARS(totalIva)}</Text></View>
                  {percIva > 0 && <View style={[s.totRow, s.totRowDim]}><Text style={s.totLbl}>Percepción IVA</Text><Text style={s.totVal}>${fmtARS(percIva)}</Text></View>}
                  {percIibb > 0 && <View style={[s.totRow, s.totRowDim]}><Text style={s.totLbl}>Percepción IIBB</Text><Text style={s.totVal}>${fmtARS(percIibb)}</Text></View>}
                </>
              ) : (
                <View style={s.totRow}><Text style={s.totLbl}>Subtotal</Text><Text style={s.totVal}>${fmtARS(totalFact)}</Text></View>
              )}
              <View style={s.totGrand}>
                <Text style={s.totGLbl}>TOTAL</Text>
                <Text style={s.totGVal}>${fmtARS(totalFact)}</Text>
              </View>
            </View>
          </View>

          {/* Transparencia Fiscal */}
          {esFactA && (
            <View style={s.transpRow}>
              <Text style={s.transpText}>
                Transparencia Fiscal — Ley 27.743: IVA discriminado ${fmtARS(totalIva)}
                {percIva > 0 ? ` · Percep. IVA $${fmtARS(percIva)}` : ''}
                {percIibb > 0 ? ` · Percep. IIBB $${fmtARS(percIibb)}` : ''}
              </Text>
            </View>
          )}

          {/* Pie */}
          <View style={s.pie}>
            <Text style={s.pieLegal}>
              Emitido conforme RG ARCA 1415{comp.cae ? ` · CAE: ${comp.cae}` : ''}.{'\n'}
              Original para el cliente. {empresa.email ?? ''} · {empresa.telefono ?? ''}
            </Text>
            <View style={s.firmaBox}>
              <View style={s.firmaLinea} />
              <Text style={s.firmaLbl}>FIRMA Y SELLO — VENDEDOR</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  )
}
