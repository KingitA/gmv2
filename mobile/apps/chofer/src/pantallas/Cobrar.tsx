import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router"
import { indiceHistorial, useOnline, useOverlay, useParamEstado, useRuntime } from "@gm/core"
import {
  aplicarOcr, cuitValido, editarCampo, faltantes, filaDesdeFoto, filaVacia, marcarFalloOcr, marcarFotoAdjunta, marcarSinDatos, resultadoConDatos, urlsDeFotos,
  type CampoCheque, type ConsultaBcraPayload, type FilaCheque, type ResultadoOcr,
} from "@gm/cheques"
import { blobABase64, comprimirFoto, urlLocal } from "@gm/cheques/foto"
import { ofreceAjuste, topeAjuste } from "@gm/cobro"
import { montoDelPrincipal, validarCobroConjunto } from "@gm/cobro/conjunto"
import { DS, ESTADOS_COBRABLES, idClienteViaje, nombreCliente, type ClienteBusqueda, type MetodoPayload, type OpCobrar } from "../datasets"
import { estadoCuentaVacio, resumenCuenta, type EstadoCuenta, type ResumenCuenta } from "../datos/cuenta-cobro"
import { buscarClientes, useClienteViaje, useClientesTodos, useCuentasBancarias, useEncolar, useRefrescarFilas, useViaje, uuidv4 } from "../datos/hooks"
import { SelectorCuenta } from "./SelectorCuenta"
import { normalizarCuit } from "@gm/formato"
import { AvisosBcra, CuitInput, dejarAviso, dejarAvisoSinCuit, FechaInput, formatCurrency, formatDateAR, MontoInput, Pantalla, round2, SinDescargar, useBloqueoSalida, useBusqueda, useToast } from "../ui"

// Cobro en el reparto (= el sheet "Registrar Cobro" de la ficha web, ahora ruta propia).
//  · Pedidos / comprobantes a cobrar (incluye anticipos a pedidos sin facturar): lo que
//    components/pagos/ComprobantesSelector leía con supabase-js, ahora replicado en la ficha.
//  · COBRO CONJUNTO: se agregan otros clientes y a cada uno se le ve su cuenta COMPLETA, igual que
//    la del principal (pedidos, comprobantes, 10 %, devoluciones); los medios de pago se reparten
//    entre todos (lib/cobranzas/cobro-conjunto.ts). Caso real: un cheque único que paga dos
//    locales. Un cliente del viaje se cobra completo sin señal; uno de afuera, solo con señal.
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
      ? { tipo: "cheque", monto: m.monto, banco_emisor: m.banco, numero_cheque: m.numero_cheque, fecha_cheque: m.fecha_cheque, fecha_emision: m.fecha_emision || undefined, cuit_emisor: normalizarCuit(m.cuit_emisor) ?? undefined, color_cheque: m.es_echeq ? "ECHEQ" : undefined }
      : { tipo: "transferencia", monto: m.monto, numero_comprobante: m.referencia_transferencia || undefined, cuenta_bancaria_id: m.cuenta_bancaria_id || undefined }
    : { tipo: "efectivo", monto: m.monto }

/** La hoja de ruta se posiciona en esta parada al volver (sessionStorage). */
export const CLAVE_VOLVER_A_PARADA = "gm.chofer.volverAParada"

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

