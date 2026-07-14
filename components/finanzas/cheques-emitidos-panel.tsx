"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { formatCurrency, todayArgentina } from "@/lib/utils"
import { CheckCircle2, Loader2, PenLine, Plus } from "lucide-react"
import { toast } from "sonner"
import { ChequesEmitidosDialog } from "./cheques-emitidos-dialog"
import { FechaInput } from "./fecha-input"

export interface ChequeEmitido {
    id: string
    banco: string
    numero: string
    monto: number
    fecha_vencimiento: string
    color: string
    es_echeq: boolean
    proveedor_nombre?: string | null
}

const hoyISO = () => todayArgentina()

const mas30 = (iso: string) => {
    const d = new Date(iso + "T00:00:00")
    d.setDate(d.getDate() + 30)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const fmtAR = (iso: string) => {
    const [y, m, d] = iso.split("-")
    return `${d}/${m}/${y.slice(2)}`
}

/**
 * Cheques propios entregados y todavía no debitados. Cada uno puede
 * debitarse desde su fecha de pago y por 30 días; "Se debitó" lo concilia
 * (no toca saldos: el saldo del banco se ajusta manualmente / por kardex).
 */
export function ChequesEmitidosPanel({
    emitidos,
    loading,
    onChanged,
}: {
    emitidos: ChequeEmitido[]
    loading: boolean
    onChanged: () => void
}) {
    const [altaOpen, setAltaOpen] = useState(false)
    const [debitando, setDebitando] = useState<string | null>(null)
    const [fechas, setFechas] = useState<Record<string, string>>({})

    const hoy = hoyISO()
    const total = emitidos.reduce((s, c) => s + Number(c.monto), 0)
    const comprometidoHoy = emitidos
        .filter((c) => c.fecha_vencimiento <= hoy)
        .reduce((s, c) => s + Number(c.monto), 0)

    async function debitar(id: string) {
        setDebitando(id)
        try {
            const res = await fetch(`/api/cheques/${id}/debitar`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fecha_debito: fechas[id] || hoy }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error registrando el débito")
            toast.success("Débito conciliado")
            onChanged()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setDebitando(null)
        }
    }

    return (
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <PenLine className="h-4 w-4 text-red-500" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Cheques emitidos pendientes de débito
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-red-600">{formatCurrency(total)}</span>
                    <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setAltaOpen(true)}>
                        <Plus className="h-3.5 w-3.5" /> Cheque emitido
                    </Button>
                </div>
            </div>

            {loading ? (
                <p className="py-3 text-center text-xs text-muted-foreground">Cargando...</p>
            ) : emitidos.length === 0 ? (
                <p className="py-3 text-center text-xs text-muted-foreground">
                    No hay cheques emitidos sin debitar.
                </p>
            ) : (
                <div className="space-y-1.5">
                    {emitidos
                        .slice()
                        .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))
                        .map((c) => {
                            const vencida = mas30(c.fecha_vencimiento) < hoy
                            const cobrable = c.fecha_vencimiento <= hoy && !vencida
                            return (
                                <div
                                    key={c.id}
                                    className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-2.5 py-1.5 text-xs ${vencida ? "border-slate-200 bg-slate-50" : cobrable ? "border-red-200 bg-red-50/60" : "border-slate-200"}`}
                                >
                                    <span className="min-w-[120px] flex-1 truncate font-medium">
                                        {c.proveedor_nombre || "—"}
                                        <span className="block font-mono text-[10px] font-normal text-muted-foreground">
                                            {c.banco !== "S/D" ? `${c.banco} · ` : ""}#{c.numero}
                                            {c.es_echeq ? " · echeq" : c.color === "NEGRO" ? " · negro" : ""}
                                        </span>
                                    </span>
                                    <span className="font-mono text-[11px] text-slate-600">
                                        {fmtAR(c.fecha_vencimiento)} → {fmtAR(mas30(c.fecha_vencimiento))}
                                        <span className={`block text-[9.5px] font-semibold ${vencida ? "text-slate-400" : cobrable ? "text-red-600" : "text-amber-600"}`}>
                                            {vencida ? "venció sin presentar" : cobrable ? "puede debitarse ya" : `cobrable desde ${fmtAR(c.fecha_vencimiento)}`}
                                        </span>
                                    </span>
                                    <span className="font-mono text-sm font-bold">{formatCurrency(Number(c.monto))}</span>
                                    <span className="flex items-center gap-1">
                                        <FechaInput
                                            value={fechas[c.id] || hoy}
                                            onChange={(iso) => setFechas((prev) => ({ ...prev, [c.id]: iso || hoy }))}
                                            containerClassName="w-[110px]"
                                            className="h-6 px-1 py-0.5 text-[10px]"
                                        />
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 gap-1 border-emerald-300 px-2 text-[10px] text-emerald-700 hover:bg-emerald-50"
                                            disabled={debitando === c.id}
                                            onClick={() => debitar(c.id)}
                                        >
                                            {debitando === c.id
                                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                                : <CheckCircle2 className="h-3 w-3" />}
                                            Se debitó
                                        </Button>
                                    </span>
                                </div>
                            )
                        })}
                    <p className="pt-1 text-[10.5px] text-muted-foreground">
                        Comprometido hoy (ya cobrables): <b className="font-mono text-red-600">{formatCurrency(comprometidoHoy)}</b>.
                        Conciliar el débito no toca el saldo del banco — ajustalo con el lápiz al conciliar.
                    </p>
                </div>
            )}

            <ChequesEmitidosDialog
                open={altaOpen}
                onOpenChange={setAltaOpen}
                onSaved={onChanged}
            />
        </div>
    )
}
