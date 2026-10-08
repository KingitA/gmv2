"use client"

// Panel ÚNICO de condiciones al tomar un pedido en el ERP (importación, alta
// manual y mostrador): lista y facturación (general o por segmento), descuentos
// general / viajante / mercadería y contado (general o por segmento),
// segmentación por proveedor / marca, mercadería a regalar por cupo, y si los
// cambios van "solo a este pedido" o "a la ficha del cliente".
// Lógica pura: lib/pedidos/condiciones-form.ts.

import { useCallback, useEffect, useMemo, useState, useRef } from "react"
import { useDentroDeModal } from "@/lib/hooks/use-dentro-de-modal"
import { createClient } from "@/lib/supabase/client"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, X, AlertTriangle } from "lucide-react"
import { ArticuloResultRow } from "@/components/search/ArticuloResultRow"
import { SegmentacionCondiciones, type CondRow } from "@/components/pedidos/SegmentacionCondiciones"
import { guardarFichaComercial, guardarSegmentacionCliente } from "@/lib/actions/condiciones-cliente"
import {
  SEGS, SEG_LABEL, TIPOS_DESC,
  formDesdeFicha, cambioVsFicha, faltaLista, cuposPosibles, cuposSinArticulos,
  condicionesParaPedido, listasParaFicha, descuentosParaFicha, segmentacionParaFicha,
  type CondicionesForm, type FichaComercial, type ArticuloElegido,
} from "@/lib/pedidos/condiciones-form"

type LP = { id: string; nombre: string; codigo?: string }
export type AlcanceCondiciones = "pedido" | "ficha" | null

const METODOS = [
  { value: "Factura", label: "Factura (21% IVA)" },
  { value: "Final", label: "Final (Mixto)" },
  { value: "Presupuesto", label: "Presupuesto" },
]
const TIPO_UI: Record<string, { label: string; cls: string }> = {
  general: { label: "General", cls: "text-blue-700 bg-blue-50 border-blue-200" },
  viajante: { label: "Viajante", cls: "text-orange-700 bg-orange-50 border-orange-200" },
  mercaderia: { label: "Mercadería", cls: "text-green-700 bg-green-50 border-green-200" },
}

/** Carga la ficha comercial de un cliente y maneja el formulario de condiciones. */
export function useCondicionesPedido(clienteId: string | null | undefined) {
  const [ficha, setFicha] = useState<FichaComercial | null>(null)
  const [form, setForm] = useState<CondicionesForm | null>(null)
  const [listas, setListas] = useState<LP[]>([])
  const [alcance, setAlcance] = useState<AlcanceCondiciones>(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    const sb = createClient()
    sb.from("listas_precio").select("id,nombre,codigo").eq("activo", true).order("nombre")
      .then(({ data }: any) => setListas(data || []))
  }, [])

  useEffect(() => {
    setAlcance(null)
    if (!clienteId) { setFicha(null); setForm(null); return }
    let vivo = true
    setCargando(true)
    const sb = createClient()
    Promise.all([
      sb.from("clientes")
        .select("metodo_facturacion, lista_precio_id, lista_limpieza_id, metodo_limpieza, lista_perf0_id, metodo_perf0, lista_perf_plus_id, metodo_perf_plus")
        .eq("id", clienteId).single(),
      sb.from("bonificaciones").select("tipo, segmento, porcentaje, proveedor_id")
        .eq("cliente_id", clienteId).eq("activo", true).in("tipo", ["general", "viajante", "mercaderia", "contado"]),
      sb.from("cliente_proveedor_condicion")
        .select("proveedor_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, contado, proveedores:proveedor_id(nombre)")
        .eq("cliente_id", clienteId).order("created_at"),
      sb.from("cliente_marca_condicion")
        .select("marca_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, contado, marcas:marca_id(descripcion)")
        .eq("cliente_id", clienteId).order("created_at"),
    ]).then(([cli, bonif, prov, marca]: any[]) => {
      if (!vivo) return
      const fila = (r: any, ref: string, nombre: string): CondRow => ({
        ref_id: ref, nombre,
        lista_precio_id: r.lista_precio_id, metodo_facturacion: r.metodo_facturacion,
        dto_general_pct: r.dto_general_pct, dto_viajante_pct: r.dto_viajante_pct, dto_mercaderia_pct: r.dto_mercaderia_pct,
        contado: r.contado ?? null,
      })
      const f: FichaComercial = {
        cliente: cli.data || {},
        bonificaciones: (bonif.data || []).filter((b: any) => !b.proveedor_id),
        proveedor: (prov.data || []).map((r: any) => fila(r, r.proveedor_id, r.proveedores?.nombre || "—")),
        marca: (marca.data || []).map((r: any) => fila(r, r.marca_id, r.marcas?.descripcion || "—")),
      }
      setFicha(f)
      setForm(formDesdeFicha(f))
    }).finally(() => vivo && setCargando(false))
    return () => { vivo = false }
  }, [clienteId])

  const cambio = !!(ficha && form && cambioVsFicha(form, ficha))
  const errorLista = form ? faltaLista(form) : null
  const sinArticulos = form ? cuposSinArticulos(form) : []

  /** Parámetros para createPedido (solo si el formulario está listo). */
  const condiciones = useCallback(() => (form ? condicionesParaPedido(form, cambio) : {}), [form, cambio])

  /** Si el usuario eligió "guardar en la ficha", la actualiza (llamar ANTES de crear el pedido). */
  const guardarFichaSiCorresponde = useCallback(async () => {
    if (!clienteId || !form || !cambio || alcance !== "ficha") return
    await guardarFichaComercial(clienteId, { listas: listasParaFicha(form), descuentos: descuentosParaFicha(form) })
    await guardarSegmentacionCliente(clienteId, segmentacionParaFicha(form))
  }, [clienteId, form, cambio, alcance])

  /** null = se puede tomar el pedido; si no, por qué no. */
  const bloqueo = !form ? "Elegí el cliente" : errorLista ? errorLista : cambio && !alcance ? "Indicá si los cambios van solo a este pedido o a la ficha del cliente" : null

  return { ficha, form, setForm, listas, alcance, setAlcance, cargando, cambio, errorLista, sinArticulos, bloqueo, condiciones, guardarFichaSiCorresponde }
}

