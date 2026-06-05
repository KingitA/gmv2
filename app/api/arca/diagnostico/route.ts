import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

// Endpoint temporal para diagnosticar variables de entorno ARCA en Vercel.
// Solo accesible para admins. Borrar una vez resuelto el problema.
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const cert = process.env.ARCA_CERTIFICADO ?? ''
  const key  = process.env.ARCA_CLAVE_PRIVADA ?? ''

  const analizar = (valor: string, nombre: string) => {
    const tieneBackslashN   = valor.includes('\\n')
    const tieneNewlineReal  = valor.includes('\n')
    const tieneCarriageReturn = valor.includes('\r')
    const primeraLinea      = valor.substring(0, 60)
    const ultimaLinea       = valor.substring(valor.length - 60)
    const cantidadLineas    = valor.split('\n').length
    const longitudTotal     = valor.length

    return {
      nombre,
      longitudTotal,
      cantidadLineas,
      tieneBackslashN,
      tieneNewlineReal,
      tieneCarriageReturn,
      primeraLinea,
      ultimaLinea,
    }
  }

  return NextResponse.json({
    cert: analizar(cert, 'ARCA_CERTIFICADO'),
    key:  analizar(key,  'ARCA_CLAVE_PRIVADA'),
  })
}
