"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { agregarItemPedido, agregarItemBonificado, eliminarItemPedido, guardarItemsPedido, actualizarCantidadItem, previewPrecioArticulo, repreciarPedido, actualizarEncabezadoPedido, guardarCondicionesPedido } from "@/lib/actions/pedidos"
import { SegmentacionCondiciones, condRowsToProveedor, condRowsToMarca, EMPTY_SEGMENTACION, type SegmentacionValue } from "@/components/pedidos/SegmentacionCondiciones"
import { esPedidoEditable, puedeEditarEntrega, transicionesManuales, motivoBloqueo, ESTADO_LABEL } from "@/lib/pedidos/estados"
import { detectarSegmentoBonif, SEGMENTOS_BONIF, SEGMENTO_LABEL, normalizarBonifPedido, type SegmentoBonif } from "@/lib/pricing/segmento"
import { localMatch } from "@/lib/search/local-match"
import { ArticuloResultRow } from "@/components/search/ArticuloResultRow"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Loader2, Plus, Trash2, Search, Package, Save, ChevronDown, ChevronRight, Undo2 } from "lucide-react"

type ItemEdit = { precio_final: number; cantidad: number; estado_item: string }

const ESTADO_COLORS: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800 border-yellow-300",
  impreso: "bg-sky-100 text-sky-800 border-sky-300",
  en_preparacion: "bg-blue-100 text-blue-800 border-blue-300",
  facturado: "bg-emerald-100 text-emerald-800 border-emerald-300",
  entregado: "bg-green-100 text-green-800 border-green-300",
  en_viaje: "bg-purple-100 text-purple-800 border-purple-300",
}

