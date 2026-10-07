'use client'

// "Programar viaje": solo fecha + zonas (chofer, vehículo y pedidos se completan
// después desde el viaje). Extraído de app/viajes/page.tsx para usarlo también
// desde CLIENTES; mismo POST /api/viajes de siempre.

import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { DateInputAR } from '@/components/ui/date-input-ar'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Fecha y zonas con las que arranca el formulario (ej. al soltar pedidos en un día). */
  fechaInicial?: string
  zonaIdsIniciales?: string[]
  /** Texto extra arriba del formulario (ej. "Se van a subir 3 pedidos de Tandil"). */
  aviso?: ReactNode
  /** Se llama con el viaje creado (lo que devuelve la API). */
  onProgramado?: (viaje: { id: string; fecha: string }) => void
}

export function ProgramarViajeDialog({ open, onOpenChange, fechaInicial = '', zonaIdsIniciales = [], aviso, onProgramado }: Props) {
  const [zonas, setZonas] = useState<{ id: string; nombre: string }[]>([])
  const [fecha, setFecha] = useState('')
  const [zonaIds, setZonaIds] = useState<string[]>([])
  const [porTransporte, setPorTransporte] = useState(false)
  const [dias, setDias] = useState('1')
  const [nombre, setNombre] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    createClient().from('zonas').select('id, nombre').order('nombre')
      .then((r: { data: { id: string; nombre: string }[] | null }) => setZonas(r.data || []))
  }, [])

  // Cada vez que se abre arranca limpio (con lo que traiga el que lo abre)
  useEffect(() => {
    if (!open) return
    setFecha(fechaInicial)
    setZonaIds(zonaIdsIniciales)
    setPorTransporte(false)
    setDias('1')
    setNombre('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const programar = async () => {
    if (!fecha || !zonaIds.length) {
      toast.error('Elegí la fecha y al menos una zona')
      return
    }
    setGuardando(true)
    try {
      const res = await fetch('/api/viajes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha,
          zona_ids: zonaIds,
          nombre,
          dias: Number(dias) || 1,
          tipo_transporte: porTransporte ? 'transporte' : 'chofer_propio',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('Viaje programado')
      onOpenChange(false)
      onProgramado?.({ id: data.id, fecha })
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo programar el viaje')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Programar viaje</DialogTitle>
          <DialogDescription>
            Solo fecha y zonas. Chofer, vehículo y pedidos se completan después desde el viaje.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {aviso && <div className="rounded-lg bg-cian-50 px-3 py-2 text-[13px] text-cian-900">{aviso}</div>}
          <div className="grid grid-cols-[1fr_130px] gap-3">
            <div className="space-y-1.5">
              <Label>Sale el</Label>
              <DateInputAR value={fecha} onChange={setFecha} />
            </div>
            <div className="space-y-1.5">
              <Label>Duración (días)</Label>
              <Input type="number" min="1" max="15" value={dias} onChange={e => setDias(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Zonas</Label>
            <div className="grid max-h-56 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-lg border p-3">
              {zonas.map(z => (
                <label key={z.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={zonaIds.includes(z.id)}
                    onCheckedChange={c => setZonaIds(prev => (c ? [...prev, z.id] : prev.filter(x => x !== z.id)))}
                  />
                  {z.nombre}
                </label>
              ))}
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={porTransporte} onCheckedChange={c => setPorTransporte(Boolean(c))} />
            Sale por transporte tercerizado (sin chofer propio ni rendición)
          </label>
          <div className="space-y-1.5">
            <Label>Nombre <span className="font-medium text-neutro-400">opcional</span></Label>
            <Input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Si lo dejás vacío: zonas y fecha" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={programar} disabled={guardando}>{guardando ? 'Guardando…' : 'Programar'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
