/**
 * Template PDF de comprobantes de venta.
 * Solo se ejecuta server-side (API routes). NO agregar 'use client'.
 * Generado server-side con @react-pdf/renderer.
 * Una vez generado se sube a Supabase Storage y queda congelado.
 */

import {
  Document, Page, Text, View, StyleSheet, Font, Image,
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
  // Página como columna flex: cuerpo arriba, spacer elástico, pie abajo.
  page:        { fontFamily: 'Helvetica', fontSize: 9, paddingTop: 0, paddingBottom: 0, paddingHorizontal: 0, backgroundColor: '#fff', flexDirection: 'column' },
  stripe:      { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  body:        { marginLeft: 4, padding: '10 12 10 10' },
  // Bloque inferior en flujo normal (NO absoluto): el spacer lo empuja al pie.
  footer:      { marginLeft: 4 },
  // Encabezado que se repite en cada hoja (RG 1415, comprobantes multi-hoja)
  headerFixed: { marginLeft: 4, padding: '10 12 0 10' },
  bodyRows:    { marginLeft: 4, padding: '0 12 10 10' },
  hojaText:    { fontSize: 7.5, color: '#555', fontFamily: 'Helvetica-Bold', marginTop: 5 },

  // Encabezado empresa + tipo + número
  encTop:      { flexDirection: 'row', borderBottom: '2 solid #111', marginBottom: 0 },
  emBlock:     { flex: 1, paddingRight: 10, borderRight: '1 solid #ccc' },
  emLogo:      { width: 160, height: 60, marginBottom: 5 },
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
  qrBox:       { alignItems: 'flex-end', marginTop: 8 },
  qrImg:       { width: 80, height: 80 },

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

  // Marca de agua de vista previa (no es un comprobante emitido)
  previewBanner:     { backgroundColor: '#fde2e2', borderBottom: '1 solid #e57373', padding: '5 10', alignItems: 'center', marginBottom: 4 },
  previewBannerText: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#b71c1c', letterSpacing: 0.5 },
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
    qr_data_url?: string | null
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
    logo_url?: string | null
    direccion?: string | null
    telefono?: string | null
    email?: string | null
    condicion_iva?: string | null
    inicio_actividades?: string | null
    iibb?: string | null
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
    // Desglose por línea (cascada escalonada): la oferta/general/viajante ya están
    // en el neto; estas columnas son para mostrarlas y reconstruir el P.Lista.
    precio_lista?: number
    descuento_propio_pct?: number
    bonif_general_pct?: number
    bonif_viajante_pct?: number
    es_bonificado?: boolean
  }>
  bonificaciones?: Array<{ tipo: string; porcentaje: number; segmento?: string }>
}

