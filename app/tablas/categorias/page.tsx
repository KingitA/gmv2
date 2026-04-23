"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChevronDown, ChevronRight, Plus, Trash2, Pencil, Check, X } from "lucide-react"

type Rubro = { id: string; nombre: string; slug: string }
type Categoria = { id: string; rubro_id: string; nombre: string }
type Subcategoria = { id: string; categoria_id: string; nombre: string }

const RUBRO_COLORS: Record<string, { bg: string; border: string; header: string; dot: string }> = {
  limpieza: { bg: "bg-sky-50", border: "border-sky-200", header: "bg-sky-100 text-sky-800", dot: "bg-sky-500" },
  bazar:    { bg: "bg-amber-50", border: "border-amber-200", header: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  perfumeria: { bg: "bg-purple-50", border: "border-purple-200", header: "bg-purple-100 text-purple-800", dot: "bg-purple-500" },
}

export default function CategoriasPage() {
  const sb = createClient()
  const [rubros, setRubros] = useState<Rubro[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [subcategorias, setSubcategorias] = useState<Subcategoria[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRubros, setExpandedRubros] = useState<Set<string>>(new Set())
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())

  // Inline add/edit state
  const [addingCat, setAddingCat] = useState<string | null>(null)      // rubro_id
  const [addingSubcat, setAddingSubcat] = useState<string | null>(null) // categoria_id
  const [editingCat, setEditingCat] = useState<string | null>(null)    // categoria.id
  const [editingSubcat, setEditingSubcat] = useState<string | null>(null)
  const [inputVal, setInputVal] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [{ data: r }, { data: c }, { data: s }] = await Promise.all([
      sb.from("rubros").select("*").order("nombre"),
      sb.from("categorias").select("*").order("nombre"),
      sb.from("subcategorias").select("*").order("nombre"),
    ])
    if (r) { setRubros(r); setExpandedRubros(new Set(r.map((x: Rubro) => x.id))) }
    if (c) setCategorias(c)
    if (s) setSubcategorias(s)
    setLoading(false)
  }

  const toggleRubro = (id: string) => setExpandedRubros(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleCat   = (id: string) => setExpandedCats(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const cancelEdit = () => { setAddingCat(null); setAddingSubcat(null); setEditingCat(null); setEditingSubcat(null); setInputVal("") }

  const saveCategoria = async (rubroId: string) => {
    if (!inputVal.trim()) return
    setSaving(true)
    const { error } = await sb.from("categorias").insert({ rubro_id: rubroId, nombre: inputVal.trim() })
    if (!error) await load()
    else alert(error.message)
    setSaving(false); cancelEdit()
  }

  const updateCategoria = async (id: string) => {
    if (!inputVal.trim()) return
    setSaving(true)
    const { error } = await sb.from("categorias").update({ nombre: inputVal.trim() }).eq("id", id)
    if (!error) await load()
    else alert(error.message)
    setSaving(false); cancelEdit()
  }

  const deleteCategoria = async (id: string) => {
    if (!confirm("¿Eliminar categoría y todas sus subcategorías?")) return
    await sb.from("categorias").delete().eq("id", id)
    load()
  }

  const saveSubcategoria = async (catId: string) => {
    if (!inputVal.trim()) return
    setSaving(true)
    const { error } = await sb.from("subcategorias").insert({ categoria_id: catId, nombre: inputVal.trim() })
    if (!error) await load()
    else alert(error.message)
    setSaving(false); cancelEdit()
  }

  const updateSubcategoria = async (id: string) => {
    if (!inputVal.trim()) return
    setSaving(true)
    const { error } = await sb.from("subcategorias").update({ nombre: inputVal.trim() }).eq("id", id)
    if (!error) await load()
    else alert(error.message)
    setSaving(false); cancelEdit()
  }

  const deleteSubcategoria = async (id: string) => {
    await sb.from("subcategorias").delete().eq("id", id)
    load()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Cargando...</div>
  )

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Categorías</h1>
        <p className="text-sm text-slate-500 mt-0.5">Organizá los artículos en rubros, categorías y subcategorías</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {rubros.map(rubro => {
          const colors = RUBRO_COLORS[rubro.slug] || RUBRO_COLORS.bazar
          const cats = categorias.filter(c => c.rubro_id === rubro.id)
          const isOpen = expandedRubros.has(rubro.id)

          return (
            <div key={rubro.id} className={`rounded-xl border ${colors.border} overflow-hidden`}>
              {/* Rubro header */}
              <button
                onClick={() => toggleRubro(rubro.id)}
                className={`w-full flex items-center gap-2 px-4 py-3 ${colors.header} font-semibold text-sm`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${colors.dot} flex-shrink-0`}/>
                <span className="flex-1 text-left">{rubro.nombre}</span>
                <span className="text-xs font-normal opacity-60">{cats.length} cat.</span>
                {isOpen ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}
              </button>

              {isOpen && (
                <div className={`${colors.bg} divide-y divide-slate-100`}>
                  {cats.map(cat => {
                    const subcats = subcategorias.filter(s => s.categoria_id === cat.id)
                    const isCatOpen = expandedCats.has(cat.id)

                    return (
                      <div key={cat.id} className="px-3 py-2">
                        {/* Categoria row */}
                        <div className="flex items-center gap-1 group">
                          <button onClick={() => toggleCat(cat.id)} className="flex items-center gap-1.5 flex-1 min-w-0">
                            {isCatOpen ? <ChevronDown className="h-3 w-3 text-slate-400 flex-shrink-0"/> : <ChevronRight className="h-3 w-3 text-slate-400 flex-shrink-0"/>}
                            {editingCat === cat.id ? (
                              <Input autoFocus className="h-6 text-xs py-0 flex-1" value={inputVal}
                                onChange={e => setInputVal(e.target.value)}
                                onKeyDown={e => { if(e.key==="Enter") updateCategoria(cat.id); if(e.key==="Escape") cancelEdit() }}
                              />
                            ) : (
                              <span className="text-xs font-medium text-slate-700 truncate">{cat.nombre}</span>
                            )}
                          </button>

                          {editingCat === cat.id ? (
                            <div className="flex gap-0.5">
                              <button onClick={() => updateCategoria(cat.id)} disabled={saving} className="p-0.5 text-emerald-600 hover:text-emerald-700"><Check className="h-3 w-3"/></button>
                              <button onClick={cancelEdit} className="p-0.5 text-slate-400 hover:text-slate-600"><X className="h-3 w-3"/></button>
                            </div>
                          ) : (
                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => { setEditingCat(cat.id); setInputVal(cat.nombre) }} className="p-0.5 text-slate-400 hover:text-blue-600"><Pencil className="h-3 w-3"/></button>
                              <button onClick={() => deleteCategoria(cat.id)} className="p-0.5 text-slate-400 hover:text-red-500"><Trash2 className="h-3 w-3"/></button>
                            </div>
                          )}
                        </div>

                        {/* Subcategorias */}
                        {isCatOpen && (
                          <div className="mt-1 pl-4 space-y-0.5">
                            {subcats.map(sub => (
                              <div key={sub.id} className="flex items-center gap-1 group/sub">
                                {editingSubcat === sub.id ? (
                                  <>
                                    <Input autoFocus className="h-5 text-[11px] py-0 flex-1" value={inputVal}
                                      onChange={e => setInputVal(e.target.value)}
                                      onKeyDown={e => { if(e.key==="Enter") updateSubcategoria(sub.id); if(e.key==="Escape") cancelEdit() }}
                                    />
                                    <button onClick={() => updateSubcategoria(sub.id)} disabled={saving} className="p-0.5 text-emerald-600"><Check className="h-3 w-3"/></button>
                                    <button onClick={cancelEdit} className="p-0.5 text-slate-400"><X className="h-3 w-3"/></button>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-[11px] text-slate-500 flex-1 truncate">— {sub.nombre}</span>
                                    <div className="flex gap-0.5 opacity-0 group-hover/sub:opacity-100 transition-opacity">
                                      <button onClick={() => { setEditingSubcat(sub.id); setInputVal(sub.nombre) }} className="p-0.5 text-slate-400 hover:text-blue-600"><Pencil className="h-2.5 w-2.5"/></button>
                                      <button onClick={() => deleteSubcategoria(sub.id)} className="p-0.5 text-slate-400 hover:text-red-500"><Trash2 className="h-2.5 w-2.5"/></button>
                                    </div>
                                  </>
                                )}
                              </div>
                            ))}

                            {/* Agregar subcategoria */}
                            {addingSubcat === cat.id ? (
                              <div className="flex items-center gap-1 mt-1">
                                <Input autoFocus className="h-5 text-[11px] py-0 flex-1" placeholder="Nueva subcategoría..." value={inputVal}
                                  onChange={e => setInputVal(e.target.value)}
                                  onKeyDown={e => { if(e.key==="Enter") saveSubcategoria(cat.id); if(e.key==="Escape") cancelEdit() }}
                                />
                                <button onClick={() => saveSubcategoria(cat.id)} disabled={saving} className="p-0.5 text-emerald-600"><Check className="h-3 w-3"/></button>
                                <button onClick={cancelEdit} className="p-0.5 text-slate-400"><X className="h-3 w-3"/></button>
                              </div>
                            ) : (
                              <button onClick={() => { cancelEdit(); setAddingSubcat(cat.id); setInputVal("") }} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 mt-0.5">
                                <Plus className="h-2.5 w-2.5"/>agregar subcategoría
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Agregar categoria */}
                  <div className="px-3 py-2">
                    {addingCat === rubro.id ? (
                      <div className="flex items-center gap-1">
                        <Input autoFocus className="h-7 text-xs flex-1" placeholder="Nueva categoría..." value={inputVal}
                          onChange={e => setInputVal(e.target.value)}
                          onKeyDown={e => { if(e.key==="Enter") saveCategoria(rubro.id); if(e.key==="Escape") cancelEdit() }}
                        />
                        <button onClick={() => saveCategoria(rubro.id)} disabled={saving} className="p-1 text-emerald-600 hover:text-emerald-700"><Check className="h-4 w-4"/></button>
                        <button onClick={cancelEdit} className="p-1 text-slate-400 hover:text-slate-600"><X className="h-4 w-4"/></button>
                      </div>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-7 text-xs w-full justify-start gap-1.5 text-slate-500 hover:text-slate-700"
                        onClick={() => { cancelEdit(); setAddingCat(rubro.id); setInputVal("") }}>
                        <Plus className="h-3.5 w-3.5"/>Agregar categoría
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
