import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router"
import { useOnline, useOverlay, useParamEstado, useRuntime } from "@gm/core"
import {
  aplicarOcr, cuitValido, editarCampo, faltantes, filaDesdeFoto, filaVacia, marcarFalloOcr, marcarFotoAdjunta, marcarSinDatos, resultadoConDatos, urlsDeFotos,
  type CampoCheque, type ConsultaBcraPayload, type FilaCheque, type ResultadoOcr,
} from "@gm/cheques"
import { blobABase64, comprimirFoto, urlLocal } from "@gm/cheques/foto"
import { DS, ESTADOS_COBRABLES, nombreCliente, type ClienteBusqueda, type ComprobanteCobro, type MetodoPayload, type OpCobrar, type PedidoCobro } from "../datasets"
import { buscarClientes, useClienteViaje, useClientesTodos, useCuentasBancarias, useEncolar, useViaje, uuidv4 } from "../datos/hooks"
import { AvisosBcra, dejarAviso, dejarAvisoSinCuit, formatCurrency, formatDateAR, Pantalla, round2, SinDescargar, useBloqueoSalida, useBusqueda, useToast } from "../ui"

// Cobro en el reparto (= el sheet "Registrar Cobro" de la ficha web, ahora ruta propia).
//  · Pedidos / comprobantes a cobrar (incluye anticipos a pedidos sin facturar): lo que
//    components/pagos/ComprobantesSelector leía con supabase-js, ahora replicado en la ficha.
//  · Clientes extra para cobrar en la misma cobranza (cobro conjunto en la calle): búsqueda
//    local sobre chofer_clientes (saldo replicado).
//  · Devoluciones pendientes como crédito, 10% contado (por pedido y general), diferencia al
//    registrar (ajuste por redondeo con tope 1% / dejar saldo), igual que la web.
//  · Foto de cheques (MOBILE.md → "Cheques"): la foto NUNCA bloquea; el OCR corre en segundo
//    plano con señal y completa solo los campos que el chofer no tocó (en ámbar); sin señal la
//    foto queda en el equipo y sube dentro del cobro (fotos_pendientes). BCRA desacoplado: al
//    registrar se encola `bcra.consultar` por cheque con CUIT válido; el veredicto llega como aviso.
// El cobro se ENCOLA (`viaje.cobrar`, payload = body de POST /api/chofer/viaje/[id]/cobro).
// Atrás con el cobro a medio cargar pide confirmación antes de descartar.

interface MetodoEfectivo { id: string; tipo: "efectivo"; monto: number }
type MetodoPago = MetodoEfectivo | FilaCheque
const esFila = (m: MetodoPago): m is FilaCheque => m.tipo !== "efectivo"

/** Fila → método en el formato que espera POST /api/chofer/viaje/[id]/cobro (= web). */
const metodoPayload = (m: MetodoPago): MetodoPayload =>
  esFila(m)
    ? m.tipo === "cheque"
      ? { tipo: "cheque", monto: m.monto, banco_emisor: m.banco, numero_cheque: m.numero_cheque, fecha_cheque: m.fecha_cheque, fecha_emision: m.fecha_emision || undefined, cuit_emisor: m.cuit_emisor || undefined, color_cheque: m.es_echeq ? "ECHEQ" : undefined }
      : { tipo: "transferencia", monto: m.monto, numero_comprobante: m.referencia_transferencia || undefined, cuenta_bancaria_id: m.cuenta_bancaria_id || undefined }
    : { tipo: "efectivo", monto: m.monto }

const PEDIDO_PREFIX = "pedido:"
/** = topeAjuste de lib/cobranzas/ajuste.ts: máximo ajuste admitido (1% de lo imputado). */
const topeAjuste = (total: number) => round2(Math.max(0, Number(total) || 0) * 0.01)
/** Saldo cobrable HOY: el del comprobante menos lo que ya está en un cobro hecho acá sin enviar. */
const saldoCobrable = (cp: ComprobanteCobro) => Math.max(0, round2(cp.saldo_pendiente - (cp.en_cobro || 0)))
const fmt = (n: number) => Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })

type CambiosMetodo = Partial<Omit<FilaCheque, "tipo">> & { tipo?: MetodoPago["tipo"] }
/** Aplica cambios a un método: cambio de tipo (efectivo ↔ fila) o edición de campos (marca "editado" en la fila). */
function aplicarCambios(m: MetodoPago, updates: CambiosMetodo): MetodoPago {
  const { tipo, ...campos } = updates
  let out: MetodoPago = m
  if (tipo && tipo !== m.tipo) {
    if (tipo === "efectivo") out = { id: m.id, tipo: "efectivo", monto: m.monto }
    else if (m.tipo === "efectivo") out = { ...filaVacia(m.id, tipo), monto: m.monto }
    else out = { ...m, tipo }
  }
  if (!esFila(out)) return { ...out, ...(campos.monto !== undefined ? { monto: campos.monto } : {}) }
  return (Object.entries(campos) as Array<[keyof FilaCheque, any]>).reduce((f, [k, v]) => editarCampo(f, k, v), out)
}

const CLS_INPUT = "min-h-11 w-full rounded-xl border-2 px-4 py-3 text-base border-gray-200"
const clsOcr = (fila: FilaCheque, campo: CampoCheque, base = "") => `${base} ${fila.ocr.deOcr.includes(campo) ? "border-amber-400 bg-amber-50" : ""}`.trim()

