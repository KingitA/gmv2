"use client"

// "⇄ Mover plata" de la Caja del Día: transferencias entre cuentas (el
// "A CAJA A" / "DE CAJA A" de la hoja) y egresos/gastos, sin salir de la
// pantalla. Usa los endpoints existentes de finanzas (RPCs caja_transferir /
// caja_egreso). La plata a billeteras de choferes/viajantes llega en la
// Etapa 4 junto con el dual-write al kardex.

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { ArrowRightLeft, Loader2, X } from "lucide-react"
import type { CuentaFondos } from "./registrar-cobro"

const CATEGORIAS_EGRESO = ["OPERATIVO", "SUELDOS", "INVERSION", "CREDITO", "IMPUESTOS", "OTROS"]

const inputCls =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"

export function MoverPlata({
  cuentas,
  onMovido,
}: {
  cuentas: CuentaFondos[]
  onMovido: () => void
}) {
  const { toast } = useToast()
  const [abierto, setAbierto] = useState(false)
  const [modo, setModo] = useState<"transferencia" | "egreso" | "billetera">("transferencia")
  const [origen, setOrigen] = useState("")
  const [destino, setDestino] = useState("")
  const [categoria, setCategoria] = useState("OPERATIVO")
  const [monto, setMonto] = useState("")
  const [gastos, setGastos] = useState("")
  const [concepto, setConcepto] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [viajantes, setViajantes] = useState<{ id: string; nombre: string }[]>([])
  const [viajanteId, setViajanteId] = useState("")

  // Choferes/viajantes para "a cuenta viaje" (se cargan al abrir el modo)
  useEffect(() => {
    if (modo !== "billetera" || viajantes.length) return
    createClient()
      .from("vendedores")
      .select("id, nombre")
      .order("nombre")
      .then(({ data }) => setViajantes(data || []))
  }, [modo, viajantes.length])

  const movibles = useMemo(
    () => cuentas.filter((c) => c.grupo === "EFECTIVO" || c.grupo === "BANCOS"),
    [cuentas]
  )
  const origenDefault = useMemo(
    () =>
      movibles.find((c) => c.nombre.toLowerCase().includes("chica")) ??
      movibles.find((c) => c.grupo === "EFECTIVO") ??
      movibles[0],
    [movibles]
  )
  const clave = (c: CuentaFondos) => `${c.cuenta_tipo}:${c.cuenta_id}`
  const desClave = (k: string) => {
    const [tipo, id] = k.split(":")
    return { tipo, id }
  }

  const mover = async () => {
    const montoNum = Number(monto.replace(",", "."))
    const origenKey = origen || (origenDefault ? clave(origenDefault) : "")
    if (!origenKey || !montoNum || montoNum <= 0) {
      toast({ variant: "destructive", title: "Faltan datos", description: "Elegí la cuenta y un monto mayor a 0" })
      return
    }
    const o = desClave(origenKey)
    setGuardando(true)
    try {
      let res: Response
      if (modo === "transferencia") {
        if (!destino || destino === origenKey) {
          toast({ variant: "destructive", title: "Faltan datos", description: "Elegí una cuenta destino distinta" })
          setGuardando(false)
          return
        }
        const d = desClave(destino)
        res = await fetch("/api/finanzas/transferencias", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origen_tipo: o.tipo,
            origen_id: o.id,
            destino_tipo: d.tipo,
            destino_id: d.id,
            monto: montoNum,
            gastos: Number(gastos.replace(",", ".")) || 0,
            color: "BLANCO",
            concepto: concepto || undefined,
          }),
        })
      } else if (modo === "billetera") {
        if (!viajanteId) {
          toast({ variant: "destructive", title: "Faltan datos", description: "Elegí el chofer o viajante" })
          setGuardando(false)
          return
        }
        res = await fetch("/api/caja/entregar-billetera", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            viajante_id: viajanteId,
            origen_tipo: o.tipo,
            origen_id: o.id,
            monto: montoNum,
            concepto: concepto || undefined,
          }),
        })
      } else {
        if (!concepto.trim()) {
          toast({ variant: "destructive", title: "Falta el concepto", description: "Contá de qué es el gasto" })
          setGuardando(false)
          return
        }
        res = await fetch("/api/finanzas/egresos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origen_tipo: o.tipo,
            origen_id: o.id,
            categoria,
            monto: montoNum,
            color: "BLANCO",
            concepto,
          }),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error registrando el movimiento")
      toast({
        title:
          modo === "transferencia"
            ? "Plata movida"
            : modo === "billetera"
              ? "Plata entregada"
              : "Egreso registrado",
        description:
          modo === "transferencia" && data.neto_acreditado != null
            ? `El destino recibió $ ${Number(data.neto_acreditado).toLocaleString("es-AR")}.`
            : modo === "billetera"
              ? `Acreditado en la billetera de ${data.viajante ?? "el cobrador"}.`
              : "Quedó asentado en el libro del día.",
      })
      setMonto("")
      setGastos("")
      setConcepto("")
      onMovido()
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setGuardando(false)
    }
  }

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        <ArrowRightLeft className="h-4 w-4" /> Mover plata
      </button>
    )
  }

  return (
    <div className="mb-4 rounded-xl border-2 border-slate-400 bg-white px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="inline-flex rounded-lg bg-slate-200 p-0.5">
          {(["transferencia", "egreso", "billetera"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setModo(m)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                modo === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {m === "transferencia" ? "⇄ Entre cuentas" : m === "egreso" ? "↓ Egreso / gasto" : "🚚 A cuenta viaje"}
            </button>
          ))}
        </div>

        <span className="text-[11px] font-bold uppercase text-slate-400">De</span>
        <select
          value={origen || (origenDefault ? clave(origenDefault) : "")}
          onChange={(e) => setOrigen(e.target.value)}
          className={inputCls}
        >
          {movibles.map((c) => (
            <option key={clave(c)} value={clave(c)}>
              {c.nombre}
            </option>
          ))}
        </select>

        {modo === "transferencia" ? (
          <>
            <span className="text-[11px] font-bold uppercase text-slate-400">A</span>
            <select value={destino} onChange={(e) => setDestino(e.target.value)} className={inputCls}>
              <option value="">Cuenta destino…</option>
              {movibles.map((c) => (
                <option key={clave(c)} value={clave(c)}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <input
              value={gastos}
              onChange={(e) => setGastos(e.target.value.replace(/[^\d.,]/g, ""))}
              placeholder="Gastos banc."
              inputMode="decimal"
              className={`${inputCls} w-28 text-right`}
            />
          </>
        ) : modo === "billetera" ? (
          <>
            <span className="text-[11px] font-bold uppercase text-slate-400">A</span>
            <select value={viajanteId} onChange={(e) => setViajanteId(e.target.value)} className={inputCls}>
              <option value="">Chofer / viajante…</option>
              {viajantes.map((v) => (
                <option key={v.id} value={v.id}>
                  👛 Billetera {v.nombre}
                </option>
              ))}
            </select>
          </>
        ) : (
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={inputCls}>
            {CATEGORIAS_EGRESO.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}

        <input
          value={monto}
          onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && mover()}
          placeholder="$ monto"
          inputMode="decimal"
          className={`${inputCls} w-32 text-right font-semibold`}
          style={{ fontVariantNumeric: "tabular-nums" }}
        />
        <input
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
          placeholder={modo === "egreso" ? "Concepto (obligatorio)" : "Concepto (opcional)"}
          className={`${inputCls} min-w-[180px] flex-1`}
        />
        <button
          onClick={mover}
          disabled={guardando}
          className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
          Mover
        </button>
        <button
          onClick={() => setAbierto(false)}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
          title="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
