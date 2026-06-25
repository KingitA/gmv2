"use client"

// Segmentación por PROVEEDOR y por MARCA.
// Buscás (multi-selección) uno o más proveedores / marcas y a cada uno le asignás
// lista, facturación y descuentos (general / viajante / mercadería) propios. Cada
// segmento se factura en comprobante aparte. La lista "especial" sólo aparece si ese
// proveedor / marca tiene artículos con precio especial cargado.
//
// Controlado: recibe value { proveedor[], marca[] } y reporta onChange.

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"

export type CondRow = {
  ref_id: string                       // proveedor_id | marca_id
  nombre: string
  lista_precio_id: string | null
  metodo_facturacion: string           // 'Factura' | 'Presupuesto'
  dto_general_pct: number | null
  dto_viajante_pct: number | null
  dto_mercaderia_pct: number | null
}

export type SegmentacionValue = { proveedor: CondRow[]; marca: CondRow[] }

export const EMPTY_SEGMENTACION: SegmentacionValue = { proveedor: [], marca: [] }

// Conversores a los arrays que espera el backend (condiciones_proveedor / condiciones_marca).
export function condRowsToProveedor(rows: CondRow[]) {
  return rows.map(r => ({
    proveedor_id: r.ref_id,
    lista_precio_id: r.lista_precio_id,
    metodo_facturacion: r.metodo_facturacion,
    dto_general_pct: r.dto_general_pct,
    dto_viajante_pct: r.dto_viajante_pct,
    dto_mercaderia_pct: r.dto_mercaderia_pct,
  }))
}
export function condRowsToMarca(rows: CondRow[]) {
  return rows.map(r => ({
    marca_id: r.ref_id,
    lista_precio_id: r.lista_precio_id,
    metodo_facturacion: r.metodo_facturacion,
    dto_general_pct: r.dto_general_pct,
    dto_viajante_pct: r.dto_viajante_pct,
    dto_mercaderia_pct: r.dto_mercaderia_pct,
  }))
}

type LP = { id: string; nombre: string; codigo?: string }
type Opcion = { id: string; nombre: string }

const METODOS = [
  { value: "Factura",     label: "Factura"     },
  { value: "Presupuesto", label: "Presupuesto" },
]

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function SegmentacionCondiciones({
  listas,
  value,
  onChange,
}: {
  listas: LP[]
  value: SegmentacionValue
  onChange: (next: SegmentacionValue) => void
}) {
  const sb = createClient()
  const [proveedores, setProveedores] = useState<Opcion[]>([])
  const [marcas, setMarcas]           = useState<Opcion[]>([])
  const [provConEspecial, setProvConEspecial]   = useState<Set<string>>(new Set())
  const [marcaConEspecial, setMarcaConEspecial] = useState<Set<string>>(new Set())

  useEffect(() => {
    sb.from("proveedores").select("id,nombre").order("nombre")
      .then(({ data }: any) => setProveedores((data || []).filter((p: any) => p.nombre)))
    sb.from("marcas").select("id,descripcion").eq("activo", true).order("descripcion")
      .then(({ data }: any) => setMarcas((data || []).map((m: any) => ({ id: m.id, nombre: m.descripcion })).filter((m: Opcion) => m.nombre)))
    sb.from("articulos").select("proveedor_id, marca_id").not("precio_lista_especial", "is", null)
      .then(({ data }: any) => {
        const ps = new Set<string>(); const ms = new Set<string>()
        for (const a of (data || [])) { if (a.proveedor_id) ps.add(a.proveedor_id); if (a.marca_id) ms.add(a.marca_id) }
        setProvConEspecial(ps); setMarcaConEspecial(ms)
      })
  }, [])

  const listasNormales = useMemo(() => listas.filter(l => l.codigo !== "especial"), [listas])
  const especialLista  = useMemo(() => listas.find(l => l.codigo === "especial"), [listas])

  return (
    <div className="space-y-4">
      <Seccion
        titulo="Segmentar por proveedor"
        opciones={proveedores}
        conEspecial={provConEspecial}
        rows={value.proveedor}
        listasNormales={listasNormales}
        especialLista={especialLista}
        onChangeRows={rows => onChange({ ...value, proveedor: rows })}
      />
      <Seccion
        titulo="Segmentar por marca"
        ayuda="La marca gana sobre el proveedor si un artículo cae en ambos."
        opciones={marcas}
        conEspecial={marcaConEspecial}
        rows={value.marca}
        listasNormales={listasNormales}
        especialLista={especialLista}
        onChangeRows={rows => onChange({ ...value, marca: rows })}
      />
    </div>
  )
}

