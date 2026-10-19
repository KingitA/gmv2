import { useMemo, useState } from "react"
import { numero, parseMonto } from "@gm/formato"
import type { CondicionMarca, CondicionProveedor, CondicionSegmento } from "@gm/pricing"
import { useCatalogo, useProveedores } from "../../datos/hooks"

// Condiciones por PROVEEDOR o MARCA solo para este pedido (= ERP, SegmentacionCondiciones):
// a la mercadería de ese proveedor/marca se le aplica otra lista, otro método y/o otros
// descuentos. Lo vacío "hereda" del pedido. Marca gana sobre proveedor. La lista que se arma
// acá es la COMPLETA del pedido: sacar una = este pedido sin esa condición.

const METODOS = [
  { key: "", label: "Del pedido" },
  { key: "Factura", label: "Factura" },
  { key: "Final", label: "Final" },
  { key: "Presupuesto", label: "Presupuesto" },
]
const sel = "w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm"

type Fila = CondicionSegmento & { ref: string; tipo: "prov" | "marca" }

export function CondicionesProvMarca({ prov, marca, onProv, onMarca, listas, puedeLista }: {
  prov: CondicionProveedor[]
  marca: CondicionMarca[]
  onProv: (v: CondicionProveedor[]) => void
  onMarca: (v: CondicionMarca[]) => void
  listas: Array<{ id: string; nombre: string }>
  puedeLista: boolean
}) {
  const proveedores = useProveedores()
  const { indice } = useCatalogo()
  const [agregando, setAgregando] = useState<"" | "prov" | "marca">("")
  // Marcas del catálogo (id → nombre) para elegir
  const marcas = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of indice.articulos) if (a.marca_id && a.marca) m.set(a.marca_id, a.marca)
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
  }, [indice])
  const nombreProv = (id: string) => proveedores.find((p) => p.id === id)?.nombre ?? "Proveedor"
  const nombreMarca = (id: string) => marcas.find((m) => m.id === id)?.nombre ?? "Marca"

  const filas: Fila[] = [
    ...prov.map((c) => ({ ...c, ref: c.proveedor_id, tipo: "prov" as const })),
    ...marca.map((c) => ({ ...c, ref: c.marca_id, tipo: "marca" as const })),
  ]
  const cambiar = (f: Fila, cambios: Partial<CondicionSegmento> | null) => {
    if (f.tipo === "prov") onProv(cambios === null ? prov.filter((c) => c.proveedor_id !== f.ref) : prov.map((c) => (c.proveedor_id === f.ref ? { ...c, ...cambios } : c)))
    else onMarca(cambios === null ? marca.filter((c) => c.marca_id !== f.ref) : marca.map((c) => (c.marca_id === f.ref ? { ...c, ...cambios } : c)))
  }
  const vacia: CondicionSegmento = { lista_precio_id: null, metodo_facturacion: null, dto_general_pct: null, dto_viajante_pct: null, dto_mercaderia_pct: null, contado: null }
  const agregar = (tipo: "prov" | "marca", id: string) => {
    if (!id) return
    if (tipo === "prov" && !prov.some((c) => c.proveedor_id === id)) onProv([...prov, { ...vacia, proveedor_id: id }])
    if (tipo === "marca" && !marca.some((c) => c.marca_id === id)) onMarca([...marca, { ...vacia, marca_id: id }])
    setAgregando("")
  }
  const pct = (v: number | null) => (v == null ? "" : numero(v, 0, 2))
  const leerPct = (t: string): number | null => {
    if (!t.trim()) return null
    const n = parseMonto(t)
    return n == null || !Number.isFinite(n) ? null : Math.max(0, Math.min(100, n))
  }

  return (
    <div className="space-y-3 rounded-xl bg-gray-50 p-4">
      <div>
        <p className="text-sm font-bold text-gray-700">Condiciones por proveedor o marca</p>
        <p className="text-xs text-gray-400">Solo este pedido. Lo vacío sale como el resto del pedido. Arranca con las de la ficha del cliente.</p>
      </div>
      {filas.length === 0 && <p className="text-xs text-gray-500">Sin condiciones especiales.</p>}
      {filas.map((f) => (
        <div key={`${f.tipo}:${f.ref}`} className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-bold text-gray-900">{f.tipo === "prov" ? `Proveedor ${nombreProv(f.ref)}` : `Marca ${nombreMarca(f.ref)}`}</p>
            <button onClick={() => cambiar(f, null)} className="h-9 w-9 shrink-0 rounded-full text-lg text-red-500" aria-label="Quitar condición">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={f.lista_precio_id ?? ""} onChange={(e) => cambiar(f, { lista_precio_id: e.target.value || null })} disabled={!puedeLista} className={sel} aria-label="Lista">
              <option value="">Lista del pedido</option>
              {listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
            <select value={f.metodo_facturacion ?? ""} onChange={(e) => cambiar(f, { metodo_facturacion: e.target.value || null })} className={sel} aria-label="Facturación">
              {METODOS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-4 gap-1.5 text-center text-[10px] font-bold uppercase text-gray-400">
            {(["dto_general_pct", "dto_viajante_pct", "dto_mercaderia_pct"] as const).map((k) => (
              <label key={k} className="space-y-0.5">
                <span>{k === "dto_general_pct" ? "General" : k === "dto_viajante_pct" ? "Viajante" : "Mercad."}</span>
                <input defaultValue={pct(f[k])} onBlur={(e) => cambiar(f, { [k]: leerPct(e.target.value) } as Partial<CondicionSegmento>)} inputMode="decimal" placeholder="—" className="w-full rounded-lg border border-gray-300 bg-white py-2 text-right text-sm font-bold text-gray-900" />
              </label>
            ))}
            <label className="space-y-0.5">
              <span>Ctdo</span>
              <select value={f.contado == null ? "" : f.contado ? "si" : "no"} onChange={(e) => cambiar(f, { contado: e.target.value === "" ? null : e.target.value === "si" })} className="w-full rounded-lg border border-gray-300 bg-white py-2 text-sm">
                <option value="">—</option><option value="si">Sí</option><option value="no">No</option>
              </select>
            </label>
          </div>
        </div>
      ))}
      {agregando ? (
        <select autoFocus defaultValue="" onChange={(e) => agregar(agregando, e.target.value)} onBlur={() => setAgregando("")} className={`${sel} py-3`}>
          <option value="">{agregando === "prov" ? "Elegí el proveedor…" : "Elegí la marca…"}</option>
          {(agregando === "prov" ? proveedores : marcas).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
        </select>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setAgregando("prov")} className="min-h-11 rounded-lg border border-gray-300 bg-white text-xs font-bold text-gray-700">+ Proveedor</button>
          <button onClick={() => setAgregando("marca")} className="min-h-11 rounded-lg border border-gray-300 bg-white text-xs font-bold text-gray-700">+ Marca</button>
        </div>
      )}
    </div>
  )
}
