/**
 * WSFEV1 — Web Service de Facturación Electrónica v1 de ARCA.
 *
 * Cubre: Facturas A/B, Notas de Crédito/Débito A/B (sin detalle de ítems).
 * Operaciones implementadas:
 *   - FECompUltimoAutorizado: último número autorizado en ARCA para un tipo/punto de venta.
 *   - FECAESolicitar:         solicitar CAE para un comprobante.
 */

import type { AmbienteARCA, SolicitudCAE, RespuestaCAE, IvaARCA, TributoARCA, CbteAsocARCA } from './tipos'
import { fetchArca } from './ssl-agent'

const URL_WSFEV1: Record<AmbienteARCA, string> = {
  testing:    'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  produccion: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
}

const NS = 'http://ar.gov.afip.dif.FEV1/'

function n2(n: number): string {
  return n.toFixed(2)
}

function extraerTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`))
  return m ? m[1].trim() : ''
}

function extraerTodos(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'g')
  const res: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) res.push(m[1].trim())
  return res
}

function buildAuth(token: string, sign: string, cuit: string): string {
  return `<ar:Auth>
      <ar:Token>${token}</ar:Token>
      <ar:Sign>${sign}</ar:Sign>
      <ar:Cuit>${cuit}</ar:Cuit>
    </ar:Auth>`
}

function buildIva(iva: IvaARCA[]): string {
  if (!iva.length) return ''
  const items = iva.map(a => `
          <ar:AlicIva>
            <ar:Id>${a.id}</ar:Id>
            <ar:BaseImp>${n2(a.baseImp)}</ar:BaseImp>
            <ar:Importe>${n2(a.importe)}</ar:Importe>
          </ar:AlicIva>`).join('')
  return `<ar:Iva>${items}
        </ar:Iva>`
}

function buildTributos(tributos: TributoARCA[]): string {
  if (!tributos.length) return ''
  const items = tributos.map(t => `
          <ar:Tributo>
            <ar:Id>${t.id}</ar:Id>
            <ar:Desc>${t.desc}</ar:Desc>
            <ar:BaseImp>${n2(t.baseImp)}</ar:BaseImp>
            <ar:Alic>${n2(t.alic)}</ar:Alic>
            <ar:Importe>${n2(t.importe)}</ar:Importe>
          </ar:Tributo>`).join('')
  return `<ar:Tributos>${items}
        </ar:Tributos>`
}

function buildCbtesAsoc(cbtes: CbteAsocARCA[]): string {
  if (!cbtes.length) return ''
  const items = cbtes.map(c => `
          <ar:CbteAsoc>
            <ar:Tipo>${c.tipo}</ar:Tipo>
            <ar:PtoVta>${c.ptoVta}</ar:PtoVta>
            <ar:Nro>${c.nro}</ar:Nro>
          </ar:CbteAsoc>`).join('')
  return `<ar:CbtesAsoc>${items}
        </ar:CbtesAsoc>`
}

async function llamarWS(ambiente: AmbienteARCA, accion: string, body: string): Promise<string> {
  const url = URL_WSFEV1[ambiente]
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="${NS}">
  <soapenv:Header/>
  <soapenv:Body>
    ${body}
  </soapenv:Body>
</soapenv:Envelope>`

  const res = await fetchArca(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction':   `"${NS}${accion}"`,
    },
    body: envelope,
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`WSFEV1 HTTP ${res.status} en ${accion}: ${text.substring(0, 400)}`)
  }
  return text
}

/**
 * FECompUltimoAutorizado — consulta el último número de comprobante autorizado en ARCA.
 * Retorna 0 si nunca se emitió ninguno (punto de venta nuevo).
 */
export async function ultimoAutorizado(
  ambiente: AmbienteARCA,
  token: string,
  sign: string,
  cuit: string,
  ptoVta: number,
  cbteTipo: number,
): Promise<number> {
  const body = `<ar:FECompUltimoAutorizado>
    ${buildAuth(token, sign, cuit)}
    <ar:PtoVta>${ptoVta}</ar:PtoVta>
    <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
  </ar:FECompUltimoAutorizado>`

  const xml = await llamarWS(ambiente, 'FECompUltimoAutorizado', body)

  const errores = extraerTodos(xml, 'Err')
  // Error 10016 = PV no existe (punto de venta nuevo) → el siguiente número es 1
  const esPVNuevo = errores.some(e => e.includes('10016') || e.includes('punto de venta'))
  if (esPVNuevo || errores.length === 0) {
    const nroStr = extraerTag(xml, 'CbteNro')
    return nroStr ? parseInt(nroStr, 10) : 0
  }

  // Si hay error real (no PV nuevo), lo lanzamos
  const primerError = extraerTag(errores[0], 'Msg') || errores[0]
  throw new Error(`ARCA FECompUltimoAutorizado: ${primerError}`)
}

