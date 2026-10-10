"use client"

// Tablero de Playroom: tarjetas elegidas del catálogo + tarjetas fijadas desde el chat.
// Cada usuario lo arma a su gusto y queda guardado en su computadora.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { GripVertical, Plus, RotateCcw, RefreshCw, X, Check, MessageSquareText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { CargaProgreso } from "@/components/ui/carga-progreso"
import { cn } from "@/lib/utils"
import type { Bloque, Recalcular } from "@/lib/playroom/bloques"
import { CATALOGO_TABLERO, TABLERO_INICIAL, tarjetaPorId, type GrupoTarjeta } from "@/lib/playroom/catalogo-tablero"
import { BloqueVista } from "./bloque-vista"

const CLAVE = "playroom:tablero:v1"

/** Tarjeta fijada desde el chat: guarda la foto del bloque y, si se puede, cómo recalcularlo */
interface Fijada { id: string; bloque: Bloque; recalcular?: Recalcular; fijadaEl: string }
interface Estado { ids: string[]; fijadas: Record<string, Fijada> }

const ESTADO_INICIAL: Estado = { ids: TABLERO_INICIAL, fijadas: {} }

export function useTablero() {
  const [estado, setEstado] = useState<Estado>(ESTADO_INICIAL)
  const [listo, setListo] = useState(false)
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(CLAVE) || "null")
      if (v && Array.isArray(v.ids)) setEstado({ ids: v.ids.filter((x: unknown) => typeof x === "string"), fijadas: v.fijadas || {} })
    } catch {}
    setListo(true)
  }, [])
  useEffect(() => {
    if (!listo) return
    try { localStorage.setItem(CLAVE, JSON.stringify(estado)) } catch {}
  }, [estado, listo])

  const alternar = useCallback((id: string) => setEstado(e => ({ ...e, ids: e.ids.includes(id) ? e.ids.filter(x => x !== id) : [...e.ids, id] })), [])
  const quitar = useCallback((id: string) => setEstado(e => {
    const fijadas = { ...e.fijadas }; delete fijadas[id]
    return { ids: e.ids.filter(x => x !== id), fijadas }
  }), [])
  const mover = useCallback((desde: string, hacia: string) => setEstado(e => {
    const ids = [...e.ids]; const i = ids.indexOf(desde), j = ids.indexOf(hacia)
    if (i < 0 || j < 0 || i === j) return e
    ids.splice(j, 0, ids.splice(i, 1)[0])
    return { ...e, ids }
  }), [])
  const fijar = useCallback((bloque: Bloque) => {
    const id = `chat:${Date.now().toString(36)}`
    setEstado(e => ({ ids: [...e.ids, id], fijadas: { ...e.fijadas, [id]: { id, bloque, recalcular: bloque.recalcular, fijadaEl: new Date().toISOString() } } }))
  }, [])
  const restablecer = useCallback(() => setEstado(ESTADO_INICIAL), [])
  return { estado, listo, alternar, quitar, mover, fijar, restablecer }
}

type Tablero = ReturnType<typeof useTablero>

const ANCHO_CLASES: Record<number, string> = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-2 sm:col-span-3",
  6: "col-span-2 sm:col-span-3 xl:col-span-6",
}

