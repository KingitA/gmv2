"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EntitySearchSelect } from "@/components/search/EntitySearchSelect"
import { formatCurrency } from "@/lib/utils"
import { Plus, CheckCircle2, AlertTriangle, Landmark, HandCoins, Loader2 } from "lucide-react"
import { toast } from "sonner"

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Vencimiento {
    id: string
    proveedor_id: string | null
    concepto: string
    monto: number
    fecha_vencimiento: string
    fecha_validez: string | null
    forma_pago: string | null
    modalidad: string | null
    descuentos_aplicados: boolean
    estado: string
    proveedores?: { id: string; nombre: string; sigla: string | null } | null
}

interface ChequeCartera {
    id: string
    numero: string
    monto: number
    fecha_vencimiento: string
    color: string
    es_echeq: boolean
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const FORMAS: Record<string, { label: string; color: string }> = {
    transferencia: { label: "Transferencia", color: "#2f6fb0" },
    cheque: { label: "Cheque", color: "#c08a2d" },
    efectivo: { label: "Efectivo", color: "#1f8a5b" },
    sin_forma: { label: "Sin forma", color: "#64748b" },
}

const MES_NOMBRES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]
const DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

const formaDe = (v: Vencimiento) => v.forma_pago || "sin_forma"
const hoyISO = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
const fmtCorta = (iso: string) => {
    const [, m, d] = iso.split("-")
    return `${d}/${m}`
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function CalendarioPagos({
    showCheques = false,
    onDataChanged,
}: {
    /** Mostrar los cheques en cartera como entradas verdes (solo /finanzas) */
    showCheques?: boolean
    onDataChanged?: () => void
}) {
    const [vencimientos, setVencimientos] = useState<Vencimiento[]>([])
    const [cheques, setCheques] = useState<ChequeCartera[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // Filtros
    const [formasActivas, setFormasActivas] = useState<Set<string>>(new Set(Object.keys(FORMAS)))
    const [filtroModalidad, setFiltroModalidad] = useState<string>("todas")
    const [verCheques, setVerCheques] = useState(true)

    // Selección (cinta)
    const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
    const [diasExpandidos, setDiasExpandidos] = useState<Set<string>>(new Set())

    // Alta
    const [dialogOpen, setDialogOpen] = useState(false)
    const [form, setForm] = useState({
        proveedor: null as any,
        concepto: "",
        monto: "",
        forma_pago: "transferencia",
        fecha_vencimiento: hoyISO(),
        fecha_validez: "",
        modalidad: "deposito",
        descuentos_aplicados: false,
        observaciones: "",
    })

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const reqs: Promise<any>[] = [fetch("/api/vencimientos?estado=pendiente").then((r) => r.json())]
            if (showCheques) reqs.push(fetch("/api/cheques?estado=EN_CARTERA").then((r) => r.json()))
            const [vencs, chq] = await Promise.all(reqs)
            setVencimientos(Array.isArray(vencs) ? vencs : [])
            if (showCheques) setCheques(chq?.cheques || [])
        } catch (e) {
            console.error(e)
            toast.error("Error cargando el calendario")
        } finally {
            setLoading(false)
        }
    }, [showCheques])

    useEffect(() => { load() }, [load])

    // ── Derivados ──────────────────────────────────────────────────────────
    const visibles = useMemo(
        () =>
            vencimientos.filter(
                (v) =>
                    formasActivas.has(formaDe(v)) &&
                    (filtroModalidad === "todas" || v.modalidad === filtroModalidad)
            ),
        [vencimientos, formasActivas, filtroModalidad]
    )

    const porFecha = useMemo(() => {
        const m: Record<string, Vencimiento[]> = {}
        visibles.forEach((v) => { (m[v.fecha_vencimiento] ||= []).push(v) })
        return m
    }, [visibles])

    const chequesPorFecha = useMemo(() => {
        const m: Record<string, ChequeCartera[]> = {}
        if (showCheques && verCheques) cheques.forEach((c) => { (m[c.fecha_vencimiento] ||= []).push(c) })
        return m
    }, [cheques, showCheques, verCheques])

    const meses = useMemo(() => {
        const set = new Set<string>()
        visibles.forEach((v) => set.add(v.fecha_vencimiento.slice(0, 7)))
        if (showCheques && verCheques) cheques.forEach((c) => set.add(c.fecha_vencimiento.slice(0, 7)))
        return [...set].sort().map((s) => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) - 1 }))
    }, [visibles, cheques, showCheques, verCheques])

    const seleccionados = useMemo(
        () => vencimientos.filter((v) => seleccion.has(v.id)),
        [vencimientos, seleccion]
    )
    const totalSeleccion = seleccionados.reduce((a, v) => a + Number(v.monto), 0)
    const totalVisible = visibles.reduce((a, v) => a + Number(v.monto), 0)

    const breakdownSeleccion = useMemo(() => {
        const m: Record<string, number> = {}
        seleccionados.forEach((v) => { m[formaDe(v)] = (m[formaDe(v)] || 0) + Number(v.monto) })
        return m
    }, [seleccionados])

    // ── Acciones ───────────────────────────────────────────────────────────
    const toggleSel = (id: string) =>
        setSeleccion((prev) => {
            const n = new Set(prev)
            n.has(id) ? n.delete(id) : n.add(id)
            return n
        })

    const toggleForma = (k: string) =>
        setFormasActivas((prev) => {
            const n = new Set(prev)
            n.has(k) ? n.delete(k) : n.add(k)
            if (n.size === 0) n.add(k)
            return n
        })

    async function marcarPagados(ids: string[]) {
        if (!ids.length) return
        if (!confirm(`¿Marcar ${ids.length === 1 ? "este pago" : `estos ${ids.length} pagos`} como pagado${ids.length > 1 ? "s" : ""}?`)) return
        setSaving(true)
        try {
            const results = await Promise.all(
                ids.map((id) =>
                    fetch("/api/vencimientos", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id, estado: "pagado" }),
                    })
                )
            )
            const fallidos = results.filter((r) => !r.ok).length
            if (fallidos) toast.error(`${fallidos} pago(s) no se pudieron marcar`)
            else toast.success(ids.length === 1 ? "Pago marcado como pagado" : `${ids.length} pagos marcados como pagados`)
            setSeleccion((prev) => {
                const n = new Set(prev)
                ids.forEach((id) => n.delete(id))
                return n
            })
            await load()
            onDataChanged?.()
        } finally {
            setSaving(false)
        }
    }

    async function crearVencimiento(e: React.FormEvent) {
        e.preventDefault()
        const monto = parseFloat(form.monto.replace(/\./g, "").replace(",", "."))
        if (!monto || monto <= 0) { toast.error("Monto inválido"); return }
        const concepto = form.concepto.trim() || form.proveedor?.nombre || ""
        if (!concepto) { toast.error("Ingresá un concepto o elegí un proveedor"); return }
        setSaving(true)
        try {
            const res = await fetch("/api/vencimientos", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    proveedor_id: form.proveedor?.id || null,
                    tipo: "factura",
                    concepto,
                    monto,
                    fecha_vencimiento: form.fecha_vencimiento,
                    fecha_validez: form.fecha_validez || null,
                    forma_pago: form.forma_pago,
                    modalidad: form.modalidad,
                    descuentos_aplicados: form.descuentos_aplicados,
                    observaciones: form.observaciones || null,
                }),
            })
            if (!res.ok) {
                const err = await res.json()
                toast.error(err.error || "Error al crear el vencimiento")
                return
            }
            toast.success("Vencimiento creado")
            setDialogOpen(false)
            setForm({
                proveedor: null, concepto: "", monto: "", forma_pago: "transferencia",
                fecha_vencimiento: hoyISO(), fecha_validez: "", modalidad: "deposito",
                descuentos_aplicados: false, observaciones: "",
            })
            await load()
            onDataChanged?.()
        } finally {
            setSaving(false)
        }
    }

    // ── Render ─────────────────────────────────────────────────────────────
    const hoy = hoyISO()

    return (
        <div className="space-y-4">
            {/* Filtros + alta */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-1">
                    Forma de pago
                </span>
                {Object.entries(FORMAS).map(([k, f]) => (
                    <button
                        key={k}
                        onClick={() => toggleForma(k)}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all ${formasActivas.has(k) ? "bg-white shadow-sm" : "opacity-40 line-through"}`}
                        style={{ borderColor: f.color, color: f.color }}
                    >
                        <span className="h-2 w-2 rounded-full" style={{ background: f.color }} />
                        {f.label}
                    </button>
                ))}
                <Select value={filtroModalidad} onValueChange={setFiltroModalidad}>
                    <SelectTrigger className="h-7 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="todas">Depósito y entrega</SelectItem>
                        <SelectItem value="deposito">Solo depósito</SelectItem>
                        <SelectItem value="entrega">Solo entrega</SelectItem>
                    </SelectContent>
                </Select>
                {showCheques && (
                    <button
                        onClick={() => setVerCheques((v) => !v)}
                        className={`flex items-center gap-1.5 rounded-full border border-emerald-600 px-3 py-1 text-xs font-semibold text-emerald-700 transition-all ${verCheques ? "bg-emerald-50" : "opacity-40 line-through"}`}
                    >
                        <span className="h-2 w-2 rounded-sm bg-emerald-600" />
                        Cheques en cartera
                    </button>
                )}
                <div className="ml-auto">
                    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                        <DialogTrigger asChild>
                            <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Nuevo pago</Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                            <DialogHeader><DialogTitle>Nuevo pago a proveedor</DialogTitle></DialogHeader>
                            <form onSubmit={crearVencimiento} className="space-y-4">
                                <div>
                                    <Label>Proveedor</Label>
                                    <EntitySearchSelect
                                        entity="proveedores"
                                        placeholder="Buscar proveedor..."
                                        value={form.proveedor}
                                        onSelect={(p: any) => setForm({ ...form, proveedor: p })}
                                    />
                                </div>
                                <div>
                                    <Label>Concepto</Label>
                                    <Input
                                        value={form.concepto}
                                        onChange={(e) => setForm({ ...form, concepto: e.target.value })}
                                        placeholder={form.proveedor?.nombre ? `${form.proveedor.nombre} (por defecto)` : "Ej: Factura A 0001-00045678"}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label>Monto *</Label>
                                        <Input
                                            inputMode="decimal"
                                            value={form.monto}
                                            onChange={(e) => setForm({ ...form, monto: e.target.value })}
                                            placeholder="0"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <Label>Forma de pago *</Label>
                                        <Select value={form.forma_pago} onValueChange={(v) => setForm({ ...form, forma_pago: v })}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="efectivo">Efectivo</SelectItem>
                                                <SelectItem value="transferencia">Transferencia</SelectItem>
                                                <SelectItem value="cheque">Cheque</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label>Fecha de pago *</Label>
                                        <Input
                                            type="date"
                                            value={form.fecha_vencimiento}
                                            onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <Label>Fecha validez</Label>
                                        <Input
                                            type="date"
                                            value={form.fecha_validez}
                                            onChange={(e) => setForm({ ...form, fecha_validez: e.target.value })}
                                        />
                                        <p className="mt-1 text-[11px] text-muted-foreground">
                                            Ej: cheques a 30 días. Vacío = misma fecha.
                                        </p>
                                    </div>
                                </div>
                                <div>
                                    <Label>Modalidad</Label>
                                    <Select value={form.modalidad} onValueChange={(v) => setForm({ ...form, modalidad: v })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="deposito">Depósito (lo deposito yo)</SelectItem>
                                            <SelectItem value="entrega">Entrega (queda en caja, lo retira el proveedor)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <label className="flex items-start gap-2 rounded-lg border p-3 cursor-pointer">
                                    <Checkbox
                                        checked={form.descuentos_aplicados}
                                        onCheckedChange={(c) => setForm({ ...form, descuentos_aplicados: !!c })}
                                        className="mt-0.5"
                                    />
                                    <span className="text-sm">
                                        <span className="font-medium">Descuentos ya aplicados</span>
                                        <span className="block text-xs text-muted-foreground">
                                            Si queda desmarcado, el calendario lo señala para chequear notas de crédito / retenciones.
                                        </span>
                                    </span>
                                </label>
                                <div>
                                    <Label>Observaciones</Label>
                                    <Input
                                        value={form.observaciones}
                                        onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
                                    />
                                </div>
                                <div className="flex justify-end gap-2">
                                    <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                                    <Button type="submit" disabled={saving}>
                                        {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Crear
                                    </Button>
                                </div>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Calendario + cinta */}
            <div className="grid gap-5 lg:grid-cols-[1fr_300px] items-start">
                <div className="space-y-6">
                    {loading ? (
                        <div className="rounded-xl border bg-white p-10 text-center text-sm text-muted-foreground">
                            Cargando calendario...
                        </div>
                    ) : meses.length === 0 ? (
                        <div className="rounded-xl border bg-white p-10 text-center text-sm text-muted-foreground">
                            No hay pagos pendientes con estos filtros.
                        </div>
                    ) : (
                        meses.map(({ y, m }) => {
                            const mtot = visibles
                                .filter((v) => v.fecha_vencimiento.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`))
                                .reduce((a, v) => a + Number(v.monto), 0)
                            const min = showCheques && verCheques
                                ? cheques
                                    .filter((c) => c.fecha_vencimiento.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`))
                                    .reduce((a, c) => a + Number(c.monto), 0)
                                : 0
                            const first = new Date(y, m, 1)
                            const startIdx = (first.getDay() + 6) % 7
                            const daysInMonth = new Date(y, m + 1, 0).getDate()

                            return (
                                <section key={`${y}-${m}`} className="rounded-xl border bg-white p-4 shadow-sm">
                                    <h2 className="mb-3 flex flex-wrap items-baseline gap-3 px-1 text-base font-bold">
                                        {MES_NOMBRES[m]} {y}
                                        {min > 0 && (
                                            <span className="text-xs font-semibold text-emerald-600">▲ entra {formatCurrency(min)}</span>
                                        )}
                                        <span className="ml-auto font-mono text-xs font-medium text-muted-foreground">
                                            ▼ sale {formatCurrency(mtot)}
                                        </span>
                                    </h2>
                                    <div className="mb-1 grid grid-cols-7 gap-1">
                                        {DOW.map((d) => (
                                            <span key={d} className="pl-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{d}</span>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-7 gap-1">
                                        {Array.from({ length: startIdx }).map((_, i) => (
                                            <div key={`e${i}`} className="min-h-[84px] rounded-md border border-dashed border-slate-100" />
                                        ))}
                                        {Array.from({ length: daysInMonth }).map((_, i) => {
                                            const d = i + 1
                                            const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
                                            const pagos = porFecha[key] || []
                                            const chqs = chequesPorFecha[key] || []
                                            const dsum = pagos.reduce((a, p) => a + Number(p.monto), 0)
                                            const chqSum = chqs.reduce((a, c) => a + Number(c.monto), 0)
                                            const expandido = diasExpandidos.has(key)
                                            return (
                                                <div
                                                    key={key}
                                                    className={`flex min-h-[84px] flex-col gap-1 rounded-md border p-1 ${pagos.length || chqs.length ? "border-slate-300 bg-white" : "border-slate-100 bg-slate-50/50"} ${key === hoy ? "ring-2 ring-amber-400" : ""}`}
                                                >
                                                    <div className="flex items-center justify-between px-0.5">
                                                        <span className={`font-mono text-[11px] font-semibold ${pagos.length ? "text-slate-700" : "text-slate-400"}`}>{d}</span>
                                                        {dsum > 0 && (
                                                            <span className="font-mono text-[9px] text-slate-400">{formatCurrency(dsum)}</span>
                                                        )}
                                                    </div>
                                                    {pagos.map((p) => {
                                                        const f = FORMAS[formaDe(p)]
                                                        const sel = seleccion.has(p.id)
                                                        const nombre = p.proveedores?.sigla || p.proveedores?.nombre || p.concepto
                                                        return (
                                                            <div key={p.id} className="group/chip relative">
                                                                <button
                                                                    onClick={() => toggleSel(p.id)}
                                                                    title={`${p.concepto} · ${f.label} · ${formatCurrency(Number(p.monto))}${p.fecha_validez ? ` · validez ${fmtCorta(p.fecha_validez)}` : ""}${p.modalidad ? ` · ${p.modalidad}` : ""}${!p.descuentos_aplicados ? " · ⚠ chequear NC/retenciones" : ""}`}
                                                                    className="w-full rounded-md border px-1.5 py-1 text-left transition-all hover:-translate-y-px hover:shadow"
                                                                    style={{
                                                                        borderColor: f.color,
                                                                        borderLeftWidth: 3,
                                                                        background: sel ? f.color : `${f.color}18`,
                                                                    }}
                                                                >
                                                                    <span className={`flex items-center gap-1 text-[10px] font-semibold leading-tight ${sel ? "text-white" : "text-slate-700"}`}>
                                                                        {p.modalidad === "entrega"
                                                                            ? <HandCoins className={`h-3 w-3 shrink-0 ${sel ? "text-white" : ""}`} style={sel ? {} : { color: f.color }} />
                                                                            : p.modalidad === "deposito"
                                                                                ? <Landmark className={`h-3 w-3 shrink-0 ${sel ? "text-white" : ""}`} style={sel ? {} : { color: f.color }} />
                                                                                : null}
                                                                        <span className="truncate">{nombre}</span>
                                                                        {!p.descuentos_aplicados && (
                                                                            <AlertTriangle className={`h-3 w-3 shrink-0 ${sel ? "text-amber-200" : "text-amber-500"}`} />
                                                                        )}
                                                                    </span>
                                                                    <span className={`block font-mono text-[9.5px] ${sel ? "text-white/80" : "text-slate-500"}`}>
                                                                        {formatCurrency(Number(p.monto))}
                                                                        {p.fecha_validez && p.fecha_validez !== p.fecha_vencimiento && (
                                                                            <span className="ml-1">→ {fmtCorta(p.fecha_validez)}</span>
                                                                        )}
                                                                    </span>
                                                                </button>
                                                                <button
                                                                    onClick={(ev) => { ev.stopPropagation(); marcarPagados([p.id]) }}
                                                                    title="Marcar como pagado"
                                                                    className="absolute right-0.5 top-0.5 hidden rounded p-0.5 text-emerald-600 hover:bg-emerald-600 hover:text-white group-hover/chip:block"
                                                                >
                                                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                        )
                                                    })}
                                                    {chqs.length > 0 && (
                                                        <button
                                                            onClick={() =>
                                                                setDiasExpandidos((prev) => {
                                                                    const n = new Set(prev)
                                                                    n.has(key) ? n.delete(key) : n.add(key)
                                                                    return n
                                                                })
                                                            }
                                                            className="rounded-md border border-dashed border-emerald-600 bg-emerald-50 px-1.5 py-0.5 text-left hover:bg-emerald-100"
                                                        >
                                                            <span className="flex justify-between text-[9px] font-bold text-emerald-700">
                                                                <span>▲ {chqs.length} chq</span>
                                                                <span className="font-mono">{formatCurrency(chqSum)}</span>
                                                            </span>
                                                            {expandido && (
                                                                <span className="mt-0.5 block space-y-0.5">
                                                                    {chqs.map((c) => (
                                                                        <span key={c.id} className="flex justify-between font-mono text-[8.5px] text-emerald-800">
                                                                            <span>#{c.numero}{c.es_echeq ? " (e)" : c.color === "NEGRO" ? " (N)" : ""}</span>
                                                                            <span>{formatCurrency(Number(c.monto))}</span>
                                                                        </span>
                                                                    ))}
                                                                </span>
                                                            )}
                                                        </button>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                </section>
                            )
                        })
                    )}
                </div>

                {/* Cinta de pagos */}
                <div className="lg:sticky lg:top-20 space-y-3">
                    <div className="rounded-xl border bg-amber-50/60 p-4 shadow-sm">
                        <h3 className="text-center text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800/70">
                            Cinta de pagos
                        </h3>
                        <p className="mt-1 text-center font-mono text-[11px] text-muted-foreground">
                            {seleccionados.length} {seleccionados.length === 1 ? "pago seleccionado" : "pagos seleccionados"}
                        </p>
                        <hr className="my-2 border-dashed border-amber-200" />
                        {seleccionados.length === 0 ? (
                            <p className="py-4 text-center text-xs text-muted-foreground">
                                Tocá los pagos del calendario para sumarlos acá.
                            </p>
                        ) : (
                            <ul className="max-h-[32vh] space-y-1 overflow-auto">
                                {seleccionados
                                    .slice()
                                    .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))
                                    .map((v) => (
                                        <li
                                            key={v.id}
                                            onClick={() => toggleSel(v.id)}
                                            className="flex cursor-pointer items-baseline gap-2 rounded px-1 py-0.5 font-mono text-[11px] hover:bg-amber-100/70"
                                        >
                                            <span className="h-2 w-2 shrink-0 self-center rounded-full" style={{ background: FORMAS[formaDe(v)].color }} />
                                            <span className="min-w-0 flex-1 truncate">
                                                {v.proveedores?.sigla || v.proveedores?.nombre || v.concepto}
                                                <span className="block text-[9px] text-muted-foreground">{fmtCorta(v.fecha_vencimiento)}</span>
                                            </span>
                                            <span className="font-medium">{formatCurrency(Number(v.monto))}</span>
                                        </li>
                                    ))}
                            </ul>
                        )}
                        {Object.keys(breakdownSeleccion).length > 1 && (
                            <div className="mt-2 space-y-0.5">
                                {Object.entries(breakdownSeleccion).map(([k, tot]) => (
                                    <div key={k} className="flex justify-between font-mono text-[10.5px] text-slate-600">
                                        <span className="flex items-center gap-1.5">
                                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: FORMAS[k].color }} />
                                            {FORMAS[k].label}
                                        </span>
                                        <span>{formatCurrency(tot)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="mt-2 flex items-baseline justify-between border-y-2 border-slate-800 py-2">
                            <span className="text-[11px] font-bold uppercase tracking-wider">Total</span>
                            <span className="font-mono text-lg font-bold">{formatCurrency(totalSeleccion)}</span>
                        </div>
                        <div className="mt-3 flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 text-xs"
                                onClick={() => setSeleccion(new Set(visibles.map((v) => v.id)))}
                            >
                                Sumar visibles
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 text-xs"
                                onClick={() => setSeleccion(new Set())}
                            >
                                Limpiar
                            </Button>
                        </div>
                        {seleccionados.length > 0 && (
                            <Button
                                size="sm"
                                className="mt-2 w-full gap-1 bg-emerald-600 text-xs hover:bg-emerald-700"
                                disabled={saving}
                                onClick={() => marcarPagados(seleccionados.map((v) => v.id))}
                            >
                                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                Marcar como pagados ({seleccionados.length})
                            </Button>
                        )}
                    </div>
                    <div className="rounded-xl border bg-white p-3 text-[11px] leading-relaxed text-muted-foreground shadow-sm">
                        <p>
                            Total visible con estos filtros: <b className="font-mono">{formatCurrency(totalVisible)}</b>.
                            El <AlertTriangle className="inline h-3 w-3 text-amber-500" /> marca pagos <b>sin descuentos aplicados</b> (chequear NC / retenciones).
                            <Landmark className="ml-1 inline h-3 w-3" /> = depósito · <HandCoins className="inline h-3 w-3" /> = entrega en caja.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
