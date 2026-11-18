"use client"

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react"
import { fecha, fechaCorta, moneda, sumarDiasISO } from "@/lib/formato"
import { cn } from "@/lib/utils"
import type { BloqueMedio, DiaProyeccion, GrupoProveedor } from "@/lib/finanzas/pagos-semana"

/**
 * Pagos de la semana (E-71) + proyección de caja (E-69). Solo lectura: desde cada proveedor
 * se abre la Nueva orden de pago con sus vencimientos ya tildados.
 */

interface Respuesta {
  semana: { desde: string; hasta: string; hoy: string }
  es_semana_actual: boolean
  aviso_retencion: string | null
  bloques: BloqueMedio[]
  totales: { bruto: number; retencion: number; neto: number; atrasado: number }
  bancos: { cuentas: Array<{ cuenta_id: string; nombre: string; saldo: number; alcanza: boolean }>; sale: number; saldo: number; alcanza: boolean; falta: number }
  efectivo: { cuentas: Array<{ cuenta_id: string; nombre: string; saldo: number }>; sale: number; saldo: number; alcanza: boolean; falta: number; por_dia: Array<{ dia: string; monto: number }> }
  cartera: { disponibles: number; monto_disponible: number; reservados: Array<{ id: string; banco: string; numero: string; fecha_vencimiento: string; monto: number; orden_pago: string }> }
  lo_que_viene: { total: number; items: Array<{ id: string; concepto: string; proveedor: string; fecha_vencimiento: string; monto: number }> }
  proyeccion: { saldo_inicial: number; dias: DiaProyeccion[]; minimo: { dia: string; saldo: number } | null }
}

const Tarjeta = ({ titulo, derecha, ayuda, children }: { titulo: string; derecha?: ReactNode; ayuda?: string; children: ReactNode }) => (
  <section className="mb-3 rounded-2xl border border-neutro-200 bg-white p-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-bold text-azul-900">{titulo}</h2>
      {derecha}
    </div>
    {ayuda && <p className="mt-0.5 text-[13px] text-neutro-500">{ayuda}</p>}
    <div className="mt-2">{children}</div>
  </section>
)

const Dato = ({ etiqueta, valor, nota, tono }: { etiqueta: string; valor: string; nota?: string; tono?: "mal" | "bien" }) => (
  <div className="rounded-xl border border-neutro-200 bg-white px-3 py-2">
    <div className="text-[13px] font-semibold text-neutro-600">{etiqueta}</div>
    <div className={cn("text-xl font-bold tabular-nums", tono === "mal" ? "text-red-700" : tono === "bien" ? "text-emerald-700" : "text-azul-900")}>{valor}</div>
    {nota && <div className="text-xs text-neutro-500">{nota}</div>}
  </div>
)

const Alcanza = ({ ok, falta }: { ok: boolean; falta?: number }) => ok
  ? <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Alcanza</span>
  : <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-red-700"><AlertTriangle className="h-4 w-4" /> No alcanza{falta ? `: faltan ${moneda(falta)}` : ""}</span>

