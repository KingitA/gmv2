"use client"

// Ajustes de Jarvis (se abre como un informe de Playroom: ?informe=jarvis).
// - Reglas: a partir de cuánto avisa cada vigía (admin y administrativo).
// - Notas del negocio: lo que Jarvis tiene que saber (admin y administrativo).
// - Modelo y gasto: qué IA usa y el tope del mes (solo admin).
// - Historial de decisiones: quién hizo qué y cuándo (bitácora inborrable).
// Cada cambio queda registrado con nombre y hora.

import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { fecha as fmtFecha, fechaHora, numero, parseMonto } from "@/lib/formato"
import { JarvisExterior } from "./jarvis-exterior"

interface Regla { clave: string; valor: number | string; descripcion?: string | null; por?: string; at?: string }
interface Nota { clave: string; texto: string; por: string; at: string }
interface Datos { reglas: Regla[]; notas: Nota[]; modelos: Record<"pensador" | "rapido" | "respaldo", string>; esfuerzo_chat: string; tope_mensual_usd: number; gasto_mes_usd: number; soy_admin: boolean }
interface FilaHistorial { cuando: string; quien: string; que: string; sobre: string; nota: string | null }
interface Retenido { cliente_id: string; cliente: string; desde: string | null; motivo: string | null; decidio: string; debe: number; vencido_30: number }

const NOMBRE_REGLA: Record<string, string> = {
  regla_deuda_vencida_minima: "Deuda vencida mínima para avisar ($)",
  regla_dias_compra_reciente: "\"Volvió a pedir\" = pedido en los últimos (días)",
  regla_atraso_habitual: "Cliente habitual atrasado a partir de (veces su ritmo)",
  regla_cobertura_max_dias: "Avisar stock que alcance para menos de (días)",
  regla_venta_diaria_minima: "Solo artículos que venden por día al menos (unidades)",
  regla_dias_cobro_sin_verificar: "Cobros sin verificar en Caja hace más de (días)",
  regla_avisos: "Qué avisos mostrar",
  regla_suba_insumo_pct: "Suba de una materia prima afuera, en 30 días, para avisar (%)",
  regla_dias_sin_aumento: "Proveedor que no aumenta hace al menos (días)",
  regla_participacion_insumo: "Parte de lo que le vendemos que depende de esa materia prima (%)",
}

async function guardar(clave: string, valor: unknown) {
  const r = await fetch("/api/playroom/jarvis", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave, valor }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || "No se pudo guardar.")
}

