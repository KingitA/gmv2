"use client"

// Bancos — Credicoop (Tanda 2-A). Estado de la conexión, VEP de ARCA para mandar a firmar,
// traer los movimientos de la cuenta para la conciliación, y el registro de todo lo que se mandó
// al banco. Todo lo que mueve plata queda en Credicoop esperando la firma con token.
// Solo admin (el servidor lo controla en cada ruta).

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { DateInputAR } from "@/components/ui/date-input-ar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, Landmark, RefreshCw, Send } from "lucide-react"
import { toast } from "sonner"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { avisarConfirmacion, CartelSimuladorReal, EstadoOperacionBanco, RechazarOperacionBanco, SIN_TERMINAR, type OperacionBanco } from "@/components/bancos/credicoop-orden-pago"
import { fecha, fechaHora, formatCuit, hoyISO, moneda, sumarDiasISO } from "@/lib/formato"
import { cn } from "@/lib/utils"

interface Operacion extends OperacionBanco {
  tipo: string; tipo_nombre: string; beneficiario: string | null; monto: number; fecha_pago: string | null
  numero_vep: string | null; orden_pago: string | null; orden_pago_numero: string | null; cuenta: string | null; creado_at: string
}
interface Estado {
  conexion: { conectado: boolean; ambiente: string | null; falta: string[]; simulador_en_produccion?: boolean }
  falta_migracion: boolean
  /** Órdenes cuyo pago el banco real ya hizo y siguen pendientes (revisión 19/11) */
  pagadas_sin_confirmar?: Array<{
    orden_pago_id: string; numero_op: string | null; proveedor: string | null; neto_a_pagar: number; pagado_por_banco: number
    ultima_firma: string | null; falla: string | null; falla_estado: string | null; falla_at: string | null
  }>
  cuentas: Array<{ id: string; nombre: string; cbu: string | null; tiene_cbu: boolean }>
  operaciones: Operacion[]
}
interface Vep {
  numeroVep: string; descripcion: string; concepto: string; periodoFiscal: string; vence: string | null
  monto: number | null; cuitContribuyente: string; operacion: OperacionBanco | null
}
interface Movs {
  cuenta: string; desde: string; hasta: string; traidos: number; saldo: number | null; parcial: boolean
  importado: { importados?: number; duplicados?: number } | null
  de_prueba?: boolean
  coincidencias: Array<{ operacion_id: string; tipo: string; beneficiario: string | null; monto: number; fecha_movimiento: string; descripcion: string }>
}

