"use client"

import { useState, useRef } from "react"
import * as XLSX from "xlsx"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency } from "@/lib/utils"
import { FileSpreadsheet, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"

type Cartera = "BLANCO" | "NEGRO" | "ECHEQ"
type ModoCartera = "AUTO" | Cartera

const MODOS: Record<ModoCartera, string> = {
    AUTO: "Detección automática (E / - / /)",
    BLANCO: "Cheques blanco",
    NEGRO: "Cheques negro",
    ECHEQ: "Echeqs",
}

const CARTERA_LABEL: Record<Cartera, { label: string; className: string }> = {
    BLANCO: { label: "Blanco", className: "bg-slate-100 text-slate-700" },
    NEGRO: { label: "Negro", className: "bg-slate-800 text-white" },
    ECHEQ: { label: "Echeq", className: "bg-blue-100 text-blue-700" },
}

interface Fila {
    numero: string
    monto: number
    fecha_vencimiento: string
    banco?: string
    cartera: Cartera
    sinMarca: boolean
}

/**
 * Clasifica un número de cheque según la convención del sistema externo:
 *   empieza con E            → echeq
 *   empieza o termina con -  → negro
 *   empieza o termina con /  → blanco
 * Devuelve el número limpio (sin marcadores) y la cartera detectada.
 */
function detectarCartera(raw: string): { numero: string; cartera: Cartera; sinMarca: boolean } {
    const t = raw.trim()
    let cartera: Cartera | null = null
    if (/^[eE]\d/.test(t)) cartera = "ECHEQ"
    else if (/^-|-$/.test(t)) cartera = "NEGRO"
    else if (/^\/|\/$/.test(t)) cartera = "BLANCO"
    let numero = t.replace(/^[eE](?=\d)/, "").replace(/^[/\-]+/, "").replace(/[/\-]+$/, "").trim()
    return { numero, cartera: cartera ?? "BLANCO", sinMarca: cartera === null }
}

/** Detecta columnas por nombre de header (flexible) y normaliza filas. */
function parseSheet(data: any[][], modo: ModoCartera): { filas: Fila[]; errores: string[] } {
    const errores: string[] = []
    if (!data.length) return { filas: [], errores: ["Archivo vacío"] }

    const norm = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()
    const headers = data[0].map(norm)
    const usados = new Set<number>()
    const idxDe = (...cands: string[]) => {
        for (const c of cands) {
            const i = headers.findIndex((h, idx) => h.includes(c) && !usados.has(idx))
            if (i >= 0) { usados.add(i); return i }
        }
        return -1
    }

    // Orden importa: primero fecha (captura "fech.valor"), después monto/importe
    const iFecha = idxDe("venc", "fech", "valor")
    const iNumero = idxDe("numero", "nro", "cheque", "n°")
    const iMonto = idxDe("monto", "importe", "valor")
    const iBanco = idxDe("banco")

    if (iFecha < 0 || iMonto < 0 || iNumero < 0) {
        return {
            filas: [],
            errores: [`No se detectaron las columnas. Se esperan headers con fecha ("fecha"/"vencimiento"/"fech.valor"), monto ("monto"/"importe") y número ("numero"/"nro"/"cheque"). Encontrados: ${data[0].join(", ")}`],
        }
    }

    const toISO = (v: any): string | null => {
        if (v instanceof Date && !isNaN(v.getTime())) {
            return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`
        }
        if (typeof v === "number") {
            const d = XLSX.SSF.parse_date_code(v)
            if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`
            return null
        }
        const s = String(v ?? "").trim()
        let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/)
        if (m) {
            let y = Number(m[3]); if (y < 100) y += 2000
            return `${y}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`
        }
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
        if (m) return `${m[1]}-${m[2]}-${m[3]}`
        return null
    }

    const toMonto = (v: any): number | null => {
        if (typeof v === "number") return v > 0 ? v : null
        let t = String(v ?? "").trim().replace(/\$/g, "").replace(/\s/g, "")
        if (!t) return null
        if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".")
        const n = parseFloat(t)
        return n > 0 ? n : null
    }

    const filas: Fila[] = []
    data.slice(1).forEach((row, i) => {
        const vacia = row.every((c) => String(c ?? "").trim() === "")
        if (vacia) return
        const fecha = toISO(row[iFecha])
        const monto = toMonto(row[iMonto])
        const rawNumero = String(row[iNumero] ?? "").trim()
        if (!fecha || !monto || !rawNumero) {
            errores.push(`Fila ${i + 2}: ${!fecha ? "fecha inválida" : !monto ? "monto inválido" : "sin número"}`)
            return
        }
        const det = detectarCartera(rawNumero)
        if (!det.numero) {
            errores.push(`Fila ${i + 2}: número inválido ("${rawNumero}")`)
            return
        }
        filas.push({
            numero: det.numero,
            monto,
            fecha_vencimiento: fecha,
            banco: iBanco >= 0 ? String(row[iBanco] ?? "").trim() || undefined : undefined,
            cartera: modo === "AUTO" ? det.cartera : modo,
            sinMarca: modo === "AUTO" ? det.sinMarca : false,
        })
    })
    return { filas, errores }
}

