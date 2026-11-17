"use client"

// Envío de órdenes de compra: a la vista de todos si está en MODO PRUEBA y, para el admin, el
// lugar donde se cambia (cuenta de envío, dirección de prueba y el interruptor). El ajuste vive
// en la base (una fila); acá solo se muestra y se pide el cambio al servidor.

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Mail, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { fechaHora } from "@/lib/formato"

interface Ajustes {
  ok: boolean
  bloqueo?: string
  admin: boolean
  cuenta_envio?: string
  cuenta_conectada?: boolean
  como_conectar?: string | null
  modo_prueba?: boolean
  mail_prueba?: string
  actualizado_at?: string | null
  actualizado_por?: string | null
  frase_confirmacion?: string
}

export function AjustesEnvioOrdenes({ onCambio }: { onCambio?: () => void }) {
  const [a, setA] = useState<Ajustes | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [cuenta, setCuenta] = useState("")
  const [mailPrueba, setMailPrueba] = useState("")
  const [apagar, setApagar] = useState(false)
  const [frase, setFrase] = useState("")
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/ordenes-compra/ajustes-envio", { cache: "no-store" })
      const d = await r.json().catch(() => null)
      if (r.ok && d) { setA(d); setCuenta(d.cuenta_envio || ""); setMailPrueba(d.mail_prueba || "") }
    } catch { /* sin datos: no se muestra el botón */ }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const guardar = async (cambios: Record<string, unknown>, mensaje: string) => {
    if (guardando) return
    setGuardando(true)
    try {
      const r = await fetch("/api/ordenes-compra/ajustes-envio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cambios) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d.error || "No se pudo guardar.", { duration: 12000 }); return }
      toast.success(mensaje)
      setApagar(false); setFrase("")
      await cargar()
      onCambio?.()
    } finally { setGuardando(false) }
  }

  if (!a) return null
  const prueba = !a.ok || a.modo_prueba !== false
  const fraseOk = !!a.frase_confirmacion && frase.trim() === a.frase_confirmacion

  return (
    <>
      <Button variant="outline" onClick={() => { setApagar(false); setFrase(""); setAbierto(true) }}
        className={prueba ? "border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100" : "border-green-300 bg-green-50 text-green-800 hover:bg-green-100"}
        title="A dónde van los mails de las órdenes de compra">
        {prueba ? <FlaskConical className="mr-2 h-4 w-4" /> : <Mail className="mr-2 h-4 w-4" />}
        {!a.ok ? "Envío de órdenes: bloqueado" : prueba ? "Envío de órdenes: MODO PRUEBA" : "Envío de órdenes: a los proveedores"}
      </Button>

      <Dialog open={abierto} onOpenChange={(v) => { if (!guardando) setAbierto(v) }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Envío de órdenes de compra por mail</DialogTitle>
            <DialogDescription>De qué cuenta salen y a quién le llegan. Vale para todas las órdenes y todos los usuarios.</DialogDescription>
          </DialogHeader>

          {!a.ok ? (
            <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <ShieldAlert className="h-4 w-4 shrink-0" /> <span>{a.bloqueo}</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className={`flex gap-2 rounded-md border p-3 text-sm ${prueba ? "border-amber-300 bg-amber-50 text-amber-900" : "border-green-300 bg-green-50 text-green-900"}`}>
                {prueba ? <FlaskConical className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
                <span>
                  {prueba
                    ? <><b>MODO PRUEBA encendido.</b> Todos los mails de órdenes de compra van solo a <b>{a.mail_prueba}</b>. A los proveedores no les llega nada, diga lo que diga el campo “Para”.</>
                    : <><b>Envío real.</b> Los mails de las órdenes de compra les llegan a los proveedores.</>}
                </span>
              </div>

              <div className="text-sm">
                <div><span className="text-muted-foreground">Salen desde:</span> <b>{a.cuenta_envio}</b>{" "}
                  {a.cuenta_conectada ? <span className="text-green-700">(conectada)</span> : <span className="font-semibold text-red-600">(NO conectada)</span>}</div>
                {!a.cuenta_conectada && a.como_conectar && <div className="mt-1 rounded-md border border-red-200 bg-red-50 p-2 text-red-800">{a.como_conectar}</div>}
                {a.actualizado_at && <div className="mt-1 text-xs text-muted-foreground">Último cambio: {fechaHora(a.actualizado_at)}{a.actualizado_por ? ` por ${a.actualizado_por}` : ""}.</div>}
              </div>

              {!a.admin && <div className="text-sm text-muted-foreground">Solo un administrador puede cambiar esto.</div>}

              {a.admin && (
                <>
                  <div className="grid gap-3 rounded-md border p-3">
                    <div>
                      <Label htmlFor="envio-cuenta">Cuenta de Gmail de la que salen las órdenes</Label>
                      <Input id="envio-cuenta" value={cuenta} onChange={(e) => setCuenta(e.target.value)} autoComplete="off" />
                    </div>
                    <div>
                      <Label htmlFor="envio-prueba">Dirección a la que van los mails en modo prueba</Label>
                      <Input id="envio-prueba" value={mailPrueba} onChange={(e) => setMailPrueba(e.target.value)} autoComplete="off" />
                    </div>
                    <div>
                      <Button variant="outline" disabled={guardando || (cuenta.trim().toLowerCase() === a.cuenta_envio && mailPrueba.trim().toLowerCase() === a.mail_prueba)}
                        onClick={() => guardar({ cuenta_envio: cuenta, mail_prueba: mailPrueba }, "Direcciones guardadas.")}>
                        {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Guardar direcciones
                      </Button>
                    </div>
                  </div>

                  {prueba ? (
                    <div className="rounded-md border border-red-200 p-3">
                      {!apagar ? (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm">Cuando termine la prueba y haya que mandarles las órdenes a los proveedores:</span>
                          <Button variant="outline" className="text-red-700 hover:bg-red-50" onClick={() => setApagar(true)}>Apagar el modo prueba…</Button>
                        </div>
                      ) : (
                        <div className="space-y-2 text-sm">
                          <div className="flex gap-2 font-semibold text-red-700"><AlertTriangle className="h-4 w-4 shrink-0" /> Desde que lo apagues, cada orden que se envíe le llega al proveedor de verdad.</div>
                          <Label htmlFor="envio-frase">Para confirmar, escribí exactamente: <span className="font-mono">{a.frase_confirmacion}</span></Label>
                          <Input id="envio-frase" value={frase} onChange={(e) => setFrase(e.target.value)} autoComplete="off" onPaste={(e) => e.preventDefault()} />
                          <div className="flex gap-2">
                            <Button variant="outline" onClick={() => { setApagar(false); setFrase("") }} disabled={guardando}>No, dejarlo en prueba</Button>
                            <Button className="bg-red-600 hover:bg-red-700" disabled={!fraseOk || guardando}
                              onClick={() => guardar({ modo_prueba: false, confirmacion: frase }, "Modo prueba APAGADO: los mails van a los proveedores.")}>
                              {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Apagar el modo prueba
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                      <span className="text-sm">¿Vas a hacer pruebas? Volvé a encenderlo y nada le llega a los proveedores.</span>
                      <Button variant="outline" disabled={guardando} onClick={() => guardar({ modo_prueba: true }, "Modo prueba ENCENDIDO.")}>Encender el modo prueba</Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)} disabled={guardando}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