const Tarjeta = ({ titulo, ayuda, derecha, children }: { titulo: string; ayuda?: string; derecha?: React.ReactNode; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-neutro-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-bold text-azul-900">{titulo}</h2>
      {derecha}
    </div>
    {ayuda && <p className="mt-0.5 text-[13px] text-neutro-500">{ayuda}</p>}
    <div className="mt-3">{children}</div>
  </section>
)

export default function BancosPage() {
  const hoy = hoyISO()
  const [estado, setEstado] = useState<Estado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [cuentaId, setCuentaId] = useState("")
  const [trabajando, setTrabajando] = useState<string | null>(null)

  const [veps, setVeps] = useState<Vep[] | null>(null)
  const [vepError, setVepError] = useState<string | null>(null)
  const [vepAPagar, setVepAPagar] = useState<Vep | null>(null)
  const [aRechazar, setARechazar] = useState<{ id: string; descripcion: string } | null>(null)

  const [desde, setDesde] = useState(sumarDiasISO(hoy, -7))
  const [hasta, setHasta] = useState(hoy)
  const [movs, setMovs] = useState<Movs | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    try {
      const r = await fetch("/api/bancos/credicoop")
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || "No se pudo cargar")
      setEstado(j)
      setCuentaId((actual) => actual || j.cuentas?.[0]?.id || "")
    } catch (e: any) { setError(e?.message || "No se pudo cargar") } finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const pedir = async (url: string, body?: unknown) => {
    const r = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j?.error || `No se pudo completar (error ${r.status})`)
    return j
  }

  async function traerVeps() {
    setTrabajando("veps"); setVepError(null)
    try { setVeps((await pedir("/api/bancos/credicoop/veps")).veps ?? []) }
    catch (e: any) { setVepError(e?.message || "No se pudieron traer los VEP"); setVeps(null) } finally { setTrabajando(null) }
  }
  async function pagarVep(v: Vep) {
    setVepAPagar(null); setTrabajando(`vep-${v.numeroVep}`)
    try {
      await pedir("/api/bancos/credicoop/veps", { numero_vep: v.numeroVep, cuenta_bancaria_id: cuentaId, monto_visto: v.monto })
      toast.success("El pago del VEP quedó en Credicoop esperando la firma con token.", { duration: 10000 })
    } catch (e: any) { toast.error(e?.message || "No se pudo mandar el VEP", { duration: 15000 }) } finally { setTrabajando(null); await Promise.all([traerVeps(), cargar()]) }
  }
  async function traerMovimientos() {
    setTrabajando("movs"); setMovs(null)
    try {
      const j = await pedir("/api/bancos/credicoop/movimientos", { cuenta_bancaria_id: cuentaId, desde, hasta })
      setMovs(j)
      toast.success(`Se trajeron ${j.traidos} movimientos de ${j.cuenta}.`)
    } catch (e: any) { toast.error(e?.message || "No se pudieron traer los movimientos", { duration: 15000 }) } finally { setTrabajando(null) }
  }
  async function accionOperacion(id: string, accion: "actualizar" | "acreditada") {
    setTrabajando(`op-${id}`)
    try {
      const j = await pedir(`/api/bancos/credicoop/operaciones/${id}`, { accion })
      toast.info(`Credicoop: ${j.operacion?.estado_nombre ?? "sin cambios"}`)
      avisarConfirmacion(j.confirmacion)
    } catch (e: any) { toast.error(e?.message || "No se pudo consultar a Credicoop", { duration: 12000 }) } finally { setTrabajando(null); await cargar() }
  }

  const conectado = estado?.conexion.conectado === true
  const cuenta = estado?.cuentas.find((c) => c.id === cuentaId)

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-3 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild><Link href="/finanzas"><ArrowLeft className="h-5 w-5" /></Link></Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-azul-900"><Landmark className="h-6 w-6" /> Bancos — Credicoop</h1>
            <p className="text-sm text-neutro-600">Todo lo que se manda desde acá queda en Banca Internet Empresa esperando la firma con token.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={cargar} disabled={cargando}><RefreshCw className={cn("h-4 w-4", cargando && "animate-spin")} /> Actualizar</Button>
      </div>

      {cargando && !estado && <CargaProgreso compacto mensajes={MENSAJES.finanzas} className="mx-auto max-w-sm py-10" />}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      {estado?.conexion.simulador_en_produccion && <CartelSimuladorReal />}

      {estado && (
        <>
          {(estado.pagadas_sin_confirmar?.length ?? 0) > 0 && (
            <section role="alert" className="rounded-2xl border-2 border-red-300 bg-red-50 p-4">
              <h2 className="flex items-center gap-2 text-base font-bold text-red-900"><AlertTriangle className="h-5 w-5" /> Pagos que el banco ya hizo y la orden sigue pendiente</h2>
              <p className="mt-0.5 text-[13px] text-red-800">La plata salió pero la orden de pago no quedó confirmada: la cuenta corriente del proveedor y los vencimientos todavía no lo muestran. Confirmala desde Órdenes de pago (tilde verde) o resolvé lo que dice el motivo.</p>
              <ul className="mt-3 space-y-2">
                {estado.pagadas_sin_confirmar!.map((o) => (
                  <li key={o.orden_pago_id} className="rounded-lg border border-red-200 bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold text-neutro-900">Orden de pago {o.numero_op ?? "—"} · {o.proveedor ?? "—"}</span>
                      <span className="font-bold tabular-nums">{moneda(o.pagado_por_banco)} <span className="text-xs font-normal text-neutro-500">por el banco{o.ultima_firma ? ` · ${fechaHora(o.ultima_firma)}` : ""}</span></span>
                    </div>
                    <p className={cn("mt-1", o.falla ? "font-semibold text-red-800" : "text-neutro-600")}>
                      {o.falla ?? "Todavía no se intentó confirmarla sola (o falta aplicar la migración 20261119n para ver el motivo). Tocá “Actualizar estado” en la orden."}
                    </p>
                    {o.falla_at && <p className="text-xs text-neutro-500">Visto el {fechaHora(o.falla_at)}</p>}
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="outline" className="mt-3" asChild><Link href="/ordenes-pago">Ir a órdenes de pago</Link></Button>
            </section>
          )}

          <Tarjeta titulo="Conexión">
            {conectado ? (
              <div className={cn("flex gap-2 rounded-md border p-3 text-sm", estado.conexion.ambiente === "produccion" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-sky-200 bg-sky-50 text-sky-900")}>
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  {estado.conexion.ambiente === "produccion" && <><b>Conectado a Credicoop.</b> Las operaciones van al banco real.</>}
                  {estado.conexion.ambiente === "homologacion" && <><b>Conectado al banco de prueba (homologación).</b> Las operaciones no mueven plata real.</>}
                  {estado.conexion.ambiente === "simulador" && <><b>Modo simulador.</b> No se habla con el banco: sirve para probar las pantallas. Nada mueve plata.</>}
                </span>
              </div>
            ) : (
              <div className="flex gap-2 rounded-md border border-ambar-200 bg-ambar-50 p-3 text-sm text-ambar-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span><b>Credicoop no está conectado.</b> Falta cargar {estado.conexion.falta.join(", ")}. Hasta entonces no se manda nada al banco.</span>
              </div>
            )}
            {estado.falta_migracion && (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">Falta aplicar la migración <b>20261119d_bancos_operaciones.sql</b>: todavía no se pueden mandar operaciones.</div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-neutro-600">Cuenta de Credicoop:</span>
              {estado.cuentas.length === 0 ? (
                <span className="text-ambar-800">Ninguna cuenta bancaria está habilitada para operar con Credicoop por el sistema. La habilita sistemas, una sola vez (que el banco se llame “Credicoop” no alcanza).</span>
              ) : (
                <Select value={cuentaId || undefined} onValueChange={setCuentaId}>
                  <SelectTrigger className="w-72"><SelectValue placeholder="Elegí la cuenta" /></SelectTrigger>
                  <SelectContent>{estado.cuentas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {cuenta && !cuenta.tiene_cbu && <span className="font-semibold text-ambar-800">Esta cuenta no tiene cargado su CBU de 22 dígitos.</span>}
            </div>
          </Tarjeta>

          <Tarjeta titulo="VEP de ARCA pendientes de pago" ayuda="Los que informa Credicoop. Se mandan de a uno; el importe es el que informa ARCA."
            derecha={<Button size="sm" variant="outline" disabled={!conectado || trabajando === "veps"} onClick={traerVeps}><RefreshCw className={cn("h-4 w-4", trabajando === "veps" && "animate-spin")} /> Traer de Credicoop</Button>}>
            {vepError && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{vepError}</div>}
            {veps === null && !vepError && <p className="text-sm text-neutro-500">Tocá “Traer de Credicoop” para ver los VEP pendientes.</p>}
            {veps && veps.length === 0 && <p className="text-sm text-neutro-600">No hay VEP pendientes de pago.</p>}
            {veps && veps.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead><tr className="text-left text-[13px] font-semibold text-neutro-600">
                    <th className="px-2 py-1">VEP</th><th className="px-2 py-1">Qué es</th><th className="px-2 py-1">Período</th><th className="px-2 py-1">Vence</th>
                    <th className="px-2 py-1 text-right">Importe</th><th className="px-2 py-1" />
                  </tr></thead>
                  <tbody>
                    {veps.map((v) => (
                      <tr key={v.numeroVep} className="border-t border-neutro-100 align-top">
                        <td className="px-2 py-1.5 font-mono">{v.numeroVep}</td>
                        <td className="px-2 py-1.5">{v.descripcion || v.concepto}{v.cuitContribuyente ? <div className="text-xs text-neutro-500">CUIT {formatCuit(v.cuitContribuyente)}</div> : null}</td>
                        <td className="px-2 py-1.5">{v.periodoFiscal || "—"}</td>
                        <td className="px-2 py-1.5">{v.vence ? fecha(v.vence) : "—"}</td>
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{v.monto == null ? "—" : moneda(v.monto)}</td>
                        <td className="px-2 py-1.5 text-right">
                          {v.operacion ? <EstadoOperacionBanco op={v.operacion} /> : (
                            <Button size="sm" disabled={!cuentaId || !cuenta?.tiene_cbu || v.monto == null || trabajando === `vep-${v.numeroVep}`} onClick={() => setVepAPagar(v)}>
                              <Send className="h-4 w-4" /> Mandar a firmar
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tarjeta>

          <Tarjeta titulo="Movimientos de la cuenta" ayuda="Trae los movimientos de Credicoop y los carga en la conciliación. El sistema propone con qué pago o cobro coincide cada uno; nada se concilia solo.">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1"><label className="text-[13px] font-semibold text-neutro-600">Desde</label><DateInputAR value={desde} onChange={(v) => v && setDesde(v)} className="w-36" /></div>
              <div className="space-y-1"><label className="text-[13px] font-semibold text-neutro-600">Hasta</label><DateInputAR value={hasta} onChange={(v) => v && setHasta(v)} className="w-36" /></div>
              <Button disabled={!conectado || !cuentaId || trabajando === "movs"} onClick={traerMovimientos}>
                <RefreshCw className={cn("h-4 w-4", trabajando === "movs" && "animate-spin")} /> Traer movimientos
              </Button>
            </div>
            {movs && (
              <div className="mt-3 space-y-2 text-sm">
                <p>
                  <b>{movs.traidos}</b> movimientos del {fecha(movs.desde)} al {fecha(movs.hasta)}
                  {movs.importado ? <> · nuevos en la conciliación: <b>{movs.importado.importados ?? 0}</b>{movs.importado.duplicados ? ` (${movs.importado.duplicados} ya estaban)` : ""}</> : null}
                  {movs.saldo != null ? <> · saldo que informa el banco: <b>{moneda(movs.saldo)}</b></> : null}
                </p>
                {movs.de_prueba && (
                  <div className="rounded-md border border-neutro-300 bg-neutro-100 p-3 text-neutro-800">
                    <b>Movimientos de prueba</b> (simulador o banco de prueba): se muestran, pero NO se cargaron en la conciliación porque no son movimientos de la cuenta.
                  </div>
                )}
                {movs.parcial && (
                  <div className="flex gap-2 rounded-md border border-ambar-200 bg-ambar-50 p-3 font-semibold text-ambar-800">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> El banco cortó la lista por la cantidad de movimientos: FALTAN movimientos. Pedí un rango de fechas más corto.
                  </div>
                )}
                {movs.coincidencias.length > 0 && (
                  <div className="rounded-md border border-neutro-200 p-3">
                    <div className="font-semibold text-neutro-800">Coinciden con operaciones mandadas desde el sistema (propuesta):</div>
                    <ul className="mt-1 space-y-1">
                      {movs.coincidencias.map((c) => (
                        <li key={c.operacion_id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>{c.tipo} a {c.beneficiario ?? "—"} por <b>{moneda(c.monto)}</b> ↔ movimiento del {fecha(c.fecha_movimiento)}: {c.descripcion}</span>
                          <Button size="sm" variant="outline" disabled={trabajando === `op-${c.operacion_id}`} onClick={() => accionOperacion(c.operacion_id, "acreditada")}>Marcar como vista en la cuenta</Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <Button variant="outline" size="sm" asChild><Link href="/finanzas/conciliacion">Ir a la conciliación para revisar las propuestas</Link></Button>
              </div>
            )}
          </Tarjeta>

          <Tarjeta titulo="Operaciones mandadas a Credicoop" ayuda="Las últimas 100. Una operación “esperando la firma” o “en duda” se actualiza preguntándole al banco.">
            {estado.operaciones.length === 0 ? <p className="text-sm text-neutro-600">Todavía no se mandó ninguna operación.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead><tr className="text-left text-[13px] font-semibold text-neutro-600">
                    <th className="px-2 py-1">Mandada</th><th className="px-2 py-1">Operación</th><th className="px-2 py-1">Para</th>
                    <th className="px-2 py-1 text-right">Importe</th><th className="px-2 py-1">Estado</th><th className="px-2 py-1" />
                  </tr></thead>
                  <tbody>
                    {estado.operaciones.map((o) => (
                      <tr key={o.id} className="border-t border-neutro-100 align-top">
                        <td className="px-2 py-1.5 whitespace-nowrap">{fechaHora(o.creado_at)}</td>
                        <td className="px-2 py-1.5">{o.tipo_nombre}<div className="text-xs text-neutro-500">{o.orden_pago ?? o.orden_pago_numero ? `Orden de pago ${o.orden_pago ?? `${o.orden_pago_numero} (eliminada)`}` : o.numero_vep ? `VEP ${o.numero_vep}` : ""}{o.cuenta ? ` · ${o.cuenta}` : ""}</div></td>
                        <td className="px-2 py-1.5">{o.beneficiario ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{moneda(o.monto)}</td>
                        <td className="px-2 py-1.5"><EstadoOperacionBanco op={o} />{o.estado_banco && SIN_TERMINAR.includes(o.estado) && <div className="mt-0.5 text-xs text-neutro-500">El banco dice: “{o.estado_banco}”</div>}{o.motivo && <div className="mt-0.5 max-w-xs text-xs text-neutro-600">{o.motivo}</div>}</td>
                        <td className="px-2 py-1.5 text-right">
                          {!["rechazada", "acreditada", "firmada"].includes(o.estado) && (
                            <Button size="sm" variant="outline" disabled={!conectado || trabajando === `op-${o.id}`} onClick={() => accionOperacion(o.id, "actualizar")}>
                              <RefreshCw className={cn("h-4 w-4", trabajando === `op-${o.id}` && "animate-spin")} /> Actualizar estado
                            </Button>
                          )}
                          {SIN_TERMINAR.includes(o.estado) && (
                            <Button size="sm" variant="ghost" className="mt-1 text-red-700 hover:bg-red-50 hover:text-red-800" disabled={trabajando === `op-${o.id}`}
                              onClick={() => setARechazar({ id: o.id, descripcion: `${o.tipo_nombre} a ${o.beneficiario ?? "—"} por ${moneda(o.monto)}` })}>
                              <Ban className="h-4 w-4" /> Marcar como rechazada
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tarjeta>
        </>
      )}

      <AlertDialog open={!!vepAPagar} onOpenChange={(o) => { if (!o) setVepAPagar(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Mandar el pago de este VEP a Credicoop para firmar?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              {vepAPagar ? (
                <div className="space-y-2 text-sm text-neutro-800">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-neutro-200 bg-neutro-50 p-3">
                    <dt className="text-neutro-500">VEP</dt><dd className="font-mono">{vepAPagar.numeroVep}</dd>
                    <dt className="text-neutro-500">Qué es</dt><dd>{vepAPagar.descripcion || vepAPagar.concepto} {vepAPagar.periodoFiscal ? `(${vepAPagar.periodoFiscal})` : ""}</dd>
                    <dt className="text-neutro-500">Banco</dt><dd>Banco Credicoop</dd>
                    <dt className="text-neutro-500">Sale de</dt><dd>{cuenta?.nombre ?? "—"}</dd>
                    <dt className="text-neutro-500">Importe</dt><dd className="text-base font-bold">{vepAPagar.monto == null ? "—" : moneda(vepAPagar.monto)}</dd>
                    <dt className="text-neutro-500">Fecha</dt><dd>{fecha(hoy)}</dd>
                  </dl>
                  <p>Queda en Banca Internet Empresa <b>esperando la firma con token</b>. No se paga hasta que se firme.</p>
                </div>
              ) : <span />}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (vepAPagar) pagarVep(vepAPagar) }}>Mandar para firmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RechazarOperacionBanco operacion={aRechazar} onCerrar={() => setARechazar(null)} onHecho={cargar} />
    </div>
  )
}
