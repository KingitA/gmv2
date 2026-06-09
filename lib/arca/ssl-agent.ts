import https from 'node:https'

// ARCA (AFIP) uses DHE cipher suites with 1024-bit DH keys.
// OpenSSL 3 (Node.js 18+) rejects keys < 2048 bits (ERR_SSL_DH_KEY_TOO_SMALL).
// ciphers: 'ALL:!DHE' forces ECDHE instead, which is stronger and accepted by both sides.
export function fetchArca(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      {
        hostname: u.hostname,
        port:     443,
        path:     u.pathname + u.search,
        method:   init.method,
        headers:  init.headers,
        ciphers:  'ALL:!DHE',
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve(new Response(body, { status: res.statusCode ?? 200 }))
        })
      },
    )
    req.on('error', reject)
    req.write(init.body)
    req.end()
  })
}
