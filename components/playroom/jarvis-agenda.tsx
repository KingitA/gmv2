"use client"

// "Para decidir y recordar": la agenda de Jarvis en Playroom.
// - Propuestas: Sí / No / Recordámelo. El Sí pide confirmar ("queda a tu nombre").
// - Recordatorios: Hecho / Posponer.
// Cada botón queda en la bitácora inborrable con nombre y hora (lib/jarvis/agenda.ts).

import { useEffect, useState } from "react"
import { BellRing, CalendarClock, Check, Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { fecha as fmtFecha, hoyISO, sumarDiasISO } from "@/lib/formato"
import { pesosCorto } from "@/lib/playroom/bloques"
import { DateInputAR } from "@/components/ui/date-input-ar"

interface Item {
  id: string; tipo: "propuesta" | "recordatorio"; tono: string | null; titulo: string; detalle: string | null
  fecha: string | null; accion: { tipo?: string; descripcion?: string } | null; impacto_estimado: number | null
  creado_por_nombre: string; creado_at: string; pospuesto_por_nombre?: string | null; vencido: boolean; puedo_decidir: boolean
  para_nombre: string | null
  sobre: string | null
  etiquetas: { si: string; no: string } | null
}

function proximoLunes() {
  const hoy = hoyISO()
  const dow = new Date(hoy + "T12:00:00Z").getUTCDay() // 0 = domingo
  return sumarDiasISO(hoy, ((8 - dow) % 7) || 7)
}

export function JarvisAgenda({ onPreguntar }: { onPreguntar: (t: string) => void }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [personas, setPersonas] = useState<{ id: string; nombre: string }[]>([])
  const [nuevo, setNuevo] = useState<{ titulo: string; fecha: string; para: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = () => fetch("/api/playroom/agenda").then(r => (r.ok ? r.json() : { items: [] })).then(j => { setItems(j.items ?? []); setPersonas(j.personas ?? []) }).catch(() => setItems([]))
  useEffect(() => { cargar() }, [])

  async function agregar() {
    if (!nuevo) return
    setError(null)
    const r = await fetch("/api/playroom/agenda", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nuevo) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setError(j.error || "No se pudo agendar."); return }
    setNuevo(null); cargar()
  }

  const propuestas = items?.filter(i => i.tipo === "propuesta") ?? []
  const recordatorios = items?.filter(i => i.tipo === "recordatorio") ?? []

  return (
    <section className="rounded-2xl border border-neutro-200 bg-white p-4 sm:p-5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold tracking-tight text-azul-900">Para decidir y recordar</h2>
        <span className="flex items-center gap-3 text-xs text-neutro-400">
          <span>Cada decisión queda con tu nombre y la hora</span>
          {!nuevo && (
            <button type="button" onClick={() => setNuevo({ titulo: "", fecha: sumarDiasISO(hoyISO(), 1), para: "yo" })}
              className="inline-flex items-center gap-1 rounded-full border border-neutro-200 bg-white px-2.5 py-1 font-semibold text-azul-600 hover:bg-azul-50">
              <Plus className="h-3 w-3" />Recordatorio
            </button>
          )}
        </span>
      </div>

      {nuevo && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-azul-50/50 p-3">
          <input autoFocus value={nuevo.titulo} onChange={e => setNuevo({ ...nuevo, titulo: e.target.value })} placeholder="¿Qué hay que recordar?"
            className="min-w-[220px] flex-1 rounded-lg border border-neutro-200 bg-white px-3 py-2 text-sm outline-none focus:border-azul-400" />
          <DateInputAR value={nuevo.fecha} onChange={v => setNuevo({ ...nuevo, fecha: v })} min={hoyISO()} className="w-36" />
          <select value={nuevo.para} onChange={e => setNuevo({ ...nuevo, para: e.target.value })} title="A quién le aparece"
            className="rounded-lg border border-neutro-200 bg-white px-2 py-2 text-sm">
            <option value="yo">Para mí</option>
            <option value="todos">Para todos</option>
            {personas.map(p => <option key={p.id} value={p.id}>Para {p.nombre}</option>)}
          </select>
          <button type="button" onClick={agregar} disabled={!nuevo.titulo.trim() || !nuevo.fecha}
            className="rounded-lg bg-azul-600 px-3 py-2 text-sm font-semibold text-white hover:bg-azul-700 disabled:bg-neutro-200">Agendar</button>
          <button type="button" onClick={() => { setNuevo(null); setError(null) }} className="rounded-lg px-2 py-2 text-sm text-neutro-500 hover:bg-neutro-100">Cancelar</button>
          {error && <p className="w-full text-xs text-alerta-600">{error}</p>}
        </div>
      )}

      {items === null ? null : items.length === 0 ? (
        <p className="rounded-xl bg-neutro-50 px-4 py-3 text-sm text-neutro-600">
          No hay nada pendiente. Podés pedirle a Jarvis en el chat: <i>"recordame el lunes revisar la deuda de Necochea"</i>, <i>"recordale a Mario…"</i> o <i>"dejalo para decidir"</i>.
        </p>
      ) : (
        <ul className="divide-y divide-neutro-100">
          {[...propuestas, ...recordatorios].map(i => <Fila key={i.id} item={i} onListo={cargar} onPreguntar={onPreguntar} />)}
        </ul>
      )}
    </section>
  )
}

