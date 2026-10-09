"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { formatDateAR } from "@/lib/utils"
import { localMatch } from "@/lib/search/local-match"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Save, Loader2, Store, Truck, Tags, Receipt, Wallet, HandCoins } from "lucide-react"
import { cn } from "@/lib/utils"
import { Campo, Campos, ConUnidad, FichaCabecera, FichaCuerpo, FichaMeta, FichaPie, FichaSeccion } from "@/components/ficha/ficha"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { SegmentacionCondiciones, type SegmentacionValue, EMPTY_SEGMENTACION } from "@/components/pedidos/SegmentacionCondiciones"
import { guardarFichaComercial, guardarSegmentacionCliente } from "@/lib/actions/condiciones-cliente"
import Link from "next/link"
import { moneda, redondear, formatCuit, errorCuit, normalizarCuit } from "@/lib/formato"
import { InputMonto } from "@/components/ui/input-monto"
import { InputCUIT } from "@/components/ui/input-cuit"

function normalizeEnum(v: string | null | undefined, map: Record<string, string>, fallback: string): string {
  if (!v) return fallback
  return map[v.toLowerCase().trim()] ?? map[v.trim()] ?? v
}

const IVA_MAP: Record<string, string> = {
  "responsable inscripto": "Responsable Inscripto",
  "monotributo": "Monotributo",
  "consumidor final": "Consumidor Final",
  "sujeto exento": "Sujeto Exento",
  "no categorizado": "No Categorizado",
}
const PAGO_MAP: Record<string, string> = {
  "efectivo": "Efectivo",
  "transferencia": "Transferencia",
  "cheque al día": "Cheque al día",
  "cheque al dia": "Cheque al día",
  "cheque 30 días": "Cheque 30 días",
  "cheque 30 dias": "Cheque 30 días",
  "cheque 30/60/90": "Cheque 30/60/90",
}
const FACTURACION_MAP: Record<string, string> = {
  "factura": "Factura",
  "final": "Final",
  "presupuesto": "Presupuesto",
  "porsegmento": "PorSegmento",
  "por segmento": "PorSegmento",
}
const CANAL_MAP: Record<string, string> = {
  "mayorista": "Mayorista",
  "minorista": "Minorista",
  "consumidor final": "Consumidor Final",
}
const ENTREGA_MAP: Record<string, string> = {
  "retira_mostrador": "retira_mostrador",
  "retira mostrador": "retira_mostrador",
  "transporte": "transporte",
  "entregamos_nosotros": "entregamos_nosotros",
  "entregamos nosotros": "entregamos_nosotros",
}

const ESTADO_COLORS: Record<string, string> = {
  pendiente: "bg-ambar-50 text-ambar-700",
  impreso: "bg-azul-50 text-azul-700",
  en_preparacion: "bg-azul-50 text-azul-700",
  facturado: "bg-exito-50 text-exito-700",
  entregado: "bg-exito-50 text-exito-700",
  en_viaje: "bg-azul-100 text-azul-800",
}

const iniciales = (n: string) => n.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase() || "?"

