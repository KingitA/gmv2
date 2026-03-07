const ERP_URL = process.env.NEXT_PUBLIC_ERP_URL || 'https://v0-inventory-and-sales-system-five.vercel.app'

export async function getViajes(choferId: string) {
  const response = await fetch(`${ERP_URL}/api/viajes?chofer_id=${choferId}`)
  if (!response.ok) throw new Error('Error al obtener viajes')
  return response.json()
}

export async function getViajeDetalle(viajeId: string) {
  const response = await fetch(`${ERP_URL}/api/viajes/${viajeId}`)
  if (!response.ok) throw new Error('Error al obtener detalle del viaje')
  return response.json()
}

export async function registrarPago(viajeId: string, pago: any) {
  const response = await fetch(`${ERP_URL}/api/viajes/${viajeId}/pagos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pago)
  })
  if (!response.ok) throw new Error('Error al registrar pago')
  return response.json()
}

export async function marcarEntregado(pedidoId: string) {
  const response = await fetch(`${ERP_URL}/api/pedidos/${pedidoId}/estado`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'entregado' })
  })
  if (!response.ok) throw new Error('Error al marcar como entregado')
  return response.json()
}

export async function registrarDevolucion(devolucion: any) {
  const response = await fetch(`${ERP_URL}/api/devoluciones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(devolucion)
  })
  if (!response.ok) throw new Error('Error al registrar devolución')
  return response.json()
}

export async function getEstadisticas(choferId: string, mes?: string) {
  const url = mes 
    ? `${ERP_URL}/api/choferes/estadisticas?chofer_id=${choferId}&mes=${mes}`
    : `${ERP_URL}/api/choferes/estadisticas?chofer_id=${choferId}`
  const response = await fetch(url)
  if (!response.ok) throw new Error('Error al obtener estadísticas')
  return response.json()
}