export type CondicionesPedidoState = ReturnType<typeof useCondicionesPedido>

function SegToggle({ on, set }: { on: boolean; set: (b: boolean) => void }) {
  return (
    <div className="flex rounded-md border border-slate-300 overflow-hidden shrink-0 text-[11px]">
      <button type="button" onClick={() => set(false)} className={`px-2 py-1.5 font-medium ${!on ? "bg-indigo-600 text-white" : "bg-white text-slate-500"}`}>General</button>
      <button type="button" onClick={() => set(true)} className={`px-2 py-1.5 font-medium ${on ? "bg-indigo-600 text-white" : "bg-white text-slate-500"}`}>Por segmento</button>
    </div>
  )
}

function Pct({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Input type="number" step="0.01" min="0" max="100" className="h-6 w-14 text-center text-xs font-bold px-1"
        value={value || 0} onChange={(e) => onChange(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))} />
      <span className="text-[10px] text-slate-400">%</span>
    </div>
  )
}

function ContadoCheck({ checked, onChange }: { checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border text-purple-700 bg-purple-50 border-purple-200 cursor-pointer select-none">
      <input type="checkbox" className="h-3.5 w-3.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Contado 10%
    </label>
  )
}

/** Buscador de artículos a regalar para un cupo. */
function ElegirArticulos({ elegidos, onChange }: { elegidos: ArticuloElegido[]; onChange: (a: ArticuloElegido[]) => void }) {
  const [q, setQ] = useState("")
  const [res, setRes] = useState<any[]>([])
  const cajaRef = useRef<HTMLDivElement>(null)
  const enModal = useDentroDeModal(cajaRef, res.length > 0)
  const buscar = useCallback(async (t: string) => {
    setQ(t)
    if (t.trim().length < 2) { setRes([]); return }
    const { searchProductos } = await import("@/lib/actions/productos")
    setRes((await searchProductos(t)) || [])
  }, [])
  return (
    <div className="space-y-1.5">
      <div ref={cajaRef} className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-green-500" />
        <Input placeholder="Buscar artículo a regalar..." className="pl-8 h-8 text-xs" value={q} onChange={(e) => buscar(e.target.value)} />
        {res.length > 0 && (
          <div className={`${enModal ? "relative" : "absolute top-full left-0 z-50"} w-full bg-white border border-slate-200 rounded-lg shadow-lg mt-1 max-h-52 overflow-auto`}>
            {res.map((p: any) => (
              <button type="button" key={p.id}
                onClick={() => { if (!elegidos.some((a) => a.id === p.id)) onChange([...elegidos, { id: p.id, descripcion: p.descripcion || "", sku: p.sku || "" }]); setQ(""); setRes([]) }}
                className="w-full text-left px-3 py-2 hover:bg-green-50 border-b border-slate-100 last:border-0">
                <ArticuloResultRow articulo={p} size="sm" />
              </button>
            ))}
          </div>
        )}
      </div>
      {elegidos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {elegidos.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 text-[11px] bg-white border border-green-300 text-green-800 rounded px-2 py-0.5">
              {a.descripcion}
              <button type="button" onClick={() => onChange(elegidos.filter((x) => x.id !== a.id))} className="text-green-500 hover:text-green-700"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function CondicionesPedidoPanel({ estado, exigirMercaderia = false }: { estado: CondicionesPedidoState; exigirMercaderia?: boolean }) {
  const { form, setForm, listas, alcance, setAlcance, cargando, cambio, errorLista, ficha } = estado
  const listasNormales = useMemo(() => listas.filter((l) => l.codigo !== "especial"), [listas])
  const nombreLista = (id: string) => listas.find((l) => l.id === id)?.nombre || ""

  if (cargando || !form || !ficha) return <p className="text-xs text-slate-400">Cargando condiciones del cliente…</p>
  const set = (patch: Partial<CondicionesForm>) => setForm({ ...form, ...patch })
  const cupos = cuposPosibles(form)

  const listaGeneral = form.lista
  const listaHeredar = listaGeneral ? `General (${nombreLista(listaGeneral)})` : "General (sin lista)"
  const metodoHeredar = `General (${form.metodo || "Final"})`

  return (
    <div className="space-y-3">
      {errorLista && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs font-medium text-red-800">{errorLista}</p>
        </div>
      )}

      {/* LISTA */}
      <div className="flex items-center gap-2">
        <Label className="text-xs text-slate-600 w-20 shrink-0">Lista</Label>
        {!form.listaPorSegmento ? (
          <Select value={form.lista || "__none__"} onValueChange={(v) => set({ lista: v === "__none__" ? "" : v })}>
            <SelectTrigger className="h-9 text-sm flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sin lista</SelectItem>
              {listasNormales.map((l) => <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : <span className="flex-1 text-xs text-indigo-600 font-medium pl-1">Definida por segmento ↓</span>}
        <SegToggle on={form.listaPorSegmento} set={(b) => set({ listaPorSegmento: b })} />
      </div>

      {/* FACTURACIÓN */}
      <div className="flex items-center gap-2">
        <Label className="text-xs text-slate-600 w-20 shrink-0">Facturación</Label>
        {!form.metodoPorSegmento ? (
          <Select value={form.metodo || "Final"} onValueChange={(v) => set({ metodo: v })}>
            <SelectTrigger className="h-9 text-sm flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>{METODOS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
        ) : <span className="flex-1 text-xs text-indigo-600 font-medium pl-1">Definida por segmento ↓</span>}
        <SegToggle on={form.metodoPorSegmento} set={(b) => set({ metodoPorSegmento: b })} />
      </div>

      {/* DESCUENTOS + CONTADO */}
      <div className="flex items-start gap-2">
        <Label className="text-xs text-slate-600 w-20 shrink-0 pt-1.5">Descuentos</Label>
        {!form.descPorSegmento ? (
          <div className="flex-1 flex flex-wrap gap-2 items-center">
            {TIPOS_DESC.map((t) => (
              <div key={t} className="flex items-center gap-1">
                <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${TIPO_UI[t].cls}`}>{TIPO_UI[t].label}</span>
                <Pct value={form.desc[`todos__${t}`]} onChange={(n) => set({ desc: { ...form.desc, [`todos__${t}`]: n } })} />
              </div>
            ))}
            <ContadoCheck checked={!!form.contado.todos} onChange={(b) => set({ contado: { ...form.contado, todos: b } })} />
          </div>
        ) : <span className="flex-1 text-xs text-indigo-600 font-medium pl-1 pt-1.5">Definidos por segmento ↓</span>}
        <SegToggle on={form.descPorSegmento} set={(b) => set({ descPorSegmento: b })} />
      </div>

      {(form.listaPorSegmento || form.metodoPorSegmento || form.descPorSegmento) && (
        <div className="border border-indigo-200 rounded-lg overflow-hidden bg-indigo-50/30">
          <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest px-3 pt-2.5 pb-1">Condiciones por segmento</p>
          <div className="divide-y divide-slate-200">
            {SEGS.map((s) => (
              <div key={s} className="px-3 py-2.5 bg-white space-y-2">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{SEG_LABEL[s]}</p>
                <div className="grid grid-cols-2 gap-2">
                  {form.metodoPorSegmento && (
                    <Select value={form.metodos[s] || "__heredar__"} onValueChange={(v) => set({ metodos: { ...form.metodos, [s]: v === "__heredar__" ? "" : v } })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__heredar__">{metodoHeredar}</SelectItem>
                        {METODOS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {form.listaPorSegmento && (
                    <Select value={form.listas[s] || "__heredar__"} onValueChange={(v) => set({ listas: { ...form.listas, [s]: v === "__heredar__" ? "" : v } })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__heredar__">{listaHeredar}</SelectItem>
                        {listasNormales.map((l) => <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                {form.descPorSegmento && (
                  <div className="flex flex-wrap gap-2 items-center">
                    {TIPOS_DESC.map((t) => (
                      <div key={t} className="flex items-center gap-1">
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${TIPO_UI[t].cls}`}>{TIPO_UI[t].label}</span>
                        <Pct value={form.desc[`${s}__${t}`]} onChange={(n) => set({ desc: { ...form.desc, [`${s}__${t}`]: n } })} />
                      </div>
                    ))}
                    <ContadoCheck checked={!!form.contado[s]} onChange={(b) => set({ contado: { ...form.contado, [s]: b } })} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Proveedor / marca */}
      <SegmentacionCondiciones listas={listas} value={form.segmentacion} onChange={(v) => set({ segmentacion: v })} />

      {/* Mercadería a regalar por cupo */}
      {cupos.length > 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50/60 px-3 py-3 space-y-3">
          <div>
            <p className="text-sm font-semibold text-green-800">Mercadería bonificada</p>
            <p className="text-[11px] text-green-700">
              Elegí qué artículos regalar en cada cupo. Las unidades se calculan solas (% × neto del cupo) y quedan fijas al
              terminar el picking, sobre lo que realmente va.{" "}
              {exigirMercaderia ? "En mostrador hay que elegirlos ahora." : "Sin artículos elegidos el pedido queda pendiente y no se puede facturar."}
            </p>
          </div>
          {cupos.map((c) => (
            <div key={c.origen} className="space-y-1">
              <p className="text-xs font-semibold text-slate-700">{c.nombre} · {c.pct}%</p>
              <ElegirArticulos
                elegidos={form.mercaderia[c.origen] || []}
                onChange={(a) => set({ mercaderia: { ...form.mercaderia, [c.origen]: a } })}
              />
              {!(form.mercaderia[c.origen]?.length) && (
                <p className="text-[11px] text-amber-700">⚠ Sin artículos elegidos para este cupo.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Alcance de los cambios */}
      {cambio && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
          <p className="text-xs text-amber-700 font-semibold mb-2">Cambiaste las condiciones: ¿cómo se aplican?</p>
          <div className="flex gap-2">
            {([["pedido", "Solo este pedido"], ["ficha", "Guardar en la ficha del cliente"]] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setAlcance(v)}
                className={`flex-1 py-2 rounded border text-xs font-medium transition-all ${alcance === v ? "bg-amber-500 text-white border-amber-500" : "bg-white border-amber-300 text-amber-700 hover:bg-amber-50"}`}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-amber-700 mt-1.5">
            {alcance === "ficha"
              ? "Se guardan en la ficha y rigen para este pedido y los próximos. Los pedidos ya tomados no cambian."
              : "Solo este pedido: no afecta pedidos anteriores ni posteriores."}
          </p>
        </div>
      )}
    </div>
  )
}
