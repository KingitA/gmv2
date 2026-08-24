"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"
import { useBcraDeudor } from "@/components/pagos/BcraDeudorChip"
import { MARCA_CONTADO } from "@/lib/constants"

// Cobro del viajante — espejo del patrón de /caja (Caja del Día):
//  · "¿Qué paga?": pedidos con estado; tilde directa (sin casilla emergente),
//    monto editable inline que se confirma con Enter/blur. Pedido facturado
//    tildable: selecciona todos sus comprobantes (expandible para afinar).
//    Devoluciones pendientes descontables (parcial permitido).
//  · "¿Cómo paga?": filas compactas método|nº|monto|banco con semáforo BCRA
//    en cheques; detalle colapsado, total al pie.
//  · 10% contado: por pedido sin facturar (cobra el 90%) y general sobre
//    comprobantes (marca [10% CONTADO] → NC real al confirmar desde ERP;
//    acá solo se proyecta para que el 10% no quede "bailando").
//  · Diferencia al registrar: modal "ajuste por redondeo" / "dejar saldo",
//    igual que /caja. El sobrante va a cuenta solo.
//  · Header: saldo PROYECTADO primero (lo que va a deber cuando el ERP
//    confirme lo cobrado) y el real chiquito.

interface Comprobante {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  fecha: string
  total_factura: number
  saldo_pendiente: number
  pedido_id: string | null
}

interface PedidoCobro {
  id: string
  numero_pedido: string | null
  fecha: string
  estado: string
  total: number
  pago_contado_10: boolean
  anticipo_pago_id: string | null
  facturado: boolean
  cobrable: boolean
}

interface DevolucionPendiente {
  id: string
  numero_devolucion: string | null
  pedido_id: string | null
  monto_total: number
  restante: number
}

interface Cliente {
  id: string
  nombre: string
  saldo_actual: number
  saldo_proyectado?: number
}

interface Metodo {
  tipo: "cheque" | "transferencia"
  monto: number
  banco: string
  numero_cheque: string
  fecha_cheque: string
  cuit_emisor: string
  es_echeq: boolean
  referencia_transferencia: string
  cuenta_bancaria_id: string
}

interface CuentaBancaria {
  id: string
  banco: string
  nombre: string | null
  alias: string | null
}

const ESTADO_PEDIDO: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "PENDIENTE", cls: "bg-yellow-100 text-yellow-700" },
  impreso: { label: "IMPRESO", cls: "bg-blue-100 text-blue-700" },
  en_preparacion: { label: "EN PREPARACIÓN", cls: "bg-blue-100 text-blue-700" },
  en_viaje: { label: "EN VIAJE", cls: "bg-indigo-100 text-indigo-700" },
  entregado: { label: "ENTREGADO", cls: "bg-green-100 text-green-700" },
  confirmado: { label: "CONFIRMADO", cls: "bg-blue-100 text-blue-700" },
}

const nuevoMetodo = (tipo: Metodo["tipo"]): Metodo => ({
  tipo,
  monto: 0,
  banco: "",
  numero_cheque: "",
  fecha_cheque: "",
  cuit_emisor: "",
  es_echeq: false,
  referencia_transferencia: "",
  cuenta_bancaria_id: "",
})

const round2 = (n: number) => Math.round(n * 100) / 100

