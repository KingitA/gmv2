"use client"

// Impuestos y gastos del banco (Tanda 2 del plan de bancos): totales por mes × banco × concepto,
// con el detalle de los renglones del banco al tocar un importe. Solo lectura.
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DateInputAR } from "@/components/ui/date-input-ar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fecha, moneda } from "@/lib/formato"
import { NOMBRE_TIPO, type TipoConcepto } from "@/lib/bancos/clasificacion"

interface Fila { mes: string; cuenta_bancaria_id: string; cuenta: string; concepto_id: string; concepto: string; tipo: TipoConcepto; orden: number; cantidad: number; neto: number }
interface Mov { id: string; fecha: string; hora: string | null; concepto_banco: string | null; descripcion: string | null; contraparte_nombre: string | null; monto: number }
interface Celda { cuenta: string | null; concepto: string; mes: string | null }

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`
const TIPOS: TipoConcepto[] = ["impuesto", "gasto", "pago", "financiero", "otro"]

/** Lo que salió (+) o entró (−) → texto: los ingresos (reversas, rendimientos) van con "+" y en verde */
function Importe({ neto, onClick }: { neto: number; onClick?: () => void }) {
  if (!neto) return <span className="text-muted-foreground">—</span>
  const txt = neto > 0 ? `+${moneda(neto)}` : moneda(-neto)
  const cls = neto > 0 ? "text-emerald-700" : ""
  return onClick ? <button className={`hover:underline ${cls}`} onClick={onClick}>{txt}</button> : <span className={cls}>{txt}</span>
}

export default function GastosBancariosPage() {
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [cuentaId, setCuentaId] = useState("todas")
  const [mes, setMes] = useState<string | null>(null)
  const [filas, setFilas] = useState<Fila[]>([])
  const [cuentas, setCuentas] = useState<{ id: string; nombre: string }[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [celda, setCelda] = useState<Celda | null>(null)
  const [movs, setMovs] = useState<Mov[] | null>(null)
  const [movsTot, setMovsTot] = useState(0)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    try {
      const q = new URLSearchParams()
      if (desde) q.set("desde", desde)
      if (hasta) q.set("hasta", hasta)
      if (cuentaId !== "todas") q.set("cuenta_id", cuentaId)
      const r = await fetch(`/api/finanzas/gastos-bancarios?${q}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setFilas(d.filas || []); setCuentas(d.cuentas || [])
      if (!desde) setDesde(d.desde)
      if (!hasta) setHasta(d.hasta)
      if (d.aviso) setError(d.aviso)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [desde, hasta, cuentaId])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar() }, [cuentaId])

  const meses = useMemo(() => [...new Set(filas.map((f) => f.mes))].sort(), [filas])
  const visibles = useMemo(() => (mes ? filas.filter((f) => f.mes === mes) : filas), [filas, mes])
  const columnas = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of visibles) m.set(f.cuenta_bancaria_id, f.cuenta)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [visibles])
  // concepto → cuenta → neto
  const matriz = useMemo(() => {
    const m = new Map<string, { concepto: string; tipo: TipoConcepto; orden: number; por: Map<string, number>; total: number }>()
    for (const f of visibles) {
      const r = m.get(f.concepto_id) ?? { concepto: f.concepto, tipo: f.tipo, orden: f.orden, por: new Map(), total: 0 }
      r.por.set(f.cuenta_bancaria_id, (r.por.get(f.cuenta_bancaria_id) ?? 0) + f.neto)
      r.total += f.neto
      m.set(f.concepto_id, r)
    }
    return [...m.entries()].sort((a, b) => a[1].orden - b[1].orden)
  }, [visibles])

  const abrir = async (c: Celda) => {
    setCelda(c); setMovs(null)
    const q = new URLSearchParams({ detalle: "1", concepto_id: c.concepto })
    if (c.mes) q.set("mes", c.mes)
    else { q.set("desde", desde); q.set("hasta", hasta) }
    const cta = c.cuenta ?? (cuentaId !== "todas" ? cuentaId : null)
    if (cta) q.set("cuenta_id", cta)
    const r = await fetch(`/api/finanzas/gastos-bancarios?${q}`)
    const d = await r.json()
    setMovs(r.ok ? d.filas || [] : []); setMovsTot(d.cantidad ?? 0)
  }
  const nombreCuenta = (id: string | null) => (id ? cuentas.find((c) => c.id === id)?.nombre ?? "" : "todos los bancos")

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <Link href="/finanzas/conciliacion"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <h1 className="text-xl font-bold mr-auto">Gastos bancarios</h1>
          <DateInputAR value={desde} onChange={setDesde} className="w-32" />
          <DateInputAR value={hasta} onChange={setHasta} className="w-32" />
          <Select value={cuentaId} onValueChange={setCuentaId}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos los bancos</SelectItem>
              {cuentas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => cargar()} disabled={cargando}>
            <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4 space-y-4">
        {error && <p className="text-sm text-amber-700">{error}</p>}

        {meses.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {[null, ...meses].map((m) => (
              <button key={m ?? "todo"} onClick={() => { setMes(m); setCelda(null) }}
                className={`rounded-full border px-3 py-1 text-xs ${mes === m ? "bg-foreground text-background" : "hover:bg-muted"}`}>
                {m ? nombreMes(m) : "Todo el período"}
              </button>
            ))}
          </div>
        )}

        {cargando && !filas.length ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted/40" />
        ) : !matriz.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Sin impuestos ni gastos bancarios en el período.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="px-3 py-2 font-medium">Concepto</th>
                  {columnas.map(([id, n]) => <th key={id} className="px-3 py-2 text-right font-medium">{n}</th>)}
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {TIPOS.map((tipo) => {
                  const del = matriz.filter(([, r]) => r.tipo === tipo)
                  if (!del.length) return null
                  const sub = (id?: string) => del.reduce((t, [, r]) => t + (id ? r.por.get(id) ?? 0 : r.total), 0)
                  return [
                    <tr key={tipo} className="border-b bg-muted/20 font-semibold">
                      <td className="px-3 py-1.5">{NOMBRE_TIPO[tipo]}</td>
                      {columnas.map(([id]) => <td key={id} className="px-3 py-1.5 text-right tabular-nums"><Importe neto={sub(id)} /></td>)}
                      <td className="px-3 py-1.5 text-right tabular-nums"><Importe neto={sub()} /></td>
                    </tr>,
                    ...del.map(([cid, r]) => (
                      <tr key={cid} className={`border-b ${celda?.concepto === cid ? "bg-sky-50" : ""}`}>
                        <td className="px-3 py-1.5 pl-6">{r.concepto}</td>
                        {columnas.map(([id]) => (
                          <td key={id} className="px-3 py-1.5 text-right tabular-nums">
                            <Importe neto={r.por.get(id) ?? 0} onClick={() => abrir({ cuenta: id, concepto: cid, mes })} />
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                          <Importe neto={r.total} onClick={() => abrir({ cuenta: null, concepto: cid, mes })} />
                        </td>
                      </tr>
                    )),
                  ]
                })}
              </tbody>
            </table>
          </div>
        )}

        {celda && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">
              {matriz.find(([id]) => id === celda.concepto)?.[1].concepto} · {nombreCuenta(celda.cuenta)} · {celda.mes ? nombreMes(celda.mes) : "todo el período"}
              {movs && <span className="ml-2 font-normal text-muted-foreground">{movsTot} renglones{movsTot > movs.length ? ` (se ven ${movs.length})` : ""}</span>}
            </h2>
            {!movs ? <div className="h-20 animate-pulse rounded-lg bg-muted/40" /> : (
              <div className="max-h-96 overflow-auto rounded-lg border">
                <table className="w-full text-xs">
                  <tbody>
                    {movs.map((m) => (
                      <tr key={m.id} className="border-b">
                        <td className="whitespace-nowrap px-3 py-1">{fecha(m.fecha)}{m.hora && m.hora !== "00:00:00" ? ` ${m.hora.slice(0, 5)}` : ""}</td>
                        <td className="px-3 py-1">{m.concepto_banco || m.descripcion}</td>
                        <td className="px-3 py-1 text-muted-foreground">{m.contraparte_nombre ?? ""}</td>
                        <td className="px-3 py-1 text-right tabular-nums"><Importe neto={m.monto} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