function EstadoFoto({ fila }: { fila: FilaCheque }) {
  const o = fila.ocr
  if (o.estado === "sin_foto") return null
  const preview = o.foto_url || o.foto_local
  return (
    <div className="flex items-start gap-2 text-xs">
      {preview && <img src={preview} alt="Foto del comprobante" className="h-12 w-16 shrink-0 rounded-lg border border-gray-200 object-cover" />}
      <div className="min-w-0 flex-1">
        {o.estado === "leyendo" && <p className="text-gray-500">⏳ Leyendo la foto… podés cargar los datos mientras tanto.</p>}
        {o.estado === "ok" && (
          <p className="text-amber-700"><span className="rounded bg-amber-100 px-1 font-bold">OCR</span> Los campos en ámbar vinieron de la foto: revisalos y corregí lo que haga falta.</p>
        )}
        {(o.estado === "sin_datos" || o.estado === "fallo") && <p className="text-gray-600">{o.detalle}</p>}
        {o.pista && <p className="mt-0.5 font-medium text-red-700">{o.pista}</p>}
      </div>
    </div>
  )
}

export function Cobrar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { viajeId = "", clienteId = "" } = useParams<{ viajeId: string; clienteId: string }>()
  const { api } = useRuntime()
  const online = useOnline()
  const encolar = useEncolar()
  const { cliente: data, cargando, descargada } = useClienteViaje(viajeId, clienteId)
  const { viaje } = useViaje(viajeId)
  const cuentas = useCuentasBancarias()
  const { filas: clientesTodos } = useClientesTodos()
  const { toast, mostrar } = useToast()

  // ── Qué paga ──
  const [sel, setSel] = useState<Record<string, number>>({}) // { comprobante_id | "pedido:<id>": monto }
  const [contadoPedidos, setContadoPedidos] = useState<Set<string>>(new Set())
  const [contadoGeneral, setContadoGeneral] = useState(false)
  const [incluirDevoluciones, setIncluirDevoluciones] = useState(true)
  const [expandido, setExpandido] = useParamEstado("abierto")
  // ── Clientes extra (cobro conjunto) ──
  const [cobrosExtra, setCobrosExtra] = useState<Array<{ cliente: ClienteBusqueda; saldo: number; monto: number }>>([])
  const [busqCli, setBusqCli] = useBusqueda("cli")
  // ── Cómo paga ──
  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([{ id: "1", tipo: "efectivo", monto: 0 }])
  const fotosLocales = useRef(new Map<string, { b64: string; mime: string; nombre: string }>())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const vivo = useRef(true)
  useEffect(() => {
    vivo.current = true
    return () => { vivo.current = false }
  }, [])
  // ── Diferencia / envío ──
  const dialogo = useOverlay("diff")
  const [dialogoDiff, setDialogoDiff] = useState<number | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [listo, setListo] = useState(false)
  const guardandoRef = useRef(false)

  const cobro = data?.cobro
  const comprobantes = useMemo(() => cobro?.comprobantes ?? [], [cobro?.comprobantes])
  const pedidos = useMemo(() => cobro?.pedidos ?? [], [cobro?.pedidos])
  const pedidosFacturados = useMemo(() => new Set(cobro?.pedidos_facturados ?? []), [cobro?.pedidos_facturados])
  const dtosHechos = useMemo(() => new Set(cobro?.dtos_hechos ?? []), [cobro?.dtos_hechos])
  const devPendientes = useMemo(() => (data?.devoluciones ?? []).filter((d) => d.estado === "pendiente"), [data?.devoluciones])

  // Agrupar comprobantes por pedido; un comprobante vivo cuyo pedido fue eliminado cae en "Otros"
  const { compsPorPedido, sinPedido } = useMemo(() => {
    const vivos = new Set(pedidos.map((p) => p.id))
    const m = new Map<string, ComprobanteCobro[]>()
    const sueltos: ComprobanteCobro[] = []
    for (const c of comprobantes) {
      if (c.pedido_id && vivos.has(c.pedido_id)) {
        if (!m.has(c.pedido_id)) m.set(c.pedido_id, [])
        m.get(c.pedido_id)!.push(c)
      } else sueltos.push(c)
    }
    return { compsPorPedido: m, sinPedido: sueltos }
  }, [comprobantes, pedidos])
  const pedidosSinFacturar = useMemo(() => pedidos.filter((p) => !compsPorPedido.has(p.id) && !pedidosFacturados.has(p.id)), [pedidos, compsPorPedido, pedidosFacturados])
  const esSaldado = (p: PedidoCobro) => pedidosFacturados.has(p.id) && !compsPorPedido.has(p.id)

  // ── Totales (= web) ──
  const bonificacionEstimada = useMemo(() => {
    if (!contadoGeneral) return 0
    let b = 0
    for (const cp of comprobantes) {
      const imp = sel[cp.id]
      if (imp === undefined || dtosHechos.has(cp.id)) continue
      if (!["FA", "FB", "FC", "PRES"].includes(String(cp.tipo_comprobante || "").toUpperCase())) continue
      if (Math.abs(imp - cp.saldo_pendiente) < 0.01) b += cp.total_factura * 0.1
    }
    return round2(b)
  }, [contadoGeneral, comprobantes, sel, dtosHechos])
  const totalImputado = round2(Object.values(sel).reduce((s, v) => s + v, 0))
  const devTotal = incluirDevoluciones ? round2(devPendientes.reduce((s, d) => s + Number(d.monto_total), 0)) : 0
  const totalCobro = Math.max(0, round2(totalImputado - devTotal - bonificacionEstimada))
  const totalMetodos = round2(metodosPago.reduce((s, m) => s + Number(m.monto || 0), 0))
  const diff = round2(totalMetodos - totalCobro)

  const clienteNombre = data?.cliente?.razon_social || data?.cliente?.nombre || "Cliente"
  const estadoViaje = viaje?.viaje.estado || data?.viaje_estado || ""
  const puedeCobrar = ESTADOS_COBRABLES.includes(estadoViaje)

  const sucio = !listo && (totalMetodos > 0 || Object.keys(sel).length > 0 || cobrosExtra.length > 0 || metodosPago.some(esFila))
  const { hoja: hojaDescartar } = useBloqueoSalida(sucio, { titulo: "¿Descartar el cobro?", detalle: "Lo cargado en esta pantalla no se registró todavía.", confirmar: "Descartar" })

  // Diálogo abierto sin diferencia (recarga o se corrigió el monto): no corresponde
  useEffect(() => {
    if (dialogo.abierto && (dialogoDiff === null || Math.abs(diff) <= 0.01) && !guardandoRef.current) dialogo.cerrar()
  }, [dialogo, dialogoDiff, diff])
  // Registrado: a la ficha, sin dejar el formulario ni el diálogo en el historial
  useEffect(() => {
    if (!listo) return
    const ir = () => navigate(`/viajes/${viajeId}/clientes/${clienteId}`, { replace: true })
    if (dialogo.abierto && (location.state as { overlay?: boolean } | null)?.overlay) {
      let hecho = false
      const una = () => { if (!hecho) { hecho = true; ir() } }
      window.addEventListener("popstate", () => setTimeout(una, 0), { once: true })
      setTimeout(una, 800)
      navigate(-1)
    } else ir()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo])

  // ── Selección (= ComprobantesSelector) ──
  const setUno = (key: string, monto: number | null) => setSel((prev) => { const n = { ...prev }; if (monto === null) delete n[key]; else n[key] = monto; return n })
  const toggleComprobante = (cp: ComprobanteCobro) => setUno(cp.id, sel[cp.id] !== undefined ? null : saldoCobrable(cp))
  const togglePedidoCompleto = (comps: ComprobanteCobro[]) => {
    const todos = comps.every((c) => sel[c.id] !== undefined)
    setSel((prev) => { const n = { ...prev }; for (const c of comps) { if (todos) delete n[c.id]; else if (saldoCobrable(c) > 0.005) n[c.id] = saldoCobrable(c) } return n })
  }
  const montoAnticipo = (p: PedidoCobro, contado = contadoPedidos.has(p.id)) => (contado ? round2(p.total * 0.9) : p.total)
  const toggleAnticipo = (p: PedidoCobro) => setUno(PEDIDO_PREFIX + p.id, sel[PEDIDO_PREFIX + p.id] !== undefined ? null : montoAnticipo(p))
  const toggleContado = (p: PedidoCobro) => {
    const next = new Set(contadoPedidos)
    if (next.has(p.id)) next.delete(p.id); else next.add(p.id)
    setContadoPedidos(next)
    if (sel[PEDIDO_PREFIX + p.id] !== undefined) setUno(PEDIDO_PREFIX + p.id, montoAnticipo(p, next.has(p.id)))
  }
  const clavesTodas = [...comprobantes.map((c) => c.id), ...pedidosSinFacturar.map((p) => PEDIDO_PREFIX + p.id)]
  const todoSeleccionado = clavesTodas.length > 0 && clavesTodas.every((k) => sel[k] !== undefined)
  const toggleTodo = () => {
    if (todoSeleccionado) return setSel({})
    setSel((prev) => { const n = { ...prev }; for (const c of comprobantes) n[c.id] = saldoCobrable(c); for (const p of pedidosSinFacturar) n[PEDIDO_PREFIX + p.id] = montoAnticipo(p); return n })
  }
  const toggleContadoTodo = () => {
    const activar = !contadoGeneral
    setContadoGeneral(activar)
    const next = new Set<string>(activar ? pedidosSinFacturar.map((p) => p.id) : [])
    setContadoPedidos(next)
    setSel((prev) => { const n = { ...prev }; for (const p of pedidosSinFacturar) if (n[PEDIDO_PREFIX + p.id] !== undefined) n[PEDIDO_PREFIX + p.id] = montoAnticipo(p, activar); return n })
  }

  // ── Clientes extra ──
  const resCli = useMemo(() => (busqCli.trim().length >= 2 ? buscarClientes(clientesTodos.filter((c) => c.id !== clienteId), busqCli, 8) : []), [clientesTodos, busqCli, clienteId])
  const agregarClienteExtra = (cli: ClienteBusqueda) => {
    setBusqCli("")
    if (cobrosExtra.some((c) => c.cliente.id === cli.id)) return
    const saldo = Number(cli.saldo_actual) || 0
    setCobrosExtra((prev) => [...prev, { cliente: cli, saldo, monto: saldo > 0 ? saldo : 0 }])
  }

  // ── Fotos → fila al instante → OCR en segundo plano (nunca bloquea) ──
  const setFila = (id: string, fn: (f: FilaCheque) => FilaCheque) => setMetodosPago((prev) => prev.map((m) => (m.id === id && esFila(m) ? fn(m) : m)))
  const leerFotos = (files: FileList | null, filaId?: string) => {
    if (!files?.length) return
    for (const file of Array.from(files)) {
      const id = filaId || uuidv4()
      const local = urlLocal(file)
      if (filaId) setFila(id, (f) => ({ ...f, ocr: { ...f.ocr, estado: "leyendo", foto_local: local, detalle: null } }))
      else
        setMetodosPago((prev) => {
          const nueva = filaDesdeFoto(id, local)
          // Un único efectivo vacío se reemplaza por lo que trae la foto (= web)
          const soloUnEfectivoVacio = prev.length === 1 && prev[0]!.tipo === "efectivo" && prev[0]!.monto === 0
          return soloUnEfectivoVacio ? [nueva] : [...prev, nueva]
        })
      void (async () => {
        const foto = await comprimirFoto(file)
        try {
          fotosLocales.current.set(id, { b64: await blobABase64(foto.blob), mime: foto.mime, nombre: foto.nombre })
        } catch { /* sin copia local: se intenta subir igual */ }
        if (!online) {
          if (vivo.current) setFila(id, (f) => marcarFotoAdjunta(f, null))
          return
        }
        try {
          const fd = new FormData()
          fd.append("files", foto.blob, foto.nombre)
          const d = await api.postForm<{ error?: string; archivos_por_indice?: Array<{ url?: string } | null>; archivos?: Array<{ url?: string }>; saneados?: ResultadoOcr[] }>("/api/pagos-clientes/ocr", fd, { timeoutMs: 45_000 })
          if (!vivo.current) return
          const url = d?.archivos_por_indice?.[0]?.url ?? d?.archivos?.[0]?.url ?? null
          if (url) fotosLocales.current.delete(id)
          const resultados = (d?.saneados || []).filter(resultadoConDatos)
          if (d?.error) setFila(id, (f) => marcarFalloOcr(f, url, d.error))
          else if (!resultados.length) setFila(id, (f) => marcarSinDatos(f, url))
          else {
            const [primero, ...resto] = resultados
            setMetodosPago((prev) => [
              ...prev.map((m) => (m.id === id && esFila(m) ? aplicarOcr(m, primero!, url) : m)),
              ...resto.map((r) => aplicarOcr(filaDesdeFoto(uuidv4(), null), r, url)),
            ])
          }
        } catch (e) {
          if (!vivo.current) return
          const motivo = e instanceof Error && /abort|timeout|tardó/i.test(e.name + e.message) ? "el servidor tardó demasiado" : "sin conexión"
          setFila(id, (f) => (fotosLocales.current.has(id) ? marcarFotoAdjunta(f, null) : marcarFalloOcr(f, null, motivo)))
        }
      })()
    }
  }

  // ── Registrar (= guardarCobro de la web) ──
  const guardarCobro = async (modoDiferencia?: "ajuste" | "saldo") => {
    if (guardandoRef.current || !data) return
    if (!puedeCobrar) return mostrar("El viaje no está activo.", "err")
    if (totalMetodos <= 0) return mostrar("Ingresá al menos un método de pago con monto.", "err")
    for (const m of metodosPago) {
      if (esFila(m) && m.monto > 0 && faltantes(m).length) return mostrar(`Al ${m.tipo === "cheque" ? "cheque" : "comprobante"}${m.numero_cheque ? " " + m.numero_cheque : ""} le falta: ${faltantes(m).join(", ")}.`, "err")
    }
    // Diferencia (mismo criterio que viajante / ERP): ajuste por redondeo (tope 1% de lo
    // imputado, oficina lo confirma al rendir) o dejar saldo pendiente / a cuenta.
    let ajusteRedondeo = 0
    if (Math.abs(diff) > 0.01 && totalImputado > 0) {
      if (!modoDiferencia) { setDialogoDiff(diff); dialogo.abrir(); return }
      if (modoDiferencia === "ajuste") {
        if (Math.abs(diff) > topeAjuste(totalImputado) + 0.005) return
        ajusteRedondeo = -diff // +falta = crédito, −sobra = débito
      }
    }
    guardandoRef.current = true
    setGuardando(true)
    try {
      const filas = metodosPago.filter(esFila)
      const payload: OpCobrar = {
        viaje_id: viajeId,
        cliente_id: clienteId,
        cliente_nombre: clienteNombre,
        monto_total: totalMetodos,
        metodos: metodosPago.filter((m) => m.monto > 0).map(metodoPayload),
        // Imputaciones = solo comprobantes reales. "pedido:<id>" son anticipos → quedan a cuenta.
        imputaciones: Object.entries(sel).filter(([k, monto]) => monto > 0 && !k.startsWith(PEDIDO_PREFIX)).map(([comprobante_id, monto_imputado]) => ({ comprobante_id, monto_imputado })),
        devolucion_ids: incluirDevoluciones ? devPendientes.map((d) => d.id) : [],
        comprobante_urls: urlsDeFotos(filas).map((url) => ({ url })),
        pedidos_contado: [...contadoPedidos],
        contado_general: contadoGeneral && bonificacionEstimada > 0,
        ajuste_redondeo: ajusteRedondeo,
        cobros_extra: cobrosExtra.filter((c) => c.monto > 0).map((c) => ({ cliente_id: c.cliente.id, cliente_nombre: nombreCliente(c.cliente), metodos: [{ tipo: "efectivo", monto: c.monto }], imputaciones: [] })),
        // Fotos que no llegaron al bucket (sin señal / OCR caído): las sube el servidor al aplicar el cobro
        fotos_pendientes: filas.filter((m) => !m.ocr.foto_url && fotosLocales.current.has(m.id)).map((m) => fotosLocales.current.get(m.id)!),
      }
      await encolar("viaje.cobrar", payload, `Cobro ${clienteNombre} ${formatCurrency(totalMetodos)}`)
      // BCRA en segundo plano: una consulta por cheque con CUIT válido, DESPUÉS del cobro en la
      // cola. El veredicto llega como aviso (AvisosBcra) aunque hoy no haya señal.
      for (const m of filas) {
        if (m.tipo !== "cheque" || !(m.monto > 0)) continue
        if (!cuitValido(m.cuit_emisor)) {
          dejarAvisoSinCuit({ banco: m.banco || null, numero_cheque: m.numero_cheque || null, monto: m.monto, cliente_nombre: clienteNombre }, m.cuit_emisor || null)
          continue
        }
        const consulta: ConsultaBcraPayload = { cuits: [m.cuit_emisor], banco: m.banco || null, numero_cheque: m.numero_cheque || null, monto: m.monto, cliente_nombre: clienteNombre }
        await encolar("bcra.consultar", consulta, `BCRA cheque ${m.numero_cheque || ""} ${clienteNombre}`.trim())
      }
      dejarAviso(online ? `✅ Cobro registrado por ${formatCurrency(totalMetodos)}. Se imputará al confirmar la rendición del viaje.` : `✅ Cobro por ${formatCurrency(totalMetodos)} guardado en el equipo: se envía al volver la señal.`)
      setListo(true)
    } catch {
      guardandoRef.current = false
      setGuardando(false)
      mostrar("No se pudo guardar el cobro en el equipo.", "err")
    }
  }

  if (!cargando && !data) {
    return (
      <Pantalla titulo="Registrar Cobro">
        <div className="flex flex-1 items-center justify-center p-8 text-center"><p className="text-xl text-red-500">No se encontraron datos del cliente.</p></div>
      </Pantalla>
    )
  }
  if (!data) return <Pantalla titulo="Registrar Cobro">{null}</Pantalla>

  // Fila de comprobante (función de render, no componente: los inputs no pierden el foco)
  const filaComprobante = (cp: ComprobanteCobro, dentroDePedido: boolean) => {
    const checked = sel[cp.id] !== undefined
    return (
      <div key={cp.id} className={`flex items-center gap-2 border-t px-3 py-2 text-sm ${checked ? "bg-blue-50" : ""} ${dentroDePedido ? "" : "first:border-t-0"}`}>
        <input type="checkbox" checked={checked} onChange={() => toggleComprobante(cp)} className="h-5 w-5 shrink-0" />
        <button onClick={() => toggleComprobante(cp)} className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-2 text-left">
          <span className="rounded border px-1 text-xs">{cp.tipo_comprobante}</span>
          <span className="font-mono text-xs">{cp.numero_comprobante}</span>
          <span className="text-[10px] text-gray-400">{cp.fecha ? cp.fecha.slice(0, 10).split("-").reverse().join("/") : ""}</span>
          {dtosHechos.has(cp.id) && <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">Dto. ctdo</span>}
          {(cp.en_cobro || 0) > 0.005 && <span className="text-[10px] font-bold text-sky-600">🔒 {fmt(cp.en_cobro!)} en un cobro sin enviar</span>}
          <span className="ml-auto font-mono text-orange-600">saldo ${fmt(saldoCobrable(cp))}</span>
        </button>
        {checked ? (
          <input
            type="number" inputMode="decimal" min={0} max={saldoCobrable(cp)} step="0.01" value={sel[cp.id]}
            onChange={(e) => setUno(cp.id, Math.min(Math.max(0, parseFloat(e.target.value) || 0), saldoCobrable(cp)))}
            className="min-h-10 w-28 rounded-lg border border-gray-300 px-2 text-right text-sm"
          />
        ) : (
          <span className="w-28 text-right text-gray-400">—</span>
        )}
      </div>
    )
  }

  const nadaQueCobrar = pedidos.length === 0 && sinPedido.length === 0

  return (
    <Pantalla
      titulo="Registrar Cobro"
      dataset={DS.clientesViaje}
      etiquetaFrescura="Ficha al"
      pie={
        <div className="border-t border-gray-200 bg-white p-4">
          {Math.abs(diff) > 0.01 && totalImputado > 0 && (
            <p className={`mb-2 rounded-xl px-4 py-2 text-center text-sm font-medium ${diff < 0 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
              {diff < 0 ? `Faltan ${formatCurrency(Math.abs(diff))}` : `Sobran ${formatCurrency(diff)}`}
              <span className="block text-xs font-normal opacity-80">Al registrar elegís: ajuste por redondeo o dejar el saldo.</span>
            </p>
          )}
          <button onClick={() => void guardarCobro()} disabled={guardando || totalMetodos <= 0 || !puedeCobrar} className="min-h-14 w-full rounded-2xl bg-blue-600 py-4 text-xl font-bold text-white active:scale-95 disabled:opacity-50">
            {guardando ? "Guardando..." : `Registrar Cobro de ${formatCurrency(totalMetodos)}`}
          </button>
        </div>
      }
    >
      {toast}
      {hojaDescartar}
      <p className="truncate bg-blue-700 px-5 pb-3 text-sm text-blue-200">{clienteNombre}</p>
      {!puedeCobrar && <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-center text-sm text-amber-800">El viaje no está activo: no se pueden registrar cobros.</div>}
      {data.parcial && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          ⚠ La cuenta de este cliente todavía no está en el equipo: lo que cobres queda <b>a cuenta</b> (sin imputar a comprobantes). {online ? "Se está descargando…" : "Con señal se completa sola."}
        </div>
      )}
      <AvisosBcra />

      <div className="space-y-5 p-4">
        {/* ══ Pedidos y comprobantes a cobrar ══ */}
        <section>
          <h3 className="mb-3 font-bold text-gray-700">Pedidos / comprobantes a cobrar</h3>
          {!descargada && data.parcial ? (
            <SinDescargar que="la cuenta del cliente" />
          ) : nadaQueCobrar ? (
            <div className="py-4 text-center text-sm text-gray-500">No hay pedidos ni comprobantes pendientes para este cliente</div>
          ) : (
            <div className="space-y-2">
              {clavesTodas.length > 0 && (
                <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                  <label className="flex min-h-11 items-center gap-2 font-semibold"><input type="checkbox" checked={todoSeleccionado} onChange={toggleTodo} className="h-5 w-5" /> Seleccionar todo</label>
                  <label className="ml-auto flex min-h-11 items-center gap-2 text-amber-800"><input type="checkbox" checked={contadoGeneral} onChange={toggleContadoTodo} className="h-5 w-5" /> 10% contado a todo</label>
                </div>
              )}
              {pedidos.map((ped) => {
                const comps = compsPorPedido.get(ped.id) || []
                const facturado = comps.length > 0
                const anticipoSel = sel[PEDIDO_PREFIX + ped.id] !== undefined
                const todosCompsSel = facturado && comps.every((c) => sel[c.id] !== undefined)
                const algunoSel = comps.some((c) => sel[c.id] !== undefined)
                const abierto = expandido === ped.id
                if (esSaldado(ped))
                  return (
                    <div key={ped.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 text-slate-400">
                      <span className="w-5" />
                      <span className="text-sm font-semibold">Pedido #{ped.numero_pedido}</span>
                      <span className="text-xs">{formatDateAR(ped.fecha)}</span>
                      <span className="rounded border border-green-200 bg-green-50 px-1.5 text-[10px] text-green-700">Saldado</span>
                      <span className="ml-auto font-mono text-sm">${fmt(ped.total)}</span>
                    </div>
                  )
                return (
                  <div key={ped.id} className={`rounded-lg border ${anticipoSel || algunoSel ? "border-blue-300 bg-blue-50/40" : "border-gray-200 bg-white"}`}>
                    <div className="flex items-center gap-2 p-2.5">
                      <input type="checkbox" checked={facturado ? todosCompsSel : anticipoSel} onChange={() => (facturado ? togglePedidoCompleto(comps) : toggleAnticipo(ped))} className="h-5 w-5 shrink-0" />
                      <button onClick={() => facturado && setExpandido(abierto ? "" : ped.id)} disabled={!facturado} className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-left">
                        <span className="w-4 text-gray-400">{facturado ? (abierto ? "▾" : "▸") : ""}</span>
                        <span className="text-sm font-semibold">Pedido #{ped.numero_pedido}</span>
                        <span className="text-xs text-gray-400">{formatDateAR(ped.fecha)}</span>
                        {facturado ? (
                          <span className="rounded border px-1.5 text-[10px]">{comps.length} comprob.</span>
                        ) : (
                          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 text-[10px] text-amber-700">Sin facturar (anticipo)</span>
                        )}
                        {ped.anticipo_pago_id && !facturado && <span className="rounded border border-gray-200 bg-gray-100 px-1.5 text-[10px] text-gray-600">ya anticipado</span>}
                      </button>
                      {!facturado && (
                        <label className="mr-1 flex min-h-11 items-center gap-1 text-[11px] text-amber-700"><input type="checkbox" checked={contadoPedidos.has(ped.id)} onChange={() => toggleContado(ped)} className="h-5 w-5" /> 10%</label>
                      )}
                      <span className="font-mono text-sm">${fmt(facturado ? comps.reduce((s, c) => s + saldoCobrable(c), 0) : montoAnticipo(ped))}</span>
                    </div>
                    {facturado && abierto && <div className="border-t bg-white">{comps.map((c) => filaComprobante(c, true))}</div>}
                  </div>
                )
              })}
              {sinPedido.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white">
                  <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold text-gray-500">
                    <input type="checkbox" checked={sinPedido.every((c) => sel[c.id] !== undefined)} onChange={() => togglePedidoCompleto(sinPedido)} className="h-5 w-5" title="Seleccionar todos" />
                    <span>Otros comprobantes</span>
                    <span className="ml-auto font-mono text-orange-600">saldo ${fmt(sinPedido.reduce((s, c) => s + saldoCobrable(c), 0))}</span>
                  </div>
                  {sinPedido.map((c) => filaComprobante(c, false))}
                </div>
              )}
              {Object.keys(sel).length > 0 && (
                <div className="flex justify-end pt-1 text-sm font-semibold">Total a pagar: <span className="ml-2 text-blue-700">${fmt(totalImputado)}</span></div>
              )}
            </div>
          )}
          {bonificacionEstimada > 0 && (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">10% contado: −{formatCurrency(bonificacionEstimada)} (la NC sale al confirmar la rendición)</p>
          )}
        </section>

        {/* ══ Agregar cliente para cobrar (cobro conjunto en la calle) ══ */}
        <section>
          <h3 className="mb-2 font-bold text-gray-700">Agregar cliente para cobrar</h3>
          <input type="search" value={busqCli} onChange={(e) => setBusqCli(e.target.value)} placeholder="Buscar cliente por nombre o CUIT..." className="min-h-11 w-full rounded-xl border-2 border-gray-200 px-3 py-2.5 text-sm" />
          {busqCli.trim().length >= 2 && clientesTodos.length === 0 && <p className="mt-1 text-xs text-amber-700">La lista de clientes todavía no se descargó en este equipo.</p>}
          {resCli.length > 0 && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border">
              {resCli.map((cli) => (
                <button key={cli.id} onClick={() => agregarClienteExtra(cli)} className="w-full border-b px-3 py-2 text-left last:border-0 active:bg-blue-50">
                  <p className="text-sm font-medium">{nombreCliente(cli)}</p>
                  <p className="text-xs text-gray-400">{cli.direccion || ""}{cli.localidad ? ` · ${cli.localidad}` : ""}{cli.saldo_actual > 0 ? ` · debe ${formatCurrency(cli.saldo_actual)}` : ""}</p>
                </button>
              ))}
            </div>
          )}
          {cobrosExtra.map((ce, idx) => (
            <div key={ce.cliente.id} className="mt-2 rounded-xl bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{nombreCliente(ce.cliente)}</p>
                  <p className="text-xs text-gray-400">Saldo: {formatCurrency(ce.saldo)}</p>
                </div>
                <button onClick={() => setCobrosExtra((p) => p.filter((_, i) => i !== idx))} className="min-h-10 px-2 text-lg text-red-500">×</button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gray-500">Cobrar (efectivo):</span>
                <input type="number" inputMode="decimal" value={ce.monto || 0} onChange={(e) => setCobrosExtra((p) => p.map((c, i) => (i === idx ? { ...c, monto: Number(e.target.value) || 0 } : c)))} className="min-h-10 flex-1 rounded-lg border-2 border-gray-200 px-2 py-1 text-right font-bold" />
              </div>
            </div>
          ))}
        </section>

        {/* Toggle devoluciones */}
        {devPendientes.length > 0 && (
          <div className="rounded-2xl bg-amber-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-amber-800">Incluir devoluciones como crédito</p>
                <p className="text-sm text-amber-600">{formatCurrency(devPendientes.reduce((s, d) => s + Number(d.monto_total), 0))}{devPendientes.some((d) => d.local) ? " (incluye una sin enviar)" : ""}</p>
              </div>
              <button onClick={() => setIncluirDevoluciones((p) => !p)} className={`h-7 w-14 rounded-full ${incluirDevoluciones ? "bg-green-500" : "bg-gray-300"}`} aria-label="Incluir devoluciones">
                <span className={`mx-1 block h-5 w-5 rounded-full bg-white shadow ${incluirDevoluciones ? "translate-x-7" : ""}`} />
              </button>
            </div>
          </div>
        )}

        {/* Total */}
        <div className="rounded-2xl bg-blue-50 px-4 py-4 text-center">
          <p className="text-sm text-blue-600">Total a cobrar</p>
          <p className="text-3xl font-bold text-blue-800">{formatCurrency(totalCobro)}</p>
        </div>

        {/* ══ Forma de pago ══ */}
        <div className="space-y-2">
          <div className="flex items-center gap-2"><div className="h-px flex-1 bg-gray-200" /><span className="text-xs font-medium text-gray-400">FORMA DE PAGO</span><div className="h-px flex-1 bg-gray-200" /></div>
          <button onClick={() => fileInputRef.current?.click()} className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-blue-400 bg-blue-50 py-4 text-lg font-bold text-blue-700 active:scale-95">
            📷 Sacar foto a cheques / transferencias
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={(e) => { leerFotos(e.target.files); e.target.value = "" }} />
          <p className="text-center text-xs text-gray-500">
            {online
              ? "La foto abre el cheque al instante; los datos se completan solos en unos segundos y siempre se pueden corregir."
              : "📡 Sin señal: la foto queda guardada en el equipo y sube con el cobro. Cargá los datos a mano."}
          </p>
        </div>

        <div className="space-y-3">
          {metodosPago.map((m, idx) => (
            <MetodoPagoCard
              key={m.id}
              metodo={m}
              cuentas={cuentas}
              onChange={(updates) => setMetodosPago((prev) => prev.map((x, i) => (i === idx ? aplicarCambios(x, updates) : x)))}
              onRemove={metodosPago.length > 1 ? () => setMetodosPago((p) => p.filter((_, i) => i !== idx)) : undefined}
              onFoto={(files) => leerFotos(files, esFila(m) ? m.id : undefined)}
            />
          ))}
          <button onClick={() => setMetodosPago((p) => [...p, { id: uuidv4(), tipo: "efectivo", monto: 0 }])} className="min-h-12 w-full rounded-xl border-2 border-dashed border-gray-300 py-3 font-medium text-gray-500">
            + Agregar método de pago
          </button>
        </div>
      </div>

      {/* ══ Diálogo diferencia (overlay con historial: atrás lo cierra) ══ */}
      {dialogo.abierto && dialogoDiff !== null && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/60" onClick={dialogo.cerrar}>
          <div className="w-full space-y-3 rounded-t-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-center text-lg font-bold">{dialogoDiff < 0 ? `Faltan ${formatCurrency(Math.abs(dialogoDiff))}` : `Sobran ${formatCurrency(dialogoDiff)}`}</h3>
            {Math.abs(dialogoDiff) <= topeAjuste(totalImputado) + 0.005 ? (
              <button onClick={() => void guardarCobro("ajuste")} disabled={guardando} className="min-h-12 w-full rounded-2xl bg-blue-600 py-4 font-bold text-white disabled:opacity-50">
                Ajuste por redondeo {dialogoDiff < 0 ? "(se le perdona)" : "(no queda a favor)"} — oficina lo confirma al rendir
              </button>
            ) : (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
                La diferencia supera el 1% de lo imputado ({formatCurrency(topeAjuste(totalImputado))}): no se ajusta desde la calle.
              </p>
            )}
            <button onClick={() => void guardarCobro("saldo")} disabled={guardando} className="min-h-12 w-full rounded-2xl border-2 border-gray-300 py-4 font-bold text-gray-700 disabled:opacity-50">
              {dialogoDiff < 0 ? "Dejar el saldo pendiente" : "Dejar el sobrante a cuenta del cliente"}
            </button>
            <button onClick={dialogo.cerrar} className="min-h-11 w-full py-2 text-sm text-gray-400">Volver</button>
          </div>
        </div>
      )}
    </Pantalla>
  )
}

// ─── Card de método de pago (= web) ───────────────────────────────────────────
// Efectivo: solo monto. Cheque/transferencia: fila de lib/cheques con foto, campos del
// OCR resaltados en ámbar (hasta que el chofer los pisa). Transferencia: cuenta destino
// (la web del chofer no la tenía y `faltantes()` la exige: bug de la web, anotado).

function MetodoPagoCard({ metodo, cuentas, onChange, onRemove, onFoto }: {
  metodo: MetodoPago
  cuentas: Array<{ id: string; banco: string; nombre: string; alias: string | null }>
  onChange: (updates: CambiosMetodo) => void
  onRemove?: () => void
  onFoto: (files: FileList) => void
}) {
  const fotoRef = useRef<HTMLInputElement>(null)
  const fila = esFila(metodo) ? metodo : null
  return (
    <div className="space-y-3 rounded-2xl border-2 border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 flex-wrap gap-1">
          {(["efectivo", "transferencia", "cheque"] as const).map((t) => (
            <button key={t} onClick={() => onChange({ tipo: t })} className={`min-h-11 rounded-xl border-2 px-3 py-2 text-sm font-bold ${metodo.tipo === t ? "border-blue-600 bg-blue-600 text-white" : "border-gray-200 text-gray-500"}`}>
              {t === "efectivo" ? "💵" : t === "transferencia" ? "🏦" : "📄"} {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {onRemove && <button onClick={onRemove} aria-label="Quitar" className="ml-1 min-h-11 min-w-11 text-xl text-red-400">×</button>}
      </div>
      <div>
        <label className="mb-1 block text-xs text-gray-500">Monto</label>
        <input
          type="number" inputMode="decimal" value={metodo.monto || ""} onChange={(e) => onChange({ monto: Number(e.target.value) })} placeholder="0.00"
          className={`min-h-12 w-full rounded-xl border-2 px-4 py-3 text-center text-2xl font-bold focus:border-blue-500 focus:outline-none ${fila ? clsOcr(fila, "monto", "border-gray-200") : "border-gray-200"}`}
        />
      </div>
      {fila && (
        <div className="space-y-2">
          <button onClick={() => fotoRef.current?.click()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 py-3 text-sm font-medium text-gray-500">
            📷 {fila.ocr.estado === "sin_foto" ? (fila.tipo === "cheque" ? "Sacar foto a este cheque" : "Sacar foto al comprobante") : "Sacar otra foto"}
          </button>
          <input ref={fotoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { if (e.target.files?.length) onFoto(e.target.files); e.target.value = "" }} />
          <EstadoFoto fila={fila} />
          {fila.tipo === "cheque" ? (
            <>
              <input type="text" placeholder="Banco" value={fila.banco} onChange={(e) => onChange({ banco: e.target.value })} className={clsOcr(fila, "banco", CLS_INPUT)} />
              <input type="text" inputMode="numeric" placeholder="Número de cheque" value={fila.numero_cheque} onChange={(e) => onChange({ numero_cheque: e.target.value })} className={clsOcr(fila, "numero_cheque", CLS_INPUT)} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Fecha emisión</label>
                  <input type="date" value={fila.fecha_emision} onChange={(e) => onChange({ fecha_emision: e.target.value })} className={clsOcr(fila, "fecha_emision", "min-h-11 w-full rounded-xl border-2 px-3 py-2 border-gray-200")} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Fecha vencimiento</label>
                  <input type="date" value={fila.fecha_cheque} onChange={(e) => onChange({ fecha_cheque: e.target.value })} className={clsOcr(fila, "fecha_cheque", "min-h-11 w-full rounded-xl border-2 px-3 py-2 border-gray-200")} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">CUIT emisor</label>
                <input type="text" inputMode="numeric" placeholder="XX-XXXXXXXX-X" value={fila.cuit_emisor} onChange={(e) => onChange({ cuit_emisor: e.target.value })} className={`min-h-11 w-full rounded-xl border-2 px-4 py-3 font-mono text-base ${clsOcr(fila, "cuit_emisor", "border-gray-200")}`} />
              </div>
              {!cuitValido(fila.cuit_emisor) ? (
                <p className="text-xs font-medium text-amber-700">
                  {fila.cuit_emisor ? "⚠️ El CUIT no cierra (dígito verificador): revisalo en el cheque." : "⚠️ Sin CUIT: este cheque no se consulta en el BCRA (queda sin control de riesgo)."}
                </p>
              ) : (
                <p className="text-xs text-gray-500">Al registrar, el CUIT se consulta en el BCRA en segundo plano; el resultado llega como aviso.</p>
              )}
              <label className="flex min-h-11 items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={fila.es_echeq} onChange={(e) => onChange({ es_echeq: e.target.checked })} className="h-5 w-5" /> Es e-cheq
              </label>
            </>
          ) : (
            <>
              <select value={fila.cuenta_bancaria_id} onChange={(e) => onChange({ cuenta_bancaria_id: e.target.value })} className="min-h-11 w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2 text-sm">
                <option value="">Cuenta destino *</option>
                {cuentas.map((cb) => (
                  <option key={cb.id} value={cb.id}>{cb.banco}{cb.alias ? ` (${cb.alias})` : ""}</option>
                ))}
              </select>
              <input type="text" placeholder="Número de comprobante / referencia" value={fila.referencia_transferencia} onChange={(e) => onChange({ referencia_transferencia: e.target.value })} className={CLS_INPUT} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
