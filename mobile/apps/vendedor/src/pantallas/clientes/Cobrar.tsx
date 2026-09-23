import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router"
import { ErrorHttp, useNoEnviados, useOnline, useOverlay, useParamEstado, useRuntime } from "@gm/core"
import { DS, type ComprobanteCC, type DevolucionPendiente, type PedidoCobro } from "../../datasets"
import { rechazosDe, useCuenta, useCuentasBancarias, useEncolar } from "../../datos/hooks"
import { MontoInput, Pantalla, Rechazos, dejarAviso, formatCurrency, round2, useToast } from "../../ui"

// Port de app/vendedor/clientes/[id]/cobrar/page.tsx — espejo del patrón de /caja (Caja del Día):
//  · "¿Qué paga?": pedidos con estado; tilde directa, monto editable inline que se confirma
//    con Enter/blur. Pedido facturado tildable: selecciona todos sus comprobantes (expandible
//    para afinar). Devoluciones pendientes descontables (parcial permitido).
//  · "¿Cómo paga?": filas compactas método|nº|monto|banco con semáforo BCRA en cheques.
//  · 10% contado: por pedido sin facturar (cobra el 90%) y general sobre comprobantes (marca
//    [10% CONTADO] → NC real al confirmar desde ERP; acá solo se proyecta).
//  · Diferencia al registrar: diálogo "ajuste por redondeo" / "dejar saldo", igual que /caja.
//    El sobrante va a cuenta solo.
//
// En la app el cobro se ENCOLA (`cobro.registrar`, payload = body de POST /api/viajante/cobro
// sin idempotency_key: el servidor usa la clave de la operación). Leer la foto (OCR) y el
// semáforo del BCRA necesitan conexión; el cobro NO: siempre se puede registrar sin foto.

/** = MARCA_CONTADO de lib/constants.ts */
const MARCA_CONTADO = "[10% CONTADO]"
/** = topeAjuste de lib/cobranzas/ajuste.ts: máximo ajuste admitido (1% de los débitos tildados). */
const topeAjuste = (totalDebitos: number) => round2(Math.max(0, Number(totalDebitos) || 0) * 0.01)

// Saldo realmente cobrable HOY: el del libro menos lo que ya está en un cobro
// registrado sin confirmar — evita cobrar dos veces el mismo comprobante.
const saldoCobrable = (cp: ComprobanteCC) => Math.max(0, Math.round((cp.saldo_pendiente - (cp.en_cobro || 0)) * 100) / 100)

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

const CLS_MONTO = "w-28 min-h-11 rounded-lg border border-gray-300 px-2 py-2 text-right font-bold bg-white"

// ─── BCRA (ONLINE-ONLY): GET /api/bcra/deudor/<cuit> ─────────────────────────

interface BcraResultado {
  situacion_max: number
  denominacion: string | null
  apto: boolean
  sin_antecedentes: boolean
  error?: string
}

const bcraCache = new Map<string, BcraResultado>()

function useBcraDeudor(cuit: string | null | undefined) {
  const { api } = useRuntime()
  const online = useOnline()
  const [resultado, setResultado] = useState<BcraResultado | null>(null)
  const [consultando, setConsultando] = useState(false)

  useEffect(() => {
    const limpio = (cuit || "").replace(/\D/g, "")
    if (limpio.length < 10 || !online) {
      setResultado(limpio.length >= 10 ? bcraCache.get(limpio) ?? null : null)
      return
    }
    const ya = bcraCache.get(limpio)
    if (ya) { setResultado(ya); return }
    let vivo = true
    const timer = setTimeout(async () => {
      setConsultando(true)
      setResultado(null)
      let r: BcraResultado
      try {
        const d = await api.get<BcraResultado>(`/api/bcra/deudor/${limpio}`, { timeoutMs: 15_000 })
        r = d?.error ? { situacion_max: 0, denominacion: null, apto: false, sin_antecedentes: false, error: d.error } : d
        if (!r.error) bcraCache.set(limpio, r)
      } catch (e) {
        r = { situacion_max: 0, denominacion: null, apto: false, sin_antecedentes: false, error: e instanceof ErrorHttp ? e.body?.error || "No se pudo consultar el BCRA" : "Sin conexión con el BCRA" }
      }
      if (vivo) { setResultado(r); setConsultando(false) }
    }, 700)
    return () => { vivo = false; clearTimeout(timer); setConsultando(false) }
  }, [cuit, online, api])

  return { resultado, consultando, online }
}

// Semáforo BCRA compacto para la fila del cheque
function BcraTick({ cuit }: { cuit: string }) {
  const { resultado, consultando } = useBcraDeudor(cuit)
  if (consultando) return <span className="shrink-0 text-xs text-gray-400">BCRA…</span>
  if (!resultado) return null
  if (resultado.apto) return <span className="shrink-0 text-lg leading-none text-green-600">✓</span>
  if (resultado.error) return <span className="shrink-0 text-sm text-amber-500">⚠️</span>
  return <span className="shrink-0 text-sm text-red-600">⛔</span>
}

function BcraAlerta({ cuit, banco }: { cuit: string; banco: string }) {
  const { resultado, online } = useBcraDeudor(cuit)
  if (!resultado && !online && cuit.replace(/\D/g, "").length >= 10)
    return <p className="text-xs text-gray-400">📡 Necesitás conexión para consultar el CUIT en el BCRA. El cheque se puede cargar igual.</p>
  if (!resultado || resultado.apto || resultado.error) return null
  return (
    <div className="rounded-xl border-2 border-red-400 bg-red-50 px-3 py-2 text-sm">
      <p className="font-bold text-red-700">
        ⛔ Cheque con riesgo: situación {resultado.situacion_max} en BCRA
        {resultado.denominacion ? ` · ${resultado.denominacion}` : ""}
      </p>
      <p className="text-xs text-red-500">Evaluá si aceptás este cheque{banco ? ` de ${banco}` : ""}.</p>
    </div>
  )
}

