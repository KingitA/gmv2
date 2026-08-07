"use client"

// Barra de registro rápido de la Caja del Día — misma experiencia de
// imputación que choferes/vendedores (ComprobantesSelector: pedidos completos,
// comprobantes dentro del pedido, anticipos con 10% contado, chip "Dto. ctdo"),
// más bonificación 10% por pago contado y fotos de comprobantes con carga,
// cámara o PEGAR captura (Ctrl+V).
// Backend: POST /api/pagos-clientes (metodos + imputaciones + pedidos_contado
// + comprobante_urls + confirmar). El efectivo confirma en el acto (entra a la
// caja elegida); transferencias/echeqs/cheques quedan pendientes hasta su
// Confirmar/Aceptar en la fila.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { EntitySearchSelect } from "@/components/search/EntitySearchSelect"
import { FechaInput } from "@/components/finanzas/fecha-input"
import {
  ComprobantesSelector,
  PEDIDO_PREFIX,
  type Comprobante,
} from "@/components/pagos/ComprobantesSelector"
import { BcraDeudorChip } from "@/components/pagos/BcraDeudorChip"
import { useToast } from "@/hooks/use-toast"
import { todayArgentina } from "@/lib/utils"
import { Camera, ChevronDown, ChevronUp, ClipboardPaste, Loader2, Paperclip, Plus, X } from "lucide-react"

export interface CuentaFondos {
  cuenta_tipo: string
  cuenta_id: string
  nombre: string
  grupo: string
}

type Metodo = "efectivo" | "transferencia" | "echeq" | "cheque"

const METODOS: { key: Metodo; label: string }[] = [
  { key: "efectivo", label: "💵 Efectivo" },
  { key: "transferencia", label: "🏦 Transf." },
  { key: "echeq", label: "⚡ Echeq" },
  { key: "cheque", label: "📄 Cheque" },
]

const NUM = { fontVariantNumeric: "tabular-nums" } as const
const fmt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 })
const round2 = (n: number) => Math.round(n * 100) / 100

const inputCls =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"

