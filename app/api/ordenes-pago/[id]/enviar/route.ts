import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requirePermiso } from '@/lib/auth'
import { enviarOrdenAlProveedor } from '@/lib/ordenes-pago/envio'

export const maxDuration = 60

/**
 * POST /api/ordenes-pago/[id]/enviar — manda (o vuelve a mandar) la orden de pago ya pagada al
 * proveedor por mail, con el PDF de la orden y el certificado de retención si lo hay. Es el
 * botón de "enviar / reintentar": el envío normal sale solo al confirmar la orden.
 * Sale de la cuenta de compras y respeta el MODO PRUEBA (compras_envio_ajustes). Queda registro.
 * Solo admin (hoy todo lo de órdenes de pago lo es).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermiso('ordenes_pago_confirmar')
  if (auth.error) return auth.error
  const { id } = await params
  const envio = await enviarOrdenAlProveedor(createAdminClient(), id, { usuarioId: auth.user?.id ?? null, origen: 'manual' })
  return NextResponse.json({ ok: envio.estado !== 'fallo', envio }, { status: envio.estado === 'fallo' ? 502 : 200 })
}
