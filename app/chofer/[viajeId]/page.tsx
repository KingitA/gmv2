"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { useBackTrap } from "@/lib/vendedor/use-back-trap"
import { formatCurrency } from "@/lib/utils"
import type { ParadaHoja, HojaRuta } from "@/lib/viajes/hoja-ruta"
import { GastoSheet } from "@/components/chofer/gasto-sheet"

// Hoja de ruta del chofer (titular o acompañante): paradas en el orden que
// armó oficina, con su instrucción (cobrar sí o sí / NO ENTREGAR SIN COBRAR /
// nota). En cada parada: cobrar, devolución y el resultado de la entrega.
// Los cobros y gastos de cualquiera de la tripulación van a la billetera del
// TITULAR; solo él rinde el viaje.

interface ViajeData {
  viaje: { id: string; nombre: string; fecha: string; estado: string; zona_nombre: string; es_titular: boolean }
  paradas: ParadaHoja[]
  dinero: HojaRuta["dinero"] | null
  tripulacion: Array<{ usuario_id: string; nombre: string; rol: string }>
}

type Hoja = null | { tipo: "resultado"; parada: ParadaHoja } | { tipo: "gasto" } | { tipo: "rendir" }

const ESTADO_PARADA: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "PENDIENTE", cls: "bg-gray-200 text-gray-700" },
  entregado: { label: "ENTREGADO", cls: "bg-green-600 text-white" },
  entregado_parcial: { label: "PARCIAL", cls: "bg-amber-500 text-white" },
  no_entregado: { label: "NO ENTREGADO", cls: "bg-red-600 text-white" },
  solo_cobro: { label: "COBRADO", cls: "bg-blue-600 text-white" },
}