function FilaProveedor({ g, medio }: { g: GrupoProveedor; medio: BloqueMedio["medio"] }) {
  return (
    <div className="border-t border-neutro-100 py-2 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-semibold text-neutro-900">{g.nombre}</span>
          {g.retencion > 0 && (
            <span className="ml-2 text-xs text-neutro-500">
              {moneda(g.bruto)} − retención estimada {moneda(g.retencion)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-base font-bold tabular-nums text-azul-900">{moneda(g.neto)}</span>
          {g.url_pagar && (
            <Button size="sm" variant="outline" asChild>
              <Link href={g.url_pagar}>Armar orden de pago</Link>
            </Button>
          )}
        </div>
      </div>
      <ul className="mt-1 space-y-0.5 text-[13px] text-neutro-700">
        {g.items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="min-w-0">
              <span className={cn("font-semibold", i.atrasado ? "text-red-700" : "text-neutro-600")}>
                {fechaCorta(i.fecha_vencimiento)}{i.atrasado ? " (atrasado)" : ""}
              </span>{" "}
              {i.concepto}
              {i.canal === "negro" && <span className="ml-1 rounded bg-neutro-800 px-1 text-[11px] font-semibold text-white">N</span>}
              {i.parcial && <span className="ml-1 text-xs text-neutro-500">(falta de {moneda(i.parcial.total)}; ya se pagó {moneda(i.parcial.pagado)})</span>}
              {i.fecha_cheque && (
                <span className="ml-1 text-xs font-semibold text-azul-700">
                  → {medio === "echeq" ? "e-cheq" : "cheque"} con fecha de pago {fecha(i.fecha_cheque)}
                </span>
              )}
            </span>
            <span className="tabular-nums">{moneda(i.neto)}</span>
          </li>
        ))}
      </ul>
      {medio === "cheque_tercero" && (
        <div className="mt-1.5 rounded-lg bg-neutro-50 px-2 py-1.5 text-[13px]">
          {g.cheques_sugeridos && g.cheques_sugeridos.length > 0 ? (
            <>
              <div className="font-semibold text-neutro-700">
                Cheques sugeridos ({g.cheques_sugeridos.length}): {moneda(g.cheques_sugeridos.reduce((s, c) => s + c.monto, 0))}
              </div>
              <ul className="mt-0.5 grid gap-x-4 sm:grid-cols-2">
                {g.cheques_sugeridos.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2 text-neutro-700">
                    <span className="truncate">{c.banco} {c.numero} · {fechaCorta(c.fecha_vencimiento)}{c.color === "NEGRO" ? " · N" : c.color === "ECHEQ" ? " · e-cheq" : ""}</span>
                    <span className="tabular-nums">{moneda(c.monto)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="text-neutro-600">No hay cheques en cartera que entren en el importe y en la fecha de este pago.</div>
          )}
          {(g.falta_cubrir ?? 0) > 0.01 && (
            <div className="mt-0.5 font-semibold text-ambar-800">Falta cubrir {moneda(g.falta_cubrir)}: se completa con transferencia o efectivo.</div>
          )}
        </div>
      )}
    </div>
  )
}

function PagosSemana() {
  const router = useRouter()
  const params = useSearchParams()
  const desdeParam = params.get("desde") ?? ""
  const [data, setData] = useState<Respuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [verTodosLosDias, setVerTodosLosDias] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    try {
      const r = await fetch(`/api/finanzas/pagos-semana${desdeParam ? `?desde=${desdeParam}` : ""}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || "No se pudo cargar")
      setData(j)
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar")
    } finally {
      setCargando(false)
    }
  }, [desdeParam])
  useEffect(() => { cargar() }, [cargar])

  const irA = (desde: string | null) => router.push(desde ? `/finanzas/pagos-semana?desde=${desde}` : "/finanzas/pagos-semana")

  const diasProy = data?.proyeccion.dias ?? []
  const diasVisibles = verTodosLosDias ? diasProy
    : diasProy.filter((d, i) => i === 0 || i === diasProy.length - 1 || d.pagos || d.cheques_propios || d.entra_cheques || d.estimado)

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azul-900">Pagos de la semana</h1>
          {data && (
            <p className="text-sm text-neutro-600">
              Del {fecha(data.semana.desde)} al {fecha(data.semana.hasta)}
              {data.es_semana_actual ? " — incluye lo atrasado" : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={!data} onClick={() => data && irA(sumarDiasISO(data.semana.desde, -7))}>
            <ChevronLeft className="h-4 w-4" /> Semana anterior
          </Button>
          <Button variant="outline" size="sm" disabled={!data || data.es_semana_actual} onClick={() => irA(null)}>Esta semana</Button>
          <Button variant="outline" size="sm" disabled={!data} onClick={() => data && irA(sumarDiasISO(data.semana.desde, 7))}>
            Semana siguiente <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" asChild><Link href="/vencimientos"><CalendarDays className="h-4 w-4" /> Calendario</Link></Button>
          <Button variant="outline" size="sm" onClick={cargar} disabled={cargando}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      {cargando && !data && <CargaProgreso compacto mensajes={MENSAJES.finanzas} className="mx-auto max-w-sm py-10" />}
      {error && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error} <button className="ml-2 font-semibold underline" onClick={cargar}>Reintentar</button>
        </div>
      )}

      {data && (
        <div className={cn(cargando && "opacity-60")}>
          {data.aviso_retencion && (
            <div className="mb-3 rounded-xl border border-ambar-200 bg-ambar-50 px-3 py-2 text-sm font-semibold text-ambar-800">{data.aviso_retencion}</div>
          )}

          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Dato etiqueta="A pagar esta semana" valor={moneda(data.totales.neto)}
              nota={data.totales.retencion > 0 ? `${moneda(data.totales.bruto)} − retención estimada ${moneda(data.totales.retencion)}` : "Sin retenciones estimadas"} />
            <Dato etiqueta="De eso, atrasado" valor={moneda(data.totales.atrasado)} tono={data.totales.atrasado > 0 ? "mal" : undefined} />
            <Dato etiqueta="Sale de bancos" valor={moneda(data.bancos.sale)} tono={data.bancos.alcanza ? undefined : "mal"}
              nota={`Saldo en bancos ${moneda(data.bancos.saldo)}${data.bancos.alcanza ? "" : ` — faltan ${moneda(data.bancos.falta)}`}`} />
            <Dato etiqueta="Efectivo a separar" valor={moneda(data.efectivo.sale)} tono={data.efectivo.alcanza ? undefined : "mal"}
              nota={`Saldo en cajas ${moneda(data.efectivo.saldo)}${data.efectivo.alcanza ? "" : ` — faltan ${moneda(data.efectivo.falta)}`}`} />
          </div>

          {data.bloques.length === 0 && (
            <div className="mb-3 rounded-2xl border border-neutro-200 bg-white px-3 py-8 text-center text-neutro-600">No hay nada para pagar en esta semana.</div>
          )}

          {data.bloques.map((b) => (
            <Tarjeta key={b.medio} titulo={b.titulo} ayuda={b.ayuda}
              derecha={<span className="text-base font-bold tabular-nums text-azul-900">{moneda(b.neto)}</span>}>
              {(b.medio === "transferencia" || b.medio === "echeq") && (
                <div className="mb-2 rounded-lg bg-neutro-50 px-2 py-1.5 text-[13px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-neutro-700">
                      Entre transferencias y e-cheq salen de bancos {moneda(data.bancos.sale)} · saldo total {moneda(data.bancos.saldo)}
                    </span>
                    <Alcanza ok={data.bancos.alcanza} falta={data.bancos.falta} />
                  </div>
                  <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">
                    {data.bancos.cuentas.map((c) => (
                      <li key={c.cuenta_id} className="flex justify-between gap-2">
                        <span className="truncate text-neutro-700">{c.nombre}</span>
                        <span className={cn("tabular-nums", c.alcanza ? "text-emerald-700" : "text-neutro-700")}>
                          {moneda(c.saldo)}{c.alcanza ? " · alcanza sola" : ""}
                        </span>
                      </li>
                    ))}
                    {data.bancos.cuentas.length === 0 && <li className="text-neutro-500">No hay cuentas bancarias cargadas.</li>}
                  </ul>
                </div>
              )}
              {b.medio === "efectivo" && (
                <div className="mb-2 rounded-lg bg-neutro-50 px-2 py-1.5 text-[13px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-neutro-700">
                      Cajas: {data.efectivo.cuentas.map((c) => `${c.nombre} ${moneda(c.saldo)}`).join(" · ") || "sin cajas cargadas"}
                    </span>
                    <Alcanza ok={data.efectivo.alcanza} falta={data.efectivo.falta} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-neutro-700">
                    {data.efectivo.por_dia.map((d) => (
                      <span key={d.dia}><b>{d.dia === data.semana.hoy ? "Hoy" : fechaCorta(d.dia)}</b>: {moneda(d.monto)}</span>
                    ))}
                  </div>
                </div>
              )}
              {b.medio === "cheque_tercero" && (
                <div className="mb-2 rounded-lg bg-neutro-50 px-2 py-1.5 text-[13px] text-neutro-700">
                  En cartera, libres: <b>{data.cartera.disponibles}</b> cheques por <b>{moneda(data.cartera.monto_disponible)}</b>
                  {data.cartera.reservados.length > 0 && <> · reservados por órdenes pendientes: <b>{data.cartera.reservados.length}</b> (abajo)</>}
                </div>
              )}
              {b.proveedores.map((g) => <FilaProveedor key={`${g.proveedor_id ?? g.nombre}`} g={g} medio={b.medio} />)}
            </Tarjeta>
          ))}

          {data.cartera.reservados.length > 0 && (
            <Tarjeta titulo="Cheques reservados" ayuda="Ya están elegidos en una orden de pago pendiente: no se sugieren para otro pago ni se pueden depositar."
              derecha={<span className="text-base font-bold tabular-nums text-azul-900">{moneda(data.cartera.reservados.reduce((s, c) => s + c.monto, 0))}</span>}>
              <ul className="grid gap-x-6 text-[13px] sm:grid-cols-2">
                {data.cartera.reservados.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2 text-neutro-700">
                    <span className="truncate">{c.banco} {c.numero} · {fechaCorta(c.fecha_vencimiento)} · OP {c.orden_pago}</span>
                    <span className="tabular-nums">{moneda(c.monto)}</span>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          {data.lo_que_viene.items.length > 0 && (
            <Tarjeta titulo="Lo que viene (estimados de órdenes de compra)"
              ayuda="Mercadería pedida que todavía no tiene factura. Es una estimación: NO está sumada a lo que hay que pagar."
              derecha={<span className="text-base font-bold tabular-nums text-neutro-600">{moneda(data.lo_que_viene.total)}</span>}>
              <ul className="text-[13px] text-neutro-700">
                {data.lo_que_viene.items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-2 border-t border-neutro-100 py-1 first:border-t-0">
                    <span className="min-w-0 truncate"><b>{fechaCorta(i.fecha_vencimiento)}</b> {i.proveedor ? `${i.proveedor} — ` : ""}{i.concepto}</span>
                    <span className="tabular-nums">{moneda(i.monto)}</span>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          <Tarjeta titulo={`Proyección de caja — próximos ${diasProy.length} días`}
            ayuda="Parte del saldo real de bancos y cajas de hoy. Resta los pagos (ya sin la retención) y los cheques propios que se van a debitar; suma los cheques de cartera y depositados el día que se cobran. Los estimados de órdenes de compra van aparte."
            derecha={<span className="text-sm text-neutro-600">Saldo hoy: <b className="tabular-nums text-azul-900">{moneda(data.proyeccion.saldo_inicial)}</b></span>}>
            {data.proyeccion.minimo && (
              <div className={cn("mb-2 rounded-lg px-2 py-1.5 text-[13px] font-semibold",
                data.proyeccion.minimo.saldo < 0 ? "bg-red-50 text-red-800" : "bg-neutro-50 text-neutro-700")}>
                {data.proyeccion.minimo.saldo < 0
                  ? `Atención: el ${fecha(data.proyeccion.minimo.dia)} el saldo quedaría en ${moneda(data.proyeccion.minimo.saldo)}.`
                  : `El punto más bajo es el ${fecha(data.proyeccion.minimo.dia)}: ${moneda(data.proyeccion.minimo.saldo)}.`}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-[13px] font-semibold text-neutro-600">
                    <th className="px-2 py-1">Día</th>
                    <th className="px-2 py-1 text-right">Pagos</th>
                    <th className="px-2 py-1 text-right">Cheques propios</th>
                    <th className="px-2 py-1 text-right">Entran cheques</th>
                    <th className="px-2 py-1 text-right">Saldo</th>
                    <th className="border-l border-neutro-200 px-2 py-1 text-right">Estimados</th>
                    <th className="px-2 py-1 text-right">Saldo si se pagan</th>
                  </tr>
                </thead>
                <tbody>
                  {diasVisibles.map((d) => (
                    <tr key={d.dia} className="border-t border-neutro-100 tabular-nums">
                      <td className="px-2 py-1 font-semibold text-neutro-700">{d.dia === data.semana.hoy ? "Hoy (con lo atrasado)" : fecha(d.dia)}</td>
                      <td className="px-2 py-1 text-right">{d.pagos ? `− ${moneda(d.pagos)}` : ""}</td>
                      <td className="px-2 py-1 text-right">{d.cheques_propios ? `− ${moneda(d.cheques_propios)}` : ""}</td>
                      <td className="px-2 py-1 text-right text-emerald-700">{d.entra_cheques ? `+ ${moneda(d.entra_cheques)}` : ""}</td>
                      <td className={cn("px-2 py-1 text-right font-bold", d.saldo < 0 ? "text-red-700" : "text-azul-900")}>{moneda(d.saldo)}</td>
                      <td className="border-l border-neutro-200 px-2 py-1 text-right text-neutro-500">{d.estimado ? moneda(d.estimado) : ""}</td>
                      <td className={cn("px-2 py-1 text-right", d.saldo_con_estimados < 0 ? "text-red-700" : "text-neutro-500")}>{moneda(d.saldo_con_estimados)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="mt-2 text-[13px] font-semibold text-azul-600 hover:underline" onClick={() => setVerTodosLosDias((v) => !v)}>
              {verTodosLosDias ? "Ver solo los días con movimientos" : "Ver todos los días"}
            </button>
          </Tarjeta>
        </div>
      )}
    </div>
  )
}

export default function PagosSemanaPage() {
  return (
    <Suspense fallback={<CargaProgreso compacto mensajes={MENSAJES.finanzas} className="mx-auto max-w-sm py-10" />}>
      <PagosSemana />
    </Suspense>
  )
}
