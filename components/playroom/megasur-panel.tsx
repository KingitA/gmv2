"use client"

// Chat con Megasur (el cerebro de Playroom). Siempre abierto al costado del tablero.
// Habla el "idioma" acordado con la sesión del cerebro (lib/playroom/bloques.ts):
// respuesta en texto + bloques (tablas, gráficos, números) + qué consultó + sugerencias.
// Megasur solo LEE el sistema: nada de lo que se pregunte acá modifica datos.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react"
import { ArrowUp, Pin, Search, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Bloque, RespuestaChat } from "@/lib/playroom/bloques"
import { BloqueVista, tablaDesdeFilas } from "./bloque-vista"

interface Mensaje {
  rol: "yo" | "megasur"
  texto: string
  bloques?: Bloque[]
  consultado?: string[]
  sugerencias?: string[]
  error?: boolean
}

const SUGERENCIAS_INICIALES = [
  "¿Cuánto vendimos este mes?",
  "¿Qué clientes deben más?",
  "Compará los viajantes del mes",
  "¿Qué artículos no se mueven hace 60 días?",
]

export interface MegasurPanelRef { preguntar: (texto: string) => void }

export const MegasurPanel = forwardRef<MegasurPanelRef, { onFijar: (b: Bloque) => void; className?: string }>(
  function MegasurPanel({ onFijar, className }, ref) {
    const [mensajes, setMensajes] = useState<Mensaje[]>([])
    const [historial, setHistorial] = useState<unknown[]>([])
    const [texto, setTexto] = useState("")
    const [pensando, setPensando] = useState(false)
    const [fijados, setFijados] = useState<Set<string>>(new Set())
    const finRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => { finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }) }, [mensajes, pensando])

    async function enviar(pregunta?: string) {
      const msg = (pregunta ?? texto).trim()
      if (!msg || pensando) return
      setTexto("")
      setMensajes(m => [...m, { rol: "yo", texto: msg }])
      setPensando(true)
      try {
        const res = await fetch("/api/playroom/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mensaje: msg, historial }),
        })
        const json: RespuestaChat & { data?: any[] } = await res.json()
        if (!res.ok || json.error) throw new Error(json.error || `Error ${res.status}`)
        // Compatibilidad con el cerebro actual: si no manda bloques pero sí filas sueltas, se arma una tabla
        const bloques = json.bloques?.length ? json.bloques : (() => { const t = json.data ? tablaDesdeFilas(json.data) : null; return t ? [t] : [] })()
        setMensajes(m => [...m, { rol: "megasur", texto: json.respuesta || "", bloques, consultado: json.consultado, sugerencias: json.sugerencias }])
        setHistorial((json.historial ?? json.historial_actualizado ?? historial) as unknown[])
      } catch (e: any) {
        setMensajes(m => [...m, { rol: "megasur", texto: `No pude responder: ${e?.message || "error de conexión"}. Probá de nuevo en un momento.`, error: true }])
      } finally {
        setPensando(false)
      }
    }

    useImperativeHandle(ref, () => ({
      preguntar: (t: string) => { enviar(t); inputRef.current?.focus() },
    }))

    const ultimas = [...mensajes].reverse().find(m => m.rol === "megasur" && m.sugerencias?.length)?.sugerencias
    const sugerencias = mensajes.length === 0 ? SUGERENCIAS_INICIALES : ultimas ?? []

    return (
      <aside className={cn("flex min-h-0 flex-col overflow-hidden rounded-2xl border border-neutro-200 bg-white", className)}>
        <header className="flex items-center gap-3 border-b border-neutro-100 px-4 py-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-azul-700 to-cian-500 text-sm font-extrabold text-white">M</div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold leading-tight text-azul-900">Megasur</p>
            <p className="text-xs font-semibold text-exito-600">● Lee todo el sistema · no modifica nada</p>
          </div>
          {mensajes.length > 0 && (
            <button type="button" onClick={() => { setMensajes([]); setHistorial([]); setFijados(new Set()) }} title="Empezar una conversación nueva"
              className="grid size-8 place-items-center rounded-lg text-neutro-400 hover:bg-neutro-100 hover:text-neutro-700">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-neutro-50 px-4 py-4">
          {mensajes.length === 0 && (
            <div className="rounded-xl border border-dashed border-neutro-200 bg-white px-4 py-5 text-center">
              <p className="text-sm font-semibold text-azul-900">Preguntale lo que quieras del negocio</p>
              <p className="mt-1 text-[13px] text-neutro-500">
                Ventas, clientes, deudas, stock, viajantes… Te responde con datos reales y te puede mostrar tablas y gráficos.
                Si una respuesta te sirve, fijala en el tablero.
              </p>
            </div>
          )}
          {mensajes.map((m, i) => m.rol === "yo" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-azul-600 px-3.5 py-2 text-sm text-white">{m.texto}</div>
          ) : (
            <div key={i} className="max-w-[96%] space-y-2">
              {m.consultado?.length ? (
                <p className="flex items-start gap-1.5 text-xs text-neutro-500">
                  <Search className="mt-0.5 h-3 w-3 shrink-0 text-cian-600" />
                  <span>Revisé: {m.consultado.join(" · ")}</span>
                </p>
              ) : null}
              <div className={cn("rounded-2xl rounded-bl-md border bg-white px-3.5 py-3 text-sm leading-relaxed",
                m.error ? "border-error-200 text-error-700" : "border-neutro-200 text-neutro-800")}>
                {m.texto && <Markdown texto={m.texto} />}
                {m.bloques?.map((b, j) => {
                  const k = `${i}-${j}`
                  return (
                    <div key={k} className="mt-3 rounded-xl border border-neutro-100 bg-neutro-50/60 p-3">
                      <p className="mb-2 text-[13px] font-semibold text-neutro-600">{b.titulo}</p>
                      <BloqueVista bloque={b} compacto />
                      <div className="mt-2 flex justify-end">
                        <button type="button" disabled={fijados.has(k)}
                          onClick={() => { onFijar(b); setFijados(s => new Set(s).add(k)) }}
                          className="inline-flex items-center gap-1 rounded-full border border-neutro-200 bg-white px-2.5 py-1 text-xs font-semibold text-azul-600 hover:bg-azul-50 disabled:border-exito-200 disabled:text-exito-600">
                          <Pin className="h-3 w-3" />{fijados.has(k) ? "Fijado en el tablero" : "Fijar en el tablero"}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {pensando && (
            <div className="flex items-center gap-2 text-xs text-neutro-500" role="status">
              <span className="flex gap-1">
                {[0, 1, 2].map(n => <span key={n} className="size-1.5 animate-bounce rounded-full bg-cian-500" style={{ animationDelay: `${n * 150}ms` }} />)}
              </span>
              Megasur está revisando los datos…
            </div>
          )}
          <div ref={finRef} />
        </div>

        {sugerencias.length > 0 && !pensando && (
          <div className="flex flex-wrap gap-1.5 border-t border-neutro-100 px-4 pt-3">
            {sugerencias.slice(0, 4).map(s => (
              <button key={s} type="button" onClick={() => enviar(s)}
                className="rounded-full border border-neutro-200 bg-white px-2.5 py-1 text-xs font-semibold text-azul-600 hover:bg-azul-50">
                {s}
              </button>
            ))}
          </div>
        )}
        <form className="px-4 pb-3 pt-3" onSubmit={e => { e.preventDefault(); enviar() }}>
          <div className="flex items-end gap-2 rounded-2xl border-[1.5px] border-azul-100 bg-white p-1.5 pl-3 focus-within:border-azul-400">
            <textarea
              ref={inputRef}
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar() } }}
              rows={1}
              placeholder="Preguntale a Megasur…"
              className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-sm text-neutro-800 outline-none placeholder:text-neutro-400"
            />
            <button type="submit" disabled={!texto.trim() || pensando} aria-label="Enviar"
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-azul-600 text-white hover:bg-azul-700 disabled:bg-neutro-200">
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-neutro-400">Responde con datos reales del sistema · Enter envía, Shift+Enter baja de línea</p>
        </form>
      </aside>
    )
  },
)

// ── Markdown simple: títulos, listas, negritas y tablas (las tablas se dibujan como bloques) ──
function enLinea(t: string): ReactNode[] {
  const partes = t.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g)
  return partes.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <b key={i} className="font-bold text-azul-900">{p.slice(2, -2)}</b>
    : p.startsWith("`") && p.endsWith("`") ? <code key={i} className="rounded bg-neutro-100 px-1 text-[12px]">{p.slice(1, -1)}</code>
    : p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <i key={i}>{p.slice(1, -1)}</i>
    : p,
  )
}

function Markdown({ texto }: { texto: string }) {
  const lineas = texto.replace(/\r/g, "").split("\n")
  const out: ReactNode[] = []
  let i = 0
  while (i < lineas.length) {
    const l = lineas[i]
    // Tabla markdown: | a | b |  +  |---|---|
    if (l.trim().startsWith("|") && lineas[i + 1]?.trim().match(/^\|?\s*:?-{2,}/)) {
      const celdas = (x: string) => x.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim())
      const cab = celdas(l)
      const filas: string[][] = []
      i += 2
      while (i < lineas.length && lineas[i].trim().startsWith("|")) { filas.push(celdas(lineas[i])); i++ }
      const claves = cab.map((_, k) => `c${k}`)
      out.push(
        <div key={`t${i}`} className="my-2">
          <BloqueVista bloque={{
            tipo: "tabla", titulo: "",
            columnas: cab.map((c, k) => ({ clave: claves[k], titulo: c.replace(/\*/g, ""), formato: "texto" as const })),
            filas: filas.map(f => Object.fromEntries(claves.map((c, k) => [c, (f[k] || "").replace(/\*\*/g, "")]))),
          }} />
        </div>,
      )
      continue
    }
    if (/^#{1,4}\s/.test(l)) { out.push(<p key={i} className="mt-2 font-bold text-azul-900">{enLinea(l.replace(/^#{1,4}\s/, ""))}</p>); i++; continue }
    if (/^\s*([-•*]|\d+\.)\s/.test(l)) {
      const items: string[] = []
      const numerada = /^\s*\d+\./.test(l)
      while (i < lineas.length && /^\s*([-•*]|\d+\.)\s/.test(lineas[i])) { items.push(lineas[i].replace(/^\s*([-•*]|\d+\.)\s/, "")); i++ }
      const Lista = numerada ? "ol" : "ul"
      out.push(<Lista key={`l${i}`} className={cn("my-1 space-y-0.5 pl-5", numerada ? "list-decimal" : "list-disc")}>{items.map((it, k) => <li key={k}>{enLinea(it)}</li>)}</Lista>)
      continue
    }
    if (l.trim() === "") { i++; continue }
    out.push(<p key={i} className="my-1">{enLinea(l)}</p>)
    i++
  }
  return <div>{out}</div>
}