export default function ViajeDashboardPage() {
  const router = useRouter()
  const viajeId = useParams().viajeId as string

  const [data, setData] = useState<ViajeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hoja, setHoja] = useState<Hoja>(null)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState("")

  // Resultado de parada
  const [estadoSel, setEstadoSel] = useState("entregado")
  const [bultosEntregados, setBultosEntregados] = useState("")
  const [motivoEntrega, setMotivoEntrega] = useState("")
  const [motivoCobro, setMotivoCobro] = useState("")
  // Rendición
  const [efectivoEntrega, setEfectivoEntrega] = useState("")

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/chofer/viaje/${viajeId}`)
      const d = await r.json()
      if (!d.error) setData(d)
    } finally {
      setLoading(false)
    }
  }, [viajeId])

  useEffect(() => { cargar() }, [cargar])

  // "Atrás" físico: cerrar la hoja abierta antes de salir de la página
  useBackTrap(() => {
    if (hoja) { setHoja(null); return true }
    return false
  })

  const post = async (url: string, body: any, metodo = "POST") => {
    setOcupado(true)
    setAviso("")
    try {
      const res = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const d = await res.json()
      if (!res.ok) { setAviso(d.error || "No se pudo guardar"); return null }
      return d
    } catch {
      setAviso("Sin conexión: probá de nuevo")
      return null
    } finally {
      setOcupado(false)
    }
  }

  const abrirResultado = (p: ParadaHoja) => {
    setEstadoSel(p.pedidos.length ? "entregado" : "solo_cobro")
    setBultosEntregados("")
    setMotivoEntrega("")
    setMotivoCobro("")
    setAviso("")
    setHoja({ tipo: "resultado", parada: p })
  }

  const guardarResultado = async (p: ParadaHoja) => {
    const d = await post(`/api/chofer/viaje/${viajeId}/parada`, {
      parada_id: p.id,
      estado: estadoSel,
      bultos_entregados: Number(bultosEntregados) || 0,
      motivo_no_entrega: motivoEntrega,
      motivo_no_cobro: motivoCobro,
    }, "PATCH")
    if (d) { setHoja(null); cargar() }
  }

  const rendir = async () => {
    const d = await post(`/api/chofer/viaje/${viajeId}/finalizar`, {
      efectivo_declarado: Number(efectivoEntrega.replace(",", ".")) || 0,
    })
    if (d) router.push("/chofer")
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-500 text-xl">No se encontró el viaje.</p>
      </div>
    )
  }

  const { viaje, paradas, dinero } = data
  const enCurso = viaje.estado === "en_curso" || viaje.estado === "despachado"
  // en_rendicion: todavía se pueden corregir cobros hasta que oficina confirme
  const puedeCobrar = enCurso || viaje.estado === "en_rendicion"
  const visitada = (p: ParadaHoja) => p.cobrado > 0 || p.devuelto > 0
  const pendientes = paradas.filter((p) => p.estado === "pendiente" && !visitada(p))
  const visitadas = paradas.filter((p) => p.estado === "pendiente" && visitada(p))
  const resueltas = paradas.filter((p) => p.estado !== "pendiente")
  const totalACobrar = paradas.reduce((s, p) => s + p.total_a_cobrar, 0)
  const totalCobrado = paradas.reduce((s, p) => s + p.cobrado, 0)

  const renderParada = (p: ParadaHoja, gris: boolean) => {
    const est = ESTADO_PARADA[p.estado] || ESTADO_PARADA.pendiente
    const remitos = p.pedidos.flatMap((ped) => ped.remitos)
    return (
      <div
        key={p.id}
        className={`w-full rounded-2xl shadow-sm border p-4 ${gris ? "bg-gray-100 border-gray-200 opacity-80" : p.bloquear_entrega ? "bg-white border-red-400 border-2" : "bg-white border-gray-200"}`}
      >
        <div className="flex items-start gap-3" onClick={() => router.push(`/chofer/${viajeId}/cliente/${p.cliente_id}`)}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white">{p.orden}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-bold text-gray-900">{p.cliente_nombre}</p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${est.cls}`}>{est.label}</span>
            </div>
            <p className="mt-0.5 truncate text-sm text-gray-500">📍 {[p.direccion, p.localidad].filter(Boolean).join(" · ") || "Sin dirección"}</p>
          </div>
          <span className="shrink-0 text-xl text-gray-400">›</span>
        </div>

        {/* Instrucción de oficina */}
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
          <div className="rounded-lg bg-gray-50 py-2">
            <p className="text-xs text-gray-400">Bultos</p>
            <p className="font-bold text-gray-800">{p.bultos}</p>
          </div>
          <div className="rounded-lg bg-gray-50 py-2">
            <p className="text-xs text-gray-400">Este viaje</p>
            <p className="text-sm font-bold text-gray-800">{formatCurrency(p.total_viaje)}</p>
          </div>
          <div className={`rounded-lg py-2 ${p.saldo_anterior > 0 ? "bg-red-50" : "bg-gray-50"}`}>
            <p className="text-xs text-gray-400">Debe de antes</p>
            <p className={`text-sm font-bold ${p.saldo_anterior > 0 ? "text-red-600" : "text-gray-400"}`}>
              {p.saldo_anterior > 0 ? formatCurrency(p.saldo_anterior) : "—"}
            </p>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2">
          <span className="text-sm font-medium text-blue-700">Total a cobrar</span>
          <span className="font-bold text-blue-800">{formatCurrency(p.total_a_cobrar)}</span>
        </div>
        {p.cobrado > 0 && (
          <div className="mt-1 flex items-center justify-between rounded-lg bg-green-50 px-3 py-2">
            <span className="text-sm font-medium text-green-700">Cobrado</span>
            <span className="font-bold text-green-800">{formatCurrency(p.cobrado)}</span>
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
                disabled={r.estado_pdf !== "generado"}
                onClick={() => window.open(`/api/remitos/${r.id}/pdf`, "_blank")}
                className="flex-1 rounded-xl border border-sky-200 bg-sky-100 py-2 text-sm font-bold text-sky-800 active:scale-95 transition-transform disabled:opacity-50"
              >
                📄 Remito {r.tipo_remito === "REM" ? "R" : "X"} {r.numero_remito}
              </button>
            ))}
          </div>
        )}

        {puedeCobrar && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => router.push(`/chofer/${viajeId}/cliente/${p.cliente_id}?accion=devolucion`)}
              disabled={!enCurso}
              className="rounded-xl border border-amber-200 bg-amber-100 py-2.5 text-sm font-bold text-amber-800 active:scale-95 transition-transform disabled:opacity-40"
            >
              ↩ Devolución
            </button>
            <button
              onClick={() => router.push(`/chofer/${viajeId}/cliente/${p.cliente_id}?accion=cobrar`)}
              className="rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white active:scale-95 transition-transform"
            >
              💵 {p.cobrado > 0 ? "Editar cobro" : "Cobrar"}
            </button>
          </div>
        )}
        {enCurso && (
          p.estado === "pendiente" ? (
            <button
              onClick={() => abrirResultado(p)}
              className="mt-2 w-full rounded-xl bg-green-600 py-3 text-sm font-bold text-white active:scale-95 transition-transform"
            >
              ✔ Cerrar parada (entregado / no entregado)
            </button>
          ) : (
            <button
              onClick={async () => { if (await post(`/api/chofer/viaje/${viajeId}/parada`, { parada_id: p.id, estado: "pendiente" }, "PATCH")) cargar() }}
              className="mt-2 w-full rounded-xl border border-gray-300 py-2 text-sm font-medium text-gray-600 active:scale-95"
            >
              Reabrir parada
            </button>
          )
        )}
      </div>
    )
  }

  const paradaSel = hoja?.tipo === "resultado" ? hoja.parada : null

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-blue-700 px-5 py-4 text-white shadow-md">
        <button onClick={() => router.push("/chofer")} className="mb-1 flex items-center gap-1 text-sm text-blue-200">← Inicio</button>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">{viaje.nombre}</h1>
            <p className="text-sm text-blue-200">
              {new Date(viaje.fecha).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
              {!viaje.es_titular && " · acompañante"}
            </p>
          </div>
          <button
            onClick={() => window.open(`/api/viajes/${viajeId}/hoja-ruta/pdf`, "_blank")}
            className="shrink-0 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-bold"
          >
            📄 Hoja PDF
          </button>
        </div>
      </header>

      {viaje.estado === "en_rendicion" && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-center text-sm font-medium text-amber-800">
          Viaje rendido — oficina está controlando la plata. Todavía podés corregir un cobro.
        </div>
      )}
      {viaje.estado === "completado" && (
        <div className="border-b border-gray-200 bg-gray-100 px-5 py-3 text-center text-sm font-medium text-gray-600">Viaje finalizado — solo consulta</div>
      )}

      {aviso && !hoja && <div className="mx-4 mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{aviso}</div>}

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3 p-4">
        <div className="rounded-xl bg-white p-3 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-800">{paradas.length}</p>
          <p className="text-xs text-gray-500">Clientes</p>
        </div>
        <div className="rounded-xl bg-white p-3 text-center shadow-sm">
          <p className="text-2xl font-bold text-green-600">{resueltas.length}</p>
          <p className="text-xs text-gray-500">Resueltos</p>
        </div>
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
          {enCurso && (
            <button
              onClick={() => { setAviso(""); setHoja({ tipo: "gasto" }) }}
              className="mt-3 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-bold active:scale-95 transition-transform"
            >
              ⛽ Cargar un gasto
            </button>
          )}
        </div>
      )}

      {/* Paradas */}
      <div className="space-y-3 px-4 pb-32">
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

      {/* Acción principal */}
      {enCurso && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white p-4 shadow-lg">
          {viaje.es_titular ? (
            <button
              onClick={() => { setEfectivoEntrega(String(Math.max(0, dinero?.efectivo_en_mano || 0))); setAviso(""); setHoja({ tipo: "rendir" }) }}
              className="w-full rounded-2xl bg-orange-500 py-4 text-lg font-bold text-white active:scale-95 transition-transform"
            >
              🏁 Rendir viaje{pendientes.length + visitadas.length > 0 ? ` (faltan cerrar ${pendientes.length + visitadas.length})` : ""}
            </button>
          ) : (
            <p className="py-2 text-center text-sm text-gray-500">El viaje lo rinde el chofer titular.</p>
          )}
        </div>
      )}

      {hoja?.tipo === "gasto" && <GastoSheet viajeId={viajeId} onClose={() => setHoja(null)} onGuardado={cargar} />}

      {/* Hojas inferiores */}
      {hoja && hoja.tipo !== "gasto" && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={() => setHoja(null)}>
          <div className="max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            {paradaSel && (
              <>
                <h3 className="text-center text-xl font-bold">{paradaSel.cliente_nombre}</h3>
                <div className="grid grid-cols-1 gap-2">
                  {(paradaSel.pedidos.length
                    ? [["entregado", `✔ Entregué todo (${paradaSel.bultos} bultos)`], ["entregado_parcial", "◐ Entregué una parte"], ["no_entregado", "✕ No entregué"]]
                    : [["solo_cobro", "✔ Pasé a cobrar"], ["no_entregado", "✕ No pude pasar / no estaba"]]
                  ).map(([valor, texto]) => (
                    <button
                      key={valor}
                      onClick={() => setEstadoSel(valor)}
                      className={`rounded-xl border-2 py-3 text-left px-4 font-bold ${estadoSel === valor ? "border-blue-600 bg-blue-50 text-blue-800" : "border-gray-200 text-gray-700"}`}
                    >
                      {texto}
                    </button>
                  ))}
                </div>
                {estadoSel === "entregado_parcial" && (
                  <input
                    type="number" inputMode="numeric" value={bultosEntregados} onChange={(e) => setBultosEntregados(e.target.value)}
                    placeholder={`Bultos que bajaste (de ${paradaSel.bultos})`}
                    className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg"
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
                <Botones ocupado={ocupado} onCancelar={() => setHoja(null)} onConfirmar={() => guardarResultado(paradaSel)} texto="Guardar" />
              </>
            )}

            {hoja.tipo === "rendir" && dinero && (
              <>
                <h3 className="text-center text-xl font-bold">Rendir el viaje</h3>
                <div className="space-y-2 rounded-xl bg-gray-50 p-4 text-sm">
                  <Linea etiqueta="A cuenta del viaje" valor={formatCurrency(dinero.fondo_entregado)} />
                  <Linea etiqueta="+ Cobrado en efectivo" valor={formatCurrency(dinero.cobrado_efectivo)} />
                  <Linea etiqueta="− Gastos" valor={formatCurrency(dinero.gastos_total)} rojo />
                  <div className="border-t pt-2"><Linea etiqueta="Efectivo en mano" valor={formatCurrency(dinero.efectivo_en_mano)} fuerte /></div>
                  {dinero.cobrado_cheques > 0 && <Linea etiqueta="Cheques" valor={formatCurrency(dinero.cobrado_cheques)} />}
                  {dinero.cobrado_transferencias > 0 && <Linea etiqueta="Transferencias" valor={formatCurrency(dinero.cobrado_transferencias)} />}
                </div>
                <div>
                  <p className="mb-1 text-sm font-bold text-gray-700">Efectivo que entregás en oficina</p>
                  <input
                    type="number" inputMode="decimal" value={efectivoEntrega} onChange={(e) => setEfectivoEntrega(e.target.value)}
                    className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-xl font-bold"
                  />
                  {dinero.efectivo_en_mano < -0.01 ? (
                    <p className="mt-1 text-xs font-medium text-amber-700">Gastaste más que el fondo + lo cobrado: pusiste {formatCurrency(-dinero.efectivo_en_mano)} de tu bolsillo. Queda a tu favor y oficina te lo reintegra.</p>
                  ) : (
                    <p className="mt-1 text-xs text-gray-500">Lo que no entregues queda anotado en tu billetera.</p>
                  )}
                </div>
                {aviso && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{aviso}</p>}
                <Botones ocupado={ocupado} onCancelar={() => setHoja(null)} onConfirmar={rendir} texto="Rendir" naranja />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Linea({ etiqueta, valor, fuerte, rojo }: { etiqueta: string; valor: string; fuerte?: boolean; rojo?: boolean }) {
  return (
    <div className={`flex justify-between ${fuerte ? "text-base font-bold" : ""}`}>
      <span className="text-gray-500">{etiqueta}</span>
      <span className={rojo ? "font-bold text-red-600" : "font-bold"}>{valor}</span>
    </div>
  )
}

function Botones({ ocupado, onCancelar, onConfirmar, texto, naranja }: { ocupado: boolean; onCancelar: () => void; onConfirmar: () => void; texto: string; naranja?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button onClick={onCancelar} className="rounded-2xl border-2 border-gray-300 py-4 font-bold text-gray-600 active:scale-95">Cancelar</button>
      <button
        onClick={onConfirmar}
        disabled={ocupado}
        className={`rounded-2xl py-4 font-bold text-white active:scale-95 disabled:opacity-50 ${naranja ? "bg-orange-500" : "bg-blue-600"}`}
      >
        {ocupado ? "Guardando…" : texto}
      </button>
    </div>
  )
}
