/**
 * WSAA — Web Service de Autenticación y Autorización de ARCA.
 *
 * Proceso:
 * 1. Se crea un TRA (Ticket Request de Acceso) en XML.
 * 2. Se firma el TRA con la clave privada + certificado usando PKCS#7/CMS (S/MIME).
 * 3. Se envía al WSAA via SOAP. WSAA devuelve un TA (Ticket de Acceso) con Token y Sign.
 * 4. El TA es válido por 12 horas — se guarda en caché para no pedirlo en cada factura.
 */

import forge from 'node-forge'
import type { AmbienteARCA } from './tipos'

const DESTINO_WSAA = 'cn=wsaa,o=afip,c=ar,serialNumber=CUIT 33693450239'

const URL_WSAA: Record<AmbienteARCA, string> = {
  testing:    'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  produccion: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
}

function toISOArgentina(d: Date): string {
  // WSAA acepta ISO 8601 con offset
  return d.toISOString().replace('Z', '-00:00')
}

function crearTRA(servicio: string): string {
  const ahora = new Date()
  const desde = new Date(ahora.getTime() - 600_000)   // 10 min atrás (margen de reloj)
  const hasta = new Date(ahora.getTime() + 43_200_000) // 12 hs

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<loginTicketRequest version="1.0">',
    '  <header>',
    `    <destination>${DESTINO_WSAA}</destination>`,
    `    <uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>`,
    `    <generationTime>${toISOArgentina(desde)}</generationTime>`,
    `    <expirationTime>${toISOArgentina(hasta)}</expirationTime>`,
    '  </header>',
    `  <service>${servicio}</service>`,
    '</loginTicketRequest>',
  ].join('\n')
}

/**
 * Normaliza PEM desde variables de entorno:
 * - Reemplaza \n literales (Vercel/env) por saltos de línea reales
 * - Elimina \r (Windows CRLF)
 * - Acepta tanto PKCS#1 (BEGIN RSA PRIVATE KEY) como PKCS#8 (BEGIN PRIVATE KEY)
 */
function normalizarPEM(pem: string): string {
  return pem
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

function firmarTRA(tra: string, certPem: string, keyPem: string): string {
  const certNorm = normalizarPEM(certPem)
  const keyNorm  = normalizarPEM(keyPem)

  const cert = forge.pki.certificateFromPem(certNorm)

  // PKCS#8 (BEGIN PRIVATE KEY) → extraer la clave RSA interna
  // PKCS#1 (BEGIN RSA PRIVATE KEY) → parsear directo
  let key: forge.pki.rsa.PrivateKey
  if (keyNorm.includes('BEGIN RSA PRIVATE KEY')) {
    key = forge.pki.privateKeyFromPem(keyNorm)
  } else {
    // PKCS#8 sin cifrar: extraer la clave RSA del wrapper
    const der  = forge.util.decode64(
      keyNorm.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
    )
    const asn1 = forge.asn1.fromDer(der)
    key = forge.pki.privateKeyFromAsn1(asn1)
  }

  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(tra, 'utf8')
  p7.addCertificate(cert)
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [],
  })
  p7.sign({ detached: false })

  const der = forge.asn1.toDer(p7.toAsn1())
  return forge.util.encode64(der.getBytes())
}

function extraerTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`))
  return m ? m[1].trim() : ''
}

export interface TicketAcceso {
  token: string
  sign: string
  expiracion: Date
}

export async function obtenerTicketAcceso(
  servicio: string,
  certPem: string,
  keyPem: string,
  ambiente: AmbienteARCA,
): Promise<TicketAcceso> {
  const tra       = crearTRA(servicio)
  const firmado   = firmarTRA(tra, certPem, keyPem)

  const soapEnv = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov.ar">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${firmado}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`

  const res = await fetch(URL_WSAA[ambiente], {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=UTF-8',
      'SOAPAction':   'loginCms',
    },
    body: soapEnv,
  })

  const body = await res.text()

  if (!res.ok) {
    const faultcode  = extraerTag(body, 'faultcode')  || ''
    const faultstring = extraerTag(body, 'faultstring') || body.substring(0, 500)
    throw new Error(`WSAA ${ambiente} error ${res.status}: [${faultcode}] ${faultstring}`)
  }

  // La respuesta contiene el XML del ticket dentro del tag loginCmsReturn
  const rawReturn = extraerTag(body, 'loginCmsReturn')
  if (!rawReturn) {
    // Algunos entornos devuelven el error directamente
    const faultStr = extraerTag(body, 'faultstring')
    throw new Error(`WSAA no devolvió loginCmsReturn. ${faultStr || body.substring(0, 300)}`)
  }

  // El contenido puede estar en base64 o como XML directo con entidades escapadas
  let xmlTicket = rawReturn
  try {
    const decoded = Buffer.from(rawReturn, 'base64').toString('utf8')
    if (decoded.includes('<loginTicketResponse')) xmlTicket = decoded
  } catch { /* no era base64, usar el texto crudo */ }

  // Desescapar entidades XML si el XML llegó escapado dentro del SOAP
  xmlTicket = xmlTicket
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

  const token       = extraerTag(xmlTicket, 'token')
  const sign        = extraerTag(xmlTicket, 'sign')
  const expStr      = extraerTag(xmlTicket, 'expirationTime')

  if (!token || !sign) {
    throw new Error(`WSAA no devolvió token/sign válidos. Respuesta: ${xmlTicket.substring(0, 300)}`)
  }

  return { token, sign, expiracion: new Date(expStr) }
}
