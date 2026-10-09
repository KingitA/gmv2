"use client"

import type React from "react"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet"
import { Plus, Pencil, Trash2, FileText, Search, X, ExternalLink, ArrowUp, ArrowDown } from "lucide-react"
import { FiltroColumnaMenu, ChipsFiltros, textoChip } from "@/components/search/filtro-columna"
import { aplicarFiltros, calcularFacetas, ordenarPor, filtroActivo, type DefColumna, type FiltroColumna, type Filtros } from "@/lib/search/facetas"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { normalizeLocal } from "@/lib/search/local-match"
import { formatDateAR } from "@/lib/utils"
import { ImportClientesDialog, clientesFieldLabel } from "@/components/clientes/ImportClientesDialog"
import { HistorialImportacionesDialog } from "@/components/import/HistorialImportacionesDialog"
import { History } from "lucide-react"
import { useRealtime } from "@/lib/hooks/use-realtime"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { moneda, entero, formatCuit } from "@/lib/formato"

interface Cliente {
  id: string
  codigo_cliente?: string | null
  /** Cómo lo conocemos (nombre de fantasía) */
  nombre: string | null
  /** A quién se le factura */
  razon_social: string | null
  nombre_razon_social: string
  localidad: string | null
  lista_precio_id?: string | null
  direccion: string | null
  cuit: string | null
  condicion_iva: string
  metodo_facturacion: string
  localidad_id: string | null
  provincia: string | null
  telefono: string | null
  mail: string | null
  condicion_pago: string
  nro_iibb: string | null
  exento_iibb: boolean
  exento_iva: boolean
  percepcion_iibb: number
  tipo_canal: string
  puntaje: number
  nivel_puntaje: string
  porcentaje_ajuste: number
  vendedor_id: string | null
  activo: boolean
  condicion_entrega: string | null
  localidades?: { nombre: string; zonas?: { nombre: string } }
}

const CLAVE_GUARDADO = "clientes:lista"
function leerGuardado(): { q?: string; filtros?: Filtros; orden?: { col: string; dir: "asc" | "desc" }; estado?: "activos" | "inactivos" | "todos" } {
  try { return JSON.parse(sessionStorage.getItem(CLAVE_GUARDADO) || "{}") || {} } catch { return {} }
}
const ENTREGA: Record<string, string> = { entregamos_nosotros: "Entregamos nosotros", retira_mostrador: "Retira en mostrador", transporte: "Transporte" }
const FACETAS_CLIENTES = ["tiene_codigo", "localidad", "zona", "viajante", "nivel", "iva", "pago", "facturacion", "lista", "canal", "entrega"]
const TITULOS: Record<string, string> = {
  codigo: "Código", tiene_codigo: "Código", nombre: "Nombre", direccion: "Dirección", localidad: "Localidad", zona: "Zona", viajante: "Viajante",
  puntaje: "Puntaje", nivel: "Nivel", iva: "Condición IVA", pago: "Condición de pago", facturacion: "Facturación",
  lista: "Lista de precios", canal: "Canal", entrega: "Entrega",
}

interface Vendedor {
  id: string
  nombre: string
}

