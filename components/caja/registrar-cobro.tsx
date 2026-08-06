"use client"

// Barra de registro rápido de la Caja del Día: cliente + método + monto y listo.
// El EFECTIVO se confirma en el acto (impacta la caja elegida y el saldo del
// cliente vía POST /api/cobranzas confirmar:true) y queda "pendiente de
// imputación" — se aplica a comprobantes al registrar (sección opcional) o
// después con el chip Imputar de la fila. Transferencias/echeqs/cheques quedan
// pendientes hasta su Confirmar/Aceptar.

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { EntitySearchSelect } from "@/components/search/EntitySearchSelect"
import { FechaInput } from "@/components/finanzas/fecha-input"
import { useToast } from "@/hooks/use-toast"
import { todayArgentina } from "@/lib/utils"
import { ChevronDown, ChevronUp, Loader2, Plus } from "lucide-react"

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
  // Imputación opcional en el momento del registro
  const [imputarAbierto, setImputarAbierto] = useState(false)
  const [comprobantes, setComprobantes] = useState<any[]>([])
  const [imputaciones, setImputaciones] = useState<Record<string, number>>({})

  // Comprobantes con saldo del cliente elegido (para imputar al registrar)
  useEffect(() => {
    setComprobantes([])
    setImputaciones({})
    if (!cliente?.id) {
      setImputarAbierto(false)
      return
    }
    createClient()
      .from("comprobantes_venta")
      .select("id, numero_comprobante, tipo_comprobante, saldo_pendiente")
      .eq("cliente_id", cliente.id)
      .in("estado_pago", ["pendiente", "parcial"])
      .gt("saldo_pendiente", 0)
      .order("fecha", { ascending: true })
      .limit(30)
      .then(({ data }) => setComprobantes(data || []))
  }, [cliente?.id])

  const cajas = useMemo(() => cuentas.filter((c) => c.grupo === "EFECTIVO"), [cuentas])
  const bancos = useMemo(() => cuentas.filter((c) => c.grupo === "BANCOS"), [cuentas])
  const cajaChicaDefault = useMemo(
    () => cajas.find((c) => c.nombre.toLowerCase().includes("chica"))?.cuenta_id ?? cajas[0]?.cuenta_id ?? "",
    [cajas]
  )

  const limpiar = () => {
    setCliente(null)
    setMonto("")
    setNumeroOperacion("")
    setBanco("")
    setNumeroCheque("")
    setFechaCheque("")
    setImputarAbierto(false)
    setImputaciones({})
  }

  const totalImputado = Object.values(imputaciones).reduce((s, v) => s + (Number(v) || 0), 0)

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

    const metodoPayload: any = { tipo: metodo === "echeq" ? "cheque" : metodo, monto: montoNum }
    if (metodo === "efectivo") {
      metodoPayload.caja_id = cajaId || cajaChicaDefault || undefined
    } else if (metodo === "transferencia") {
      if (cuentaBancariaId) metodoPayload.cuenta_bancaria_id = cuentaBancariaId
      metodoPayload.fecha_transferencia = todayArgentina()
      if (numeroOperacion) metodoPayload.numero_comprobante = numeroOperacion
      const b = bancos.find((x) => x.cuenta_id === cuentaBancariaId)
      if (b) metodoPayload.banco_emisor = b.nombre
    } else {
      // cheque / echeq
      metodoPayload.banco_emisor = banco || undefined
      metodoPayload.numero_cheque = numeroCheque
      metodoPayload.fecha_cheque = fechaCheque || todayArgentina()
      if (metodo === "echeq") metodoPayload.color_cheque = "ECHEQ"
    }

    if (totalImputado > montoNum + 0.01) {
      toast({
        variant: "destructive",
        title: "Imputación excedida",
        description: "Lo imputado a comprobantes supera el monto del cobro.",
      })
      return
    }

    const listaImputaciones = Object.entries(imputaciones)
      .filter(([, v]) => Number(v) > 0)
      .map(([comprobante_id, v]) => ({ comprobante_id, monto_imputado: Number(v) }))

    setGuardando(true)
    try {
      const res = await fetch("/api/cobranzas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origen: "CAJA_DIA",
          // El efectivo entra a la caja en el acto; los valores esperan su Confirmar.
          confirmar: metodo === "efectivo",
          asignaciones: [
            {
              cliente_id: cliente.id,
              metodos: [metodoPayload],
              imputaciones: listaImputaciones.length ? listaImputaciones : undefined,
            },
          ],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error registrando el cobro")
      toast({
        title: metodo === "efectivo" ? "Cobro en caja" : "Cobro registrado",
        description:
          metodo === "efectivo"
            ? `${cliente.razon_social || cliente.nombre}: entró a la caja${listaImputaciones.length ? " e imputado" : ", pendiente de imputación (chip Imputar en la fila)"}.`
            : `${cliente.razon_social || cliente.nombre}: queda pendiente de confirmación en la lista.`,
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
    <div className="mb-4 rounded-xl border-2 border-blue-500 bg-white px-3.5 py-2.5">
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
          </>
        )}

        <input
          value={monto}
          onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && registrar()}
          placeholder="$ monto"
          inputMode="decimal"
          className={`${inputCls} w-32 text-right font-semibold`}
          style={{ fontVariantNumeric: "tabular-nums" }}
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

      {/* Imputación opcional al registrar (mismo criterio que choferes/viajantes) */}
      {cliente && comprobantes.length > 0 && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <button
            onClick={() => setImputarAbierto((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
          >
            {imputarAbierto ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Imputar a comprobantes ahora (opcional — si no, queda pendiente de imputación)
          </button>
          {imputarAbierto && (
            <div className="mt-2 flex flex-col gap-1">
              {comprobantes.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={imputaciones[c.id] != null}
                    onChange={(e) =>
                      setImputaciones((prev) => {
                        const next = { ...prev }
                        if (e.target.checked) {
                          const restante = (Number(monto.replace(",", ".")) || 0) - totalImputado
                          next[c.id] = Math.max(
                            0,
                            Math.min(Number(c.saldo_pendiente), restante > 0 ? restante : Number(c.saldo_pendiente))
                          )
                        } else delete next[c.id]
                        return next
                      })
                    }
                    className="h-3.5 w-3.5"
                  />
                  <span className="flex-1 truncate">
                    {c.tipo_comprobante} {c.numero_comprobante} —{" "}
                    <span className="text-orange-600" style={{ fontVariantNumeric: "tabular-nums" }}>
                      saldo $ {Number(c.saldo_pendiente).toLocaleString("es-AR")}
                    </span>
                  </span>
                  {imputaciones[c.id] != null && (
                    <input
                      value={imputaciones[c.id]}
                      onChange={(e) =>
                        setImputaciones((prev) => ({ ...prev, [c.id]: Number(e.target.value.replace(",", ".")) || 0 }))
                      }
                      inputMode="decimal"
                      className="w-28 rounded border border-slate-300 bg-white px-2 py-0.5 text-right text-xs outline-none focus:border-blue-500"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    />
                  )}
                </label>
              ))}
              <div className="text-right text-xs text-slate-500">
                Imputado: <b style={{ fontVariantNumeric: "tabular-nums" }}>$ {totalImputado.toLocaleString("es-AR")}</b>
                {" · "}lo que sobre queda a cuenta del cliente
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
