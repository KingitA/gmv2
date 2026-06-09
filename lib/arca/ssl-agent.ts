import { Agent } from 'undici'

// ARCA (AFIP) uses DHE cipher suites with 1024-bit DH keys.
// OpenSSL 3 (Node.js 18+) rejects keys < 2048 bits by default (ERR_SSL_DH_KEY_TOO_SMALL).
// Excluding !DHE forces ECDHE instead, which is stronger and avoids the error.
export const arcaAgent = new Agent({
  connect: {
    rejectUnauthorized: true,
    ciphers: 'ALL:!DHE',
  },
})
