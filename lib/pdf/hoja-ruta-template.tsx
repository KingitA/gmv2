/**
 * Template PDF de la HOJA DE RUTA de un viaje (A4 apaisada).
 * La guía del chofer: paradas en orden con cliente, pedidos / comprobantes /
 * remitos, bultos, saldo anterior, importe de este viaje, total a cobrar y la
 * instrucción de oficina (cobrar sí o sí / NO ENTREGAR SIN COBRAR / nota).
 * Deja columnas en blanco para anotar a mano lo cobrado y quién recibe.
 * Los datos salen de lib/viajes/hoja-ruta.ts (misma fuente que la pantalla).
 */

import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { HojaRuta } from '@/lib/viajes/hoja-ruta'

const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtFecha = (v?: string | null) => {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'
}

const s = StyleSheet.create({
  page:    { fontFamily: 'Helvetica', fontSize: 8, padding: '20 22 28 22' },
  enc:     { flexDirection: 'row', justifyContent: 'space-between', borderBottom: '2 solid #111', paddingBottom: 6, marginBottom: 6 },
  titulo:  { fontSize: 15, fontFamily: 'Helvetica-Bold' },
  sub:     { fontSize: 9, color: '#333', marginTop: 2 },
  encDer:  { alignItems: 'flex-end' },
  doc:     { fontSize: 11, fontFamily: 'Helvetica-Bold' },

  resumen: { flexDirection: 'row', marginBottom: 6 },
  caja:    { flex: 1, border: '0.7 solid #999', padding: '3 5', marginRight: 4 },
  cajaLbl: { fontSize: 6.5, color: '#555', textTransform: 'uppercase' },
  cajaVal: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 1 },

  th:      { flexDirection: 'row', backgroundColor: '#111', padding: '3 4' },
  thT:     { color: '#fff', fontSize: 6.5, fontFamily: 'Helvetica-Bold' },
  tr:      { flexDirection: 'row', borderBottom: '0.7 solid #999', padding: '4 4', minHeight: 40 },
  trBloq:  { backgroundColor: '#f3f3f3' },

  cN:      { width: 18 },
  cCli:    { width: 190, paddingRight: 5 },
  cPed:    { width: 150, paddingRight: 5 },
  cBu:     { width: 34, textAlign: 'right' },
  cImp:    { width: 68, textAlign: 'right' },
  cInst:   { flex: 1, paddingLeft: 8, paddingRight: 4 },
  cMano:   { width: 78, borderLeft: '0.5 solid #bbb', paddingLeft: 4 },

  nro:     { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  cli:     { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  gris:    { fontSize: 7.5, color: '#444', marginTop: 1 },
  num:     { fontSize: 8.5 },
  numB:    { fontSize: 9.5, fontFamily: 'Helvetica-Bold' },
  exigir:  { fontSize: 8, fontFamily: 'Helvetica-Bold' },
  bloqueo: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', border: '1 solid #111', padding: '2 4', marginBottom: 2, alignSelf: 'flex-start' },
  nota:    { fontSize: 7.5, color: '#222', marginTop: 1.5 },
  manoLbl: { fontSize: 6, color: '#777' },

  tot:     { flexDirection: 'row', padding: '4 4', borderTop: '1.5 solid #111' },
  pie:     { flexDirection: 'row', marginTop: 10 },
  pieCol:  { flex: 1, marginRight: 10 },
  pieTit:  { fontSize: 8, fontFamily: 'Helvetica-Bold', marginBottom: 3, textTransform: 'uppercase' },
  pieLin:  { flexDirection: 'row', justifyContent: 'space-between', borderBottom: '0.5 dotted #999', paddingVertical: 3 },
  firma:   { marginTop: 26, borderTop: '0.7 solid #111', paddingTop: 2, fontSize: 7, textAlign: 'center' },
  pagina:  { position: 'absolute', bottom: 12, right: 22, fontSize: 7, color: '#777' },
})

export function HojaRutaPDF({ data }: { data: HojaRuta }) {
  const { viaje: v, paradas, totales: t, dinero } = data
  const porTransporte = v.tipo_transporte === 'transporte'
  const titular = v.choferes.find((c) => c.rol === 'titular')
  const acomp = v.choferes.filter((c) => c.rol !== 'titular')

  return (
    <Document title={`Hoja de ruta ${v.nombre}`}>
      <Page size="A4" orientation="landscape" style={s.page} wrap>
        <View style={s.enc} fixed>
          <View>
            <Text style={s.titulo}>HOJA DE RUTA — {v.nombre}</Text>
            <Text style={s.sub}>
              {fmtFecha(v.fecha)}{v.dias > 1 ? ` al ${fmtFecha(v.fecha_fin)} (${v.dias} días)` : ''} · {v.zonas.join(' + ') || 'Sin zonas'}
              {porTransporte
                ? ` · Transporte: ${v.transporte || '—'}`
                : ` · Chofer: ${titular?.nombre || '—'}${acomp.length ? ` · Acompaña: ${acomp.map((a) => a.nombre).join(', ')}` : ''}${v.vehiculo ? ` · ${v.vehiculo}` : ''}`}
            </Text>
          </View>
          <View style={s.encDer}>
            <Text style={s.doc}>{porTransporte ? 'DESPACHO POR TRANSPORTE' : 'REPARTO'}</Text>
            <Text style={s.sub}>{t.paradas} clientes · {t.pedidos} pedidos · {t.bultos} bultos</Text>
          </View>
        </View>

        <View style={s.resumen}>
          <View style={s.caja}><Text style={s.cajaLbl}>Bultos a bajar</Text><Text style={s.cajaVal}>{t.bultos}</Text></View>
          <View style={s.caja}><Text style={s.cajaLbl}>Importe de este viaje</Text><Text style={s.cajaVal}>$ {fmt(t.total_viaje)}</Text></View>
          {!porTransporte && <View style={s.caja}><Text style={s.cajaLbl}>Saldos anteriores</Text><Text style={s.cajaVal}>$ {fmt(t.saldo_anterior)}</Text></View>}
          {!porTransporte && <View style={s.caja}><Text style={s.cajaLbl}>Cobrar sí o sí</Text><Text style={s.cajaVal}>$ {fmt(t.minimo_exigido)}</Text></View>}
          {!porTransporte && <View style={[s.caja, { marginRight: 0 }]}><Text style={s.cajaLbl}>Plata a cuenta del viaje</Text><Text style={s.cajaVal}>$ {fmt(dinero.fondo_entregado)}</Text></View>}
        </View>

        <View style={s.th} fixed>
          <Text style={[s.thT, s.cN]}>#</Text>
          <Text style={[s.thT, s.cCli]}>CLIENTE</Text>
          <Text style={[s.thT, s.cPed]}>PEDIDOS / COMPROBANTES</Text>
          <Text style={[s.thT, s.cBu]}>BULTOS</Text>
          <Text style={[s.thT, s.cImp]}>ESTE VIAJE</Text>
          {!porTransporte && <Text style={[s.thT, s.cImp]}>SALDO ANT.</Text>}
          {!porTransporte && <Text style={[s.thT, s.cImp]}>TOTAL</Text>}
          <Text style={[s.thT, s.cInst]}>INSTRUCCIÓN</Text>
          <Text style={[s.thT, s.cMano]}>{porTransporte ? 'RECIBIÓ' : 'COBRADO / RECIBIÓ'}</Text>
        </View>

        {paradas.map((p, i) => (
          <View key={p.id} style={[s.tr, p.bloquear_entrega ? s.trBloq : {}]} wrap={false}>
            <View style={s.cN}><Text style={s.nro}>{i + 1}</Text></View>
            <View style={s.cCli}>
              <Text style={s.cli}>{p.cliente_nombre}</Text>
              <Text style={s.gris}>{[p.direccion, p.localidad].filter(Boolean).join(' · ') || 'Sin dirección'}</Text>
              {(p.telefono || p.vendedores.length > 0) && (
                <Text style={s.gris}>
                  {p.telefono ? `Tel: ${p.telefono}` : ''}{p.telefono && p.vendedores.length ? ' · ' : ''}
                  {p.vendedores.length ? `Vend: ${p.vendedores.join(', ')}` : ''}
                </Text>
              )}
            </View>
            <View style={s.cPed}>
              {p.pedidos.length === 0 && <Text style={s.gris}>Sin mercadería — solo cobro</Text>}
              {p.pedidos.map((ped) => (
                <Text key={ped.id} style={s.gris}>
                  Ped {ped.numero} ({ped.bultos} bu)
                  {ped.comprobantes.map((c) => ` · ${c.tipo} ${c.numero}`).join('')}
                  {ped.remitos.map((r) => ` · R ${r.numero_remito}`).join('')}
                </Text>
              ))}
            </View>
            <Text style={[s.numB, s.cBu]}>{p.bultos}</Text>
            <Text style={[s.num, s.cImp]}>{fmt(p.total_viaje)}</Text>
            {!porTransporte && <Text style={[s.num, s.cImp]}>{fmt(p.saldo_anterior)}</Text>}
            {!porTransporte && <Text style={[s.numB, s.cImp]}>{fmt(p.total_a_cobrar)}</Text>}
            <View style={s.cInst}>
              {p.bloquear_entrega && <Text style={s.bloqueo}>NO ENTREGAR SIN COBRAR</Text>}
              {p.bloquear_entrega && p.motivo_bloqueo && <Text style={s.nota}>{p.motivo_bloqueo}</Text>}
              {p.minimo_exigido > 0 && (
                <Text style={s.exigir}>
                  COBRAR SÍ O SÍ $ {fmt(p.minimo_exigido)}
                  {p.exigir_cobro_anterior && p.exigir_cobro_actual ? ' (anterior + este viaje)' : p.exigir_cobro_anterior ? ' (lo anterior)' : ' (este viaje)'}
                </Text>
              )}
              {!porTransporte && p.minimo_exigido === 0 && !p.bloquear_entrega && <Text style={s.gris}>Puede dejar la mercadería</Text>}
              {p.nota_oficina && <Text style={s.nota}>{p.nota_oficina}</Text>}
            </View>
            <View style={s.cMano}>
              {!porTransporte && <Text style={s.manoLbl}>$</Text>}
              <Text style={[s.manoLbl, { marginTop: porTransporte ? 0 : 14 }]}>Firma:</Text>
            </View>
          </View>
        ))}

        <View style={s.tot} wrap={false}>
          <Text style={[s.numB, s.cN]} />
          <Text style={[s.numB, s.cCli]}>TOTALES</Text>
          <Text style={[s.numB, s.cPed]}>{t.pedidos} pedidos</Text>
          <Text style={[s.numB, s.cBu]}>{t.bultos}</Text>
          <Text style={[s.numB, s.cImp]}>{fmt(t.total_viaje)}</Text>
          {!porTransporte && <Text style={[s.numB, s.cImp]}>{fmt(t.saldo_anterior)}</Text>}
          {!porTransporte && <Text style={[s.numB, s.cImp]}>{fmt(t.total_a_cobrar)}</Text>}
        </View>

        {!porTransporte && (
          <View style={s.pie} wrap={false}>
            <View style={s.pieCol}>
              <Text style={s.pieTit}>Plata del viaje</Text>
              {dinero.fondos.map((f) => (
                <View key={f.id} style={s.pieLin}>
                  <Text>A cuenta — {f.origen} — retiró {f.retirado_por}</Text>
                  <Text>$ {fmt(f.monto)}</Text>
                </View>
              ))}
              {dinero.fondos.length === 0 && <View style={s.pieLin}><Text>Sin plata a cuenta entregada</Text><Text>$ 0,00</Text></View>}
            </View>
            <View style={s.pieCol}>
              <Text style={s.pieTit}>Gastos (anotar y cargar en la app)</Text>
              {['Nafta', 'Peón', 'Hotel', 'Peajes / otros'].map((g) => (
                <View key={g} style={s.pieLin}><Text>{g}</Text><Text>$ ____________</Text></View>
              ))}
            </View>
            <View style={[s.pieCol, { marginRight: 0 }]}>
              <Text style={s.pieTit}>Rendición</Text>
              <View style={s.pieLin}><Text>Efectivo cobrado</Text><Text>$ ____________</Text></View>
              <View style={s.pieLin}><Text>Cheques (cantidad / total)</Text><Text>____ / $ ________</Text></View>
              <View style={s.pieLin}><Text>Efectivo que entrega</Text><Text>$ ____________</Text></View>
              <Text style={s.firma}>Firma del chofer</Text>
            </View>
          </View>
        )}

        {v.observaciones && <Text style={[s.nota, { marginTop: 8 }]}>Observaciones: {v.observaciones}</Text>}

        <Text style={s.pagina} fixed render={({ pageNumber, totalPages }) => `${v.nombre} · hoja ${pageNumber} de ${totalPages}`} />
      </Page>
    </Document>
  )
}