export function RegistrarCobro({
  cuentas,
  onRegistrado,
}: {
  cuentas: CuentaFondos[]
  onRegistrado: () => void
}) {
  const { toast } = useToast()
  const [cliente, setCliente] = useState<any>(null)
  const [metodo, setMetodo] = useState<Metodo>("efectivo")
  const [monto, setMonto] = useState("")
  const [guardando, setGuardando] = useState(false)
  // Campos por método
  const [cajaId, setCajaId] = useState("")
  const [cuentaBancariaId, setCuentaBancariaId] = useState("")
  const [numeroOperacion, setNumeroOperacion] = useState("")
  const [banco, setBanco] = useState("")
  const [numeroCheque, setNumeroCheque] = useState("")
  const [fechaCheque, setFechaCheque] = useState("")
  // CUIT del emisor del cheque → consulta Central de Deudores BCRA (chip)
  const [cuitEmisor, setCuitEmisor] = useState("")
  // Imputación (selector de pedidos/comprobantes, igual que choferes/vendedores)
  const [imputarAbierto, setImputarAbierto] = useState(false)
  const [seleccionados, setSeleccionados] = useState<Record<string, number>>({})
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([])
  const [dtosHechos, setDtosHechos] = useState<Set<string>>(new Set())
  const [contadoPedidos, setContadoPedidos] = useState<Set<string>>(new Set())
  const [aplicarContado, setAplicarContado] = useState(false)
  // Fotos de comprobantes
  const [archivos, setArchivos] = useState<{ url: string; nombre: string }[]>([])
  const [subiendo, setSubiendo] = useState(false)
  // Datos extra que el OCR detecta y la barra no muestra (van igual al pago)
  const [ocrExtra, setOcrExtra] = useState<{
    cuit_emisor?: string
    fecha_emision?: string
    localidad?: string
    fecha_transferencia?: string
  }>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)

  const cajas = useMemo(() => cuentas.filter((c) => c.grupo === "EFECTIVO"), [cuentas])
  const bancos = useMemo(() => cuentas.filter((c) => c.grupo === "BANCOS"), [cuentas])
  const cajaChicaDefault = useMemo(
    () => cajas.find((c) => c.nombre.toLowerCase().includes("chica"))?.cuenta_id ?? cajas[0]?.cuenta_id ?? "",
    [cajas]
  )

  // Reset de imputación/fotos al cambiar de cliente
  useEffect(() => {
    setSeleccionados({})
    setAplicarContado(false)
    setImputarAbierto(false)
  }, [cliente?.id])

  const totalSeleccionado = useMemo(
    () => Object.values(seleccionados).reduce((s, v) => s + (Number(v) || 0), 0),
    [seleccionados]
  )

  // Preview del 10% contado (misma fórmula que Pagos Clientes)
  const bonificacionEstimada = useMemo(() => {
    if (!aplicarContado) return 0
    let total = 0
    for (const [key] of Object.entries(seleccionados)) {
      if (key.startsWith(PEDIDO_PREFIX) || dtosHechos.has(key)) continue
      const comp = comprobantes.find((c) => c.id === key)
      if (!comp) continue
      if (comp.tipo_comprobante === "PRES") total += Math.abs(Number(comp.total_factura)) * 0.1
      else {
        const neto10 = Number(comp.total_neto) * 0.1
        total += neto10 + neto10 * 0.21
      }
    }
    return round2(total)
  }, [aplicarContado, seleccionados, dtosHechos, comprobantes])

  // ── Fotos: subir / cámara / pegar captura ──
  const subirArchivos = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      setSubiendo(true)
      try {
        const fd = new FormData()
        for (const f of files) fd.append("files", f)
        const res = await fetch("/api/pagos-clientes/ocr", { method: "POST", body: fd })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Error subiendo el archivo")
        const nuevos = (data.archivos || []).filter((a: any) => a?.url)
        setArchivos((prev) => [...prev, ...nuevos])

        // ── Aplicar lo que el OCR detectó a los campos de la barra ──
        const resultados: any[] = data.resultados || []
        if (!resultados.length) {
          toast({
            title: "Foto adjuntada",
            description: "No se detectaron datos en la imagen — completá los campos a mano (la foto queda pegada al cobro).",
          })
          return
        }
        const r = resultados[0]
        const fmtFecha = (f?: string) => (f ? f.split("-").reverse().join("/") : "")
        if (r.tipo === "cheque") {
          const esEcheq = r.color_cheque === "ECHEQ"
          setMetodo(esEcheq ? "echeq" : "cheque")
          if (r.banco_emisor) setBanco(r.banco_emisor)
          if (r.numero_cheque) setNumeroCheque(String(r.numero_cheque))
          if (r.fecha_cheque) setFechaCheque(r.fecha_cheque)
          if (r.monto) setMonto(String(r.monto))
          if (r.cuit_emisor) setCuitEmisor(String(r.cuit_emisor))
          setOcrExtra({
            fecha_emision: r.fecha_emision || undefined,
            localidad: r.localidad || undefined,
          })
          toast({
            title: esEcheq ? "⚡ Echeq detectado" : "📄 Cheque detectado",
            description: `${r.banco_emisor ?? ""} ${r.numero_cheque ?? ""}${r.fecha_cheque ? ` · vence ${fmtFecha(r.fecha_cheque)}` : ""}${r.monto ? ` · $ ${Number(r.monto).toLocaleString("es-AR")}` : ""} — revisá y Registrar.`,
          })
        } else if (r.tipo === "transferencia") {
          setMetodo("transferencia")
          if (r.cuenta_bancaria_id) setCuentaBancariaId(r.cuenta_bancaria_id)
          if (r.numero_comprobante) setNumeroOperacion(String(r.numero_comprobante))
          if (r.monto) setMonto(String(r.monto))
          setOcrExtra({ fecha_transferencia: r.fecha_transferencia || undefined })
          toast({
            title: "🏦 Transferencia detectada",
            description: `${r.banco_nombre ? `→ ${r.banco_nombre}` : "Elegí el banco destino"}${r.numero_comprobante ? ` · op. ${r.numero_comprobante}` : ""}${r.monto ? ` · $ ${Number(r.monto).toLocaleString("es-AR")}` : ""} — revisá y Registrar.`,
          })
        } else {
          toast({
            title: "Depósito detectado",
            description: "Los depósitos con varios ítems se cargan desde Pagos Clientes; la foto igual queda adjunta.",
          })
        }
        if (resultados.length > 1) {
          toast({
            title: `${resultados.length} comprobantes en la imagen`,
            description: "La barra carga de a uno: registrá este y volvé a subir la foto para el siguiente.",
          })
        }
      } catch (e: any) {
        toast({ variant: "destructive", title: "Error con la foto", description: e.message })
      } finally {
        setSubiendo(false)
      }
    },
    [toast]
  )

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files: File[] = []
      for (const item of Array.from(e.clipboardData?.items || [])) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile()
          if (f) files.push(new File([f], `captura-${Date.now()}.png`, { type: f.type }))
        }
      }
      if (files.length) {
        e.preventDefault()
        subirArchivos(files)
      }
    },
    [subirArchivos]
  )

  const limpiar = () => {
    setCliente(null)
    setMonto("")
    setNumeroOperacion("")
    setBanco("")
    setNumeroCheque("")
    setFechaCheque("")
    setCuitEmisor("")
    setImputarAbierto(false)
    setSeleccionados({})
    setAplicarContado(false)
    setArchivos([])
    setOcrExtra({})
  }

  const registrar = async () => {
    const montoNum = Number(monto.replace(",", "."))
    if (!cliente) {
      toast({ variant: "destructive", title: "Falta el cliente", description: "Buscalo por nombre o CUIT" })
      return
    }
    if (!montoNum || montoNum <= 0) {
      toast({ variant: "destructive", title: "Monto inválido", description: "Ingresá un monto mayor a 0" })
      return
    }
    if ((metodo === "cheque" || metodo === "echeq") && !numeroCheque) {
      toast({ variant: "destructive", title: "Falta el número", description: "Cargá el número del cheque/echeq" })
      return
    }
    if (totalSeleccionado > montoNum + 0.01) {
      toast({
        variant: "destructive",
        title: "Imputación excedida",
        description: `Seleccionaste $ ${fmt(totalSeleccionado)} y el cobro es de $ ${fmt(montoNum)}.`,
      })
      return
    }

    const metodoPayload: any = { tipo: metodo === "echeq" ? "cheque" : metodo, monto: montoNum }
    if (metodo === "efectivo") {
      metodoPayload.caja_id = cajaId || cajaChicaDefault || undefined
    } else if (metodo === "transferencia") {
      if (cuentaBancariaId) metodoPayload.cuenta_bancaria_id = cuentaBancariaId
      metodoPayload.fecha_transferencia = ocrExtra.fecha_transferencia || todayArgentina()
      if (numeroOperacion) metodoPayload.numero_comprobante = numeroOperacion
    } else {
      metodoPayload.banco_emisor = banco || undefined
      metodoPayload.numero_cheque = numeroCheque
      metodoPayload.fecha_cheque = fechaCheque || todayArgentina()
      if (cuitEmisor) metodoPayload.cuit_emisor = cuitEmisor
      if (ocrExtra.fecha_emision) metodoPayload.fecha_emision = ocrExtra.fecha_emision
      if (ocrExtra.localidad) metodoPayload.localidad = ocrExtra.localidad
      if (metodo === "echeq") metodoPayload.color_cheque = "ECHEQ"
    }

    // Igual que Pagos Clientes: los "pedido:<id>" son anticipos (no se imputan)
    const imputaciones = Object.entries(seleccionados)
      .filter(([k, v]) => !k.startsWith(PEDIDO_PREFIX) && Number(v) > 0)
      .map(([comprobante_id, v]) => ({ comprobante_id, monto_imputado: Number(v) }))
    const anticipos = Object.keys(seleccionados).filter((k) => k.startsWith(PEDIDO_PREFIX))
    const obsAnticipo = anticipos.length
      ? `Anticipo a pedido(s) sin facturar: ${anticipos.map((k) => k.replace(PEDIDO_PREFIX, "")).join(", ")}`
      : undefined

    const esEfectivo = metodo === "efectivo"
    setGuardando(true)
    try {
      const res = await fetch("/api/pagos-clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: cliente.id,
          metodos: [metodoPayload],
          imputaciones,
          observaciones: obsAnticipo,
          pedidos_contado: [...contadoPedidos],
          comprobante_urls: archivos,
          confirmar: esEfectivo, // el efectivo entra a la caja en el acto
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error registrando el cobro")
      const pagoId = data.pago?.id ?? data.id

      // Bonificación 10% contado (solo cobros confirmados, igual que Pagos Clientes)
      let bonifMsg = ""
      if (aplicarContado && esEfectivo) {
        const comprobanteIds = Object.keys(seleccionados).filter(
          (k) => !k.startsWith(PEDIDO_PREFIX) && !dtosHechos.has(k)
        )
        if (comprobanteIds.length) {
          try {
            const bonifRes = await fetch("/api/pagos/generar-bonificacion", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cliente_id: cliente.id, comprobante_ids: comprobanteIds, pago_id: pagoId }),
            })
            const bonifData = await bonifRes.json()
            if (bonifRes.ok) bonifMsg = ` NC por bonificación contado: $ ${fmt(Number(bonifData.total_bonificacion) || 0)}.`
            else bonifMsg = ` ⚠ La bonificación falló: ${bonifData.error || "revisala a mano"}.`
          } catch {
            bonifMsg = " ⚠ La bonificación no se pudo generar — revisala a mano."
          }
        }
      } else if (aplicarContado && !esEfectivo) {
        bonifMsg = " El 10% contado se aplica cuando confirmes el valor."
      }

      toast({
        title: esEfectivo ? "Cobro en caja" : "Cobro registrado",
        description: esEfectivo
          ? `${cliente.razon_social || cliente.nombre}: entró a la caja${imputaciones.length ? " e imputado" : ", pendiente de imputación"}.${bonifMsg}`
          : `${cliente.razon_social || cliente.nombre}: pendiente de confirmación en la lista.${bonifMsg}`,
      })
      limpiar()
      onRegistrado()
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="mb-4 rounded-xl border-2 border-blue-500 bg-white px-3.5 py-2.5" onPaste={onPaste}>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-[260px] flex-1">
          <EntitySearchSelect entity="clientes" value={cliente} onSelect={setCliente} compact />
        </div>
        <div className="inline-flex rounded-lg bg-slate-200 p-0.5">
          {METODOS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetodo(m.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                metodo === m.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {metodo === "efectivo" && (
          <select
            value={cajaId || cajaChicaDefault}
            onChange={(e) => setCajaId(e.target.value)}
            className={inputCls}
            title="Caja destino"
          >
            {cajas.map((c) => (
              <option key={c.cuenta_id} value={c.cuenta_id}>
                → {c.nombre}
              </option>
            ))}
          </select>
        )}
        {metodo === "transferencia" && (
          <>
            <select
              value={cuentaBancariaId}
              onChange={(e) => setCuentaBancariaId(e.target.value)}
              className={inputCls}
              title="Banco destino"
            >
              <option value="">Banco destino…</option>
              {bancos.map((b) => (
                <option key={b.cuenta_id} value={b.cuenta_id}>
                  → {b.nombre}
                </option>
              ))}
            </select>
            <input
              value={numeroOperacion}
              onChange={(e) => setNumeroOperacion(e.target.value)}
              placeholder="Nº operación"
              className={`${inputCls} w-32`}
            />
          </>
        )}
        {(metodo === "cheque" || metodo === "echeq") && (
          <>
            <input
              value={banco}
              onChange={(e) => setBanco(e.target.value)}
              placeholder="Banco emisor"
              className={`${inputCls} w-36`}
            />
            <input
              value={numeroCheque}
              onChange={(e) => setNumeroCheque(e.target.value)}
              placeholder="Número"
              className={`${inputCls} w-28`}
            />
            <FechaInput value={fechaCheque} onChange={setFechaCheque} placeholder="Vencimiento" containerClassName="w-[120px]" />
            <input
              value={cuitEmisor}
              onChange={(e) => setCuitEmisor(e.target.value.replace(/[^\d-]/g, ""))}
              placeholder="CUIT emisor"
              inputMode="numeric"
              className={`${inputCls} w-32`}
              title="Se consulta en la Central de Deudores del BCRA"
            />
          </>
        )}

        <input
          value={monto}
          onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && registrar()}
          placeholder="$ monto"
          inputMode="decimal"
          className={`${inputCls} w-32 text-right font-semibold`}
          style={NUM}
        />
        <button
          onClick={registrar}
          disabled={guardando}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Registrar
        </button>
      </div>

      {/* ── Semáforo BCRA del emisor del cheque (Central de Deudores) ── */}
      {(metodo === "cheque" || metodo === "echeq") && cuitEmisor.replace(/\D/g, "").length >= 10 && (
        <div className="mt-2">
          <BcraDeudorChip cuit={cuitEmisor} />
        </div>
      )}

      {/* ── Fotos: subir / cámara / pegar (para transferencias, cheques, echeqs) ── */}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          hidden
          onChange={(e) => {
            subirArchivos(Array.from(e.target.files || []))
            e.target.value = ""
          }}
        />
        <input
          ref={camRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            subirArchivos(Array.from(e.target.files || []))
            e.target.value = ""
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={subiendo}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {subiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          Subir foto
        </button>
        <button
          onClick={() => camRef.current?.click()}
          disabled={subiendo}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <Camera className="h-3.5 w-3.5" /> Sacar foto
        </button>
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
          <ClipboardPaste className="h-3.5 w-3.5" /> o pegá una captura acá (Ctrl+V)
        </span>
        {archivos.map((a, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700"
          >
            📎 {a.nombre || `adjunto ${i + 1}`}
            <button
              onClick={() => setArchivos((prev) => prev.filter((_, j) => j !== i))}
              className="text-blue-400 hover:text-blue-700"
              title="Quitar"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      {/* ── Imputación: pedidos y comprobantes, igual que choferes/vendedores ── */}
      {cliente && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={() => setImputarAbierto((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
            >
              {imputarAbierto ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              Imputar a pedidos / comprobantes (opcional — si no, queda pendiente de imputación)
              {totalSeleccionado > 0 && (
                <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700" style={NUM}>
                  $ {fmt(totalSeleccionado)}
                </span>
              )}
            </button>
            {imputarAbierto && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                <input
                  type="checkbox"
                  checked={aplicarContado}
                  onChange={(e) => setAplicarContado(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                10% descuento pago contado
                {bonificacionEstimada > 0 && (
                  <span style={NUM}>· NC estimada $ {fmt(bonificacionEstimada)}</span>
                )}
              </label>
            )}
          </div>
          {imputarAbierto && (
            <div className="mt-2">
              <ComprobantesSelector
                clienteId={cliente.id}
                seleccionados={seleccionados}
                onChange={setSeleccionados}
                onComprobantesLoaded={setComprobantes}
                onDtosHechosLoaded={setDtosHechos}
                onContadoPedidosChange={setContadoPedidos}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
