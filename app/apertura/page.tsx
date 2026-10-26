"use client"

// ─── Apertura de cuentas corrientes (regla del dueño 16/10/2026) ────────────
// Se sube el reporte "Comprobantes Impagos de Clientes" del sistema viejo
// (.chr). La pantalla lo lee, muestra cliente por cliente cómo queda y qué no
// coincide, y recién con todo en verde deja confirmar. Confirma de a tandas de
// clientes (para no pasar el tiempo máximo del servidor). Si se sube dos veces,
// no duplica. Solo admin. Lógica: lib/apertura/*.

import { Fragment, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { Upload } from "lucide-react"
import { fecha, moneda } from "@/lib/formato"
import { leerReporteImpagos, type RenglonApertura } from "@/lib/apertura/parsear-chr"

type ClientePrevia = {
  codigo_cliente: string
  nombre: string
  nombre_gmv2: string | null
  viajante: string
  es_empleado: boolean
  suma: number
  saldo_reporte: number
  saldo_actual_gmv2: number
  ya_cargados: number
  ajustes: number
  renglones: RenglonApertura[]
  errores: string[]
  avisos: string[]
}
type Previa = {
  clientes: ClientePrevia[]; total: number; renglones: number; bloqueantes: number
  importables: number; total_importable: number; total_con_error: number; puede_confirmar: boolean
}

const TANDA = 40

export default function AperturaPage() {
  const { toast } = useToast()
  const [archivo, setArchivo] = useState<string>("")
  const [fechaReporte, setFechaReporte] = useState<string | null>(null)
  const [renglones, setRenglones] = useState<RenglonApertura[]>([])
  const [erroresLectura, setErroresLectura] = useState<string[]>([])
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [cargando, setCargando] = useState(false)
  const [progreso, setProgreso] = useState<string>("")
  const [resultado, setResultado] = useState<{ comprobantes: number; a_cuenta: number; ajustes: number; salteados: number; errores: string[]; no_cuadran: string[]; no_importados: string[] } | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)

  const leer = async (f: File) => {
    setPrevia(null)
    setResultado(null)
    const buf = await f.arrayBuffer()
    // El sistema viejo exporta en Windows-1252 (ñ, acentos)
    const texto = new TextDecoder("windows-1252").decode(buf)
    const r = leerReporteImpagos(texto)
    setArchivo(f.name)
    setFechaReporte(r.fecha_reporte)
    setRenglones(r.renglones)
    setErroresLectura(r.errores)
    if (!r.renglones.length) return
    setCargando(true)
    try {
      const res = await fetch("/api/apertura", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "previsualizar", renglones: r.renglones }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setPrevia(j)
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setCargando(false)
    }
  }

  const confirmar = async () => {
    if (!previa?.puede_confirmar) return
    setCargando(true)
    const total = { comprobantes: 0, a_cuenta: 0, ajustes: 0, salteados: 0, errores: [] as string[], no_cuadran: [] as string[], no_importados: [] as string[] }
    try {
      // Solo los clientes sin error (#5): los otros se corrigen y se vuelve a subir el archivo
      const clientes = previa.clientes.filter((c) => !c.errores.length)
      total.no_importados = previa.clientes.filter((c) => c.errores.length).map((c) => `${c.codigo_cliente} ${c.nombre}`)
      for (let i = 0; i < clientes.length; i += TANDA) {
        const lote = clientes.slice(i, i + TANDA)
        setProgreso(`Cargando clientes ${i + 1} a ${Math.min(i + TANDA, clientes.length)} de ${clientes.length}…`)
        const res = await fetch("/api/apertura", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accion: "confirmar", renglones: lote.flatMap((c) => c.renglones) }),
        })
        const j = await res.json()
        if (!res.ok) throw new Error(j.error)
        total.comprobantes += j.comprobantes
        total.a_cuenta += j.a_cuenta
        total.ajustes += j.ajustes || 0
        total.salteados += j.salteados
        total.errores.push(...(j.errores || []))
        total.no_cuadran.push(...(j.control || []).filter((c: any) => !c.cuadra).map((c: any) => `${c.codigo_cliente} ${c.nombre}: libro ${moneda(c.saldo_libro)} · reporte ${moneda(c.saldo_reporte)}`))
      }
      setResultado(total)
      toast({ title: "Apertura cargada", description: `${total.comprobantes} comprobantes, ${total.a_cuenta} entregas a cuenta y ${total.ajustes} ajustes.` })
    } catch (e: any) {
      toast({ variant: "destructive", title: "Se cortó la carga", description: `${e.message}. Lo ya cargado quedó; volvé a confirmar y sigue desde ahí (no duplica).` })
      setResultado(total)
    } finally {
      setCargando(false)
      setProgreso("")
    }
  }

  const conProblemas = useMemo(() => (previa?.clientes || []).filter((c) => c.errores.length || c.avisos.length), [previa])

  return (
    <div className="container mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">Apertura de cuentas corrientes</h1>
        <p className="text-sm text-muted-foreground">
          Subí el reporte <b>Comprobantes Impagos de Clientes</b> del sistema viejo (todos los viajantes, incluidos empleados y socios).
          Se carga comprobante por comprobante, con su fecha. Nada se graba hasta que confirmes.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold hover:bg-muted">
            <Upload className="h-4 w-4" /> Elegir archivo (.chr)
            <input type="file" accept=".chr,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && leer(e.target.files[0])} />
          </label>
          {archivo && (
            <span className="text-sm text-muted-foreground">
              {archivo}{fechaReporte ? ` · reporte del ${fecha(fechaReporte)}` : ""} · {renglones.length} renglones
            </span>
          )}
          {cargando && <span className="text-sm">{progreso || "Revisando…"}</span>}
        </CardContent>
      </Card>

      {erroresLectura.length > 0 && (
        <Card className="border-red-300">
          <CardHeader><CardTitle className="text-base text-red-700">El archivo tiene renglones que no se pudieron leer</CardTitle></CardHeader>
          <CardContent><ul className="list-disc pl-5 text-sm">{erroresLectura.map((e) => <li key={e}>{e}</li>)}</ul></CardContent>
        </Card>
      )}

      {previa && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <div className="space-y-0.5 text-sm">
                <div>
                  <b>{previa.clientes.length}</b> clientes · <b>{previa.renglones}</b> renglones · total del archivo <b className="tabular-nums">{moneda(previa.total)}</b>
                </div>
                <div className="text-green-700">
                  Se cargan <b>{previa.importables}</b> clientes por <b className="tabular-nums">{moneda(previa.total_importable)}</b>
                </div>
                {previa.bloqueantes > 0 ? (
                  <div className="font-semibold text-red-600">
                    {previa.bloqueantes} clientes con error por <span className="tabular-nums">{moneda(previa.total_con_error)}</span> NO se cargan: corregilos y volvé a subir el archivo (lo ya cargado no se duplica)
                  </div>
                ) : (
                  <div className="font-semibold text-green-700">Todos los clientes cuadran</div>
                )}
              </div>
              <Button onClick={confirmar} disabled={!previa.puede_confirmar || cargando}>
                {previa.bloqueantes > 0 ? `Cargar los ${previa.importables} clientes sin error` : "Confirmar apertura"}
              </Button>
            </CardContent>
          </Card>

          {resultado && (
            <Card className={resultado.errores.length || resultado.no_cuadran.length ? "border-red-300" : "border-green-300"}>
              <CardHeader><CardTitle className="text-base">Resultado</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>{resultado.comprobantes} comprobantes, {resultado.a_cuenta} entregas a cuenta y {resultado.ajustes} ajustes cargados · {resultado.salteados} ya estaban (no se duplicaron).</p>
                {resultado.no_importados.length > 0 && <p className="font-semibold text-amber-700">No se cargaron por tener error: {resultado.no_importados.join(" · ")}</p>}
                {resultado.no_cuadran.length > 0 && <p className="font-semibold text-red-600">No cuadran contra el reporte: {resultado.no_cuadran.join(" · ")}</p>}
                {resultado.errores.map((e) => <p key={e} className="text-red-600">{e}</p>)}
              </CardContent>
            </Card>
          )}

          {conProblemas.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Para revisar</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {conProblemas.map((c) => (
                  <div key={c.codigo_cliente}>
                    <b>{c.codigo_cliente} · {c.nombre}</b>
                    {c.errores.map((e) => <p key={e} className="text-red-600">✗ {e}</p>)}
                    {c.avisos.map((a) => <p key={a} className="text-amber-700">⚠ {a}</p>)}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Cliente por cliente</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1 pr-2">Cliente</th><th className="pr-2">En gmv2</th><th className="pr-2">Viajante</th>
                    <th className="pr-2 text-right">Comprobantes</th><th className="pr-2 text-right">Saldo a cargar</th><th className="text-right">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.clientes.map((c) => (
                    <Fragment key={c.codigo_cliente}>
                      <tr className="cursor-pointer border-b hover:bg-muted/50" onClick={() => setAbierto(abierto === c.codigo_cliente ? null : c.codigo_cliente)}>
                        <td className="py-1 pr-2">{c.codigo_cliente} · {c.nombre}</td>
                        <td className="pr-2">{c.nombre_gmv2 || <span className="text-red-600">no existe</span>}{c.es_empleado && <Badge variant="secondary" className="ml-1">personal</Badge>}</td>
                        <td className="pr-2 text-muted-foreground">{c.viajante}</td>
                        <td className="pr-2 text-right tabular-nums">{c.renglones.length}{c.ajustes ? ` · ${c.ajustes} ajustes` : ""}{c.ya_cargados ? ` (${c.ya_cargados} ya cargados)` : ""}</td>
                        <td className="pr-2 text-right tabular-nums">{moneda(c.suma)}</td>
                        <td className="text-right">{c.errores.length ? <Badge variant="destructive">error</Badge> : c.avisos.length ? <Badge variant="secondary">revisar</Badge> : <Badge>ok</Badge>}</td>
                      </tr>
                      {abierto === c.codigo_cliente && (
                        <tr className="bg-muted/30">
                          <td colSpan={6} className="px-3 py-2">
                            <table className="w-full text-xs">
                              <tbody>
                                {c.renglones.map((r) => (
                                  <tr key={`${r.numero}-${r.linea}`}>
                                    <td className="pr-2">{r.tipo === "AJUSTE" ? <><Badge variant="secondary" className="mr-1">ajuste</Badge>{r.descripcion}</> : r.descripcion}</td>
                                    <td className="pr-2">{r.numero}{r.numero_original && r.numero_original !== r.numero ? <span className="text-muted-foreground"> (viejo {r.numero_original})</span> : null}</td>
                                    <td className="pr-2">{fecha(r.fecha)}</td><td className="pr-2">vto {fecha(r.vencimiento)}</td>
                                    <td className="pr-2 text-right tabular-nums">importe {moneda(r.importe)}</td>
                                    <td className="text-right tabular-nums">pendiente {moneda(r.pendiente)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