/**
 * FECAESolicitar — solicita CAE para un comprobante.
 * Lanza error si ARCA rechaza el comprobante.
 */
export async function solicitarCAE(req: SolicitudCAE): Promise<RespuestaCAE> {
  const ivaXml      = buildIva(req.iva)
  const tributosXml = buildTributos(req.tributos ?? [])
  const asocXml     = buildCbtesAsoc(req.cbteAsoc ?? [])

  const body = `<ar:FECAESolicitar>
    ${buildAuth(req.token, req.sign, req.cuit)}
    <ar:FeCAEReq>
      <ar:FeCabReq>
        <ar:CantReg>1</ar:CantReg>
        <ar:PtoVta>${req.ptoVta}</ar:PtoVta>
        <ar:CbteTipo>${req.cbteTipo}</ar:CbteTipo>
      </ar:FeCabReq>
      <ar:FeDetReq>
        <ar:FECAEDetRequest>
          <ar:Concepto>${req.concepto}</ar:Concepto>
          <ar:DocTipo>${req.docTipo}</ar:DocTipo>
          <ar:DocNro>${req.docNro}</ar:DocNro>
          <ar:CbteDesde>${req.cbteDesde}</ar:CbteDesde>
          <ar:CbteHasta>${req.cbteHasta}</ar:CbteHasta>
          <ar:CbteFch>${req.fecha}</ar:CbteFch>
          <ar:ImpTotal>${n2(req.impTotal)}</ar:ImpTotal>
          <ar:ImpTotConc>${n2(req.impTotConc)}</ar:ImpTotConc>
          <ar:ImpNeto>${n2(req.impNeto)}</ar:ImpNeto>
          <ar:ImpOpEx>${n2(req.impOpEx)}</ar:ImpOpEx>
          <ar:ImpIVA>${n2(req.impIva)}</ar:ImpIVA>
          <ar:ImpTrib>${n2(req.impTrib)}</ar:ImpTrib>
          <ar:MonId>PES</ar:MonId>
          <ar:MonCotiz>1.000</ar:MonCotiz>
          <ar:CondicionIVAReceptorId>${req.condicionIVAReceptorId}</ar:CondicionIVAReceptorId>
          ${ivaXml}
          ${tributosXml}
          ${asocXml}
        </ar:FECAEDetRequest>
      </ar:FeDetReq>
    </ar:FeCAEReq>
  </ar:FECAESolicitar>`

  const xml = await llamarWS(req.ambiente, 'FECAESolicitar', body)

  // Errores de nivel cabecera o detalle
  const errTags = extraerTodos(xml, 'Err')
  if (errTags.length) {
    const msgs = errTags.map(e => extraerTag(e, 'Msg') || e).join(' | ')
    throw new Error(`ARCA rechazó el comprobante: ${msgs}`)
  }

  const resultado = extraerTag(xml, 'Resultado')
  if (resultado === 'R') {
    const obs = extraerTodos(xml, 'Obs').map(o => extraerTag(o, 'Msg') || o)
    throw new Error(`ARCA rechazó el comprobante: ${obs.join(' | ')}`)
  }

  const cae = extraerTag(xml, 'CAE')
  const vto = extraerTag(xml, 'CAEFchVto')

  if (!cae) throw new Error('ARCA no devolvió CAE en la respuesta. Respuesta: ' + xml.substring(0, 400))

  const observaciones = extraerTodos(xml, 'Obs').map(o => extraerTag(o, 'Msg') || o).filter(Boolean)

  // Formatear vencimiento: ARCA devuelve YYYYMMDD, convertir a YYYY-MM-DD
  const vencimientoCae = vto.length === 8
    ? `${vto.substring(0, 4)}-${vto.substring(4, 6)}-${vto.substring(6, 8)}`
    : vto

  return { cae, vencimientoCae, observaciones }
}

