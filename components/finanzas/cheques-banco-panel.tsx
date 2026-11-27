"use client"

/**
 * Cheques contra el banco (bancos tanda 4): en clearing por cuenta con saldo proyectado,
 * demorados a las 96 h, rechazos para confirmar y propuestas (modo propuesta). Solo admin:
 * si la API responde 403 o falta la migración, no se muestra.
 */
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, ChevronDown, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useConfirmar } from "@/components/ui/confirmar"
import { fecha, moneda } from "@/lib/formato"
import { cn } from "@/lib/utils"
import type { PanelChequesBanco } from "@/lib/bancos/cheques/servidor"

const API = "/api/finanzas/cheques-banco"

export function ChequesBancoPanel({ onCambio }: { onCambio?: () => void }) {
  const [panel, setPanel] = useState<PanelChequesBanco | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [verDemorados, setVerDemorados] = useState(false)
  const { confirmar, dialogo } = useConfirmar()

  const cargar = useCallback(async () => {
    const r = await fetch(API).catch(() => null)
    if (!r?.ok) { setPanel(null); return }
    setPanel(await r.json())
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const accion = async (clave: string, body: Record<string, unknown>, ok?: (d: Record<string, any>) => string) => {
    setOcupado(clave)
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d.error ?? "No se pudo"); return }
      if (ok) toast.success(ok(d))
      await cargar()
      onCambio?.()
    } finally {
      setOcupado(null)
    }
  }

  if (!panel?.instalado) return null
  const { ajustes, cuentas, demorados, avisos } = panel
  const rechazos = avisos.filter((a) => a.tipo === "rechazo")
  const propuestas = avisos.filter((a) => a.tipo !== "rechazo")
  if (!cuentas.length && !demorados.length && !avisos.length && !ajustes.modo_propuesta) return null

  const confirmarRechazo = async (avisoId: string, ch: PanelChequesBanco["avisos"][number]["cheques"][number]) => {
    const si = await confirmar({
      titulo: `¿Confirmar el rechazo del cheque ${ch.numero ?? ""}?`,
      detalle: `${moneda(ch.monto)}${ch.cliente ? ` · ${ch.cliente}` : ""}\nSi el cobro estaba confirmado se genera la nota de débito al cliente.`,
      confirmar: "Confirmar rechazo",
      peligro: true,
    })
    if (!si) return
    await accion(`r-${avisoId}`, { accion: "confirmar_rechazo", aviso_id: avisoId, cheque_id: ch.id }, (d) => d.mensaje ?? "Rechazo confirmado")
  }

  return (
    <div className="mb-3 rounded-2xl border border-neutro-200 bg-white px-3 py-2 text-sm">
      {dialogo}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold text-azul-900">En el banco</span>
        {cuentas.map((c) => (
          <span key={c.id} className="text-neutro-700" title={`Saldo ${moneda(c.saldo)} + en clearing ${moneda(c.en_clearing)}`}>
            {c.nombre}: <b>{moneda(c.en_clearing)}</b> en clearing ({c.cheques})
            {c.proxima && <> · desde {fecha(c.proxima)}</>} · proyectado <b>{moneda(c.proyectado)}</b>
          </span>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[13px] text-neutro-600" title="Prendido: solo propone acreditaciones y débitos; no los hace">
            <Switch
              checked={ajustes.modo_propuesta}
              disabled={ocupado === "modo"}
              onCheckedChange={(v) => accion("modo", { accion: "modo", modo_propuesta: v })}
            />
            Modo propuesta
          </label>
          <Button
            variant="outline" size="sm" disabled={!!ocupado}
            onClick={() => accion("revisar", { accion: "revisar" }, (d) =>
              `Acreditados ${d.acreditados} · debitados ${d.debitados} · propuestas ${d.propuestas} · rechazos ${d.rechazos}`)}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", ocupado === "revisar" && "animate-spin")} /> Revisar
          </Button>
        </div>
      </div>

      {demorados.length > 0 && (
        <div className="mt-1.5">
          <button type="button" className="flex items-center gap-1 text-ambar-700" onClick={() => setVerDemorados((v) => !v)}>
            <AlertTriangle className="h-3.5 w-3.5" />
            {demorados.length} sin acreditar a las 96 h · {moneda(demorados.reduce((a, d) => a + Math.abs(d.monto), 0))}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", verDemorados && "rotate-180")} />
          </button>
          {verDemorados && (
            <ul className="mt-1 space-y-0.5 pl-5 text-neutro-700">
              {demorados.map((d) => (
                <li key={d.id}>
                  N° {d.numero ?? "—"} {d.banco ? `· ${d.banco}` : ""} · {moneda(d.monto)} · {d.cuenta} · depositado {fecha(d.fecha_deposito)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {rechazos.map((a) => (
        <div key={a.id} className="mt-1.5 rounded-lg bg-error-50 px-2 py-1.5 text-error-700">
          <div className="flex flex-wrap items-center gap-2">
            <b>Rechazo en el banco</b> · {a.cuenta} · {fecha(a.fecha)} · {moneda(Math.abs(a.monto))}
            <Button variant="ghost" size="sm" className="ml-auto h-7" disabled={!!ocupado}
              onClick={() => accion(`d-${a.id}`, { accion: "descartar", aviso_id: a.id })}>
              Descartar
            </Button>
          </div>
          {a.cheques.length === 0 && <div className="text-[13px]">No se encontró el cheque: revisalo en la lista.</div>}
          {a.cheques.map((ch) => (
            <div key={ch.id} className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
              N° {ch.numero ?? "—"} {ch.banco ? `· ${ch.banco}` : ""} · {moneda(ch.monto)} {ch.cliente ? `· ${ch.cliente}` : ""}
              <Button size="sm" variant="destructive" className="h-7" disabled={!!ocupado} onClick={() => confirmarRechazo(a.id, ch)}>
                Confirmar rechazo
              </Button>
            </div>
          ))}
        </div>
      ))}

      {propuestas.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {propuestas.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-azul-50 px-2 py-1 text-[13px] text-azul-900">
              <b>{a.tipo === "acreditar" ? "Acreditar" : "Debitar"}</b>
              {a.cheques.map((ch) => `N° ${ch.numero ?? "—"} ${moneda(ch.monto)}`).join(" + ")}
              <span className="text-neutro-600">· {a.cuenta} {fecha(a.fecha)} · {moneda(Math.abs(a.monto))}{a.con_comision ? " · con comisión" : ""}</span>
              <div className="ml-auto flex gap-1">
                <Button size="sm" className="h-7" disabled={!!ocupado}
                  onClick={() => accion(`a-${a.id}`, { accion: "aplicar", aviso_id: a.id }, () => "Hecho")}>
                  Aplicar
                </Button>
                <Button size="sm" variant="ghost" className="h-7" disabled={!!ocupado}
                  onClick={() => accion(`d-${a.id}`, { accion: "descartar", aviso_id: a.id })}>
                  Descartar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