interface Localidad {
  id: string
  nombre: string
  provincia: string
  zona_id: string | null
  zonas?: { nombre: string }
}

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [localidades, setLocalidades] = useState<Localidad[]>([])
  const [listasPrecio, setListasPrecio] = useState<any[]>([])
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null)
  const [sheetBonifs, setSheetBonifs] = useState<any[]>([])
  const [sheetCC, setSheetCC] = useState<number | null>(null)
  const [sheetPedidos, setSheetPedidos] = useState<any[]>([])
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [isHistorialOpen, setIsHistorialOpen] = useState(false)
  // Búsqueda, filtros, orden y estado: se recuerdan al volver de una ficha (sessionStorage)
  const [searchTerm, setSearchTerm] = useState("")
  const [filtros, setFiltros] = useState<Filtros>({})
  const [orden, setOrden] = useState<{ col: string; dir: "asc" | "desc" } | null>(null)
  const [estado, setEstado] = useState<"activos" | "inactivos" | "todos">("activos")
  const [restaurado, setRestaurado] = useState(false)
  // Motor de búsqueda unificado: el endpoint devuelve los ids EN ORDEN de relevancia
  // (se respeta ese orden en la tabla) y marca los que vinieron solo por parecido.
  const [busqueda, setBusqueda] = useState<{ ids: string[]; parecidos: Set<string> } | null>(null)
  const [buscando, setBuscando] = useState(false)
  // Hasta que llega la primera lectura se muestra "trabajando" (antes decía
  // "No hay clientes registrados" unos segundos y confundía).
  const [cargandoClientes, setCargandoClientes] = useState(true)

  useEffect(() => {
    loadClientes()
    loadVendedores()
    loadLocalidades()
    loadListasPrecio()
  }, [])

  // En vivo: altas/cambios de clientes hechos por otro usuario o por la app del vendedor
  useRealtime(["clientes"], () => loadClientes(), { esperaMs: 1500 })

  // Búsqueda vía motor unificado (ranking por campo en la base). Incluye dados de
  // baja: el selector Activos / Inactivos / Todos decide qué se ve.
  useEffect(() => {
    const q = searchTerm.trim()
    if (q.length < 2) { setBusqueda(null); setBuscando(false); return }
    const ctrl = new AbortController()
    setBuscando(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(q)}&limit=300&inactivos=1`, { signal: ctrl.signal })
        const data = await res.json()
        const lista = Array.isArray(data) ? data : []
        setBusqueda({ ids: lista.map((c: any) => c.id), parecidos: new Set(lista.filter((c: any) => c._parecido).map((c: any) => c.id)) })
        setBuscando(false)
      } catch (e: any) {
        if (e?.name !== "AbortError") { setBusqueda({ ids: [], parecidos: new Set() }); setBuscando(false) }
      }
    }, 250)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [searchTerm])

  useEffect(() => {
    const g = leerGuardado()
    if (g.q) setSearchTerm(g.q)
    if (g.filtros) setFiltros(g.filtros)
    if (g.orden) setOrden(g.orden)
    if (g.estado) setEstado(g.estado)
    setRestaurado(true)
  }, [])
  useEffect(() => {
    if (!restaurado) return
    try { sessionStorage.setItem(CLAVE_GUARDADO, JSON.stringify({ q: searchTerm, filtros, orden, estado })) } catch { /* sin storage */ }
  }, [restaurado, searchTerm, filtros, orden, estado])

  async function loadClientes() {
    const supabase = createClient()
    // Paginado interno para no cortar en 1000 (el padrón crece). Trae también los
    // dados de baja: el selector de estado los muestra a pedido.
    let data: any[]
    try {
      data = await fetchAllRows(() => supabase
        .from("clientes")
        .select("*, localidades(nombre, zonas(nombre))")
        .order("nombre_razon_social"), "id")
    } catch (error) {
      console.error("[v0] Error loading clientes:", error)
      setCargandoClientes(false)
      return
    }

    setClientes(data || [])
    setCargandoClientes(false)
  }

  async function loadVendedores() {
    const supabase = createClient()
    const { data, error } = await supabase.from("vendedores").select("id, nombre").eq("activo", true).order("nombre")

    if (error) {
      console.error("[v0] Error loading vendedores:", error)
      return
    }

    setVendedores(data || [])
  }

  async function loadLocalidades() {
    const supabase = createClient()
    const { data, error } = await supabase.from("localidades").select("*, zonas(nombre)").order("provincia, nombre")

    if (error) {
      console.error("[v0] Error loading localidades:", error)
      return
    }

    setLocalidades(data || [])
  }

  async function loadListasPrecio() {
    const supabase = createClient()
    const { data } = await supabase.from("listas_precio").select("id, nombre, codigo").eq("activo", true).order("nombre")
    setListasPrecio(data || [])
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Está seguro de eliminar este cliente?")) return

    const supabase = createClient()
    const { error } = await supabase.from("clientes").update({ activo: false }).eq("id", id)

    if (error) {
      console.error("[v0] Error deleting cliente:", error)
      alert(`Error al eliminar: ${error.message}`)
      return
    }

    loadClientes()
  }

  async function openClienteSheet(cliente: Cliente) {
    setSelectedCliente(cliente)
    setSheetBonifs([])
    setSheetCC(null)
    setSheetPedidos([])
    const sb = createClient()
    const [bonifRes, ccRes, pedidosRes] = await Promise.all([
      sb.from("bonificaciones").select("*").eq("cliente_id", cliente.id).eq("activo", true),
      sb.from("v_saldo_clientes").select("saldo_actual").eq("cliente_id", cliente.id).maybeSingle(),
      sb.from("pedidos").select("id, numero_pedido, fecha, estado, total").eq("cliente_id", cliente.id).neq("estado", "eliminado").order("fecha", { ascending: false }).limit(5),
    ])
    setSheetBonifs(bonifRes.data || [])
    // Saldo desde el libro mayor (fuente única): Σdebe − Σhaber
    const saldo = Number((ccRes.data as any)?.saldo_actual ?? 0)
    setSheetCC(saldo)
    setSheetPedidos(pedidosRes.data || [])
  }

  // ── Filtros por encabezado (tipo Excel), todo en memoria: el padrón entero ya está cargado ──
  const nombreVendedor = useMemo(() => new Map(vendedores.map((v) => [v.id, v.nombre])), [vendedores])
  const nombreLista = useMemo(() => new Map(listasPrecio.map((l: any) => [l.id, l.nombre])), [listasPrecio])
  const defs = useMemo<DefColumna<Cliente>[]>(() => [
    { id: "codigo", valor: (c) => c.codigo_cliente, numero: (c) => (c.codigo_cliente && /^\d+$/.test(c.codigo_cliente) ? Number(c.codigo_cliente) : null) },
    { id: "tiene_codigo", valor: (c) => (c.codigo_cliente?.trim() ? "Con código" : "Sin código") },
    { id: "nombre", valor: (c) => c.nombre || c.nombre_razon_social },
    { id: "direccion", valor: (c) => c.direccion },
    { id: "localidad", valor: (c) => c.localidades?.nombre || c.localidad },
    { id: "zona", valor: (c) => c.localidades?.zonas?.nombre },
    { id: "viajante", valor: (c) => (c.vendedor_id ? nombreVendedor.get(c.vendedor_id) ?? "(viajante dado de baja)" : null) },
    { id: "puntaje", numero: (c) => Number(c.puntaje) },
    { id: "nivel", valor: (c) => c.nivel_puntaje },
    { id: "iva", valor: (c) => c.condicion_iva },
    { id: "pago", valor: (c) => c.condicion_pago },
    { id: "facturacion", valor: (c) => c.metodo_facturacion },
    { id: "lista", valor: (c) => (c.lista_precio_id ? nombreLista.get(c.lista_precio_id) ?? "(lista dada de baja)" : null) },
    { id: "canal", valor: (c) => c.tipo_canal },
    { id: "entrega", valor: (c) => ENTREGA[c.condicion_entrega ?? ""] ?? c.condicion_entrega },
  ], [nombreVendedor, nombreLista])

  // 1) estado  2) búsqueda (en orden de relevancia)  3) filtros  4) orden elegido
  const universo = useMemo(() => {
    let rows = estado === "todos" ? clientes : clientes.filter((c) => (estado === "activos" ? c.activo : !c.activo))
    if (busqueda) {
      const pos = new Map(busqueda.ids.map((id, i) => [id, i]))
      rows = rows.filter((c) => pos.has(c.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!)
    }
    return rows
  }, [clientes, estado, busqueda])
  const facetas = useMemo(() => calcularFacetas(universo, defs, filtros, FACETAS_CLIENTES), [universo, defs, filtros])
  const filteredClientes = useMemo(() => {
    const rows = aplicarFiltros(universo, defs, filtros)
    const def = orden ? defs.find((d) => d.id === orden.col) : null
    return def ? ordenarPor(rows, def, orden!.dir) : rows
  }, [universo, defs, filtros, orden])

  const setFiltro = (id: string, f: FiltroColumna | null) =>
    setFiltros((p) => { const n = { ...p }; if (f) n[id] = f; else delete n[id]; return n })
  const alternarOrden = (col: string) =>
    setOrden((o) => (o?.col === col ? (o.dir === "asc" ? { col, dir: "desc" } : null) : { col, dir: "asc" }))
  const menu = (id: string, titulo: string, tipo: "valores" | "numero" = "valores", boton?: string) => (
    <FiltroColumnaMenu
      titulo={titulo}
      tipo={tipo}
      boton={boton}
      opciones={facetas[id]}
      filtro={filtros[id]}
      onFiltro={(f) => setFiltro(id, f)}
      orden={boton ? undefined : orden?.col === id ? orden.dir : null}
      onOrden={boton ? undefined : (dir) => setOrden({ col: id, dir })}
    />
  )
  // Encabezado: click en el texto ordena (A→Z, Z→A, sin orden); el embudo abre el filtro
  const encabezado = (id: string, titulo: string, tipo?: "valores" | "numero" | null, clase = "") => (
    <TableHead className={`whitespace-nowrap font-semibold ${clase}`}>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => alternarOrden(id)} className="inline-flex items-center gap-1 hover:text-foreground">
          {titulo}
          {orden?.col === id ? (orden.dir === "asc" ? <ArrowUp className="h-3 w-3 text-indigo-600" /> : <ArrowDown className="h-3 w-3 text-indigo-600" />) : null}
        </button>
        {tipo ? menu(id, titulo, tipo) : null}
      </div>
    </TableHead>
  )
  const chips = Object.entries(filtros)
    .filter(([, f]) => filtroActivo(f))
    .map(([id, f]) => ({ id, texto: textoChip(TITULOS[id] ?? id, f, facetas[id]) }))
  const hayAlgo = chips.length > 0 || searchTerm.trim() !== "" || estado !== "activos" || orden !== null
  const limpiarTodo = () => { setFiltros({}); setSearchTerm(""); setEstado("activos"); setOrden(null) }


  return (
    <div className="min-h-screen">
      <main className="mx-auto w-full max-w-[1800px] space-y-6 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azul-900 sm:text-3xl">Fichas de clientes</h1>
          <p className="text-sm text-neutro-500">Datos, condiciones y cuenta corriente de cada cliente</p>
        </div>

        <Card className="shadow-sm">
          <CardHeader className="border-b bg-muted/30">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <CardTitle className="text-xl">Lista de Clientes</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {buscando ? "Buscando…" : (
                    <>
                      {filteredClientes.length} cliente{filteredClientes.length !== 1 ? "s" : ""}
                      {hayAlgo && clientes.length > 0 && <> de {clientes.filter((c) => c.activo).length} activos</>}
                    </>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Nombre, dirección, localidad, código, CUIT…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 pr-8 w-80"
                  />
                  {searchTerm && (
                    <button type="button" onClick={() => setSearchTerm("")} aria-label="Borrar búsqueda"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Button variant="outline" className="gap-2" onClick={() => setIsImportDialogOpen(true)}>
                  <FileText className="h-4 w-4" />
                  Importar Clientes
                </Button>
                <ImportClientesDialog
                  open={isImportDialogOpen}
                  onOpenChange={setIsImportDialogOpen}
                  onImportComplete={loadClientes}
                />
                <Button variant="outline" className="gap-2" onClick={() => setIsHistorialOpen(true)}>
                  <History className="h-4 w-4" />
                  Historial
                </Button>
                <HistorialImportacionesDialog
                  open={isHistorialOpen}
                  onOpenChange={setIsHistorialOpen}
                  modulo="clientes"
                  claveLabel="Código"
                  nombreLabel="Nombre"
                  statuses={["actualizado", "sin_cambios", "no_encontrado", "error"]}
                  fieldLabel={clientesFieldLabel}
                />

                <Button asChild className="gap-2">
                  <Link href="/clientes/nuevo">
                    <Plus className="h-4 w-4" />
                    Nuevo Cliente
                  </Link>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            {/* Estado + filtros que no son columnas + filtros activos */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="inline-flex overflow-hidden rounded-md border text-xs font-medium">
                {(["activos", "inactivos", "todos"] as const).map((e) => (
                  <button key={e} type="button" onClick={() => setEstado(e)}
                    className={`px-3 py-1.5 capitalize transition-colors ${estado === e ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                    {e}
                  </button>
                ))}
              </div>
              {menu("tiene_codigo", "Con / sin código", "valores", "Código")}
              {menu("iva", "Condición IVA", "valores", "Condición IVA")}
              {menu("pago", "Condición de pago", "valores", "Pago")}
              {menu("facturacion", "Facturación", "valores", "Facturación")}
              {menu("lista", "Lista de precios", "valores", "Lista")}
              {menu("canal", "Canal", "valores", "Canal")}
              {menu("entrega", "Entrega", "valores", "Entrega")}
              {hayAlgo && (
                <button type="button" onClick={limpiarTodo} className="ml-auto text-xs font-semibold text-slate-500 hover:text-red-600">
                  Limpiar todo
                </button>
              )}
            </div>
            {chips.length > 0 && (
              <div className="mb-3">
                <ChipsFiltros chips={chips} onQuitar={(id) => setFiltro(id, null)} onLimpiar={() => setFiltros({})} />
              </div>
            )}
            <div className="rounded-md border">
              <Table contenedorClassName="max-h-[calc(100dvh-19rem)] min-h-64 overflow-auto">
                <TableHeader className="sticky top-0 z-10 bg-neutro-50 shadow-[0_1px_0_var(--color-neutro-200)]">
                  <TableRow className="bg-neutro-50 hover:bg-neutro-50">
                    {encabezado("codigo", "Código", "numero")}
                    {encabezado("nombre", "Nombre")}
                    {encabezado("direccion", "Dirección")}
                    {encabezado("localidad", "Localidad", "valores")}
                    {encabezado("zona", "Zona", "valores")}
                    {encabezado("viajante", "Viajante", "valores")}
                    {encabezado("puntaje", "Puntaje", "numero", "hidden 2xl:table-cell")}
                    {encabezado("nivel", "Nivel", "valores")}
                    <TableHead className="w-px whitespace-nowrap font-semibold">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cargandoClientes ? (
                    <TableRow>
                      <TableCell colSpan={9}>
                        <CargaProgreso compacto mensajes={MENSAJES.clientes} className="mx-auto max-w-sm py-8" />
                      </TableCell>
                    </TableRow>
                  ) : filteredClientes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        {buscando ? "Buscando…" : hayAlgo ? "No hay clientes con esa búsqueda o filtros" : "No hay clientes registrados"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredClientes.map((cliente) => (
                      <TableRow
                        key={cliente.id}
                        className={`hover:bg-muted/50 transition-colors cursor-pointer ${cliente.activo ? "" : "opacity-60"}`}
                        onClick={() => openClienteSheet(cliente)}
                      >
                        <TableCell className="font-medium tabular-nums">{cliente.codigo_cliente || "-"}</TableCell>
                        <TableCell className="min-w-[180px] max-w-[260px] 2xl:max-w-[320px]">
                          {/* Nombre = cómo lo conocemos; debajo la razón social si es otra */}
                          <div className="font-medium">
                            {cliente.nombre || cliente.nombre_razon_social}
                            {!cliente.activo && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">baja</span>}
                            {busqueda?.parecidos.has(cliente.id) && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" title="No contiene lo escrito; se parece">parecido</span>}
                          </div>
                          {cliente.razon_social && cliente.nombre && normalizeLocal(cliente.razon_social) !== normalizeLocal(cliente.nombre) && (
                            <div className="truncate text-xs text-muted-foreground" title={cliente.razon_social}>{cliente.razon_social}</div>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate text-muted-foreground 2xl:max-w-[240px]" title={cliente.direccion || undefined}>{cliente.direccion || "-"}</TableCell>
                        <TableCell className="max-w-[140px] truncate text-muted-foreground 2xl:max-w-[170px]" title={cliente.localidades?.nombre || cliente.localidad || undefined}>{cliente.localidades?.nombre || cliente.localidad || "-"}</TableCell>
                        <TableCell className="max-w-[110px] truncate text-muted-foreground 2xl:max-w-[130px]">{cliente.localidades?.zonas?.nombre || "-"}</TableCell>
                        <TableCell className="max-w-[130px] truncate text-muted-foreground 2xl:max-w-[160px]" title={(cliente.vendedor_id && nombreVendedor.get(cliente.vendedor_id)) || undefined}>{(cliente.vendedor_id && nombreVendedor.get(cliente.vendedor_id)) || "-"}</TableCell>
                        <TableCell className="hidden whitespace-nowrap 2xl:table-cell">
                          <span className="font-semibold">{entero(cliente.puntaje)}</span>
                          <span className="text-muted-foreground text-sm">/100</span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-semibold ${cliente.nivel_puntaje?.toLowerCase() === "premium"
                              ? "bg-green-100 text-green-800"
                              : cliente.nivel_puntaje?.toLowerCase() === "regular"
                                ? "bg-blue-100 text-blue-800"
                                : cliente.nivel_puntaje?.toLowerCase() === "riesgo"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                          >
                            {cliente.nivel_puntaje}
                          </span>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <Link href={`/clientes/${cliente.id}`}>
                              <Button variant="ghost" size="icon" className="hover:bg-blue-50 hover:text-blue-600">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Link href={`/clientes/${cliente.id}/cuenta-corriente`}>
                              <Button variant="outline" size="sm" className="hover:bg-primary/10">CC</Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(cliente.id)}
                              className="hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* ── Sheet de vista rápida ── */}
      <Sheet open={!!selectedCliente} onOpenChange={(open) => !open && setSelectedCliente(null)}>
        <SheetContent side="right" className="w-[500px] max-w-[500px] p-0 flex flex-col overflow-hidden">

          {/* ── Gradient Header ── */}
          <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-violet-700 text-white pt-12 pb-5 px-5 pr-12 shrink-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${(selectedCliente as any)?.activo ? "bg-green-400 shadow-sm" : "bg-red-400"}`} />
              <span className="text-white/60 text-xs font-semibold uppercase tracking-wider">{selectedCliente?.tipo_canal}</span>
            </div>
            <SheetTitle className="text-white text-xl font-bold leading-tight">{selectedCliente?.nombre_razon_social}</SheetTitle>
            <SheetDescription className="text-white/60 text-xs mt-0.5">
              CUIT: {selectedCliente?.cuit ? formatCuit(selectedCliente.cuit) : "—"} · Cód: {selectedCliente?.codigo_cliente || "—"}
            </SheetDescription>
            {(selectedCliente?.direccion || selectedCliente?.localidades?.nombre) && (
              <p className="text-white/50 text-xs mt-1">
                {selectedCliente?.direccion}{selectedCliente?.localidades?.nombre ? ` · ${selectedCliente.localidades.nombre}` : ""}
              </p>
            )}

            {/* CC Balance */}
            <div className={`mt-4 rounded-xl p-3.5 border ${
              sheetCC === null ? "bg-white/10 border-white/20" :
              sheetCC > 0 ? "bg-red-500/25 border-red-400/40" :
              sheetCC < 0 ? "bg-green-500/25 border-green-400/40" :
              "bg-white/10 border-white/20"
            }`}>
              <p className="text-white/50 text-[10px] uppercase tracking-wider font-bold">Cuenta Corriente</p>
              <div className="flex items-end justify-between mt-1">
                <p className={`text-2xl font-bold ${
                  sheetCC === null ? "text-white/30" :
                  sheetCC > 0 ? "text-red-200" :
                  sheetCC < 0 ? "text-green-200" : "text-white/40"
                }`}>
                  {sheetCC === null ? "—" : moneda(Math.abs(sheetCC), 0)}
                </p>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  sheetCC === null ? "text-white/40 bg-white/10" :
                  sheetCC > 0 ? "text-red-100 bg-red-500/40" :
                  sheetCC < 0 ? "text-green-100 bg-green-500/40" :
                  "text-white/40 bg-white/10"
                }`}>
                  {sheetCC === null ? "cargando" : sheetCC > 0 ? "debe" : sheetCC < 0 ? "a favor" : "al día ✓"}
                </span>
              </div>
            </div>
          </div>

          {/* ── Scrollable body ── */}
          <div className="flex-1 overflow-y-auto">

            {/* Comercial grid */}
            <div className="p-4 grid grid-cols-2 gap-2.5">
              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Lista de precios</p>
                <p className="font-bold text-sm text-slate-800">
                  {listasPrecio.find((l) => l.id === (selectedCliente as any)?.lista_precio_id)?.nombre || <span className="text-slate-400 font-normal italic">Sin lista</span>}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{(selectedCliente as any)?.metodo_facturacion || "—"}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Condición de pago</p>
                <p className="font-bold text-sm text-slate-800">{selectedCliente?.condicion_pago}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedCliente?.condicion_entrega === "entregamos_nosotros" ? "Entregamos nosotros" :
                   selectedCliente?.condicion_entrega === "retira_mostrador" ? "Retira en mostrador" : "Transporte"}
                </p>
              </div>
              {selectedCliente?.vendedor_id && (
                <div className="col-span-2 bg-indigo-50 rounded-xl p-3.5 border border-indigo-100">
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-1">Vendedor asignado</p>
                  <p className="font-bold text-sm text-indigo-800">👤 {vendedores.find((v) => v.id === selectedCliente?.vendedor_id)?.nombre || "—"}</p>
                </div>
              )}
            </div>

            {/* Segmentos */}
            {((selectedCliente as any)?.lista_limpieza_id || (selectedCliente as any)?.lista_perf0_id || (selectedCliente as any)?.lista_perf_plus_id) && (
              <div className="px-4 pb-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Segmentos configurados</p>
                <div className="space-y-1.5">
                  {(selectedCliente as any)?.lista_limpieza_id && (
                    <div className="flex justify-between items-center bg-emerald-50 rounded-xl px-3.5 py-2.5 border border-emerald-100">
                      <span className="text-xs text-emerald-700 font-semibold">🧹 Limpieza / Bazar</span>
                      <span className="text-xs font-bold text-emerald-800">{listasPrecio.find((l) => l.id === (selectedCliente as any)?.lista_limpieza_id)?.nombre || "—"}</span>
                    </div>
                  )}
                  {(selectedCliente as any)?.lista_perf0_id && (
                    <div className="flex justify-between items-center bg-pink-50 rounded-xl px-3.5 py-2.5 border border-pink-100">
                      <span className="text-xs text-pink-700 font-semibold">🌸 Perfumería Perf0</span>
                      <span className="text-xs font-bold text-pink-800">{listasPrecio.find((l) => l.id === (selectedCliente as any)?.lista_perf0_id)?.nombre || "—"}</span>
                    </div>
                  )}
                  {(selectedCliente as any)?.lista_perf_plus_id && (
                    <div className="flex justify-between items-center bg-violet-50 rounded-xl px-3.5 py-2.5 border border-violet-100">
                      <span className="text-xs text-violet-700 font-semibold">✨ Perfumería Plus</span>
                      <span className="text-xs font-bold text-violet-800">{listasPrecio.find((l) => l.id === (selectedCliente as any)?.lista_perf_plus_id)?.nombre || "—"}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Bonificaciones */}
            {sheetBonifs.length > 0 && (
              <div className="px-4 pb-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Bonificaciones activas</p>
                <div className="flex flex-wrap gap-1.5">
                  {sheetBonifs.map((b: any) => (
                    <span key={b.id} className={`text-xs px-3 py-1.5 rounded-full border font-semibold ${
                      b.tipo === "mercaderia" ? "border-green-300 bg-green-50 text-green-800" :
                      b.tipo === "general" ? "border-blue-300 bg-blue-50 text-blue-800" :
                      "border-orange-300 bg-orange-50 text-orange-800"
                    }`}>
                      {b.tipo} {b.porcentaje}%{b.segmento ? ` · ${b.segmento}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Pedidos recientes */}
            {sheetPedidos.length > 0 && (
              <div className="px-4 pb-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Pedidos recientes</p>
                <div className="space-y-1.5">
                  {sheetPedidos.map((p: any) => {
                    const estadoColors: Record<string, string> = {
                      pendiente: "bg-yellow-100 text-yellow-700 border-yellow-200",
                      facturado: "bg-emerald-100 text-emerald-700 border-emerald-200",
                      entregado: "bg-green-100 text-green-700 border-green-200",
                      en_viaje: "bg-purple-100 text-purple-700 border-purple-200",
                      en_preparacion: "bg-blue-100 text-blue-700 border-blue-200",
                    }
                    const colorClass = estadoColors[p.estado] || "bg-slate-100 text-slate-600 border-slate-200"
                    return (
                      <div key={p.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-3.5 py-2.5 border border-slate-100 hover:border-slate-200 transition-colors">
                        <div>
                          <span className="text-sm font-bold text-slate-800">#{p.numero_pedido}</span>
                          <span className="text-xs text-slate-400 ml-2">{formatDateAR(p.fecha)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-700">{moneda(p.total || 0, 0)}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colorClass}`}>{p.estado}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Fiscal */}
            <div className="px-4 pb-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Fiscal</p>
              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Condición IVA</span>
                  <span className="font-medium text-slate-700">{selectedCliente?.condicion_iva}</span>
                </div>
                {selectedCliente?.nro_iibb && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">N° IIBB</span>
                    <span className="font-medium text-slate-700">{selectedCliente.nro_iibb}</span>
                  </div>
                )}
                {(selectedCliente?.exento_iva || selectedCliente?.exento_iibb) && (
                  <div className="flex gap-1.5 mt-1">
                    {selectedCliente?.exento_iva && <span className="text-xs bg-yellow-50 border border-yellow-200 text-yellow-700 px-2 py-0.5 rounded-full font-medium">Exento IVA</span>}
                    {selectedCliente?.exento_iibb && <span className="text-xs bg-yellow-50 border border-yellow-200 text-yellow-700 px-2 py-0.5 rounded-full font-medium">Exento IIBB</span>}
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* ── Footer ── */}
          <div className="border-t p-4 flex gap-2 shrink-0 bg-background">
            <Link href={`/clientes/${selectedCliente?.id}`} className="flex-1">
              <Button className="w-full gap-2 bg-indigo-600 hover:bg-indigo-700">
                <Pencil className="h-4 w-4" />
                Editar Ficha
              </Button>
            </Link>
            <Link href={`/clientes/${selectedCliente?.id}/cuenta-corriente`}>
              <Button variant="outline" className="gap-1.5 border-slate-300">
                <ExternalLink className="h-4 w-4" />
                CC
              </Button>
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}