export default function JarvisAjustes() {
  const [d, setD] = useState<Datos | null>(null)
  const [historial, setHistorial] = useState<FilaHistorial[] | null>(null)
  const [retenidos, setRetenidos] = useState<Retenido[] | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [nota, setNota] = useState("")

  const cargar = () => {
    fetch("/api/playroom/jarvis").then(r => r.json()).then(setD).catch(() => setD(null))
    fetch("/api/playroom/jarvis/historial?limite=100").then(r => r.json()).then(j => setHistorial(j.filas ?? [])).catch(() => setHistorial([]))
    fetch("/api/playroom/jarvis/retenidos").then(r => r.json()).then(j => setRetenidos(j.filas ?? [])).catch(() => setRetenidos([]))
  }
  useEffect(cargar, [])

  async function cambiar(clave: string, valor: unknown, okTexto = "Guardado. Quedó registrado a tu nombre.") {
    setMsg(null)
    try { await guardar(clave, valor); setMsg({ ok: true, t: okTexto }); cargar() } catch (e: any) { setMsg({ ok: false, t: e.message }) }
  }

  if (!d) return <p className="text-sm text-neutro-500">Cargando…</p>

  return (
    <div className="space-y-5">
      {msg && <p className={cn("rounded-xl px-4 py-2 text-sm font-semibold", msg.ok ? "bg-exito-50 text-exito-700" : "bg-alerta-50 text-alerta-700")}>{msg.t}</p>}

      <Caja titulo="Clientes con entregas retenidas" sub="El chofer no les baja mercadería sin cobrar. Se retienen con un Sí en “Para decidir”; acá se liberan. Queda a tu nombre.">
        {retenidos === null ? <p className="text-sm text-neutro-500">Cargando…</p> : retenidos.length === 0 ? <p className="text-sm text-neutro-500">Ningún cliente retenido.</p> : (
          <ul className="divide-y divide-neutro-100">
            {retenidos.map(r => (
              <li key={r.cliente_id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-[240px] flex-1">
                  <p className="text-sm font-semibold text-azul-900">{r.cliente}</p>
                  <p className="text-xs text-neutro-400">Desde {r.desde ? fmtFecha(r.desde) : "—"} · lo decidió {r.decidio}{r.motivo ? ` · ${r.motivo}` : ""}</p>
                </div>
                <p className="text-sm text-neutro-600">Debe <b>$ {numero(r.debe, 0)}</b>{r.vencido_30 > 0 && <> · vencido <b className="text-alerta-600">$ {numero(r.vencido_30, 0)}</b></>}</p>
                <button type="button" onClick={async () => {
                  setMsg(null)
                  const res = await fetch("/api/playroom/jarvis/retenidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cliente_id: r.cliente_id }) })
                  const j = await res.json().catch(() => ({}))
                  setMsg({ ok: res.ok, t: res.ok ? j.detalle : j.error || "No se pudo liberar." }); cargar()
                }} className="rounded-lg border border-neutro-200 px-3 py-1.5 text-xs font-semibold text-azul-600 hover:bg-azul-50">Liberar</button>
              </li>
            ))}
          </ul>
        )}
      </Caja>

      <Caja titulo="Materias primas y precios de afuera" sub="De qué depende el costo de cada artículo y cómo se mueven los precios de afuera. Con esto Jarvis propone comprar antes cuando algo sube y un proveedor todavía no aumentó.">
        <JarvisExterior onMensaje={setMsg} />
      </Caja>

      <Caja titulo="Reglas de los avisos" sub="A partir de cuánto Jarvis te avisa. Las define una persona; Jarvis propone los valores iniciales.">
        <ul className="divide-y divide-neutro-100">
          {d.reglas.map(r => <FilaRegla key={r.clave} regla={r} onGuardar={v => cambiar(r.clave, v)} />)}
        </ul>
      </Caja>

      <Caja titulo="Lo que Jarvis tiene que saber" sub="Notas del negocio que Jarvis lee antes de responder. Ej.: “Lanín es plásticos”, “a Grondona no se le retiene sin hablar con Juan”.">
        {d.notas.length === 0 && <p className="mb-2 text-sm text-neutro-500">Todavía no hay notas.</p>}
        <ul className="divide-y divide-neutro-100">
          {d.notas.map(n => (
            <li key={n.clave} className="flex items-start gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-neutro-800">{n.texto}</p>
                <p className="text-xs text-neutro-400">{n.por} · {fmtFecha(n.at)}</p>
              </div>
              <button type="button" title="Borrar nota (queda registrado)" onClick={() => cambiar(n.clave, null, "Nota borrada. Quedó registrado a tu nombre.")}
                className="grid size-7 place-items-center rounded-lg text-neutro-300 hover:bg-neutro-100 hover:text-alerta-600"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input value={nota} onChange={e => setNota(e.target.value)} placeholder="Escribí algo que Jarvis tenga que saber…"
            className="flex-1 rounded-lg border border-neutro-200 px-3 py-2 text-sm outline-none focus:border-azul-400" />
          <button type="button" disabled={!nota.trim()} onClick={() => { cambiar("nota:nueva", nota); setNota("") }}
            className="inline-flex items-center gap-1 rounded-lg bg-azul-600 px-3 py-2 text-sm font-semibold text-white hover:bg-azul-700 disabled:bg-neutro-200"><Plus className="h-4 w-4" />Agregar</button>
        </div>
      </Caja>

      <Caja titulo="Modelo de IA y gasto" sub={d.soy_admin ? "Cambiar el modelo no requiere programar. Antes de cambiar el principal, conviene correr el examen." : "Lo cambia solo un admin."}>
        <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-sm text-neutro-600">Gastado este mes: <b className="text-azul-900">USD {numero(d.gasto_mes_usd, 2)}</b> de USD {numero(d.tope_mensual_usd, 0)}</p>
          <div className="h-2 w-48 overflow-hidden rounded-full bg-neutro-100">
            <div className={cn("h-full rounded-full", d.gasto_mes_usd >= d.tope_mensual_usd ? "bg-alerta-500" : "bg-cian-500")}
              style={{ width: `${Math.min(100, d.tope_mensual_usd > 0 ? (d.gasto_mes_usd / d.tope_mensual_usd) * 100 : 100)}%` }} />
          </div>
        </div>
        <ul className="divide-y divide-neutro-100">
          {([["modelo_pensador", "Pensador (chat y resumen)", d.modelos.pensador], ["modelo_rapido", "Rápido (tareas chicas y si se pasa el tope)", d.modelos.rapido], ["modelo_respaldo", "Respaldo (si el pensador falla)", d.modelos.respaldo]] as const).map(([k, t, v]) => (
            <FilaTexto key={k} etiqueta={t} valor={v} editable={d.soy_admin} onGuardar={x => cambiar(k, x)} />
          ))}
          <li className="flex flex-wrap items-center gap-3 py-2">
            <p className="min-w-[240px] flex-1 text-sm font-semibold text-azul-900">Cuánto piensa antes de responder en el chat <span className="block text-xs font-normal text-neutro-400">Más = respuestas más pensadas, un poco más lentas y caras. Examen 14/10: normal 8,8 · alto 8,7 (no mejoró).</span></p>
            <select value={d.esfuerzo_chat} disabled={!d.soy_admin} onChange={e => cambiar("esfuerzo_chat", e.target.value)}
              className="w-56 rounded-lg border border-neutro-200 px-2 py-1.5 text-sm disabled:bg-neutro-50">
              <option value="low">Bajo</option><option value="medium">Normal</option><option value="high">Alto</option><option value="max">Máximo</option>
            </select>
          </li>
          <FilaTexto etiqueta="Tope mensual (USD)" valor={String(d.tope_mensual_usd)} editable={d.soy_admin} numerico onGuardar={x => cambiar("tope_mensual_usd", Number(x))} />
        </ul>
      </Caja>

      <Caja titulo="Historial de decisiones" sub="Quién hizo qué y cuándo. Esta bitácora no se puede modificar ni borrar.">
        {historial === null ? <p className="text-sm text-neutro-500">Cargando…</p> : historial.length === 0 ? <p className="text-sm text-neutro-500">Todavía no hay decisiones.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutro-500"><th className="py-1.5 pr-3 font-semibold">Cuándo</th><th className="pr-3 font-semibold">Quién</th><th className="pr-3 font-semibold">Qué</th><th className="pr-3 font-semibold">Sobre</th><th className="font-semibold">Nota</th></tr></thead>
              <tbody className="divide-y divide-neutro-100">
                {historial.map((h, i) => (
                  <tr key={i} className="align-top">
                    <td className="whitespace-nowrap py-1.5 pr-3 text-neutro-500">{fechaHora(h.cuando)}</td>
                    <td className="whitespace-nowrap pr-3 font-semibold text-azul-900">{h.quien}</td>
                    <td className="whitespace-nowrap pr-3">{h.que}</td>
                    <td className="pr-3 text-neutro-700">{String(h.sobre)}</td>
                    <td className="text-neutro-500">{h.nota ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Caja>
    </div>
  )
}

function Caja({ titulo, sub, children }: { titulo: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutro-200 bg-white p-4 sm:p-5">
      <h2 className="text-lg font-bold tracking-tight text-azul-900">{titulo}</h2>
      <p className="mb-3 text-[13px] text-neutro-500">{sub}</p>
      {children}
    </section>
  )
}

function FilaRegla({ regla, onGuardar }: { regla: Regla; onGuardar: (v: number | string) => void }) {
  const [v, setV] = useState(String(regla.valor))
  const cambio = v !== String(regla.valor)
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <div className="min-w-[240px] flex-1">
        <p className="text-sm font-semibold text-azul-900">{NOMBRE_REGLA[regla.clave] ?? regla.clave}</p>
        <p className="text-xs text-neutro-400">{regla.descripcion}{regla.por ? ` · ${regla.por}${regla.at ? `, ${fmtFecha(regla.at)}` : ""}` : ""}</p>
      </div>
      {regla.clave === "regla_avisos" ? (
        <select value={v} onChange={e => setV(e.target.value)} className="rounded-lg border border-neutro-200 px-2 py-1.5 text-sm">
          <option value="todo">Todos</option><option value="urgentes">Solo urgentes</option>
        </select>
      ) : (
        <input value={v} onChange={e => setV(e.target.value)} inputMode="decimal" className="w-28 rounded-lg border border-neutro-200 px-2 py-1.5 text-right text-sm outline-none focus:border-azul-400" />
      )}
      <button type="button" disabled={!cambio} onClick={() => onGuardar(regla.clave === "regla_avisos" ? v : parseMonto(v) ?? NaN)}
        className="rounded-lg bg-azul-600 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-neutro-200">Guardar</button>
    </li>
  )
}

function FilaTexto({ etiqueta, valor, editable, numerico, onGuardar }: { etiqueta: string; valor: string; editable: boolean; numerico?: boolean; onGuardar: (v: string) => void }) {
  const [v, setV] = useState(valor)
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <p className="min-w-[240px] flex-1 text-sm font-semibold text-azul-900">{etiqueta}</p>
      <input value={v} onChange={e => setV(e.target.value)} disabled={!editable} inputMode={numerico ? "decimal" : undefined}
        className="w-56 rounded-lg border border-neutro-200 px-2 py-1.5 text-sm outline-none focus:border-azul-400 disabled:bg-neutro-50 disabled:text-neutro-500" />
      {editable && <button type="button" disabled={v === valor} onClick={() => onGuardar(v)} className="rounded-lg bg-azul-600 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-neutro-200">Guardar</button>}
    </li>
  )
}