// ─── Página de un comprobante (sin el wrapper Document) ──────
// preview=true: marca de agua + placeholder de CAE, para vistas previas.
function ComprobantePagina({ data, preview = false }: { data: ComprobantePDFData; preview?: boolean }) {
  const { comprobante: comp, cliente, empresa, pedido, detalle, bonificaciones = [] } = data
  const cfg = TIPO_CONFIG[comp.tipo_comprobante] ?? { letra: 'X', nombre: comp.tipo_comprobante, color: '#333' }

  const esFactA    = ['FA', 'NCA', 'NDA'].includes(comp.tipo_comprobante)
  const esFactB    = ['FB', 'NCB', 'NDB'].includes(comp.tipo_comprobante)
  const esMonotrib = (cliente.condicion_iva ?? '').toLowerCase().includes('monotributo')
  const esPresRev  = ['PRES', 'REV'].includes(comp.tipo_comprobante)
  const esNC_ND    = ['NCA', 'NCB', 'NDA', 'NDB'].includes(comp.tipo_comprobante)

  const nro   = comp.numero_comprobante
  const pto   = nro.includes('-') ? nro.split('-')[0] : '0001'
  // Las fechas vienen como 'YYYY-MM-DD' (hora Argentina). Formatear por string:
  // new Date('YYYY-MM-DD') las interpreta como UTC y retrocede un día al mostrarlas.
  const fmtFechaISO = (s?: string | null) => {
    const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
  }
  const fecha  = fmtFechaISO(comp.fecha)
  const caeVto = comp.vencimiento_cae ? fmtFechaISO(comp.vencimiento_cae) : ''

  // D1/D2 para los chips del encabezado: se derivan del desglose por línea
  // (la cascada ya está en el neto). Fallback al param bonificaciones (legacy).
  const segmento = 'limpieza_bazar'
  const d1Linea = detalle.find(d => Number(d.bonif_general_pct ?? 0) > 0)
  const d2Linea = detalle.find(d => Number(d.bonif_viajante_pct ?? 0) > 0)
  const d1Legacy = bonificaciones.find(b => b.tipo === 'general'  && (!b.segmento || b.segmento === segmento))
  const d2Legacy = bonificaciones.find(b => b.tipo === 'viajante' && (!b.segmento || b.segmento === segmento))
  const d1pct = Number(d1Linea?.bonif_general_pct ?? d1Legacy?.porcentaje ?? 0)
  const d2pct = Number(d2Linea?.bonif_viajante_pct ?? d2Legacy?.porcentaje ?? 0)

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
      <Page size="A4" style={s.page}>
        {/* Franja de color lateral */}
        <View style={[s.stripe, { backgroundColor: cfg.color }]} fixed />

        {/* ── Encabezado: se REPITE en cada hoja (RG 1415, comprobantes multi-hoja) ── */}
        <View style={s.headerFixed} fixed>
          {/* Marca de agua: deja claro que NO es un comprobante emitido */}
          {preview && (
            <View style={s.previewBanner}>
              <Text style={s.previewBannerText}>VISTA PREVIA — SIN VALIDEZ FISCAL · NO EMITIDO · NO ENVIADO A ARCA</Text>
            </View>
          )}
          {/* ── Encabezado: (empresa | cliente en PRES/REV) | tipo | número ── */}
          <View style={s.encTop}>
            {esPresRev ? (
              /* Presupuesto/Reversa: NO lleva datos de la empresa. Encabezado ÚNICO del cliente
                 (la sección "DATOS DEL CLIENTE / DE GESTIÓN" de abajo se oculta para no duplicar). */
              <View style={s.emBlock}>
                <Text style={s.emNombre}>{cliente.nombre_razon_social ?? cliente.nombre ?? '—'}</Text>
                <View style={s.emRow}><Text style={s.emLbl}>Dirección:</Text><Text style={s.emVal}>{cliente.direccion ?? '—'}</Text></View>
                <View style={s.emRow}><Text style={s.emLbl}>Localidad:</Text><Text style={s.emVal}>{cliente.localidad ?? '—'}</Text></View>
                <View style={s.emRow}><Text style={s.emLbl}>Forma pago:</Text><Text style={s.emVal}>{cliente.condicion_pago ?? 'Cuenta Corriente'}</Text></View>
                {pedido?.condicion_entrega && (
                  <View style={s.emRow}><Text style={s.emLbl}>Entrega:</Text><Text style={s.emVal}>{condEntregaMap[pedido.condicion_entrega] ?? pedido.condicion_entrega}</Text></View>
                )}
              </View>
            ) : (
              /* Empresa (solo comprobantes fiscales) */
              <View style={s.emBlock}>
                {empresa.logo_url
                  ? <Image style={s.emLogo} src={empresa.logo_url} />
                  : <><Text style={s.emNombre}>{empresa.razon_social}</Text><Text style={s.emRubro}>LIMPIEZA · BAZAR · PERFUMERÍA</Text></>
                }
                <View style={s.emRow}><Text style={s.emLbl}>CUIT:</Text><Text style={s.emVal}>{empresa.cuit}</Text></View>
                <View style={s.emRow}><Text style={s.emLbl}>Cond. IVA:</Text><Text style={s.emVal}>{empresa.condicion_iva ?? 'Responsable Inscripto'}</Text></View>
                <View style={s.emRow}><Text style={s.emLbl}>Ing. Brutos:</Text><Text style={s.emVal}>{empresa.iibb ?? 'Convenio Multilateral — SIFERE'}</Text></View>
                {empresa.inicio_actividades && (
                  <View style={s.emRow}><Text style={s.emLbl}>Inicio Act.:</Text><Text style={s.emVal}>{fmtFechaISO(empresa.inicio_actividades)}</Text></View>
                )}
                <View style={s.emRow}><Text style={s.emLbl}>Domicilio:</Text><Text style={s.emVal}>{empresa.direccion ?? '—'}</Text></View>
                <View style={s.emRow}><Text style={s.emLbl}>Teléfono:</Text><Text style={s.emVal}>{empresa.telefono ?? '—'} · Pto. Vta.: {pto}</Text></View>
              </View>
            )}

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
              {/* "Hoja N de M" — RG 1415: solo si el comprobante ocupa más de una hoja */}
              <Text style={s.hojaText} render={({ subPageNumber, subPageTotalPages }) =>
                (subPageTotalPages ?? 1) > 1 ? `Hoja ${subPageNumber} de ${subPageTotalPages}` : ''
              } />
              {comp.cae && (
                <View style={s.caeBox}>
                  <Text style={s.caeLbl}>CAE — ARCA</Text>
                  <Text style={s.caeNro}>{comp.cae}</Text>
                  <Text style={s.caeVto}>Vto. CAE: {caeVto}</Text>
                </View>
              )}
              {preview && !esPresRev && (
                <View style={s.caeBox}>
                  <Text style={s.caeLbl}>CAE — ARCA</Text>
                  <Text style={s.caeNro}>VISTA PREVIA</Text>
                  <Text style={s.caeVto}>Se asigna al emitir</Text>
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

          {/* ── Cliente ── (en PRES/REV se omite: ya va en el encabezado único de arriba) */}
          {!esPresRev && (
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
          )}

          {/* ── Condiciones rápidas ── */}
          <View style={s.encCond}>
            <View style={s.condItem}><Text style={s.condLbl}>MONEDA</Text><Text style={s.condVal}>Pesos ARS</Text></View>
            {!esPresRev && <View style={s.condItem}><Text style={s.condLbl}>OPERACIÓN</Text><Text style={s.condVal}>Venta de bienes</Text></View>}
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
            <Text style={[s.thText, s.cNet,  { textAlign: 'right' }]}>{esFactB ? 'P. Unit.' : 'P. Neto'}</Text>
            <Text style={[s.thText, s.cSub,  { textAlign: 'right' }]}>Subtotal</Text>
          </View>
        </View>

        {/* ── Filas: fluyen; el encabezado de arriba se repite en cada hoja ── */}
        <View style={s.bodyRows}>
          {detalle.map((item, i) => {
            // Mercadería bonificada: producto regalado, línea a $0 (P.Lista real, 100% Of.).
            const esBonifMerc = item.es_bonificado === true || item.precio_unitario < 0
            // Comprobantes B: precios finales con IVA incluido, sin discriminar (RG 1415).
            const factorIvaB = esFactB ? 1.21 : 1
            // Desglose por línea: oferta/general/viajante ya están en el neto; las columnas
            // los muestran y el P.Lista se reconstruye con la cascada.
            const ofPct  = Number(item.descuento_propio_pct ?? item.descuento_propio ?? 0)
            const b1pct  = Number(item.bonif_general_pct ?? 0)
            const b2pct  = Number(item.bonif_viajante_pct ?? 0)
            const neto   = esBonifMerc ? 0 : r2(Math.abs(item.precio_unitario) * factorIvaB)
            // P.Lista bruto: el guardado por línea, o reconstruido desde el neto y la cascada.
            const listaStored = item.precio_lista != null ? r2(item.precio_lista * factorIvaB) : 0
            const factorCascada = (1 - ofPct / 100) * (1 - b1pct / 100) * (1 - b2pct / 100)
            const lista = listaStored > 0
              ? listaStored
              : (factorCascada > 0 ? r2(neto / factorCascada) : neto)
            const sub    = esBonifMerc ? 0 : r2(neto * Math.abs(item.cantidad))
            const isAlt = i % 2 === 1

            return (
              <View key={i} wrap={false} style={[s.tableRow, isAlt ? s.tableRowAlt : {}, esBonifMerc ? { backgroundColor: '#fef3c7' } : {}]}>
                <Text style={[s.tdText, s.cCod, { fontSize: 7.5, color: '#888' }]}>{item.sku ?? ''}</Text>
                <Text style={[s.tdBold, s.cDesc, { fontSize: 8 }]}>{item.descripcion}</Text>
                <Text style={[s.tdText, s.cMarca, { fontSize: 7.5, color: '#666' }]}>{item.marca ?? ''}</Text>
                <Text style={[s.tdBold, s.cCant]}>{String(Math.abs(item.cantidad))}</Text>
                <Text style={[s.tdText, s.cLst, { color: '#777', fontSize: 8 }]}>{`$${fmtARS(lista)}`}</Text>
                <Text style={[s.tdText, s.cOf,  { color: esBonifMerc ? '#b45309' : ofPct > 0 ? '#b45309' : '#ccc', fontSize: 8 }]}>{esBonifMerc ? '100%' : ofPct > 0 ? `${ofPct}%` : '—'}</Text>
                <Text style={[s.tdText, s.cB1,  { color: b1pct > 0 ? '#555' : '#ccc', fontSize: 8 }]}>{b1pct > 0 && !esBonifMerc ? `${b1pct}%` : '—'}</Text>
                <Text style={[s.tdText, s.cB2,  { color: b2pct > 0 ? '#555' : '#ccc', fontSize: 8 }]}>{b2pct > 0 && !esBonifMerc ? `${b2pct}%` : '—'}</Text>
                <Text style={[s.tdText, s.cNet, { fontFamily: 'Helvetica-Bold', fontSize: 8.5 }]}>{`$${fmtARS(neto)}`}</Text>
                <Text style={[s.tdBold, s.cSub, { fontSize: 9 }]}>{`$${fmtARS(sub)}`}</Text>
              </View>
            )
          })}

        </View>

        {/* Spacer elástico: empuja el bloque inferior al pie de la hoja.
            Con 1 o 50 ítems el pie queda SIEMPRE en el mismo lugar; si el
            cuerpo supera una hoja, el bloque cae al pie de la última. */}
        <View style={s.spacer} />

        {/* ── Bloque inferior anclado al pie: totales + leyendas + firma ──
            wrap={false} mantiene todo junto en la última hoja, nunca se parte. */}
        <View style={s.footer} wrap={false}>
          {/* Totales + Observaciones */}
          <View style={s.totArea}>
            <View style={s.totObs}>
              <Text style={s.totObsTit}>OBSERVACIONES</Text>
              <Text style={s.totObsText}>{comp.observaciones || '—'}</Text>
              {/* Leyenda fiscal: solo comprobantes fiscales (no presupuesto/reversa) */}
              {!esPresRev && (
                <Text style={s.totObsLegal}>
                  {esMonotrib
                    ? 'El crédito fiscal discriminado en el presente comprobante sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para pequeños contribuyentes de la Ley Nro. 27618'
                    : 'Crédito fiscal computable solo para Resp. Inscriptos en IVA (RG ARCA 1415). QR conforme RG 4892/2020.'}
                </Text>
              )}
            </View>
            <View style={s.totNums}>
              {esFactA ? (
                <>
                  <View style={s.totRow}><Text style={s.totLbl}>Subtotal gravado 21%</Text><Text style={s.totVal}>${fmtARS(totalNeto)}</Text></View>
                  <View style={[s.totRow, s.totRowDim]}><Text style={s.totLbl}>IVA 21%</Text><Text style={s.totVal}>${fmtARS(totalIva)}</Text></View>
                  {percIva > 0 && <View style={[s.totRow, s.totRowDim]}><Text style={s.totLbl}>Percepción IVA (RG 5329/2023)</Text><Text style={s.totVal}>${fmtARS(percIva)}</Text></View>}
                  {percIibb > 0 && <View style={[s.totRow, s.totRowDim]}><Text style={s.totLbl}>Percepción IIBB</Text><Text style={s.totVal}>${fmtARS(percIibb)}</Text></View>}
                </>
              ) : (
                <>
                  <View style={s.totRow}><Text style={s.totLbl}>Subtotal</Text><Text style={s.totVal}>${fmtARS(totalFact - percIva - percIibb)}</Text></View>
                  {percIva > 0 && <View style={[s.totRow, s.totRowDim]}><Text style={s.totLbl}>Percepción IVA (RG 5329/2023)</Text><Text style={s.totVal}>${fmtARS(percIva)}</Text></View>}
                  {percIibb > 0 && <View style={[s.totRow, s.totRowDim]}><Text style={s.totLbl}>Percepción IIBB</Text><Text style={s.totVal}>${fmtARS(percIibb)}</Text></View>}
                </>
              )}
              <View style={s.totGrand}>
                <Text style={s.totGLbl}>TOTAL</Text>
                <Text style={s.totGVal}>${fmtARS(totalFact)}</Text>
              </View>
              {comp.qr_data_url && (
                <View style={s.qrBox}>
                  <Image style={s.qrImg} src={comp.qr_data_url} />
                </View>
              )}
            </View>
          </View>

          {/* Transparencia Fiscal (Ley 27.743 / RG 5614): solo comprobantes B — en los A
              el IVA ya va discriminado en el cuerpo, la franja sería redundante. */}
          {esFactB && (
            <View style={s.transpRow}>
              <Text style={s.transpText}>
                Régimen de Transparencia Fiscal al Consumidor (Ley 27.743) ·
                IVA Contenido: ${fmtARS(totalIva)} ·
                Otros Impuestos Nacionales Indirectos: $0,00
              </Text>
            </View>
          )}

          <View style={s.pie}>
            {/* Pie legal: solo comprobantes fiscales. Presupuesto/Reversa sin datos de empresa ni ARCA. */}
            <Text style={s.pieLegal}>
              {esPresRev
                ? 'Presupuesto — documento no válido como factura.'
                : `Emitido conforme RG ARCA 1415${comp.cae ? ` · CAE: ${comp.cae}` : ''}.\nOriginal para el cliente. ${empresa.email ?? ''} · ${empresa.telefono ?? ''}`}
            </Text>
            <View style={s.firmaBox}>
              <View style={s.firmaLinea} />
              <Text style={s.firmaLbl}>FIRMA Y SELLO — VENDEDOR</Text>
            </View>
          </View>
        </View>
      </Page>
  )
}

// ─── Documento real (emisión): un comprobante por PDF ────────
export function ComprobantePDF({ data }: { data: ComprobantePDFData }) {
  const cfg = TIPO_CONFIG[data.comprobante.tipo_comprobante]
  return (
    <Document title={`${cfg?.nombre ?? 'Comprobante'} ${cfg?.letra ?? ''} ${data.comprobante.numero_comprobante}`} author={data.empresa.razon_social}>
      <ComprobantePagina data={data} />
    </Document>
  )
}

// ─── Vista previa: los comprobantes que saldrían del pedido en un mismo PDF ─────
// Copia fiel del split real (factura/presupuesto por ítem + agrupación). Con marca
// de agua, sin CAE/QR reales, sin emitir y sin contactar ARCA.
export function ComprobantesPreviewPDF({ comprobantes }: { comprobantes: ComprobantePDFData[] }) {
  return (
    <Document title="Vista previa de comprobantes" author={comprobantes[0]?.empresa.razon_social ?? ''}>
      {comprobantes.map((d, i) => <ComprobantePagina key={i} data={d} preview />)}
    </Document>
  )
}
