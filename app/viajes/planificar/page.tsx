"use client"

import { Suspense, useCallback, useEffect, useMemo, useState, type DragEvent } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ChevronLeft, ChevronRight, CopyPlus, EyeOff, Eye, Minus, Plus, Save, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DateInputAR } from "@/components/ui/date-input-ar"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { useUrlParams } from "@/lib/hooks/use-url-state"
import { fechaCorta, hoyISO, sumarDiasISO } from "@/lib/formato"
import { ESTADO_VIAJE_COLOR } from "@/lib/viajes/estados"
import { DIAS_SEMANA, celdasMes } from "@/components/viajes/calendario-viajes"
import { cn } from "@/lib/utils"
import type { EstadoPlanMes, PropuestaViaje, ViajePlan, ZonaPlan } from "@/lib/viajes/plan-mes"

// ARMAR EL CALENDARIO DEL MES — se hace una vez por mes, 5 a 10 días antes de
// que empiece. Todas las zonas a la izquierda; se arrastran a un día (o se les
// pone fecha) y quedan como BORRADOR con su duración habitual. "Traer el mes
// anterior" propone el mismo día de la semana y la misma semana. Nada se crea
// hasta "Guardar": ahí cada borrador pasa a viaje programado. Arriba se ve qué
// zonas siguen sin viaje, para que no quede ninguna afuera.
// Los borradores se guardan en este navegador (localStorage) hasta confirmar.

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const TIPO_DND = "application/x-gm-plan"

type Borrador = { key: string; fecha: string; dias: number; zona_ids: string[] }
type Arrastre =
  | { tipo: "zona"; id: string }
  | { tipo: "borrador"; key: string; desfase: number }
  | { tipo: "viaje"; id: string; desfase: number }
type Datos = EstadoPlanMes & { propuesta: PropuestaViaje[] }