export default function PedidoEditPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [pedido, setPedido] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [found, setFound] = useState<any[]>([])
  const [selectedProduct, setSelectedProduct] = useState<any>(null)
  const [qty, setQty] = useState(1)
  const [saving, setSaving] = useState(false)
  const [savingAdd, setSavingAdd] = useState(false)
  const [savingBonif, setSavingBonif] = useState(false)
  const [bonifMercaderia, setBonifMercaderia] = useState<any[]>([])
  const [queryBonif, setQueryBonif] = useState("")
  const [foundBonif, setFoundBonif] = useState<any[]>([])
  const [qtyBonif, setQtyBonif] = useState(0)
  const [bonifPct, setBonifPct] = useState(0)
  // Descuentos por segmento: ficha del cliente (general/viajante/mercadería) y
  // override "solo este pedido" (pedidos.bonif_pedido, el mismo que usa la app
  // del vendedor). Form: clave `${tipo}.${segmento}` → string ("" = hereda).
  const [bonifFicha, setBonifFicha] = useState<any[]>([])
  const [bonifPedidoForm, setBonifPedidoForm] = useState<Record<string, string>>({})
  const [condSegmento, setCondSegmento] = useState<any[]>([])
  const [recalcBonif, setRecalcBonif] = useState(false)
  const [showBonifPanel, setShowBonifPanel] = useState(false)
  const [headerOpen, setHeaderOpen] = useState(true)
  const [filterQuery, setFilterQuery] = useState("")
  const [showAddPanel, setShowAddPanel] = useState(false)
  const [listasPrecio, setListasPrecio] = useState<any[]>([])
  const [vendedores, setVendedores] = useState<any[]>([])
  const [itemEdits, setItemEdits] = useState<Record<string, ItemEdit>>({})
  // Condiciones por proveedor / marca "solo este pedido" (editor)
  const [segPedido, setSegPedido] = useState<SegmentacionValue>(EMPTY_SEGMENTACION)
  const [savingCond, setSavingCond] = useState(false)
  const [headerForm, setHeaderForm] = useState({
    estado: "",
    metodo_facturacion_pedido: "",
    condicion_entrega: "",
    vendedor_id: "",
    lista_precio_pedido_id: "",
    lista_limpieza_pedido_id: "",
    metodo_limpieza_pedido: "",
    lista_perf0_pedido_id: "",
    metodo_perf0_pedido: "",
    lista_perf_plus_pedido_id: "",
    metodo_perf_plus_pedido: "",
    observaciones: "",
  })

  useEffect(() => { loadAll() }, [id])

  async function loadAll() {
    setLoading(true)
    const [pedRes, itemsRes, listasRes, vendRes] = await Promise.all([
      supabase.from("pedidos").select(`
        id, numero_pedido, fecha, estado, total, subtotal, cliente_id, bonif_mercaderia_pct, bonif_pedido,
        metodo_facturacion_pedido, condicion_entrega, observaciones,
        lista_precio_pedido_id, lista_limpieza_pedido_id, metodo_limpieza_pedido,
        lista_perf0_pedido_id, metodo_perf0_pedido,
        lista_perf_plus_pedido_id, metodo_perf_plus_pedido,
        vendedor_id,
        clientes (nombre_razon_social, cuit, direccion, metodo_facturacion, lista_precio_id, condicion_entrega, vendedor_id, lista_limpieza_id, lista_perf0_id, lista_perf_plus_id),
        vendedores (nombre)
      `).eq("id", id).single(),
      supabase.from("pedidos_detalle").select(`
        id, cantidad, cantidad_preparada, estado_item, precio_base, precio_final, subtotal, es_bonificado,
        articulos (id, sku, descripcion, segmento_precio, iva_ventas, categoria, rubros:rubro_id (slug), proveedores:proveedor_id (nombre))
      `).eq("pedido_id", id).order("created_at" as any),
      supabase.from("listas_precio").select("id, nombre, codigo").eq("activo", true).order("nombre"),
      supabase.from("vendedores").select("id, nombre").eq("activo", true).order("nombre"),
    ])
    const p = pedRes.data as any
    setPedido(p)
    setItems(itemsRes.data || [])
    setItemEdits({})
    setListasPrecio(listasRes.data || [])
    setVendedores(vendRes.data || [])
    if (p?.cliente_id) {
      const [{ data: bonifTodas }, { data: cmPed }, { data: cpPed }, { data: cmCli }, { data: cpCli }] = await Promise.all([
        supabase.from("bonificaciones").select("id, tipo, porcentaje, segmento").eq("cliente_id", p.cliente_id).eq("activo", true).in("tipo", ["general", "viajante", "mercaderia"]),
        supabase.from("pedido_marca_condicion").select("marca_id, lista_precio_id, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, metodo_facturacion").eq("pedido_id", id),
        supabase.from("pedido_proveedor_condicion").select("proveedor_id, lista_precio_id, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, metodo_facturacion").eq("pedido_id", id),
        supabase.from("cliente_marca_condicion").select("marca_id, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, metodo_facturacion").eq("cliente_id", p.cliente_id),
        supabase.from("cliente_proveedor_condicion").select("proveedor_id, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, metodo_facturacion").eq("cliente_id", p.cliente_id),
      ])
      const bonif = (bonifTodas || []).filter((b: any) => b.tipo === "mercaderia")
      setBonifFicha(bonifTodas || [])
      setBonifMercaderia(bonif)
      // % efectivo: override del pedido (si lo tiene) o el mayor de la ficha del cliente
      const pctFicha = bonif.reduce((m: number, b: any) => Math.max(m, b.porcentaje || 0), 0)
      setBonifPct(p.bonif_mercaderia_pct != null ? p.bonif_mercaderia_pct : pctFicha)

      // Override "solo este pedido" → form
      const ovr = normalizarBonifPedido(p.bonif_pedido)
      const form: Record<string, string> = {}
      for (const tipo of ["viajante", "mercaderia"] as const)
        for (const seg of SEGMENTOS_BONIF) {
          const v = ovr?.[tipo]?.[seg]
          form[`${tipo}.${seg}`] = typeof v === "number" ? String(v) : ""
        }
      setBonifPedidoForm(form)

      // Condiciones por marca / proveedor (pedido pisa ficha), con nombre
      const marcaIds = [...new Set([...(cmPed || []), ...(cmCli || [])].map((c: any) => c.marca_id))]
      const provIds = [...new Set([...(cpPed || []), ...(cpCli || [])].map((c: any) => c.proveedor_id))]
      const [{ data: marcas }, { data: provs }] = await Promise.all([
        marcaIds.length ? supabase.from("marcas").select("id, descripcion").in("id", marcaIds) : Promise.resolve({ data: [] as any[] }),
        provIds.length ? supabase.from("proveedores").select("id, nombre").in("id", provIds) : Promise.resolve({ data: [] as any[] }),
      ])
      const nm = new Map((marcas || []).map((m: any) => [m.id, m.descripcion]))
      const np = new Map((provs || []).map((x: any) => [x.id, x.nombre]))
      const conds: any[] = []
      const vistas = new Set<string>()
      for (const [origen, rows, ambito] of [
        ["pedido", cmPed || [], "marca"], ["pedido", cpPed || [], "proveedor"],
        ["ficha", cmCli || [], "marca"], ["ficha", cpCli || [], "proveedor"],
      ] as const) {
        for (const c of rows as any[]) {
          const refId = ambito === "marca" ? c.marca_id : c.proveedor_id
          const k = `${ambito}:${refId}`
          if (vistas.has(k)) continue
          vistas.add(k)
          conds.push({ ...c, ambito, origen, nombre: ambito === "marca" ? nm.get(refId) || "Marca" : np.get(refId) || "Proveedor" })
        }
      }
      setCondSegmento(conds)
      // Editor: solo las condiciones del PEDIDO (las de la ficha se ven, no se editan acá)
      const aRow = (c: any, refId: string, nombre: string) => ({
        ref_id: refId, nombre,
        lista_precio_id: c.lista_precio_id ?? null,
        metodo_facturacion: c.metodo_facturacion || "Factura",
        dto_general_pct: c.dto_general_pct ?? null,
        dto_viajante_pct: c.dto_viajante_pct ?? null,
        dto_mercaderia_pct: c.dto_mercaderia_pct ?? null,
      })
      setSegPedido({
        proveedor: (cpPed || []).map((c: any) => aRow(c, c.proveedor_id, String(np.get(c.proveedor_id) || "Proveedor"))),
        marca: (cmPed || []).map((c: any) => aRow(c, c.marca_id, String(nm.get(c.marca_id) || "Marca"))),
      })
    }
    if (p) {
      setHeaderForm({
        estado: p.estado || "pendiente",
        metodo_facturacion_pedido: p.metodo_facturacion_pedido || "",
        condicion_entrega: p.condicion_entrega || "",
        vendedor_id: p.vendedor_id || "",
        lista_precio_pedido_id: p.lista_precio_pedido_id || "",
        lista_limpieza_pedido_id: p.lista_limpieza_pedido_id || "",
        metodo_limpieza_pedido: p.metodo_limpieza_pedido || "",
        lista_perf0_pedido_id: p.lista_perf0_pedido_id || "",
        metodo_perf0_pedido: p.metodo_perf0_pedido || "",
        lista_perf_plus_pedido_id: p.lista_perf_plus_pedido_id || "",
        metodo_perf_plus_pedido: p.metodo_perf_plus_pedido || "",
        observaciones: p.observaciones || "",
      })
    }
    setLoading(false)
  }

  function getDisplayItem(item: any) {
    const edit = itemEdits[item.id]
    if (!edit) return item
    return { ...item, precio_final: edit.precio_final, cantidad: edit.cantidad, estado_item: edit.estado_item }
  }

  function getBaseEdit(item: any): ItemEdit {
    return itemEdits[item.id] || {
      precio_final: item.precio_final ?? 0,
      cantidad: item.cantidad ?? 0,
      estado_item: item.estado_item || "PENDIENTE",
    }
  }

  function revertItem(itemId: string) {
    setItemEdits(prev => { const n = { ...prev }; delete n[itemId]; return n })
  }

  function toggleFaltante(origItem: any, displayItem: any) {
    const isFaltante = displayItem.estado_item === "FALTANTE"
    if (isFaltante) {
      setItemEdits(prev => ({
        ...prev,
        [origItem.id]: {
          precio_final: displayItem.precio_final,
          cantidad: origItem.cantidad ?? 1,
          estado_item: origItem.estado_item === "FALTANTE" ? "PENDIENTE" : (origItem.estado_item || "PENDIENTE"),
        },
      }))
    } else {
      setItemEdits(prev => ({
        ...prev,
        [origItem.id]: { precio_final: displayItem.precio_final, cantidad: 0, estado_item: "FALTANTE" },
      }))
    }
  }

  async function savePedido() {
    setSaving(true)
    try {
      const headerUpdate: any = {
        estado: headerForm.estado,
        metodo_facturacion_pedido: headerForm.metodo_facturacion_pedido || null,
        condicion_entrega: headerForm.condicion_entrega || null,
        vendedor_id: headerForm.vendedor_id || null,
        lista_precio_pedido_id: headerForm.lista_precio_pedido_id || null,
        lista_limpieza_pedido_id: headerForm.lista_limpieza_pedido_id || null,
        metodo_limpieza_pedido: headerForm.metodo_limpieza_pedido || null,
        lista_perf0_pedido_id: headerForm.lista_perf0_pedido_id || null,
        metodo_perf0_pedido: headerForm.metodo_perf0_pedido || null,
        lista_perf_plus_pedido_id: headerForm.lista_perf_plus_pedido_id || null,
        metodo_perf_plus_pedido: headerForm.metodo_perf_plus_pedido || null,
        observaciones: headerForm.observaciones || null,
        bonif_mercaderia_pct: bonifPct || null,
        bonif_pedido: bonifPedidoDesdeForm(),
      }
      // El servidor aplica la traba por estado: si el pedido ya no es editable,
      // solo toma condicion_entrega (y el estado si es una transición válida).
      const editableAhora = esPedidoEditable(pedido?.estado)
      await actualizarEncabezadoPedido(id, headerUpdate)

      if (editableAhora) {
        // Si cambió lista/método (general o por segmento) del pedido, las líneas
        // se re-precian: el cambio tiene que llegar a la factura, no quedar en el
        // encabezado. Se hace ANTES de aplicar ediciones manuales de precio para
        // que un precio tocado a mano en esta misma pantalla no se pise.
        const CAMPOS_PRECIO = [
          "metodo_facturacion_pedido", "lista_precio_pedido_id",
          "lista_limpieza_pedido_id", "metodo_limpieza_pedido",
          "lista_perf0_pedido_id", "metodo_perf0_pedido",
          "lista_perf_plus_pedido_id", "metodo_perf_plus_pedido",
        ] as const
        const cambioBonif =
          JSON.stringify(normalizarBonifPedido(headerUpdate.bonif_pedido)) !== JSON.stringify(normalizarBonifPedido((pedido as any)?.bonif_pedido))
        const cambioPrecio = cambioBonif || CAMPOS_PRECIO.some((k) => (headerUpdate[k] || null) !== ((pedido as any)?.[k] || null))
        if (cambioPrecio && esPedidoEditable(headerForm.estado)) {
          await repreciarPedido(id)
        }

        const changes = Object.entries(itemEdits).map(([itemId, edit]) => ({ id: itemId, ...edit }))
        if (changes.length > 0) await guardarItemsPedido(id, changes)
      }

      await loadAll()
    } catch (err: any) {
      alert(err.message || "Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  // Guarda las condiciones por proveedor / marca de este pedido y re-precia las líneas.
  async function guardarCondiciones() {
    setSavingCond(true)
    try {
      await guardarCondicionesPedido(id, {
        proveedor: condRowsToProveedor(segPedido.proveedor),
        marca: condRowsToMarca(segPedido.marca),
      })
      await loadAll()
    } catch (err: any) {
      alert(err.message || "Error al guardar las condiciones")
    } finally {
      setSavingCond(false)
    }
  }

  async function buscarProductos(q: string) {
    setQuery(q)
    if (q.length < 2) { setFound([]); return }
    const { searchProductos } = await import("@/lib/actions/productos")
    setFound((await searchProductos(q)) || [])
  }

  async function agregarItem(producto: any, cantidad: number) {
    setSavingAdd(true)
    try {
      await agregarItemPedido(id, producto.id, cantidad)
      setQuery(""); setFound([]); setQty(1); setSelectedProduct(null)
      await loadAll()
    } catch (err: any) {
      alert(err.message || "Error al agregar artículo")
    } finally {
      setSavingAdd(false)
    }
  }

  async function buscarProductosBonif(q: string) {
    setQueryBonif(q)
    if (q.length < 2) { setFoundBonif([]); return }
    const { searchProductos } = await import("@/lib/actions/productos")
    setFoundBonif((await searchProductos(q)) || [])
  }

  // ── Mercadería bonificada por monto (Feature 3) ──────────────────────────
  // Monto a bonificar = Σ por segmento (neto del segmento × % mercadería del
  // segmento). El % de cada segmento sale de: override "solo este pedido"
  // (pedidos.bonif_pedido.mercaderia, app vendedor) > % general del pedido
  // (bonif_mercaderia_pct, este input) > ficha del cliente por segmento.
  // Unidades por artículo = round(monto / precio).
  // Form de descuentos por segmento → jsonb bonif_pedido (null = hereda todo de la ficha)
  function bonifPedidoDesdeForm() {
    const out: any = {}
    for (const tipo of ["viajante", "mercaderia"] as const) {
      const seg: Record<string, number> = {}
      for (const s of SEGMENTOS_BONIF) {
        const raw = (bonifPedidoForm[`${tipo}.${s}`] ?? "").trim().replace(",", ".")
        if (raw === "") continue
        const n = Number(raw)
        if (Number.isFinite(n)) seg[s] = n
      }
      if (Object.keys(seg).length) out[tipo] = seg
    }
    return normalizarBonifPedido(out)
  }
  // % de la ficha para un tipo/segmento (segmento específico > "todos")
  function pctFicha(tipo: string, seg: SegmentoBonif): number | null {
    const esp = bonifFicha.find((b: any) => b.tipo === tipo && b.segmento === seg)
    if (esp) return Number(esp.porcentaje) || 0
    const todos = bonifFicha.find((b: any) => b.tipo === tipo && !b.segmento)
    return todos ? Number(todos.porcentaje) || 0 : null
  }

  function pctMercaderiaSeg(seg: SegmentoBonif): number {
    const ovr = pedido?.bonif_pedido?.mercaderia
    if (ovr && typeof ovr[seg] === "number") return ovr[seg]
    if (pedido?.bonif_mercaderia_pct != null) return bonifPct || 0
    const ficha = bonifMercaderia.find((b: any) => b.segmento === seg) || bonifMercaderia.find((b: any) => !b.segmento)
    return ficha?.porcentaje ?? (bonifPct || 0)
  }
  const hayMercPorSegmento = () => {
    const ovr = pedido?.bonif_pedido?.mercaderia
    if (ovr && Object.keys(ovr).length) return true
    return pedido?.bonif_mercaderia_pct == null && bonifMercaderia.some((b: any) => !!b.segmento)
  }
  function calcBonifTotals() {
    const porSeg: Record<SegmentoBonif, { base: number; pct: number; monto: number }> = {
      limpieza_bazar: { base: 0, pct: pctMercaderiaSeg("limpieza_bazar"), monto: 0 },
      perf0: { base: 0, pct: pctMercaderiaSeg("perf0"), monto: 0 },
      perf_plus: { base: 0, pct: pctMercaderiaSeg("perf_plus"), monto: 0 },
    }
    let totalNoBonif = 0
    for (const i of items.filter(i => !i.es_bonificado)) {
      const d = getDisplayItem(i)
      const v = (d.precio_final || 0) * (d.cantidad || 0)
      totalNoBonif += v
      porSeg[detectarSegmentoBonif(i.articulos || {})].base += v
    }
    let monto = 0
    for (const seg of SEGMENTOS_BONIF) {
      porSeg[seg].monto = Math.round(porSeg[seg].base * porSeg[seg].pct / 100 * 100) / 100
      monto += porSeg[seg].monto
    }
    monto = Math.round(monto * 100) / 100
    const asignado = items.filter(i => i.es_bonificado).reduce((s, i) => s + ((i.precio_final || 0) * (i.cantidad || 0)), 0)
    return {
      totalNoBonif: Math.round(totalNoBonif * 100) / 100,
      monto,
      asignado: Math.round(asignado * 100) / 100,
      restante: Math.round((monto - asignado) * 100) / 100,
      porSeg,
    }
  }

  async function agregarItemBonif(producto: any) {
    if (!pedido?.cliente_id) { alert("El pedido no tiene cliente"); return }
    setSavingBonif(true)
    try {
      // Si el usuario tipeó cantidad manual (>0) se respeta; si no, se calcula por monto.
      let units = qtyBonif && qtyBonif > 0 ? qtyBonif : 0
      if (!units) {
        const { monto, asignado } = calcBonifTotals()
        const restante = Math.max(0, monto - asignado)
        const preview = await previewPrecioArticulo(pedido.cliente_id, producto.id, {})
        const precio = preview.precio || 0
        units = precio > 0 ? Math.round(restante / precio) : 0
      }
      if (units <= 0) { alert("No queda monto de bonificación para asignar. Subí el % o agregá artículos al pedido."); setSavingBonif(false); return }
      await agregarItemBonificado(id, producto.id, units)
      setQueryBonif(""); setFoundBonif([]); setQtyBonif(0)
      await loadAll()
    } catch (err: any) {
      alert(err.message || "Error al agregar artículo bonificado")
    } finally {
      setSavingBonif(false)
    }
  }

  // Recalcula cantidades de los artículos ya bonificados según el % y el total actual.
  async function recalcularBonificados() {
    setRecalcBonif(true)
    try {
      await supabase.from("pedidos").update({ bonif_mercaderia_pct: bonifPct }).eq("id", id)
      const bonif = items.filter(i => i.es_bonificado)
      if (bonif.length > 0) {
        const { monto } = calcBonifTotals()
        const share = monto / bonif.length
        for (const bi of bonif) {
          const precio = bi.precio_final || 0
          const units = precio > 0 ? Math.round(share / precio) : 0
          if (units > 0 && units !== bi.cantidad) await actualizarCantidadItem(bi.id, id, units)
        }
      }
      await loadAll()
    } catch (err: any) {
      alert(err.message || "Error al recalcular bonificación")
    } finally {
      setRecalcBonif(false)
    }
  }

  async function eliminarItem(itemId: string, descripcion: string) {
    if (!confirm(`¿Quitar "${descripcion}" del pedido?`)) return
    try {
      await eliminarItemPedido(itemId, id)
      setItems(prev => prev.filter(i => i.id !== itemId))
      revertItem(itemId)
    } catch (err: any) {
      alert(err.message || "Error al eliminar")
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const estadoColor = ESTADO_COLORS[pedido?.estado] || "bg-slate-100 text-slate-700 border-slate-300"
  // Trabas por estado (lib/pedidos/estados.ts): editable = todo; si no, solo forma de entrega.
  const editable = esPedidoEditable(pedido?.estado)
  const entregaEditable = puedeEditarEntrega(pedido?.estado)
  const bloqueo = motivoBloqueo(pedido?.estado)
  const opcionesEstado = [pedido?.estado, ...transicionesManuales(pedido?.estado)].filter(Boolean) as string[]
  const puedeGuardar = editable || entregaEditable || opcionesEstado.length > 1
  const liveTotal = items.map(i => getDisplayItem(i)).reduce((sum, i) => sum + (i.precio_final ?? 0) * (i.cantidad ?? 0), 0)
  const hasUnsaved = Object.keys(itemEdits).length > 0

  const c = pedido?.clientes as any
  const listaName = (listId: string | null | undefined) => listasPrecio.find(lp => lp.id === listId)?.nombre || null
  const entregaLabel = (v: string | null | undefined) =>
    v === "retira_mostrador" ? "Retira en Mostrador" :
    v === "transporte" ? "Transporte" :
    v === "entregamos_nosotros" ? "Entregamos Nosotros" : null

  const defaultMetodo   = c?.metodo_facturacion || "—"
  const defaultLista    = listaName(c?.lista_precio_id) || "Sin lista"
  const defaultEntrega  = entregaLabel(c?.condicion_entrega) || "—"
  const defaultVendedor = vendedores.find(v => v.id === c?.vendedor_id)?.nombre || "Sin vendedor"
  const defaultLimpiezaLista = listaName(c?.lista_limpieza_id) || defaultLista
  const defaultPerf0Lista    = listaName(c?.lista_perf0_id)    || defaultLista
  const defaultPerfPlusLista = listaName(c?.lista_perf_plus_id) || defaultLista

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 border-b bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Pedido #{pedido?.numero_pedido}</h1>
              <p className="text-sm text-slate-500">
                {pedido?.clientes?.nombre_razon_social}
                {pedido?.vendedores?.nombre ? ` · ${pedido.vendedores.nombre}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${estadoColor}`}>
              {ESTADO_LABEL[pedido?.estado] || pedido?.estado}
            </span>
            <span className="text-xl font-bold text-slate-800">
              ${liveTotal.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <Button onClick={savePedido} disabled={saving || !puedeGuardar} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar pedido
              {hasUnsaved && <span className="ml-1 h-2 w-2 rounded-full bg-amber-400 inline-block" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {bloqueo && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 font-medium">
            🔒 {bloqueo}
          </div>
        )}

        {/* Encabezado del pedido */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            type="button"
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50/60 transition-colors"
            onClick={() => setHeaderOpen(o => !o)}
          >
            <h2 className="font-semibold text-slate-800 text-sm uppercase tracking-wide">Encabezado del pedido</h2>
            {headerOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
          </button>

          {headerOpen && (
            <div className="border-t border-slate-100 px-5 py-5 space-y-5">

              {/* Row 1 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Estado</Label>
                  {/* Solo transiciones del flujo; sin opciones = estado final o lo mueve otro proceso */}
                  <Select value={headerForm.estado} onValueChange={(v) => setHeaderForm({ ...headerForm, estado: v })} disabled={opcionesEstado.length <= 1}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {opcionesEstado.map(e => <SelectItem key={e} value={e}>{ESTADO_LABEL[e] || e}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Facturación</Label>
                  <Select
                    value={headerForm.metodo_facturacion_pedido || "__heredar__"}
                    onValueChange={(v) => setHeaderForm({ ...headerForm, metodo_facturacion_pedido: v === "__heredar__" ? "" : v })}
                    disabled={!editable}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__heredar__">{defaultMetodo} (del cliente)</SelectItem>
                      <SelectItem value="Factura">Factura (21% IVA)</SelectItem>
                      <SelectItem value="Final">Final (Mixto)</SelectItem>
                      <SelectItem value="Presupuesto">Presupuesto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Condición de Entrega</Label>
                  <Select value={headerForm.condicion_entrega || "__heredar__"} onValueChange={(v) => setHeaderForm({ ...headerForm, condicion_entrega: v === "__heredar__" ? "" : v })} disabled={!entregaEditable}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__heredar__">{defaultEntrega} (del cliente)</SelectItem>
                      <SelectItem value="retira_mostrador">Retira en Mostrador</SelectItem>
                      <SelectItem value="transporte">Envío por Transporte</SelectItem>
                      <SelectItem value="entregamos_nosotros">Entregamos Nosotros</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1 block">Vendedor</Label>
                  <Select value={headerForm.vendedor_id || "__none__"} onValueChange={(v) => setHeaderForm({ ...headerForm, vendedor_id: v === "__none__" ? "" : v })} disabled={!editable}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{defaultVendedor} (del cliente)</SelectItem>
                      {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Row 2 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <Label className="text-xs text-slate-500 mb-1 block">Lista de Precio General</Label>
                  <Select
                    value={headerForm.lista_precio_pedido_id || "__heredar__"}
                    onValueChange={(v) => setHeaderForm({ ...headerForm, lista_precio_pedido_id: v === "__heredar__" ? "" : v })}
                    disabled={!editable}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__heredar__">{defaultLista} (del cliente)</SelectItem>
                      {listasPrecio.filter((lp: any) => lp.codigo !== "especial").map(lp => <SelectItem key={lp.id} value={lp.id}>{lp.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs text-slate-500 mb-1 block">Observaciones</Label>
                  <Input
                    className="h-9"
                    value={headerForm.observaciones}
                    onChange={(e) => setHeaderForm({ ...headerForm, observaciones: e.target.value })}
                    placeholder="Notas internas del pedido..."
                    disabled={!editable}
                  />
                </div>
              </div>

              {/* Row 3: Segmentos */}
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Condiciones por Segmento</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { label: "Limpieza / Bazar", listaKey: "lista_limpieza_pedido_id", metodoKey: "metodo_limpieza_pedido",  defLista: defaultLimpiezaLista },
                    { label: "Perfumería Perf0", listaKey: "lista_perf0_pedido_id",    metodoKey: "metodo_perf0_pedido",     defLista: defaultPerf0Lista    },
                    { label: "Perfumería Plus",  listaKey: "lista_perf_plus_pedido_id", metodoKey: "metodo_perf_plus_pedido", defLista: defaultPerfPlusLista },
                  ].map(({ label, listaKey, metodoKey, defLista }) => (
                    <div key={listaKey} className="border rounded-lg p-3 bg-slate-50 space-y-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{label}</p>
                      <Select
                        value={(headerForm as any)[metodoKey] || "__heredar__"}
                        onValueChange={(v) => setHeaderForm({ ...headerForm, [metodoKey]: v === "__heredar__" ? "" : v })}
                        disabled={!editable}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__heredar__">{defaultMetodo} (general)</SelectItem>
                          <SelectItem value="Factura">Factura</SelectItem>
                          <SelectItem value="Final">Final</SelectItem>
                          <SelectItem value="Presupuesto">Presupuesto</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={(headerForm as any)[listaKey] || "__heredar__"}
                        onValueChange={(v) => setHeaderForm({ ...headerForm, [listaKey]: v === "__heredar__" ? "" : v })}
                        disabled={!editable}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__heredar__">{defLista} (general)</SelectItem>
                          {listasPrecio.filter((lp: any) => lp.codigo !== "especial").map(lp => <SelectItem key={lp.id} value={lp.id}>{lp.nombre}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Row 4: Descuentos por segmento (misma columna bonif_pedido que la app del vendedor) */}
              <div>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Descuentos por segmento</p>
                  <p className="text-[11px] text-slate-400">
                    Vacío = hereda de la ficha del cliente. Al guardar se re-precian los renglones y se actualiza el kardex.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                        <th className="text-left font-bold pb-2">Segmento</th>
                        <th className="text-center font-bold pb-2 w-32">General <span className="font-normal normal-case">(ficha)</span></th>
                        <th className="text-center font-bold pb-2 w-36 text-orange-700">Viajante</th>
                        <th className="text-center font-bold pb-2 w-36 text-green-700">Mercadería</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SEGMENTOS_BONIF.map((seg) => (
                        <tr key={seg} className="border-t border-slate-100">
                          <td className="py-1.5 text-slate-700">{SEGMENTO_LABEL[seg]}</td>
                          <td className="py-1.5 text-center tabular-nums text-slate-600">{pctFicha("general", seg) ?? 0}%</td>
                          {(["viajante", "mercaderia"] as const).map((tipo) => {
                            const ficha = pctFicha(tipo, seg)
                            const val = bonifPedidoForm[`${tipo}.${seg}`] ?? ""
                            return (
                              <td key={tipo} className="py-1.5 px-2">
                                <div className="relative">
                                  <Input
                                    className={`h-8 text-right pr-6 tabular-nums ${val !== "" ? "border-amber-400 bg-amber-50" : ""}`}
                                    value={val}
                                    placeholder={ficha != null ? `${ficha}` : "0"}
                                    disabled={!editable}
                                    inputMode="decimal"
                                    onChange={(e) => setBonifPedidoForm((prev) => ({ ...prev, [`${tipo}.${seg}`]: e.target.value.replace(/[^\d.,]/g, "") }))}
                                  />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">%</span>
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Condiciones por marca / proveedor: las de la FICHA se ven; las del PEDIDO se editan
                    (solo este pedido, pisan a la ficha para esa mercadería y se facturan aparte). */}
                {(condSegmento.some((c: any) => c.origen === "ficha") || editable) && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 space-y-2">
                    <p className="font-bold text-slate-500 uppercase tracking-wide text-[10px]">Condiciones por marca / proveedor (van en comprobante aparte)</p>
                    {condSegmento.filter((c: any) => c.origen === "ficha").map((c: any) => (
                      <p key={`${c.ambito}:${c.marca_id || c.proveedor_id}`}>
                        <span className="font-semibold">{c.nombre}</span>
                        <span className="text-slate-400"> · {c.ambito} · ficha del cliente</span>
                        {" — "}general {Number(c.dto_general_pct || 0)}% · viajante {Number(c.dto_viajante_pct || 0)}% · mercadería {Number(c.dto_mercaderia_pct || 0)}%
                        {c.metodo_facturacion ? ` · ${c.metodo_facturacion}` : ""}
                        {segPedido.marca.some(r => r.ref_id === c.marca_id) || segPedido.proveedor.some(r => r.ref_id === c.proveedor_id)
                          ? <span className="text-teal-700 font-semibold"> · pisada por este pedido</span> : null}
                      </p>
                    ))}
                    {editable && (
                      <div className="pt-1 space-y-2">
                        <p className="text-[10px] font-semibold text-teal-700 uppercase tracking-wide">Solo este pedido</p>
                        <SegmentacionCondiciones listas={listasPrecio} value={segPedido} onChange={setSegPedido} />
                        <div className="flex justify-end">
                          <Button type="button" size="sm" className="h-8 bg-teal-600 hover:bg-teal-700" onClick={guardarCondiciones} disabled={savingCond}>
                            {savingCond ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                            Guardar condiciones y re-preciar
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Mercadería bonificada — el panel SOLO aparece si el pedido lleva
            bonificados, o si se abre manualmente para agregar (no confunde en
            pedidos sin mercadería bonificada). */}
        {(() => {
          const hasBonif = items.some(i => i.es_bonificado)
          if (!hasBonif && !editable) return null
          if (!hasBonif && !showBonifPanel) {
            return (
              <button
                type="button"
                onClick={() => setShowBonifPanel(true)}
                className="text-xs font-medium text-amber-700 hover:text-amber-800 hover:underline self-start flex items-center gap-1"
              >
                <Package className="h-3.5 w-3.5" /> Agregar mercadería bonificada
              </button>
            )
          }
          const bt = calcBonifTotals()
          return (
          <>
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
              <Package className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-800">Mercadería bonificada</p>
                <p className="text-xs text-amber-600 mt-0.5">
                  El monto a bonificar = neto de cada segmento × % mercadería del segmento. Las unidades de cada artículo se calculan
                  para acercarse a ese monto (precio de lista, 100% bonificado).
                  {hayMercPorSegmento() ? (
                    <>
                      {" "}% por segmento {pedido?.bonif_pedido?.mercaderia ? "(solo este pedido, app vendedor)" : "(ficha del cliente)"}:{" "}
                      {SEGMENTOS_BONIF.map((s, i) => (
                        <span key={s}>{i > 0 ? " · " : ""}{SEGMENTO_LABEL[s]} <b>{bt.porSeg[s].pct}%</b></span>
                      ))}
                      . Un % general cargado acá vale para los segmentos sin % propio de este pedido (y pisa la ficha).
                    </>
                  ) : (
                    bonifMercaderia.length > 0 && <> El cliente tiene <b>{bonifPct}%</b> preasignado.</>
                  )}
                </p>
              </div>
            </div>

            {editable && (
            <div className="bg-white rounded-2xl border border-amber-200 p-5 shadow-sm space-y-4">
              <div className="flex items-end gap-4 flex-wrap">
                <div>
                  <Label className="text-xs text-amber-700">% Mercadería bonificada</Label>
                  <Input type="number" step="0.01" min={0} max={100} className="h-9 w-28 text-center font-semibold"
                    value={bonifPct || ""} onChange={(e) => setBonifPct(parseFloat(e.target.value) || 0)} />
                </div>
                <div className="text-xs text-slate-600 space-y-0.5">
                  <p>Base (sin bonificados): <b>${bt.totalNoBonif.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</b></p>
                  <p>Monto a bonificar: <b className="text-amber-700">${bt.monto.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</b></p>
                  <p>Asignado: ${bt.asignado.toLocaleString("es-AR", { minimumFractionDigits: 2 })} · Saldo sin usar: <b className={bt.restante > 0.01 ? "text-orange-600" : "text-green-600"}>${bt.restante.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</b></p>
                </div>
                <Button type="button" size="sm" variant="outline" className="h-9 border-amber-300 text-amber-700 hover:bg-amber-50 ml-auto" onClick={recalcularBonificados} disabled={recalcBonif}>
                  {recalcBonif ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                  Recalcular cantidades
                </Button>
              </div>

              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Buscar artículo a bonificar..."
                    className="pl-9 h-10"
                    value={queryBonif}
                    onChange={(e) => buscarProductosBonif(e.target.value)}
                  />
                  {foundBonif.length > 0 && (
                    <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 z-50 max-h-[260px] overflow-auto">
                      {foundBonif.map((p: any) => (
                        <div key={p.id}
                          className="px-4 py-3 hover:bg-amber-50 cursor-pointer border-b border-slate-100 last:border-0 transition-colors"
                          onClick={() => agregarItemBonif(p)}>
                          <ArticuloResultRow articulo={p} size="sm" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min={0} className="h-10 w-24 text-center font-semibold" placeholder="auto"
                    value={qtyBonif || ""} onChange={(e) => setQtyBonif(parseInt(e.target.value) || 0)}
                  />
                  <span className="text-sm text-slate-400">uds.</span>
                </div>
                {savingBonif && <Loader2 className="h-5 w-5 animate-spin text-amber-600 self-center" />}
              </div>
              <p className="text-[11px] text-slate-400">Dejá las unidades en "auto" para que se calculen por monto, o tipeá una cantidad fija.</p>
            </div>
            )}
          </>
          )
        })()}

        {/* Lista de artículos */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Toolbar: búsqueda dentro del pedido + botón agregar */}
          <div className="px-5 py-3 border-b border-slate-100 bg-white flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Buscar artículo en el pedido..."
                className="pl-9 h-9 text-sm"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
              />
            </div>
            {editable && (
              <Button
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={() => { setShowAddPanel(o => !o); setQuery(""); setFound([]); setSelectedProduct(null); setQty(1) }}
              >
                <Plus className="h-4 w-4" />
                Agregar artículo
              </Button>
            )}
          </div>

          {/* Panel agregar artículo (colapsable) */}
          {showAddPanel && (
            <div className="border-b border-indigo-100 bg-indigo-50/40 px-5 py-4 space-y-3">
              {/* Paso 1: buscar artículo */}
              {!selectedProduct ? (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Buscar artículo por SKU o descripción..."
                    className="pl-9 h-10 bg-white"
                    value={query}
                    onChange={(e) => buscarProductos(e.target.value)}
                    autoFocus
                  />
                  {found.length > 0 && (
                    <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 z-50 max-h-[260px] overflow-auto">
                      {found.map((p: any) => (
                        <div key={p.id}
                          className="px-4 py-3 hover:bg-indigo-50 cursor-pointer border-b border-slate-100 last:border-0 transition-colors"
                          onClick={() => { setSelectedProduct(p); setFound([]); setQuery(""); setQty(1) }}>
                          <ArticuloResultRow articulo={p} size="sm" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Paso 2: confirmar cantidad */
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0 bg-white border border-indigo-200 rounded-lg px-3 py-2">
                    <ArticuloResultRow articulo={selectedProduct} size="sm" />
                  </div>
                  <button
                    className="text-xs text-slate-400 hover:text-slate-600 shrink-0 underline"
                    onClick={() => { setSelectedProduct(null); setQty(1) }}
                  >
                    Cambiar
                  </button>
                  <Input
                    type="number" min={1}
                    className="h-10 w-24 text-center font-bold text-lg bg-white shrink-0"
                    value={qty}
                    onChange={(e) => setQty(parseInt(e.target.value) || 1)}
                    onKeyDown={(e) => { if (e.key === "Enter") agregarItem(selectedProduct, qty) }}
                    autoFocus
                  />
                  <span className="text-sm text-slate-500 shrink-0">uds.</span>
                  <Button
                    size="sm" className="shrink-0 gap-1.5"
                    disabled={savingAdd}
                    onClick={() => agregarItem(selectedProduct, qty)}
                  >
                    {savingAdd ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Agregar
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Table header */}
          <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 grid grid-cols-12 gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide">
            <div className="col-span-3">Artículo</div>
            <div className="col-span-2 text-right">Precio Unit.</div>
            <div className="col-span-2 text-center">Cantidad</div>
            <div className="col-span-2 text-right">Subtotal</div>
            <div className="col-span-3"></div>
          </div>

          {(() => {
            const filteredItems = filterQuery.trim()
              ? items.filter(i => localMatch(filterQuery, i.articulos?.descripcion, i.articulos?.sku))
              : items
            return filteredItems.length === 0 ? (
            <div className="py-16 text-center">
              <Package className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-medium">{filterQuery.trim() ? "Sin resultados" : "Sin artículos"}</p>
              <p className="text-slate-400 text-sm mt-1">{filterQuery.trim() ? "Probá con otro término" : "Usá el botón Agregar para sumar artículos al pedido"}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredItems.map((item) => {
                const displayItem = getDisplayItem(item)
                const hasEdit = !!itemEdits[item.id]
                const isFaltante = displayItem.estado_item === "FALTANTE"
                const barColor = displayItem.estado_item === "COMPLETO" ? "bg-green-500" :
                  isFaltante ? "bg-red-500" :
                  displayItem.estado_item === "PARCIAL" ? "bg-orange-500" : "bg-yellow-400"
                const subtotalDisplay = (displayItem.precio_final ?? 0) * (displayItem.cantidad ?? 0)

                return (
                  <div key={item.id} className={`grid grid-cols-12 gap-2 items-center px-5 py-3 transition-colors ${isFaltante ? "bg-red-50/40" : "hover:bg-slate-50/50"}`}>
                    {/* Artículo */}
                    <div className="col-span-3 flex items-center gap-2 min-w-0">
                      <div className={`w-1 h-9 rounded-full shrink-0 ${barColor}`} />
                      <div className="min-w-0">
                        <p className={`font-medium text-sm leading-tight truncate ${isFaltante ? "text-slate-400 line-through" : "text-slate-800"}`}>
                          {item.articulos?.descripcion}
                        </p>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">
                          {item.articulos?.sku}
                          {item.articulos?.proveedores?.nombre ? ` · ${item.articulos.proveedores.nombre}` : ""}
                        </p>
                      </div>
                    </div>

                    {/* Precio editable */}
                    <div className="col-span-2">
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                        <Input
                          key={`p-${item.id}-${displayItem.precio_final ?? 0}`}
                          type="number" step="0.01" min={0}
                          className="h-8 pl-5 text-right text-sm font-semibold"
                          disabled={!editable}
                          defaultValue={displayItem.precio_final ?? 0}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }}
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value)
                            if (!isNaN(val)) {
                              const base = getBaseEdit(item)
                              setItemEdits(prev => ({ ...prev, [item.id]: { ...base, precio_final: val } }))
                            }
                          }}
                        />
                      </div>
                      {item.es_bonificado && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300">BONIF</span>
                      )}
                    </div>

                    {/* Cantidad */}
                    <div className="col-span-2 flex items-center justify-center gap-1">
                      <Input
                        key={`q-${item.id}-${displayItem.cantidad ?? 0}`}
                        type="number" min={0}
                        className="h-8 w-20 text-center font-semibold text-sm"
                        disabled={!editable}
                        defaultValue={displayItem.cantidad ?? 0}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }}
                        onBlur={(e) => {
                          const val = parseInt(e.target.value)
                          if (!isNaN(val) && val >= 0) {
                            const base = getBaseEdit(item)
                            setItemEdits(prev => ({ ...prev, [item.id]: { ...base, cantidad: val } }))
                          }
                        }}
                      />
                      <span className="text-xs text-slate-400">u.</span>
                    </div>

                    {/* Subtotal */}
                    <div className="col-span-2 text-right">
                      <p className={`text-sm font-bold ${isFaltante ? "text-slate-400 line-through" : "text-slate-800"}`}>
                        ${subtotalDisplay.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      {displayItem.cantidad_preparada != null && displayItem.cantidad_preparada > 0 && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                          displayItem.cantidad_preparada >= displayItem.cantidad ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                        }`}>
                          {displayItem.cantidad_preparada} prep.
                        </span>
                      )}
                    </div>

                    {/* Acciones */}
                    <div className="col-span-3 flex items-center justify-end gap-1">
                      {editable && (
                        <Button
                          variant={isFaltante ? "destructive" : "outline"}
                          size="sm"
                          className="h-7 px-2 text-[11px] font-bold"
                          onClick={() => toggleFaltante(item, displayItem)}
                        >
                          {isFaltante ? "✓ Faltante" : "Faltante"}
                        </Button>
                      )}
                      {hasEdit && (
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                          title="Revertir cambios"
                          onClick={() => revertItem(item.id)}
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {editable && (
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-slate-300 hover:text-red-500 hover:bg-red-50"
                          onClick={() => eliminarItem(item.id, item.articulos?.descripcion || "artículo")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
          })()}

          {/* Totales */}
          {items.length > 0 && (
            <div className="border-t border-slate-200 bg-slate-800 text-white px-5 py-4">
              <div className="flex justify-between items-center">
                <div className="text-white/60 text-sm">
                  {items.length} artículo{items.length !== 1 ? "s" : ""}
                  {hasUnsaved && <span className="ml-2 text-amber-400 text-xs font-semibold">· cambios sin guardar</span>}
                </div>
                <div className="text-right">
                  <p className="text-white/50 text-xs">Total del pedido</p>
                  <p className="text-2xl font-bold">
                    ${liveTotal.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

      </main>
    </div>
  )
}