export default function ClienteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  // /clientes/nuevo: la misma ficha, vacía (un solo formulario para crear y editar)
  const esNuevo = id === "nuevo"

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [vendedores, setVendedores] = useState<any[]>([])
  const [localidades, setLocalidades] = useState<any[]>([])
  const [listasPrecio, setListasPrecio] = useState<any[]>([])
  const [bonifGrid, setBonifGrid] = useState<Record<string, number>>({})
  const [savingBonif, setSavingBonif] = useState(false)
  const [listaPorSegmento, setListaPorSegmento] = useState(false)
  const [segMetodo, setSegMetodo] = useState(false)
  const [segDescuentos, setSegDescuentos] = useState(false)
  const [ccBalance, setCcBalance] = useState<number | null>(null)
  const [pedidosCliente, setPedidosCliente] = useState<any[]>([])
  // Segmentación por proveedor / marca (lista/facturación/descuentos propios → comprobante aparte)
  const [segmentacion, setSegmentacion] = useState<SegmentacionValue>(EMPTY_SEGMENTACION)
  const [savingSeg, setSavingSeg] = useState(false)
  const [formData, setFormData] = useState({
    codigo_cliente: "",
    // nombre = cómo lo conocemos (nombre de fantasía); nombre_razon_social = a quién se factura
    nombre: "",
    nombre_razon_social: "",
    direccion: "",
    cuit: "",
    condicion_iva: "Consumidor Final",
    metodo_facturacion: "Factura",
    localidad_id: "",
    localidad: "",
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
    if (esNuevo) {
      const [vendRes, locRes, listasRes] = await Promise.all([
        supabase.from("vendedores").select("id, nombre").eq("activo", true).order("nombre"),
        supabase.from("localidades").select("*, zonas(nombre)").order("provincia, nombre"),
        supabase.from("listas_precio").select("id, nombre, codigo").eq("activo", true).order("nombre"),
      ])
      setVendedores(vendRes.data || [])
      setLocalidades(locRes.data || [])
      setListasPrecio(listasRes.data || [])
      setLoading(false)
      return
    }
    const [clienteRes, vendRes, locRes, listasRes, ccRes, pedRes] = await Promise.all([
      supabase.from("clientes").select("*, localidades(nombre, zonas(nombre))").eq("id", id).single(),
      supabase.from("vendedores").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("localidades").select("*, zonas(nombre)").order("provincia, nombre"),
      supabase.from("listas_precio").select("id, nombre, codigo").eq("activo", true).order("nombre"),
      supabase.from("v_saldo_clientes").select("saldo_actual").eq("cliente_id", id).maybeSingle(),
      supabase.from("pedidos").select("id, numero_pedido, fecha, estado, total").eq("cliente_id", id).order("fecha", { ascending: false }).limit(10),
    ])

    if (clienteRes.data) {
      const c = clienteRes.data as any
      setFormData({
        codigo_cliente: c.codigo_cliente || "",
        nombre: c.nombre || "",
        nombre_razon_social: c.nombre_razon_social || c.razon_social || "",
        direccion: c.direccion || "",
        cuit: c.cuit || "",
        condicion_iva: normalizeEnum(c.condicion_iva, IVA_MAP, "Consumidor Final"),
        metodo_facturacion: normalizeEnum(c.metodo_facturacion, FACTURACION_MAP, "Factura"),
        localidad_id: c.localidad_id || "",
        localidad: c.localidad || c.localidades?.nombre || "",
        provincia: c.provincia || "",
        telefono: c.telefono || "",
        mail: c.mail || "",
        condicion_pago: normalizeEnum(c.condicion_pago, PAGO_MAP, "Efectivo"),
        nro_iibb: c.nro_iibb || "",
        exento_iibb: c.exento_iibb || false,
        exento_iva: c.exento_iva || false,
        percepcion_iibb: c.percepcion_iibb || 0,
        tipo_canal: normalizeEnum(c.tipo_canal, CANAL_MAP, "Minorista"),
        vendedor_id: c.vendedor_id || "",
        condicion_entrega: normalizeEnum(c.condicion_entrega, ENTREGA_MAP, "entregamos_nosotros"),
        lista_precio_id: c.lista_precio_id || "",
        lista_limpieza_id: c.lista_limpieza_id || "",
        metodo_limpieza: normalizeEnum(c.metodo_limpieza, FACTURACION_MAP, ""),
        lista_perf0_id: c.lista_perf0_id || "",
        metodo_perf0: normalizeEnum(c.metodo_perf0, FACTURACION_MAP, ""),
        lista_perf_plus_id: c.lista_perf_plus_id || "",
        metodo_perf_plus: normalizeEnum(c.metodo_perf_plus, FACTURACION_MAP, ""),
      })
    }
    setVendedores(vendRes.data || [])
    setLocalidades(locRes.data || [])
    setListasPrecio(listasRes.data || [])
    // Saldo desde el libro mayor (fuente única): Σdebe − Σhaber
    const balance = Number((ccRes.data as any)?.saldo_actual ?? 0)
    setCcBalance(redondear(balance))
    setPedidosCliente(pedRes.data || [])
    if (clienteRes.data) {
      const c = clienteRes.data as any
      const esSentinela = normalizeEnum(c.metodo_facturacion, FACTURACION_MAP, "Factura") === "PorSegmento"
      setSegMetodo(esSentinela || !!(c.metodo_limpieza || c.metodo_perf0 || c.metodo_perf_plus))
      setListaPorSegmento(!!(c.lista_limpieza_id || c.lista_perf0_id || c.lista_perf_plus_id))
      // El método general no debe quedar con el centinela: si segmenta, queda vacío.
      if (esSentinela) setFormData(prev => ({ ...prev, metodo_facturacion: "" }))
    }
    loadBonificaciones()
    loadCondProv()
    setLoading(false)
  }

  async function loadCondProv() {
    const [prov, marca] = await Promise.all([
      supabase.from("cliente_proveedor_condicion")
        .select("proveedor_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, contado, proveedores:proveedor_id(nombre)")
        .eq("cliente_id", id).order("created_at"),
      supabase.from("cliente_marca_condicion")
        .select("marca_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, contado, marcas:marca_id(descripcion)")
        .eq("cliente_id", id).order("created_at"),
    ])
    setSegmentacion({
      proveedor: ((prov.data || []) as any[]).map(r => ({
        ref_id: r.proveedor_id, nombre: r.proveedores?.nombre || "—",
        lista_precio_id: r.lista_precio_id, metodo_facturacion: r.metodo_facturacion || null,
        dto_general_pct: r.dto_general_pct, dto_viajante_pct: r.dto_viajante_pct, dto_mercaderia_pct: r.dto_mercaderia_pct,
        contado: r.contado ?? null,
      })),
      marca: ((marca.data || []) as any[]).map(r => ({
        ref_id: r.marca_id, nombre: r.marcas?.descripcion || "—",
        lista_precio_id: r.lista_precio_id, metodo_facturacion: r.metodo_facturacion || null,
        dto_general_pct: r.dto_general_pct, dto_viajante_pct: r.dto_viajante_pct, dto_mercaderia_pct: r.dto_mercaderia_pct,
        contado: r.contado ?? null,
      })),
    })
  }

  // Guarda la segmentación del cliente (reemplaza todo). Los pedidos ya tomados
  // no cambian: rige desde el próximo pedido.
  // Botón único (08/10/2026): la segmentación se guarda junto con el resto, pero
  // solo si se tocó (así un error al cargarla nunca la borra al guardar la ficha).
  const [segTocada, setSegTocada] = useState(false)
  const mapSegmentacion = (rows: SegmentacionValue["proveedor"]) => rows.map(r => ({
    ref_id: r.ref_id, lista_precio_id: r.lista_precio_id, metodo_facturacion: r.metodo_facturacion,
    dto_general_pct: r.dto_general_pct, dto_viajante_pct: r.dto_viajante_pct, dto_mercaderia_pct: r.dto_mercaderia_pct,
    contado: r.contado ?? null,
  }))

  async function saveSegmentacion() {
    setSavingSeg(true)
    try {
      await guardarSegmentacionCliente(id, { proveedor: mapSegmentacion(segmentacion.proveedor), marca: mapSegmentacion(segmentacion.marca) })
      await loadCondProv()
      alert("Segmentación guardada. Rige desde el próximo pedido (los pedidos ya tomados no cambian).")
    } catch (e: any) {
      alert(`Error al guardar la segmentación: ${e?.message || e}`)
    } finally {
      setSavingSeg(false)
    }
  }

  const BONIF_SEGMENTS = [
    { key: "todos",          label: "Todos" },
    { key: "limpieza_bazar", label: "Limpieza / Bazar" },
    { key: "perf0",          label: "Perfumería Perf0" },
    { key: "perf_plus",      label: "Perfumería Plus" },
  ]
  const BONIF_TIPOS = [
    { key: "general", label: "General", cls: "text-blue-700 bg-blue-50 border-blue-200" },
    { key: "mercaderia", label: "Mercadería", cls: "text-green-700 bg-green-50 border-green-200" },
    { key: "viajante", label: "Viajante", cls: "text-orange-700 bg-orange-50 border-orange-200" },
  ]

  async function loadBonificaciones() {
    const { data } = await supabase.from("bonificaciones").select("tipo, porcentaje, segmento, proveedor_id").eq("cliente_id", id).eq("activo", true)
    const grid: Record<string, number> = {}
    let haySeg = false
    for (const b of (data || []).filter((x: any) => !x.proveedor_id)) {
      const segKey = b.segmento || "todos"
      grid[`${segKey}__${b.tipo}`] = b.porcentaje
      if (b.segmento) haySeg = true
    }
    setBonifGrid(grid)
    setSegDescuentos(haySeg)
  }

  // Lista/método (según cada toggle General / Por segmento) y descuentos+contado
  // de la ficha, por el camino único del ERP (lib/actions/condiciones-cliente.ts).
  const listasDeFormulario = () => ({
    metodo_facturacion: !segMetodo ? (formData.metodo_facturacion || null) : null,
    lista_precio_id:    formData.lista_precio_id || null,
    metodo_limpieza:    segMetodo ? (formData.metodo_limpieza || null) : null,
    metodo_perf0:       segMetodo ? (formData.metodo_perf0 || null) : null,
    metodo_perf_plus:   segMetodo ? (formData.metodo_perf_plus || null) : null,
    lista_limpieza_id:  listaPorSegmento ? (formData.lista_limpieza_id || null) : null,
    lista_perf0_id:     listaPorSegmento ? (formData.lista_perf0_id || null) : null,
    lista_perf_plus_id: listaPorSegmento ? (formData.lista_perf_plus_id || null) : null,
  })

  async function saveBonificaciones() {
    setSavingBonif(true)
    try {
      await guardarFichaComercial(id, {
        listas: listasDeFormulario(),
        descuentos: { porSegmento: segDescuentos, valores: bonifGrid },
      })
      await loadBonificaciones()
      alert("Condiciones guardadas. Rigen desde el próximo pedido (los pedidos ya tomados no cambian; para llevarlos a precios de hoy usá Repreciar en el pedido).")
    } catch (e: any) {
      alert(`Error al guardar: ${e?.message || e}`)
    } finally {
      setSavingBonif(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errCuit = errorCuit(formData.cuit)
    if (errCuit) {
      alert(errCuit)
      return
    }
    setSaving(true)
    const dataToSave = {
      ...formData,
      cuit: normalizarCuit(formData.cuit),
      // Antes los dos campos se pisaban con la razón social y se perdía el nombre
      // de fantasía que carga el vendedor ("Súper Eco 17"). Vacío = igual a la razón social.
      nombre: formData.nombre.trim() || formData.nombre_razon_social,
      razon_social: formData.nombre_razon_social,
      vendedor_id: formData.vendedor_id && formData.vendedor_id !== "none" ? formData.vendedor_id : null,
      localidad_id: formData.localidad_id || null,
    }
    // Lista/método/descuentos no van en este update: se guardan con los toggles
    // General / Por segmento por el camino único (guardarFichaComercial).
    for (const k of ["metodo_facturacion", "lista_precio_id", "lista_limpieza_id", "metodo_limpieza", "lista_perf0_id", "metodo_perf0", "lista_perf_plus_id", "metodo_perf_plus"]) {
      delete (dataToSave as any)[k]
    }
    // Alta: se crea el cliente y desde ahí sigue el mismo camino que la edición
    let clienteId = id
    let error: { message: string } | null = null
    if (esNuevo) {
      const res = await supabase.from("clientes").insert(dataToSave).select("id").single()
      error = res.error
      if (res.data?.id) clienteId = res.data.id
    } else {
      error = (await supabase.from("clientes").update(dataToSave).eq("id", id)).error
    }
    if (error) {
      alert(`Error al guardar: ${error.message}`)
    } else {
      // Sello de auditoría best-effort (requiere migración 20260707_clientes_auditoria;
      // va aparte para no voltear el guardado si la columna todavía no existe)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase
            .from("clientes")
            .update({ actualizado_por: user.id, actualizado_at: new Date().toISOString() })
            .eq("id", clienteId)
        }
      } catch {}
      fetch("/api/embed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity: "clientes", id: clienteId }) }).catch(() => {})
      // Lista, método, descuentos y contado (mismo guardado que el botón de la sección)
      try {
        await guardarFichaComercial(clienteId, {
          listas: listasDeFormulario(),
          descuentos: { porSegmento: segDescuentos, valores: bonifGrid },
        })
      } catch (e: any) {
        alert(`Cliente guardado, pero no se pudieron guardar lista/descuentos: ${e?.message || e}`)
        setSaving(false)
        return
      }
      // Segmentación por proveedor/marca (mismo guardado que tenía su botón), solo si se tocó
      if (segTocada) {
        try {
          await guardarSegmentacionCliente(clienteId, { proveedor: mapSegmentacion(segmentacion.proveedor), marca: mapSegmentacion(segmentacion.marca) })
        } catch (e: any) {
          alert(`Cliente y condiciones guardados, pero no se pudo guardar la segmentación: ${e?.message || e}`)
          setSaving(false)
          return
        }
      }
      router.push("/clientes")
    }
    setSaving(false)
  }

  function handleLocalidadChange(localidadId: string) {
    const loc = localidades.find((l) => l.id === localidadId)
    setFormData({ ...formData, localidad_id: localidadId, localidad: loc?.nombre || "", provincia: loc?.provincia || "" })
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <CargaProgreso mensajes={MENSAJES.fichaCliente} titulo="Abriendo la ficha del cliente" />
      </div>
    )
  }

  const set = (campo: string, valor: any) => setFormData({ ...formData, [campo]: valor })
  const listasVisibles = listasPrecio.filter((lp: any) => lp.codigo !== "especial")
  const localidadSel = localidades.find((l: any) => l.id === formData.localidad_id)
  const vendedorSel = vendedores.find((v: any) => v.id === formData.vendedor_id)
  const algunoPorSegmento = segMetodo || listaPorSegmento || segDescuentos
  const cantSegmentacion = segmentacion.proveedor.length + segmentacion.marca.length

  // General / Por segmento: mismo comportamiento de siempre, con el estilo de la ficha
  const SegToggle = ({ on, set: cambiar }: { on: boolean; set: (b: boolean) => void }) => (
    <div className="inline-flex shrink-0 rounded-lg border border-neutro-200 bg-neutro-50 p-0.5 text-xs">
      <button type="button" onClick={() => cambiar(false)} className={cn("rounded-md px-2.5 py-1.5 font-semibold transition-colors", !on ? "bg-white text-azul-700 shadow-sm" : "text-neutro-500 hover:text-neutro-700")}>General</button>
      <button type="button" onClick={() => cambiar(true)} className={cn("rounded-md px-2.5 py-1.5 font-semibold transition-colors", on ? "bg-white text-azul-700 shadow-sm" : "text-neutro-500 hover:text-neutro-700")}>Por segmento</button>
    </div>
  )
  const PorSegmentoAbajo = ({ texto }: { texto: string }) => (
    <div className="flex h-10 items-center rounded-lg border border-dashed border-azul-200 bg-azul-50/50 px-3 text-sm font-medium text-azul-600 lg:max-w-md">{texto}</div>
  )
  const Tilde = ({ checked, onChange, texto }: { checked: boolean; onChange: (b: boolean) => void; texto: string }) => (
    <label className="flex h-10 cursor-pointer select-none items-center gap-2 rounded-lg border border-neutro-200 bg-white px-3 text-sm font-medium text-neutro-700 hover:bg-neutro-50">
      <input type="checkbox" className="size-4 accent-azul-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {texto}
    </label>
  )
  const Contado = ({ k, texto }: { k: string; texto: string }) => (
    <Tilde checked={(bonifGrid[k] || 0) > 0} onChange={(b) => setBonifGrid({ ...bonifGrid, [k]: b ? 10 : 0 })} texto={texto} />
  )
  const SEGMENTOS = [
    { label: "Limpieza / Bazar", listaKey: "lista_limpieza_id", metodoKey: "metodo_limpieza", segKey: "limpieza_bazar" },
    { label: "Perfumería Perf0", listaKey: "lista_perf0_id", metodoKey: "metodo_perf0", segKey: "perf0" },
    { label: "Perfumería Plus", listaKey: "lista_perf_plus_id", metodoKey: "metodo_perf_plus", segKey: "perf_plus" },
  ]
  const METODO_CORTO: Record<string, string> = { "Factura": "Factura", "Final": "Mixto", "Presupuesto": "Presupuesto" }
  const metGen = formData.metodo_facturacion || "Final"
  const metHeredar = `Como el general (${METODO_CORTO[metGen] ?? metGen})`
  const listaGenNombre = listasPrecio.find((l: any) => l.id === formData.lista_precio_id)?.nombre ?? ""
  const listaHeredar = listaGenNombre ? `Como la general (${listaGenNombre})` : "Como la general (sin lista)"

  return (
    <form id="cliente-form" onSubmit={handleSubmit} className="mx-auto flex min-h-full max-w-6xl flex-col bg-white md:h-full lg:border-x">
      <FichaCabecera
        className="pr-5 sm:pr-6"
        foto={
          <div className="flex items-center gap-2">
            <Link href="/clientes" aria-label="Volver a clientes" className="grid size-9 place-items-center rounded-lg text-neutro-500 hover:bg-neutro-100">
              <ArrowLeft className="size-5" />
            </Link>
            <div className="grid size-14 place-items-center rounded-xl bg-azul-600 text-lg font-bold text-white sm:size-16">{iniciales(formData.nombre || formData.nombre_razon_social)}</div>
          </div>
        }
        titulo={formData.nombre || formData.nombre_razon_social || (esNuevo ? "Nuevo cliente" : "Cliente sin nombre")}
        meta={
          <>
            {formData.nombre && formData.nombre_razon_social && formData.nombre.trim() !== formData.nombre_razon_social.trim() && (
              <FichaMeta label="Razón social">{formData.nombre_razon_social}</FichaMeta>
            )}
            {formData.codigo_cliente && <FichaMeta label="Código">{formData.codigo_cliente}</FichaMeta>}
            {formData.cuit && <FichaMeta label="CUIT">{formatCuit(formData.cuit)}</FichaMeta>}
            {localidadSel && <FichaMeta>{localidadSel.nombre}{localidadSel.zonas?.nombre ? ` · ${localidadSel.zonas.nombre}` : ""}</FichaMeta>}
            {vendedorSel && <FichaMeta label="Vendedor">{vendedorSel.nombre}</FichaMeta>}
            {esNuevo && !formData.nombre_razon_social && <span>Completá al menos el nombre</span>}
          </>
        }
        acciones={esNuevo ? undefined : (
          <>
            <Button type="button" variant="outline" asChild>
              <Link href={`/clientes/${id}/cuenta-corriente`} className="gap-2">
                <Wallet className="size-4" />
                Cuenta corriente
                {ccBalance !== null && ccBalance !== 0 && (
                  <span className={cn("font-bold tabular-nums", ccBalance > 0 ? "text-alerta-600" : "text-exito-600")}>{moneda(Math.abs(ccBalance), 0)}</span>
                )}
              </Link>
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href={`/pagos-clientes?cliente_id=${id}`} className="gap-2"><HandCoins className="size-4" />Cobrar</Link>
            </Button>
          </>
        )}
      />

      <FichaCuerpo secciones={[
        { id: "datos", titulo: "Datos y contacto" },
        { id: "venta", titulo: "Venta y entrega" },
        { id: "precios", titulo: "Lista y descuentos", nota: cantSegmentacion ? `+${cantSegmentacion}` : algunoPorSegmento ? "por segmento" : undefined },
        { id: "fiscal", titulo: "Fiscal" },
        ...(esNuevo ? [] : [{ id: "cuenta", titulo: "Cuenta y pedidos" }]),
      ]}>
        <FichaSeccion id="datos" titulo="Datos y contacto" icono={Store} ayuda="Quién es el cliente y dónde lo encontramos.">
          <Campos>
            <Campo label="Razón social" nota="a quién se factura · obligatorio" ancho={2}>
              <Input value={formData.nombre_razon_social} onChange={(e) => set("nombre_razon_social", e.target.value)} required />
            </Campo>
            <Campo label="Nombre" nota="cómo lo conocemos · vacío = razón social" ancho={2}>
              <Input value={formData.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder={formData.nombre_razon_social || "Ej.: Súper Eco 17"} />
            </Campo>
            <Campo label="Código">
              <Input className="tabular-nums" value={formData.codigo_cliente} onChange={(e) => set("codigo_cliente", e.target.value)} placeholder="CL-001" />
            </Campo>
            <Campo label="CUIT">
              <InputCUIT value={formData.cuit} onChange={(v) => set("cuit", v)} />
            </Campo>
            <Campo label="Dirección" ancho={2}>
              <Input value={formData.direccion} onChange={(e) => set("direccion", e.target.value)} />
            </Campo>
            <Campo label="Localidad" nota={localidadSel?.zonas?.nombre ? `zona ${localidadSel.zonas.nombre}` : undefined} ancho={2}>
              <Select value={formData.localidad_id || "__none__"} onValueChange={(v) => v === "__none__" ? setFormData({ ...formData, localidad_id: "", provincia: "" }) : handleLocalidadChange(v)}>
                <SelectTrigger><SelectValue placeholder="Elegir localidad" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin localidad</SelectItem>
                  {localidades.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.nombre} - {loc.provincia}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Teléfono">
              <Input type="tel" value={formData.telefono} onChange={(e) => set("telefono", e.target.value)} />
            </Campo>
            <Campo label="Email" ancho={2}>
              <Input type="email" value={formData.mail} onChange={(e) => set("mail", e.target.value)} />
            </Campo>
          </Campos>
        </FichaSeccion>

        <FichaSeccion id="venta" titulo="Venta y entrega" icono={Truck} ayuda="Quién lo atiende, cómo le llega la mercadería y cómo paga.">
          <Campos>
            <Campo label="Vendedor">
              <Select value={formData.vendedor_id || "none"} onValueChange={(v) => set("vendedor_id", v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Sin vendedor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin vendedor</SelectItem>
                  {vendedores.map((v) => <SelectItem key={v.id} value={v.id}>{v.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Entrega" nota="obligatorio">
              <Select value={formData.condicion_entrega} onValueChange={(v) => set("condicion_entrega", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="retira_mostrador">Retira en mostrador</SelectItem>
                  <SelectItem value="transporte">Envío por transporte</SelectItem>
                  <SelectItem value="entregamos_nosotros">Entregamos nosotros</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Condición de pago" nota="obligatorio">
              <Select value={formData.condicion_pago} onValueChange={(v) => set("condicion_pago", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Efectivo">Efectivo</SelectItem>
                  <SelectItem value="Transferencia">Transferencia</SelectItem>
                  <SelectItem value="Cheque al día">Cheque al día</SelectItem>
                  <SelectItem value="Cheque 30 días">Cheque 30 días</SelectItem>
                  <SelectItem value="Cheque 30/60/90">Cheque 30/60/90</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Tipo de canal">
              <Select value={formData.tipo_canal} onValueChange={(v) => set("tipo_canal", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Mayorista">Mayorista</SelectItem>
                  <SelectItem value="Minorista">Minorista</SelectItem>
                  <SelectItem value="Consumidor Final">Consumidor final</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
          </Campos>
        </FichaSeccion>

        <FichaSeccion id="precios" titulo="Lista, facturación y descuentos" icono={Tags}
          ayuda="Rigen desde el próximo pedido: los ya tomados no cambian (para llevarlos a precios de hoy, usá Repreciar en el pedido). Cada uno puede ser igual para todo o distinto por segmento.">
          <div className="space-y-5">
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3 lg:max-w-md">
                <span className="text-[13px] font-semibold text-neutro-600">Lista de precios</span>
                <SegToggle on={listaPorSegmento} set={setListaPorSegmento} />
              </div>
              {!listaPorSegmento ? (
                <Select value={formData.lista_precio_id || "__none__"} onValueChange={(v) => set("lista_precio_id", v === "__none__" ? "" : v)}>
                  <SelectTrigger className="lg:max-w-md"><SelectValue placeholder="Sin lista" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin lista</SelectItem>
                    {listasVisibles.map((lp: any) => <SelectItem key={lp.id} value={lp.id}>{lp.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : <PorSegmentoAbajo texto="Se elige en cada segmento, más abajo" />}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3 lg:max-w-md">
                <span className="text-[13px] font-semibold text-neutro-600">Facturación</span>
                <SegToggle on={segMetodo} set={(b) => { setSegMetodo(b); if (b) setFormData(prev => ({ ...prev, metodo_facturacion: "" })) }} />
              </div>
              {!segMetodo ? (
                <Select value={formData.metodo_facturacion || "Final"} onValueChange={(v) => set("metodo_facturacion", v)}>
                  <SelectTrigger className="lg:max-w-md"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Factura">Factura (21% IVA)</SelectItem>
                    <SelectItem value="Final">Final (mixto)</SelectItem>
                    <SelectItem value="Presupuesto">Presupuesto</SelectItem>
                  </SelectContent>
                </Select>
              ) : <PorSegmentoAbajo texto="Se elige en cada segmento, más abajo" />}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3 lg:max-w-md">
                <span className="text-[13px] font-semibold text-neutro-600">Descuentos</span>
                <SegToggle on={segDescuentos} set={setSegDescuentos} />
              </div>
              {!segDescuentos ? (
                <Campos>
                  {BONIF_TIPOS.map(tipo => (
                    <Campo key={tipo.key} label={tipo.label}>
                      <ConUnidad unidad="%">
                        <InputMonto soloPositivos
                          value={bonifGrid[`todos__${tipo.key}`] || 0}
                          onChange={(n) => setBonifGrid({ ...bonifGrid, [`todos__${tipo.key}`]: n ?? 0 })} />
                      </ConUnidad>
                    </Campo>
                  ))}
                  <Campo label="Pago contado">
                    <Contado k="todos__contado" texto="10% por pago contado" />
                  </Campo>
                </Campos>
              ) : <PorSegmentoAbajo texto="Se cargan en cada segmento, más abajo" />}
            </div>

            {algunoPorSegmento && (
              <div className="grid gap-3 md:grid-cols-3">
                {SEGMENTOS.map(({ label, listaKey, metodoKey, segKey }) => (
                  <div key={segKey} className="space-y-3 rounded-xl border border-neutro-200 bg-neutro-50/60 p-4">
                    <p className="text-sm font-bold text-azul-900">{label}</p>
                    {listaPorSegmento && (
                      <Campo label="Lista">
                        <Select value={(formData as any)[listaKey] || "__heredar__"} onValueChange={(v) => set(listaKey, v === "__heredar__" ? "" : v)}>
                          <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__heredar__">{listaHeredar}</SelectItem>
                            {listasVisibles.map((lp: any) => <SelectItem key={lp.id} value={lp.id}>{lp.nombre}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Campo>
                    )}
                    {segMetodo && (
                      <Campo label="Facturación">
                        <Select value={(formData as any)[metodoKey] || "__heredar__"} onValueChange={(v) => set(metodoKey, v === "__heredar__" ? "" : v)}>
                          <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__heredar__">{metHeredar}</SelectItem>
                            <SelectItem value="Factura">Factura (21% IVA)</SelectItem>
                            <SelectItem value="Final">Final (mixto)</SelectItem>
                            <SelectItem value="Presupuesto">Presupuesto</SelectItem>
                          </SelectContent>
                        </Select>
                      </Campo>
                    )}
                    {segDescuentos && (
                      <div className="grid grid-cols-3 gap-2">
                        {BONIF_TIPOS.map(tipo => {
                          const key = `${segKey}__${tipo.key}`
                          return (
                            <Campo key={tipo.key} label={tipo.label}>
                              <ConUnidad unidad="%">
                                <InputMonto soloPositivos className="bg-white px-2"
                                  value={bonifGrid[key] || 0}
                                  onChange={(n) => setBonifGrid({ ...bonifGrid, [key]: n ?? 0 })} />
                              </ConUnidad>
                            </Campo>
                          )
                        })}
                        <div className="col-span-3">
                          <Contado k={`${segKey}__contado`} texto="10% contado (NC aparte)" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-neutro-200 pt-5">
              <p className="text-[13px] font-semibold text-neutro-600">Por proveedor o marca</p>
              <p className="mb-3 mt-0.5 max-w-[62ch] text-xs text-neutro-500">
                Lista, facturación y descuentos propios para la mercadería de un proveedor o una marca; esa mercadería se factura aparte.
                La opción <b className="font-semibold text-neutro-600">Especial</b> aparece solo si el proveedor o la marca tiene precio especial cargado.
              </p>
              <SegmentacionCondiciones listas={listasPrecio} value={segmentacion} onChange={(v) => { setSegmentacion(v); setSegTocada(true) }} />
            </div>
          </div>
        </FichaSeccion>

        <FichaSeccion id="fiscal" titulo="Fiscal" icono={Receipt} ayuda="Cómo se le factura y qué percepciones lleva.">
          <Campos>
            <Campo label="Condición de IVA" nota="obligatorio" ancho={2}>
              <Select value={formData.condicion_iva} onValueChange={(v) => set("condicion_iva", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Responsable Inscripto">Responsable inscripto</SelectItem>
                  <SelectItem value="Monotributo">Monotributo</SelectItem>
                  <SelectItem value="Consumidor Final">Consumidor final</SelectItem>
                  <SelectItem value="Sujeto Exento">Sujeto exento</SelectItem>
                  <SelectItem value="No Categorizado">No categorizado</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="N° de IIBB">
              <Input className="tabular-nums" value={formData.nro_iibb} onChange={(e) => set("nro_iibb", e.target.value)} />
            </Campo>
            <Campo label="Percepción IIBB">
              <ConUnidad unidad="%">
                <InputMonto value={formData.percepcion_iibb} onChange={(n) => set("percepcion_iibb", n ?? 0)} />
              </ConUnidad>
            </Campo>
            <Campo label="Exenciones" ancho={2}>
              <div className="flex flex-wrap gap-2">
                <Tilde checked={formData.exento_iibb} onChange={(b) => set("exento_iibb", b)} texto="Exento de IIBB" />
                <Tilde checked={formData.exento_iva} onChange={(b) => set("exento_iva", b)} texto="Exento de IVA" />
              </div>
            </Campo>
          </Campos>
        </FichaSeccion>

        {!esNuevo && (
        <FichaSeccion id="cuenta" titulo="Cuenta y pedidos" icono={Wallet} ayuda="Lo que debe hoy y sus últimos pedidos.">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
            <Link href={`/clientes/${id}/cuenta-corriente`} className={cn(
              "block rounded-xl border p-4 transition-shadow hover:shadow-md",
              ccBalance === null || ccBalance === 0 ? "border-neutro-200 bg-neutro-50" : ccBalance > 0 ? "border-alerta-200 bg-alerta-50" : "border-exito-200 bg-exito-50",
            )}>
              <p className="text-[13px] font-semibold text-neutro-600">Saldo de cuenta corriente</p>
              {ccBalance === null ? (
                <p className="mt-1 text-sm text-neutro-400">Sin datos</p>
              ) : (
                <>
                  <p className={cn("mt-1 text-2xl font-bold tabular-nums", ccBalance > 0 ? "text-alerta-600" : ccBalance < 0 ? "text-exito-600" : "text-neutro-500")}>{moneda(Math.abs(ccBalance), 0)}</p>
                  <p className="text-xs font-medium text-neutro-500">{ccBalance > 0 ? "Nos debe" : ccBalance < 0 ? "A favor del cliente" : "Al día"}</p>
                </>
              )}
              <p className="mt-3 text-xs font-semibold text-azul-600">Ver cuenta corriente →</p>
            </Link>

            <div className="overflow-hidden rounded-xl border border-neutro-200">
              {pedidosCliente.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-neutro-400">Todavía no tiene pedidos.</p>
              ) : (
                <ul className="divide-y divide-neutro-100">
                  {pedidosCliente.map((p: any) => (
                    <li key={p.id}>
                      <Link href={`/clientes-pedidos?pedido=${p.numero_pedido}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-neutro-50">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-azul-900">Pedido {p.numero_pedido}</p>
                          <p className="text-xs text-neutro-500">{p.fecha ? formatDateAR(p.fecha) : "—"}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", ESTADO_COLORS[p.estado] || "bg-neutro-100 text-neutro-600")}>{(p.estado || "").replace(/_/g, " ")}</span>
                          <span className="w-24 text-right text-sm font-bold tabular-nums text-azul-900">{moneda(p.total || 0, 0)}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </FichaSeccion>
        )}
      </FichaCuerpo>

      <FichaPie className="sticky bottom-0 z-10 md:static" mensaje={<span className="hidden sm:inline">Un solo botón guarda todo: datos, condiciones y segmentación.</span>}>
        <Button type="button" variant="outline" asChild><Link href="/clientes">Cancelar</Link></Button>
        <Button type="submit" disabled={saving} className="gap-2">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? "Guardando…" : esNuevo ? "Crear cliente" : "Guardar cambios"}
        </Button>
      </FichaPie>
    </form>
  )
}
