"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ArrowUp, ArrowDown, ChevronDown, Lock, Trash2, Search, Package, Phone } from "lucide-react"
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
    <div className="space-y-3">
      {/* Totales */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border bg-white px-3 py-2 text-sm">
        <span><b>{t.paradas}</b> clientes</span>
        <span><b>{t.pedidos}</b> pedidos</span>
        <span><b>{t.bultos}</b> bultos</span>
        <span>Este viaje <b>{formatCurrency(t.total_viaje)}</b></span>
        {conCobranza && <span>Saldos anteriores <b>{formatCurrency(t.saldo_anterior)}</b></span>}
        {conCobranza && <span>Total <b>{formatCurrency(t.total_a_cobrar)}</b></span>}
        {conCobranza && t.minimo_exigido > 0 && <span className="text-red-700">Cobrar sí o sí <b>{formatCurrency(t.minimo_exigido)}</b></span>}
        {t.resueltas > 0 && <span className="text-green-700"><b>{t.resueltas}</b>/{t.paradas} resueltas · cobrado <b>{formatCurrency(t.cobrado)}</b></span>}
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

      {hoja.paradas.length > 0 && (
        <div className="overflow-x-auto rounded-md border bg-white">
          <div className="min-w-[980px]">
            <div className={`grid ${conCobranza ? GRID_COBRANZA : GRID_TRANSPORTE} items-center gap-x-3 border-b bg-slate-50 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500`}>
              <span />
              <span>Cliente</span>
              <span>Pedidos</span>
              <span className="text-right">Bultos</span>
              <span className="text-right">Este viaje</span>
              {conCobranza && <span className="text-right">Saldo ant.</span>}
              {conCobranza && <span className="text-right">Total</span>}
              {conCobranza && <span>Instrucción</span>}
              <span>Estado</span>
              <span />
            </div>
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
          </div>
        </div>
      )}

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

// # | cliente | pedidos | bultos | este viaje | saldo ant | total | instrucción | estado | abrir
const GRID_COBRANZA = "grid-cols-[64px_minmax(180px,1.6fr)_minmax(110px,1fr)_52px_104px_104px_112px_218px_104px_24px]"
const GRID_TRANSPORTE = "grid-cols-[64px_minmax(200px,2fr)_minmax(140px,1.4fr)_60px_120px_110px_24px]"

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
  const [abierta, setAbierta] = useState(false)
  const [nota, setNota] = useState(p.nota_oficina || "")
  const [motivoBloqueo, setMotivoBloqueo] = useState(p.motivo_bloqueo || "")
  const est = ESTADO_PARADA[p.estado] || ESTADO_PARADA.pendiente
  const bloqueado = !instruccionesEditables || ocupado

  const pill = (activo: boolean, rojo = false) =>
    `rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4 transition-colors disabled:opacity-50 ${
      activo
        ? rojo ? "border-red-600 bg-red-600 text-white" : "border-slate-900 bg-slate-900 text-white"
        : "border-slate-300 bg-white text-slate-500 hover:border-slate-500"
    }`

  return (
    <div className={`border-b last:border-b-0 ${p.bloquear_entrega ? "bg-red-50/60" : p.estado !== "pendiente" ? "bg-slate-50/70" : ""}`}>
      <div className={`grid ${conCobranza ? GRID_COBRANZA : GRID_TRANSPORTE} items-center gap-x-3 px-2 py-1 text-sm`}>
        {/* Orden */}
        <div className="flex items-center">
          <button className="text-slate-400 hover:text-slate-800 disabled:opacity-20" disabled={!ordenEditable || ocupado || indice === 0} onClick={() => onMover(indice, -1)}>
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button className="text-slate-400 hover:text-slate-800 disabled:opacity-20" disabled={!ordenEditable || ocupado || ultimo} onClick={() => onMover(indice, 1)}>
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <span className="ml-1 w-5 text-right text-xs font-bold text-slate-700">{indice + 1}</span>
        </div>

        {/* Cliente */}
        <button className="min-w-0 text-left" onClick={() => setAbierta(!abierta)}>
          <span className="block truncate font-medium leading-5">{p.cliente_nombre}</span>
          <span className="block truncate text-xs leading-4 text-muted-foreground">
            {p.localidad || "Sin localidad"}
            {p.nota_oficina && <span className="ml-1.5 text-amber-700">📝 {p.nota_oficina}</span>}
          </span>
        </button>

        {/* Pedidos */}
        <span className="min-w-0 truncate text-xs text-slate-600" title={p.pedidos.map((x) => `#${x.numero} ${ESTADO_LABEL[x.estado] || x.estado}`).join(" · ")}>
          {p.pedidos.length === 0 ? (
            <i className="text-muted-foreground">solo cobro</i>
          ) : (
            p.pedidos.map((x) => (
              <span key={x.id} className={`mr-1.5 ${x.remitos.length === 0 || x.comprobantes.length === 0 ? "text-amber-700" : ""}`}>
                #{x.numero}
              </span>
            ))
          )}
        </span>

        <span className="text-right font-medium tabular-nums">{p.bultos}</span>
        <span className="text-right tabular-nums">{formatCurrency(p.total_viaje)}</span>
        {conCobranza && (
          <span className={`text-right tabular-nums ${p.saldo_anterior > 0.01 ? "font-medium text-red-700" : "text-slate-400"}`}>
            {Math.abs(p.saldo_anterior) > 0.01 ? formatCurrency(p.saldo_anterior) : "—"}
          </span>
        )}
        {conCobranza && <span className="text-right font-semibold tabular-nums">{formatCurrency(p.total_a_cobrar)}</span>}

        {/* Instrucción: cobrar sí o sí lo anterior / este viaje · candado */}
        {conCobranza && (
          <div className="flex items-center gap-1">
            <button
              className={pill(p.exigir_cobro_anterior)} disabled={bloqueado} title="Cobrar sí o sí lo anterior"
              onClick={() => onPatch({ parada_id: p.id, exigir_cobro_anterior: !p.exigir_cobro_anterior }, true)}
            >
              Cobrar ant.
            </button>
            <button
              className={pill(p.exigir_cobro_actual)} disabled={bloqueado} title="Cobrar sí o sí lo de este viaje"
              onClick={() => onPatch({ parada_id: p.id, exigir_cobro_actual: !p.exigir_cobro_actual }, true)}
            >
              Cobrar viaje
            </button>
            <button
              className={pill(p.bloquear_entrega, true)} disabled={bloqueado} title="No entregar sin cobrar"
              onClick={() => {
                onPatch({ parada_id: p.id, bloquear_entrega: !p.bloquear_entrega }, true)
                if (!p.bloquear_entrega) setAbierta(true)
              }}
            >
              <Lock className="inline h-3 w-3" />
            </button>
          </div>
        )}

        <span><Badge className={`${est.cls} px-1.5 py-0 text-[10px]`}>{est.label}</Badge></span>

        <button className="text-slate-400 hover:text-slate-800" onClick={() => setAbierta(!abierta)} title="Detalle, nota y resultado">
          <ChevronDown className={`h-4 w-4 transition-transform ${abierta ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Detalle */}
      {abierta && (
        <div className="space-y-2 border-t border-dashed bg-slate-50 px-3 py-2 pl-[76px] text-sm">
          <p className="text-xs text-muted-foreground">
            {[p.direccion, p.localidad].filter(Boolean).join(" · ") || "Sin dirección"}
            {p.telefono && <span className="ml-2 inline-flex items-center gap-1"><Phone className="h-3 w-3" />{p.telefono}</span>}
            {p.vendedores.length > 0 && <span className="ml-2">Vendedor: {p.vendedores.join(", ")}</span>}
          </p>

          {p.pedidos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {p.pedidos.map((ped) => (
                <span key={ped.id} className="inline-flex items-center gap-1.5 rounded border bg-white px-2 py-0.5 text-xs">
                  <span className="font-semibold">#{ped.numero}</span>
                  <span className="text-muted-foreground">{ESTADO_LABEL[ped.estado] || ped.estado}</span>
                  <span className="inline-flex items-center gap-0.5"><Package className="h-3 w-3" />{ped.bultos}</span>
                  {ped.comprobantes.map((c) => <span key={c.id} className="text-slate-500">{c.tipo} {c.numero}</span>)}
                  {ped.comprobantes.length === 0 && <span className="text-amber-700">sin facturar</span>}
                  {ped.remitos.length === 0 && <span className="text-amber-700">sin remito</span>}
                </span>
              ))}
            </div>
          )}

          {conCobranza && (
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                className="h-8 bg-white text-sm"
                disabled={!instruccionesEditables}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                onBlur={() => nota !== (p.nota_oficina || "") && onPatch({ parada_id: p.id, nota_oficina: nota }, true)}
                placeholder="Nota para el chofer (horario, por dónde entrar…)"
              />
              {p.bloquear_entrega && (
                <Input
                  className="h-8 border-red-300 bg-white text-sm"
                  disabled={!instruccionesEditables}
                  value={motivoBloqueo}
                  onChange={(e) => setMotivoBloqueo(e.target.value)}
                  onBlur={() => motivoBloqueo !== (p.motivo_bloqueo || "") && onPatch({ parada_id: p.id, motivo_bloqueo: motivoBloqueo }, true)}
                  placeholder="Motivo del bloqueo (lo ve el chofer)"
                />
              )}
            </div>
          )}

          {conCobranza && p.minimo_exigido > 0 && (
            <p className="text-xs font-medium text-red-700">Cobrar sí o sí: {formatCurrency(p.minimo_exigido)}</p>
          )}

          {p.estado !== "pendiente" && (
            <p className="text-xs">
              <b>Resultado:</b> {est.label}
              {p.bultos_entregados != null && <> · {p.bultos_entregados}/{p.bultos} bultos</>}
              {conCobranza && <> · cobrado {formatCurrency(p.cobrado)}</>}
              {p.devuelto > 0 && <> · devolución {formatCurrency(p.devuelto)}</>}
              {p.motivo_no_entrega && <span className="text-amber-700"> · No se entregó: {p.motivo_no_entrega}</span>}
              {p.motivo_no_cobro && <span className="text-red-700"> · No se cobró lo exigido: {p.motivo_no_cobro}</span>}
            </p>
          )}

          {ordenEditable && p.pedidos.length === 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-red-600" onClick={() => onPatch({ quitar_parada_id: p.id })}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Quitar de la hoja
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
