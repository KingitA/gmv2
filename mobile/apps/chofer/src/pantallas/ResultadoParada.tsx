import { useEffect, useState } from "react"
import { Hoja } from "@gm/core/ui"
import { useOnline } from "@gm/core"
import { parseMonto } from "@gm/formato"
import { TEXTO_ENTREGA_BLOQUEADA } from "@gm/cobro"
import type { OpParada } from "../datasets"
import type { ParadaVista } from "../datos/overlay"
import { useEncolar } from "../datos/hooks"
import { Botones, ESTADO_PARADA, formatCurrency, HojaConfirmar, useOverlayDinamico } from "../ui"

// "Confirmar parada" (resultado de la entrega) y "Reabrir parada". P2-35 (29/10): se usa desde la
// lista del viaje y desde la ficha del cliente. Hojas con historial: ?ver=parada:<id> · ?ver=reabrir:<id>.
// P2-33: cobrar ya no cierra la parada: la entrega SIEMPRE la confirma el chofer acá.

/** "12 bultos + 1 pallet" (P2-35: escrito claro, sin abreviar). */
export function textoBultos(bultos: number, pallets?: number | null): string {
  const b = `${bultos} ${bultos === 1 ? "bulto" : "bultos"}`
  const p = Number(pallets) || 0
  return p > 0 ? `${b} + ${p} ${p === 1 ? "pallet" : "pallets"}` : b
}

