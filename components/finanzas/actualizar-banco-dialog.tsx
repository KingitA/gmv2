"use client"

// "Actualizar banco" (Tanda 1 del plan de bancos): se pegan (Ctrl+V) o se sueltan capturas del
// homebanking, o se sube el Excel / CSV / PDF del banco. El sistema las lee, muestra qué es nuevo,
// qué ya estaba y qué no se pudo leer bien, y recién al tocar Guardar lo carga en la conciliación.
// No toca cuentas corrientes ni el saldo del sistema.

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, ImagePlus, X, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { fecha as fmtFecha, moneda } from "@/lib/formato"
import type { Lectura, MovLeido, ResultadoLote } from "@/lib/bancos/lectura"

interface Item { id: string; nombre: string; estado: "leyendo" | "listo" | "error"; error?: string; lectura?: Lectura; vista?: string }

const ESTADO: Record<MovLeido["estado"], { label: string; cls: string }> = {
  nuevo: { label: "Nuevo", cls: "bg-exito-50 text-exito-700" },
  ya_estaba: { label: "Ya estaba", cls: "bg-neutro-100 text-neutro-500" },
  sin_control: { label: "Sin control", cls: "bg-ambar-50 text-ambar-800" },
  error: { label: "No se guarda", cls: "bg-error-50 text-error-700" },
}

/** Achica la captura (JPEG, 2000 px de ancho como mucho): Vercel corta los pedidos de más de 4,5 MB. */
async function achicar(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size < 900_000) return file
  try {
    const bmp = await createImageBitmap(file)
    const escala = Math.min(1, 2000 / bmp.width)
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bmp.width * escala)
    canvas.height = Math.round(bmp.height * escala)
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b ?? file), "image/jpeg", 0.88))
  } catch {
    return file
  }
}

