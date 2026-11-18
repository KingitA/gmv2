"use client"

// Orden de pago → Credicoop (Tanda 2-A). Por cada pago de la orden que es transferencia, e-cheq
// a emitir o e-cheq de un cliente a endosar: mandarlo a Credicoop para FIRMAR con token y ver
// en qué estado está. Mandar NO confirma la orden: el pago se da por hecho recién cuando el
// banco dice que lo procesó, y la orden se confirma después, como siempre.
// Solo admin (el servidor lo vuelve a controlar).

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AlertTriangle, CheckCircle2, Clock, Landmark, RefreshCw, Send, XCircle } from "lucide-react"
import { toast } from "sonner"
import { fecha, fechaHora, formatCuit, moneda } from "@/lib/formato"
import { cn } from "@/lib/utils"

export interface OperacionBanco {
  id: string; estado: string; estado_nombre: string; estado_banco: string | null; motivo: string | null
  ambiente: string; id_operacion_banco: string | null; creado_at?: string; firmado_at?: string | null
}
interface Pago {
  detalle_id: string; tipo: string; tipo_nombre: string; banco: string; cuenta: string | null; cuenta_cbu: string | null
  beneficiario: string; beneficiario_cuit: string | null; beneficiario_cbu: string | null; monto: number; fecha: string
  cheque: { numero: string | null; banco: string | null } | null
  problemas: string[]; operacion: OperacionBanco | null
}
interface Datos {
  orden: { id: string; numero_op: string; estado: string; proveedor: string }
  conexion: { conectado: boolean; ambiente: string | null; falta: string[] }
  pagos: Pago[]
}

const TONO: Record<string, string> = {
  preparada: "bg-neutro-100 text-neutro-700", enviada_a_firma: "bg-ambar-50 text-ambar-800 border border-ambar-200",
  en_proceso: "bg-sky-50 text-sky-800 border border-sky-200", firmada: "bg-emerald-50 text-emerald-800 border border-emerald-200",
  acreditada: "bg-emerald-50 text-emerald-800 border border-emerald-200", rechazada: "bg-red-50 text-red-800 border border-red-200",
  error: "bg-red-50 text-red-800 border border-red-200",
}
const cbuLegible = (c: string | null) => (c ? c.replace(/(\d{8})(\d{14})/, "$1 $2") : "—")

/** Cartel de estado de una operación (lo usan esta ventana y la pantalla de Bancos). */
export function EstadoOperacionBanco({ op }: { op: OperacionBanco }) {
  const Icono = op.estado === "firmada" || op.estado === "acreditada" ? CheckCircle2 : op.estado === "rechazada" ? XCircle : op.estado === "error" ? AlertTriangle : Clock
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-semibold", TONO[op.estado] ?? TONO.preparada)}>
      <Icono className="h-4 w-4 shrink-0" /> {op.estado_nombre}
      {op.ambiente === "simulador" && <span className="ml-1 rounded bg-neutro-800 px-1.5 text-[11px] font-bold text-white">SIMULADOR</span>}
      {op.ambiente === "homologacion" && <span className="ml-1 rounded bg-sky-700 px-1.5 text-[11px] font-bold text-white">PRUEBA</span>}
    </span>
  )
}

