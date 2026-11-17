"use client"

/**
 * ImportarDatosProveedoresDialog — importa el Excel "proveedores-para-completar.xlsx"
 * (datos para comprar y pagar: mails, CBU, acuerdo de pago, Ganancias, entrega).
 *
 * Flujo: elegir archivo → vista previa fila por fila (qué cambia, errores, avisos) →
 * confirmar → resultado. El Excel se lee acá; la validación y la comparación con la base
 * las hace SIEMPRE el servidor (/api/proveedores/importar-datos), también al guardar.
 * Lo vacío no se modifica. Solo admin: el botón no aparece para otros roles.
 */

import React, { useMemo, useRef, useState } from "react"
import * as XLSX from "xlsx"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Upload, ArrowRight, AlertCircle, AlertTriangle, CheckCircle2, Loader2, FileSpreadsheet } from "lucide-react"
import { useMisRoles } from "@/lib/hooks/useMisRoles"
import { fecha, parseFecha } from "@/lib/formato"
import { leerFilasExcel, type FilaCruda } from "@/lib/proveedores/importar-datos"

type Estado = "cambios" | "sin_cambios" | "error" | "no_existe"
interface FilaPrevia {
  fila: number
  codigo: string | null
  nombre_excel: string | null
  nombre_sistema: string | null
  estado: Estado
  cambios: { campo: string; etiqueta: string; antes: string; despues: string }[]
  errores: { columna: string; mensaje: string }[]
  avisos: string[]
}
interface Resumen { total: number; con_cambios: number; sin_cambios: number; con_errores: number; no_existen: number }
interface Resultado {
  guardados: number
  sin_cambios: number
  fallidos: number
  fallidas: { fila: number; codigo: string | null; nombre: string | null; mensaje: string }[]
}
type Paso = "archivo" | "previa" | "resultado"
type Filtro = "todas" | "cambios" | "errores" | "sin_cambios"

const PASOS: { id: Paso; nombre: string }[] = [
  { id: "archivo", nombre: "1. Archivo" },
  { id: "previa", nombre: "2. Vista previa" },
  { id: "resultado", nombre: "3. Resultado" },
]

/**
 * Hoja → matriz de textos (`raw: false, defval: ""`). Las celdas con formato de fecha se pasan
 * antes a dd/mm/aaaa: Excel las guarda como número y SheetJS las escribiría mes/día.
 */
function matrizDeHoja(hoja: XLSX.WorkSheet): unknown[][] {
  for (const dir of Object.keys(hoja)) {
    if (dir.startsWith("!")) continue
    const celda = hoja[dir] as XLSX.CellObject
    if (celda?.t === "n" && typeof celda.v === "number" && celda.z && XLSX.SSF.is_date(String(celda.z))) {
      const iso = parseFecha(celda.v)
      if (iso) celda.w = fecha(iso)
    }
  }
  return XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: "" }) as unknown[][]
}