export function ImportChequesDialog({
    open,
    onOpenChange,
    carteraInicial = "AUTO",
    onImported,
}: {
    open: boolean
    onOpenChange: (o: boolean) => void
    carteraInicial?: ModoCartera
    onImported?: () => void
}) {
    const [modo, setModo] = useState<ModoCartera>(carteraInicial)
    const [filas, setFilas] = useState<Fila[]>([])
    const [errores, setErrores] = useState<string[]>([])
    const [archivo, setArchivo] = useState<string>("")
    const [darBaja, setDarBaja] = useState(false)
    const [saving, setSaving] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)
    const [ultimaData, setUltimaData] = useState<any[][] | null>(null)

    function procesar(data: any[][], nombreArchivo: string, m: ModoCartera) {
        const { filas: f, errores: err } = parseSheet(data, m)
        setFilas(f)
        setErrores(err)
        setArchivo(nombreArchivo)
        if (!f.length) toast.error("No se pudo leer ningún cheque del archivo")
    }

    async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        try {
            const buffer = await file.arrayBuffer()
            const wb = XLSX.read(buffer, { type: "array", cellDates: true })
            const ws = wb.Sheets[wb.SheetNames[0]]
            const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" })
            setUltimaData(data)
            procesar(data, file.name, modo)
        } catch (err: any) {
            toast.error(`Error leyendo el archivo: ${err.message}`)
        } finally {
            if (fileRef.current) fileRef.current.value = ""
        }
    }

    function cambiarModo(m: ModoCartera) {
        setModo(m)
        if (ultimaData) procesar(ultimaData, archivo, m)
    }

    async function importar() {
        if (!filas.length) return
        setSaving(true)
        try {
            const res = await fetch("/api/cheques/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    cartera: modo,
                    cheques: filas.map((f) => ({
                        numero: f.numero,
                        monto: f.monto,
                        fecha_vencimiento: f.fecha_vencimiento,
                        banco: f.banco,
                        cartera: f.cartera,
                    })),
                    dar_baja_faltantes: darBaja,
                }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error importando cheques")
            const porCartera = json.por_cartera
                ? Object.entries(json.por_cartera as Record<string, any>)
                    .map(([k, r]) => `${CARTERA_LABEL[k as Cartera]?.label ?? k}: ${r.insertados} nuevos`)
                    .join(" · ")
                : ""
            const extras = [
                json.reactivados ? `${json.reactivados} reactivados` : "",
                json.dados_de_baja ? `${json.dados_de_baja} dados de baja` : "",
                json.duplicados_excel ? `${json.duplicados_excel} repetidos en el Excel` : "",
                json.conflictos ? `${json.conflictos} con conflicto (depositados/emitidos, sin tocar)` : "",
            ].filter(Boolean).join(", ")
            toast.success(
                `${json.insertados} nuevos, ${json.ya_existian} ya existían${extras ? `, ${extras}` : ""}${porCartera ? ` (${porCartera})` : ""}`,
                { duration: 8000 }
            )
            setFilas([])
            setArchivo("")
            setUltimaData(null)
            onOpenChange(false)
            onImported?.()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setSaving(false)
        }
    }

    const total = filas.reduce((a, f) => a + f.monto, 0)
    const sinMarca = filas.filter((f) => f.sinMarca).length
    const resumen = (["BLANCO", "NEGRO", "ECHEQ"] as Cartera[])
        .map((k) => ({ k, n: filas.filter((f) => f.cartera === k).length }))
        .filter((r) => r.n > 0)

    return (
        <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setFilas([]); setErrores([]); setArchivo(""); setUltimaData(null) } }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5" /> Importar cheques desde Excel
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label>Cartera</Label>
                            <Select value={modo} onValueChange={(v) => cambiarModo(v as ModoCartera)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {Object.entries(MODOS).map(([k, l]) => (
                                        <SelectItem key={k} value={k}>{l}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Archivo</Label>
                            <Button
                                type="button"
                                variant="outline"
                                className="w-full justify-start gap-2 font-normal"
                                onClick={() => fileRef.current?.click()}
                            >
                                <Upload className="h-4 w-4" />
                                <span className="truncate">{archivo || "Elegir .xlsx / .xls / .csv"}</span>
                            </Button>
                            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Columnas esperadas: <b>fecha valor / vencimiento</b>, <b>número</b> y <b>monto / importe</b> (banco opcional).
                        {modo === "AUTO" && <> En detección automática el número define la cartera: <b>E…</b> = echeq · <b>-</b> al inicio o final = negro · <b>/</b> al inicio o final = blanco. Los marcadores se quitan del número al guardar.</>}
                    </p>

                    {errores.length > 0 && (
                        <div className="max-h-24 overflow-auto rounded-md bg-red-50 p-2 text-xs text-red-700">
                            {errores.map((e, i) => <div key={i}>{e}</div>)}
                        </div>
                    )}

                    {filas.length > 0 && (
                        <>
                            <div className="max-h-64 overflow-auto rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="text-xs">Vencimiento</TableHead>
                                            <TableHead className="text-xs">Número</TableHead>
                                            <TableHead className="text-xs">Cartera</TableHead>
                                            <TableHead className="text-right text-xs">Monto</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filas.map((f, i) => (
                                            <TableRow key={i}>
                                                <TableCell className="py-1 font-mono text-xs">{f.fecha_vencimiento}</TableCell>
                                                <TableCell className="py-1 font-mono text-xs">{f.numero}</TableCell>
                                                <TableCell className="py-1 text-xs">
                                                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${CARTERA_LABEL[f.cartera].className}`}>
                                                        {CARTERA_LABEL[f.cartera].label}
                                                    </span>
                                                    {f.sinMarca && <span className="ml-1 text-[10px] text-amber-600" title="Número sin marcador E / - / — se asume blanco">⚠ sin marca</span>}
                                                </TableCell>
                                                <TableCell className="py-1 text-right font-mono text-xs">{formatCurrency(f.monto)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                <span className="text-muted-foreground">
                                    {filas.length} cheques
                                    {resumen.length > 0 && (
                                        <> · {resumen.map((r) => `${r.n} ${CARTERA_LABEL[r.k].label.toLowerCase()}`).join(" · ")}</>
                                    )}
                                    {sinMarca > 0 && <span className="ml-1 text-amber-600">({sinMarca} sin marca → blanco)</span>}
                                </span>
                                <span className="font-mono font-bold">{formatCurrency(total)}</span>
                            </div>
                            <label className="flex items-start gap-2 rounded-lg border p-3 cursor-pointer">
                                <Checkbox checked={darBaja} onCheckedChange={(c) => setDarBaja(!!c)} className="mt-0.5" />
                                <span className="text-sm">
                                    <span className="font-medium">Dar de baja los que no figuran en el Excel</span>
                                    <span className="block text-xs text-muted-foreground">
                                        Los cheques EN CARTERA {modo === "AUTO" ? "de las tres carteras" : "de esta cartera"} que no estén en el archivo se marcan como COBRADOS. Usalo solo si el Excel es la foto completa.
                                    </span>
                                </span>
                            </label>
                        </>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                        <Button onClick={importar} disabled={!filas.length || saving}>
                            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                            Importar {filas.length > 0 ? `(${filas.length})` : ""}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