export function CredicoopOrdenPago({ ordenPagoId, abierto, onCerrar, onCambio }: { ordenPagoId: string | null; abierto: boolean; onCerrar: () => void; onCambio?: () => void }) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [aConfirmar, setAConfirmar] = useState<Pago | null>(null)

  const cargar = useCallback(async () => {
    if (!ordenPagoId) return
    setCargando(true); setError(null)
    try {
      const r = await fetch(`/api/bancos/credicoop/ordenes-pago/${ordenPagoId}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || "No se pudo cargar")
      setDatos(j)
    } catch (e: any) { setError(e?.message || "No se pudo cargar"); setDatos(null) } finally { setCargando(false) }
  }, [ordenPagoId])
  useEffect(() => { if (abierto) cargar(); else { setDatos(null); setError(null) } }, [abierto, cargar])

  async function mandar(p: Pago) {
    setAConfirmar(null); setTrabajando(p.detalle_id)
    try {
      const r = await fetch(`/api/bancos/credicoop/ordenes-pago/${ordenPagoId}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ detalle_id: p.detalle_id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) toast.error(j?.error || "No se pudo mandar a Credicoop", { duration: 15000 })
      else toast.success("Quedó en Credicoop esperando la firma con token. Cuando esté firmada, tocá “Actualizar estado”.", { duration: 10000 })
    } catch (e: any) {
      toast.error(`${e?.message || "Se cortó la comunicación"}. No se sabe si llegó a Credicoop: tocá “Actualizar estado” antes de volver a mandarlo.`, { duration: 15000 })
    } finally { setTrabajando(null); await cargar(); onCambio?.() }
  }

  async function actualizar(p: Pago) {
    if (!p.operacion) return
    setTrabajando(p.detalle_id)
    try {
      const r = await fetch(`/api/bancos/credicoop/operaciones/${p.operacion.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "actualizar" }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) toast.error(j?.error || "No se pudo consultar a Credicoop", { duration: 12000 })
      else toast.info(`Credicoop: ${j.operacion?.estado_nombre ?? "sin cambios"}${j.operacion?.estado_banco ? ` (${j.operacion.estado_banco})` : ""}`)
    } catch (e: any) { toast.error(e?.message || "No se pudo consultar a Credicoop") } finally { setTrabajando(null); await cargar(); onCambio?.() }
  }

  const todosHechos = !!datos && datos.pagos.length > 0 && datos.pagos.every((p) => p.operacion && (p.operacion.estado === "firmada" || p.operacion.estado === "acreditada"))

  return (
    <>
      <Dialog open={abierto} onOpenChange={(o) => { if (!o) onCerrar() }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Landmark className="h-5 w-5" /> Credicoop — orden de pago {datos?.orden.numero_op ?? ""}</DialogTitle>
            <DialogDescription>
              {datos ? `${datos.orden.proveedor}. ` : ""}Mandar un pago lo deja en Banca Internet Empresa esperando la firma con token. No confirma la orden.
            </DialogDescription>
          </DialogHeader>

          {cargando && !datos && <p className="py-6 text-center text-sm text-neutro-500">Cargando…</p>}
          {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

          {datos && (
            <div className="space-y-3">
              {!datos.conexion.conectado && (
                <div className="flex gap-2 rounded-md border border-ambar-200 bg-ambar-50 p-3 text-sm text-ambar-800">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span><b>Credicoop no está conectado.</b> Falta cargar {datos.conexion.falta.join(", ")}. Hasta entonces no se manda nada al banco.</span>
                </div>
              )}
              {datos.conexion.ambiente === "simulador" && (
                <div className="rounded-md border border-neutro-300 bg-neutro-100 p-3 text-sm text-neutro-800">
                  <b>Modo simulador:</b> esto NO es el banco. Nada de lo que mandes acá mueve plata; sirve para probar la pantalla.
                </div>
              )}
              {datos.conexion.ambiente === "homologacion" && (
                <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                  <b>Banco de prueba (homologación):</b> las operaciones van al ambiente de pruebas de Credicoop, no mueven plata real.
                </div>
              )}

              {datos.pagos.length === 0 && (
                <p className="rounded-md border border-neutro-200 p-4 text-sm text-neutro-600">
                  Esta orden no tiene ningún pago que pase por Credicoop (transferencia, e-cheq propio o e-cheq de un cliente).
                </p>
              )}

              {datos.pagos.map((p) => {
                const op = p.operacion
                const viva = op && op.estado !== "rechazada"
                const ocupado = trabajando === p.detalle_id
                return (
                  <div key={p.detalle_id} className="rounded-lg border border-neutro-200 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold text-neutro-900">{p.tipo_nombre}</span>
                      <span className="text-lg font-bold tabular-nums text-azul-900">{moneda(p.monto)}</span>
                    </div>
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px] text-neutro-700">
                      <dt className="text-neutro-500">{p.tipo === "echeq_endoso" ? "Se endosa a" : "Para"}</dt>
                      <dd><b>{p.beneficiario}</b>{p.beneficiario_cuit ? ` · CUIT ${formatCuit(p.beneficiario_cuit)}` : ""}</dd>
                      {p.tipo === "transferencia" && (<><dt className="text-neutro-500">CBU destino</dt><dd className="font-mono">{cbuLegible(p.beneficiario_cbu)}</dd></>)}
                      {p.cheque && (<><dt className="text-neutro-500">E-cheq</dt><dd>{[p.cheque.banco, p.cheque.numero].filter(Boolean).join(" ") || "—"}</dd></>)}
                      <dt className="text-neutro-500">{p.tipo === "echeq_endoso" ? "Cuenta" : "Sale de"}</dt>
                      <dd>{p.cuenta ?? "—"}</dd>
                      <dt className="text-neutro-500">{p.tipo === "transferencia" ? "Fecha" : "Fecha de pago"}</dt>
                      <dd>{p.fecha ? fecha(p.fecha) : "—"}{p.tipo === "transferencia" ? " (hoy: el banco no acepta otra fecha)" : ""}</dd>
                    </dl>

                    {op && (
                      <div className="mt-2 space-y-1">
                        <EstadoOperacionBanco op={op} />
                        {op.estado_banco && <div className="text-xs text-neutro-500">El banco dice: “{op.estado_banco}”{op.id_operacion_banco ? ` · operación ${op.id_operacion_banco}` : ""}{op.creado_at ? ` · mandada el ${fechaHora(op.creado_at)}` : ""}</div>}
                        {op.motivo && <div className={cn("text-[13px]", op.estado === "rechazada" || op.estado === "error" ? "font-semibold text-red-700" : "text-neutro-600")}>{op.motivo}</div>}
                      </div>
                    )}
                    {!viva && p.problemas.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-[13px] font-semibold text-ambar-800">
                        {p.problemas.map((x, i) => <li key={i} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {x}</li>)}
                      </ul>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {!viva && (
                        <Button size="sm" disabled={ocupado || p.problemas.length > 0 || !datos.conexion.conectado} onClick={() => setAConfirmar(p)}>
                          <Send className="h-4 w-4" /> {op ? "Volver a mandar a Credicoop" : "Mandar a Credicoop para firmar"}
                        </Button>
                      )}
                      {viva && op.estado !== "acreditada" && (
                        <Button size="sm" variant="outline" disabled={ocupado} onClick={() => actualizar(p)}>
                          <RefreshCw className={cn("h-4 w-4", ocupado && "animate-spin")} /> Actualizar estado
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}

              {todosHechos && datos.orden.estado === "pendiente" && (
                <div className="flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span><b>El banco ya procesó todo.</b> Ahora confirmá la orden de pago (el tilde verde de la lista) para que quede registrada como pagada.</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!aConfirmar} onOpenChange={(o) => { if (!o) setAConfirmar(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Mandar a Credicoop para firmar?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              {aConfirmar ? (
                <div className="space-y-2 text-sm text-neutro-800">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-neutro-200 bg-neutro-50 p-3">
                    <dt className="text-neutro-500">Operación</dt><dd className="font-semibold">{aConfirmar.tipo_nombre}</dd>
                    <dt className="text-neutro-500">Banco</dt><dd>{aConfirmar.banco}</dd>
                    <dt className="text-neutro-500">Cuenta</dt><dd>{aConfirmar.cuenta ?? "—"} <span className="font-mono text-xs text-neutro-500">{cbuLegible(aConfirmar.cuenta_cbu)}</span></dd>
                    <dt className="text-neutro-500">{aConfirmar.tipo === "echeq_endoso" ? "Se endosa a" : "Beneficiario"}</dt><dd className="font-semibold">{aConfirmar.beneficiario}</dd>
                    <dt className="text-neutro-500">CUIT</dt><dd>{aConfirmar.beneficiario_cuit ? formatCuit(aConfirmar.beneficiario_cuit) : "—"}</dd>
                    {aConfirmar.tipo === "transferencia" && (<><dt className="text-neutro-500">CBU</dt><dd className="font-mono">{cbuLegible(aConfirmar.beneficiario_cbu)}</dd></>)}
                    {aConfirmar.cheque && (<><dt className="text-neutro-500">E-cheq</dt><dd>{[aConfirmar.cheque.banco, aConfirmar.cheque.numero].filter(Boolean).join(" ")}</dd></>)}
                    <dt className="text-neutro-500">Importe</dt><dd className="text-base font-bold">{moneda(aConfirmar.monto)}</dd>
                    <dt className="text-neutro-500">{aConfirmar.tipo === "transferencia" ? "Fecha" : "Fecha de pago"}</dt><dd>{aConfirmar.fecha ? fecha(aConfirmar.fecha) : "—"}</dd>
                  </dl>
                  <p>Queda en Banca Internet Empresa <b>esperando la firma con token</b>. La plata no sale hasta que se firme, y la orden no queda pagada hasta que la confirmes.</p>
                </div>
              ) : <span />}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (aConfirmar) mandar(aConfirmar) }}>Mandar para firmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
