"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EntitySearchSelect } from "@/components/search/EntitySearchSelect"
import { FechaInput } from "@/components/finanzas/fecha-input"
import { formatCurrency, todayArgentina } from "@/lib/utils"
import { Plus, CheckCircle2, AlertTriangle, Landmark, HandCoins, Loader2, Pencil, ChevronDown, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { ChequesEmitidosDialog, type PrefillEmitidos } from "@/components/finanzas/cheques-emitidos-dialog"

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Vencimiento {
    id: string
    proveedor_id: string | null
    tipo: string
    concepto: string
    monto: number
    fecha_vencimiento: string
    fecha_validez: string | null
    forma_pago: string | null
    modalidad: string | null
    descuentos_aplicados: boolean
    estado: string
    observaciones: string | null
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
const hoyISO = () => todayArgentina()
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
    const [emitidos, setEmitidos] = useState<ChequeCartera[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [prefillEmitidos, setPrefillEmitidos] = useState<PrefillEmitidos | null>(null)
    const [chequeChoice, setChequeChoice] = useState<Vencimiento | null>(null)
    const [mesesSaldadosAbiertos, setMesesSaldadosAbiertos] = useState<Set<string>>(new Set())
    const [mesesPlegados, setMesesPlegados] = useState<Set<string>>(new Set())
    const plegadosInicializados = useRef(false)

    // Filtros
    const [formasActivas, setFormasActivas] = useState<Set<string>>(new Set(Object.keys(FORMAS)))
    const [filtroModalidad, setFiltroModalidad] = useState<string>("todas")
    // Cartera y saldados arrancan apagados para no ensuciar la vista
    const [verCheques, setVerCheques] = useState(false)
    const [verEmitidos, setVerEmitidos] = useState(true)
    const [verSaldados, setVerSaldados] = useState(false)

    // Selección (cinta)
    const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
    const [diasExpandidos, setDiasExpandidos] = useState<Set<string>>(new Set())

    // Alta / edición
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editando, setEditando] = useState<Vencimiento | null>(null)
    const [form, setForm] = useState({
        proveedor: null as any,
        tipo: "factura",
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
            const reqs: Promise<any>[] = [fetch("/api/vencimientos?estado=todos").then((r) => r.json())]
            if (showCheques) {
                reqs.push(fetch("/api/cheques?estado=EN_CARTERA&tipo=TERCERO").then((r) => r.json()))
                reqs.push(fetch("/api/cheques?estado=ENTREGADO_A_PROVEEDOR&tipo=PROPIO").then((r) => r.json()))
            }
            const [vencs, chq, emit] = await Promise.all(reqs)
            setVencimientos(Array.isArray(vencs) ? vencs.filter((v: Vencimiento) => v.estado !== "cancelado") : [])
            if (showCheques) {
                setCheques(chq?.cheques || [])
                setEmitidos(emit?.cheques || [])
            }
        } catch (e) {
            console.error(e)
            toast.error("Error cargando el calendario")
        } finally {
            setLoading(false)
        }
    }, [showCheques])

    useEffect(() => { load() }, [load])

    // ── Derivados ──────────────────────────────────────────────────────────
    const pasaFiltros = useCallback(
        (v: Vencimiento) =>
            formasActivas.has(formaDe(v)) &&
            (filtroModalidad === "todas" || v.modalidad === filtroModalidad),
        [formasActivas, filtroModalidad]
    )

    // Pendientes (operables: se seleccionan, se marcan pagados)
    const visibles = useMemo(
        () => vencimientos.filter((v) => v.estado !== "pagado" && pasaFiltros(v)),
        [vencimientos, pasaFiltros]
    )

    // Saldados (solo visualización, con el filtro activado). Los del mes
    // vigente (y futuros) van al calendario; los de meses anteriores a una
    // lista desplegable por mes para no inflar el calendario con historia.
    const mesActual = hoyISO().slice(0, 7)
    const saldados = useMemo(
        () => (verSaldados ? vencimientos.filter((v) => v.estado === "pagado" && pasaFiltros(v)) : []),
        [vencimientos, pasaFiltros, verSaldados]
    )
    const saldadosCalendario = useMemo(
        () => saldados.filter((v) => v.fecha_vencimiento.slice(0, 7) >= mesActual),
        [saldados, mesActual]
    )
    const saldadosAnteriores = useMemo(() => {
        const porMes: Record<string, Vencimiento[]> = {}
        saldados
            .filter((v) => v.fecha_vencimiento.slice(0, 7) < mesActual)
            .forEach((v) => { (porMes[v.fecha_vencimiento.slice(0, 7)] ||= []).push(v) })
        return Object.entries(porMes)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([mes, items]) => ({
                mes,
                items: items.sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento)),
                total: items.reduce((s, v) => s + Number(v.monto), 0),
            }))
    }, [saldados, mesActual])

    const porFecha = useMemo(() => {
        const m: Record<string, Vencimiento[]> = {}
        visibles.forEach((v) => { (m[v.fecha_vencimiento] ||= []).push(v) })
        return m
    }, [visibles])

    const saldadosPorFecha = useMemo(() => {
        const m: Record<string, Vencimiento[]> = {}
        saldadosCalendario.forEach((v) => { (m[v.fecha_vencimiento] ||= []).push(v) })
        return m
    }, [saldadosCalendario])

    const chequesPorFecha = useMemo(() => {
        const m: Record<string, ChequeCartera[]> = {}
        if (showCheques && verCheques) cheques.forEach((c) => { (m[c.fecha_vencimiento] ||= []).push(c) })
        return m
    }, [cheques, showCheques, verCheques])

    const emitidosPorFecha = useMemo(() => {
        const m: Record<string, ChequeCartera[]> = {}
        if (showCheques && verEmitidos) emitidos.forEach((c) => { (m[c.fecha_vencimiento] ||= []).push(c) })
        return m
    }, [emitidos, showCheques, verEmitidos])

    const meses = useMemo(() => {
        const set = new Set<string>()
        visibles.forEach((v) => set.add(v.fecha_vencimiento.slice(0, 7)))
        saldadosCalendario.forEach((v) => set.add(v.fecha_vencimiento.slice(0, 7)))
        if (showCheques && verCheques) cheques.forEach((c) => set.add(c.fecha_vencimiento.slice(0, 7)))
        if (showCheques && verEmitidos) emitidos.forEach((c) => set.add(c.fecha_vencimiento.slice(0, 7)))
        return [...set].sort().map((s) => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) - 1 }))
    }, [visibles, saldadosCalendario, cheques, emitidos, showCheques, verCheques, verEmitidos])

    // Al cargar por primera vez, los meses anteriores al vigente arrancan plegados
    useEffect(() => {
        if (plegadosInicializados.current || meses.length === 0) return
        plegadosInicializados.current = true
        setMesesPlegados(new Set(
            meses
                .map(({ y, m }) => `${y}-${String(m + 1).padStart(2, "0")}`)
                .filter((k) => k < mesActual)
        ))
    }, [meses, mesActual])

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

    async function marcarPagados(ids: string[], vencCheque?: Vencimiento) {
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
            // Pago con cheque: preguntar si fue con cheques de terceros o propios
            if (vencCheque && vencCheque.forma_pago === "cheque" && !fallidos) {
                setChequeChoice(vencCheque)
            }
        } finally {
            setSaving(false)
        }
    }

    async function volverAPendiente(id: string) {
        if (!confirm("¿Volver este pago a pendiente?")) return
        setSaving(true)
        try {
            const res = await fetch("/api/vencimientos", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, estado: "pendiente" }),
            })
            if (!res.ok) toast.error("No se pudo revertir")
            else toast.success("Pago vuelto a pendiente")
            await load()
            onDataChanged?.()
        } finally {
            setSaving(false)
        }
    }

    function resetForm() {
        setEditando(null)
        setForm({
            proveedor: null, tipo: "factura", concepto: "", monto: "", forma_pago: "transferencia",
            fecha_vencimiento: hoyISO(), fecha_validez: "", modalidad: "deposito",
            descuentos_aplicados: false, observaciones: "",
        })
    }

    function abrirEdicion(v: Vencimiento) {
        setEditando(v)
        setForm({
            proveedor: v.proveedores ? { id: v.proveedores.id, nombre: v.proveedores.nombre } : null,
            tipo: v.tipo || "factura",
            concepto: v.concepto || "",
            monto: String(Number(v.monto)),
            forma_pago: v.forma_pago || "transferencia",
            fecha_vencimiento: v.fecha_vencimiento,
            fecha_validez: v.fecha_validez || "",
            modalidad: v.modalidad || "deposito",
            descuentos_aplicados: !!v.descuentos_aplicados,
            observaciones: v.observaciones || "",
        })
        setDialogOpen(true)
    }

    async function guardarVencimiento(e: React.FormEvent) {
        e.preventDefault()
        const monto = parseFloat(form.monto.replace(/\./g, "").replace(",", "."))
        if (!monto || monto <= 0) { toast.error("Monto inválido"); return }
        const concepto = form.concepto.trim() || form.proveedor?.nombre || ""
        if (!concepto) { toast.error("Ingresá un concepto o elegí un proveedor"); return }
        if (!form.fecha_vencimiento) { toast.error("Fecha de pago inválida (dd/mm/aaaa)"); return }
        setSaving(true)
        try {
            const payload = {
                proveedor_id: form.proveedor?.id || null,
                tipo: form.tipo,
                concepto,
                monto,
                fecha_vencimiento: form.fecha_vencimiento,
                fecha_validez: form.fecha_validez || null,
                forma_pago: form.forma_pago,
                modalidad: form.modalidad,
                descuentos_aplicados: form.descuentos_aplicados,
                observaciones: form.observaciones || null,
            }
            const res = await fetch("/api/vencimientos", {
                method: editando ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(editando ? { id: editando.id, ...payload } : payload),
            })
            if (!res.ok) {
                const err = await res.json()
                toast.error(err.error || `Error al ${editando ? "modificar" : "crear"} el vencimiento`)
                return
            }
            toast.success(editando ? "Vencimiento modificado" : "Vencimiento creado")
            setDialogOpen(false)
            resetForm()
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
                <button
                    onClick={() => setVerSaldados((v) => !v)}
                    className={`flex items-center gap-1.5 rounded-full border border-slate-400 px-3 py-1 text-xs font-semibold text-slate-600 transition-all ${verSaldados ? "bg-slate-100 shadow-sm" : "opacity-40"}`}
                >
                    <CheckCircle2 className="h-3 w-3" />
                    Saldados
                </button>
                {showCheques && (
                    <>
                        <button
                            onClick={() => setVerCheques((v) => !v)}
                            className={`flex items-center gap-1.5 rounded-full border border-emerald-600 px-3 py-1 text-xs font-semibold text-emerald-700 transition-all ${verCheques ? "bg-emerald-50" : "opacity-40 line-through"}`}
                        >
                            <span className="h-2 w-2 rounded-sm bg-emerald-600" />
                            Cheques en cartera
                        </button>
                        <button
                            onClick={() => setVerEmitidos((v) => !v)}
                            className={`flex items-center gap-1.5 rounded-full border border-red-500 px-3 py-1 text-xs font-semibold text-red-600 transition-all ${verEmitidos ? "bg-red-50" : "opacity-40 line-through"}`}
                        >
                            <span className="h-2 w-2 rounded-sm bg-red-500" />
                            Cheques emitidos
                        </button>
                    </>
                )}
                <div className="ml-auto">
                    <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm() }}>
                        <DialogTrigger asChild>
                            <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Nuevo pago</Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                            <DialogHeader><DialogTitle>{editando ? "Editar pago / gasto" : "Nuevo pago / gasto"}</DialogTitle></DialogHeader>
                            <form onSubmit={guardarVencimiento} className="space-y-4">
                                <div className="grid grid-cols-[130px_1fr] gap-4">
                                    <div>
                                        <Label>Tipo *</Label>
                                        <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="factura">Factura de proveedor</SelectItem>
                                                <SelectItem value="sueldos">Sueldos</SelectItem>
                                                <SelectItem value="cargas_sociales">Cargas sociales (931, sindicatos, OS)</SelectItem>
                                                <SelectItem value="impuestos">Impuestos (IVA, IIBB, CM, municipal)</SelectItem>
                                                <SelectItem value="servicios">Servicios (luz, expensas, teléfono, web)</SelectItem>
                                                <SelectItem value="honorarios">Honorarios (contador, programador)</SelectItem>
                                                <SelectItem value="seguros">Seguros (vida, flota)</SelectItem>
                                                <SelectItem value="vehiculos">Vehículos (gastos extra de flota)</SelectItem>
                                                <SelectItem value="socios">Socios (adelantos / participaciones)</SelectItem>
                                                <SelectItem value="otro">Otro gasto</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <Label>Proveedor {form.tipo === "factura" ? "" : "(opcional)"}</Label>
                                        <EntitySearchSelect
                                            entity="proveedores"
                                            placeholder={form.tipo === "factura" ? "Buscar proveedor..." : "Gasto sin proveedor..."}
                                            value={form.proveedor}
                                            onSelect={(p: any) => setForm({ ...form, proveedor: p })}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <Label>Concepto {form.proveedor ? "" : "*"}</Label>
                                    <Input
                                        value={form.concepto}
                                        onChange={(e) => setForm({ ...form, concepto: e.target.value })}
                                        placeholder={form.proveedor?.nombre ? `${form.proveedor.nombre} (por defecto)` : "Ej: SICORE, VEP 931, expensas, seguro cuota 3..."}
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
                                        <FechaInput
                                            value={form.fecha_vencimiento}
                                            onChange={(iso) => setForm({ ...form, fecha_vencimiento: iso })}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <Label>Fecha validez</Label>
                                        <FechaInput
                                            value={form.fecha_validez}
                                            onChange={(iso) => setForm({ ...form, fecha_validez: iso })}
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
                                    <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); resetForm() }}>Cancelar</Button>
                                    <Button type="submit" disabled={saving}>
                                        {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} {editando ? "Guardar cambios" : "Crear"}
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

                            const mesKey = `${y}-${String(m + 1).padStart(2, "0")}`
                            const plegado = mesesPlegados.has(mesKey)
                            return (
                                <section key={mesKey} className="rounded-xl border bg-white p-4 shadow-sm">
                                    <h2 className={`flex flex-wrap items-center gap-3 px-1 text-base font-bold ${plegado ? "mb-0" : "mb-3"}`}>
                                        <button
                                            onClick={() =>
                                                setMesesPlegados((prev) => {
                                                    const n = new Set(prev)
                                                    n.has(mesKey) ? n.delete(mesKey) : n.add(mesKey)
                                                    return n
                                                })
                                            }
                                            title={plegado ? "Desplegar mes" : "Plegar mes"}
                                            className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-slate-100"
                                        >
                                            {plegado
                                                ? <ChevronRight className="h-4 w-4 text-slate-400" />
                                                : <ChevronDown className="h-4 w-4 text-slate-400" />}
                                            {MES_NOMBRES[m]} {y}
                                        </button>
                                        {min > 0 && (
                                            <span className="text-xs font-semibold text-emerald-600">▲ entra {formatCurrency(min)}</span>
                                        )}
                                        <span className="ml-auto font-mono text-xs font-medium text-muted-foreground">
                                            ▼ sale {formatCurrency(mtot)}
                                        </span>
                                    </h2>
                                    {!plegado && (<>
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
                                            const pagados = saldadosPorFecha[key] || []
                                            const chqs = chequesPorFecha[key] || []
                                            const emits = emitidosPorFecha[key] || []
                                            const dsum = pagos.reduce((a, p) => a + Number(p.monto), 0)
                                            const chqSum = chqs.reduce((a, c) => a + Number(c.monto), 0)
                                            const emitSum = emits.reduce((a, c) => a + Number(c.monto), 0)
                                            const expandido = diasExpandidos.has(key)
                                            return (
                                                <div
                                                    key={key}
                                                    className={`flex min-h-[84px] flex-col gap-1 rounded-md border p-1 ${pagos.length || pagados.length || chqs.length || emits.length ? "border-slate-300 bg-white" : "border-slate-100 bg-slate-50/50"} ${key === hoy ? "ring-2 ring-amber-400" : ""}`}
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
                                                        const nombre = p.proveedores?.nombre || p.concepto
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
                                                                <div className="absolute right-0.5 top-0.5 hidden flex-col gap-0.5 group-hover/chip:flex">
                                                                    <button
                                                                        onClick={(ev) => { ev.stopPropagation(); marcarPagados([p.id], p) }}
                                                                        title="Marcar como pagado"
                                                                        className="rounded bg-white/80 p-0.5 text-emerald-600 hover:bg-emerald-600 hover:text-white"
                                                                    >
                                                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                                                    </button>
                                                                    <button
                                                                        onClick={(ev) => { ev.stopPropagation(); abrirEdicion(p) }}
                                                                        title="Editar"
                                                                        className="rounded bg-white/80 p-0.5 text-slate-500 hover:bg-slate-600 hover:text-white"
                                                                    >
                                                                        <Pencil className="h-3.5 w-3.5" />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                    {pagados.map((p) => {
                                                        const f = FORMAS[formaDe(p)]
                                                        const nombre = p.proveedores?.nombre || p.concepto
                                                        return (
                                                            <div key={p.id} className="group/chip relative">
                                                                <div
                                                                    title={`PAGADO · ${p.concepto} · ${f.label} · ${formatCurrency(Number(p.monto))}`}
                                                                    className="w-full rounded-md border border-slate-300 bg-slate-100 px-1.5 py-1 opacity-70"
                                                                    style={{ borderLeftWidth: 3, borderLeftColor: f.color }}
                                                                >
                                                                    <span className="flex items-center gap-1 text-[10px] font-semibold leading-tight text-slate-500">
                                                                        <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
                                                                        <span className="truncate line-through">{nombre}</span>
                                                                    </span>
                                                                    <span className="block font-mono text-[9.5px] text-slate-400 line-through">
                                                                        {formatCurrency(Number(p.monto))}
                                                                    </span>
                                                                </div>
                                                                <button
                                                                    onClick={() => volverAPendiente(p.id)}
                                                                    title="Volver a pendiente"
                                                                    className="absolute right-0.5 top-0.5 hidden rounded p-0.5 text-slate-500 hover:bg-slate-600 hover:text-white group-hover/chip:block"
                                                                >
                                                                    ↩
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
                                                    {emits.length > 0 && (
                                                        <button
                                                            onClick={() =>
                                                                setDiasExpandidos((prev) => {
                                                                    const n = new Set(prev)
                                                                    const k2 = `emit:${key}`
                                                                    n.has(k2) ? n.delete(k2) : n.add(k2)
                                                                    return n
                                                                })
                                                            }
                                                            title={`Cheques emitidos: cobrables desde ${fmtCorta(key)} y por 30 días`}
                                                            className="rounded-md border border-dashed border-red-500 bg-red-50 px-1.5 py-0.5 text-left hover:bg-red-100"
                                                        >
                                                            <span className="flex justify-between text-[9px] font-bold text-red-700">
                                                                <span>▼ {emits.length} emit.</span>
                                                                <span className="font-mono">{formatCurrency(emitSum)}</span>
                                                            </span>
                                                            {diasExpandidos.has(`emit:${key}`) && (
                                                                <span className="mt-0.5 block space-y-0.5">
                                                                    {emits.map((c) => (
                                                                        <span key={c.id} className="flex justify-between font-mono text-[8.5px] text-red-800">
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
                                    </>)}
                                </section>
                            )
                        })
                    )}

                    {/* Saldados de meses anteriores (desplegables) */}
                    {verSaldados && saldadosAnteriores.length > 0 && (
                        <section className="rounded-xl border bg-white p-4 shadow-sm">
                            <h2 className="mb-2 px-1 text-base font-bold text-slate-600">Saldados de meses anteriores</h2>
                            <div className="space-y-1.5">
                                {saldadosAnteriores.map(({ mes, items, total }) => {
                                    const abierto = mesesSaldadosAbiertos.has(mes)
                                    const [y, m] = mes.split("-").map(Number)
                                    return (
                                        <div key={mes} className="rounded-lg border border-slate-200">
                                            <button
                                                onClick={() =>
                                                    setMesesSaldadosAbiertos((prev) => {
                                                        const n = new Set(prev)
                                                        n.has(mes) ? n.delete(mes) : n.add(mes)
                                                        return n
                                                    })
                                                }
                                                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
                                            >
                                                <span className="flex items-center gap-2 font-semibold text-slate-700">
                                                    <span className={`transition-transform ${abierto ? "rotate-90" : ""}`}>▸</span>
                                                    {MES_NOMBRES[m - 1]} {y}
                                                    <span className="font-normal text-muted-foreground">({items.length} pagos)</span>
                                                </span>
                                                <span className="font-mono text-sm font-bold text-slate-600">{formatCurrency(total)}</span>
                                            </button>
                                            {abierto && (
                                                <div className="space-y-0.5 border-t border-slate-100 px-3 py-2">
                                                    {items.map((v) => (
                                                        <div key={v.id} className="group/sal flex items-baseline gap-2 rounded px-1 py-0.5 text-xs hover:bg-slate-50">
                                                            <span className="h-2 w-2 shrink-0 self-center rounded-full" style={{ background: FORMAS[formaDe(v)].color }} />
                                                            <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">{fmtCorta(v.fecha_vencimiento)}</span>
                                                            <span className="min-w-0 flex-1 truncate text-slate-600">{v.proveedores?.nombre || v.concepto}</span>
                                                            <span className="font-mono font-medium text-slate-600">{formatCurrency(Number(v.monto))}</span>
                                                            <button
                                                                onClick={() => volverAPendiente(v.id)}
                                                                title="Volver a pendiente"
                                                                className="hidden rounded px-1 text-slate-400 hover:bg-slate-600 hover:text-white group-hover/sal:block"
                                                            >
                                                                ↩
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </section>
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
                                                {v.proveedores?.nombre || v.concepto}
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
                            {showCheques && <> Verde punteado = <b>cheques en cartera</b> que vencen ese día · rojo punteado = <b>cheques emitidos</b> cobrables desde ese día (30 días de ventana).</>}
                        </p>
                    </div>
                </div>
            </div>

            {/* Pago con cheque: ¿terceros o propios? */}
            <Dialog open={!!chequeChoice} onOpenChange={(o) => { if (!o) setChequeChoice(null) }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>¿Con qué cheques pagaste?</DialogTitle>
                    </DialogHeader>
                    {chequeChoice && (
                        <p className="text-sm text-muted-foreground">
                            {chequeChoice.proveedores?.nombre || chequeChoice.concepto} · <b className="font-mono">{formatCurrency(Number(chequeChoice.monto))}</b>
                        </p>
                    )}
                    <div className="grid grid-cols-1 gap-2">
                        <Button
                            variant="outline"
                            className="h-auto justify-start py-3 text-left"
                            onClick={() => setChequeChoice(null)}
                        >
                            <span>
                                <span className="block font-semibold">Cheques de terceros</span>
                                <span className="block text-xs font-normal text-muted-foreground">
                                    De la cartera — no hace falta cargar nada más.
                                </span>
                            </span>
                        </Button>
                        <Button
                            variant="outline"
                            className="h-auto justify-start py-3 text-left"
                            onClick={() => {
                                const v = chequeChoice!
                                setChequeChoice(null)
                                setPrefillEmitidos({
                                    proveedor: v.proveedores
                                        ? { id: v.proveedores.id, nombre: v.proveedores.nombre }
                                        : null,
                                    vencimiento_id: v.id,
                                    monto: Number(v.monto),
                                    fecha: v.fecha_validez || v.fecha_vencimiento,
                                })
                            }}
                        >
                            <span>
                                <span className="block font-semibold">Cheques propios</span>
                                <span className="block text-xs font-normal text-muted-foreground">
                                    Emitidos por vos — cargás número, banco y fecha de pago.
                                </span>
                            </span>
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <ChequesEmitidosDialog
                open={!!prefillEmitidos}
                onOpenChange={(o) => { if (!o) setPrefillEmitidos(null) }}
                prefill={prefillEmitidos}
                onSaved={() => { load(); onDataChanged?.() }}
            />
        </div>
    )
}
