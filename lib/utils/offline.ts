export interface PagoPendiente extends Record<string, any> {
  pendiente_sincronizacion: boolean
  timestamp: number
}

export function guardarPagoPendiente(pago: any) {
  const pagosPendientes = getPagosPendientes()
  pagosPendientes.push({
    ...pago,
    pendiente_sincronizacion: true,
    timestamp: Date.now()
  })
  localStorage.setItem('pagos_pendientes', JSON.stringify(pagosPendientes))
}

export function getPagosPendientes(): PagoPendiente[] {
  if (typeof window === 'undefined') return []
  const stored = localStorage.getItem('pagos_pendientes')
  return stored ? JSON.parse(stored) : []
}

export function limpiarPagosPendientes() {
  localStorage.removeItem('pagos_pendientes')
}

export function hayPendientesSincronizar(): boolean {
  return getPagosPendientes().length > 0
}
