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
import { BcraDeudorMulti } from "@/components/pagos/BcraDeudorChip"
import { useToast } from "@/hooks/use-toast"
import { todayArgentina } from "@/lib/utils"
import { MARCA_CONTADO } from "@/lib/constants"
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
  // CUIT del emisor del cheque → consulta Central de Deudores BCRA (chip).
  // Cuentas conjuntas: el OCR puede detectar 2+ CUITs; se consultan TODOS.
  const [cuitEmisor, setCuitEmisor] = useState("")
  const [cuitsTitulares, setCuitsTitulares] = useState<string[]>([])
  // Cobros mixtos (ej: transferencia + efectivo): métodos ya cargados del cobro
  const [metodosAgregados, setMetodosAgregados] = useState<
    { payload: any; label: string; monto: number }[]
  >([])
  // Monto "confirmado" del método en edición: se fija al salir del campo (blur),
  // no en cada tecla — para que "Resta saldar" no baile mientras tipeás.
  const [montoConfirmado, setMontoConfirmado] = useState(0)
  // Cartel "Falta pagar $X": ajuste por redondeo vs dejar saldo pendiente
  const [dialogoFalta, setDialogoFalta] = useState<number | null>(null)
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
  // Clave de idempotencia del cobro: estable ante doble click/reintento, se
  // rota recién cuando el alta salió bien (el backend deduplica por esta clave)
  const idemKeyRef = useRef<string>(crypto.randomUUID())

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

  // Preview del 10% contado: la NC devuelve el 10% de TODOS los componentes
  // (neto + IVA + percepciones) → exactamente 10% del total de cada comprobante.
  const bonificacionEstimada = useMemo(() => {
    if (!aplicarContado) return 0
    let total = 0
    for (const [key] of Object.entries(seleccionados)) {
      if (key.startsWith(PEDIDO_PREFIX) || dtosHechos.has(key)) continue
      const comp = comprobantes.find((c) => c.id === key)
      if (comp) total += Math.abs(Number(comp.total_factura)) * 0.1
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
          if (r.monto) { setMonto(String(r.monto)); setMontoConfirmado(Number(r.monto) || 0) }
          if (r.cuit_emisor) setCuitEmisor(String(r.cuit_emisor))
          const titulares: string[] = Array.isArray(r.cuits_titulares) ? r.cuits_titulares : []
          setCuitsTitulares(titulares)
          setOcrExtra({
            fecha_emision: r.fecha_emision || undefined,
            localidad: r.localidad || undefined,
          })
          toast({
            title: esEcheq ? "⚡ Echeq detectado" : "📄 Cheque detectado",
            description: `${r.banco_emisor ?? ""} ${r.numero_cheque ?? ""}${r.fecha_cheque ? ` · vence ${fmtFecha(r.fecha_cheque)}` : ""}${r.monto ? ` · $ ${Number(r.monto).toLocaleString("es-AR")}` : ""}${titulares.length > 1 ? ` · cuenta conjunta (${titulares.length} titulares, se consultan todos en BCRA)` : ""} — revisá y Registrar.`,
          })
        } else if (r.tipo === "transferencia") {
          setMetodo("transferencia")
          if (r.cuenta_bancaria_id) setCuentaBancariaId(r.cuenta_bancaria_id)
          if (r.numero_comprobante) setNumeroOperacion(String(r.numero_comprobante))
          if (r.monto) { setMonto(String(r.monto)); setMontoConfirmado(Number(r.monto) || 0) }
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

  const limpiarMetodoActual = () => {
    setMonto("")
    setMontoConfirmado(0)
    setNumeroOperacion("")
    setBanco("")
    setNumeroCheque("")
    setFechaCheque("")
    setCuitEmisor("")
    setCuitsTitulares([])
    setOcrExtra({})
  }

  const limpiar = () => {
    setCliente(null)
    limpiarMetodoActual()
    setMetodosAgregados([])
    setImputarAbierto(false)
    setSeleccionados({})
    setAplicarContado(false)
    setArchivos([])
  }

  // Arma el payload del método que se está editando en la barra (null si incompleto)
  const construirMetodoActual = (): { payload: any; label: string; monto: number } | null => {
    const montoNum = Number(monto.replace(",", "."))
    if (!montoNum || montoNum <= 0) return null
    if ((metodo === "cheque" || metodo === "echeq") && !numeroCheque) return null
    const payload: any = { tipo: metodo === "echeq" ? "cheque" : metodo, monto: montoNum }
    let label = ""
    if (metodo === "efectivo") {
      payload.caja_id = cajaId || cajaChicaDefault || undefined
      label = `💵 Efectivo`
    } else if (metodo === "transferencia") {
      if (cuentaBancariaId) payload.cuenta_bancaria_id = cuentaBancariaId
      payload.fecha_transferencia = ocrExtra.fecha_transferencia || todayArgentina()
      if (numeroOperacion) payload.numero_comprobante = numeroOperacion
      const b = bancos.find((x) => x.cuenta_id === cuentaBancariaId)
      label = `🏦 Transf.${b ? ` → ${b.nombre}` : ""}`
    } else {
      payload.banco_emisor = banco || undefined
      payload.numero_cheque = numeroCheque
      payload.fecha_cheque = fechaCheque || todayArgentina()
      if (cuitEmisor) payload.cuit_emisor = cuitEmisor
      if (ocrExtra.fecha_emision) payload.fecha_emision = ocrExtra.fecha_emision
      if (ocrExtra.localidad) payload.localidad = ocrExtra.localidad
      if (metodo === "echeq") payload.color_cheque = "ECHEQ"
      label = `${metodo === "echeq" ? "⚡ Echeq" : "📄 Cheque"} ${numeroCheque}`
    }
    return { payload, label, monto: montoNum }
  }

  const agregarOtroMetodo = () => {
    const actual = construirMetodoActual()
    if (!actual) {
      toast({
        variant: "destructive",
        title: "Completá el método actual",
        description: "Cargá el monto (y el número si es cheque/echeq) antes de agregar otro.",
      })
      return
    }
    setMetodosAgregados((prev) => [...prev, actual])
    limpiarMetodoActual()
    setMetodo("efectivo")
  }

  const totalCobro =
    metodosAgregados.reduce((s, m) => s + m.monto, 0) + (Number(monto.replace(",", ".")) || 0)

  // ── Resumen del cobro (se actualiza al confirmar el monto, no por tecla) ──
  // Neto a cobrar = lo seleccionado − la NC del 10% (si está tildado).
  const totalCobroConfirmado = metodosAgregados.reduce((s, m) => s + m.monto, 0) + montoConfirmado
  const netoACobrar = round2(totalSeleccionado - (aplicarContado ? bonificacionEstimada : 0))
  const restaSaldar = round2(netoACobrar - totalCobroConfirmado)
  const mostrarResumen = totalSeleccionado > 0 && (totalCobroConfirmado > 0 || aplicarContado)

  const registrar = async (modoDiferencia?: "saldo" | "ajuste") => {
    setDialogoFalta(null)
    if (!cliente) {
      toast({ variant: "destructive", title: "Falta el cliente", description: "Buscalo por nombre o CUIT" })
      return
    }
    // Métodos del cobro: los ya agregados + el que está en la barra (si tiene monto)
    const actual = construirMetodoActual()
    const metodosCobro = [...metodosAgregados, ...(actual ? [actual] : [])]
    if (!metodosCobro.length) {
      toast({ variant: "destructive", title: "Monto inválido", description: "Ingresá un monto mayor a 0" })
      return
    }
    if (!actual && Number(monto.replace(",", ".")) > 0) {
      toast({ variant: "destructive", title: "Falta el número", description: "Cargá el número del cheque/echeq" })
      return
    }
    // Igual que Pagos Clientes: los "pedido:<id>" son anticipos (no se imputan)
    let imputaciones = Object.entries(seleccionados)
      .filter(([k, v]) => !k.startsWith(PEDIDO_PREFIX) && Number(v) > 0)
      .map(([comprobante_id, v]) => ({ comprobante_id, monto_imputado: Number(v) }))
    const anticipos = Object.keys(seleccionados).filter((k) => k.startsWith(PEDIDO_PREFIX))

    // Lo que cubre el cobro = métodos + NC del 10% (si está tildado). Si falta
    // plata para lo seleccionado, la decisión es del operador (cartel):
    //  - "ajuste": se imputa completo y la diferencia se pasa como ajuste por
    //    redondeo (crédito en cuenta corriente) → nadie cobra centavos.
    //  - "saldo": se recorta la última imputación (pago parcial, queda saldo).
    const totalMetodos = metodosCobro.reduce((s, m) => s + m.monto, 0)
    const cubierto = round2(totalMetodos + (aplicarContado ? bonificacionEstimada : 0))
    const falta = round2(totalSeleccionado - cubierto)
    const totalImputable = imputaciones.reduce((s, i) => s + i.monto_imputado, 0)
    let recorte = 0

    if (falta > 0.01) {
      if (falta > totalImputable + 0.01) {
        // Ni recortando todas las imputaciones alcanza (ej: anticipos a
        // pedidos sin facturar mayores que la plata entregada)
        toast({
          variant: "destructive",
          title: "Falta plata para lo seleccionado",
          description: `Entre métodos${aplicarContado ? " + NC 10%" : ""} cubrís $ ${fmt(cubierto)} y seleccionaste $ ${fmt(totalSeleccionado)}. Bajá la selección o agregá un método.`,
        })
        return
      }
      if (!modoDiferencia) {
        setDialogoFalta(falta)
        return
      }
      if (modoDiferencia === "saldo") {
        let excedente = falta
        for (let i = imputaciones.length - 1; i >= 0 && excedente > 0.005; i--) {
          const rebaja = Math.min(imputaciones[i].monto_imputado, excedente)
          imputaciones[i].monto_imputado = round2(imputaciones[i].monto_imputado - rebaja)
          excedente = round2(excedente - rebaja)
          recorte = round2(recorte + rebaja)
        }
        imputaciones = imputaciones.filter((i) => i.monto_imputado > 0.009)
      }
      // modoDiferencia === "ajuste": imputaciones completas; el ajuste crédito
      // por `falta` se registra después de crear el pago.
    }
    const obsAnticipo = anticipos.length
      ? `Anticipo a pedido(s) sin facturar: ${anticipos.map((k) => k.replace(PEDIDO_PREFIX, "")).join(", ")}`
      : undefined
    // 10% tildado: la intención viaja SIEMPRE con el pago (MARCA_CONTADO) y la
    // NC/REV la emite el servidor en la confirmación — en el acto si es
    // efectivo, o al acreditarse el valor si quedó pendiente. Un solo camino,
    // idempotente: el descuento no se saltea ni se duplica nunca.
    const obsFinal = aplicarContado
      ? [obsAnticipo, MARCA_CONTADO].filter(Boolean).join(" ")
      : obsAnticipo

    // Solo-efectivo confirma en el acto; si hay algún valor (transf/cheque/echeq)
    // el cobro completo queda pendiente hasta su Confirmar (regla de Pagos Clientes).
    const esEfectivo = metodosCobro.every((m) => m.payload.tipo === "efectivo")
    setGuardando(true)
    try {
      const res = await fetch("/api/pagos-clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: cliente.id,
          metodos: metodosCobro.map((m) => m.payload),
          imputaciones,
          observaciones: obsFinal,
          pedidos_contado: [...contadoPedidos],
          comprobante_urls: archivos,
          confirmar: esEfectivo,
          idempotency_key: idemKeyRef.current,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error registrando el cobro")
      idemKeyRef.current = crypto.randomUUID()
      const pagoId = data.pago?.id ?? data.id

      // Bonificación 10% contado: la resolvió el servidor en la confirmación
      let bonifMsg = ""
      if (aplicarContado && esEfectivo) {
        if (data.bonificacion?.total) bonifMsg = ` NC por bonificación contado: $ ${fmt(Number(data.bonificacion.total) || 0)}.`
        else if (data.bonificacion_error) bonifMsg = ` ⚠ La bonificación falló: ${data.bonificacion_error}.`
      } else if (aplicarContado && !esEfectivo) {
        bonifMsg = " El 10% quedó agendado: la NC/REV sale sola al confirmar el valor."
      }

      // Ajuste por redondeo: la diferencia se acredita en cuenta corriente
      let ajusteMsg = ""
      if (modoDiferencia === "ajuste" && falta > 0.01) {
        try {
          const ajRes = await fetch(`/api/clientes/${cliente.id}/ajustes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              monto: -falta,
              motivo: `Ajuste por redondeo — cobro $ ${fmt(totalMetodos)} vs imputado $ ${fmt(totalSeleccionado)}`,
              // La falta cae en el último comprobante imputado: se salda también ahí
              comprobante_id: imputaciones[imputaciones.length - 1]?.comprobante_id,
              aplicar_saldo: true,
            }),
          })
          const ajData = await ajRes.json()
          if (!ajRes.ok) throw new Error(ajData.error)
          ajusteMsg = ` Diferencia de $ ${fmt(falta)} pasada como ajuste por redondeo.`
        } catch {
          ajusteMsg = ` ⚠ El ajuste por redondeo de $ ${fmt(falta)} falló — hacelo a mano desde la cuenta corriente.`
        }
      }

      const recorteMsg = recorte > 0.01 ? ` Pago parcial: quedan $ ${fmt(recorte)} de saldo en el comprobante.` : ""
      toast({
        title: esEfectivo ? "Cobro en caja" : "Cobro registrado",
        description: esEfectivo
          ? `${cliente.razon_social || cliente.nombre}: entró a la caja${imputaciones.length ? " e imputado" : ", pendiente de imputación"}.${recorteMsg}${ajusteMsg}${bonifMsg}`
          : `${cliente.razon_social || cliente.nombre}: pendiente de confirmación en la lista.${recorteMsg}${ajusteMsg}${bonifMsg}`,
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
          onBlur={() => setMontoConfirmado(Number(monto.replace(",", ".")) || 0)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setMontoConfirmado(Number(monto.replace(",", ".")) || 0)
              registrar()
            }
          }}
          placeholder="$ monto"
          inputMode="decimal"
          className={`${inputCls} w-32 text-right font-semibold`}
          style={NUM}
        />
        <button
          onClick={agregarOtroMetodo}
          disabled={guardando}
          title="Cobro con varios métodos (ej: transferencia + efectivo)"
          className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Otro método
        </button>
        <button
          onClick={registrar}
          disabled={guardando}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Registrar
        </button>
      </div>

      {/* ── Métodos ya agregados al cobro (cobro mixto) ── */}
      {metodosAgregados.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
          <span className="text-[11px] font-bold uppercase text-slate-400">Métodos del cobro:</span>
          {metodosAgregados.map((m, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
            >
              {m.label} · <span style={NUM}>$ {fmt(m.monto)}</span>
              <button
                onClick={() => setMetodosAgregados((prev) => prev.filter((_, j) => j !== i))}
                className="text-slate-400 hover:text-red-600"
                title="Quitar"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── Semáforo BCRA (Central de Deudores) — todos los titulares del cheque ── */}
      {(metodo === "cheque" || metodo === "echeq") && (
        <div className="mt-2">
          <BcraDeudorMulti cuits={[cuitEmisor, ...cuitsTitulares]} bancoEmisor={banco} />
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

      {/* ── LA CUENTA, en una sola línea: todo lo que hay que mirar está acá ── */}
      {(totalSeleccionado > 0 || totalCobroConfirmado > 0) && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm border-t border-slate-100">
          {totalSeleccionado > 0 ? (
            <>
              <span className="text-slate-500">
                Seleccionado <b className="text-slate-800" style={NUM}>$ {fmt(totalSeleccionado)}</b>
              </span>
              {aplicarContado && bonificacionEstimada > 0 && (
                <>
                  <span className="text-slate-400">−</span>
                  <span className="text-amber-700">
                    NC 10% <b style={NUM}>$ {fmt(bonificacionEstimada)}</b>
                  </span>
                  <span className="text-slate-400">=</span>
                  <span className="text-slate-500">
                    a cobrar <b className="text-slate-800" style={NUM}>$ {fmt(netoACobrar)}</b>
                  </span>
                </>
              )}
              <span className="text-slate-300">|</span>
            </>
          ) : null}
          <span className="text-slate-500">
            Entregado <b className="text-slate-800" style={NUM}>$ {fmt(totalCobroConfirmado)}</b>
          </span>
          {mostrarResumen &&
            (Math.abs(restaSaldar) < 0.01 ? (
              <span className="rounded-full bg-green-100 px-3 py-0.5 text-xs font-bold text-green-700">✓ Cuadra</span>
            ) : restaSaldar > 0 ? (
              <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-bold text-amber-800" style={NUM}>
                Resta saldar: $ {fmt(restaSaldar)}
              </span>
            ) : (
              <span className="rounded-full bg-blue-100 px-3 py-0.5 text-xs font-bold text-blue-700" style={NUM}>
                Sobran $ {fmt(-restaSaldar)} → a cuenta
              </span>
            ))}
        </div>
      )}

      {/* ── Cartel: falta plata para lo seleccionado — ¿redondeo o saldo? ── */}
      {dialogoFalta != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDialogoFalta(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-900">
              Falta pagar <span style={NUM}>$ {fmt(dialogoFalta)}</span>
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Lo entregado{aplicarContado ? " (más la NC del 10%)" : ""} no llega a cubrir lo
              seleccionado. ¿Qué hacemos con la diferencia?
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => registrar("ajuste")}
                className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
              >
                Pasar como ajuste por redondeo
                <span className="block text-[11px] font-normal opacity-80">
                  El comprobante queda saldado; los $ {fmt(dialogoFalta)} se acreditan como ajuste en la cuenta
                </span>
              </button>
              <button
                onClick={() => registrar("saldo")}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Dejar saldo pendiente
                <span className="block text-[11px] font-normal text-slate-400">
                  El comprobante queda parcial, con $ {fmt(dialogoFalta)} por cobrar
                </span>
              </button>
              <button
                onClick={() => setDialogoFalta(null)}
                className="w-full rounded-lg px-4 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
