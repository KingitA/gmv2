"use client"

import { useState, useRef } from "react"
import * as XLSX from "xlsx"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, Upload, FileSpreadsheet } from "lucide-react"
import { toast } from "sonner"

interface Mov {
  fecha: string
  descripcion: string
  monto: number
  referencia_externa?: string
}

/**
 * Import de extracto bancario (Excel/CSV del homebanking).
 * Detecta columnas por header: fecha, concepto/descripción, y débito/crédito
 * en columnas separadas o un único importe con signo. Los montos usan
 * PUNTO para centavos (1000.5 = $1.000,50) — igual que todo el sistema.
 */
export function ImportExtractoDialog({
  open,
  onOpenChange,
  cuentaId,
  cuentaNombre,
  onImported,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  cuentaId: string
  cuentaNombre: string
  onImported: () => void
}) {
  const [movs, setMovs] = useState<Mov[]>([])
  const [errores, setErrores] = useState<string[]>([])
  const [archivo, setArchivo] = useState("")
  const [subiendo, setSubiendo] = useState(false)
  const [leyendoPdf, setLeyendoPdf] = useState(false)
  const [meta, setMeta] = useState<{ fuente: string; saldo_inicial?: number | null; saldo_final?: number | null; periodo_desde?: string | null; periodo_hasta?: string | null }>({ fuente: "excel" })
  const fileRef = useRef<HTMLInputElement>(null)

  const norm = (s: any) =>
    String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()

  const toISO = (v: any): string | null => {
    if (v instanceof Date && !isNaN(v.getTime())) {
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`
    }
    if (typeof v === "number" && v > 20000) {
      const d = XLSX.SSF.parse_date_code(v)
      if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`
    }
    const t = String(v ?? "").trim()
    let m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
    if (m) {
      const anio = m[3].length === 2 ? `20${m[3]}` : m[3]
      return `${anio}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
    }
    m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
    return null
  }

  // Números de extracto: pueden venir "1.234.567,89" (formato banco) o
  // "1234567.89". Si hay coma decimal, los puntos son miles; si no, el
  // punto delimita centavos (regla del sistema).
  const toNum = (v: any): number => {
    if (typeof v === "number") return v
    let t = String(v ?? "").trim().replace(/\$|\s/g, "")
    if (!t) return 0
    const neg = /^-|\(/.test(t)
    t = t.replace(/[()\-]/g, "")
    if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".")
    const n = Number(t)
    return isNaN(n) ? 0 : neg ? -n : n
  }

  const parsePdf = async (file: File) => {
    setLeyendoPdf(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/finanzas/extractos/pdf", { method: "POST", body: fd })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setMovs(d.movimientos || [])
      setMeta({
        fuente: "pdf",
        saldo_inicial: d.saldo_inicial,
        saldo_final: d.saldo_final,
        periodo_desde: d.periodo_desde,
        periodo_hasta: d.periodo_hasta,
      })
      if (d.saldo_inicial != null && d.saldo_final != null) {
        const suma = (d.movimientos || []).reduce((s: number, m: Mov) => s + m.monto, 0)
        const esperado = Number(d.saldo_final) - Number(d.saldo_inicial)
        if (Math.abs(suma - esperado) > 1) {
          setErrores([
            `⚠ Control de saldos: los movimientos suman ${fmt(suma)} pero el extracto dice ${fmt(esperado)} (final − inicial). Revisá el preview antes de importar.`,
          ])
        }
      }
    } catch (e: any) {
      setErrores([`No se pudo leer el PDF: ${e.message}`])
    } finally {
      setLeyendoPdf(false)
    }
  }

  const parseFile = async (file: File) => {
    setArchivo(file.name)
    setErrores([])
    setMovs([])
    setMeta({ fuente: "excel" })
    if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
      await parsePdf(file)
      return
    }
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { cellDates: true })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })

      // Buscar la fila de headers (los extractos suelen traer título o bloques
      // de saldo arriba — ej. MercadoPago pone INITIAL_BALANCE en la fila 1 y
      // los headers reales en la fila 4). Sinónimos ES + EN.
      const esFecha = (x: string) => x.includes("fecha") || x.includes("date")
      const esImporte = (x: string) =>
        x.includes("debito") || x.includes("credito") || x.includes("debit") || x.includes("credit") ||
        x.includes("importe") || x.includes("monto") || x.includes("amount")
      let hIdx = -1
      for (let i = 0; i < Math.min(data.length, 15); i++) {
        const h = data[i].map(norm)
        if (h.some(esFecha) && h.some(esImporte)) {
          hIdx = i
          break
        }
      }
      if (hIdx < 0) {
        setErrores(["No se detectó la fila de encabezados. Se esperan columnas con fecha ('fecha'/'date') y débito/crédito o importe ('importe'/'amount')."])
        return
      }
      const headers = data[hIdx].map(norm)
      const idxDe = (...cands: string[]) => {
        for (const c of cands) {
          const i = headers.findIndex((h) => h.includes(c))
          if (i >= 0) return i
        }
        return -1
      }
      const iFecha = idxDe("fecha", "release_date", "date")
      const iDesc = idxDe("concepto", "descrip", "detalle", "movimiento", "transaction_type", "description", "operacion", "leyenda")
      const iDeb = idxDe("debito", "debit")
      const iCred = idxDe("credito", "credit")
      const iImp = idxDe("net_amount", "importe", "monto", "amount")
      const iRef = idxDe("comprobante", "referencia", "reference", "comprob", "nro. operacion", "numero de operacion", "id")

      const filas: Mov[] = []
      const errs: string[] = []
      for (let i = hIdx + 1; i < data.length; i++) {
        const row = data[i]
        if (!row || row.every((c) => String(c ?? "").trim() === "")) continue
        const fecha = toISO(row[iFecha])
        if (!fecha) continue // filas de saldo/subtotal
        let monto = 0
        if (iDeb >= 0 || iCred >= 0) {
          const deb = iDeb >= 0 ? toNum(row[iDeb]) : 0
          const cred = iCred >= 0 ? toNum(row[iCred]) : 0
          monto = cred - Math.abs(deb)
        } else if (iImp >= 0) {
          monto = toNum(row[iImp])
        }
        if (!monto) {
          errs.push(`Fila ${i + 1}: sin importe`)
          continue
        }
        filas.push({
          fecha,
          descripcion: iDesc >= 0 ? String(row[iDesc] ?? "").trim() : "",
          monto,
          referencia_externa: iRef >= 0 && String(row[iRef] ?? "").trim() ? String(row[iRef]).trim() : undefined,
        })
      }
      if (!filas.length) errs.push("No se encontraron movimientos válidos.")
      setMovs(filas)
      setErrores(errs.slice(0, 5))
    } catch (e: any) {
      setErrores([`No se pudo leer el archivo: ${e.message}`])
    }
  }

  const importar = async () => {
    setSubiendo(true)
    try {
      const res = await fetch("/api/finanzas/extractos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cuenta_bancaria_id: cuentaId,
          fuente: meta.fuente,
          saldo_inicial: meta.saldo_inicial ?? undefined,
          saldo_final: meta.saldo_final ?? undefined,
          periodo_desde: meta.periodo_desde ?? undefined,
          periodo_hasta: meta.periodo_hasta ?? undefined,
          movimientos: movs,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success(
        `Extracto importado: ${d.importados} movimientos nuevos` +
          (d.duplicados ? ` (${d.duplicados} ya estaban)` : "") +
          ` · ${d.matching?.sugeridos ?? 0} matches sugeridos`
      )
      setMovs([]); setArchivo("")
      onOpenChange(false)
      onImported()
    } catch (e: any) {
      toast.error(`Error al importar: ${e.message}`)
    } finally {
      setSubiendo(false)
    }
  }

  const creditos = movs.filter((m) => m.monto > 0)
  const debitos = movs.filter((m) => m.monto < 0)
  const fmt = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Importar extracto — {cuentaNombre}
          </DialogTitle>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv,.pdf"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])}
        />
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={leyendoPdf}>
            {leyendoPdf ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            Elegir archivo
          </Button>
          <span className="text-sm text-muted-foreground">
            {leyendoPdf ? "Leyendo PDF con OCR… puede tardar un minuto" : archivo || "Excel, CSV o PDF del banco"}
          </span>
        </div>

        {errores.length > 0 && (
          <div className="text-sm text-red-600 space-y-1">{errores.map((e, i) => <p key={i}>{e}</p>)}</div>
        )}

        {movs.length > 0 && (
          <>
            <p className="text-sm">
              <b>{movs.length}</b> movimientos · {creditos.length} créditos {fmt(creditos.reduce((s, m) => s + m.monto, 0))} ·{" "}
              {debitos.length} débitos {fmt(debitos.reduce((s, m) => s + m.monto, 0))}
            </p>
            <div className="max-h-64 overflow-y-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movs.slice(0, 50).map((m, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap">{m.fecha}</TableCell>
                      <TableCell className="max-w-[320px] truncate">{m.descripcion}</TableCell>
                      <TableCell className={`text-right tabular-nums ${m.monto < 0 ? "text-red-600" : "text-green-700"}`}>
                        {fmt(m.monto)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {movs.length > 50 && (
                <p className="text-xs text-muted-foreground p-2">… y {movs.length - 50} más</p>
              )}
            </div>
            <div className="flex justify-end">
              <Button onClick={importar} disabled={subiendo}>
                {subiendo ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Importar y matchear
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
