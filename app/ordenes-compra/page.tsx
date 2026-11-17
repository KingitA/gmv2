"use client"

// Órdenes de compra — listado (E-12, E-96). Liviano: una sola llamada a /api/ordenes-compra/listado
// con las columnas que se muestran. Crear / editar, ver el detalle, enviar al proveedor y cancelar
// están en components/ordenes-compra/*; todo lo que escribe pasa por el servidor (funciones SQL).

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, CheckCircle2, Eye, FileText, Pencil, Plus, Search, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CargaProgreso } from "@/components/ui/carga-progreso"
import { createClient } from "@/lib/supabase/client"
import { localMatch } from "@/lib/search/local-match"
import { fecha, fechaCorta, hoyISO, moneda } from "@/lib/formato"
import { ESTADOS_OC_ABIERTA } from "@/lib/compras/orden-compra"
import { ImportOrderDialog, type ResultadoImportacionOC } from "@/components/ordenes/ImportOrderDialog"
import { EstadoOC } from "@/components/ordenes-compra/estado-oc"
import { DialogoOrden, type InicioOrden } from "@/components/ordenes-compra/dialogo-orden"
import { DetalleOrden } from "@/components/ordenes-compra/detalle-orden"
import { DialogoEnviarOrden } from "@/components/ordenes-compra/dialogo-enviar"

interface FilaOrden {
  id: string
  numero_orden: string
  proveedor_id: string
  proveedor_nombre: string
  fecha_orden: string | null
  fecha_estimada_recepcion: string | null
  estado: string
  observaciones: string | null
  condicion_pago: string | null
  creada_por: string | null
  total: number | null
  neto: number | null
  renglones: number | null
  enviada_at: string | null
  enviada_a: string | null
  envios: number
  cambio_sin_enviar: boolean
  cancelada_at: string | null
  motivo_cancelacion: string | null
  comprobantes: number
  comprobantes_validados: number
}

const FILTROS: { valor: string; nombre: string; incluye: (o: FilaOrden) => boolean }[] = [
  { valor: "abiertas", nombre: "Abiertas (sin recibir)", incluye: (o) => (ESTADOS_OC_ABIERTA as readonly string[]).includes(o.estado) },
  { valor: "sin_enviar", nombre: "Sin enviar al proveedor", incluye: (o) => o.estado === "pendiente" },
  { valor: "enviadas", nombre: "Enviadas / en camino", incluye: (o) => ["enviada", "confirmada", "en_camino"].includes(o.estado) },
  { valor: "recepcion", nombre: "Recibidas (a verificar)", incluye: (o) => ["recibida_parcial", "recibida_completa", "recibida"].includes(o.estado) },
  { valor: "finalizadas", nombre: "Finalizadas", incluye: (o) => o.estado === "finalizada" },
  { valor: "canceladas", nombre: "Canceladas", incluye: (o) => o.estado === "cancelada" },
  { valor: "todas", nombre: "Todas", incluye: () => true },
]

