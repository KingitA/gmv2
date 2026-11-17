"use client"

// Enviar la orden de compra al proveedor (E-03): vista previa editable del mail y envío con un click.
// El mail sale de la cuenta de compras, con el PDF (y el Excel si se tilda) adjuntos.
// MODO PRUEBA (Juan, 17/11): mientras esté encendido el mail va SOLO a la dirección de prueba;
// lo decide el servidor con el ajuste de la base y acá se muestra bien a la vista.

import { useEffect, useState } from "react"
import { AlertTriangle, FileSpreadsheet, FileText, FlaskConical, Loader2, Mail, Send, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { CargaProgreso } from "@/components/ui/carga-progreso"
import { fechaHora, moneda } from "@/lib/formato"

interface Previa {
  orden: { id: string; numero_orden: string; estado: string; envios: number; enviada_at: string | null; enviada_a: string | null; cambio_sin_enviar: boolean; total: number; renglones: number }
  proveedor: { id: string; nombre: string }
  puede_enviar: boolean
  motivo: string | null
  envio:
    | { ok: true; cuenta: string; cuenta_conectada: boolean; como_conectar: string | null; modo_prueba: boolean; mail_prueba: string | null }
    | { ok: false; bloqueo: string }
  para: string[]
  para_origen: "ordenes_compra" | "vendedor" | "oficina" | "general" | null
  otros_mails: string[]
  asunto: string
  cuerpo: string
  adjuntos: { clave: string; nombre: string; fijo: boolean }[]
}

const ORIGEN: Record<string, string> = { vendedor: "el mail del vendedor", oficina: "el mail de la oficina", general: "el mail general" }

export function DialogoEnviarOrden({ ordenId, onCerrar, onEnviada }: { ordenId: string | null; onCerrar: () => void; onEnviada: () => void }) {
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [para, setPara] = useState("")
  const [cc, setCc] = useState("")
  const [asunto, setAsunto] = useState("")
  const [cuerpo, setCuerpo] = useState("")
  const [conExcel, setConExcel] = useState(false)
  const [guardarMail, setGuardarMail] = useState(false)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!ordenId) return
    let vivo = true
    setPrevia(null); setError(null); setEnviando(false)
    fetch(`/api/ordenes-compra/${ordenId}/enviar`, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (!vivo) return
        if (!ok) { setError(data.error || "No se pudo preparar el mail."); return }
        const p = data as Previa
        setPrevia(p)
        setPara(p.para.join(", "))
        setCc("")
        setAsunto(p.asunto)
        setCuerpo(p.cuerpo)
        setConExcel(false)
        // Solo se propone guardar cuando el proveedor no tiene NINGÚN mail (lo va a escribir el usuario).
        // Si se propuso el del vendedor o el de la oficina, no se da por bueno: se tilda a mano.
        setGuardarMail(p.para_origen === null)
      })
      .catch(() => vivo && setError("No se pudo preparar el mail. Revisá la conexión."))
    return () => { vivo = false }
  }, [ordenId])

  const envio = previa?.envio
  const prueba = !!envio && envio.ok && envio.modo_prueba
  const sePuede = !!previa && previa.puede_enviar && !!envio && envio.ok && envio.cuenta_conectada

  const enviar = async () => {
    if (!previa || enviando || !sePuede) return
    if (!para.trim()) { toast.error("Escribí el mail del proveedor."); return }
    setEnviando(true)
    try {
      const res = await fetch(`/api/ordenes-compra/${previa.orden.id}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ para, cc, asunto, cuerpo, adjuntar_excel: conExcel, guardar_mail_en_ficha: guardarMail }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || `No se envió (error ${res.status}).`, { duration: 12000 }); return }
      toast.success(data.modo_prueba
        ? `PRUEBA: la orden ${data.numero_orden} se mandó a ${(data.para || []).join(", ")}, no al proveedor.`
        : `Orden ${data.numero_orden} enviada a ${(data.para || []).join(", ")}`)
      for (const a of (data.avisos || []).filter((x: string) => !x.startsWith("MODO PRUEBA"))) toast.warning(a, { duration: 15000 })
      onEnviada()
      onCerrar()
    } catch {
      toast.error("No se pudo confirmar el envío (se cortó la conexión). Antes de reintentar, mirá en el listado si la orden figura como enviada.", { duration: 15000 })
    } finally {
      setEnviando(false)
    }
  }

  const agregarCc = (m: string) => setCc((v) => (v.split(/[,;\s]+/).includes(m) ? v : [v.trim().replace(/[,;]$/, ""), m].filter(Boolean).join(", ")))
  const reenvio = !!previa && previa.orden.envios > 0
  const seria = [para, cc].map((x) => x.trim()).filter(Boolean).join(", ")

  return (
    <Dialog open={!!ordenId} onOpenChange={(a) => { if (!a && !enviando) onCerrar() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {previa ? `${reenvio ? "Reenviar" : "Enviar"} la orden ${previa.orden.numero_orden} a ${previa.proveedor.nombre}` : "Enviar orden al proveedor"}
          </DialogTitle>
          <DialogDescription>
            Revisá el mail antes de mandarlo: podés cambiar el destinatario, el asunto y el texto.
          </DialogDescription>
        </DialogHeader>

        {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {!previa && !error && <CargaProgreso compacto mensajes={["Armando el mail…", "Ya casi está…"]} />}

        {previa && envio && (
          <div className="space-y-4">
            {/* ── MODO PRUEBA: lo primero que se ve ── */}
            {prueba && envio.ok && (
              <div className="flex gap-3 rounded-md border-2 border-amber-500 bg-amber-100 p-3 text-amber-950">
                <FlaskConical className="mt-0.5 h-6 w-6 shrink-0" />
                <div>
                  <div className="text-base font-bold">MODO PRUEBA: este mail va a {envio.mail_prueba}, no al proveedor</div>
                  <div className="text-sm">
                    Sería: <b>{seria || "(sin destinatario)"}</b>. El asunto sale con “[PRUEBA]” adelante y el texto aclara que es una prueba.
                    En la orden queda registrado que se mandó a {envio.mail_prueba}. El modo prueba lo apaga un administrador desde “Envío de órdenes”, en el listado.
                  </div>
                </div>
              </div>
            )}
            {!envio.ok && (
              <div className="flex gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                <ShieldAlert className="h-4 w-4 shrink-0" /> <span><b>No se puede enviar.</b> {envio.bloqueo}</span>
              </div>
            )}
            {envio.ok && !envio.cuenta_conectada && (
              <div className="flex gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="h-4 w-4 shrink-0" /> <span><b>No se puede enviar.</b> {envio.como_conectar}</span>
              </div>
            )}
            {!previa.puede_enviar && (
              <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {previa.motivo}
              </div>
            )}
            {reenvio && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                Ya se envió {previa.orden.envios === 1 ? "una vez" : `${previa.orden.envios} veces`}
                {previa.orden.enviada_at ? `, la última el ${fechaHora(previa.orden.enviada_at)}` : ""}
                {previa.orden.enviada_a ? ` a ${previa.orden.enviada_a}` : ""}.
                {previa.orden.cambio_sin_enviar && <b> La orden cambió después de ese envío: el proveedor tiene una versión vieja.</b>}
              </div>
            )}
            {previa.para_origen === null && (
              <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span><b>{previa.proveedor.nombre} no tiene ningún mail cargado.</b> Escribilo acá abajo: si dejás tildado “Guardar en la ficha”, queda para las próximas órdenes.</span>
              </div>
            )}
            {previa.para_origen && previa.para_origen !== "ordenes_compra" && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                El proveedor no tiene cargado el “mail para órdenes de compra”. Se propone {ORIGEN[previa.para_origen]}: revisá que sea el correcto.
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-[110px_1fr] sm:items-center">
              <Label>Sale desde</Label>
              <div className="text-sm font-medium">{envio.ok ? envio.cuenta : "—"}</div>

              <Label htmlFor="oc-mail-para">{prueba ? "Para (proveedor)" : "Para"}</Label>
              <div>
                <Input id="oc-mail-para" value={para} onChange={(e) => setPara(e.target.value)} placeholder="pedidos@proveedor.com (varios separados por coma)" autoComplete="off" />
                <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={guardarMail} onCheckedChange={(c) => setGuardarMail(!!c)} />
                  Guardar en la ficha del proveedor como mail para órdenes de compra
                </label>
              </div>

              <Label htmlFor="oc-mail-cc">Con copia</Label>
              <div>
                <Input id="oc-mail-cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="opcional" autoComplete="off" />
                {previa.otros_mails.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    Otros mails de la ficha:
                    {previa.otros_mails.map((m) => (
                      <button key={m} type="button" onClick={() => agregarCc(m)} className="rounded-full border px-2 py-0.5 hover:bg-accent">+ {m}</button>
                    ))}
                  </div>
                )}
              </div>

              <Label htmlFor="oc-mail-asunto">Asunto</Label>
              <div>
                <Input id="oc-mail-asunto" value={asunto} onChange={(e) => setAsunto(e.target.value)} />
                {prueba && <div className="mt-1 text-xs text-amber-800">Va a salir como: <b>[PRUEBA] {asunto}</b></div>}
              </div>
            </div>

            <div>
              <Label htmlFor="oc-mail-cuerpo">Mensaje</Label>
              <Textarea id="oc-mail-cuerpo" value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} rows={13} className="mt-1 font-sans text-sm leading-relaxed" />
            </div>

            <div className="rounded-md border p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Adjuntos</div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <a href={`/api/ordenes-compra/${previa.orden.id}/pdf?ver=1`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-medium text-primary underline-offset-2 hover:underline">
                  <FileText className="h-4 w-4" /> {previa.adjuntos.find((a) => a.clave === "pdf")?.nombre} <span className="text-xs font-normal text-muted-foreground">(ver)</span>
                </a>
                <label className="flex items-center gap-2">
                  <Checkbox checked={conExcel} onCheckedChange={(c) => setConExcel(!!c)} />
                  <FileSpreadsheet className="h-4 w-4" /> También el Excel ({previa.adjuntos.find((a) => a.clave === "excel")?.nombre})
                </label>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {previa.orden.renglones} artículos · total {moneda(previa.orden.total)} sin impuestos. El proveedor recibe un solo pedido: no se le separa lo que viene con y sin factura.
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCerrar} disabled={enviando}>Cancelar</Button>
          <Button onClick={enviar} disabled={!sePuede || enviando || !para.trim()} className={prueba ? "bg-amber-600 hover:bg-amber-700" : ""}>
            {enviando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</>
              : prueba && envio?.ok ? <><FlaskConical className="mr-2 h-4 w-4" /> Enviar PRUEBA a {envio.mail_prueba}</>
              : <><Send className="mr-2 h-4 w-4" /> {reenvio ? "Reenviar al proveedor" : "Enviar al proveedor"}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