export function TableroVista({ t, onPreguntar }: { t: Tablero; onPreguntar: (texto: string) => void }) {
  const { estado, listo } = t
  const [datos, setDatos] = useState<Record<string, Bloque | { error: string }>>({})
  const [cargando, setCargando] = useState(false)
  const [actualizado, setActualizado] = useState<Date | null>(null)
  const [catalogo, setCatalogo] = useState(false)
  const [arrastrando, setArrastrando] = useState<string | null>(null)

  const idsCatalogo = useMemo(() => estado.ids.filter(id => !id.startsWith("chat:")), [estado.ids])
  const clave = idsCatalogo.slice().sort().join(",")
  const pedido = useRef(0)

  const cargar = useCallback(async () => {
    const mio = ++pedido.current
    setCargando(true)
    try {
      const res = clave ? await fetch(`/api/playroom/tablero?ids=${encodeURIComponent(clave)}`) : null
      const json = res ? await res.json() : { bloques: {} }
      // Tarjetas fijadas desde el chat: se recalculan si el cerebro lo permite; si no, queda la foto
      const fijadas = Object.values(estado.fijadas)
      const frescas = await Promise.all(fijadas.map(async f => {
        if (!f.recalcular) return [f.id, f.bloque] as const
        try {
          const r = await fetch("/api/playroom/recalcular", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f.recalcular) })
          if (!r.ok) return [f.id, f.bloque] as const
          return [f.id, (await r.json()) as Bloque] as const
        } catch { return [f.id, f.bloque] as const }
      }))
      if (mio !== pedido.current) return
      setDatos({ ...(json.bloques || {}), ...Object.fromEntries(frescas) })
      setActualizado(new Date())
    } catch {
      if (mio === pedido.current) setDatos({})
    } finally {
      if (mio === pedido.current) setCargando(false)
    }
  }, [clave, estado.fijadas])

  useEffect(() => { if (listo) cargar() }, [listo, cargar])
  // Se actualiza solo cada 5 minutos mientras la pantalla está abierta
  useEffect(() => { const i = setInterval(() => { if (document.visibilityState === "visible") cargar() }, 5 * 60_000); return () => clearInterval(i) }, [cargar])

  const grupos = useMemo(() => {
    const g = new Map<GrupoTarjeta, typeof CATALOGO_TABLERO>()
    for (const c of CATALOGO_TABLERO) g.set(c.grupo, [...(g.get(c.grupo) || []), c])
    return [...g.entries()]
  }, [])

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold tracking-tight text-azul-900">Tablero</h2>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-neutro-400 sm:inline">
            {cargando ? "Actualizando…" : actualizado ? `Actualizado ${actualizado.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={cargar} disabled={cargando} title="Actualizar">
            <RefreshCw className={cn("h-4 w-4", cargando && "animate-spin")} />
          </Button>
          <Button size="sm" className="h-9 gap-1.5" onClick={() => setCatalogo(true)}>
            <Plus className="h-4 w-4" />Agregar tarjeta
          </Button>
        </div>
      </div>

      {estado.ids.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutro-300 bg-white px-6 py-10 text-center">
          <p className="font-semibold text-azul-900">El tablero está vacío</p>
          <p className="mt-1 text-sm text-neutro-500">Agregá tarjetas del catálogo o fijá respuestas de Megasur.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button size="sm" onClick={() => setCatalogo(true)}><Plus className="mr-1 h-4 w-4" />Agregar tarjeta</Button>
            <Button size="sm" variant="outline" onClick={t.restablecer}><RotateCcw className="mr-1 h-4 w-4" />Tablero inicial</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {estado.ids.map(id => {
            const fijada = estado.fijadas[id]
            const cat = tarjetaPorId(id)
            if (!fijada && !cat) return null
            const b = datos[id]
            const titulo = fijada?.bloque.titulo ?? cat!.titulo
            const ancho = fijada ? (fijada.bloque.tipo === "numero" ? 1 : 3) : cat!.ancho
            return (
              <article
                key={id}
                draggable
                onDragStart={e => { setArrastrando(id); e.dataTransfer.effectAllowed = "move" }}
                onDragOver={e => { e.preventDefault(); if (arrastrando && arrastrando !== id) t.mover(arrastrando, id) }}
                onDragEnd={() => setArrastrando(null)}
                className={cn(
                  "group relative min-w-0 rounded-2xl border border-neutro-200 bg-white p-4 transition-shadow hover:shadow-sm",
                  ANCHO_CLASES[ancho], arrastrando === id && "opacity-40",
                )}
              >
                <header className="mb-2 flex items-start gap-1.5">
                  <GripVertical className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-neutro-300 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-neutro-600" title={titulo}>{titulo}</h3>
                  {fijada && <span title="Fijada desde el chat"><MessageSquareText className="h-3.5 w-3.5 shrink-0 text-azul-400" /></span>}
                  <button type="button" onClick={() => t.quitar(id)} aria-label={`Quitar ${titulo}`}
                    className="grid size-6 shrink-0 place-items-center rounded-md text-neutro-400 opacity-0 transition-opacity hover:bg-neutro-100 hover:text-neutro-700 focus:opacity-100 group-hover:opacity-100">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </header>
                {!b ? (
                  <CargaProgreso compacto mensajes={["Buscando los datos…", "Sumando…", "Ya casi está…"]} className="py-3" />
                ) : "error" in b ? (
                  <p className="py-2 text-sm text-neutro-400">{b.error}</p>
                ) : (
                  <button type="button" className="block w-full text-left" onClick={() => onPreguntar(`Contame más sobre "${titulo}"`)} title="Preguntarle a Megasur sobre esto">
                    <BloqueVista bloque={b} compacto />
                  </button>
                )}
                {fijada && !fijada.recalcular && (
                  <p className="mt-2 text-[11px] text-neutro-400">Foto del {new Date(fijada.fijadaEl).toLocaleDateString("es-AR")}: este dato no se actualiza solo</p>
                )}
              </article>
            )
          })}
        </div>
      )}

      <Dialog open={catalogo} onOpenChange={setCatalogo}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Tarjetas del tablero</DialogTitle>
            <DialogDescription>Tildá las que querés ver. Se guardan en esta computadora; cada uno arma su tablero.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {grupos.map(([grupo, items]) => (
              <div key={grupo}>
                <p className="mb-2 text-[13px] font-bold text-azul-900">{grupo}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {items.map(c => {
                    const on = estado.ids.includes(c.id)
                    return (
                      <button key={c.id} type="button" onClick={() => t.alternar(c.id)}
                        className={cn("flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors",
                          on ? "border-azul-300 bg-azul-50" : "border-neutro-200 bg-white hover:bg-neutro-50")}>
                        <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border-2",
                          on ? "border-azul-600 bg-azul-600 text-white" : "border-neutro-300")}>
                          {on && <Check className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-azul-900">{c.titulo}</span>
                          <span className="block text-xs text-neutro-500">{c.descripcion}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t pt-3">
            <button type="button" onClick={t.restablecer} className="text-sm font-semibold text-neutro-500 hover:text-azul-700">
              <RotateCcw className="mr-1 inline h-3.5 w-3.5" />Volver al tablero inicial
            </button>
            <Button onClick={() => setCatalogo(false)}>Listo</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