async function llamar(cuerpo: unknown): Promise<any> {
  const res = await fetch("/api/proveedores/importar-datos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  })
  const texto = await res.text()
  let data: any
  try { data = JSON.parse(texto) } catch { throw new Error(`El servidor respondió algo inesperado (${res.status}).`) }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`)
  return data
}

export function ImportarDatosProveedoresDialog({ onImportado }: { onImportado?: () => void }) {
  const { esAdmin } = useMisRoles()
  const inputRef = useRef<HTMLInputElement>(null)
  const enviando = useRef(false)
  const [abierto, setAbierto] = useState(false)
  const [paso, setPaso] = useState<Paso>("archivo")
  const [archivo, setArchivo] = useState("")
  const [crudas, setCrudas] = useState<FilaCruda[]>([])
  const [columnasDesconocidas, setColumnasDesconocidas] = useState<string[]>([])
  const [filas, setFilas] = useState<FilaPrevia[]>([])
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [filtro, setFiltro] = useState<Filtro>("todas")
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [importando, setImportando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visibles = useMemo(() => filas.filter((f) =>
    filtro === "todas" ? true
      : filtro === "cambios" ? f.estado === "cambios"
        : filtro === "sin_cambios" ? f.estado === "sin_cambios"
          : f.estado === "error" || f.estado === "no_existe",
  ), [filas, filtro])

  if (!esAdmin) return null

  function reiniciar() {
    setPaso("archivo"); setArchivo(""); setCrudas([]); setColumnasDesconocidas([]); setFilas([])
    setResumen(null); setFiltro("todas"); setResultado(null); setLeyendo(false); setImportando(false); setError(null)
    enviando.current = false
  }

  async function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || leyendo) return
    setError(null); setArchivo(file.name); setLeyendo(true)
    try {
      const libro = XLSX.read(await file.arrayBuffer(), { type: "array", cellNF: true })
      const nombreHoja = libro.SheetNames.find((n) => n.trim().toLowerCase() === "proveedores") ?? libro.SheetNames[0]
      const hoja = nombreHoja ? libro.Sheets[nombreHoja] : undefined
      if (!hoja) throw new Error("El archivo no tiene hojas.")
      const lectura = leerFilasExcel(matrizDeHoja(hoja))
      if (lectura.error) throw new Error(lectura.error)
      const data = await llamar({ accion: "previsualizar", filas: lectura.filas })
      setCrudas(lectura.filas)
      setColumnasDesconocidas(lectura.columnasDesconocidas)
      setFilas(data.filas || [])
      setResumen(data.resumen || null)
      setFiltro("todas")
      setPaso("previa")
    } catch (err: any) {
      setError(err?.message || "No se pudo leer el archivo.")
    } finally {
      setLeyendo(false)
    }
  }

  async function importar() {
    if (enviando.current) return
    const aGuardar = new Set(filas.filter((f) => f.estado === "cambios").map((f) => f.fila))
    const envio = crudas.filter((c) => aGuardar.has(c.fila))
    if (envio.length === 0) return
    enviando.current = true
    setImportando(true); setError(null)
    try {
      const data: Resultado = await llamar({ accion: "guardar", filas: envio, archivo })
      setResultado(data)
      setPaso("resultado")
      if (data.guardados > 0) {
        toast.success(data.guardados === 1 ? "Se actualizó 1 proveedor" : `Se actualizaron ${data.guardados} proveedores`)
        onImportado?.()
      }
      if (data.fallidos > 0) toast.error(data.fallidos === 1 ? "1 proveedor no se pudo guardar" : `${data.fallidos} proveedores no se pudieron guardar`)
    } catch (err: any) {
      setError(err?.message || "No se pudo importar.")
      toast.error(err?.message || "No se pudo importar.")
    } finally {
      enviando.current = false
      setImportando(false)
    }
  }

  const botonFiltro = (id: Filtro, texto: string, cantidad: number) => (
    <Button key={id} type="button" size="sm" variant={filtro === id ? "default" : "outline"} className="h-7 text-xs" onClick={() => setFiltro(id)}>
      {texto} ({cantidad})
    </Button>
  )

  return (
    <>
      <Button variant="outline" onClick={() => { reiniciar(); setAbierto(true) }}>
        <FileSpreadsheet className="w-4 h-4 mr-2" />
        Importar datos de compra (Excel)
      </Button>

      <Dialog open={abierto} onOpenChange={(v) => { if (importando) return; if (!v) reiniciar(); setAbierto(v) }}>
        <DialogContent className="w-[64rem] max-w-[95vw] sm:max-w-[64rem] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-blue-600" />
              Importar datos de compra de proveedores
            </DialogTitle>
            <DialogDescription>
              {paso === "archivo" && 'Subí el Excel "proveedores-para-completar". Lo que esté vacío no se modifica.'}
              {paso === "previa" && "Revisá qué va a cambiar en cada proveedor antes de importar. Todavía no se guardó nada."}
              {paso === "resultado" && "Resultado de la importación."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
            {PASOS.map((p, i) => (
              <React.Fragment key={p.id}>
                <span className={paso === p.id ? "font-semibold text-foreground" : ""}>{p.nombre}</span>
                {i < PASOS.length - 1 && <ArrowRight className="w-3 h-3" />}
              </React.Fragment>
            ))}
          </div>

          {error && (
            <Alert variant="destructive" className="mb-3">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {paso === "archivo" && (
            <div
              className="flex flex-col items-center justify-center gap-4 py-10 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => { if (!leyendo) inputRef.current?.click() }}
            >
              {leyendo ? <Loader2 className="w-10 h-10 text-muted-foreground animate-spin" /> : <Upload className="w-10 h-10 text-muted-foreground" />}
              <div className="text-center">
                <p className="font-medium">{leyendo ? `Revisando ${archivo}…` : "Hacé click para elegir el archivo"}</p>
                <p className="text-sm text-muted-foreground">Excel (.xlsx) con la hoja "Proveedores". El código es la clave: no crea proveedores nuevos ni cambia nombres.</p>
              </div>
              <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={elegirArchivo} />
            </div>
          )}

          {paso === "previa" && resumen && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium">{archivo}</span>
                <Badge variant="secondary">{resumen.total} filas</Badge>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-lg border p-3">
                  <div className="text-2xl font-semibold text-green-700">{resumen.con_cambios}</div>
                  <div className="text-xs text-muted-foreground">proveedores con cambios</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-2xl font-semibold">{resumen.sin_cambios}</div>
                  <div className="text-xs text-muted-foreground">sin cambios</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className={`text-2xl font-semibold ${resumen.con_errores > 0 ? "text-red-600" : ""}`}>{resumen.con_errores}</div>
                  <div className="text-xs text-muted-foreground">con errores (no se importan)</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className={`text-2xl font-semibold ${resumen.no_existen > 0 ? "text-red-600" : ""}`}>{resumen.no_existen}</div>
                  <div className="text-xs text-muted-foreground">códigos que no existen en el sistema</div>
                </div>
              </div>

              {columnasDesconocidas.length > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>Estas columnas del Excel no se reconocen y se ignoran: {columnasDesconocidas.join(", ")}.</AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Ver:</span>
                {botonFiltro("todas", "Todas", resumen.total)}
                {botonFiltro("cambios", "Con cambios", resumen.con_cambios)}
                {botonFiltro("errores", "Con errores", resumen.con_errores)}
                {botonFiltro("sin_cambios", "Sin cambios", resumen.sin_cambios)}
              </div>

              <Table contenedorClassName="border rounded-lg max-h-[45vh] overflow-y-auto">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">Fila</TableHead>
                    <TableHead className="w-20">Código</TableHead>
                    <TableHead className="w-56">Proveedor</TableHead>
                    <TableHead>Qué pasa con esta fila</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">No hay filas para mostrar con este filtro.</TableCell>
                    </TableRow>
                  )}
                  {visibles.map((f) => (
                    <TableRow key={f.fila} className="align-top">
                      <TableCell className="text-xs text-muted-foreground">{f.fila}</TableCell>
                      <TableCell className="font-mono text-xs">{f.codigo ?? "—"}</TableCell>
                      <TableCell className="text-sm whitespace-normal">
                        <div className="font-medium">{f.nombre_sistema ?? f.nombre_excel ?? "—"}</div>
                        {f.estado === "no_existe" && <div className="text-xs text-red-600">No existe en el sistema</div>}
                      </TableCell>
                      <TableCell className="text-sm whitespace-normal space-y-1">
                        {f.estado === "sin_cambios" && <span className="text-xs text-muted-foreground">Sin cambios: ya está igual en el sistema.</span>}
                        {f.errores.map((e, i) => (
                          <div key={`e${i}`} className="flex items-start gap-1.5 text-red-700">
                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span><span className="font-medium">{e.columna}:</span> {e.mensaje}</span>
                          </div>
                        ))}
                        {f.avisos.map((a, i) => (
                          <div key={`a${i}`} className="flex items-start gap-1.5 text-amber-700">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>{a}</span>
                          </div>
                        ))}
                        {f.cambios.map((c) => (
                          <div key={c.campo} className={f.estado === "cambios" ? "" : "opacity-50"}>
                            <span className="text-muted-foreground">{c.etiqueta}:</span>{" "}
                            <span className="text-muted-foreground line-through decoration-muted-foreground/40">{c.antes}</span>
                            <ArrowRight className="inline w-3 h-3 mx-1 text-muted-foreground" />
                            <span className="font-medium">{c.despues}</span>
                          </div>
                        ))}
                        {f.estado === "error" && f.cambios.length > 0 && (
                          <div className="text-xs text-muted-foreground">Estos cambios NO se importan hasta corregir el error de la fila.</div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {paso === "resultado" && resultado && (
            <div className="space-y-3">
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  {resultado.guardados === 1 ? "Se actualizó 1 proveedor." : `Se actualizaron ${resultado.guardados} proveedores.`}
                  {resultado.sin_cambios > 0 && ` ${resultado.sin_cambios} ya estaban iguales.`}
                </AlertDescription>
              </Alert>
              {resultado.fallidas.length > 0 && (
                <>
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {resultado.fallidas.length === 1 ? "1 proveedor no se pudo guardar:" : `${resultado.fallidas.length} proveedores no se pudieron guardar:`}
                    </AlertDescription>
                  </Alert>
                  <Table contenedorClassName="border rounded-lg max-h-[40vh] overflow-y-auto">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">Fila</TableHead>
                        <TableHead className="w-20">Código</TableHead>
                        <TableHead className="w-56">Proveedor</TableHead>
                        <TableHead>Por qué no se guardó</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resultado.fallidas.map((f) => (
                        <TableRow key={f.fila} className="align-top">
                          <TableCell className="text-xs text-muted-foreground">{f.fila}</TableCell>
                          <TableCell className="font-mono text-xs">{f.codigo ?? "—"}</TableCell>
                          <TableCell className="text-sm whitespace-normal">{f.nombre ?? "—"}</TableCell>
                          <TableCell className="text-sm whitespace-normal text-red-700">{f.mensaje}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 mt-4">
            {paso !== "resultado" && (
              <Button variant="outline" disabled={importando} onClick={() => { reiniciar(); setAbierto(false) }}>Cancelar</Button>
            )}
            {paso === "previa" && resumen && (
              <>
                <Button variant="ghost" disabled={importando} onClick={reiniciar}>← Elegir otro archivo</Button>
                <Button onClick={importar} disabled={importando || resumen.con_cambios === 0} className="bg-green-600 hover:bg-green-700 text-white">
                  {importando
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importando…</>
                    : resumen.con_cambios === 0 ? "No hay cambios para importar"
                      : resumen.con_cambios === 1 ? "Importar 1 proveedor" : `Importar ${resumen.con_cambios} proveedores`}
                </Button>
              </>
            )}
            {paso === "resultado" && (
              <Button onClick={() => { reiniciar(); setAbierto(false) }}>Cerrar</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
