"use client"

// Segmentación por PROVEEDOR y por MARCA.
// Lista, método y contado vacíos ("Hereda") toman lo del pedido / la ficha.
// Buscás (multi-selección) uno o más proveedores / marcas y a cada uno le asignás
// lista, facturación y descuentos (general / viajante / mercadería) propios. Cada
// segmento se factura en comprobante aparte. La lista "especial" sólo aparece si ese
// proveedor / marca tiene artículos con precio especial cargado.
//
// Controlado: recibe value { proveedor[], marca[] } y reporta onChange.

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { localMatch } from "@/lib/search/local-match"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"

export type CondRow = {
  ref_id: string                       // proveedor_id | marca_id
  nombre: string
  lista_precio_id: string | null       // null = hereda la lista del pedido
  metodo_facturacion: string | null    // 'Factura' | 'Final' | 'Presupuesto' · null = hereda
  dto_general_pct: number | null
  dto_viajante_pct: number | null
  dto_mercaderia_pct: number | null
  contado?: boolean | null             // true = sale con 10% contado · null = hereda
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
    contado: r.contado ?? null,
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
    contado: r.contado ?? null,
  }))
}

type LP = { id: string; nombre: string; codigo?: string }
type Opcion = { id: string; nombre: string }

const METODOS = [
  { value: "Factura",     label: "Factura"       },
  { value: "Final",       label: "Final (Mixto)" },
  { value: "Presupuesto", label: "Presupuesto"   },
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
      lista_precio_id: null, metodo_facturacion: null,
      dto_general_pct: null, dto_viajante_pct: null, dto_mercaderia_pct: null, contado: null,
    }])
    setSearch("")
  }
  const update = (refId: string, patch: Partial<CondRow>) =>
    onChangeRows(rows.map(r => r.ref_id === refId ? { ...r, ...patch } : r))
  const remove = (refId: string) => onChangeRows(rows.filter(r => r.ref_id !== refId))

  const disponibles = opciones
    .filter(o => !rows.some(r => r.ref_id === o.id))
    .filter(o => !search || localMatch(search, o.nombre))
    .slice(0, 40)

  return (
    <div className="rounded-xl border border-neutro-200 bg-neutro-50/60 p-3 space-y-2.5 sm:p-4">
      <div>
        <p className="text-sm font-bold text-azul-900">{titulo}</p>
        {ayuda && <p className="text-xs text-neutro-500">{ayuda}</p>}
      </div>

      {/* Seleccionados con su condición */}
      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map(r => {
            const ofreceEspecial = conEspecial.has(r.ref_id) && !!especialLista
            return (
              <div key={r.ref_id} className="rounded-lg border border-neutro-200 bg-white p-3 space-y-2.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-azul-900">{r.nombre}</span>
                  <button type="button" aria-label={`Quitar ${r.nombre}`} className="grid size-7 place-items-center rounded-md text-neutro-400 hover:bg-error-50 hover:text-error-600" onClick={() => remove(r.ref_id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-neutro-600">Lista</label>
                    <Select value={r.lista_precio_id ?? "__none__"} onValueChange={v => update(r.ref_id, { lista_precio_id: v === "__none__" ? null : v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Lista" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Hereda (lista del pedido)</SelectItem>
                        {listasNormales.map(l => <SelectItem key={l.id} value={l.id}>{l.nombre}</SelectItem>)}
                        {ofreceEspecial && <SelectItem value={especialLista!.id}>Especial</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-neutro-600">Facturación</label>
                    <Select value={r.metodo_facturacion || "__none__"} onValueChange={v => update(r.ref_id, { metodo_facturacion: v === "__none__" ? null : v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Hereda (método del pedido)</SelectItem>
                        {METODOS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <DtoInput label="General %"    value={r.dto_general_pct}    onChange={n => update(r.ref_id, { dto_general_pct: n })} />
                  <DtoInput label="Viajante %"   value={r.dto_viajante_pct}   onChange={n => update(r.ref_id, { dto_viajante_pct: n })} />
                  <DtoInput label="Mercadería %" value={r.dto_mercaderia_pct} onChange={n => update(r.ref_id, { dto_mercaderia_pct: n })} />
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-neutro-600">Contado 10%</label>
                    <Select value={r.contado === true ? "si" : r.contado === false ? "no" : "__none__"} onValueChange={v => update(r.ref_id, { contado: v === "si" ? true : v === "no" ? false : null })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Hereda</SelectItem>
                        <SelectItem value="si">Sí</SelectItem>
                        <SelectItem value="no">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-neutro-400">Vacío = hereda lo del pedido / la ficha.</p>
              </div>
            )
          })}
        </div>
      )}

      {/* Buscador */}
      <Input
        className="h-9 bg-white text-sm"
        placeholder={`+ Agregar ${titulo.toLowerCase().replace("segmentar por ", "")}: escribí para buscar…`}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {search.trim() !== "" && (
        <div className="max-h-40 overflow-auto space-y-0.5 rounded-lg border border-neutro-200 bg-white p-1">
          {disponibles.length === 0
            ? <p className="text-xs text-neutro-400 px-1">Sin resultados</p>
            : disponibles.map(o => (
              <button key={o.id} type="button" onClick={() => add(o)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-azul-50 text-sm font-medium text-neutro-700 flex items-center justify-between">
                <span>{o.nombre}{conEspecial.has(o.id) && especialLista ? " · tiene especial" : ""}</span>
                <Plus className="h-4 w-4 text-azul-600" />
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
      <label className="mb-1 block text-xs font-semibold text-neutro-600">{label}</label>
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