export function ActualizarBancoDialog({
  open, onOpenChange, cuentaId, cuentaNombre, mp, onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  cuentaId: string
  cuentaNombre: string
  /** Cuenta de MercadoPago: botón para leer por API (o "no conectado") */
  mp?: { conectado: boolean } | null
  onSaved: () => void
}) {
  const [items, setItems] = useState<Item[]>([])
  const [lote, setLote] = useState<ResultadoLote | null>(null)
  const [calculando, setCalculando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [leyendoMp, setLeyendoMp] = useState(false)
  const [excluir, setExcluir] = useState<Set<string>>(new Set())
  const [arrastrando, setArrastrando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const contador = useRef(0)

  const reiniciar = () => { setItems([]); setLote(null); setExcluir(new Set()) }
  useEffect(() => { if (!open) reiniciar() }, [open])

  const agregar = useCallback(async (files: File[]) => {
    for (const file of files) {
      const id = `${Date.now()}-${Math.random()}`
      contador.current += 1
      const nombre = file.name && file.name !== "image.png" ? file.name : `Captura ${contador.current}`
      const vista = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
      setItems((xs) => [...xs, { id, nombre, estado: "leyendo", vista }])
      try {
        const fd = new FormData()
        const blob = await achicar(file)
        fd.append("file", blob, blob === file ? file.name || "captura.png" : (file.name || "captura").replace(/\.\w+$/, "") + ".jpg")
        fd.append("cuenta_id", cuentaId)
        const res = await fetch("/api/finanzas/bancos-lectura/leer", { method: "POST", body: fd })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || "No se pudo leer")
        setItems((xs) => xs.map((x) => (x.id === id ? { ...x, estado: "listo", lectura: d.lectura } : x)))
      } catch (e: any) {
        setItems((xs) => xs.map((x) => (x.id === id ? { ...x, estado: "error", error: e.message } : x)))
      }
    }
  }, [cuentaId])

  // Pegar con Ctrl+V mientras el diálogo está abierto
  useEffect(() => {
    if (!open) return
    const alPegar = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? []).filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean) as File[]
      if (files.length) { e.preventDefault(); agregar(files) }
    }
    window.addEventListener("paste", alPegar)
    return () => window.removeEventListener("paste", alPegar)
  }, [open, agregar])

  // Vista previa cada vez que termina de leerse algo
  const listas = items.filter((i) => i.estado === "listo" && i.lectura)
  const leyendo = items.some((i) => i.estado === "leyendo")
  const firma = listas.map((i) => i.id).join(",")
  useEffect(() => {
    if (!open || leyendo || !listas.length) { if (!listas.length) setLote(null); return }
    let vivo = true
    setCalculando(true)
    fetch("/api/finanzas/bancos-lectura/lote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cuenta_id: cuentaId, lecturas: listas.map((i) => i.lectura), guardar: false }),
    })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); if (vivo) setLote(d.lote) })
      .catch((e) => toast.error(e.message))
      .finally(() => vivo && setCalculando(false))
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma, leyendo, open, cuentaId])

  const aGuardar = lote ? lote.filas.filter((f) => f.estado === "nuevo" || (f.estado === "sin_control" && !excluir.has(f.clave))).length : 0

  const guardar = async () => {
    setGuardando(true)
    try {
      const res = await fetch("/api/finanzas/bancos-lectura/lote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuenta_id: cuentaId, lecturas: listas.map((i) => i.lectura), guardar: true, excluir: [...excluir] }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success(`${cuentaNombre}: ${d.guardados} movimiento${d.guardados === 1 ? "" : "s"} nuevo${d.guardados === 1 ? "" : "s"}${d.lote?.saldo ? ` · saldo ${moneda(d.lote.saldo.saldo)}` : ""}`)
      onOpenChange(false)
      onSaved()
    } catch (e: any) {
      toast.error(`No se pudo guardar: ${e.message}`)
    } finally {
      setGuardando(false)
    }
  }

  const leerMp = async () => {
    setLeyendoMp(true)
    try {
      const res = await fetch("/api/finanzas/extractos/mp", { method: "POST" })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      if (d.conectado === false) toast.info("MercadoPago no conectado")
      else toast.success(`MercadoPago: ${d.importados ?? 0} nuevos${d.saldo != null ? ` · saldo ${moneda(d.saldo)}` : ""}`)
      onSaved()
    } catch (e: any) {
      toast.error(`MercadoPago: ${e.message}`)
    } finally {
      setLeyendoMp(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Actualizar {cuentaNombre}</DialogTitle>
          <DialogDescription>Pegá (Ctrl+V) o soltá capturas de los movimientos, o subí el Excel / PDF del banco.</DialogDescription>
        </DialogHeader>

        {mp && (
          <div className="flex items-center gap-2 text-sm">
            {mp.conectado ? (
              <Button variant="outline" size="sm" onClick={leerMp} disabled={leyendoMp}>
                {leyendoMp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Leer de MercadoPago
              </Button>
            ) : (
              <span className="rounded-md bg-neutro-100 px-2 py-1 text-xs font-semibold text-neutro-500">MercadoPago no conectado</span>
            )}
          </div>
        )}

        <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) agregar(fs) }} />
        <div
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastrando(false); const fs = Array.from(e.dataTransfer.files); if (fs.length) agregar(fs) }}
          onClick={() => fileRef.current?.click()}
          className={cn("flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border-2 border-dashed p-3 text-sm",
            arrastrando ? "border-azul-400 bg-azul-50" : "border-neutro-200 hover:border-azul-300")}>
          {!items.length && <span className="flex items-center gap-2 text-neutro-500"><ImagePlus className="h-4 w-4" />Ctrl+V, arrastrar o tocar para elegir</span>}
          {items.map((i) => (
            <div key={i.id} onClick={(e) => e.stopPropagation()} title={i.error}
              className={cn("relative flex items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-xs",
                i.estado === "error" ? "border-error-300 text-error-700" : "border-neutro-200")}>
              {i.vista ? <img src={i.vista} alt="" className="h-8 w-12 rounded object-cover" /> : null}
              <span className="max-w-[140px] truncate">{i.nombre}</span>
              {i.estado === "leyendo" && <Loader2 className="h-3 w-3 animate-spin" />}
              {i.estado === "listo" && <span className="text-neutro-400">{i.lectura?.filas.length}</span>}
              {i.estado === "error" && <span>no se leyó</span>}
              <button type="button" onClick={() => setItems((xs) => xs.filter((x) => x.id !== i.id))} className="text-neutro-400 hover:text-error-600"><X className="h-3 w-3" /></button>
            </div>
          ))}
        </div>

        {(leyendo || calculando) && <p className="flex items-center gap-2 text-sm text-neutro-500"><Loader2 className="h-4 w-4 animate-spin" />{leyendo ? "Leyendo…" : "Comparando con lo guardado…"}</p>}

        {lote && !leyendo && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full bg-exito-50 px-2.5 py-0.5 font-semibold text-exito-700">{lote.nuevos} nuevos</span>
              <span className="rounded-full bg-neutro-100 px-2.5 py-0.5 font-semibold text-neutro-600">{lote.ya_estaban} ya estaban</span>
              {lote.sin_control > 0 && <span className="rounded-full bg-ambar-50 px-2.5 py-0.5 font-semibold text-ambar-800">{lote.sin_control} sin control</span>}
              {lote.errores > 0 && <span className="rounded-full bg-error-50 px-2.5 py-0.5 font-semibold text-error-700">{lote.errores} no se guardan</span>}
              {lote.saldo && <span className="ml-auto text-neutro-600">Saldo del banco <b className="tabular-nums text-neutro-900">{moneda(lote.saldo.saldo)}</b>{lote.saldo.al !== "ahora" ? ` al ${fmtFecha(lote.saldo.al)}` : ""}</span>}
            </div>
            <div className="max-h-[45vh] overflow-y-auto rounded-lg border">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-neutro-50 text-left text-xs text-neutro-500">
                  <tr><th className="px-2 py-1.5">Fecha</th><th className="px-2 py-1.5">Movimiento</th><th className="px-2 py-1.5 text-right">Importe</th><th className="px-2 py-1.5 text-right">Saldo</th><th className="px-2 py-1.5" /></tr>
                </thead>
                <tbody>
                  {lote.filas.map((f) => (
                    <tr key={`${f.lectura}-${f.fila}`} className={cn("border-t", f.estado === "ya_estaba" && "text-neutro-400")}>
                      <td className="whitespace-nowrap px-2 py-1 align-top">{f.fecha ? fmtFecha(f.fecha) : "—"}{f.hora && f.hora !== "00:00:00" ? <span className="block text-[11px] text-neutro-400">{f.hora.slice(0, 5)}</span> : null}</td>
                      <td className="px-2 py-1 align-top">
                        <div className="max-w-[420px] truncate">{f.concepto}</div>
                        {(f.contraparte_nombre || f.contraparte_cuit) && <div className="max-w-[420px] truncate text-[11px] text-neutro-500">{[f.contraparte_nombre, f.contraparte_cuit].filter(Boolean).join(" · ")}</div>}
                        {f.problema && f.estado !== "ya_estaba" && <div className="text-[11px] text-error-600">{f.problema}</div>}
                      </td>
                      <td className={cn("whitespace-nowrap px-2 py-1 text-right align-top tabular-nums", f.estado !== "ya_estaba" && (f.monto < 0 ? "text-error-600" : "text-exito-700"))}>{f.monto ? moneda(f.monto) : "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right align-top tabular-nums text-neutro-500">{f.saldo != null ? moneda(f.saldo) : ""}</td>
                      <td className="whitespace-nowrap px-2 py-1 align-top">
                        <span className="inline-flex items-center gap-1.5">
                          {f.estado === "sin_control" && (
                            <Checkbox checked={!excluir.has(f.clave)} title="Guardarlo igual"
                              onCheckedChange={(v) => setExcluir((p) => { const n = new Set(p); v ? n.delete(f.clave) : n.add(f.clave); return n })} />
                          )}
                          <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", ESTADO[f.estado].cls)}>{ESTADO[f.estado].label}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={reiniciar}>Limpiar</Button>
              <Button onClick={guardar} disabled={guardando || calculando || (!aGuardar && !lote.saldo)}>
                {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {aGuardar ? `Guardar ${aGuardar}` : "Guardar saldo"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
