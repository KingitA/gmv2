"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ArrowUp, ArrowDown, Lock, Trash2, Search, Package, Phone } from "lucide-react"
import { toast } from "sonner"
import { formatCurrency } from "@/lib/utils"
import type { HojaRuta, ParadaHoja } from "@/lib/viajes/hoja-ruta"
import { ESTADO_LABEL } from "@/lib/pedidos/estados"

// La hoja de ruta en pantalla: paradas en orden, con la instrucción de oficina
// (cobrar sí o sí lo anterior / lo de este viaje, candado de entrega, nota) y,
// una vez en la calle, el resultado que carga el chofer.

const ESTADO_PARADA: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "bg-slate-200 text-slate-700" },
  entregado: { label: "Entregado", cls: "bg-green-600 text-white" },
  entregado_parcial: { label: "Entrega parcial", cls: "bg-amber-500 text-white" },
  no_entregado: { label: "No entregado", cls: "bg-red-600 text-white" },
  solo_cobro: { label: "Solo cobro", cls: "bg-blue-600 text-white" },
}

export function ViajeHoja({
  hoja,
  ordenEditable,
  instruccionesEditables,
  conCobranza,
  onCambio,
}: {
  hoja: HojaRuta
  ordenEditable: boolean
  instruccionesEditables: boolean
  conCobranza: boolean
  onCambio: () => void
}) {
  const viajeId = hoja.viaje.id
  const [ocupado, setOcupado] = useState(false)
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<any[]>([])

  const patch = async (body: any, silencioso = false) => {
    setOcupado(true)
    try {
      const res = await fetch(`/api/viajes/${viajeId}/paradas`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (!silencioso) toast.success("Guardado")
      onCambio()
    } catch (e: any) {
      toast.error(e?.message || "No se pudo guardar")
    } finally {
      setOcupado(false)
    }
  }

  const mover = (i: number, delta: number) => {
    const ids = hoja.paradas.map((p) => p.id)
    const j = i + delta
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    patch({ orden: ids }, true)
  }

  const buscarCliente = async () => {
    if (busqueda.trim().length < 2) return
    const res = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(busqueda.trim())}`)
    const data = await res.json()
    setResultados(Array.isArray(data) ? data.slice(0, 8) : [])
  }

  const t = hoja.totales

  return (
    <div className="space-y-4">
      {/* Totales */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Dato etiqueta="Paradas" valor={String(t.paradas)} />
        <Dato etiqueta="Pedidos" valor={String(t.pedidos)} />
        <Dato etiqueta="Bultos" valor={String(t.bultos)} />
        <Dato etiqueta="Este viaje" valor={formatCurrency(t.total_viaje)} />
        {conCobranza && <Dato etiqueta="Saldos anteriores" valor={formatCurrency(t.saldo_anterior)} />}
        {conCobranza && <Dato etiqueta="Cobrar sí o sí" valor={formatCurrency(t.minimo_exigido)} destacado />}
      </div>

      {(t.pedidos_sin_facturar > 0 || t.pedidos_sin_remito > 0) && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t.pedidos_sin_facturar > 0 && <>⚠ {t.pedidos_sin_facturar} pedido(s) todavía sin facturar. </>}
          {t.pedidos_sin_remito > 0 && <>⚠ {t.pedidos_sin_remito} pedido(s) sin remito.</>}
        </p>
      )}

      {hoja.paradas.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Todavía no hay paradas: asigná pedidos al viaje desde la pestaña Pedidos.
        </p>
      )}

      {hoja.paradas.map((p, i) => (
        <Parada
          key={p.id}
          parada={p}
          indice={i}
          ultimo={i === hoja.paradas.length - 1}
          ordenEditable={ordenEditable}
          instruccionesEditables={instruccionesEditables}
          conCobranza={conCobranza}
          ocupado={ocupado}
          onMover={mover}
          onPatch={patch}
        />
      ))}

      {/* Parada sin pedido: pasar solo a cobrar */}
      {ordenEditable && conCobranza && (
        <div className="rounded-md border border-dashed p-3">
          <p className="mb-2 text-sm font-medium">Agregar un cliente sin pedido (pasar solo a cobrar)</p>
          <div className="flex gap-2">
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && buscarCliente()}
              placeholder="Buscar cliente por nombre, código o CUIT"
            />
            <Button variant="outline" onClick={buscarCliente}><Search className="h-4 w-4" /></Button>
          </div>
          {resultados.length > 0 && (
            <div className="mt-2 divide-y rounded-md border">
              {resultados.map((c) => (
                <button
                  key={c.id}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    setResultados([])
                    setBusqueda("")
                    patch({ agregar_cliente_id: c.id })
                  }}
                >
                  <span>{c.nombre_razon_social || c.razon_social || c.nombre}</span>
                  <span className="text-xs text-muted-foreground">{c.localidad}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Dato({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${destacado ? "border-red-200 bg-red-50" : "bg-white"}`}>
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className={`text-lg font-semibold ${destacado ? "text-red-700" : ""}`}>{valor}</p>
    </div>
  )
}

