import { useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { useNoEnviados, useOnline, useOverlay } from "@gm/core"
import { fechaHoraCorta, Hoja } from "@gm/core/ui"
import { DS, esEnCurso, ESTADOS_COBRABLES, type OpFinalizar, type OpIniciar, type OpParada } from "../datasets"
import { paradasSinResolver, type ParadaVista } from "../datos/overlay"
import { rechazosDe, useDescargaViaje, useEncolar, useRefrescarFilas, useViaje } from "../datos/hooks"
import { AvisosBcra, Botones, dejarAviso, ESTADO_PARADA, fechaViaje, formatCurrency, HojaConfirmar, Linea, Pantalla, Rechazos, SinDescargar, SinEnviar, useAbrirPdf, useAvisoEntrante, useOverlayDinamico, useToast } from "../ui"
import { GastoHoja } from "./GastoHoja"

// Hoja de ruta del chofer (= app/chofer/[viajeId]/page.tsx): paradas en el orden que armó
// oficina, con su instrucción; en cada parada cobrar, devolución y el resultado de la
// entrega. Los cobros y gastos de cualquiera de la tripulación van a la billetera del
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
  const abrirPdf = useAbrirPdf(mostrar)
  useAvisoEntrante(mostrar)
  useRefrescarFilas(DS.viajes, [viajeId])

  const hojaParada = useOverlayDinamico("parada")
  const hojaReabrir = useOverlayDinamico("reabrir")
  const gasto = useOverlay("gasto")
  const rendir = useOverlay("rendir")

  // Resultado de parada
  const [estadoSel, setEstadoSel] = useState("entregado")
  const [bultosEntregados, setBultosEntregados] = useState("")
  const [motivoEntrega, setMotivoEntrega] = useState("")
  const [motivoCobro, setMotivoCobro] = useState("")
  const [aviso, setAviso] = useState("")
  const [ocupado, setOcupado] = useState(false)
  // Rendición
  const [efectivoEntrega, setEfectivoEntrega] = useState("")

  const paradaSel = hojaParada.valor ? v?.paradas.find((p) => p.id === hojaParada.valor) ?? null : null
  const paradaReabrir = hojaReabrir.valor ? v?.paradas.find((p) => p.id === hojaReabrir.valor) ?? null : null

  // Cada apertura de la hoja de resultado arranca limpia (= abrirResultado de la web)
  const claveHoja = hojaParada.valor
  useEffect(() => {
    if (!claveHoja || !paradaSel) return
    setEstadoSel(paradaSel.pedidos.length ? "entregado" : "solo_cobro")
    setBultosEntregados("")
    setMotivoEntrega("")
    setMotivoCobro("")
    setAviso("")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveHoja])
  useEffect(() => {
    if (rendir.abierto && v?.dinero) {
      setEfectivoEntrega(String(Math.max(0, v.dinero.efectivo_en_mano || 0)))
      setAviso("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendir.abierto])

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
  // en_rendicion: todavía se pueden corregir cobros hasta que oficina confirme
  const puedeCobrar = ESTADOS_COBRABLES.includes(viaje.estado)
  const visitada = (p: ParadaVista) => p.cobrado > 0 || p.devuelto > 0
  const pendientes = paradas.filter((p) => p.estado === "pendiente" && !visitada(p))
  const visitadas = paradas.filter((p) => p.estado === "pendiente" && visitada(p))
  const resueltas = paradas.filter((p) => p.estado !== "pendiente")
  const totalACobrar = paradas.reduce((s, p) => s + p.total_a_cobrar, 0)
  const totalCobrado = paradas.reduce((s, p) => s + p.cobrado, 0)
  const rechazos = rechazosDe(ops, "viaje.", viajeId)
  const cobrosSinEnviar = v.sinEnviar.cobros + v.sinEnviar.anulaciones + v.sinEnviar.devoluciones + v.sinEnviar.paradas + v.sinEnviar.gastos

  const guardarResultado = async (p: ParadaVista) => {
    // Mismas reglas que PATCH parada (el servidor las vuelve a controlar)
    const mEntrega = motivoEntrega.trim()
    const mCobro = motivoCobro.trim()
    if (["no_entregado", "entregado_parcial"].includes(estadoSel) && !mEntrega) return setAviso("Contá por qué no se entregó todo")
    if (estadoSel === "solo_cobro" && p.pedidos.length) return setAviso("Esta parada tiene mercadería para entregar")
    if (!p.cobro_cumplido && !mCobro) return setAviso(`Oficina pidió cobrar sí o sí ${formatCurrency(p.minimo_exigido)} y hay cobrado ${formatCurrency(p.cobrado)}: contá por qué no se cobró`)
    setOcupado(true)
    try {
      const payload: OpParada = {
        viaje_id: viajeId,
        parada_id: p.id,
        cliente_id: p.cliente_id,
        estado: estadoSel,
        bultos_entregados: Number(bultosEntregados) || 0,
        motivo_no_entrega: mEntrega,
        motivo_no_cobro: p.cobro_cumplido ? "" : mCobro,
      }
      await encolar("viaje.parada", payload, `Parada ${p.cliente_nombre}: ${ESTADO_PARADA[estadoSel]?.label || estadoSel}`)
      hojaParada.cerrar()
      mostrar(online ? "Parada cerrada." : "Parada cerrada en el equipo: se envía al volver la señal.")
    } finally {
      setOcupado(false)
    }
  }

  const reabrirParada = async (p: ParadaVista) => {
    setOcupado(true)
    try {
      const payload: OpParada = { viaje_id: viajeId, parada_id: p.id, cliente_id: p.cliente_id, estado: "pendiente" }
      await encolar("viaje.parada", payload, `Parada ${p.cliente_nombre}: reabierta`)
      hojaReabrir.cerrar()
    } finally {
      setOcupado(false)
    }
  }

  const rendirViaje = async () => {
    // Lo que se puede validar acá (misma regla que el servidor): paradas sin resolver.
    // Lo que confirma el servidor: estado real del viaje y qué cobros entran a la rendición.
    const sin = paradasSinResolver(v)
    if (sin.length) return setAviso(`Quedan ${sin.length} parada(s) sin resolver: marcá cada una como entregada o no entregada.`)
    if (!viaje.es_titular) return setAviso("El viaje lo rinde el chofer titular.")
    setOcupado(true)
    try {
      const payload: OpFinalizar = { viaje_id: viajeId, efectivo_declarado: Number(String(efectivoEntrega).replace(",", ".")) || 0 }
      await encolar("viaje.finalizar", payload, `Rendir viaje ${viaje.nombre || ""}`.trim())
      dejarAviso(online ? "Viaje enviado a rendición: oficina la ve en la Caja del Día y la confirma al recibir la plata." : "Cierre del viaje guardado en el equipo: se envía a oficina al volver la señal.")
      navigate("/", { replace: true })
    } finally {
      setOcupado(false)
    }
  }

  const renderParada = (p: ParadaVista, gris: boolean) => {
    const est = ESTADO_PARADA[p.estado] || ESTADO_PARADA.pendiente!
    const remitos = p.pedidos.flatMap((ped) => ped.remitos)
    const pagosLocales = p.pagos.filter((x) => x.local).length
    return (
      <div
        key={p.id}
        className={`w-full rounded-2xl border p-4 shadow-sm ${gris ? "border-gray-200 bg-gray-100 opacity-80" : p.bloquear_entrega ? "border-2 border-red-400 bg-white" : "border-gray-200 bg-white"}`}
      >
        <button className="flex w-full items-start gap-3 text-left" onClick={() => navigate(`/viajes/${viajeId}/clientes/${p.cliente_id}`)}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white">{p.orden}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-bold text-gray-900">{p.cliente_nombre}</p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${est.cls}`}>{est.label}</span>
              {p.resultadoSinEnviar && <SinEnviar />}
            </div>
            <p className="mt-0.5 truncate text-sm text-gray-500">📍 {[p.direccion, p.localidad].filter(Boolean).join(" · ") || "Sin dirección"}</p>
          </div>
          <span className="shrink-0 text-xl text-gray-400">›</span>
        </button>

        {p.bloquear_entrega && (
          <div className="mt-3 rounded-xl bg-red-600 px-3 py-2 text-center text-sm font-bold text-white">
            🔒 NO ENTREGAR SIN COBRAR{p.motivo_bloqueo ? ` — ${p.motivo_bloqueo}` : ""}
          </div>
        )}
        {p.minimo_exigido > 0 && (
          <div className={`mt-2 rounded-xl px-3 py-2 text-sm font-bold ${p.cobro_cumplido ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
            {p.cobro_cumplido ? "✓ " : "❗ "}COBRAR SÍ O SÍ {formatCurrency(p.minimo_exigido)}
            <span className="font-medium">
              {p.exigir_cobro_anterior && p.exigir_cobro_actual ? " (lo anterior + este viaje)" : p.exigir_cobro_anterior ? " (lo anterior)" : " (este viaje)"}
            </span>
          </div>
        )}
        {p.nota_oficina && <p className="mt-2 rounded-xl bg-yellow-50 px-3 py-2 text-sm text-yellow-900">📝 {p.nota_oficina}</p>}

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-gray-50 py-2"><p className="text-xs text-gray-400">Bultos</p><p className="font-bold text-gray-800">{p.bultos}</p></div>
          <div className="rounded-lg bg-gray-50 py-2"><p className="text-xs text-gray-400">Este viaje</p><p className="text-sm font-bold text-gray-800">{formatCurrency(p.total_viaje)}</p></div>
          <div className={`rounded-lg py-2 ${p.saldo_anterior > 0 ? "bg-red-50" : "bg-gray-50"}`}>
            <p className="text-xs text-gray-400">Debe de antes</p>
            <p className={`text-sm font-bold ${p.saldo_anterior > 0 ? "text-red-600" : "text-gray-400"}`}>{p.saldo_anterior > 0 ? formatCurrency(p.saldo_anterior) : "—"}</p>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2">
          <span className="text-sm font-medium text-blue-700">Total a cobrar</span>
          <span className="font-bold text-blue-800">{formatCurrency(p.total_a_cobrar)}</span>
        </div>
        {p.cobrado > 0 && (
          <div className="mt-1 flex items-center justify-between rounded-lg bg-green-50 px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-medium text-green-700">Cobrado {pagosLocales > 0 && <SinEnviar texto={`${pagosLocales} sin enviar`} />}</span>
            <span className="font-bold text-green-800">{formatCurrency(p.cobrado)}</span>
          </div>
        )}
        {p.devuelto > 0 && (
          <div className="mt-1 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2">
            <span className="text-sm font-medium text-amber-700">Devuelto</span>
            <span className="font-bold text-amber-800">{formatCurrency(p.devuelto)}</span>
          </div>
        )}
        {p.estado !== "pendiente" && (p.motivo_no_entrega || p.motivo_no_cobro || p.bultos_entregados != null) && (
          <p className="mt-2 text-xs text-gray-500">
            {p.bultos_entregados != null && `Bajó ${p.bultos_entregados}/${p.bultos} bultos. `}
            {p.motivo_no_entrega && `No entregó: ${p.motivo_no_entrega}. `}
            {p.motivo_no_cobro && `No cobró: ${p.motivo_no_cobro}.`}
          </p>
        )}

        {remitos.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {remitos.map((r) => (
              <button
                key={r.id}
                disabled={r.estado_pdf !== "generado" || !online}
                onClick={() => void abrirPdf(`/api/remitos/${r.id}/pdf`)}
                className="min-h-11 flex-1 rounded-xl border border-sky-200 bg-sky-100 py-2 text-sm font-bold text-sky-800 active:scale-95 disabled:opacity-50"
              >
                📄 Remito {r.tipo_remito === "REM" ? "R" : "X"} {r.numero_remito}
              </button>
            ))}
          </div>
        )}

        {puedeCobrar && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => navigate(`/viajes/${viajeId}/clientes/${p.cliente_id}/devolucion`)}
              disabled={!enCurso}
              className="min-h-12 rounded-xl border border-amber-200 bg-amber-100 py-2.5 text-sm font-bold text-amber-800 active:scale-95 disabled:opacity-40"
            >
              ↩ Devolución
            </button>
            <button onClick={() => navigate(`/viajes/${viajeId}/clientes/${p.cliente_id}/cobrar`)} className="min-h-12 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white active:scale-95">
              💵 {p.cobrado > 0 ? "Editar cobro" : "Cobrar"}
            </button>
          </div>
        )}
        {enCurso &&
          (p.estado === "pendiente" ? (
            <button onClick={() => hojaParada.abrir(p.id)} className="mt-2 min-h-12 w-full rounded-xl bg-green-600 py-3 text-sm font-bold text-white active:scale-95">
              ✔ Cerrar parada (entregado / no entregado)
            </button>
          ) : (
            <button onClick={() => hojaReabrir.abrir(p.id)} className="mt-2 min-h-11 w-full rounded-xl border border-gray-300 py-2 text-sm font-medium text-gray-600 active:scale-95">
              Reabrir parada
            </button>
          ))}
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
            {viaje.es_titular ? (
              <button onClick={rendir.abrir} className="min-h-14 w-full rounded-2xl bg-orange-500 py-4 text-lg font-bold text-white active:scale-95">
                🏁 Rendir viaje{pendientes.length + visitadas.length > 0 ? ` (faltan cerrar ${pendientes.length + visitadas.length})` : ""}
              </button>
            ) : (
              <p className="py-2 text-center text-sm text-gray-500">El viaje lo rinde el chofer titular.</p>
            )}
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

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3 p-4">
        <div className="rounded-xl bg-white p-3 text-center shadow-sm"><p className="text-2xl font-bold text-gray-800">{paradas.length}</p><p className="text-xs text-gray-500">Clientes</p></div>
        <div className="rounded-xl bg-white p-3 text-center shadow-sm"><p className="text-2xl font-bold text-green-600">{resueltas.length}</p><p className="text-xs text-gray-500">Resueltos</p></div>
        <div className="rounded-xl bg-white p-3 text-center shadow-sm">
          <p className="text-2xl font-bold text-amber-600">{paradas.reduce((s, p) => s + (p.estado === "pendiente" ? p.bultos : 0), 0)}</p>
          <p className="text-xs text-gray-500">Bultos por bajar</p>
        </div>
      </div>

      {/* Plata del viaje */}
      {dinero && (
        <div className="mx-4 mb-4 rounded-2xl bg-blue-700 p-4 text-white">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-blue-200">Total a cobrar</p><p className="text-lg font-bold">{formatCurrency(totalACobrar)}</p></div>
            <div><p className="text-blue-200">Cobrado</p><p className="text-lg font-bold text-green-300">{formatCurrency(totalCobrado)}</p></div>
            <div><p className="text-blue-200">A cuenta del viaje</p><p className="text-lg font-bold">{formatCurrency(dinero.fondo_entregado)}</p></div>
            <div><p className="text-blue-200">Gastos</p><p className="text-lg font-bold text-red-300">{formatCurrency(dinero.gastos_total)}</p></div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-blue-500 pt-3">
            <span className="text-blue-100">Efectivo en mano</span>
            <span className="text-xl font-bold text-yellow-200">{formatCurrency(dinero.efectivo_en_mano)}</span>
          </div>
          {v.sinEnviar.cobros + v.sinEnviar.gastos > 0 && (
            <p className="mt-1 text-xs text-amber-200">⇪ incluye {v.sinEnviar.cobros ? `${v.sinEnviar.cobros} cobro(s)` : ""}{v.sinEnviar.cobros && v.sinEnviar.gastos ? " y " : ""}{v.sinEnviar.gastos ? `${v.sinEnviar.gastos} gasto(s)` : ""} sin enviar</p>
          )}
          {enCurso && (
            <button onClick={gasto.abrir} className="mt-3 min-h-11 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-bold active:scale-95">⛽ Cargar un gasto</button>
          )}
        </div>
      )}

      {/* Paradas */}
      <div className="space-y-3 px-4 pb-6">
        {pendientes.length > 0 && <p className="px-1 text-xs font-bold uppercase tracking-wide text-gray-500">Por visitar ({pendientes.length})</p>}
        {pendientes.map((p) => renderParada(p, false))}
        {visitadas.length > 0 && <p className="px-1 pt-4 text-xs font-bold uppercase tracking-wide text-amber-600">Visitados · falta cerrar la parada ({visitadas.length})</p>}
        {visitadas.map((p) => renderParada(p, false))}
        {resueltas.length > 0 && <p className="px-1 pt-4 text-xs font-bold uppercase tracking-wide text-gray-400">Entregados / cerrados ({resueltas.length})</p>}
        {resueltas.map((p) => renderParada(p, true))}
        {paradas.length === 0 && (
          <div className="py-12 text-center text-gray-400"><p className="mb-2 text-4xl">📦</p><p>No hay clientes en este viaje</p></div>
        )}
      </div>

      <GastoHoja viajeId={viajeId} viajeNombre={viaje.nombre} abierta={gasto.abierto} onCerrar={gasto.cerrar} onGuardado={(m) => mostrar(m)} />

      {/* Resultado de la parada */}
      <Hoja abierta={!!paradaSel} onCerrar={hojaParada.cerrar} titulo={paradaSel?.cliente_nombre || ""}>
        {paradaSel && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2">
              {(paradaSel.pedidos.length
                ? [["entregado", `✔ Entregué todo (${paradaSel.bultos} bultos)`], ["entregado_parcial", "◐ Entregué una parte"], ["no_entregado", "✕ No entregué"]]
                : [["solo_cobro", "✔ Pasé a cobrar"], ["no_entregado", "✕ No pude pasar / no estaba"]]
              ).map(([valor, texto]) => (
                <button
                  key={valor}
                  onClick={() => setEstadoSel(valor!)}
                  className={`min-h-12 rounded-xl border-2 px-4 py-3 text-left font-bold ${estadoSel === valor ? "border-blue-600 bg-blue-50 text-blue-800" : "border-gray-200 text-gray-700"}`}
                >
                  {texto}
                </button>
              ))}
            </div>
            {estadoSel === "entregado_parcial" && (
              <input
                type="number" inputMode="numeric" value={bultosEntregados} onChange={(e) => setBultosEntregados(e.target.value)}
                placeholder={`Bultos que bajaste (de ${paradaSel.bultos})`}
                className="min-h-12 w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg"
              />
            )}
            {["entregado_parcial", "no_entregado"].includes(estadoSel) && (
              <textarea
                value={motivoEntrega} onChange={(e) => setMotivoEntrega(e.target.value)} rows={2}
                placeholder="¿Por qué no se entregó todo? (cerrado, rechazó mercadería, faltante…)"
                className="w-full rounded-xl border-2 border-gray-200 px-4 py-3"
              />
            )}
            {!paradaSel.cobro_cumplido && (
              <div className="space-y-2 rounded-xl bg-red-50 p-3">
                <p className="text-sm font-bold text-red-700">
                  Oficina pidió cobrar sí o sí {formatCurrency(paradaSel.minimo_exigido)} y hay cobrado {formatCurrency(paradaSel.cobrado)}.
                </p>
                <textarea
                  value={motivoCobro} onChange={(e) => setMotivoCobro(e.target.value)} rows={2}
                  placeholder="¿Por qué no se cobró? (obligatorio)"
                  className="w-full rounded-xl border-2 border-red-200 bg-white px-4 py-3"
                />
              </div>
            )}
            {aviso && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{aviso}</p>}
            <Botones ocupado={ocupado} onCancelar={hojaParada.cerrar} onConfirmar={() => void guardarResultado(paradaSel)} texto="Guardar" />
          </div>
        )}
      </Hoja>

      <HojaConfirmar abierta={!!paradaReabrir} onCerrar={hojaReabrir.cerrar} titulo="¿Reabrir la parada?" confirmar="Reabrir" ocupado={ocupado} onConfirmar={() => paradaReabrir && void reabrirParada(paradaReabrir)}>
        {paradaReabrir?.cliente_nombre}: vuelve a "pendiente" para corregir el resultado de la entrega.
      </HojaConfirmar>

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
              {dinero.cobrado_transferencias > 0 && <Linea etiqueta="Transferencias" valor={formatCurrency(dinero.cobrado_transferencias)} />}
            </div>
            {!online && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">📡 Sin señal: el cierre queda guardado en el equipo y sale a oficina al reconectar.</p>}
            <div>
              <p className="mb-1 text-sm font-bold text-gray-700">Efectivo que entregás en oficina</p>
              <input
                type="number" inputMode="decimal" value={efectivoEntrega} onChange={(e) => setEfectivoEntrega(e.target.value)}
                className="min-h-12 w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-xl font-bold"
              />
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
