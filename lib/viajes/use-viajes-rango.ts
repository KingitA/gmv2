'use client'

// Viajes de un rango de fechas para los calendarios (pantalla Viajes y CLIENTES).
// Lee GET /api/viajes?desde&hasta (la misma API de siempre) y se actualiza en vivo.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useRealtime } from '@/lib/hooks/use-realtime'

export type ViajeCal = {
  id: string
  nombre: string
  fecha: string
  dias: number
  estado: string
  tipo_transporte: string | null
  zonas: { id: string; nombre: string }[]
  choferes: { usuario_id: string; rol: string; nombre: string }[]
  vehiculos?: { nombre: string; patente: string | null } | null
  transportes?: { nombre: string } | null
  pedidos_count: number
  clientes_count: number
  bultos: number
  total: number
}

export const sumarDias = (f: string, n: number) => {
  const d = new Date(f + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const quienLleva = (v: ViajeCal) =>
  v.tipo_transporte === 'transporte'
    ? v.transportes?.nombre || 'Transporte sin definir'
    : v.choferes.find(c => c.rol === 'titular')?.nombre || 'Sin chofer'

/** Se puede cambiar la fecha / subir pedidos mientras no salió. */
export const viajeMovible = (estado: string) => ['programado', 'despachado'].includes(estado)

export function useViajesRango(desde: string, hasta: string) {
  const [viajes, setViajes] = useState<ViajeCal[]>([])
  const [cargando, setCargando] = useState(true)
  const pedidoRef = useRef(0)

  const cargar = useCallback(async (silencioso = false) => {
    const yo = ++pedidoRef.current
    if (!silencioso) setCargando(true)
    try {
      const res = await fetch(`/api/viajes?desde=${desde}&hasta=${hasta}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (yo === pedidoRef.current) setViajes(data.viajes || [])
    } catch (e: any) {
      if (!silencioso) toast.error(e?.message || 'No se pudieron cargar los viajes')
    } finally {
      if (yo === pedidoRef.current) setCargando(false)
    }
  }, [desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  // En vivo: viajes creados/movidos por otro usuario o pedidos que se suben/bajan
  useRealtime(['viajes', 'viaje_zonas', 'pedidos'], () => cargar(true))

  /** Cambia la fecha de un viaje (misma API que el calendario de Viajes). */
  const moverViaje = useCallback(async (viajeId: string, nuevaFecha: string) => {
    const v = viajes.find(x => x.id === viajeId)
    if (!v || String(v.fecha).slice(0, 10) === nuevaFecha) return
    if (!viajeMovible(v.estado)) { toast.error('Ese viaje ya salió: no se cambia la fecha'); return }
    setViajes(prev => prev.map(x => (x.id === viajeId ? { ...x, fecha: nuevaFecha } : x)))
    try {
      const res = await fetch(`/api/viajes/${viajeId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fecha: nuevaFecha }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`${v.nombre} pasa al ${nuevaFecha.slice(8)}/${nuevaFecha.slice(5, 7)}`)
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo mover el viaje')
    }
    cargar(true)
  }, [viajes, cargar])

  return { viajes, cargando, recargar: cargar, moverViaje }
}
