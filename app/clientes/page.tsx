"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet"
import { Plus, Pencil, Trash2, ArrowLeft, ShoppingBag, Truck, FileText, Search, X, ExternalLink } from "lucide-react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { formatDateAR } from "@/lib/utils"
import { ImportClientesDialog, clientesFieldLabel } from "@/components/clientes/ImportClientesDialog"
import { HistorialImportacionesDialog } from "@/components/import/HistorialImportacionesDialog"
import { History } from "lucide-react"
import { useRealtime } from "@/lib/hooks/use-realtime"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"

interface Cliente {
  id: string
  codigo_cliente?: string | null
  nombre_razon_social: string
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
  const [searchTerm, setSearchTerm] = useState("")
  // Motor de búsqueda unificado: el endpoint decide qué matchea (ids), filtramos
  // el array ya cargado por esos ids (no cambia la forma de la tabla).
  const [searchIds, setSearchIds] = useState<Set<string> | null>(null)
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

  // Búsqueda vía motor unificado (trigram + vector). Devuelve ids; filtramos local.
  useEffect(() => {
    const q = searchTerm.trim()
    if (q.length < 2) { setSearchIds(null); return }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        const data = await res.json()
        setSearchIds(new Set((Array.isArray(data) ? data : []).map((c: any) => c.id)))
      } catch (e: any) {
        if (e?.name !== "AbortError") setSearchIds(new Set())
      }
    }, 250)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [searchTerm])

  async function loadClientes() {
    const supabase = createClient()
    // Paginado interno para no cortar en 1000 (el padrón crece).
    let data: any[]
    try {
      data = await fetchAllRows(() => supabase
        .from("clientes")
        .select("*, localidades(nombre, zonas(nombre))")
        .eq("activo", true)
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

  const filteredClientes = searchIds === null
    ? clientes
    : clientes.filter((cliente) => searchIds.has(cliente.id))


  return (
    <div className="min-h-screen">
      <main className="container mx-auto space-y-6 px-4 py-6 sm:px-6">
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
                  {filteredClientes.length} cliente{filteredClientes.length !== 1 ? "s" : ""} registrado
                  {filteredClientes.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar cliente..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-64"
                  />
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
          <CardContent className="p-6">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">Código</TableHead>
                    <TableHead className="font-semibold">Nombre</TableHead>
                    <TableHead className="font-semibold">Dirección</TableHead>
                    <TableHead className="font-semibold">Localidad</TableHead>
                    <TableHead className="font-semibold">Puntaje</TableHead>
                    <TableHead className="font-semibold">Nivel</TableHead>
                    <TableHead className="font-semibold">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cargandoClientes ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <CargaProgreso compacto mensajes={MENSAJES.clientes} className="mx-auto max-w-sm py-8" />
                      </TableCell>
                    </TableRow>
                  ) : filteredClientes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        {searchTerm ? "No se encontraron clientes" : "No hay clientes registrados"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredClientes.map((cliente) => (
                      <TableRow
                        key={cliente.id}
                        className="hover:bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => openClienteSheet(cliente)}
                      >
                        <TableCell className="font-medium">{cliente.codigo_cliente || "-"}</TableCell>
                        <TableCell className="font-medium">{cliente.nombre_razon_social}</TableCell>
                        <TableCell className="text-muted-foreground">{cliente.direccion || "-"}</TableCell>
                        <TableCell className="text-muted-foreground">{cliente.localidades?.nombre || "-"}</TableCell>
                        <TableCell>
                          <span className="font-semibold">{cliente.puntaje.toFixed(0)}</span>
                          <span className="text-muted-foreground text-sm">/100</span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-semibold ${cliente.nivel_puntaje === "Premium"
                              ? "bg-green-100 text-green-800"
                              : cliente.nivel_puntaje === "Regular"
                                ? "bg-blue-100 text-blue-800"
                                : cliente.nivel_puntaje === "Riesgo"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                          >
                            {cliente.nivel_puntaje}
                          </span>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-2">
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
              CUIT: {selectedCliente?.cuit || "—"} · Cód: {selectedCliente?.codigo_cliente || "—"}
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
                  {sheetCC === null ? "—" : `$${Math.abs(sheetCC).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`}
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
                          <span className="text-sm font-bold text-slate-700">${(p.total || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 })}</span>
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


