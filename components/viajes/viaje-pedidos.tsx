"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { X } from "lucide-react"
import { toast } from "sonner"
import { formatCurrency, formatDateAR } from "@/lib/utils"
import { ESTADO_LABEL } from "@/lib/pedidos/estados"
import { localMatch } from "@/lib/search/local-match"

// Pedidos del viaje + candidatos para subir en lote. Los candidatos son pedidos
// sin viaje, en cualquier estado previo a salir, de clientes de las zonas del
// viaje (o de cualquier zona con "Ver todas").

type Ped = {
  id: string; numero: string; fecha: string; estado: string; total: number; bultos: number
  cliente_nombre: string; localidad: string; vendedor: string
}

export function ViajePedidos({ viajeId, onCambio }: { viajeId: string; onCambio: () => void }) {
  const [asignados, setAsignados] = useState<Ped[]>([])
  const [candidatos, setCandidatos] = useState<Ped[]>([])
  const [editable, setEditable] = useState(false)
  const [todas, setTodas] = useState(false)
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [filtro, setFiltro] = useState("")
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)

  const cargar = async () => {
    setCargando(true)
    try {
      const res = await fetch(`/api/viajes/${viajeId}/pedidos${todas ? "?todas=1" : ""}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAsignados(data.pedidos || [])
      setCandidatos(data.candidatos || [])
      setEditable(Boolean(data.editable))
      setSeleccion([])
    } catch (e: any) {
      toast.error(e?.message || "No se pudieron cargar los pedidos")
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [viajeId, todas])

  const mandar = async (body: { agregar?: string[]; quitar?: string[] }) => {
    setOcupado(true)
    try {
      const res = await fetch(`/api/viajes/${viajeId}/pedidos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (data.rechazados?.length) toast.warning(`${data.rechazados.length} pedido(s) no se pudieron subir: ${data.rechazados[0].motivo}`)
      else toast.success(body.agregar ? `${data.agregados} pedido(s) subidos al viaje` : "Pedido quitado del viaje")
      await cargar()
      onCambio()
    } catch (e: any) {
      toast.error(e?.message || "No se pudo actualizar el viaje")
    } finally {
      setOcupado(false)
    }
  }

  const visibles = useMemo(
    () => candidatos.filter((p) => !filtro.trim() || localMatch(filtro, p.cliente_nombre, p.localidad, p.numero, p.vendedor)),
    [candidatos, filtro],
  )
  const sel = candidatos.filter((p) => seleccion.includes(p.id))

  if (cargando) return <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 font-semibold">
          En el viaje ({asignados.length}) · {asignados.reduce((s, p) => s + p.bultos, 0)} bultos ·{" "}
          {formatCurrency(asignados.reduce((s, p) => s + p.total, 0))}
        </h3>
        <TablaPedidos
          pedidos={asignados}
          vacio="Todavía no hay pedidos en este viaje"
          accion={editable ? (p) => (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" disabled={ocupado} onClick={() => mandar({ quitar: [p.id] })}>
              <X className="h-4 w-4" />
            </Button>
          ) : undefined}
        />
      </div>

      {editable ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold">Pedidos para subir ({visibles.length})</h3>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={todas} onCheckedChange={(c) => setTodas(Boolean(c))} />
                Ver todas las zonas
              </label>
              <Input className="h-8 w-56" placeholder="Filtrar…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
              <Button size="sm" disabled={!seleccion.length || ocupado} onClick={() => mandar({ agregar: seleccion })}>
                Subir {seleccion.length || ""} al viaje
                {sel.length > 0 && ` · ${sel.reduce((s, p) => s + p.bultos, 0)} bu`}
              </Button>
            </div>
          </div>
          <TablaPedidos
            pedidos={visibles}
            vacio={todas ? "No hay pedidos sin viaje" : "No hay pedidos sin viaje en las zonas de este viaje"}
            seleccion={seleccion}
            onSeleccion={setSeleccion}
          />
        </div>
      ) : (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          El viaje ya fue despachado: no se agregan ni quitan pedidos.
        </p>
      )}
    </div>
  )
}

function TablaPedidos({
  pedidos, vacio, accion, seleccion, onSeleccion,
}: {
  pedidos: Ped[]
  vacio: string
  accion?: (p: Ped) => React.ReactNode
  seleccion?: string[]
  onSeleccion?: (ids: string[]) => void
}) {
  const todos = !!seleccion && pedidos.length > 0 && pedidos.every((p) => seleccion.includes(p.id))
  return (
    <div className="max-h-[28rem] overflow-y-auto rounded-md border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            {onSeleccion && (
              <TableHead className="w-8">
                <Checkbox checked={todos} onCheckedChange={(c) => onSeleccion(c ? pedidos.map((p) => p.id) : [])} />
              </TableHead>
            )}
            <TableHead>Pedido</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Localidad</TableHead>
            <TableHead>Vendedor</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Bultos</TableHead>
            <TableHead className="text-right">Total</TableHead>
            {accion && <TableHead className="w-8" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pedidos.length === 0 ? (
            <TableRow><TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">{vacio}</TableCell></TableRow>
          ) : (
            pedidos.map((p) => (
              <TableRow key={p.id}>
                {onSeleccion && seleccion && (
                  <TableCell>
                    <Checkbox
                      checked={seleccion.includes(p.id)}
                      onCheckedChange={(c) => onSeleccion(c ? [...seleccion, p.id] : seleccion.filter((x) => x !== p.id))}
                    />
                  </TableCell>
                )}
                <TableCell className="whitespace-nowrap">
                  <span className="font-medium">#{p.numero}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{formatDateAR(p.fecha)}</span>
                </TableCell>
                <TableCell>{p.cliente_nombre}</TableCell>
                <TableCell>{p.localidad}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{p.vendedor}</TableCell>
                <TableCell><Badge variant="secondary">{ESTADO_LABEL[p.estado] || p.estado}</Badge></TableCell>
                <TableCell className="text-right">{p.bultos}</TableCell>
                <TableCell className="text-right">{formatCurrency(p.total)}</TableCell>
                {accion && <TableCell>{accion(p)}</TableCell>}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
