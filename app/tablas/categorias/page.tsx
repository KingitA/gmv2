"use client"

import { useState, useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChevronDown, ChevronRight, Plus, Trash2, Pencil, Check, X, GripVertical } from "lucide-react"

type Rubro = { id: string; nombre: string; slug: string; orden: number }
type Categoria = { id: string; rubro_id: string; nombre: string; orden: number }
type Subcategoria = { id: string; categoria_id: string; nombre: string; orden: number }

const RUBRO_COLORS: Record<string, { bg: string; border: string; header: string; dot: string }> = {
  limpieza:   { bg: "bg-sky-50",    border: "border-sky-200",    header: "bg-sky-100 text-sky-800",       dot: "bg-sky-500"    },
  bazar:      { bg: "bg-amber-50",  border: "border-amber-200",  header: "bg-amber-100 text-amber-800",   dot: "bg-amber-500"  },
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
  const [addingCat, setAddingCat] = useState<string | null>(null)
  const [addingSubcat, setAddingSubcat] = useState<string | null>(null)
  const [editingCat, setEditingCat] = useState<string | null>(null)
  const [editingSubcat, setEditingSubcat] = useState<string | null>(null)
  const [inputVal, setInputVal] = useState("")
  const [saving, setSaving] = useState(false)

  // Drag state — refs for source ID (no re-render during drag), state for visual feedback
  const dragCatIdRef    = useRef<string | null>(null)
  const dragSubcatIdRef = useRef<string | null>(null)
  const [draggingCatId,    setDraggingCatId]    = useState<string | null>(null)
  const [draggingSubcatId, setDraggingSubcatId] = useState<string | null>(null)
  const [dragOverCatId,    setDragOverCatId]    = useState<string | null>(null)
  const [dragOverSubcatId, setDragOverSubcatId] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [{ data: r }, { data: c }, { data: s }] = await Promise.all([
      sb.from("rubros").select("*").order("orden"),
      sb.from("categorias").select("*").order("orden"),
      sb.from("subcategorias").select("*").order("orden"),
    ])
    if (r) { setRubros(r); setExpandedRubros(new Set(r.map((x: Rubro) => x.id))) }
    if (c) setCategorias(c)
    if (s) setSubcategorias(s)
    setLoading(false)
  }

  const toggleRubro = (id: string) => setExpandedRubros(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleCat   = (id: string) => setExpandedCats(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const cancelEdit  = () => { setAddingCat(null); setAddingSubcat(null); setEditingCat(null); setEditingSubcat(null); setInputVal("") }

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  const saveCategoria = async (rubroId: string) => {
    if (!inputVal.trim()) return
    setSaving(true)
    const maxOrden = Math.max(0, ...categorias.filter(c => c.rubro_id === rubroId).map(c => c.orden ?? 0))
    const { error } = await sb.from("categorias").insert({ rubro_id: rubroId, nombre: inputVal.trim(), orden: maxOrden + 1 })
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
    const maxOrden = Math.max(0, ...subcategorias.filter(s => s.categoria_id === catId).map(s => s.orden ?? 0))
    const { error } = await sb.from("subcategorias").insert({ categoria_id: catId, nombre: inputVal.trim(), orden: maxOrden + 1 })
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

  // ── DRAG & DROP — categorias ──────────────────────────────────────────────
  const handleCatDragStart = (e: React.DragEvent, catId: string) => {
    e.stopPropagation()
    dragCatIdRef.current = catId
    setDraggingCatId(catId)
    e.dataTransfer.effectAllowed = "move"
  }

  const handleCatDragOver = (e: React.DragEvent, catId: string) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = "move"
    if (dragCatIdRef.current && dragCatIdRef.current !== catId) setDragOverCatId(catId)
  }

  const handleCatDrop = async (e: React.DragEvent, targetId: string, rubroId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const sourceId = dragCatIdRef.current
    dragCatIdRef.current = null
    setDraggingCatId(null)
    setDragOverCatId(null)
    if (!sourceId || sourceId === targetId) return

    const rubroCats = categorias
      .filter(c => c.rubro_id === rubroId)
      .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999))
    const fromIdx = rubroCats.findIndex(c => c.id === sourceId)
    const toIdx   = rubroCats.findIndex(c => c.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return

    const reordered = [...rubroCats]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    const updates = reordered.map((c, i) => ({ ...c, orden: i + 1 }))

    setCategorias(prev => prev.map(c => {
      const u = updates.find(x => x.id === c.id)
      return u ? { ...c, orden: u.orden } : c
    }))

    await Promise.all(updates.map(u =>
      sb.from("categorias").update({ orden: u.orden }).eq("id", u.id)
    ))
  }

  // ── DRAG & DROP — subcategorias ───────────────────────────────────────────
  const handleSubcatDragStart = (e: React.DragEvent, subcatId: string) => {
    e.stopPropagation()
    dragSubcatIdRef.current = subcatId
    setDraggingSubcatId(subcatId)
    e.dataTransfer.effectAllowed = "move"
  }

  const handleSubcatDragOver = (e: React.DragEvent, subcatId: string) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = "move"
    if (dragSubcatIdRef.current && dragSubcatIdRef.current !== subcatId) setDragOverSubcatId(subcatId)
  }

  const handleSubcatDrop = async (e: React.DragEvent, targetId: string, catId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const sourceId = dragSubcatIdRef.current
    dragSubcatIdRef.current = null
    setDraggingSubcatId(null)
    setDragOverSubcatId(null)
    if (!sourceId || sourceId === targetId) return

    const catSubcats = subcategorias
      .filter(s => s.categoria_id === catId)
      .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999))
    const fromIdx = catSubcats.findIndex(s => s.id === sourceId)
    const toIdx   = catSubcats.findIndex(s => s.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return

    const reordered = [...catSubcats]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    const updates = reordered.map((s, i) => ({ ...s, orden: i + 1 }))

    setSubcategorias(prev => prev.map(s => {
      const u = updates.find(x => x.id === s.id)
      return u ? { ...s, orden: u.orden } : s
    }))

    await Promise.all(updates.map(u =>
      sb.from("subcategorias").update({ orden: u.orden }).eq("id", u.id)
    ))
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Cargando...</div>
  )

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Categorías</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Arrastrá categorías y subcategorías para establecer el orden en comprobantes
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...rubros].sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999)).map(rubro => {
          const colors = RUBRO_COLORS[rubro.slug] || RUBRO_COLORS.bazar
          const cats = [...categorias.filter(c => c.rubro_id === rubro.id)]
            .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999))
          const isOpen = expandedRubros.has(rubro.id)

          return (
            <div key={rubro.id} className={`rounded-xl border ${colors.border} overflow-hidden`}>
              {/* Rubro header — orden fijo, no draggable */}
              <button
                onClick={() => toggleRubro(rubro.id)}
                className={`w-full flex items-center gap-2 px-4 py-3 ${colors.header} font-semibold text-sm`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${colors.dot} flex-shrink-0`} />
                <span className="flex-1 text-left">{rubro.nombre}</span>
                <span className="text-xs font-normal opacity-60">{cats.length} cat.</span>
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>

              {isOpen && (
                <div className={`${colors.bg} divide-y divide-slate-100`}>
                  {cats.map(cat => {
                    const subcats = [...subcategorias.filter(s => s.categoria_id === cat.id)]
                      .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999))
                    const isCatOpen      = expandedCats.has(cat.id)
                    const isDraggingThis = draggingCatId === cat.id
                    const isDragOver     = dragOverCatId === cat.id

                    return (
                      <div
                        key={cat.id}
                        className={`px-3 py-2 transition-opacity select-none
                          ${isDraggingThis ? "opacity-40" : ""}
                          ${isDragOver ? "border-t-2 border-blue-400" : "border-t border-transparent"}`}
                        draggable={editingCat !== cat.id}
                        onDragStart={e => handleCatDragStart(e, cat.id)}
                        onDragOver={e => handleCatDragOver(e, cat.id)}
                        onDrop={e => handleCatDrop(e, cat.id, rubro.id)}
                        onDragLeave={() => setDragOverCatId(null)}
                        onDragEnd={() => {
                          setDraggingCatId(null)
                          setDragOverCatId(null)
                          dragCatIdRef.current = null
                        }}
                      >
                        {/* Categoria row */}
                        <div className="flex items-center gap-1 group">
                          <GripVertical className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-400 flex-shrink-0 cursor-grab active:cursor-grabbing" />
                          <button
                            onClick={() => toggleCat(cat.id)}
                            className="flex items-center gap-1.5 flex-1 min-w-0"
                          >
                            {isCatOpen
                              ? <ChevronDown  className="h-3 w-3 text-slate-400 flex-shrink-0" />
                              : <ChevronRight className="h-3 w-3 text-slate-400 flex-shrink-0" />}
                            {editingCat === cat.id ? (
                              <Input
                                autoFocus
                                className="h-6 text-xs py-0 flex-1"
                                value={inputVal}
                                onChange={e => setInputVal(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === "Enter") updateCategoria(cat.id)
                                  if (e.key === "Escape") cancelEdit()
                                }}
                              />
                            ) : (
                              <span className="text-xs font-medium text-slate-700 truncate">{cat.nombre}</span>
                            )}
                          </button>

                          {editingCat === cat.id ? (
                            <div className="flex gap-0.5">
                              <button onClick={() => updateCategoria(cat.id)} disabled={saving} className="p-0.5 text-emerald-600 hover:text-emerald-700"><Check className="h-3 w-3" /></button>
                              <button onClick={cancelEdit} className="p-0.5 text-slate-400 hover:text-slate-600"><X className="h-3 w-3" /></button>
                            </div>
                          ) : (
                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => { setEditingCat(cat.id); setInputVal(cat.nombre) }} className="p-0.5 text-slate-400 hover:text-blue-600"><Pencil className="h-3 w-3" /></button>
                              <button onClick={() => deleteCategoria(cat.id)} className="p-0.5 text-slate-400 hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
                            </div>
                          )}
                        </div>

                        {/* Subcategorias */}
                        {isCatOpen && (
                          <div className="mt-1 pl-4 space-y-0.5">
                            {subcats.map(sub => {
                              const isDraggingThisSub = draggingSubcatId === sub.id
                              const isDragOverSub     = dragOverSubcatId === sub.id
                              return (
                                <div
                                  key={sub.id}
                                  className={`flex items-center gap-1 group/sub transition-opacity select-none
                                    ${isDraggingThisSub ? "opacity-40" : ""}
                                    ${isDragOverSub ? "border-t-2 border-blue-300" : "border-t border-transparent"}`}
                                  draggable={editingSubcat !== sub.id}
                                  onDragStart={e => handleSubcatDragStart(e, sub.id)}
                                  onDragOver={e => handleSubcatDragOver(e, sub.id)}
                                  onDrop={e => handleSubcatDrop(e, sub.id, cat.id)}
                                  onDragLeave={() => setDragOverSubcatId(null)}
                                  onDragEnd={() => {
                                    setDraggingSubcatId(null)
                                    setDragOverSubcatId(null)
                                    dragSubcatIdRef.current = null
                                  }}
                                >
                                  <GripVertical className="h-3 w-3 text-slate-300 group-hover/sub:text-slate-400 flex-shrink-0 cursor-grab active:cursor-grabbing" />
                                  {editingSubcat === sub.id ? (
                                    <>
                                      <Input
                                        autoFocus
                                        className="h-5 text-[11px] py-0 flex-1"
                                        value={inputVal}
                                        onChange={e => setInputVal(e.target.value)}
                                        onKeyDown={e => {
                                          if (e.key === "Enter") updateSubcategoria(sub.id)
                                          if (e.key === "Escape") cancelEdit()
                                        }}
                                      />
                                      <button onClick={() => updateSubcategoria(sub.id)} disabled={saving} className="p-0.5 text-emerald-600"><Check className="h-3 w-3" /></button>
                                      <button onClick={cancelEdit} className="p-0.5 text-slate-400"><X className="h-3 w-3" /></button>
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-[11px] text-slate-500 flex-1 truncate">— {sub.nombre}</span>
                                      <div className="flex gap-0.5 opacity-0 group-hover/sub:opacity-100 transition-opacity">
                                        <button onClick={() => { setEditingSubcat(sub.id); setInputVal(sub.nombre) }} className="p-0.5 text-slate-400 hover:text-blue-600"><Pencil className="h-2.5 w-2.5" /></button>
                                        <button onClick={() => deleteSubcategoria(sub.id)} className="p-0.5 text-slate-400 hover:text-red-500"><Trash2 className="h-2.5 w-2.5" /></button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )
                            })}

                            {/* Agregar subcategoria */}
                            {addingSubcat === cat.id ? (
                              <div className="flex items-center gap-1 mt-1">
                                <Input
                                  autoFocus
                                  className="h-5 text-[11px] py-0 flex-1"
                                  placeholder="Nueva subcategoría..."
                                  value={inputVal}
                                  onChange={e => setInputVal(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") saveSubcategoria(cat.id)
                                    if (e.key === "Escape") cancelEdit()
                                  }}
                                />
                                <button onClick={() => saveSubcategoria(cat.id)} disabled={saving} className="p-0.5 text-emerald-600"><Check className="h-3 w-3" /></button>
                                <button onClick={cancelEdit} className="p-0.5 text-slate-400"><X className="h-3 w-3" /></button>
                              </div>
                            ) : (
                              <button
                                onClick={() => { cancelEdit(); setAddingSubcat(cat.id); setInputVal("") }}
                                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 mt-0.5"
                              >
                                <Plus className="h-2.5 w-2.5" />agregar subcategoría
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
                        <Input
                          autoFocus
                          className="h-7 text-xs flex-1"
                          placeholder="Nueva categoría..."
                          value={inputVal}
                          onChange={e => setInputVal(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") saveCategoria(rubro.id)
                            if (e.key === "Escape") cancelEdit()
                          }}
                        />
                        <button onClick={() => saveCategoria(rubro.id)} disabled={saving} className="p-1 text-emerald-600 hover:text-emerald-700"><Check className="h-4 w-4" /></button>
                        <button onClick={cancelEdit} className="p-1 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 text-xs w-full justify-start gap-1.5 text-slate-500 hover:text-slate-700"
                        onClick={() => { cancelEdit(); setAddingCat(rubro.id); setInputVal("") }}
                      >
                        <Plus className="h-3.5 w-3.5" />Agregar categoría
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