export function useResultadoParada(viajeId: string, paradas: ParadaVista[], mostrar: (m: string, t?: "ok" | "err") => void) {
  const online = useOnline()
  const encolar = useEncolar()
  const hojaParada = useOverlayDinamico("parada")
  const hojaReabrir = useOverlayDinamico("reabrir")
  const [estadoSel, setEstadoSel] = useState("entregado")
  const [bultosEntregados, setBultosEntregados] = useState("")
  const [motivoEntrega, setMotivoEntrega] = useState("")
  const [motivoCobro, setMotivoCobro] = useState("")
  const [aviso, setAviso] = useState("")
  const [ocupado, setOcupado] = useState(false)

  const paradaSel = hojaParada.valor ? paradas.find((p) => p.id === hojaParada.valor) ?? null : null
  const paradaReabrir = hojaReabrir.valor ? paradas.find((p) => p.id === hojaReabrir.valor) ?? null : null

  // Cada apertura arranca limpia
  const claveHoja = hojaParada.valor
  useEffect(() => {
    if (!claveHoja || !paradaSel) return
    setEstadoSel(paradaSel.entrega_bloqueada ? "no_entregado" : paradaSel.pedidos.length ? "entregado" : "solo_cobro")
    setBultosEntregados("")
    setMotivoEntrega("")
    setMotivoCobro("")
    setAviso("")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveHoja])

  const guardar = async (p: ParadaVista) => {
    // Mismas reglas que PATCH parada (el servidor las vuelve a controlar)
    const mEntrega = motivoEntrega.trim()
    // #24: "no entregado" sin cubrir lo exigido pide UN solo texto, que vale para los dos motivos
    const unSoloTexto = estadoSel === "no_entregado" && !p.cobro_cumplido
    const mCobro = unSoloTexto ? mEntrega : motivoCobro.trim()
    // #23: bloqueada sin cubrir lo exigido ⇒ solo "no entregado"
    if (p.entrega_bloqueada && estadoSel !== "no_entregado") return setAviso(TEXTO_ENTREGA_BLOQUEADA)
    if (["no_entregado", "entregado_parcial"].includes(estadoSel) && !mEntrega) return setAviso(unSoloTexto ? "Contá por qué no se entregó (por ejemplo: No pagó)" : "Contá por qué no se entregó todo")
    if (estadoSel === "solo_cobro" && p.pedidos.length) return setAviso("Esta parada tiene mercadería para entregar")
    if (!p.cobro_cumplido && !mCobro) return setAviso(`Oficina pidió cobrar sí o sí ${formatCurrency(p.minimo_exigido)} y hay cobrado ${formatCurrency(p.cobrado)}: contá por qué no se cobró`)
    setOcupado(true)
    try {
      const payload: OpParada = {
        viaje_id: viajeId,
        parada_id: p.id,
        cliente_id: p.cliente_id,
        estado: estadoSel,
        bultos_entregados: Math.trunc(parseMonto(bultosEntregados) ?? 0),
        motivo_no_entrega: mEntrega,
        motivo_no_cobro: p.cobro_cumplido ? "" : mCobro,
      }
      await encolar("viaje.parada", payload, `Parada ${p.cliente_nombre}: ${ESTADO_PARADA[estadoSel]?.label || estadoSel}`)
      hojaParada.cerrar()
      mostrar(online ? "Parada confirmada." : "Parada confirmada en el equipo: se envía al volver la señal.")
    } finally {
      setOcupado(false)
    }
  }

  const reabrir = async (p: ParadaVista) => {
    setOcupado(true)
    try {
      const payload: OpParada = { viaje_id: viajeId, parada_id: p.id, cliente_id: p.cliente_id, estado: "pendiente" }
      await encolar("viaje.parada", payload, `Parada ${p.cliente_nombre}: reabierta`)
      hojaReabrir.cerrar()
    } finally {
      setOcupado(false)
    }
  }

  const opciones: string[][] = !paradaSel
    ? []
    : paradaSel.entrega_bloqueada
      ? [["no_entregado", paradaSel.pedidos.length ? "✕ No entregué (retiro el pedido)" : "✕ No pude cobrar"]]
      : paradaSel.pedidos.length
        ? [["entregado", `✔ Entregué todo (${textoBultos(paradaSel.bultos, paradaSel.pallets)})`], ["entregado_parcial", "◐ Entregué una parte"], ["no_entregado", "✕ No entregué"]]
        : [["solo_cobro", "✔ Pasé a cobrar"], ["no_entregado", "✕ No pude pasar / no estaba"]]

  const hojas = (
    <>
      <Hoja abierta={!!paradaSel} onCerrar={hojaParada.cerrar} titulo={paradaSel ? `Confirmar parada · ${paradaSel.cliente_nombre}` : ""}>
        {paradaSel && (
          <div className="space-y-4">
            {paradaSel.entrega_bloqueada && (
              <div className="rounded-xl border-2 border-red-500 bg-red-50 px-4 py-3 text-red-800">
                <p className="text-lg font-bold">🔒 {TEXTO_ENTREGA_BLOQUEADA}</p>
                <p className="mt-1 text-base">Hay que cobrar {formatCurrency(paradaSel.minimo_exigido)} y hay cubierto {formatCurrency(paradaSel.cobrado + (paradaSel.descuentos_cobro ?? 0))}. Si cobrás lo que falta, se habilita la entrega.</p>
              </div>
            )}
            <div className="grid grid-cols-1 gap-2">
              {opciones.map(([valor, texto]) => (
                <button
                  key={valor}
                  onClick={() => setEstadoSel(valor!)}
                  className={`min-h-14 rounded-xl border-2 px-4 py-3 text-left text-lg font-bold ${estadoSel === valor ? "border-blue-600 bg-blue-50 text-blue-800" : "border-gray-200 text-gray-700"}`}
                >
                  {texto}
                </button>
              ))}
            </div>
            {estadoSel === "entregado_parcial" && (
              <input
                type="text" inputMode="numeric" value={bultosEntregados} onChange={(e) => setBultosEntregados(e.target.value.replace(/\D/g, ""))}
                placeholder={`Bultos que bajaste (de ${paradaSel.bultos})`}
                className="min-h-14 w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-lg"
              />
            )}
            {["entregado_parcial", "no_entregado"].includes(estadoSel) && (
              <div className="space-y-2">
                {estadoSel === "no_entregado" && !paradaSel.cobro_cumplido && (
                  <div className="flex flex-wrap gap-2">
                    {["No pagó", "Cerrado", "Rechazó la mercadería"].map((t) => (
                      <button key={t} onClick={() => setMotivoEntrega(t)} className={`min-h-12 rounded-xl border-2 px-4 py-2 text-base font-bold ${motivoEntrega === t ? "border-blue-600 bg-blue-50 text-blue-800" : "border-gray-200 text-gray-600"}`}>{t}</button>
                    ))}
                  </div>
                )}
                <textarea
                  value={motivoEntrega} onChange={(e) => setMotivoEntrega(e.target.value)} rows={2}
                  placeholder="¿Por qué no se entregó todo? (cerrado, rechazó mercadería, faltante…)"
                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-base"
                />
                {estadoSel === "no_entregado" && !paradaSel.cobro_cumplido && <p className="text-sm text-gray-500">Este motivo vale también para lo que no se cobró.</p>}
              </div>
            )}
            {!paradaSel.cobro_cumplido && estadoSel !== "no_entregado" && (
              <div className="space-y-2 rounded-xl bg-red-50 p-3">
                <p className="text-base font-bold text-red-700">
                  Había que cobrar sí o sí {formatCurrency(paradaSel.minimo_exigido)} y hay cobrado {formatCurrency(paradaSel.cobrado)}.
                </p>
                <textarea
                  value={motivoCobro} onChange={(e) => setMotivoCobro(e.target.value)} rows={2}
                  placeholder="¿Por qué no se cobró? (obligatorio)"
                  className="w-full rounded-xl border-2 border-red-200 bg-white px-4 py-3 text-base"
                />
              </div>
            )}
            {aviso && <p className="rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-red-700">{aviso}</p>}
            <Botones ocupado={ocupado} onCancelar={hojaParada.cerrar} onConfirmar={() => void guardar(paradaSel)} texto="Confirmar" />
          </div>
        )}
      </Hoja>

      <HojaConfirmar abierta={!!paradaReabrir} onCerrar={hojaReabrir.cerrar} titulo="¿Reabrir la parada?" confirmar="Reabrir" ocupado={ocupado} onConfirmar={() => paradaReabrir && void reabrir(paradaReabrir)}>
        {paradaReabrir?.cliente_nombre}: vuelve a "pendiente" para corregir el resultado de la entrega.
      </HojaConfirmar>
    </>
  )

  return { abrir: hojaParada.abrir, abrirReabrir: hojaReabrir.abrir, hojas }
}
