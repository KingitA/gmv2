import { useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { useNoEnviados, useOnline, useOverlay } from "@gm/core"
import { fechaHoraCorta, Hoja } from "@gm/core/ui"
import { DS, esEnCurso, type OpFinalizar, type OpIniciar } from "../datasets"
import { paradasSinResolver, type ParadaVista } from "../datos/overlay"
import { rechazosDe, useDescargaViaje, useEncolar, useRefrescarFilas, useViaje } from "../datos/hooks"
import { AvisosAnulacion, AvisosBcra, Botones, dejarAviso, ESTADO_PARADA, fechaViaje, formatCurrency, Linea, MontoInput, Pantalla, Rechazos, SinDescargar, SinEnviar, useAvisoEntrante, useToast } from "../ui"
import { GastoHoja } from "./GastoHoja"
import { textoBultos, useResultadoParada } from "./ResultadoParada"
import { CLAVE_VOLVER_A_PARADA } from "./Cobrar"

// Hoja de ruta del chofer (= app/chofer/[viajeId]/page.tsx): paradas en el orden que armó
// oficina. P2-35 (Juan 28/10): el chofer va manejando — cada parada muestra SOLO cliente,
// dirección, bultos, "COBRAR SÍ O SÍ" (si falta cubrir lo exigido) y "Confirmar parada"; arriba,
// cuántas paradas faltan y la plata en mano. Cobrar, devolver, comprobantes, saldos, remitos y la
// nota de oficina van ADENTRO del cliente. Los cobros y gastos de cualquiera de la tripulación van a la billetera del
// TITULAR; solo él rinde el viaje.
//
// Todo sale de la réplica (chofer_viajes) + lo hecho en este equipo sin enviar (overlay).
// Hojas con historial: ?ver=parada:<id> (resultado) · ?ver=reabrir:<id> · ?ver=gasto · ?ver=rendir.
// Abrir el viaje lo INICIA (despachado → en_curso), igual que en la web: operación
// `viaje.iniciar` en la cola, con o sin señal.

export function Viaje() {
  const navigate = useNavigate()
  const { viajeId = "" } = useParams<{ viajeId: string }>()
  const online = useOnline()
  const encolar = useEncolar()
  const ops = useNoEnviados()
  const { viaje: v, cargando } = useViaje(viajeId)
  const descarga = useDescargaViaje(viajeId)
  const { toast, mostrar } = useToast()
  useAvisoEntrante(mostrar)
  useRefrescarFilas(DS.viajes, [viajeId])

  const gasto = useOverlay("gasto")
  const rendir = useOverlay("rendir")
  const resultado = useResultadoParada(viajeId, v?.paradas ?? [], mostrar)

  const [aviso, setAviso] = useState("")
  const [ocupado, setOcupado] = useState(false)
  // Rendición
  const [efectivoEntrega, setEfectivoEntrega] = useState(0)

  useEffect(() => {
    if (rendir.abierto && v?.dinero) {
      setEfectivoEntrega(Math.max(0, v.dinero.efectivo_en_mano || 0))
      setAviso("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendir.abierto])

  // Al volver de Cobrar / Devolución, la hoja de ruta se posiciona en la parada que se estaba atendiendo
  const posicionado = useRef(false)
  useEffect(() => {
    if (!v || posicionado.current) return
    posicionado.current = true
    let cid: string | null = null
    try { cid = sessionStorage.getItem(CLAVE_VOLVER_A_PARADA); if (cid) sessionStorage.removeItem(CLAVE_VOLVER_A_PARADA) } catch { /* noop */ }
    if (cid) setTimeout(() => document.getElementById(`parada-${cid}`)?.scrollIntoView({ block: "start" }), 50)
  }, [v])

  // Abrir el viaje lo inicia (una sola vez por apertura del equipo)
  const iniciado = useRef(false)
  useEffect(() => {
    if (!v || iniciado.current) return
    if (v.viaje.estado === "despachado" && !v.inicioPendiente) {
      iniciado.current = true
      const p: OpIniciar = { viaje_id: v.id }
      void encolar("viaje.iniciar", p, `Inicio del viaje ${v.viaje.nombre || ""}`.trim())
    }
  }, [v, encolar])

  if (!cargando && !v) {
    return (
      <Pantalla titulo="Viaje" dataset={DS.viajes}>
        <SinDescargar que="este viaje" />
      </Pantalla>
    )
  }
  if (!v) return <Pantalla titulo="Viaje" dataset={DS.viajes}>{null}</Pantalla>

  const { viaje, paradas, dinero } = v
  const enCurso = esEnCurso(viaje.estado)
  const visitada = (p: ParadaVista) => p.cobrado > 0 || p.devuelto > 0
  const pendientes = paradas.filter((p) => p.estado === "pendiente" && !visitada(p))
  const visitadas = paradas.filter((p) => p.estado === "pendiente" && visitada(p))
  const resueltas = paradas.filter((p) => p.estado !== "pendiente")
  const faltan = pendientes.length + visitadas.length
  const rechazos = rechazosDe(ops, "viaje.", viajeId)
  const cobrosSinEnviar = v.sinEnviar.cobros + v.sinEnviar.anulaciones + v.sinEnviar.devoluciones + v.sinEnviar.paradas + v.sinEnviar.gastos

  const rendirViaje = async () => {
    // Lo que se puede validar acá (misma regla que el servidor): paradas sin resolver.
    // Lo que confirma el servidor: estado real del viaje y qué cobros entran a la rendición.
    const sin = paradasSinResolver(v)
    if (sin.length) return setAviso(`Quedan ${sin.length} parada(s) sin resolver: marcá cada una como entregada o no entregada.`)
    if (!viaje.es_titular) return setAviso("El viaje lo rinde el chofer titular.")
    setOcupado(true)
    try {
      const payload: OpFinalizar = { viaje_id: viajeId, efectivo_declarado: Math.max(0, efectivoEntrega) }
      await encolar("viaje.finalizar", payload, `Rendir viaje ${viaje.nombre || ""}`.trim())
      dejarAviso(online ? "Viaje enviado a rendición: oficina la ve en la Caja del Día y la confirma al recibir la plata." : "Cierre del viaje guardado en el equipo: se envía a oficina al volver la señal.")
      navigate("/", { replace: true })
    } finally {
      setOcupado(false)
    }
  }

  const renderParada = (p: ParadaVista) => {
    const resuelta = p.estado !== "pendiente"
    const est = ESTADO_PARADA[p.estado] || ESTADO_PARADA.pendiente!
    const sinEnviar = p.resultadoSinEnviar || p.pagos.some((x) => x.local)
    // P2-35: "COBRAR SÍ O SÍ" solo mientras falte cubrir lo exigido
    const cobrarSiOSi = !resuelta && p.minimo_exigido > 0 && !p.cobro_cumplido
    if (resuelta)
      return (
        <div key={p.id} id={`parada-${p.cliente_id}`} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-100 p-3">
          <button className="flex min-h-12 min-w-0 flex-1 items-center gap-3 text-left" onClick={() => navigate(`/viajes/${viajeId}/clientes/${p.cliente_id}`)}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-400 text-base font-bold text-white">{p.orden}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg font-bold text-gray-700">{p.cliente_nombre}</span>
              <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${est.cls}`}>{est.label}</span>
              {sinEnviar && <span className="ml-2"><SinEnviar /></span>}
            </span>
          </button>
          {enCurso && (
            <button onClick={() => resultado.abrirReabrir(p.id)} className="min-h-12 shrink-0 rounded-xl border-2 border-gray-300 bg-white px-3 text-base font-bold text-gray-600 active:scale-95">Reabrir</button>
          )}
        </div>
      )
    return (
      <div
        key={p.id}
        id={`parada-${p.cliente_id}`}
        className={`rounded-2xl border-2 bg-white p-4 shadow-sm ${cobrarSiOSi && p.bloquear_entrega ? "border-red-500" : "border-gray-200"}`}
      >
        <button className="flex w-full items-start gap-3 text-left" onClick={() => navigate(`/viajes/${viajeId}/clientes/${p.cliente_id}`)}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-700 text-lg font-bold text-white">{p.orden}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-xl font-bold leading-tight text-gray-900">{p.cliente_nombre}</span>
            <span className="mt-1 block text-base text-gray-600">{[p.direccion, p.localidad].filter(Boolean).join(", ") || "Sin dirección"}</span>
            {p.pedidos.length > 0 && <span className="mt-1 block text-lg font-semibold text-gray-800">📦 {textoBultos(p.bultos, p.pallets)}</span>}
            {p.cobrado > 0.005 && <span className="mt-1 block text-base font-semibold text-green-700">Cobrado {formatCurrency(p.cobrado)}</span>}
            {sinEnviar && <span className="mt-1 block"><SinEnviar /></span>}
          </span>
          <span className="shrink-0 pt-1 text-2xl text-gray-400">›</span>
        </button>
        {cobrarSiOSi && (
          <p className="mt-3 rounded-xl border-2 border-red-500 px-3 py-2 text-center text-lg font-extrabold text-red-700">
            {p.bloquear_entrega ? "🔒 " : ""}COBRAR SÍ O SÍ {formatCurrency(Math.max(0, p.minimo_exigido - p.cobrado - (p.descuentos_cobro ?? 0)))}
          </p>
        )}
        {enCurso && (
          <button onClick={() => resultado.abrir(p.id)} className="mt-3 min-h-14 w-full rounded-xl bg-green-600 py-3 text-lg font-bold text-white active:scale-95">
            ✔ Confirmar parada
          </button>
        )}
      </div>
    )
  }

  return (
    <Pantalla
      titulo={viaje.nombre || "Viaje"}
      dataset={DS.viajes}
      pie={
        enCurso ? (
          <div className="border-t border-gray-200 bg-white p-4">
            <div className="grid grid-cols-[auto_1fr] gap-3">
              <button onClick={gasto.abrir} className="min-h-14 rounded-2xl border-2 border-gray-300 px-4 text-lg font-bold text-gray-700 active:scale-95">⛽ Gasto</button>
              {viaje.es_titular ? (
                <button onClick={rendir.abrir} className="min-h-14 rounded-2xl bg-orange-500 py-3 text-lg font-bold text-white active:scale-95">🏁 Rendir viaje</button>
              ) : (
                <p className="self-center text-center text-base text-gray-500">El viaje lo rinde el titular.</p>
              )}
            </div>
          </div>
        ) : undefined
      }
    >
      {toast}
      <div className="bg-blue-700 px-5 pb-3 text-sm text-blue-200">
        {fechaViaje(viaje.fecha)}
        {!viaje.es_titular && " · acompañante"}
        {viaje.zona_nombre ? ` · 📍 ${viaje.zona_nombre}` : ""}
      </div>

      {/* Descarga del viaje: el chofer sale a ruta con TODO en el equipo */}
      {descarga.total > 0 && !descarga.completa && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-bold">⚠ Viaje a medio descargar: faltan {descarga.faltan.length} de {descarga.total} fichas de clientes.</p>
          <p className="mt-0.5 text-xs">{online ? "Se están descargando. No salgas a ruta hasta ver ✓ Viaje descargado." : "Sin señal no se pueden bajar. Conectate antes de salir a ruta."}</p>
          {online && (
            <button onClick={() => void descarga.descargarTodo().then(() => mostrar("Descarga actualizada.")).catch(() => mostrar("No se pudo descargar. Probá de nuevo.", "err"))} className="mt-2 min-h-11 rounded-lg bg-amber-600 px-4 text-sm font-bold text-white">
              Descargar ahora
            </button>
          )}
        </div>
      )}
      {descarga.total > 0 && descarga.completa && (
        <div className="border-b border-green-200 bg-green-50 px-4 py-1.5 text-xs font-bold text-green-700">
          ✓ Viaje descargado{descarga.generadoAt ? ` · fichas al ${fechaHoraCorta(descarga.generadoAt)}` : ""}{cobrosSinEnviar > 0 ? ` · ⇪ ${cobrosSinEnviar} operación(es) sin enviar` : ""}
        </div>
      )}
      {v.cierrePendiente && (
        <div className="border-b border-amber-200 bg-amber-100 px-5 py-3 text-center text-sm font-bold text-amber-900">
          ⇪ Cierre del viaje pendiente de enviar: sale a oficina al volver la señal.
        </div>
      )}
      {viaje.estado === "en_rendicion" && !v.cierrePendiente && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-center text-sm font-medium text-amber-800">
          Viaje rendido — oficina está controlando la plata. Todavía podés corregir un cobro.
        </div>
      )}
      {viaje.estado === "completado" && (
        <div className="border-b border-gray-200 bg-gray-100 px-5 py-3 text-center text-sm font-medium text-gray-600">Viaje finalizado — solo consulta</div>
      )}
      <Rechazos items={rechazos} ayuda="Eso NO quedó registrado en el sistema. Revisalo y, si corresponde, cargalo de nuevo." />
      <AvisosBcra />
      <AvisosAnulacion />

      {/* P2-35: arriba, lo justo */}
      <div className="grid grid-cols-2 gap-3 p-4">
        <div className="rounded-2xl bg-white p-3 text-center shadow-sm">
          <p className="text-3xl font-extrabold text-gray-900">{faltan}</p>
          <p className="text-base text-gray-600">{faltan === 1 ? "parada falta" : "paradas faltan"}</p>
        </div>
        <div className="rounded-2xl bg-white p-3 text-center shadow-sm">
          <p className="text-2xl font-extrabold text-gray-900">{dinero ? formatCurrency(dinero.efectivo_en_mano) : "—"}</p>
          <p className="text-base text-gray-600">plata en mano{v.sinEnviar.cobros + v.sinEnviar.gastos > 0 ? " ⇪" : ""}</p>
        </div>
      </div>

      {/* Paradas */}
      <div className="space-y-3 px-4 pb-6">
        {visitadas.length > 0 && <p className="px-1 text-base font-bold text-amber-700">Atendidos, falta confirmar ({visitadas.length})</p>}
        {visitadas.map(renderParada)}
        {pendientes.length > 0 && <p className={`px-1 text-base font-bold text-gray-700 ${visitadas.length ? "pt-3" : ""}`}>Por visitar ({pendientes.length})</p>}
        {pendientes.map(renderParada)}
        {resueltas.length > 0 && <p className="px-1 pt-3 text-base font-bold text-gray-500">Confirmadas ({resueltas.length})</p>}
        {resueltas.map(renderParada)}
        {paradas.length === 0 && (
          <div className="py-12 text-center text-gray-400"><p className="mb-2 text-4xl">📦</p><p>No hay clientes en este viaje</p></div>
        )}
      </div>

      <GastoHoja viajeId={viajeId} viajeNombre={viaje.nombre} abierta={gasto.abierto} onCerrar={gasto.cerrar} onGuardado={(m) => mostrar(m)} />

      {resultado.hojas}

      {/* Rendir */}
      <Hoja abierta={rendir.abierto} onCerrar={rendir.cerrar} titulo="Rendir el viaje">
        {dinero && (
          <div className="space-y-4">
            <div className="space-y-2 rounded-xl bg-gray-50 p-4 text-sm">
              <Linea etiqueta="A cuenta del viaje" valor={formatCurrency(dinero.fondo_entregado)} />
              <Linea etiqueta="+ Cobrado en efectivo" valor={formatCurrency(dinero.cobrado_efectivo)} />
              <Linea etiqueta="− Gastos" valor={formatCurrency(dinero.gastos_total)} rojo />
              <div className="border-t pt-2"><Linea etiqueta="Efectivo en mano" valor={formatCurrency(dinero.efectivo_en_mano)} fuerte /></div>
              {dinero.cheques_cantidad > 0 && <Linea etiqueta="Cheques que entregás" valor={`${dinero.cheques_cantidad} ${dinero.cheques_cantidad === 1 ? "cheque" : "cheques"}`} />}

            </div>
            {v.paradas.some((p) => p.devuelto > 0.005) && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ↩ Las devoluciones de este viaje ({formatCurrency(v.paradas.reduce((s, p) => s + p.devuelto, 0))}) quedan esperando que depósito las revise; la nota de crédito la emite oficina. Mientras tanto ya descuentan de lo que debe cada cliente.
              </p>
            )}
            {dinero.cobrado_transferencias > 0 && (
              <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">🏦 Las transferencias ({formatCurrency(dinero.cobrado_transferencias)}) no se rinden: las confirma oficina cuando entran al banco.</p>
            )}
            {!online && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">📡 Sin señal: el cierre queda guardado en el equipo y sale a oficina al reconectar.</p>}
            <div>
              <p className="mb-1 text-sm font-bold text-gray-700">Efectivo que entregás en oficina</p>
              <MontoInput valor={efectivoEntrega} onCambio={setEfectivoEntrega} className="min-h-12 w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-xl font-bold" />
              {dinero.efectivo_en_mano < -0.01 ? (
                <p className="mt-1 text-xs font-medium text-amber-700">Gastaste más que el fondo + lo cobrado: pusiste {formatCurrency(-dinero.efectivo_en_mano)} de tu bolsillo. Queda a tu favor y oficina te lo reintegra.</p>
              ) : (
                <p className="mt-1 text-xs text-gray-500">Lo que no entregues queda anotado en tu billetera.</p>
              )}
            </div>
            {aviso && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{aviso}</p>}
            <Botones ocupado={ocupado} onCancelar={rendir.cerrar} onConfirmar={() => void rendirViaje()} texto="Rendir" naranja />
          </div>
        )}
      </Hoja>
    </Pantalla>
  )
}
