"use client"

// Barra de registro rápido de la Caja del Día: cliente + método + monto y listo.
// Crea el cobro PENDIENTE vía POST /api/cobranzas (confirmar:false): el efectivo
// queda "en caja" hasta el cierre; transferencias/echeqs/cheques quedan con su
// botón Confirmar en la misma lista.

import { useMemo, useState } from "react"
import { EntitySearchSelect } from "@/components/search/EntitySearchSelect"
import { FechaInput } from "@/components/finanzas/fecha-input"
import { useToast } from "@/hooks/use-toast"
import { todayArgentina } from "@/lib/utils"
import { Loader2, Plus } from "lucide-react"

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
  }

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

    setGuardando(true)
    try {
      const res = await fetch("/api/cobranzas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origen: "CAJA_DIA",
          confirmar: false,
          asignaciones: [{ cliente_id: cliente.id, metodos: [metodoPayload] }],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error registrando el cobro")
      toast({
        title: "Cobro registrado",
        description:
          metodo === "efectivo"
            ? `${cliente.razon_social || cliente.nombre}: queda en caja, se imputa al cierre.`
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
    </div>
  )
}