// Input de monto que NO hace bailar el resumen: confirma con Enter o al salir
function MontoInput({
  valor,
  onCommit,
  className,
  placeholder,
}: {
  valor: number
  onCommit: (v: number) => void
  className?: string
  placeholder?: string
}) {
  const [texto, setTexto] = useState(valor ? String(valor) : "")
  useEffect(() => {
    setTexto(valor ? String(valor) : "")
  }, [valor])
  const commit = () => onCommit(Math.max(0, parseFloat(texto.replace(",", ".")) || 0))
  return (
    <input
      type="text"
      inputMode="decimal"
      value={texto}
      placeholder={placeholder || "0"}
      onChange={(e) => setTexto(e.target.value.replace(/[^\d.,]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit()
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className={className || "w-28 rounded-lg border border-gray-300 px-2 py-2 text-right font-bold bg-white"}
    />
  )
}

// Semáforo BCRA compacto para la fila del cheque
function BcraTick({ cuit }: { cuit: string }) {
  const { resultado, consultando } = useBcraDeudor(cuit)
  if (consultando)
    return <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin shrink-0" />
  if (!resultado) return null
  if (resultado.apto) return <span className="text-green-600 text-lg leading-none shrink-0">✓</span>
  if (resultado.error) return <span className="text-amber-500 text-sm shrink-0">⚠️</span>
  return <span className="text-red-600 text-sm shrink-0">⛔</span>
}

function BcraAlerta({ cuit, banco }: { cuit: string; banco: string }) {
  const { resultado } = useBcraDeudor(cuit)
  if (!resultado || resultado.apto || resultado.error) return null
  return (
    <div className="bg-red-50 border-2 border-red-400 rounded-xl px-3 py-2 text-sm">
      <p className="font-bold text-red-700">
        ⛔ Cheque con riesgo: situación {resultado.situacion_max} en BCRA
        {resultado.denominacion ? ` · ${resultado.denominacion}` : ""}
      </p>
      <p className="text-red-500 text-xs">Evaluá si aceptás este cheque{banco ? ` de ${banco}` : ""}.</p>
    </div>
  )
}

export default function VendedorCobrarPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()

  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [comprobantes, setComprobantes] = useState<Comprobante[]>([])
  const [pedidos, setPedidos] = useState<PedidoCobro[]>([])
  const [devoluciones, setDevoluciones] = useState<DevolucionPendiente[]>([])
  // Plata A FAVOR del cliente (créditos NC/REV + entregas a cuenta): el
  // vendedor la tiene que ver ANTES de cobrar — se descuenta de la deuda.
  const [creditos, setCreditos] = useState<{ id: string; tipo_comprobante: string; numero_comprobante: string; saldo_pendiente: number }[]>([])
  const [aCuenta, setACuenta] = useState<{ pago_id: string; fecha: string; disponible: number }[]>([])
  const [totalAFavor, setTotalAFavor] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Qué paga ──
  const [abierto, setAbierto] = useState<string | null>(null)
  const [imputaciones, setImputaciones] = useState<Record<string, number>>({})
  const [pedidosSel, setPedidosSel] = useState<Record<string, number>>({})
  const [contadoSel, setContadoSel] = useState<Record<string, boolean>>({})
  const [contadoGeneral, setContadoGeneral] = useState(false)
  const [devSel, setDevSel] = useState<Record<string, number>>({})

  // ── Cómo paga ──
  const [efectivo, setEfectivo] = useState(0)
  const [metodos, setMetodos] = useState<Metodo[]>([])
  const [metodoAbierto, setMetodoAbierto] = useState<number | null>(null)
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([])
  const [fotos, setFotos] = useState<string[]>([])
  const [subiendoFotos, setSubiendoFotos] = useState(false)
  const [obs, setObs] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [dialogoFalta, setDialogoFalta] = useState<number | null>(null)
  const idemKey = useRef<string>(crypto.randomUUID())

  useEffect(() => {
    fetch(`/api/vendedor/cliente/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else {
          setCliente(d.cliente)
          setComprobantes(d.comprobantes || [])
          setPedidos(d.pedidos_cobro || [])
          setDevoluciones((d.devoluciones_pendientes || []).filter((x: any) => x.restante > 0))
          setCreditos(d.creditos || [])
          setACuenta(d.a_cuenta || [])
          setTotalAFavor(Number(d.total_a_favor || 0))
        }
      })
      .catch(() => setError("Error al cargar el cliente"))
      .finally(() => setLoading(false))
    fetch("/api/vendedor/cuentas-bancarias")
      .then((r) => r.json())
      .then((d) => setCuentas(d.cuentas || []))
      .catch(() => {})
  }, [id])

  const compsPorPedido = useMemo(() => {
    const m = new Map<string, Comprobante[]>()
    for (const cp of comprobantes) {
      if (!cp.pedido_id) continue
      if (!m.has(cp.pedido_id)) m.set(cp.pedido_id, [])
      m.get(cp.pedido_id)!.push(cp)
    }
    return m
  }, [comprobantes])

  const compsSueltos = useMemo(
    () => comprobantes.filter((cp) => !cp.pedido_id || !pedidos.some((p) => p.id === cp.pedido_id)),
    [comprobantes, pedidos]
  )

  const pedidosVisibles = useMemo(
    () => pedidos.filter((p) => compsPorPedido.has(p.id) || p.cobrable || p.anticipo_pago_id),
    [pedidos, compsPorPedido]
  )

  // ── Totales (patrón /caja: métodos + NC 10% proyectada = cubierto) ──
  const totalImputado = Object.values(imputaciones).reduce((s, m) => s + (m || 0), 0)
  const totalPedidos = Object.values(pedidosSel).reduce((s, m) => s + (m || 0), 0)
  const totalDevoluciones = Object.values(devSel).reduce((s, m) => s + (m || 0), 0)
  const totalAsignado = round2(totalImputado + totalPedidos)
  const totalMetodos = round2(efectivo + metodos.reduce((s, m) => s + (m.monto || 0), 0))

  // NC 10% proyectada ("proyección reversa"): 10% de los comprobantes
  // seleccionados COMPLETOS cuando el check general está activo
  const bonificacionEstimada = useMemo(() => {
    if (!contadoGeneral) return 0
    let bonif = 0
    for (const cp of comprobantes) {
      const imp = imputaciones[cp.id]
      if (imp !== undefined && Math.abs(imp - cp.saldo_pendiente) < 0.01) bonif += cp.total_factura * 0.1
    }
    return round2(bonif)
  }, [contadoGeneral, imputaciones, comprobantes])

  const cubierto = round2(totalMetodos + totalDevoluciones + bonificacionEstimada)
  const falta = round2(totalAsignado - cubierto)
  const sobrante = round2(cubierto - totalAsignado)

  // ── Selección ──
  const toggleComprobante = (cp: Comprobante) => {
    setImputaciones((prev) => {
      const next = { ...prev }
      if (next[cp.id] !== undefined) delete next[cp.id]
      else next[cp.id] = cp.saldo_pendiente
      return next
    })
  }

  const montoAnticipo = (p: PedidoCobro, contado: boolean) => round2(contado ? p.total * 0.9 : p.total)

  const togglePedido = (p: PedidoCobro) => {
    const comps = compsPorPedido.get(p.id) || []
    if (comps.length) {
      // Facturado: tildar el pedido selecciona TODOS sus comprobantes
      const activo = comps.every((cp) => imputaciones[cp.id] !== undefined)
      setImputaciones((prev) => {
        const next = { ...prev }
        for (const cp of comps) {
          if (activo) delete next[cp.id]
          else next[cp.id] = cp.saldo_pendiente
        }
        return next
      })
    } else if (p.cobrable) {
      setPedidosSel((prev) => {
        const next = { ...prev }
        if (next[p.id] !== undefined) delete next[p.id]
        else next[p.id] = montoAnticipo(p, !!contadoSel[p.id])
        return next
      })
    }
  }

  const toggleContadoPedido = (p: PedidoCobro) => {
    setContadoSel((prev) => {
      const contado = !prev[p.id]
      setPedidosSel((sel) => (sel[p.id] !== undefined ? { ...sel, [p.id]: montoAnticipo(p, contado) } : sel))
      return { ...prev, [p.id]: contado }
    })
  }

  const toggleDevolucion = (d: DevolucionPendiente) => {
    setDevSel((prev) => {
      const next = { ...prev }
      if (next[d.id] !== undefined) delete next[d.id]
      else next[d.id] = d.restante
      return next
    })
  }

  const updateMetodo = (idx: number, patch: Partial<Metodo>) =>
    setMetodos((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)))

  // ── Fotos → OCR → filas precargadas ──
  const subirFotos = async (files: FileList | null) => {
    if (!files?.length) return
    setSubiendoFotos(true)
    try {
      const fd = new FormData()
      for (const f of Array.from(files)) fd.append("files", f)
      const res = await fetch("/api/pagos-clientes/ocr", { method: "POST", body: fd })
      const d = await res.json()
      if (d.error) {
        alert(d.error)
        return
      }
      setFotos((prev) => [...prev, ...(d.archivos || []).map((a: any) => a.url).filter(Boolean)])
      const nuevos: Metodo[] = []
      for (const r of d.resultados || []) {
        if (r.tipo === "cheque") {
          nuevos.push({
            ...nuevoMetodo("cheque"),
            monto: Number(r.monto) || 0,
            banco: r.banco_emisor || "",
            numero_cheque: r.numero_cheque || "",
            fecha_cheque: r.fecha_cheque || "",
            cuit_emisor: r.cuit_emisor || "",
            es_echeq: r.color_cheque === "ECHEQ",
          })
        } else if (r.tipo === "transferencia") {
          nuevos.push({
            ...nuevoMetodo("transferencia"),
            monto: Number(r.monto) || 0,
            referencia_transferencia: r.numero_comprobante || "",
            cuenta_bancaria_id: r.cuenta_bancaria_id || "",
          })
        }
      }
      if (nuevos.length) setMetodos((prev) => [...prev, ...nuevos])
      else if (!(d.resultados || []).length)
        alert("La foto quedó adjunta pero no se detectaron datos. Cargá el cheque/transferencia a mano.")
    } catch {
      alert("Error al subir las fotos")
    } finally {
      setSubiendoFotos(false)
    }
  }

  // ── Registrar (patrón /caja para la diferencia) ──
  const registrar = async (modoDiferencia?: "ajuste" | "saldo") => {
    if (!cliente || enviando) return
    if (totalMetodos + totalDevoluciones <= 0) {
      alert("Ingresá efectivo, cheques/transferencias o descontá una devolución.")
      return
    }
    for (const m of metodos) {
      if (m.monto <= 0) return alert("Todos los cheques/transferencias deben tener monto.")
      if (m.tipo === "cheque" && (!m.banco || !m.numero_cheque || !m.fecha_cheque))
        return alert("Los cheques requieren banco, número y fecha.")
      if (m.tipo === "transferencia" && !m.cuenta_bancaria_id)
        return alert("Las transferencias requieren la cuenta destino.")
    }

    let impFinal: Record<string, number> = { ...imputaciones }
    let ajustePorRedondeo = 0

    if (falta > 0.01) {
      if (falta > totalImputado + 0.01) {
        alert(`Faltan ${formatCurrency(falta)} y superan lo imputado a comprobantes — sumá plata o sacá selección.`)
        return
      }
      if (!modoDiferencia) {
        setDialogoFalta(falta)
        return
      }
      if (modoDiferencia === "ajuste") {
        ajustePorRedondeo = falta // imputaciones completas; el crédito lo asienta /ajustes
      } else {
        // Dejar saldo pendiente: recortar desde la última imputación
        let resta = falta
        const ids = Object.keys(impFinal)
        for (let i = ids.length - 1; i >= 0 && resta > 0.001; i--) {
          const quitar = Math.min(impFinal[ids[i]], resta)
          impFinal[ids[i]] = round2(impFinal[ids[i]] - quitar)
          resta = round2(resta - quitar)
          if (impFinal[ids[i]] <= 0.001) delete impFinal[ids[i]]
        }
      }
    }
    setDialogoFalta(null)

    setEnviando(true)
    try {
      const marcaContado = contadoGeneral && bonificacionEstimada > 0 ? ` ${MARCA_CONTADO}` : ""
      const metodosPayload = [
        ...(efectivo > 0 ? [{ tipo: "efectivo", monto: efectivo }] : []),
        ...metodos.map((m) => ({
          tipo: m.tipo,
          monto: m.monto,
          banco: m.tipo === "cheque" ? m.banco : null,
          numero_cheque: m.tipo === "cheque" ? m.numero_cheque : null,
          fecha_cheque: m.tipo === "cheque" ? m.fecha_cheque : null,
          cuit_emisor: m.tipo === "cheque" ? m.cuit_emisor || null : null,
          es_echeq: m.tipo === "cheque" ? m.es_echeq : false,
          referencia_transferencia: m.tipo === "transferencia" ? m.referencia_transferencia || null : null,
          cuenta_bancaria_id: m.tipo === "transferencia" ? m.cuenta_bancaria_id : null,
        })),
      ]

      const impPayload = Object.entries(impFinal)
        .filter(([, monto]) => monto > 0)
        .map(([comprobante_id, monto]) => ({ comprobante_id, monto }))

      // pago_a_cuenta = sobrante de lo cubierto (métodos + devoluciones + NC
      // proyectada + ajuste) sobre lo asignado final
      const asignadoFinal = round2(impPayload.reduce((s, i) => s + i.monto, 0) + totalPedidos)

      const body = {
        idempotency_key: idemKey.current,
        clientes: [
          {
            cliente_id: cliente.id,
            imputaciones: impPayload,
            pedidos: Object.entries(pedidosSel)
              .filter(([, monto]) => monto > 0)
              .map(([pedido_id, monto]) => ({ pedido_id, monto, contado: !!contadoSel[pedido_id] })),
            pago_a_cuenta: Math.max(0, round2(totalMetodos + totalDevoluciones + bonificacionEstimada + ajustePorRedondeo - asignadoFinal)),
            bonificacion_proyectada: contadoGeneral ? bonificacionEstimada : 0,
            ajuste_redondeo: ajustePorRedondeo,
            devoluciones: Object.entries(devSel)
              .filter(([, monto]) => monto > 0)
              .map(([devolucion_id, monto]) => ({ devolucion_id, monto })),
          },
        ],
        metodos: metodosPayload,
        comprobante_urls: fotos,
        observaciones: `${obs || ""}${marcaContado}`.trim() || null,
      }

      const res = await fetch("/api/viajante/cobro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok || d.error) {
        alert(d.error || "Error al registrar el cobro.")
        return
      }

      // Ajuste por redondeo: crédito en cuenta corriente atado al pago
      if (ajustePorRedondeo > 0.01) {
        const pagoId = d.pagos?.[0]?.pago_id || d.pagos_creados?.[0]?.pago_id
        try {
          await fetch(`/api/clientes/${cliente.id}/ajustes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              monto: -ajustePorRedondeo,
              motivo: `Ajuste por redondeo — cobro ${formatCurrency(cubierto)} vs imputado ${formatCurrency(totalAsignado)}`,
              aplicar_saldo: true,
              pago_id: pagoId || null,
            }),
          })
        } catch {
          alert("El cobro se registró pero el ajuste por redondeo falló — avisá a la oficina.")
        }
      }

      idemKey.current = crypto.randomUUID()
      alert(`✅ Cobro registrado por ${formatCurrency(totalMetodos)}. Queda pendiente de rendición.`)
      router.push(`/vendedor/clientes/${cliente.id}`)
    } catch {
      alert("Error de conexión al registrar el cobro.")
    } finally {
      setEnviando(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !cliente) {
    return (
      <div className="flex items-center justify-center min-h-screen p-8 text-center">
        <p className="text-red-500 text-xl">{error || "Cliente no encontrado"}</p>
      </div>
    )
  }

  const proyectado = cliente.saldo_proyectado ?? cliente.saldo_actual
  const proyectadoCero = Math.abs(proyectado) < 0.01

  // Función de render (no componente): definida adentro del componente de
  // página, un sub-componente se remontaría en cada tecla y el MontoInput
  // perdería el foco.
  const filaComprobante = (cp: Comprobante) => {
    const activo = imputaciones[cp.id] !== undefined
    return (
      <div
        key={cp.id}
        className={`rounded-xl border-2 px-3 py-2 flex items-center gap-2 ${
          activo ? "border-emerald-500 bg-emerald-50/40" : "border-gray-200 bg-white"
        }`}
      >
        <button onClick={() => toggleComprobante(cp)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          <span className="text-lg shrink-0">{activo ? "☑" : "☐"}</span>
          <div className="min-w-0">
            <p className="font-bold text-gray-900 text-sm">
              {cp.tipo_comprobante} {cp.numero_comprobante}
            </p>
            <p className="text-gray-400 text-xs">saldo {formatCurrency(cp.saldo_pendiente)}</p>
          </div>
        </button>
        {activo && (
          <MontoInput
            valor={imputaciones[cp.id]}
            onCommit={(v) =>
              setImputaciones((prev) => ({ ...prev, [cp.id]: Math.min(Math.max(0, v), cp.saldo_pendiente) }))
            }
          />
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-44">
      <header className="bg-emerald-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <button onClick={() => router.back()} className="text-2xl leading-none px-1">←</button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold">💵 Cobrar</h1>
          <p className="text-emerald-200 text-sm truncate">{cliente.nombre}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-emerald-200 text-[10px]">Saldo proyectado</p>
          <p className={`font-bold ${proyectadoCero ? "text-green-300" : ""}`}>
            {proyectadoCero ? "$ 0,00" : formatCurrency(proyectado)}
          </p>
          {Math.abs(cliente.saldo_actual - proyectado) > 0.01 && (
            <p className="text-emerald-300/80 text-[10px]">real {formatCurrency(cliente.saldo_actual)}</p>
          )}
        </div>
      </header>

      <div className="p-4 space-y-6 max-w-2xl mx-auto">
        {/* ══ 1. Qué paga ══ */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-2">¿Qué está pagando?</h2>

          {pedidosVisibles.length === 0 && compsSueltos.length === 0 && devoluciones.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-gray-500">
              Sin pedidos ni comprobantes pendientes. Lo que cobres queda como pago a cuenta.
            </div>
          ) : (
            <div className="space-y-2">
              {pedidosVisibles.map((p) => {
                const comps = compsPorPedido.get(p.id) || []
                const estado = p.facturado
                  ? { label: "FACTURADO", cls: "bg-green-100 text-green-700" }
                  : ESTADO_PEDIDO[p.estado] || { label: p.estado.toUpperCase(), cls: "bg-gray-100 text-gray-600" }
                const selPedido = pedidosSel[p.id] !== undefined
                const selComps = comps.length > 0 && comps.every((cp) => imputaciones[cp.id] !== undefined)
                const parcialComps = comps.some((cp) => imputaciones[cp.id] !== undefined)
                const expandido = abierto === p.id
                const seleccionado = selPedido || selComps

                return (
                  <div
                    key={p.id}
                    className={`bg-white rounded-2xl border-2 overflow-hidden ${
                      seleccionado || parcialComps ? "border-emerald-500" : "border-gray-200"
                    }`}
                  >
                    <div className="w-full p-3 flex items-center gap-2">
                      <button
                        onClick={() => togglePedido(p)}
                        disabled={!p.cobrable && !comps.length}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left"
                      >
                        <span className="text-lg shrink-0">
                          {seleccionado ? "☑" : parcialComps ? "◪" : p.cobrable || comps.length ? "☐" : "•"}
                        </span>
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900 truncate">
                            Pedido {p.numero_pedido ? `#${p.numero_pedido}` : ""}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${estado.cls}`}>
                              {estado.label}
                            </span>
                            {p.pago_contado_10 && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                                ✓ 10% CONTADO
                              </span>
                            )}
                            {p.anticipo_pago_id && !p.facturado && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">
                                ANTICIPADO
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                      <div className="text-right shrink-0 flex items-center gap-2">
                        {selPedido ? (
                          <MontoInput
                            valor={pedidosSel[p.id]}
                            onCommit={(v) =>
                              setPedidosSel((prev) => ({ ...prev, [p.id]: Math.min(Math.max(0, v), p.total) }))
                            }
                          />
                        ) : (
                          <p className="font-bold text-gray-900">{formatCurrency(p.total)}</p>
                        )}
                        {comps.length > 0 && (
                          <button
                            onClick={() => setAbierto(expandido ? null : p.id)}
                            className="text-gray-400 text-lg px-1"
                            title="Ver comprobantes"
                          >
                            {expandido ? "▾" : "▸"}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 10% contado del pedido sin facturar */}
                    {selPedido && p.cobrable && (
                      <div className="px-3 pb-2.5 -mt-1">
                        <label className="flex items-center gap-2 text-sm text-gray-600">
                          <input type="checkbox" checked={!!contadoSel[p.id]} onChange={() => toggleContadoPedido(p)} className="w-5 h-5" />
                          10% contado (cobra el 90%, la NC sale al facturar)
                        </label>
                      </div>
                    )}

                    {/* Comprobantes del pedido (afinar) */}
                    {comps.length > 0 && expandido && (
                      <div className="px-3 pb-3 space-y-1.5 border-t border-gray-100 pt-2 bg-gray-50/60">
                        {comps.map((cp) => (
                          filaComprobante(cp)
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {compsSueltos.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400 px-1">Otros comprobantes</p>
                  {compsSueltos.map((cp) => (
                    filaComprobante(cp)
                  ))}
                </div>
              )}

              {/* Plata a favor del cliente: NO se cobra — se descuenta de la deuda.
                  La aplica la oficina; acá es información para no cobrar de más. */}
              {totalAFavor > 0.005 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-600 px-1">
                    💚 Plata a favor del cliente — descontala de lo que cobres
                  </p>
                  {creditos.map((c) => (
                    <div key={c.id} className="rounded-xl border-2 border-emerald-200 bg-emerald-50 px-3 py-2 flex items-center justify-between">
                      <div>
                        <p className="font-bold text-emerald-800 text-sm">
                          {c.tipo_comprobante === "REV" ? "Reversa" : "Nota de crédito"} {c.numero_comprobante}
                        </p>
                        <p className="text-emerald-600 text-xs">crédito disponible</p>
                      </div>
                      <span className="font-bold text-emerald-700">{formatCurrency(Math.abs(c.saldo_pendiente))}</span>
                    </div>
                  ))}
                  {aCuenta.map((p) => (
                    <div key={p.pago_id} className="rounded-xl border-2 border-emerald-200 bg-emerald-50 px-3 py-2 flex items-center justify-between">
                      <div>
                        <p className="font-bold text-emerald-800 text-sm">Entrega a cuenta</p>
                        <p className="text-emerald-600 text-xs">{p.fecha?.split("-").reverse().join("/")}</p>
                      </div>
                      <span className="font-bold text-emerald-700">{formatCurrency(p.disponible)}</span>
                    </div>
                  ))}
                  <p className="text-emerald-700 text-xs px-1">
                    Total a favor {formatCurrency(totalAFavor)} · la oficina lo imputa a los comprobantes — vos cobrá la diferencia.
                    El 10% contado no aplica sobre esta plata.
                  </p>
                </div>
              )}

              {/* Devoluciones descontables */}
              {devoluciones.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-600 px-1">
                    🔄 Devoluciones a descontar
                  </p>
                  {devoluciones.map((d) => {
                    const activo = devSel[d.id] !== undefined
                    return (
                      <div
                        key={d.id}
                        className={`rounded-xl border-2 px-3 py-2 flex items-center gap-2 ${
                          activo ? "border-amber-400 bg-amber-50" : "border-gray-200 bg-white"
                        }`}
                      >
                        <button onClick={() => toggleDevolucion(d)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                          <span className="text-lg shrink-0">{activo ? "☑" : "☐"}</span>
                          <div className="min-w-0">
                            <p className="font-bold text-gray-900 text-sm">Devolución {d.numero_devolucion || ""}</p>
                            <p className="text-gray-400 text-xs">
                              disponible {formatCurrency(d.restante)}
                              {d.restante < d.monto_total ? ` de ${formatCurrency(d.monto_total)}` : ""}
                            </p>
                          </div>
                        </button>
                        {activo && (
                          <MontoInput
                            valor={devSel[d.id]}
                            onCommit={(v) => setDevSel((prev) => ({ ...prev, [d.id]: Math.min(Math.max(0, v), d.restante) }))}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* 10% contado general (comprobantes) */}
              {totalImputado > 0 && (
                <label className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 p-3 text-sm text-gray-700">
                  <input type="checkbox" checked={contadoGeneral} onChange={(e) => setContadoGeneral(e.target.checked)} className="w-5 h-5" />
                  <span>
                    <span className="font-bold">10% descuento pago contado</span>
                    {bonificacionEstimada > 0 && (
                      <span className="text-emerald-700"> — NC proyectada {formatCurrency(bonificacionEstimada)}</span>
                    )}
                    <span className="block text-xs text-gray-400">
                      La NC/REV real la emite la oficina al confirmar el pago. Aplica a comprobantes seleccionados completos.
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}
        </section>

        {/* ══ 2. Cómo paga (compacto) ══ */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-2">¿Cómo paga?</h2>
          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
            {/* Efectivo */}
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className="w-24 shrink-0 font-bold text-gray-700 text-sm">💵 Efectivo</span>
              <span className="flex-1" />
              <MontoInput valor={efectivo} onCommit={setEfectivo} />
            </div>

            {/* Cheques / transferencias */}
            {metodos.map((m, idx) => (
              <div key={idx}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => setMetodoAbierto(metodoAbierto === idx ? null : idx)} className="w-24 shrink-0 text-left font-bold text-gray-700 text-sm">
                    {m.tipo === "cheque" ? (m.es_echeq ? "⚡ E-cheq" : "📄 Cheque") : "🏦 Transf."}
                  </button>
                  <span className="flex-1 min-w-0 text-xs text-gray-500 truncate">
                    {m.tipo === "cheque" ? m.numero_cheque || "s/nº" : m.referencia_transferencia || "s/nº"}
                    {m.tipo === "cheque" && m.banco ? ` · ${m.banco}` : ""}
                    {m.tipo === "transferencia" ? ` · ${cuentas.find((c) => c.id === m.cuenta_bancaria_id)?.banco || "sin cuenta"}` : ""}
                  </span>
                  {m.tipo === "cheque" && m.cuit_emisor && <BcraTick cuit={m.cuit_emisor} />}
                  <MontoInput valor={m.monto} onCommit={(v) => updateMetodo(idx, { monto: v })} />
                  <button onClick={() => setMetodos((prev) => prev.filter((_, i) => i !== idx))} className="text-red-400 text-lg px-0.5">
                    ✕
                  </button>
                </div>
                {m.tipo === "cheque" && m.cuit_emisor && (
                  <div className="px-3 pb-2">
                    <BcraAlerta cuit={m.cuit_emisor} banco={m.banco} />
                  </div>
                )}
                {metodoAbierto === idx && (
                  <div className="px-3 pb-3 grid grid-cols-2 gap-2 bg-gray-50/60 pt-2">
                    {m.tipo === "cheque" ? (
                      <>
                        <input value={m.banco} onChange={(e) => updateMetodo(idx, { banco: e.target.value })} placeholder="Banco *" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                        <input value={m.numero_cheque} onChange={(e) => updateMetodo(idx, { numero_cheque: e.target.value })} placeholder="N° cheque *" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                        <input type="date" value={m.fecha_cheque} onChange={(e) => updateMetodo(idx, { fecha_cheque: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                        <input value={m.cuit_emisor} onChange={(e) => updateMetodo(idx, { cuit_emisor: e.target.value })} placeholder="CUIT emisor" inputMode="numeric" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                        <label className="flex items-center gap-2 text-sm text-gray-600 col-span-2">
                          <input type="checkbox" checked={m.es_echeq} onChange={(e) => updateMetodo(idx, { es_echeq: e.target.checked })} className="w-5 h-5" />
                          Es e-cheq
                        </label>
                      </>
                    ) : (
                      <>
                        <select value={m.cuenta_bancaria_id} onChange={(e) => updateMetodo(idx, { cuenta_bancaria_id: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 bg-white text-sm col-span-2">
                          <option value="">Cuenta destino *</option>
                          {cuentas.map((cb) => (
                            <option key={cb.id} value={cb.id}>
                              {cb.banco}
                              {cb.alias ? ` (${cb.alias})` : ""}
                            </option>
                          ))}
                        </select>
                        <input value={m.referencia_transferencia} onChange={(e) => updateMetodo(idx, { referencia_transferencia: e.target.value })} placeholder="N° operación" className="rounded-lg border border-gray-300 px-3 py-2 text-sm col-span-2" />
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Total métodos */}
            <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-b-2xl">
              <span className="text-gray-500 text-sm font-medium">Total entregado</span>
              <span className="font-bold text-gray-900">{formatCurrency(totalMetodos)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2">
            <label className="bg-emerald-600 text-white rounded-xl py-3 font-bold text-center text-sm active:scale-[0.97] transition-transform cursor-pointer">
              📷 Foto cheque/transf.
              <input type="file" accept="image/*" multiple capture="environment" className="hidden" disabled={subiendoFotos}
                onChange={(e) => { subirFotos(e.target.files); e.target.value = "" }} />
            </label>
            <label className="bg-white border-2 border-emerald-600 text-emerald-700 rounded-xl py-3 font-bold text-center text-sm active:scale-[0.97] transition-transform cursor-pointer">
              🖼 Galería
              <input type="file" accept="image/*" multiple className="hidden" disabled={subiendoFotos}
                onChange={(e) => { subirFotos(e.target.files); e.target.value = "" }} />
            </label>
          </div>
          <div className="flex gap-4 px-1 mt-2">
            <button onClick={() => { setMetodos((p) => [...p, nuevoMetodo("cheque")]); setMetodoAbierto(metodos.length) }} className="text-emerald-700 text-sm font-bold">
              + Cheque a mano
            </button>
            <button onClick={() => { setMetodos((p) => [...p, nuevoMetodo("transferencia")]); setMetodoAbierto(metodos.length) }} className="text-emerald-700 text-sm font-bold">
              + Transferencia a mano
            </button>
          </div>
          {subiendoFotos && (
            <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium px-1 mt-2">
              <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
              Leyendo la foto...
            </div>
          )}
          {fotos.length > 0 && <p className="text-gray-500 text-xs px-1 mt-1">✓ {fotos.length} foto(s) adjuntas.</p>}
        </section>

        {/* Observaciones */}
        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="text-gray-500 text-sm block mb-1">Observaciones</label>
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="Opcional..." />
        </section>
      </div>

      {/* ══ Resumen fijo ══ */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4">
        <div className="max-w-2xl mx-auto space-y-2">
          <div className="flex justify-between text-sm text-gray-500">
            <span>
              Seleccionado {formatCurrency(totalAsignado)}
              {bonificacionEstimada > 0 ? ` − NC ${formatCurrency(bonificacionEstimada)}` : ""}
              {totalDevoluciones > 0 ? ` − dev. ${formatCurrency(totalDevoluciones)}` : ""}
              {totalAFavor > 0.005 ? ` · tiene ${formatCurrency(totalAFavor)} a favor` : ""}
            </span>
            <span>Entregado {formatCurrency(totalMetodos)}</span>
          </div>
          {Math.abs(falta) < 0.01 && totalAsignado > 0 && (
            <p className="text-green-700 text-sm font-bold text-center bg-green-50 rounded-lg py-1.5">✓ Cuadra</p>
          )}
          {sobrante > 0.01 && (
            <p className="text-emerald-700 text-sm font-bold text-center bg-emerald-50 rounded-lg py-1.5">
              Sobran {formatCurrency(sobrante)} → quedan a cuenta
            </p>
          )}
          {falta > 0.01 && (
            <p className="text-amber-700 text-sm font-bold text-center bg-amber-50 rounded-lg py-1.5">
              Resta saldar {formatCurrency(falta)} — al registrar elegís ajuste o saldo pendiente
            </p>
          )}
          <button
            onClick={() => registrar()}
            disabled={enviando || totalMetodos + totalDevoluciones <= 0}
            className="w-full bg-emerald-600 disabled:bg-gray-300 text-white rounded-xl py-4 text-lg font-bold"
          >
            {enviando ? "Registrando..." : `Registrar cobro ${formatCurrency(totalMetodos)}`}
          </button>
        </div>
      </div>

      {/* ══ Modal diferencia (patrón /caja) ══ */}
      {dialogoFalta !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-3 shadow-xl">
            <h3 className="text-lg font-bold text-center text-gray-900">Falta pagar {formatCurrency(dialogoFalta)}</h3>
            <p className="text-gray-500 text-sm text-center">
              Lo entregado no llega a cubrir lo seleccionado. ¿Qué hacemos con la diferencia?
            </p>
            <button onClick={() => registrar("ajuste")} className="w-full bg-emerald-600 text-white rounded-xl py-3 font-bold">
              Pasar como ajuste por redondeo
              <span className="block text-[11px] font-medium text-emerald-100">
                El comprobante queda saldado; {formatCurrency(dialogoFalta)} se acreditan como ajuste
              </span>
            </button>
            <button onClick={() => registrar("saldo")} className="w-full bg-white border-2 border-gray-300 text-gray-700 rounded-xl py-3 font-bold">
              Dejar saldo pendiente
              <span className="block text-[11px] font-medium text-gray-400">
                El comprobante queda parcial, con {formatCurrency(dialogoFalta)} por cobrar
              </span>
            </button>
            <button onClick={() => setDialogoFalta(null)} className="w-full text-gray-500 py-2 text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