function Seccion({
  titulo, ayuda, opciones, conEspecial, rows, listasNormales, especialLista, onChangeRows,
}: {
  titulo: string
  ayuda?: string
  opciones: Opcion[]
  conEspecial: Set<string>
  rows: CondRow[]
  listasNormales: LP[]
  especialLista?: LP
  onChangeRows: (rows: CondRow[]) => void
}) {
  const [search, setSearch] = useState("")

  const add = (o: Opcion) => {
    if (rows.some(r => r.ref_id === o.id)) return
    onChangeRows([...rows, {
      ref_id: o.id, nombre: o.nombre,
      lista_precio_id: null, metodo_facturacion: "Factura",
      dto_general_pct: null, dto_viajante_pct: null, dto_mercaderia_pct: null,
    }])
    setSearch("")
  }
  const update = (refId: string, patch: Partial<CondRow>) =>
    onChangeRows(rows.map(r => r.ref_id === refId ? { ...r, ...patch } : r))
  const remove = (refId: string) => onChangeRows(rows.filter(r => r.ref_id !== refId))

  const disponibles = opciones
    .filter(o => !rows.some(r => r.ref_id === o.id))
    .filter(o => !search || o.nombre.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 40)

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/40 px-3 py-3 space-y-2">
      <p className="text-xs font-bold text-teal-700 uppercase tracking-wide">{titulo}</p>
      {ayuda && <p className="text-[11px] text-slate-500">{ayuda}</p>}

      {/* Seleccionados con su condición */}
      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map(r => {
            const ofreceEspecial = conEspecial.has(r.ref_id) && !!especialLista
            return (
              <div key={r.ref_id} className="rounded-md border border-teal-300 bg-white p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">{r.nombre}</span>
                  <button type="button" className="text-red-400 hover:text-red-600" onClick={() => remove(r.ref_id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Lista</label>
                    <Select value={r.lista_precio_id ?? "__none__"} onValueChange={v => update(r.ref_id, { lista_precio_id: v === "__none__" ? null : v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Lista" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Lista del segmento general</SelectItem>
                        {listasNormales.map(l => <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>)}
                        {ofreceEspecial && <SelectItem value={especialLista!.id}>Especial</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">Facturación</label>
                    <Select value={r.metodo_facturacion} onValueChange={v => update(r.ref_id, { metodo_facturacion: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {METODOS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <DtoInput label="General %"    value={r.dto_general_pct}    onChange={n => update(r.ref_id, { dto_general_pct: n })} />
                  <DtoInput label="Viajante %"   value={r.dto_viajante_pct}   onChange={n => update(r.ref_id, { dto_viajante_pct: n })} />
                  <DtoInput label="Mercadería %" value={r.dto_mercaderia_pct} onChange={n => update(r.ref_id, { dto_mercaderia_pct: n })} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Buscador */}
      <Input
        className="h-8 text-xs"
        placeholder={`Buscar ${titulo.toLowerCase().replace("segmentar por ", "")}...`}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {search.trim() !== "" && (
        <div className="max-h-40 overflow-auto space-y-1">
          {disponibles.length === 0
            ? <p className="text-[11px] text-slate-400 px-1">Sin resultados</p>
            : disponibles.map(o => (
              <button key={o.id} type="button" onClick={() => add(o)}
                className="w-full text-left px-3 py-1.5 rounded hover:bg-teal-50 text-xs font-medium text-slate-700 flex items-center justify-between">
                <span>{o.nombre}{conEspecial.has(o.id) && especialLista ? " · tiene especial" : ""}</span>
                <Plus className="h-3.5 w-3.5 text-teal-600" />
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

function DtoInput({ label, value, onChange }: { label: string; value: number | null; onChange: (n: number | null) => void }) {
  return (
    <div>
      <label className="text-[10px] text-slate-500 uppercase">{label}</label>
      <Input
        type="number" inputMode="decimal" min={0} max={100}
        className="h-8 text-xs"
        value={value ?? ""}
        onChange={e => onChange(numOrNull(e.target.value))}
        placeholder="0"
      />
    </div>
  )
}