function Fila({ item, onListo, onPreguntar }: { item: Item; onListo: () => void; onPreguntar: (t: string) => void }) {
  const [paso, setPaso] = useState<"" | "confirmar-si" | "no" | "posponer">("")
  const [nota, setNota] = useState("")
  const [fecha, setFecha] = useState(sumarDiasISO(hoyISO(), 1))
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string; abrir?: string } | null>(null)
  const esPropuesta = item.tipo === "propuesta"

  async function enviar(decision: "si" | "no" | "posponer", fechaElegida?: string) {
    setEnviando(true)
    try {
      const r = await fetch(`/api/playroom/agenda/${item.id}/decidir`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, nota: nota || null, fecha: fechaElegida ?? fecha }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setResultado({ ok: false, texto: j.error || "No se pudo." }); return }
      const texto = decision === "posponer" ? `Pospuesto para el ${fmtFecha(j.fecha)}.` : decision === "no" && j.estado === "rechazado" ? "Anotado: no." : j.estado === "error" ? `Se anotó tu Sí, pero falló al hacerlo: ${j.detalle}. Quedó en la agenda.` : j.detalle || "Hecho."
      setResultado({ ok: j.estado !== "error", texto, abrir: j.abrir })
      setPaso("")
      setTimeout(onListo, j.abrir ? 6000 : 1800)
    } finally { setEnviando(false) }
  }

  const tonoClase = item.tono === "alerta" ? "bg-alerta-50 text-alerta-600" : item.tono === "oportunidad" ? "bg-exito-50 text-exito-600" : "bg-azul-50 text-azul-600"

  return (
    <li className="flex gap-3 py-3">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", esPropuesta ? tonoClase : item.vencido ? "bg-alerta-50 text-alerta-600" : "bg-ambar-50 text-ambar-700")}>
        {esPropuesta ? <BellRing className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-azul-900">{item.titulo}</p>
        {esPropuesta && item.sobre && <p className="text-xs font-semibold text-azul-600">{item.sobre}</p>}
        {item.detalle && <p className="text-[13px] text-neutro-600">{item.detalle}</p>}
        <p className="mt-0.5 text-xs text-neutro-400">
          {esPropuesta ? "Propuesto" : "Pedido"} por {item.creado_por_nombre} · {fmtFecha(item.creado_at)}
          {!esPropuesta && <> · {item.para_nombre ? `para ${item.para_nombre}` : "para todos"}</>}
          {!esPropuesta && item.fecha && <> · <span className={cn(item.vencido && "font-semibold text-alerta-600")}>{item.vencido ? "era para el" : "para el"} {fmtFecha(item.fecha)}</span></>}
          {item.pospuesto_por_nombre && <> · pospuesto por {item.pospuesto_por_nombre}</>}
          {item.impacto_estimado ? <> · en juego {pesosCorto(item.impacto_estimado)}</> : null}
        </p>
        {esPropuesta && item.accion?.descripcion && item.accion.tipo !== "ninguna" && (
          <p className="mt-1 text-xs text-neutro-500">Si decís que sí: {item.accion.descripcion}</p>
        )}

        {resultado ? (
          <p className={cn("mt-2 text-xs font-semibold", resultado.ok ? "text-exito-600" : "text-alerta-600")}>
            {resultado.texto}
            {resultado.abrir && <a href={resultado.abrir} className="ml-2 inline-flex rounded-full bg-azul-600 px-3 py-1 text-white hover:bg-azul-700">Abrir</a>}
          </p>
        ) : !item.puedo_decidir ? (
          <p className="mt-2 text-xs text-neutro-500">Esto mueve plata: lo decide un admin.</p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {paso === "" && (
              <>
                <button type="button" disabled={enviando} onClick={() => (esPropuesta ? setPaso("confirmar-si") : enviar("si"))}
                  className="inline-flex items-center gap-1 rounded-full bg-azul-600 px-3 py-1 text-xs font-semibold text-white hover:bg-azul-700">
                  <Check className="h-3 w-3" />{esPropuesta ? item.etiquetas?.si ?? "Sí" : "Hecho"}
                </button>
                {esPropuesta && (
                  <button type="button" disabled={enviando} onClick={() => setPaso("no")}
                    className="inline-flex items-center gap-1 rounded-full border border-neutro-200 bg-white px-3 py-1 text-xs font-semibold text-neutro-700 hover:bg-neutro-50">
                    <X className="h-3 w-3" />{item.etiquetas?.no ?? "No"}
                  </button>
                )}
                <button type="button" disabled={enviando} onClick={() => setPaso("posponer")}
                  className="rounded-full border border-neutro-200 bg-white px-3 py-1 text-xs font-semibold text-neutro-700 hover:bg-neutro-50">
                  {esPropuesta ? "Recordámelo" : "Posponer"}
                </button>
                {esPropuesta && (
                  <button type="button" onClick={() => onPreguntar(`Sobre esto que propusiste: "${item.titulo}". ¿Qué me conviene? Mostrame los números.`)}
                    className="rounded-full px-2 py-1 text-xs font-semibold text-azul-600 hover:bg-azul-50">Preguntarle a Jarvis</button>
                )}
              </>
            )}
            {paso === "confirmar-si" && (
              <>
                <span className="text-xs text-neutro-600">{item.etiquetas ? `¿Confirmás "${item.etiquetas.si}"?` : "¿Confirmás?"} Queda a tu nombre.</span>
                <button type="button" disabled={enviando} onClick={() => enviar("si")} className="rounded-full bg-azul-600 px-3 py-1 text-xs font-semibold text-white hover:bg-azul-700">{enviando ? "Anotando…" : "Sí, confirmo"}</button>
                <button type="button" onClick={() => setPaso("")} className="rounded-full px-2 py-1 text-xs text-neutro-500 hover:bg-neutro-100">Volver</button>
              </>
            )}
            {paso === "no" && (
              <>
                <input autoFocus value={nota} onChange={e => setNota(e.target.value)} placeholder={item.tono === "alerta" ? "¿Por qué no? (obligatorio)" : "¿Por qué no? (opcional)"}
                  className="min-w-[200px] flex-1 rounded-lg border border-neutro-200 px-2.5 py-1 text-xs outline-none focus:border-azul-400" />
                <button type="button" disabled={enviando || (item.tono === "alerta" && !item.etiquetas && !nota.trim())} onClick={() => enviar("no")}
                  className="rounded-full bg-neutro-700 px-3 py-1 text-xs font-semibold text-white disabled:bg-neutro-200">{item.etiquetas ? `Confirmar: ${item.etiquetas.no.toLowerCase()}` : "Anotar que no"}</button>
                <button type="button" onClick={() => setPaso("")} className="rounded-full px-2 py-1 text-xs text-neutro-500 hover:bg-neutro-100">Volver</button>
              </>
            )}
            {paso === "posponer" && (
              <>
                {[["Mañana", sumarDiasISO(hoyISO(), 1)], ["El lunes", proximoLunes()], ["En una semana", sumarDiasISO(hoyISO(), 7)]].map(([t, f]) => (
                  <button key={t} type="button" disabled={enviando} onClick={() => enviar("posponer", f)}
                    className="rounded-full border border-neutro-200 bg-white px-3 py-1 text-xs font-semibold text-azul-600 hover:bg-azul-50">{t}</button>
                ))}
                <DateInputAR value={fecha} onChange={setFecha} min={sumarDiasISO(hoyISO(), 1)} className="h-7 w-32 text-xs" />
                <button type="button" disabled={enviando || !fecha} onClick={() => enviar("posponer")} className="rounded-full bg-azul-600 px-3 py-1 text-xs font-semibold text-white">Ok</button>
                <button type="button" onClick={() => setPaso("")} className="rounded-full px-2 py-1 text-xs text-neutro-500 hover:bg-neutro-100">Volver</button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