/** Cliente agregado al cobro conjunto, con lo que se eligió cobrarle. */
interface Agregado { cliente: ClienteBusqueda; estado: EstadoCuenta }

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

  // ── Qué paga el cliente de la parada ──
  const [cuenta, setCuenta] = useState<EstadoCuenta>(estadoCuentaVacio)
  const [expandido, setExpandido] = useParamEstado("abierto")
  // ── Clientes agregados (cobro conjunto): cada uno con su propia cuenta ──
  const [agregados, setAgregados] = useState<Agregado[]>([])
  const [resumenes, setResumenes] = useState<Record<string, ResumenCuenta>>({})
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

  // ── Totales ──
  const r = useMemo(() => resumenCuenta(data && !data.parcial ? data : null, cuenta), [data, cuenta])
  const totalAgregados = round2(agregados.reduce((s, a) => s + (resumenes[a.cliente.id]?.totalCobro || 0), 0))
  const totalCobro = round2(r.totalCobro + totalAgregados)
  const totalMetodos = round2(metodosPago.reduce((s, m) => s + Number(m.monto || 0), 0))
  const diff = round2(totalMetodos - totalCobro)

  const clienteNombre = data?.cliente?.razon_social || data?.cliente?.nombre || "Cliente"
  const estadoViaje = viaje?.viaje.estado || data?.viaje_estado || ""
  const puedeCobrar = ESTADOS_COBRABLES.includes(estadoViaje)

  const sucio = !listo && (totalMetodos > 0 || r.haySeleccion || agregados.length > 0 || metodosPago.some(esFila))
  const { hoja: hojaDescartar } = useBloqueoSalida(sucio, { titulo: "¿Descartar el cobro?", detalle: "Lo cargado en esta pantalla no se registró todavía.", confirmar: "Descartar" })

  // Diálogo abierto sin diferencia (recarga o se corrigió el monto): no corresponde
  useEffect(() => {
    if (dialogo.abierto && (dialogoDiff === null || Math.abs(diff) <= 0.01) && !guardandoRef.current) dialogo.cerrar()
  }, [dialogo, dialogoDiff, diff])
  // Registrado: volver a donde se entró (la ficha, o la parada de la hoja de ruta si se cobró desde
  // el viaje), sin dejar el formulario ni el diálogo en el historial. Convención §8: atrás = la
  // pantalla anterior. Abierto sin historial ⇒ padre lógico (la ficha), con replace.
  useEffect(() => {
    if (!listo) return
    try { sessionStorage.setItem(CLAVE_VOLVER_A_PARADA, clienteId) } catch { /* noop */ }
    const pasos = dialogo.abierto && (location.state as { overlay?: boolean } | null)?.overlay ? 2 : 1
    if (indiceHistorial() >= pasos) navigate(-pasos)
    else navigate(`/viajes/${viajeId}/clientes/${clienteId}`, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo])

  // ── Clientes agregados ──
  const resCli = useMemo(
    () => (busqCli.trim().length >= 2 ? buscarClientes(clientesTodos.filter((c) => c.id !== clienteId && !agregados.some((a) => a.cliente.id === c.id)), busqCli, 8) : []),
    [clientesTodos, busqCli, clienteId, agregados],
  )
  const agregarCliente = (cli: ClienteBusqueda) => {
    setBusqCli("")
    setAgregados((prev) => (prev.some((a) => a.cliente.id === cli.id) ? prev : [...prev, { cliente: cli, estado: estadoCuentaVacio() }]))
  }
  const quitarCliente = (id: string) => {
    setAgregados((prev) => prev.filter((a) => a.cliente.id !== id))
    setResumenes((prev) => { const n = { ...prev }; delete n[id]; return n })
  }
  const cambiarAgregado = useCallback((id: string, estado: EstadoCuenta) => setAgregados((prev) => prev.map((a) => (a.cliente.id === id ? { ...a, estado } : a))), [])
  const informarResumen = useCallback((id: string, res: ResumenCuenta) => setResumenes((prev) => (JSON.stringify(prev[id]) === JSON.stringify(res) ? prev : { ...prev, [id]: res })), [])

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
    // Cobro conjunto: a cada cliente agregado se le cobra EXACTAMENTE lo que suma su cuenta; lo
    // que falte o sobre es siempre del cliente de la parada.
    const extras = agregados.map((a) => ({ a, res: resumenes[a.cliente.id] }))
    const sinImporte = extras.find((x) => !(x.res && x.res.totalCobro > 0))
    if (sinImporte) return mostrar(`${nombreCliente(sinImporte.a.cliente)} no tiene nada para cobrar: seleccioná qué se le cobra o quitalo.`, "err")
    const motivo = validarCobroConjunto(clienteId, totalMetodos, extras.map((x) => ({ cliente_id: x.a.cliente.id, monto: x.res!.totalCobro })))
    if (motivo) return mostrar(motivo, "err")
    // Diferencia (mismo criterio que viajante / ERP): ajuste por redondeo (tope 1% de lo
    // imputado, oficina lo confirma al rendir) o dejar saldo pendiente / a cuenta.
    let ajusteRedondeo = 0
    if (Math.abs(diff) > 0.01 && r.totalImputado > 0) {
      if (!modoDiferencia) { setDialogoDiff(diff); dialogo.abrir(); return }
      // +falta = crédito (tope 1 %), −sobra = débito. El sobrante nunca bloquea: si supera el
      // 1 % no se ofrece como ajuste y queda a cuenta del cliente.
      if (modoDiferencia === "ajuste") {
        if (!ofreceAjuste(diff, r.totalImputado)) { if (diff < 0) return } else ajusteRedondeo = -diff
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
        imputaciones: r.imputaciones,
        devolucion_ids: r.devolucion_ids,
        comprobante_urls: urlsDeFotos(filas).map((url) => ({ url })),
        pedidos_contado: r.pedidos_contado,
        pedidos_anticipo: r.pedidos_anticipo,
        contado_general: r.contado_general,
        ajuste_redondeo: ajusteRedondeo,
        cobros_extra: [],
        // Clientes agregados: cada uno con SU selección; el servidor reparte los medios de pago
        ...(extras.length
          ? {
              clientes_extra: extras.map((x) => ({
                cliente_id: x.a.cliente.id,
                cliente_nombre: nombreCliente(x.a.cliente),
                monto: x.res!.totalCobro,
                imputaciones: x.res!.imputaciones,
                devolucion_ids: x.res!.devolucion_ids,
                pedidos_contado: x.res!.pedidos_contado,
                pedidos_anticipo: x.res!.pedidos_anticipo,
                contado_general: x.res!.contado_general,
              })),
            }
          : {}),
        // Fotos que no llegaron al bucket (sin señal / OCR caído): las sube el servidor al aplicar el cobro
        fotos_pendientes: filas.filter((m) => !m.ocr.foto_url && fotosLocales.current.has(m.id)).map((m) => fotosLocales.current.get(m.id)!),
      }
      const quienes = extras.length ? `${clienteNombre} + ${extras.length} más` : clienteNombre
      await encolar("viaje.cobrar", payload, `Cobro ${quienes} ${formatCurrency(totalMetodos)}`)
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
      const detalle = extras.length ? ` repartido entre ${extras.length + 1} clientes` : ""
      dejarAviso(online ? `✅ Cobro registrado por ${formatCurrency(totalMetodos)}${detalle}. Se imputará al confirmar la rendición del viaje.` : `✅ Cobro por ${formatCurrency(totalMetodos)}${detalle} guardado en el equipo: se envía al volver la señal.`)
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

  const principalCobra = agregados.length ? montoDelPrincipal(totalMetodos, agregados.map((a) => resumenes[a.cliente.id]?.totalCobro || 0)) : totalMetodos

  return (
    <Pantalla
      titulo="Registrar Cobro"
      dataset={DS.clientesViaje}
      etiquetaFrescura="Ficha al"
      pie={
        <div className="border-t border-gray-200 bg-white p-4">
          {Math.abs(diff) > 0.01 && r.totalImputado > 0 && (
            <p className={`mb-2 rounded-xl px-4 py-2 text-center text-sm font-medium ${diff < 0 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
              {diff < 0 ? `Faltan ${formatCurrency(Math.abs(diff))}` : `Sobran ${formatCurrency(diff)}`}
              <span className="block text-xs font-normal opacity-80">{diff < 0 ? "Al registrar elegís: ajuste por redondeo o dejar el saldo pendiente." : "Al registrar elegís: dejarlo a cuenta del cliente o, si es chico, ajuste por redondeo."}{agregados.length ? ` La diferencia es de ${clienteNombre}.` : ""}</span>
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
        {/* ══ Pedidos y comprobantes a cobrar (cliente de la parada) ══ */}
        <section>
          <h3 className="mb-3 font-bold text-gray-700">Pedidos / comprobantes a cobrar</h3>
          {!descargada && data.parcial ? (
            <SinDescargar que="la cuenta del cliente" />
          ) : (
            <SelectorCuenta datos={data} estado={cuenta} onChange={setCuenta} expandido={expandido} onExpandir={setExpandido} />
          )}
        </section>

        {/* ══ Agregar cliente para cobrar (cobro conjunto en la calle) ══ */}
        <section>
          <h3 className="mb-1 font-bold text-gray-700">Agregar cliente para cobrar</h3>
          <p className="mb-2 text-xs text-gray-500">Un mismo pago (por ejemplo, un cheque) puede cubrir a más de un cliente: agregalo y elegí qué se le cobra.</p>
          <input type="search" value={busqCli} onChange={(e) => setBusqCli(e.target.value)} placeholder="Buscar cliente por nombre o CUIT..." className="min-h-11 w-full rounded-xl border-2 border-gray-200 px-3 py-2.5 text-sm" />
          {busqCli.trim().length >= 2 && clientesTodos.length === 0 && <p className="mt-1 text-xs text-amber-700">La lista de clientes todavía no se descargó en este equipo.</p>}
          {resCli.length > 0 && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border">
              {resCli.map((cli) => (
                <button key={cli.id} onClick={() => agregarCliente(cli)} className="w-full border-b px-3 py-2 text-left last:border-0 active:bg-blue-50">
                  <p className="text-sm font-medium">{nombreCliente(cli)}</p>
                  <p className="text-xs text-gray-400">{cli.direccion || ""}{cli.localidad ? ` · ${cli.localidad}` : ""}{cli.saldo_actual > 0 ? ` · debe ${formatCurrency(cli.saldo_actual)}` : ""}</p>
                </button>
              ))}
            </div>
          )}
          {agregados.map((a) => (
            <CuentaAgregada key={a.cliente.id} viajeId={viajeId} agregado={a} online={online} onEstado={cambiarAgregado} onResumen={informarResumen} onQuitar={quitarCliente} />
          ))}
        </section>

        {/* Total */}
        <div className="rounded-2xl bg-blue-50 px-4 py-4 text-center">
          <p className="text-sm text-blue-600">Total a cobrar</p>
          <p className="text-3xl font-bold text-blue-800">{formatCurrency(totalCobro)}</p>
          {agregados.length > 0 && (
            <p className="mt-1 text-xs text-blue-700">
              {clienteNombre}: {formatCurrency(r.totalCobro)} · clientes agregados: {formatCurrency(totalAgregados)}
              {totalMetodos > 0 && <span className="block">De lo entregado, a {clienteNombre} le quedan {formatCurrency(principalCobra)}.</span>}
            </p>
          )}
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
              onRemove={() => setMetodosPago((p) => { const r = p.filter((_, i) => i !== idx); return r.length ? r : [{ id: uuidv4(), tipo: "efectivo", monto: 0 }] })}
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
            {/* El tope del 1 % es solo para PERDONAR saldo. El sobrante nunca bloquea: chico ⇒ se
                puede ajustar; grande ⇒ queda a cuenta del cliente. */}
            {ofreceAjuste(dialogoDiff, r.totalImputado) ? (
              <button onClick={() => void guardarCobro("ajuste")} disabled={guardando} className="min-h-12 w-full rounded-2xl bg-blue-600 py-4 font-bold text-white disabled:opacity-50">
                Ajuste por redondeo {dialogoDiff < 0 ? "(se le perdona)" : "(no queda a favor)"} — oficina lo confirma al rendir
              </button>
            ) : dialogoDiff < 0 ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
                Lo que falta supera el 1% de lo seleccionado ({formatCurrency(topeAjuste(r.totalImputado))}): no se perdona desde la calle.
              </p>
            ) : null}
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

// ─── Cliente agregado al cobro conjunto ───────────────────────────────────────
// Su cuenta COMPLETA, igual que la del principal. Sale de la misma réplica (chofer_viaje_clientes):
// si el cliente es otra parada del viaje ya está en el equipo y se cobra sin señal; si es de afuera
// del viaje, se pide al servidor al agregarlo y hace falta señal (queda dicho en pantalla).
function CuentaAgregada({ viajeId, agregado, online, onEstado, onResumen, onQuitar }: {
  viajeId: string
  agregado: Agregado
  online: boolean
  onEstado: (id: string, e: EstadoCuenta) => void
  onResumen: (id: string, r: ResumenCuenta) => void
  onQuitar: (id: string) => void
}) {
  const id = agregado.cliente.id
  useRefrescarFilas(DS.clientesViaje, [idClienteViaje(viajeId, id)])
  const { cliente: datos } = useClienteViaje(viajeId, id)
  const [abierto, setAbierto] = useState("")
  const completa = !!datos && !datos.parcial
  const res = useMemo(() => resumenCuenta(completa ? datos : null, agregado.estado), [completa, datos, agregado.estado])
  useEffect(() => { onResumen(id, res) }, [id, res, onResumen])
  const nombre = nombreCliente(agregado.cliente)
  return (
    <div className="mt-3 rounded-2xl border-2 border-blue-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold text-gray-800">➕ {nombre}</p>
          <p className="truncate text-xs text-gray-400">{agregado.cliente.direccion || ""}{agregado.cliente.localidad ? ` · ${agregado.cliente.localidad}` : ""}</p>
        </div>
        <button onClick={() => onQuitar(id)} className="min-h-11 shrink-0 px-2 text-xl text-red-500" aria-label={`Quitar a ${nombre}`}>×</button>
      </div>
      <div className="mt-2">
        {completa ? (
          <SelectorCuenta datos={datos} estado={agregado.estado} onChange={(e) => onEstado(id, e)} expandido={abierto} onExpandir={setAbierto} />
        ) : (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {online
              ? "⏳ Descargando la cuenta de este cliente…"
              : "📡 Sin señal: la cuenta de un cliente que no está en este viaje se ve solo con señal. Podés tomarle plata a cuenta (sin imputar) y oficina la imputa después."}
          </p>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-gray-500">A cuenta (sin imputar):</span>
        <MontoInput
          valor={agregado.estado.aCuenta || 0}
          onCambio={(n) => onEstado(id, { ...agregado.estado, aCuenta: n })}
          className="min-h-10 flex-1 rounded-lg border-2 border-gray-200 px-2 py-1 text-right font-bold"
        />
      </div>
      <p className="mt-2 text-right text-sm font-semibold">Se le cobra: <span className="text-blue-700">{formatCurrency(res.totalCobro)}</span></p>
    </div>
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
        <MontoInput
          valor={metodo.monto || 0} onCambio={(n) => onChange({ monto: n })} placeholder="0,00"
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
                  <FechaInput valor={fila.fecha_emision} onCambio={(v) => onChange({ fecha_emision: v })} className={clsOcr(fila, "fecha_emision", "min-h-11 w-full rounded-xl border-2 px-3 py-2 border-gray-200")} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Fecha vencimiento</label>
                  <FechaInput valor={fila.fecha_cheque} onCambio={(v) => onChange({ fecha_cheque: v })} className={clsOcr(fila, "fecha_cheque", "min-h-11 w-full rounded-xl border-2 px-3 py-2 border-gray-200")} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">CUIT emisor</label>
                <CuitInput sinError value={fila.cuit_emisor} onChange={(v) => onChange({ cuit_emisor: v })} className={`min-h-11 w-full rounded-xl border-2 px-4 py-3 font-mono text-base ${clsOcr(fila, "cuit_emisor", "border-gray-200")}`} />
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
