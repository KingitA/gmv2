"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Save, Loader2, ExternalLink, TrendingUp, TrendingDown, Minus } from "lucide-react"
import Link from "next/link"

const ESTADO_COLORS: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800",
  en_preparacion: "bg-blue-100 text-blue-800",
  facturado: "bg-emerald-100 text-emerald-800",
  entregado: "bg-green-100 text-green-800",
  en_viaje: "bg-purple-100 text-purple-800",
}

export default function ClienteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [vendedores, setVendedores] = useState<any[]>([])
  const [localidades, setLocalidades] = useState<any[]>([])
  const [listasPrecio, setListasPrecio] = useState<any[]>([])
  const [bonifGrid, setBonifGrid] = useState<Record<string, number>>({})
  const [savingBonif, setSavingBonif] = useState(false)
  const [listaPorSegmento, setListaPorSegmento] = useState(false)
  const [ccBalance, setCcBalance] = useState<number | null>(null)
  const [pedidosCliente, setPedidosCliente] = useState<any[]>([])
  const [formData, setFormData] = useState({
    codigo_cliente: "",
    nombre_razon_social: "",
    direccion: "",
    cuit: "",
    condicion_iva: "Consumidor Final",
    metodo_facturacion: "Factura",
    localidad_id: "",
    provincia: "",
    telefono: "",
    mail: "",
    condicion_pago: "Efectivo",
    nro_iibb: "",
    exento_iibb: false,
    exento_iva: false,
    percepcion_iibb: 0,
    tipo_canal: "Minorista",
    vendedor_id: "",
    condicion_entrega: "entregamos_nosotros",
    lista_precio_id: "",
    descuento_especial: 0,
    lista_limpieza_id: "",
    metodo_limpieza: "",
    lista_perf0_id: "",
    metodo_perf0: "",
    lista_perf_plus_id: "",
    metodo_perf_plus: "",
  })

  useEffect(() => {
    loadAll()
  }, [id])

  async function loadAll() {
    setLoading(true)
    const [clienteRes, vendRes, locRes, listasRes, ccRes, pedRes] = await Promise.all([
      supabase.from("clientes").select("*, localidades(nombre, zonas(nombre))").eq("id", id).single(),
      supabase.from("vendedores").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("localidades").select("*, zonas(nombre)").order("provincia, nombre"),
      supabase.from("listas_precio").select("id, nombre, codigo").eq("activo", true).order("nombre"),
      supabase.from("comprobantes_venta").select("saldo_pendiente").eq("cliente_id", id).neq("estado_pago", "pagado"),
      supabase.from("pedidos").select("id, numero_pedido, fecha, estado, total").eq("cliente_id", id).order("fecha", { ascending: false }).limit(10),
    ])

    if (clienteRes.data) {
      const c = clienteRes.data as any
      setFormData({
        codigo_cliente: c.codigo_cliente || "",
        nombre_razon_social: c.nombre_razon_social || "",
        direccion: c.direccion || "",
        cuit: c.cuit || "",
        condicion_iva: c.condicion_iva || "Consumidor Final",
        metodo_facturacion: c.metodo_facturacion || "Factura",
        localidad_id: c.localidad_id || "",
        provincia: c.provincia || "",
        telefono: c.telefono || "",
        mail: c.mail || "",
        condicion_pago: c.condicion_pago || "Efectivo",
        nro_iibb: c.nro_iibb || "",
        exento_iibb: c.exento_iibb || false,
        exento_iva: c.exento_iva || false,
        percepcion_iibb: c.percepcion_iibb || 0,
        tipo_canal: c.tipo_canal || "Minorista",
        vendedor_id: c.vendedor_id || "",
        condicion_entrega: c.condicion_entrega || "entregamos_nosotros",
        lista_precio_id: c.lista_precio_id || "",
        descuento_especial: c.descuento_especial || 0,
        lista_limpieza_id: c.lista_limpieza_id || "",
        metodo_limpieza: c.metodo_limpieza || "",
        lista_perf0_id: c.lista_perf0_id || "",
        metodo_perf0: c.metodo_perf0 || "",
        lista_perf_plus_id: c.lista_perf_plus_id || "",
        metodo_perf_plus: c.metodo_perf_plus || "",
      })
    }
    setVendedores(vendRes.data || [])
    setLocalidades(locRes.data || [])
    setListasPrecio(listasRes.data || [])
    const balance = (ccRes.data || []).reduce((sum: number, r: any) => sum + (r.saldo_pendiente || 0), 0)
    setCcBalance(Math.round(balance * 100) / 100)
    setPedidosCliente(pedRes.data || [])
    if (clienteRes.data) {
      const c = clienteRes.data as any
      setListaPorSegmento(!!(c.lista_limpieza_id || c.lista_perf0_id || c.lista_perf_plus_id))
    }
    loadBonificaciones()
    setLoading(false)
  }

  const BONIF_SEGMENTS = [
    { key: "todos", label: "Todos" },
    { key: "limpieza_bazar", label: "Limpieza / Bazar" },
    { key: "perf0", label: "Perfumería Perf0" },
    { key: "perf_plus", label: "Perfumería Plus" },
  ]
  const BONIF_TIPOS = [
    { key: "general", label: "General", cls: "text-blue-700 bg-blue-50 border-blue-200" },
    { key: "mercaderia", label: "Mercadería", cls: "text-green-700 bg-green-50 border-green-200" },
    { key: "viajante", label: "Viajante", cls: "text-orange-700 bg-orange-50 border-orange-200" },
  ]

  async function loadBonificaciones() {
    const { data } = await supabase.from("bonificaciones").select("tipo, porcentaje, segmento").eq("cliente_id", id).eq("activo", true)
    const grid: Record<string, number> = {}
    for (const b of (data || [])) {
      const segKey = b.segmento || "todos"
      grid[`${segKey}__${b.tipo}`] = b.porcentaje
    }
    setBonifGrid(grid)
  }

  async function saveBonificaciones() {
    setSavingBonif(true)

    // 1. Guardar campos de segmento en clientes
    const { error: updErr } = await supabase.from("clientes").update({
      metodo_facturacion: formData.metodo_facturacion || null,
      lista_precio_id:    listaPorSegmento ? null : (formData.lista_precio_id || null),
      lista_limpieza_id:  formData.lista_limpieza_id || null,
      metodo_limpieza:    formData.metodo_limpieza || null,
      lista_perf0_id:     formData.lista_perf0_id || null,
      metodo_perf0:       formData.metodo_perf0 || null,
      lista_perf_plus_id: formData.lista_perf_plus_id || null,
      metodo_perf_plus:   formData.metodo_perf_plus || null,
    }).eq("id", id)
    if (updErr) { alert(`Error al guardar cliente: ${updErr.message}`); setSavingBonif(false); return }

    // 2. Eliminar TODOS los descuentos manejados para este cliente (un solo query)
    const { error: delErr } = await supabase
      .from("bonificaciones")
      .delete()
      .eq("cliente_id", id)
      .in("tipo", ["general", "mercaderia", "viajante"])
    if (delErr) { alert(`Error al limpiar descuentos: ${delErr.message}`); setSavingBonif(false); return }

    // 3. Insertar solo los que tienen porcentaje > 0
    const toInsert: any[] = []
    for (const seg of BONIF_SEGMENTS) {
      for (const tipo of BONIF_TIPOS) {
        const pct = bonifGrid[`${seg.key}__${tipo.key}`] || 0
        if (pct > 0) {
          toInsert.push({
            cliente_id: id,
            tipo: tipo.key,
            porcentaje: pct,
            activo: true,
            segmento: seg.key === "todos" ? null : seg.key,
          })
        }
      }
    }
    if (toInsert.length > 0) {
      const { error: insErr } = await supabase.from("bonificaciones").insert(toInsert)
      if (insErr) { alert(`Error al guardar descuentos: ${insErr.message}`); setSavingBonif(false); return }
    }

    // 4. Recargar para confirmar
    await loadBonificaciones()
    setSavingBonif(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const dataToSave = {
      ...formData,
      nombre: formData.nombre_razon_social,
      razon_social: formData.nombre_razon_social,
      vendedor_id: formData.vendedor_id && formData.vendedor_id !== "none" ? formData.vendedor_id : null,
      localidad_id: formData.localidad_id || null,
      lista_precio_id: formData.lista_precio_id && formData.lista_precio_id !== "__none__" ? formData.lista_precio_id : null,
      descuento_especial: formData.descuento_especial || 0,
      lista_limpieza_id: formData.lista_limpieza_id || null,
      metodo_limpieza: formData.metodo_limpieza || null,
      lista_perf0_id: formData.lista_perf0_id || null,
      metodo_perf0: formData.metodo_perf0 || null,
      lista_perf_plus_id: formData.lista_perf_plus_id || null,
      metodo_perf_plus: formData.metodo_perf_plus || null,
    }
    const { error } = await supabase.from("clientes").update(dataToSave).eq("id", id)
    if (error) {
      alert(`Error al guardar: ${error.message}`)
    } else {
      fetch("/api/embed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity: "clientes", id }) }).catch(() => {})
      router.push("/clientes")
    }
    setSaving(false)
  }

  function handleLocalidadChange(localidadId: string) {
    const loc = localidades.find((l) => l.id === localidadId)
    setFormData({ ...formData, localidad_id: localidadId, provincia: loc?.provincia || "" })
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/clientes">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">{formData.nombre_razon_social || "Cliente"}</h1>
              <p className="text-sm text-muted-foreground">CUIT: {formData.cuit || "—"} · Código: {formData.codigo_cliente || "—"}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href={`/clientes/${id}/cuenta-corriente`}>
              <Button variant="outline" className="gap-2">
                <ExternalLink className="h-4 w-4" />
                Cuenta Corriente
              </Button>
            </Link>
            <Button form="cliente-form" type="submit" disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <form id="cliente-form" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Columna principal */}
            <div className="lg:col-span-2 space-y-6">

              {/* Identificación */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Identificación</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs text-slate-500">Código</Label>
                      <Input value={formData.codigo_cliente} onChange={(e) => setFormData({ ...formData, codigo_cliente: e.target.value })} placeholder="CL-001" className="h-9" />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs text-slate-500">Nombre / Razón Social *</Label>
                      <Input value={formData.nombre_razon_social} onChange={(e) => setFormData({ ...formData, nombre_razon_social: e.target.value })} required className="h-9" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-slate-500">CUIT</Label>
                      <Input value={formData.cuit} onChange={(e) => setFormData({ ...formData, cuit: e.target.value })} placeholder="20-12345678-9" className="h-9" />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500">Condición IVA *</Label>
                      <Select value={formData.condicion_iva} onValueChange={(v) => setFormData({ ...formData, condicion_iva: v })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Responsable Inscripto">Responsable Inscripto</SelectItem>
                          <SelectItem value="Monotributo">Monotributo</SelectItem>
                          <SelectItem value="Consumidor Final">Consumidor Final</SelectItem>
                          <SelectItem value="Sujeto Exento">Sujeto Exento</SelectItem>
                          <SelectItem value="No Categorizado">No Categorizado</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500">Teléfono</Label>
                      <Input value={formData.telefono} onChange={(e) => setFormData({ ...formData, telefono: e.target.value })} className="h-9" />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500">Email</Label>
                      <Input type="email" value={formData.mail} onChange={(e) => setFormData({ ...formData, mail: e.target.value })} className="h-9" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <Label className="text-xs text-slate-500">Dirección</Label>
                      <Input value={formData.direccion} onChange={(e) => setFormData({ ...formData, direccion: e.target.value })} className="h-9" />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500">Localidad</Label>
                      <Select value={formData.localidad_id || "__none__"} onValueChange={(v) => v === "__none__" ? setFormData({ ...formData, localidad_id: "", provincia: "" }) : handleLocalidadChange(v)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sin localidad</SelectItem>
                          {localidades.map((loc) => (
                            <SelectItem key={loc.id} value={loc.id}>{loc.nombre} - {loc.provincia}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Condiciones comerciales */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Condiciones Comerciales</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Fila 1: Pago / Entrega / Vendedor */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs text-slate-500">Condición de Pago *</Label>
                      <Select value={formData.condicion_pago} onValueChange={(v) => setFormData({ ...formData, condicion_pago: v })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Efectivo">Efectivo</SelectItem>
                          <SelectItem value="Transferencia">Transferencia</SelectItem>
                          <SelectItem value="Cheque al día">Cheque al día</SelectItem>
                          <SelectItem value="Cheque 30 días">Cheque 30 días</SelectItem>
                          <SelectItem value="Cheque 30/60/90">Cheque 30/60/90</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500">Condición de Entrega *</Label>
                      <Select value={formData.condicion_entrega} onValueChange={(v) => setFormData({ ...formData, condicion_entrega: v })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="retira_mostrador">Retira en Mostrador</SelectItem>
                          <SelectItem value="transporte">Envío por Transporte</SelectItem>
                          <SelectItem value="entregamos_nosotros">Entregamos Nosotros</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500">Vendedor</Label>
                      <Select value={formData.vendedor_id || "none"} onValueChange={(v) => setFormData({ ...formData, vendedor_id: v === "none" ? "" : v })}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Sin vendedor" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sin vendedor</SelectItem>
                          {vendedores.map((v) => <SelectItem key={v.id} value={v.id}>{v.nombre}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {/* Fila 2: Facturación / Lista / Descuento */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs text-slate-500">Facturación *</Label>
                      <Select
                        value={formData.metodo_facturacion}
                        onValueChange={(v) => {
                          if (v === "PorSegmento") {
                            setFormData({ ...formData, metodo_facturacion: "PorSegmento" })
                          } else {
                            // Al salir de PorSegmento, limpiar métodos de segmento
                            setFormData({ ...formData, metodo_facturacion: v, metodo_limpieza: "", metodo_perf0: "", metodo_perf_plus: "" })
                          }
                        }}
                      >
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Factura">Factura (21% IVA)</SelectItem>
                          <SelectItem value="Final">Final (Mixto)</SelectItem>
                          <SelectItem value="Presupuesto">Presupuesto</SelectItem>
                          <SelectItem value="PorSegmento">— Por Segmento —</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500">Lista de Precio</Label>
                      <Select
                        value={listaPorSegmento ? "__por_segmento__" : (formData.lista_precio_id || "__none__")}
                        onValueChange={(v) => {
                          if (v === "__por_segmento__") {
                            setListaPorSegmento(true)
                            setFormData({ ...formData, lista_precio_id: "" })
                          } else {
                            // Al salir de PorSegmento, limpiar listas de segmento
                            setListaPorSegmento(false)
                            setFormData({ ...formData, lista_precio_id: v === "__none__" ? "" : v, lista_limpieza_id: "", lista_perf0_id: "", lista_perf_plus_id: "" })
                          }
                        }}
                      >
                        <SelectTrigger className="h-9"><SelectValue placeholder="Sin lista" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sin lista</SelectItem>
                          {listasPrecio.map((lp) => <SelectItem key={lp.id} value={lp.id}>{lp.nombre}</SelectItem>)}
                          <SelectItem value="__por_segmento__">— Por Segmento —</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500">Descuento Especial (%)</Label>
                      <Input type="number" step="0.01" min="0" max="100" value={formData.descuento_especial} onChange={(e) => setFormData({ ...formData, descuento_especial: parseFloat(e.target.value) || 0 })} className="h-9" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Condiciones por segmento — aparece automáticamente cuando alguno es "Por Segmento" */}
              {(formData.metodo_facturacion === "PorSegmento" || listaPorSegmento) && (
                <Card className="border-indigo-200 bg-indigo-50/30">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-indigo-700 uppercase tracking-wide">Condiciones por Segmento</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: "Limpieza / Bazar", listaKey: "lista_limpieza_id", metodoKey: "metodo_limpieza", segKey: "limpieza_bazar" },
                        { label: "Perfumería Perf0",  listaKey: "lista_perf0_id",    metodoKey: "metodo_perf0",    segKey: "perf0" },
                        { label: "Perfumería Plus",   listaKey: "lista_perf_plus_id", metodoKey: "metodo_perf_plus", segKey: "perf_plus" },
                      ].map(({ label, listaKey, metodoKey, segKey }) => (
                        <div key={listaKey} className="border border-indigo-200 rounded-lg p-3 bg-white space-y-2">
                          <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wide">{label}</p>

                          {/* Metodo: solo si "Por Segmento" está activo en facturación */}
                          {formData.metodo_facturacion === "PorSegmento" && (
                            <Select
                              value={(formData as any)[metodoKey] || ""}
                              onValueChange={(v) => setFormData({ ...formData, [metodoKey]: v })}
                            >
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Seleccionar método *" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Factura">Factura (21% IVA)</SelectItem>
                                <SelectItem value="Final">Final (Mixto)</SelectItem>
                                <SelectItem value="Presupuesto">Presupuesto</SelectItem>
                              </SelectContent>
                            </Select>
                          )}

                          {/* Lista: solo si "Por Segmento" está activo en lista */}
                          {listaPorSegmento && (
                            <Select
                              value={(formData as any)[listaKey] || ""}
                              onValueChange={(v) => setFormData({ ...formData, [listaKey]: v })}
                            >
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Seleccionar lista *" /></SelectTrigger>
                              <SelectContent>
                                {listasPrecio.map((lp) => <SelectItem key={lp.id} value={lp.id}>{lp.nombre}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}

                          {/* Descuentos siempre visibles en el segmento */}
                          <div className="border-t border-slate-200 pt-2 space-y-1.5">
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Descuentos</p>
                            {BONIF_TIPOS.map(tipo => {
                              const key = `${segKey}__${tipo.key}`
                              const val = bonifGrid[key] || 0
                              return (
                                <div key={tipo.key} className="flex items-center justify-between">
                                  <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${tipo.cls}`}>{tipo.label}</span>
                                  <div className="flex items-center gap-1">
                                    <Input
                                      type="number" step="0.01" min="0" max="100"
                                      className="h-6 w-16 text-center text-xs font-bold px-1"
                                      value={val}
                                      onChange={(e) => setBonifGrid({ ...bonifGrid, [key]: parseFloat(e.target.value) || 0 })}
                                    />
                                    <span className="text-[10px] text-slate-400">%</span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    <Button type="button" size="sm" className="w-full h-9 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={saveBonificaciones} disabled={savingBonif}>
                      {savingBonif ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                      Guardar segmentos y descuentos
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Columna lateral */}
            <div className="space-y-6">

              {/* Datos fiscales */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Datos Fiscales</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs text-slate-500">Tipo de Canal</Label>
                    <Select value={formData.tipo_canal} onValueChange={(v) => setFormData({ ...formData, tipo_canal: v })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Mayorista">Mayorista</SelectItem>
                        <SelectItem value="Minorista">Minorista</SelectItem>
                        <SelectItem value="Consumidor Final">Consumidor Final</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500">N° IIBB</Label>
                    <Input value={formData.nro_iibb} onChange={(e) => setFormData({ ...formData, nro_iibb: e.target.value })} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500">% Percepción IIBB</Label>
                    <Input type="number" step="0.01" value={formData.percepcion_iibb} onChange={(e) => setFormData({ ...formData, percepcion_iibb: parseFloat(e.target.value) || 0 })} className="h-9" />
                  </div>
                  <div className="flex gap-4 pt-1">
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="checkbox" checked={formData.exento_iibb} onChange={(e) => setFormData({ ...formData, exento_iibb: e.target.checked })} className="h-4 w-4 rounded" />
                      Exento IIBB
                    </label>
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="checkbox" checked={formData.exento_iva} onChange={(e) => setFormData({ ...formData, exento_iva: e.target.checked })} className="h-4 w-4 rounded" />
                      Exento IVA
                    </label>
                  </div>
                </CardContent>
              </Card>

              {/* Cuenta Corriente */}
              <Link href={`/clientes/${id}/cuenta-corriente`}>
                <Card className={`cursor-pointer transition-all hover:shadow-md border-2 ${
                  ccBalance === null ? "border-slate-200" :
                  ccBalance > 0 ? "border-red-200 bg-red-50" :
                  ccBalance < 0 ? "border-green-200 bg-green-50" :
                  "border-slate-200 bg-slate-50"
                }`}>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center justify-between">
                      Cuenta Corriente
                      <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {ccBalance === null ? (
                      <p className="text-slate-400 text-sm">Cargando...</p>
                    ) : ccBalance === 0 ? (
                      <div className="flex items-center gap-2">
                        <Minus className="h-5 w-5 text-slate-400" />
                        <span className="text-xl font-bold text-slate-500">$0</span>
                      </div>
                    ) : ccBalance > 0 ? (
                      <div className="flex items-center gap-2">
                        <TrendingDown className="h-5 w-5 text-red-500" />
                        <div>
                          <span className="text-xl font-bold text-red-600">${ccBalance.toLocaleString("es-AR", { maximumFractionDigits: 0 })}</span>
                          <p className="text-xs text-red-500 font-medium">Deuda pendiente</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-green-500" />
                        <div>
                          <span className="text-xl font-bold text-green-600">${Math.abs(ccBalance).toLocaleString("es-AR", { maximumFractionDigits: 0 })}</span>
                          <p className="text-xs text-green-500 font-medium">A favor del cliente</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>

              {/* Pedidos recientes */}
              {pedidosCliente.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-wide">Pedidos Recientes</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y divide-slate-100">
                      {pedidosCliente.map((p: any) => (
                        <Link key={p.id} href={`/clientes-pedidos?pedido=${p.numero_pedido}`}>
                          <div className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors cursor-pointer">
                            <div>
                              <p className="text-sm font-semibold text-slate-700">#{p.numero_pedido}</p>
                              <p className="text-xs text-slate-400">{p.fecha ? new Date(p.fecha).toLocaleDateString("es-AR") : "—"}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-slate-700">${(p.total || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 })}</p>
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${ESTADO_COLORS[p.estado] || "bg-slate-100 text-slate-600"}`}>
                                {p.estado}
                              </span>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </form>
      </main>
    </div>
  )
}