const mesDe = (iso: string) => iso.slice(0, 7)
const sumarMes = (mes: string, delta: number) => {
  const [a, m] = mes.split("-").map(Number)
  const t = a * 12 + (m - 1) + delta
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`
}
const nuevaKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now() + Math.random()))

function leerBorradores(mes: string): Borrador[] {
  try {
    const raw = window.localStorage.getItem(`plan-viajes:${mes}`)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((b) => b && b.fecha && Array.isArray(b.zona_ids)) : []
  } catch {
    return []
  }
}
function escribirBorradores(mes: string, bs: Borrador[]) {
  try {
    if (bs.length) window.localStorage.setItem(`plan-viajes:${mes}`, JSON.stringify(bs))
    else window.localStorage.removeItem(`plan-viajes:${mes}`)
  } catch {
    /* sin almacenamiento: quedan solo en memoria */
  }
}

function Planificador() {
  const router = useRouter()
  const url = useUrlParams()
  const porDefecto = sumarMes(mesDe(hoyISO()), 1)
  const mes = /^\d{4}-\d{2}$/.test(url.get("mes")) ? url.get("mes") : porDefecto
  const [anio, mesNum] = mes.split("-").map(Number)

  const [datos, setDatos] = useState<Datos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [borradores, setBorradoresState] = useState<Borrador[]>([])
  const [arrastre, setArrastre] = useState<Arrastre | null>(null)
  const [sobre, setSobre] = useState<string | null>(null) // día | "b:key" | "v:id"
  const [guardando, setGuardando] = useState(false)
  const [fechaZona, setFechaZona] = useState<Record<string, string>>({})
  const [verOcultas, setVerOcultas] = useState(false)

  const setBorradores = useCallback(
    (fn: (prev: Borrador[]) => Borrador[]) =>
      setBorradoresState((prev) => {
        const next = fn(prev)
        escribirBorradores(mes, next)
        return next
      }),
    [mes],
  )

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/viajes/plan?mes=${mes}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setDatos(d)
    } catch (e: any) {
      toast.error(e?.message || "No se pudo cargar el plan del mes")
    } finally {
      setCargando(false)
    }
  }, [mes])

  useEffect(() => {
    setCargando(true)
    setBorradoresState(leerBorradores(mes))
    cargar()
  }, [mes, cargar])

  const zonaPorId = useMemo(() => new Map((datos?.zonas || []).map((z) => [z.id, z])), [datos])
  const celdas = useMemo(() => celdasMes(anio, mesNum - 1), [anio, mesNum])

  // Cobertura: viajes reales del mes + borradores
  const cobertura = useMemo(() => {
    const m = new Map<string, { reales: ZonaPlan["viajes"]; borradores: Borrador[] }>()
    for (const z of datos?.zonas || []) m.set(z.id, { reales: z.viajes, borradores: [] })
    for (const b of borradores) for (const id of b.zona_ids) m.get(id)?.borradores.push(b)
    return m
  }, [datos, borradores])

  const visibles = (datos?.zonas || []).filter((z) => z.en_calendario)
  const ocultas = (datos?.zonas || []).filter((z) => !z.en_calendario)
  const faltan = visibles.filter((z) => {
    const c = cobertura.get(z.id)
    return !c || (c.reales.length === 0 && c.borradores.length === 0)
  })
  const cubiertas = visibles.length - faltan.length

  // Cada viaje / borrador aparece en todos sus días
  const porDia = useMemo(() => {
    const m = new Map<string, Array<{ tipo: "viaje"; v: ViajePlan; n: number } | { tipo: "borrador"; b: Borrador; n: number }>>()
    const push = (dia: string, x: any) => {
      if (!m.has(dia)) m.set(dia, [])
      m.get(dia)!.push(x)
    }
    for (const v of datos?.viajes || []) for (let i = 0; i < v.dias; i++) push(sumarDiasISO(v.fecha, i), { tipo: "viaje", v, n: i + 1 })
    for (const b of borradores) for (let i = 0; i < b.dias; i++) push(sumarDiasISO(b.fecha, i), { tipo: "borrador", b, n: i + 1 })
    return m
  }, [datos, borradores])

  // ── Acciones ────────────────────────────────────────────────────────
  const agregarBorrador = (zonaId: string, fecha: string) => {
    const z = zonaPorId.get(zonaId)
    if (!z) return
    setBorradores((prev) => [...prev, { key: nuevaKey(), fecha, dias: z.dias_viaje, zona_ids: [zonaId] }])
  }

  const sumarZonaABorrador = (zonaId: string, key: string) => {
    const z = zonaPorId.get(zonaId)
    setBorradores((prev) =>
      prev.map((b) =>
        b.key === key && !b.zona_ids.includes(zonaId)
          ? { ...b, zona_ids: [...b.zona_ids, zonaId], dias: Math.max(b.dias, z?.dias_viaje || 1) }
          : b,
      ),
    )
  }

  const patchViaje = async (id: string, body: Record<string, unknown>, ok: string) => {
    try {
      const res = await fetch(`/api/viajes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success(ok)
    } catch (e: any) {
      toast.error(e?.message || "No se pudo modificar el viaje")
    }
    cargar()
  }

  const sumarZonaAViaje = (zonaId: string, v: ViajePlan) => {
    if (v.estado !== "programado") { toast.error("Ese viaje ya fue despachado: no se le suman zonas"); return }
    if (v.zonas.some((z) => z.id === zonaId)) return
    patchViaje(v.id, { zona_ids: [...v.zonas.map((z) => z.id), zonaId] }, `${zonaPorId.get(zonaId)?.nombre} se suma a ${v.nombre}`)
  }

  const soltar = (destino: { dia?: string; borrador?: Borrador; viaje?: ViajePlan }) => {
    const a = arrastre
    setArrastre(null)
    setSobre(null)
    if (!a) return
    if (a.tipo === "zona") {
      if (destino.borrador) sumarZonaABorrador(a.id, destino.borrador.key)
      else if (destino.viaje) sumarZonaAViaje(a.id, destino.viaje)
      else if (destino.dia) agregarBorrador(a.id, destino.dia)
      return
    }
    if (!destino.dia) return
    if (a.tipo === "borrador") {
      const nueva = sumarDiasISO(destino.dia, -a.desfase)
      setBorradores((prev) => prev.map((b) => (b.key === a.key ? { ...b, fecha: nueva } : b)))
    } else {
      const v = datos?.viajes.find((x) => x.id === a.id)
      const nueva = sumarDiasISO(destino.dia, -a.desfase)
      if (!v || v.fecha === nueva) return
      if (!["programado", "despachado"].includes(v.estado)) { toast.error("Ese viaje ya salió: no se cambia la fecha"); return }
      patchViaje(v.id, { fecha: nueva }, `${v.nombre} pasa al ${fechaCorta(nueva)}`)
    }
  }

  const traerMesAnterior = () => {
    const propuesta = datos?.propuesta || []
    if (!propuesta.length) { toast.info("El mes anterior no tiene viajes para copiar"); return }
    let agregados = 0
    setBorradores((prev) => {
      const yaCubiertas = new Set<string>()
      for (const [id, c] of cobertura) if (c.reales.length || c.borradores.length) yaCubiertas.add(id)
      const nuevos: Borrador[] = []
      for (const p of propuesta) {
        const zonas = p.zona_ids.filter((id) => !yaCubiertas.has(id) && zonaPorId.get(id)?.en_calendario)
        if (!zonas.length) continue
        zonas.forEach((id) => yaCubiertas.add(id))
        nuevos.push({ key: nuevaKey(), fecha: p.fecha, dias: p.dias, zona_ids: zonas })
      }
      agregados = nuevos.length
      return [...prev, ...nuevos]
    })
    setTimeout(() => toast.success(agregados ? `${agregados} viajes propuestos como borrador: revisalos y guardá` : "Las zonas del mes anterior ya tienen viaje este mes"), 0)
  }

  const guardar = async () => {
    if (!borradores.length) return
    if (!confirm(`¿Programar ${borradores.length} ${borradores.length === 1 ? "viaje" : "viajes"} en ${MESES[mesNum - 1]}?`)) return
    setGuardando(true)
    try {
      const res = await fetch("/api/viajes/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viajes: borradores.map(({ fecha, dias, zona_ids }) => ({ fecha, dias, zona_ids })) }),
      })
      const d = await res.json()
      if (!res.ok && !d.creados) throw new Error(d.error || d.fallados?.[0]?.error || "No se pudo programar")
      const fallados = new Set<number>((d.fallados || []).map((f: any) => f.indice))
      setBorradores((prev) => prev.filter((_, i) => fallados.has(i)))
      if (fallados.size) toast.error(`${d.creados} programados; ${fallados.size} no se pudieron (quedan como borrador): ${d.fallados[0].error}`)
      else toast.success(`${d.creados} viajes programados`)
      await cargar()
    } catch (e: any) {
      toast.error(e?.message || "No se pudo programar")
    } finally {
      setGuardando(false)
    }
  }

  const patchZona = async (zonaId: string, body: Record<string, unknown>) => {
    setDatos((d) => (d ? { ...d, zonas: d.zonas.map((z) => (z.id === zonaId ? { ...z, ...body } : z)) } : d))
    try {
      const res = await fetch("/api/viajes/plan/zona", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ zona_id: zonaId, ...body }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
    } catch (e: any) {
      toast.error(e?.message || "No se pudo guardar la zona")
      cargar()
    }
  }

  // ── Arrastre ────────────────────────────────────────────────────────
  const empezar = (e: DragEvent, a: Arrastre) => {
    e.dataTransfer.setData(TIPO_DND, JSON.stringify(a))
    e.dataTransfer.effectAllowed = "move"
    setArrastre(a)
  }
  const aceptar = (e: DragEvent, clave: string) => {
    if (!arrastre) return
    e.preventDefault()
    e.stopPropagation()
    if (sobre !== clave) setSobre(clave)
  }
  const nombresZonas = (ids: string[]) => ids.map((id) => zonaPorId.get(id)?.nombre || "?").join(" + ")

  if (cargando && !datos) return <div className="p-6"><CargaProgreso mensajes={MENSAJES.viajes} className="mx-auto max-w-sm py-10" /></div>

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="sm" onClick={() => router.push(`/viajes?mes=${mes}`)} aria-label="Volver a viajes"><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-azul-900">Armar calendario</h1>
            <div className="mt-1 flex items-center gap-2">
              <Button variant="outline" size="icon" className="size-8" onClick={() => url.set({ mes: sumarMes(mes, -1) })} aria-label="Mes anterior"><ChevronLeft className="h-4 w-4" /></Button>
              <span className="w-36 text-center text-lg font-semibold">{MESES[mesNum - 1]} {anio}</span>
              <Button variant="outline" size="icon" className="size-8" onClick={() => url.set({ mes: sumarMes(mes, 1) })} aria-label="Mes siguiente"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-end gap-6">
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Zonas con viaje</p>
              <p className="text-3xl font-bold tabular-nums">{cubiertas}/{visibles.length}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Faltan</p>
              <p className={cn("text-3xl font-bold tabular-nums", faltan.length ? "text-error-600" : "text-exito-600")}>{faltan.length}</p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={traerMesAnterior} disabled={!datos?.propuesta.length}>
              <CopyPlus className="h-4 w-4" /> Traer el mes anterior
            </Button>
            {borradores.length > 0 && (
              <Button variant="ghost" size="sm" className="text-error-600" onClick={() => confirm("¿Descartar todos los borradores?") && setBorradores(() => [])}>
                <Trash2 className="h-4 w-4" /> Descartar borradores
              </Button>
            )}
            <Button size="sm" onClick={guardar} disabled={!borradores.length || guardando}>
              <Save className="h-4 w-4" /> {guardando ? "Guardando…" : `Guardar ${borradores.length || ""} ${borradores.length === 1 ? "viaje" : "viajes"}`}
            </Button>
          </div>
        </div>
      </div>

      {faltan.length > 0 ? (
        <div className="rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-800">
          <b>Sin viaje en {MESES[mesNum - 1].toLowerCase()}:</b> {faltan.map((z) => z.nombre).join(" · ")}
        </div>
      ) : visibles.length > 0 ? (
        <div className="rounded-lg border border-exito-200 bg-exito-50 px-3 py-2 text-sm text-exito-800">
          Todas las zonas tienen viaje en {MESES[mesNum - 1].toLowerCase()}{borradores.length ? " (falta guardar los borradores)" : ""}.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Zonas */}
        <div className="rounded-xl border bg-white">
          <div className="border-b px-3 py-2">
            <p className="text-sm font-semibold">Zonas</p>
            <p className="text-xs text-muted-foreground">Arrastralas al día que se viaja, o poneles fecha. La duración es la habitual: se puede cambiar.</p>
          </div>
          <div className="max-h-[70vh] divide-y overflow-y-auto">
            {[...faltan, ...visibles.filter((z) => !faltan.includes(z))].map((z) => {
              const c = cobertura.get(z.id)!
              const falta = faltan.includes(z)
              return (
                <div key={z.id} className={cn("px-3 py-2", falta && "bg-error-50/40")}>
                  <div className="flex items-center gap-2">
                    <div
                      draggable
                      onDragStart={(e) => empezar(e, { tipo: "zona", id: z.id })}
                      onDragEnd={() => { setArrastre(null); setSobre(null) }}
                      className={cn(
                        "min-w-0 flex-1 cursor-grab rounded-md border px-2 py-1 text-sm font-semibold active:cursor-grabbing",
                        falta ? "border-error-300 bg-white text-error-800" : "border-neutro-200 bg-neutro-50 text-azul-900",
                      )}
                      title="Arrastrá a un día del calendario"
                    >
                      <span className="block truncate">{z.nombre}</span>
                    </div>
                    <div className="flex items-center rounded-md border" title="Días que dura el viaje a esta zona">
                      <button className="px-1 py-1 text-neutro-500 hover:text-azul-700 disabled:opacity-30" disabled={z.dias_viaje <= 1} onClick={() => patchZona(z.id, { dias_viaje: z.dias_viaje - 1 })} aria-label="Un día menos"><Minus className="size-3" /></button>
                      <span className="w-9 text-center text-xs tabular-nums">{z.dias_viaje} {z.dias_viaje === 1 ? "día" : "días"}</span>
                      <button className="px-1 py-1 text-neutro-500 hover:text-azul-700 disabled:opacity-30" disabled={z.dias_viaje >= 15} onClick={() => patchZona(z.id, { dias_viaje: z.dias_viaje + 1 })} aria-label="Un día más"><Plus className="size-3" /></button>
                    </div>
                    <button className="text-neutro-400 hover:text-neutro-700" title="No se visita con viaje programado (sacar del calendario)" onClick={() => patchZona(z.id, { en_calendario: false })} aria-label={`Sacar ${z.nombre} del calendario`}>
                      <EyeOff className="size-4" />
                    </button>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                    {c.reales.map((v) => <span key={v.id} className="rounded bg-exito-100 px-1.5 py-0.5 font-medium text-exito-800">{fechaCorta(v.fecha)}{v.dias > 1 ? ` · ${v.dias} días` : ""}</span>)}
                    {c.borradores.map((b) => <span key={b.key} className="rounded border border-dashed border-ambar-400 bg-ambar-50 px-1.5 py-0.5 font-medium text-ambar-800">borrador {fechaCorta(b.fecha)}</span>)}
                    {falta && <span className="font-semibold text-error-700">sin viaje</span>}
                  </div>
                  {/* Sin arrastrar (celular): fecha a mano */}
                  <div className="mt-1 flex items-center gap-1">
                    <DateInputAR className="h-7 text-xs" value={fechaZona[z.id] || ""} onChange={(v: string) => setFechaZona((p) => ({ ...p, [z.id]: v }))} />
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!fechaZona[z.id]}
                      onClick={() => { agregarBorrador(z.id, fechaZona[z.id]); setFechaZona((p) => ({ ...p, [z.id]: "" })) }}>
                      Agregar
                    </Button>
                  </div>
                </div>
              )
            })}
            {ocultas.length > 0 && (
              <div className="px-3 py-2">
                <button className="text-xs font-medium text-neutro-500 hover:text-azul-700" onClick={() => setVerOcultas((x) => !x)}>
                  {verOcultas ? "Ocultar" : "Ver"} zonas fuera del calendario ({ocultas.length})
                </button>
                {verOcultas && (
                  <div className="mt-1 space-y-1">
                    {ocultas.map((z) => (
                      <div key={z.id} className="flex items-center justify-between text-sm text-neutro-500">
                        <span>{z.nombre}</span>
                        <button className="flex items-center gap-1 text-xs hover:text-azul-700" onClick={() => patchZona(z.id, { en_calendario: true })}>
                          <Eye className="size-3.5" /> Volver a incluir
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Calendario del mes */}
        <div className="overflow-hidden rounded-xl border bg-white">
          <div className="grid grid-cols-7 border-b bg-neutro-50 text-xs font-semibold text-neutro-500">
            {DIAS_SEMANA.map((d) => <div key={d} className="px-2 py-2 text-center">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {celdas.map((dia, i) => {
              const items = dia ? porDia.get(dia) || [] : []
              return (
                <div
                  key={dia ?? `x${i}`}
                  className={cn(
                    "min-h-28 border-b border-r p-1.5 transition-colors [&:nth-child(7n)]:border-r-0",
                    !dia && "bg-neutro-50/60",
                    dia && sobre === dia && "bg-ambar-50 ring-2 ring-inset ring-ambar-400",
                  )}
                  onDragOver={(e) => dia && aceptar(e, dia)}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node) && sobre === dia) setSobre(null) }}
                  onDrop={(e) => { if (!dia) return; e.preventDefault(); soltar({ dia }) }}
                >
                  {dia && (
                    <>
                      <span className="mb-1 grid size-6 place-items-center rounded-full text-xs font-semibold text-neutro-500">{Number(dia.slice(8))}</span>
                      <div className="space-y-1">
                        {items.map((it) =>
                          it.tipo === "viaje" ? (
                            <div
                              key={`v${it.v.id}-${it.n}`}
                              draggable={["programado", "despachado"].includes(it.v.estado)}
                              onDragStart={(e) => empezar(e, { tipo: "viaje", id: it.v.id, desfase: it.n - 1 })}
                              onDragEnd={() => { setArrastre(null); setSobre(null) }}
                              onDragOver={(e) => arrastre?.tipo === "zona" && aceptar(e, `v:${it.v.id}`)}
                              onDrop={(e) => { if (arrastre?.tipo !== "zona") return; e.preventDefault(); e.stopPropagation(); soltar({ viaje: it.v }) }}
                              onClick={() => router.push(`/viajes/${it.v.id}`)}
                              className={cn(
                                "cursor-pointer rounded-lg border bg-white px-2 py-1 shadow-xs hover:border-azul-200",
                                sobre === `v:${it.v.id}` && "border-cian-500 ring-2 ring-cian-500",
                              )}
                              title="Viaje ya programado: arrastralo para cambiar la fecha, o soltá una zona encima para sumarla"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className={cn("size-2 shrink-0 rounded-full", ESTADO_VIAJE_COLOR[it.v.estado] || "bg-neutro-400")} />
                                <span className="truncate text-xs font-semibold text-azul-900">{it.v.zonas.map((z) => z.nombre).join(" + ") || it.v.nombre}</span>
                                {it.v.dias > 1 && <span className="shrink-0 text-[11px] text-neutro-400">{it.n}/{it.v.dias}</span>}
                              </div>
                            </div>
                          ) : (
                            <div
                              key={`b${it.b.key}-${it.n}`}
                              draggable
                              onDragStart={(e) => empezar(e, { tipo: "borrador", key: it.b.key, desfase: it.n - 1 })}
                              onDragEnd={() => { setArrastre(null); setSobre(null) }}
                              onDragOver={(e) => arrastre?.tipo === "zona" && aceptar(e, `b:${it.b.key}`)}
                              onDrop={(e) => { if (arrastre?.tipo !== "zona") return; e.preventDefault(); e.stopPropagation(); soltar({ borrador: it.b }) }}
                              className={cn(
                                "cursor-grab rounded-lg border border-dashed border-ambar-400 bg-ambar-50 px-2 py-1 active:cursor-grabbing",
                                sobre === `b:${it.b.key}` && "border-cian-500 bg-cian-50 ring-2 ring-cian-500",
                              )}
                              title="Borrador: arrastralo a otro día, soltá otra zona encima para que viajen juntas"
                            >
                              <div className="flex items-start gap-1">
                                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ambar-900">{nombresZonas(it.b.zona_ids)}</span>
                                {it.n === 1 && (
                                  <button className="shrink-0 text-ambar-600 hover:text-error-600" onClick={() => setBorradores((prev) => prev.filter((b) => b.key !== it.b.key))} aria-label="Quitar borrador">
                                    <X className="size-3.5" />
                                  </button>
                                )}
                              </div>
                              {it.n === 1 ? (
                                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ambar-800">
                                  <button className="disabled:opacity-30" disabled={it.b.dias <= 1} onClick={() => setBorradores((prev) => prev.map((b) => (b.key === it.b.key ? { ...b, dias: b.dias - 1 } : b)))} aria-label="Un día menos"><Minus className="size-3" /></button>
                                  <span className="tabular-nums">{it.b.dias} {it.b.dias === 1 ? "día" : "días"}</span>
                                  <button className="disabled:opacity-30" disabled={it.b.dias >= 15} onClick={() => setBorradores((prev) => prev.map((b) => (b.key === it.b.key ? { ...b, dias: b.dias + 1 } : b)))} aria-label="Un día más"><Plus className="size-3" /></button>
                                </div>
                              ) : (
                                <div className="text-[11px] text-ambar-700">día {it.n}/{it.b.dias}</div>
                              )}
                            </div>
                          ),
                        )}
                        {sobre === dia && arrastre?.tipo === "zona" && (
                          <div className="rounded-md border border-dashed border-ambar-400 px-2 py-1 text-[11px] font-medium text-ambar-800">Soltá para viajar este día</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Los borradores (punteados) se guardan en este navegador hasta que tocás "Guardar". Los viajes ya programados (con borde lleno) se cambian al instante.
      </p>
    </div>
  )
}

export default function PlanificarViajesPage() {
  return (
    <Suspense fallback={null}>
      <Planificador />
    </Suspense>
  )
}