function OrdenesCompra() {
  const busqueda = useSearchParams()
  const [ordenes, setOrdenes] = useState<FilaOrden[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [migracion, setMigracion] = useState<string | null>(null)
  const [texto, setTexto] = useState("")
  const [filtro, setFiltro] = useState("todas")
  const [proveedores, setProveedores] = useState<{ id: string; nombre: string }[]>([])

  const [inicio, setInicio] = useState<InicioOrden | null>(null)
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [enviarId, setEnviarId] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const cargar = useCallback(async () => {
    setError(null)
    try {
      const r = await fetch("/api/ordenes-compra/listado", { cache: "no-store" })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setError(d.error || "No se pudieron traer las órdenes."); setOrdenes((o) => o ?? []); return }
      setOrdenes(d.ordenes || [])
      setMigracion(d.migracion_pendiente || null)
    } catch {
      setError("No se pudieron traer las órdenes. Revisá la conexión.")
      setOrdenes((o) => o ?? [])
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Solo nombre e id: los usa el diálogo de importar desde archivo
  useEffect(() => {
    createClient().from("proveedores").select("id, nombre").eq("activo", true).order("nombre")
      .then(({ data }) => setProveedores((data as any[]) || []))
  }, [])

  // Desde Jarvis (Playroom → "Armar orden de compra"): ?nueva=1&proveedor=…&sugerir=1&origen=jarvis
  // abre la orden con el proveedor elegido y la sugerencia ya cargada. No guarda nada.
  useEffect(() => {
    if (busqueda.get("nueva") !== "1") return
    setInicio({
      proveedorId: busqueda.get("proveedor"),
      aplicarSugerencia: busqueda.get("sugerir") === "1",
      observaciones: busqueda.get("origen") === "jarvis" ? "Sugerida por Jarvis (Playroom). Revisada antes de guardar." : "",
    })
    setDialogoAbierto(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const abrirNueva = () => { setInicio({}); setDialogoAbierto(true) }
  const abrirEditar = (id: string) => { setDetalleId(null); setInicio({ ordenId: id }); setDialogoAbierto(true) }
  const abrirEnviar = (id: string) => setEnviarId(id)

  const alImportar = (r: ResultadoImportacionOC) => {
    setInicio({ proveedorId: r.proveedorId, importados: r.items, sinArticulo: r.sinArticulo, unidadImportada: r.unidad })
    setDialogoAbierto(true)
  }

  const alGuardar = (r: { ordenId: string; numero: string; enviar: boolean }) => {
    setDialogoAbierto(false)
    setInicio(null)
    setVersion((v) => v + 1)
    cargar()
    if (r.enviar && r.ordenId) setEnviarId(r.ordenId)
  }

  const hoy = hoyISO()
  const cuentas = useMemo(() => {
    const m: Record<string, number> = {}
    for (const f of FILTROS) m[f.valor] = (ordenes || []).filter(f.incluye).length
    return m
  }, [ordenes])

  const filtradas = useMemo(() => {
    const f = FILTROS.find((x) => x.valor === filtro) ?? FILTROS[FILTROS.length - 1]
    return (ordenes || []).filter((o) => f.incluye(o) && (!texto.trim() || localMatch(texto, o.numero_orden, o.proveedor_nombre)))
  }, [ordenes, filtro, texto])

  const totalFiltradas = filtradas.reduce((s, o) => s + (o.estado === "cancelada" ? 0 : o.total || 0), 0)

  return (
    <div className="container mx-auto space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Órdenes de compra</h1>
        <div className="flex gap-2">
          <ImportOrderDialog proveedores={proveedores} onImportSuccess={alImportar} />
          <Button onClick={abrirNueva}><Plus className="mr-2 h-4 w-4" /> Nueva orden</Button>
        </div>
      </div>

      {migracion && (
        <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {migracion}
        </div>
      )}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar por número de orden o proveedor…" value={texto} onChange={(e) => setTexto(e.target.value)} className="pl-10" />
            </div>
            <Select value={filtro} onValueChange={setFiltro}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FILTROS.map((f) => <SelectItem key={f.valor} value={f.valor}>{f.nombre}{ordenes ? ` (${cuentas[f.valor] ?? 0})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {ordenes && <div className="text-sm text-muted-foreground tabular-nums">{filtradas.length} órdenes · {moneda(totalFiltradas)}</div>}
          </div>
        </CardHeader>
        <CardContent>
          {ordenes === null ? (
            <CargaProgreso mensajes={["Buscando las órdenes de compra…", "Sumando totales…", "Ya casi está…"]} />
          ) : filtradas.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {ordenes.length === 0 ? "Todavía no hay órdenes de compra." : "Ninguna orden coincide con la búsqueda o el filtro."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N° de orden</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Creada</TableHead>
                  <TableHead>Entrega estimada</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Envío al proveedor</TableHead>
                  <TableHead className="text-right">Total estimado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.map((o) => {
                  const abierta = (ESTADOS_OC_ABIERTA as readonly string[]).includes(o.estado)
                  const atrasada = abierta && !!o.fecha_estimada_recepcion && o.fecha_estimada_recepcion < hoy
                  const enRecepcion = ["recibida_parcial", "recibida_completa", "recibida"].includes(o.estado)
                  return (
                    <TableRow key={o.id} className={`cursor-pointer ${o.estado === "cancelada" ? "text-muted-foreground" : ""}`} onClick={() => setDetalleId(o.id)}>
                      <TableCell className="font-mono text-sm font-semibold">{o.numero_orden}</TableCell>
                      <TableCell>
                        <div className="font-medium">{o.proveedor_nombre}</div>
                        {o.renglones != null && <div className="text-xs text-muted-foreground">{o.renglones} artículos</div>}
                      </TableCell>
                      <TableCell>
                        <div>{fecha(o.fecha_orden)}</div>
                        {o.creada_por && <div className="text-xs text-muted-foreground">{o.creada_por}</div>}
                      </TableCell>
                      <TableCell>
                        {o.fecha_estimada_recepcion ? (
                          <>
                            <div className={atrasada ? "font-semibold text-red-600" : ""}>{fecha(o.fecha_estimada_recepcion)}</div>
                            {atrasada && <div className="text-xs text-red-600">atrasada</div>}
                          </>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell><EstadoOC estado={o.estado} /></TableCell>
                      <TableCell>
                        {o.estado === "cancelada" ? <span className="text-xs">{o.motivo_cancelacion || "—"}</span>
                          : o.enviada_at ? (
                            <>
                              <div className="flex items-center gap-1 text-sm text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> {fechaCorta(o.enviada_at)}{o.envios > 1 ? ` · ${o.envios} envíos` : ""}</div>
                              {o.cambio_sin_enviar
                                ? <div className="text-xs font-semibold text-amber-700">cambió después: reenviar</div>
                                : <div className="max-w-[220px] truncate text-xs text-muted-foreground" title={o.enviada_a || ""}>{o.enviada_a}</div>}
                            </>
                          ) : abierta ? <span className="text-sm font-medium text-amber-700">Sin enviar</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{o.total != null ? moneda(o.total) : "—"}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => setDetalleId(o.id)}><Eye className="mr-1 h-4 w-4" /> Ver</Button>
                          {abierta && (
                            <>
                              <Button variant="outline" size="sm" onClick={() => abrirEditar(o.id)} title="Editar la orden"><Pencil className="h-4 w-4" /></Button>
                              <Button variant={o.enviada_at && !o.cambio_sin_enviar ? "outline" : "default"} size="sm" onClick={() => abrirEnviar(o.id)}>
                                <Send className="mr-1 h-4 w-4" /> {o.enviada_at ? "Reenviar" : "Enviar"}
                              </Button>
                            </>
                          )}
                          {enRecepcion && (
                            <Button size="sm" onClick={() => { window.location.href = `/ordenes-compra/${o.id}/verificacion` }}>
                              <CheckCircle2 className="mr-1 h-4 w-4" /> Verificar
                            </Button>
                          )}
                          {o.estado === "finalizada" && (
                            <Button variant="outline" size="sm" onClick={() => { window.location.href = `/ordenes-compra/${o.id}/verificacion` }}>
                              <FileText className="mr-1 h-4 w-4" /> Verificación
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <DialogoOrden abierto={dialogoAbierto} inicio={inicio} onCerrar={() => { setDialogoAbierto(false); setInicio(null) }} onGuardada={alGuardar} />
      <DetalleOrden ordenId={detalleId} version={version} onCerrar={() => setDetalleId(null)} onEditar={abrirEditar} onEnviar={abrirEnviar} onCambio={cargar} />
      <DialogoEnviarOrden ordenId={enviarId} onCerrar={() => setEnviarId(null)} onEnviada={() => { setVersion((v) => v + 1); cargar() }} />
    </div>
  )
}

export default function OrdenesCompraPage() {
  return (
    <Suspense fallback={<div className="container mx-auto p-6"><CargaProgreso mensajes={["Abriendo órdenes de compra…"]} /></div>}>
      <OrdenesCompra />
    </Suspense>
  )
}