function Parada({
  parada: p, indice, ultimo, ordenEditable, instruccionesEditables, conCobranza, ocupado, onMover, onPatch,
}: {
  parada: ParadaHoja
  indice: number
  ultimo: boolean
  ordenEditable: boolean
  instruccionesEditables: boolean
  conCobranza: boolean
  ocupado: boolean
  onMover: (i: number, delta: number) => void
  onPatch: (body: any, silencioso?: boolean) => void
}) {
  const [nota, setNota] = useState(p.nota_oficina || "")
  const [motivoBloqueo, setMotivoBloqueo] = useState(p.motivo_bloqueo || "")
  const est = ESTADO_PARADA[p.estado] || ESTADO_PARADA.pendiente

  return (
    <div className={`rounded-lg border bg-white ${p.bloquear_entrega ? "border-red-300" : ""}`}>
      <div className="flex items-start gap-3 p-3">
        {/* Orden */}
        <div className="flex flex-col items-center gap-0.5 pt-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" disabled={!ordenEditable || ocupado || indice === 0} onClick={() => onMover(indice, -1)}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{indice + 1}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" disabled={!ordenEditable || ocupado || ultimo} onClick={() => onMover(indice, 1)}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          {/* Cliente */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold">{p.cliente_nombre}</p>
              <p className="text-sm text-muted-foreground">
                {[p.direccion, p.localidad].filter(Boolean).join(" · ") || "Sin dirección"}
                {p.telefono && <span className="ml-2 inline-flex items-center gap-1"><Phone className="h-3 w-3" />{p.telefono}</span>}
              </p>
              {p.vendedores.length > 0 && <p className="text-xs text-muted-foreground">Vendedor: {p.vendedores.join(", ")}</p>}
            </div>
            <div className="flex items-center gap-2">
              {p.bloquear_entrega && <Badge className="bg-red-600 text-white"><Lock className="mr-1 h-3 w-3" />NO ENTREGAR SIN COBRAR</Badge>}
              <Badge className={est.cls}>{est.label}</Badge>
              {ordenEditable && p.pedidos.length === 0 && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => onPatch({ quitar_parada_id: p.id })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Pedidos */}
          {p.pedidos.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {p.pedidos.map((ped) => (
                <span key={ped.id} className="inline-flex items-center gap-1.5 rounded border bg-slate-50 px-2 py-0.5 text-xs">
                  <span className="font-semibold">#{ped.numero}</span>
                  <span className="text-muted-foreground">{ESTADO_LABEL[ped.estado] || ped.estado}</span>
                  <span className="inline-flex items-center gap-0.5"><Package className="h-3 w-3" />{ped.bultos}</span>
                  {ped.comprobantes.map((c) => <span key={c.id} className="text-slate-500">{c.tipo} {c.numero}</span>)}
                  {ped.remitos.length === 0 && <span className="text-amber-600">sin remito</span>}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs italic text-muted-foreground">Sin mercadería: pasar solo a cobrar</p>
          )}

          {/* Importes */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-5">
            <Importe etiqueta="Bultos" valor={String(p.bultos)} />
            <Importe etiqueta="Este viaje" valor={formatCurrency(p.total_viaje)} />
            {conCobranza && <Importe etiqueta="Saldo anterior" valor={formatCurrency(p.saldo_anterior)} alerta={p.saldo_anterior > 0.01} />}
            {conCobranza && <Importe etiqueta="Total a cobrar" valor={formatCurrency(p.total_a_cobrar)} />}
            {conCobranza && p.minimo_exigido > 0 && <Importe etiqueta="Cobrar sí o sí" valor={formatCurrency(p.minimo_exigido)} alerta />}
          </div>

          {/* Instrucción de oficina */}
          {conCobranza && (
            <div className="space-y-2 rounded-md bg-slate-50 p-2.5">
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    disabled={!instruccionesEditables || ocupado}
                    checked={p.exigir_cobro_anterior}
                    onCheckedChange={(c) => onPatch({ parada_id: p.id, exigir_cobro_anterior: Boolean(c) }, true)}
                  />
                  Cobrar sí o sí lo anterior
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    disabled={!instruccionesEditables || ocupado}
                    checked={p.exigir_cobro_actual}
                    onCheckedChange={(c) => onPatch({ parada_id: p.id, exigir_cobro_actual: Boolean(c) }, true)}
                  />
                  Cobrar sí o sí lo de este viaje
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-red-700">
                  <Checkbox
                    disabled={!instruccionesEditables || ocupado}
                    checked={p.bloquear_entrega}
                    onCheckedChange={(c) => onPatch({ parada_id: p.id, bloquear_entrega: Boolean(c), motivo_bloqueo: motivoBloqueo }, true)}
                  />
                  Bloquear entrega sin cobro
                </label>
              </div>
              {p.bloquear_entrega && (
                <Input
                  className="h-8 bg-white text-sm"
                  disabled={!instruccionesEditables}
                  value={motivoBloqueo}
                  onChange={(e) => setMotivoBloqueo(e.target.value)}
                  onBlur={() => motivoBloqueo !== (p.motivo_bloqueo || "") && onPatch({ parada_id: p.id, motivo_bloqueo: motivoBloqueo }, true)}
                  placeholder="Motivo del bloqueo (lo ve el chofer)"
                />
              )}
              <Input
                className="h-8 bg-white text-sm"
                disabled={!instruccionesEditables}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                onBlur={() => nota !== (p.nota_oficina || "") && onPatch({ parada_id: p.id, nota_oficina: nota }, true)}
                placeholder="Nota para el chofer (horario, por dónde entrar, con quién hablar…)"
              />
            </div>
          )}

          {/* Resultado en la calle */}
          {p.estado !== "pendiente" && (
            <div className="rounded-md border border-slate-200 p-2.5 text-sm">
              <p>
                <span className="font-medium">Resultado:</span> {est.label}
                {p.bultos_entregados != null && <> · {p.bultos_entregados}/{p.bultos} bultos</>}
                {conCobranza && <> · cobrado {formatCurrency(p.cobrado)}</>}
                {p.devuelto > 0 && <> · devolución {formatCurrency(p.devuelto)}</>}
              </p>
              {p.motivo_no_entrega && <p className="text-amber-700">No se entregó: {p.motivo_no_entrega}</p>}
              {p.motivo_no_cobro && <p className="text-red-700">No se cobró lo exigido: {p.motivo_no_cobro}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Importe({ etiqueta, valor, alerta }: { etiqueta: string; valor: string; alerta?: boolean }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{etiqueta}</span>
      <p className={`font-medium ${alerta ? "text-red-700" : ""}`}>{valor}</p>
    </div>
  )
}