// ─── /clientes/:id/cobrar ────────────────────────────────────────────────────

export function Cobrar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const { api } = useRuntime()
  const online = useOnline()
  const encolar = useEncolar()
  const { cuenta, cargando } = useCuenta(id)
  const cuentas = useCuentasBancarias()
  const ops = useNoEnviados()
  const { toast, mostrar } = useToast()

  // ¿Qué lista se ve? Facturados (lo que existe de verdad) o pedidos en curso
  const [tab, setTab] = useParamEstado("tab", "fact")
  // Pedido con el desglose de comprobantes abierto / método con el detalle abierto (acordeones)
  const [abierto, setAbierto] = useParamEstado("abierto")
  const [metodoParam, setMetodoParam] = useParamEstado("metodo")
  const metodoAbierto = metodoParam === "" ? null : Number(metodoParam)
  const setMetodoAbierto = (i: number | null) => setMetodoParam(i === null ? "" : String(i))
  const dialogoFalta = useOverlay("falta")

  // credSel: clave "nc:<id>" | "ac:<id>" → monto a usar de ese crédito
  const [credSel, setCredSel] = useState<Record<string, number>>({})
  // cred10: crédito de MERCADERÍA sin el 10% hecho → se le aplica el 10% en contra al usarlo en
  // cobro contado. El operador lo destilda si la NC ya tiene el descuento hecho. Nunca a la plata a cuenta.
  const [cred10, setCred10] = useState<Record<string, boolean>>({})

  // ── Qué paga ──
  const [imputaciones, setImputaciones] = useState<Record<string, number>>({})
  const [pedidosSel, setPedidosSel] = useState<Record<string, number>>({})
  const [contadoSel, setContadoSel] = useState<Record<string, boolean>>({})
  const [contadoGeneral, setContadoGeneral] = useState(false)
  const [devSel, setDevSel] = useState<Record<string, number>>({})

  // ── Cómo paga ──
  const [efectivo, setEfectivo] = useState(0)
  const [metodos, setMetodos] = useState<Metodo[]>([])
  const [fotos, setFotos] = useState<string[]>([])
  const [subiendoFotos, setSubiendoFotos] = useState(false)
  const [obs, setObs] = useState("")
  const [enviando, setEnviando] = useState(false)
  const enviandoRef = useRef(false)

  const cliente = cuenta?.cliente ?? null
  const comprobantes = useMemo(() => cuenta?.comprobantes ?? [], [cuenta?.comprobantes])
  const pedidos = useMemo(() => cuenta?.pedidos_cobro ?? [], [cuenta?.pedidos_cobro])
  const devoluciones = useMemo(() => (cuenta?.devoluciones_pendientes ?? []).filter((x) => x.restante > 0), [cuenta?.devoluciones_pendientes])
  // Plata A FAVOR del cliente (créditos NC/REV + entregas a cuenta): líneas TILDABLES — el crédito
  // elegido descuenta del total a saldar y se aplica al confirmarse el cobro.
  const creditos = cuenta?.creditos ?? []
  const aCuenta = cuenta?.a_cuenta ?? []
  const totalAFavor = Number(cuenta?.total_a_favor || 0)

  const compsPorPedido = useMemo(() => {
    const m = new Map<string, ComprobanteCC[]>()
    for (const cp of comprobantes) {
      if (!cp.pedido_id) continue
      if (!m.has(cp.pedido_id)) m.set(cp.pedido_id, [])
      m.get(cp.pedido_id)!.push(cp)
    }
    return m
  }, [comprobantes])

  const compsSueltos = useMemo(() => comprobantes.filter((cp) => !cp.pedido_id || !pedidos.some((p) => p.id === cp.pedido_id)), [comprobantes, pedidos])

  const pedidosVisibles = useMemo(() => pedidos.filter((p) => compsPorPedido.has(p.id) || p.cobrable || p.anticipo_pago_id), [pedidos, compsPorPedido])

  // Pestañas: FACTURADOS = lo que existe de verdad (pedidos con comprobantes emitidos);
  // PENDIENTES = pedidos levantados aún sin facturar (anticipo)
  const pedidosFacturados = useMemo(() => pedidosVisibles.filter((p) => compsPorPedido.has(p.id)), [pedidosVisibles, compsPorPedido])
  const pedidosSinFacturar = useMemo(() => pedidosVisibles.filter((p) => !compsPorPedido.has(p.id)), [pedidosVisibles, compsPorPedido])

  // ── Totales (patrón /caja: métodos + NC 10% proyectada = cubierto) ──
  const totalImputado = Object.values(imputaciones).reduce((s, m) => s + (m || 0), 0)
  const totalPedidos = Object.values(pedidosSel).reduce((s, m) => s + (m || 0), 0)
  const totalDevoluciones = Object.values(devSel).reduce((s, m) => s + (m || 0), 0)
  const totalAsignado = round2(totalImputado + totalPedidos)
  const totalMetodos = round2(efectivo + metodos.reduce((s, m) => s + (m.monto || 0), 0))

  // Créditos tildados (NC/REV + a cuenta): descuentan del total a saldar
  const totalCreditos = round2(Object.values(credSel).reduce((s, v) => s + (v || 0), 0))

  // NC 10% proyectada — regla 25/08: bonif neta = 10% × (débitos sin dto − créditos de MERCADERÍA
  // sin dto). Los débitos completos bonifican SIEMPRE; cada crédito NC con su check de 10% activo
  // resta el 10% de lo usado (crédito a precio lleno usado en cobro contado → vale 90%).
  const bonificacionEstimada = useMemo(() => {
    if (!contadoGeneral) return 0
    let bonif = 0
    for (const cp of comprobantes) {
      const imp = imputaciones[cp.id]
      if (imp === undefined) continue
      const cobrable = saldoCobrable(cp)
      // Completo con plata de HOY…
      const completoHoy = Math.abs(imp - cp.saldo_pendiente) < 0.01
      // …o completo CONTANDO lo ya en cobro sin confirmar, siempre que esas entregas también hayan
      // sido contado ([10% CONTADO]): hoy se cobra todo el cobrable y entre ambas partes queda saldado.
      const completoConEnCobro =
        Math.abs(imp - cobrable) < 0.01 &&
        (cp.en_cobro || 0) > 0.005 &&
        cobrable + (cp.en_cobro_contado || 0) >= cp.saldo_pendiente - 0.01
      if (completoHoy || completoConEnCobro) bonif += cp.total_factura * 0.1
    }
    for (const [key, monto] of Object.entries(credSel)) {
      if (key.startsWith("nc:") && cred10[key] && monto > 0) bonif -= monto * 0.1
    }
    return round2(bonif)
  }, [contadoGeneral, imputaciones, comprobantes, credSel, cred10])

  const cubierto = round2(totalMetodos + totalDevoluciones + bonificacionEstimada + totalCreditos)
  const falta = round2(totalAsignado - cubierto)
  const sobrante = round2(cubierto - totalAsignado)

  // Diálogo abierto sin diferencia que resolver (recarga, o se corrigió el monto): no corresponde
  useEffect(() => {
    if (dialogoFalta.abierto && !(falta > 0.01) && !enviandoRef.current) dialogoFalta.cerrar()
  }, [dialogoFalta, falta])

  const rechazos = useMemo(
    () => rechazosDe(ops, "cobro.").filter((it) => {
      const p = (it.payload || {}) as { cliente_id?: string; clientes?: Array<{ cliente_id?: string }> }
      return p.cliente_id === id || !!p.clientes?.some((c) => c.cliente_id === id)
    }),
    [ops, id],
  )

  if (!cuenta || !cliente || !id) {
    return (
      <Pantalla titulo="💵 Cobrar">
        {!cargando && (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="text-xl text-red-500">Cliente no encontrado</p>
          </div>
        )}
      </Pantalla>
    )
  }

  // ── Selección ──
  const toggleComprobante = (cp: ComprobanteCC) => {
    setImputaciones((prev) => {
      const next = { ...prev }
      if (next[cp.id] !== undefined) delete next[cp.id]
      else next[cp.id] = saldoCobrable(cp)
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
          else if (saldoCobrable(cp) > 0.005) next[cp.id] = saldoCobrable(cp)
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
    const contado = !contadoSel[p.id]
    setContadoSel((prev) => ({ ...prev, [p.id]: contado }))
    setPedidosSel((sel) => (sel[p.id] !== undefined ? { ...sel, [p.id]: montoAnticipo(p, contado) } : sel))
  }

  const toggleDevolucion = (d: DevolucionPendiente) => {
    setDevSel((prev) => {
      const next = { ...prev }
      if (next[d.id] !== undefined) delete next[d.id]
      else next[d.id] = d.restante
      return next
    })
  }

  const updateMetodo = (idx: number, patch: Partial<Metodo>) => setMetodos((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)))

  // ── Fotos → OCR → filas precargadas (ONLINE-ONLY) ──
  const subirFotos = async (files: FileList | null) => {
    if (!files?.length) return
    if (!online) {
      mostrar("Necesitás conexión para leer la foto. Podés registrar el cobro sin foto.", "err")
      return
    }
    setSubiendoFotos(true)
    try {
      const fd = new FormData()
      for (const f of Array.from(files)) fd.append("files", f)
      const d = await api.postForm<{ error?: string; archivos?: Array<{ url?: string }>; resultados?: Array<Record<string, any>> }>("/api/pagos-clientes/ocr", fd)
      if (d?.error) {
        mostrar(d.error, "err")
        return
      }
      setFotos((prev) => [...prev, ...(d.archivos || []).map((a) => a.url).filter((u): u is string => !!u)])
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
      else if (!(d.resultados || []).length) mostrar("La foto quedó adjunta pero no se detectaron datos. Cargá el cheque/transferencia a mano.", "err")
    } catch (e) {
      mostrar(e instanceof ErrorHttp ? e.body?.error || "Error al subir las fotos" : "No se pudo leer la foto (sin conexión o el servidor tardó demasiado). Cargá los datos a mano.", "err")
    } finally {
      setSubiendoFotos(false)
    }
  }

  /** Salir a la ficha sin dejar en el historial ni el diálogo ni el formulario ya enviado. */
  const salirALaFicha = () => {
    let hecho = false
    const ir = () => {
      if (hecho) return
      hecho = true
      navigate(`/clientes/${cliente.id}`, { replace: true })
    }
    if (dialogoFalta.abierto && (location.state as { overlay?: boolean } | null)?.overlay) {
      window.addEventListener("popstate", () => setTimeout(ir, 0), { once: true })
      setTimeout(ir, 800)
      navigate(-1)
    } else ir()
  }

  // ── Registrar (patrón /caja para la diferencia) ──
  const registrar = async (modoDiferencia?: "ajuste" | "saldo") => {
    if (enviandoRef.current) return
    if (totalMetodos + totalDevoluciones <= 0) {
      mostrar("Ingresá efectivo, cheques/transferencias o descontá una devolución.", "err")
      return
    }
    for (const m of metodos) {
      if (m.monto <= 0) return mostrar("Todos los cheques/transferencias deben tener monto.", "err")
      if (m.tipo === "cheque" && (!m.banco || !m.numero_cheque || !m.fecha_cheque)) return mostrar("Los cheques requieren banco, número y fecha.", "err")
      if (m.tipo === "transferencia" && !m.cuenta_bancaria_id) return mostrar("Las transferencias requieren la cuenta destino.", "err")
    }

    const impFinal: Record<string, number> = { ...imputaciones }
    let ajustePorRedondeo = 0

    if (falta > 0.01) {
      if (falta > totalImputado + 0.01) {
        mostrar(`Faltan ${formatCurrency(falta)} y superan lo imputado a comprobantes — sumá plata o sacá selección.`, "err")
        return
      }
      if (!modoDiferencia) {
        dialogoFalta.abrir()
        return
      }
      if (modoDiferencia === "ajuste") {
        // El tope lo vuelve a controlar el servidor; acá ni se ofrece si lo supera
        if (falta > topeAjuste(totalImputado) + 0.005) return
        ajustePorRedondeo = falta // imputaciones completas; el crédito se asienta al confirmarse el cobro
      } else {
        // Dejar saldo pendiente: recortar desde la última imputación
        let resta = falta
        const ids = Object.keys(impFinal)
        for (let i = ids.length - 1; i >= 0 && resta > 0.001; i--) {
          const k = ids[i]!
          const quitar = Math.min(impFinal[k]!, resta)
          impFinal[k] = round2(impFinal[k]! - quitar)
          resta = round2(resta - quitar)
          if (impFinal[k]! <= 0.001) delete impFinal[k]
        }
      }
    }

    enviandoRef.current = true
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

      // pago_a_cuenta = sobrante de lo cubierto (métodos + devoluciones + NC proyectada + ajuste)
      // sobre lo asignado final
      const asignadoFinal = round2(impPayload.reduce((s, i) => s + i.monto, 0) + totalPedidos)

      const payload = {
        clientes: [
          {
            cliente_id: cliente.id,
            imputaciones: impPayload,
            pedidos: Object.entries(pedidosSel)
              .filter(([, monto]) => monto > 0)
              .map(([pedido_id, monto]) => ({ pedido_id, monto, contado: !!contadoSel[pedido_id] })),
            pago_a_cuenta: Math.max(0, round2(totalMetodos + totalDevoluciones + bonificacionEstimada + totalCreditos + ajustePorRedondeo - asignadoFinal)),
            bonificacion_proyectada: contadoGeneral ? bonificacionEstimada : 0,
            // Créditos tildados: [{tipo:'nc'|'ac', id, monto}] — el backend los asigna FIFO a los
            // débitos y los aplica al confirmar
            creditos: Object.entries(credSel)
              .filter(([, monto]) => monto > 0)
              .map(([key, monto]) => {
                const [tipo, ...rest] = key.split(":")
                return {
                  tipo,
                  id: rest.join(":"),
                  monto,
                  // 10% en contra: solo NC de mercadería sin dto, en cobro contado
                  aplicar_10: tipo === "nc" && contadoGeneral && !!cred10[key],
                }
              }),
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

      await encolar("cobro.registrar", payload, `Cobro ${cliente.nombre} ${formatCurrency(totalMetodos)}`)

      // El ajuste por redondeo viajó ADENTRO del cobro (ajuste_redondeo): se asienta cuando la
      // oficina lo confirma, no acá.
      dejarAviso(`✅ Cobro registrado por ${formatCurrency(totalMetodos)}. Queda pendiente de rendición.`)
      salirALaFicha()
    } catch {
      enviandoRef.current = false
      setEnviando(false)
      mostrar("No se pudo guardar el cobro en el equipo.", "err")
    }
  }

  const proyectado = cliente.saldo_proyectado ?? cliente.saldo_actual
  const proyectadoCero = Math.abs(proyectado) < 0.01

  // Función de render (no componente): un sub-componente definido acá adentro se remontaría
  // en cada tecla y el MontoInput perdería el foco.
  const filaComprobante = (cp: ComprobanteCC) => {
    const activo = imputaciones[cp.id] !== undefined
    return (
      <div key={cp.id} className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 ${activo ? "border-emerald-500 bg-emerald-50/40" : "border-gray-200 bg-white"}`}>
        <button onClick={() => toggleComprobante(cp)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left">
          <span className="shrink-0 text-lg">{activo ? "☑" : "☐"}</span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900">{cp.tipo_comprobante} {cp.numero_comprobante}</p>
            <p className="text-xs text-gray-400">
              {cp.fecha ? `${cp.fecha.slice(0, 10).split("-").reverse().join("/")} · ` : ""}saldo {formatCurrency(cp.saldo_pendiente)}
            </p>
            {(cp.en_cobro || 0) > 0.005 && (
              <p className="text-xs font-bold text-sky-600">
                🔒 {formatCurrency(cp.en_cobro)} en cobro sin confirmar → cobrable {formatCurrency(saldoCobrable(cp))}
              </p>
            )}
          </div>
        </button>
        {activo && (
          <MontoInput
            valor={imputaciones[cp.id]!}
            onCambio={(v) => setImputaciones((prev) => ({ ...prev, [cp.id]: Math.min(Math.max(0, v), saldoCobrable(cp)) }))}
            className={CLS_MONTO}
          />
        )}
      </div>
    )
  }

  const listaVacia =
    tab === "fact"
      ? pedidosFacturados.length === 0 && compsSueltos.length === 0 && devoluciones.length === 0 && creditos.length === 0 && aCuenta.length === 0
      : pedidosSinFacturar.length === 0

  return (
    <Pantalla
      titulo="💵 Cobrar"
      dataset={DS.cc}
      pie={
        /* ══ Resumen fijo ══ */
        <div className="border-t border-gray-200 bg-white p-4">
          <div className="mx-auto max-w-2xl space-y-2">
            <div className="flex justify-between gap-2 text-sm text-gray-500">
              <span>
                Seleccionado {formatCurrency(totalAsignado)}
                {bonificacionEstimada > 0 ? ` − NC ${formatCurrency(bonificacionEstimada)}` : ""}
                {totalDevoluciones > 0 ? ` − dev. ${formatCurrency(totalDevoluciones)}` : ""}
                {totalCreditos > 0.005 ? ` − créditos ${formatCurrency(totalCreditos)}` : ""}
                {totalCreditos <= 0.005 && totalAFavor > 0.005 ? ` · tiene ${formatCurrency(totalAFavor)} a favor` : ""}
              </span>
              <span className="shrink-0">Entregado {formatCurrency(totalMetodos)}</span>
            </div>
            {Math.abs(falta) < 0.01 && totalAsignado > 0 && <p className="rounded-lg bg-green-50 py-1.5 text-center text-sm font-bold text-green-700">✓ Cuadra</p>}
            {sobrante > 0.01 && <p className="rounded-lg bg-emerald-50 py-1.5 text-center text-sm font-bold text-emerald-700">Sobran {formatCurrency(sobrante)} → quedan a cuenta</p>}
            {falta > 0.01 && (
              <p className="rounded-lg bg-amber-50 py-1.5 text-center text-sm font-bold text-amber-700">
                Resta saldar {formatCurrency(falta)} — al registrar elegís ajuste o saldo pendiente
              </p>
            )}
            <button onClick={() => void registrar()} disabled={enviando || totalMetodos + totalDevoluciones <= 0} className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:bg-gray-300">
              {enviando ? "Registrando..." : `Registrar cobro ${formatCurrency(totalMetodos)}`}
            </button>
          </div>
        </div>
      }
    >
      {toast}
      {/* Cliente + saldo PROYECTADO primero (lo que va a deber cuando el ERP confirme lo cobrado) y el real chiquito */}
      <div className="flex items-center gap-3 bg-emerald-700 px-5 py-3 text-white shadow-md">
        <p className="min-w-0 flex-1 truncate text-sm text-emerald-100">{cliente.nombre}</p>
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-emerald-200">Saldo proyectado</p>
          <p className={`font-bold ${proyectadoCero ? "text-green-300" : ""}`}>{proyectadoCero ? "$ 0,00" : formatCurrency(proyectado)}</p>
          {Math.abs(cliente.saldo_actual - proyectado) > 0.01 && <p className="text-[10px] text-emerald-300/80">real {formatCurrency(cliente.saldo_actual)}</p>}
        </div>
      </div>
      <Rechazos items={rechazos} ayuda="El cobro rechazado NO quedó registrado. Revisá el motivo y, si corresponde, volvé a cargarlo." />

      <div className="mx-auto w-full max-w-2xl space-y-6 p-4">
        {/* ══ 1. Qué paga ══ */}
        <section>
          <h2 className="mb-2 text-lg font-bold text-gray-700">¿Qué está pagando?</h2>

          {/* Facturados (lo que existe) / Pedidos pendientes (en desarrollo) */}
          <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-gray-200/70 p-1">
            <button onClick={() => setTab("fact")} className={`min-h-11 rounded-lg py-2 text-sm font-bold ${tab === "fact" ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500"}`}>
              Facturados{pedidosFacturados.length + compsSueltos.length > 0 ? ` · ${pedidosFacturados.length + compsSueltos.length}` : ""}
            </button>
            <button onClick={() => setTab("pend")} className={`min-h-11 rounded-lg py-2 text-sm font-bold ${tab === "pend" ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500"}`}>
              Pedidos pendientes{pedidosSinFacturar.length > 0 ? ` · ${pedidosSinFacturar.length}` : ""}
            </button>
          </div>
          {tab === "pend" && (
            <p className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Pedidos levantados que la oficina todavía no facturó. Cobrarlos registra un <b>anticipo</b> (queda a cuenta y se imputa cuando salga la factura).
            </p>
          )}

          {listaVacia ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-center text-gray-500">
              {tab === "fact" ? "Sin comprobantes facturados pendientes. Lo que cobres queda como pago a cuenta." : "No hay pedidos sin facturar."}
            </div>
          ) : (
            <div className="space-y-2">
              {(tab === "fact" ? pedidosFacturados : pedidosSinFacturar).map((p) => {
                const comps = compsPorPedido.get(p.id) || []
                const estado = p.facturado
                  ? { label: "FACTURADO", cls: "bg-green-100 text-green-700" }
                  : ESTADO_PEDIDO[p.estado] || { label: String(p.estado || "").toUpperCase(), cls: "bg-gray-100 text-gray-600" }
                const selPedido = pedidosSel[p.id] !== undefined
                const selComps = comps.length > 0 && comps.every((cp) => imputaciones[cp.id] !== undefined)
                const parcialComps = comps.some((cp) => imputaciones[cp.id] !== undefined)
                const expandido = abierto === p.id
                const seleccionado = selPedido || selComps

                return (
                  <div key={p.id} className={`overflow-hidden rounded-2xl border-2 bg-white ${seleccionado || parcialComps ? "border-emerald-500" : "border-gray-200"}`}>
                    <div className="flex w-full items-center gap-2 p-3">
                      <button onClick={() => togglePedido(p)} disabled={!p.cobrable && !comps.length} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left">
                        <span className="shrink-0 text-lg">{seleccionado ? "☑" : parcialComps ? "◪" : p.cobrable || comps.length ? "☐" : "•"}</span>
                        <div className="min-w-0">
                          <p className="truncate font-bold text-gray-900">Pedido {p.numero_pedido ? `#${p.numero_pedido}` : ""}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${estado.cls}`}>{estado.label}</span>
                            {p.pago_contado_10 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">✓ 10% CONTADO</span>}
                            {p.anticipo_pago_id && !p.facturado && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">ANTICIPADO</span>}
                          </div>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-2 text-right">
                        {selPedido ? (
                          <MontoInput valor={pedidosSel[p.id]!} onCambio={(v) => setPedidosSel((prev) => ({ ...prev, [p.id]: Math.min(Math.max(0, v), p.total) }))} className={CLS_MONTO} />
                        ) : (
                          <p className="font-bold text-gray-900">{formatCurrency(p.total)}</p>
                        )}
                        {comps.length > 0 && (
                          <button onClick={() => setAbierto(expandido ? "" : p.id)} className="min-h-11 min-w-11 px-1 text-lg text-gray-400" title="Ver comprobantes">
                            {expandido ? "▾" : "▸"}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 10% contado del pedido sin facturar */}
                    {selPedido && p.cobrable && (
                      <div className="-mt-1 px-3 pb-2.5">
                        <label className="flex min-h-11 items-center gap-2 text-sm text-gray-600">
                          <input type="checkbox" checked={!!contadoSel[p.id]} onChange={() => toggleContadoPedido(p)} className="h-5 w-5" />
                          10% contado (cobra el 90%, la NC sale al facturar)
                        </label>
                      </div>
                    )}

                    {/* Comprobantes del pedido (afinar) */}
                    {comps.length > 0 && expandido && <div className="space-y-1.5 border-t border-gray-100 bg-gray-50/60 px-3 pb-3 pt-2">{comps.map((cp) => filaComprobante(cp))}</div>}
                  </div>
                )
              })}

              {tab === "fact" && compsSueltos.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Otros comprobantes</p>
                  {compsSueltos.map((cp) => filaComprobante(cp))}
                </div>
              )}

              {/* Créditos del cliente (NC/REV + plata a cuenta): TILDABLES — descuentan del total a
                  saldar y se aplican a los comprobantes al confirmarse el cobro. */}
              {tab === "fact" && (totalAFavor > 0.005 || aCuenta.length > 0 || creditos.length > 0) && (
                <div className="space-y-1.5 pt-1">
                  <p className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-600">Créditos y entregas a cuenta — tildá lo que descuenta de este cobro</p>
                  {creditos.map((c) => {
                    const key = `nc:${c.id}`
                    const disp = round2(Math.abs(c.saldo_pendiente))
                    const activo = credSel[key] !== undefined
                    return (
                      <div key={c.id} className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 ${activo ? "border-emerald-400 bg-emerald-50" : "border-gray-200 bg-white"}`}>
                        <button
                          onClick={() => {
                            setCredSel((prev) => {
                              const next = { ...prev }
                              if (next[key] !== undefined) delete next[key]
                              else next[key] = disp
                              return next
                            })
                            // Default: crédito de mercadería sin dto → 10% activo cuando el cobro es contado; destildable.
                            setCred10((prev) => (prev[key] === undefined ? { ...prev, [key]: true } : prev))
                          }}
                          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span className="shrink-0 text-lg">{activo ? "☑" : "☐"}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-900">{c.tipo_comprobante === "REV" ? "Reversa" : "Nota de crédito"} {c.numero_comprobante}</p>
                            <p className="text-xs text-emerald-600">crédito disponible {formatCurrency(disp)}</p>
                          </div>
                        </button>
                        {activo && contadoGeneral && (
                          <button
                            onClick={() => setCred10((prev) => ({ ...prev, [key]: !prev[key] }))}
                            className={`min-h-11 shrink-0 rounded-lg border-2 px-2 py-1 text-[11px] font-bold ${cred10[key] ? "border-amber-400 bg-amber-50 text-amber-800" : "border-gray-200 bg-white text-gray-400"}`}
                            title="Crédito de mercadería SIN el 10% hecho: se le aplica el 10% en contra. Destildá si la NC ya tiene el descuento."
                          >
                            {cred10[key] ? "☑" : "☐"} 10%
                          </button>
                        )}
                        {activo && <MontoInput valor={credSel[key]!} onCambio={(v) => setCredSel((prev) => ({ ...prev, [key]: Math.min(Math.max(0, v), disp) }))} className={CLS_MONTO} />}
                      </div>
                    )
                  })}
                  {aCuenta.map((p) => {
                    const key = `ac:${p.pago_id}`
                    const disp = round2(p.disponible)
                    const activo = credSel[key] !== undefined
                    const rechazada = p.estado === "rechazado"
                    // Dónde está la plata: el vendedor lo ve de un vistazo
                    const seguimiento = rechazada
                      ? { label: "⛔ Rechazada por oficina — NO descuenta", cls: "text-red-600" }
                      : p.estado === "pendiente_rendicion"
                        ? { label: p.mia ? "🧍 En tu poder · sin rendir" : "🧍 En poder del vendedor · sin rendir", cls: "text-amber-700" }
                        : p.estado === "pendiente"
                          ? { label: "🏢 En oficina · sin confirmar", cls: "text-sky-700" }
                          : { label: "✅ Confirmada por oficina", cls: "text-green-700" }
                    return (
                      <div key={p.pago_id} className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 ${rechazada ? "border-red-200 bg-red-50/50 opacity-80" : activo ? "border-emerald-400 bg-emerald-50" : "border-gray-200 bg-white"}`}>
                        <button
                          disabled={rechazada}
                          onClick={() =>
                            setCredSel((prev) => {
                              const next = { ...prev }
                              if (next[key] !== undefined) delete next[key]
                              else next[key] = disp
                              return next
                            })
                          }
                          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span className="shrink-0 text-lg">{rechazada ? "•" : activo ? "☑" : "☐"}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-900">
                              Entrega a cuenta {p.fecha?.split("-").reverse().join("/")}
                              {p.monto ? ` · ${formatCurrency(p.monto)}` : ""}
                            </p>
                            <p className={`text-xs font-bold ${seguimiento.cls}`}>{seguimiento.label}</p>
                            {!rechazada && (
                              <p className="text-xs text-emerald-600">
                                disponible {formatCurrency(disp)}
                                {p.monto && disp < p.monto - 0.005 ? ` de ${formatCurrency(p.monto)} (el resto ya está aplicado)` : ""}
                              </p>
                            )}
                          </div>
                        </button>
                        {activo && !rechazada && <MontoInput valor={credSel[key]!} onCambio={(v) => setCredSel((prev) => ({ ...prev, [key]: Math.min(Math.max(0, v), disp) }))} className={CLS_MONTO} />}
                      </div>
                    )
                  })}
                  <p className="px-1 text-xs text-gray-400">
                    El crédito tildado se aplica a los comprobantes seleccionados al confirmarse el cobro. Con cobro contado: el check "10%" marca los
                    créditos de mercadería SIN el descuento hecho (se les aplica el 10% en contra); destildalo si la NC ya lo tiene. La plata a cuenta
                    nunca lleva 10%.
                  </p>
                </div>
              )}

              {/* Devoluciones descontables */}
              {tab === "fact" && devoluciones.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-600">🔄 Devoluciones a descontar</p>
                  {devoluciones.map((d) => {
                    const activo = devSel[d.id] !== undefined
                    return (
                      <div key={d.id} className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 ${activo ? "border-amber-400 bg-amber-50" : "border-gray-200 bg-white"}`}>
                        <button onClick={() => toggleDevolucion(d)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left">
                          <span className="shrink-0 text-lg">{activo ? "☑" : "☐"}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-900">Devolución {d.numero_devolucion || ""}</p>
                            <p className="text-xs text-gray-400">
                              disponible {formatCurrency(d.restante)}
                              {d.restante < d.monto_total ? ` de ${formatCurrency(d.monto_total)}` : ""}
                            </p>
                          </div>
                        </button>
                        {activo && <MontoInput valor={devSel[d.id]!} onCambio={(v) => setDevSel((prev) => ({ ...prev, [d.id]: Math.min(Math.max(0, v), d.restante) }))} className={CLS_MONTO} />}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* 10% contado general (comprobantes) */}
              {totalImputado > 0 && (
                <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-700">
                  <input type="checkbox" checked={contadoGeneral} onChange={(e) => setContadoGeneral(e.target.checked)} className="h-5 w-5" />
                  <span>
                    <span className="font-bold">10% descuento pago contado</span>
                    {bonificacionEstimada > 0 && <span className="text-emerald-700"> — NC proyectada {formatCurrency(bonificacionEstimada)}</span>}
                    <span className="block text-xs text-gray-400">
                      La NC/REV real la emite la oficina al confirmar el pago. Aplica a comprobantes que quedan completos: con lo de hoy, o sumando
                      entregas en cobro que también fueron contado.
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}
        </section>

        {/* ══ 2. Cómo paga (compacto) ══ */}
        <section>
          <h2 className="mb-2 text-lg font-bold text-gray-700">¿Cómo paga?</h2>
          <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
            {/* Efectivo */}
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className="w-24 shrink-0 text-sm font-bold text-gray-700">💵 Efectivo</span>
              <span className="flex-1" />
              <MontoInput valor={efectivo} onCambio={setEfectivo} className={CLS_MONTO} />
            </div>

            {/* Cheques / transferencias */}
            {metodos.map((m, idx) => (
              <div key={idx}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => setMetodoAbierto(metodoAbierto === idx ? null : idx)} className="min-h-11 w-24 shrink-0 text-left text-sm font-bold text-gray-700">
                    {m.tipo === "cheque" ? (m.es_echeq ? "⚡ E-cheq" : "📄 Cheque") : "🏦 Transf."}
                  </button>
                  <span className="min-w-0 flex-1 truncate text-xs text-gray-500">
                    {m.tipo === "cheque" ? m.numero_cheque || "s/nº" : m.referencia_transferencia || "s/nº"}
                    {m.tipo === "cheque" && m.banco ? ` · ${m.banco}` : ""}
                    {m.tipo === "transferencia" ? ` · ${cuentas.find((c) => c.id === m.cuenta_bancaria_id)?.banco || "sin cuenta"}` : ""}
                  </span>
                  {m.tipo === "cheque" && m.cuit_emisor && <BcraTick cuit={m.cuit_emisor} />}
                  <MontoInput valor={m.monto} onCambio={(v) => updateMetodo(idx, { monto: v })} className={CLS_MONTO} />
                  <button
                    onClick={() => {
                      setMetodos((prev) => prev.filter((_, i) => i !== idx))
                      setMetodoAbierto(null)
                    }}
                    aria-label="Quitar"
                    className="min-h-11 min-w-9 px-0.5 text-lg text-red-400"
                  >
                    ✕
                  </button>
                </div>
                {m.tipo === "cheque" && m.cuit_emisor && (
                  <div className="px-3 pb-2">
                    <BcraAlerta cuit={m.cuit_emisor} banco={m.banco} />
                  </div>
                )}
                {metodoAbierto === idx && (
                  <div className="grid grid-cols-2 gap-2 bg-gray-50/60 px-3 pb-3 pt-2">
                    {m.tipo === "cheque" ? (
                      <>
                        <input value={m.banco} onChange={(e) => updateMetodo(idx, { banco: e.target.value })} placeholder="Banco *" className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                        <input value={m.numero_cheque} onChange={(e) => updateMetodo(idx, { numero_cheque: e.target.value })} placeholder="N° cheque *" className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                        <input type="date" value={m.fecha_cheque} onChange={(e) => updateMetodo(idx, { fecha_cheque: e.target.value })} className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                        <input value={m.cuit_emisor} onChange={(e) => updateMetodo(idx, { cuit_emisor: e.target.value })} placeholder="CUIT emisor" inputMode="numeric" className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                        <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm text-gray-600">
                          <input type="checkbox" checked={m.es_echeq} onChange={(e) => updateMetodo(idx, { es_echeq: e.target.checked })} className="h-5 w-5" />
                          Es e-cheq
                        </label>
                      </>
                    ) : (
                      <>
                        <select value={m.cuenta_bancaria_id} onChange={(e) => updateMetodo(idx, { cuenta_bancaria_id: e.target.value })} className="col-span-2 min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                          <option value="">Cuenta destino *</option>
                          {cuentas.map((cb) => (
                            <option key={cb.id} value={cb.id}>
                              {cb.banco}{cb.alias ? ` (${cb.alias})` : ""}
                            </option>
                          ))}
                        </select>
                        <input value={m.referencia_transferencia} onChange={(e) => updateMetodo(idx, { referencia_transferencia: e.target.value })} placeholder="N° operación" className="col-span-2 min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Total métodos */}
            <div className="flex items-center justify-between rounded-b-2xl bg-gray-50 px-3 py-2.5">
              <span className="text-sm font-medium text-gray-500">Total entregado</span>
              <span className="font-bold text-gray-900">{formatCurrency(totalMetodos)}</span>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className={`rounded-xl py-3 text-center text-sm font-bold ${online && !subiendoFotos ? "bg-emerald-600 text-white" : "bg-gray-300 text-gray-500"}`}>
              📷 Foto cheque/transf.
              <input type="file" accept="image/*" multiple capture="environment" className="hidden" disabled={subiendoFotos || !online} onChange={(e) => { void subirFotos(e.target.files); e.target.value = "" }} />
            </label>
            <label className={`rounded-xl border-2 py-3 text-center text-sm font-bold ${online && !subiendoFotos ? "border-emerald-600 bg-white text-emerald-700" : "border-gray-300 bg-gray-100 text-gray-400"}`}>
              🖼 Galería
              <input type="file" accept="image/*" multiple className="hidden" disabled={subiendoFotos || !online} onChange={(e) => { void subirFotos(e.target.files); e.target.value = "" }} />
            </label>
          </div>
          {!online && <p className="mt-1 px-1 text-xs text-amber-700">📡 Necesitás conexión para leer la foto del cheque/transferencia. El cobro se puede registrar igual, sin foto: cargá los datos a mano.</p>}
          <div className="mt-2 flex gap-4 px-1">
            <button onClick={() => { setMetodos((p) => [...p, nuevoMetodo("cheque")]); setMetodoAbierto(metodos.length) }} className="min-h-11 text-sm font-bold text-emerald-700">
              + Cheque a mano
            </button>
            <button onClick={() => { setMetodos((p) => [...p, nuevoMetodo("transferencia")]); setMetodoAbierto(metodos.length) }} className="min-h-11 text-sm font-bold text-emerald-700">
              + Transferencia a mano
            </button>
          </div>
          {subiendoFotos && <p className="mt-2 px-1 text-sm font-medium text-emerald-700">Leyendo la foto...</p>}
          {fotos.length > 0 && <p className="mt-1 px-1 text-xs text-gray-500">✓ {fotos.length} foto(s) adjuntas.</p>}
        </section>

        {/* Observaciones */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <label className="mb-1 block text-sm text-gray-500">Observaciones</label>
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="Opcional..." />
        </section>
      </div>

      {/* ══ Diálogo diferencia (patrón /caja) — overlay con historial: atrás lo cierra ══ */}
      {dialogoFalta.abierto && falta > 0.01 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-center text-lg font-bold text-gray-900">Falta pagar {formatCurrency(falta)}</h3>
            <p className="text-center text-sm text-gray-500">Lo entregado no llega a cubrir lo seleccionado. ¿Qué hacemos con la diferencia?</p>
            {falta <= topeAjuste(totalImputado) + 0.005 ? (
              <button onClick={() => void registrar("ajuste")} disabled={enviando} className="w-full rounded-xl bg-emerald-600 py-3 font-bold text-white">
                Pasar como ajuste por redondeo
                <span className="block text-[11px] font-medium text-emerald-100">El comprobante queda saldado; {formatCurrency(falta)} se acreditan al confirmar el cobro</span>
              </button>
            ) : (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-700">
                Supera el tope de ajuste (1% de lo seleccionado = {formatCurrency(topeAjuste(totalImputado))}). Perdonar más que eso lo decide la oficina: dejá el saldo pendiente.
              </p>
            )}
            <button onClick={() => void registrar("saldo")} disabled={enviando} className="w-full rounded-xl border-2 border-gray-300 bg-white py-3 font-bold text-gray-700">
              Dejar saldo pendiente
              <span className="block text-[11px] font-medium text-gray-400">El comprobante queda parcial, con {formatCurrency(falta)} por cobrar</span>
            </button>
            <button onClick={dialogoFalta.cerrar} disabled={enviando} className="min-h-11 w-full py-2 text-sm text-gray-500">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </Pantalla>
  )
}
