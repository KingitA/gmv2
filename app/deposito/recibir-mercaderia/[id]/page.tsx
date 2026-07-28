"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useBarcodeScanner } from "@/lib/hooks/useBarcodeScanner"
import { scanOk, scanError } from "@/lib/utils/scan-feedback"
import { useParams, useRouter } from "next/navigation"
import { articuloMarcaSuffix, articuloInfoLine } from "@/components/search/ArticuloResultRow"

interface RecepcionItem {
  id: string; articulo_id: string; cantidad_oc: number; cantidad_fisica: number
  estado_linea: "pendiente"|"ok"|"faltante"
  articulos?: { sku: string; descripcion: string; ean13?: string; unidades_por_bulto?: number }
}
interface ArticuloFound { id: string; sku: string; descripcion: string; ean13?: string; stock_actual: number }

const C = {
  bg:"#f4f6f9", white:"#ffffff", border:"#e5e7eb",
  text:"#111827", sub:"#6b7280", light:"#9ca3af",
  green:"#16a34a", greenL:"#f0fdf4", greenB:"#bbf7d0",
  orange:"#ea580c", orangeL:"#fff7ed", orangeB:"#fed7aa",
  red:"#dc2626", redL:"#fef2f2", redB:"#fecaca",
  yellow:"#d97706",
}

function SwipeItemOC({ item, onConfirm, saving, bgReveal, colorReveal, labelReveal, iconReveal }:
  { item: RecepcionItem; onConfirm:(item:RecepcionItem)=>void; saving:boolean
    bgReveal:string; colorReveal:string; labelReveal:string; iconReveal:string }) {
  const [dx, setDx] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const startX = useRef(0)
  const THRESHOLD = 72

  const ok = item.estado_linea === "ok"
  const faltante = item.estado_linea === "faltante"
  const bg = ok ? C.greenL : faltante ? C.redL : C.white
  const border = ok ? C.greenB : faltante ? C.redB : C.border
  const dot = ok ? C.green : faltante ? C.red : "#fbbf24"

  const onTouchStart = (e: React.TouchEvent) => { if (revealed) return; startX.current = e.touches[0].clientX }
  const onTouchMove = (e: React.TouchEvent) => {
    if (revealed) return
    const diff = startX.current - e.touches[0].clientX
    setDx(diff > 0 ? Math.min(diff, THRESHOLD + 10) : 0)
  }
  const onTouchEnd = () => {
    if (dx >= THRESHOLD) { setRevealed(true); setDx(THRESHOLD) }
    else { setDx(0); setRevealed(false) }
  }
  const handleRevealClick = () => { onConfirm(item); setRevealed(false); setDx(0) }
  const handleCardClick = () => { if (revealed) { setRevealed(false); setDx(0) } }
  const translateX = revealed ? THRESHOLD : dx

  return (
    <div style={{ position:"relative", overflow:"hidden", borderRadius:16, marginBottom:8 }}>
      <button onClick={handleRevealClick} disabled={saving}
        style={{ position:"absolute", right:0, top:0, bottom:0, width:THRESHOLD, background:bgReveal, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", border:"none", cursor:"pointer", borderRadius:"0 16px 16px 0", gap:2 }}>
        <span style={{ color:colorReveal, fontSize:22, fontWeight:700 }}>{iconReveal}</span>
        <span style={{ color:colorReveal, fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:"0.05em" }}>{labelReveal}</span>
      </button>
      <div onClick={handleCardClick} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{ position:"relative", background:bg, border:`1.5px solid ${border}`, borderRadius:16, padding:"20px 16px", display:"flex", alignItems:"center", gap:14, transform:`translateX(-${translateX}px)`, transition:dx===0?"transform 0.25s cubic-bezier(.25,.46,.45,.94)":"none", userSelect:"none" }}>
        <div style={{ width:13, height:13, borderRadius:"50%", background:dot, flexShrink:0 }} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:C.text, fontWeight:700, fontSize:22, lineHeight:1.25, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.articulos?.descripcion || item.articulo_id}</div>
          <div style={{ color:C.light, fontSize:15, fontFamily:"monospace", marginTop:4 }}>{item.articulos?.sku}</div>
        </div>
        <div style={{ textAlign:"right", flexShrink:0 }}>
          {ok ? <>
            <div style={{ color:C.green, fontWeight:800, fontSize:27 }}>{item.cantidad_fisica}</div>
            <div style={{ color:C.light, fontSize:15 }}>de {item.cantidad_oc}</div>
          </> : faltante ? (
            <div style={{ color:C.red, fontWeight:700, fontSize:16 }}>FALTANTE</div>
          ) : <>
            <div style={{ color:C.text, fontWeight:800, fontSize:27 }}>{item.cantidad_oc}</div>
            <div style={{ color:C.light, fontSize:15 }}>esperadas</div>
          </>}
        </div>
      </div>
    </div>
  )
}

export default function RecibirMercaderiaDetallePage() {
  const { id: ordenId } = useParams<{ id: string }>()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [orden, setOrden] = useState<any>(null)
  const [recepcion, setRecepcion] = useState<any>(null)
  const [items, setItems] = useState<RecepcionItem[]>([])
  const [documentos, setDocumentos] = useState<any[]>([])
  const [scannerOpen, setScannerOpen] = useState(false)
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<ArticuloFound[]>([])
  const [buscando, setBuscando] = useState(false)
  const [articuloSel, setArticuloSel] = useState<ArticuloFound|null>(null)
  const [itemActivo, setItemActivo] = useState<RecepcionItem|null>(null)
  const [cantidadInput, setCantidadInput] = useState("")
  const [finalizando, setFinalizando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [vistaFaltantes, setVistaFaltantes] = useState(false)
  const [toast, setToast] = useState<{msg:string;tipo:"ok"|"err"}|null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<NodeJS.Timeout>()

  useEffect(() => {
    fetch("/api/deposito/recepciones", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ orden_compra_id: ordenId }) })
      .then(r=>r.json()).then(async recData => {
        if (recData.error) { showToast(recData.error,"err"); return }
        setRecepcion(recData); setDocumentos(recData.recepciones_documentos||[])
        const ordenes = await (await fetch("/api/deposito/recepciones")).json()
        const ord = Array.isArray(ordenes) ? ordenes.find((o:any)=>o.id===ordenId) : null
        setOrden(ord)
        setItems((recData.recepciones_items||[]).map((ri:any) => {
          const det = ord?.ordenes_compra_detalle?.find((d:any)=>d.articulo_id===ri.articulo_id)
          return { ...ri, estado_linea: ri.estado_linea||"pendiente", articulos: det?.articulos }
        }))
      }).catch(()=>showToast("Error de conexión","err")).finally(()=>setLoading(false))
  }, [ordenId])

  useEffect(() => { if (scannerOpen) setTimeout(()=>inputRef.current?.focus(),100) }, [scannerOpen])

  const showToast = (msg:string, tipo:"ok"|"err") => { setToast({msg,tipo}); setTimeout(()=>setToast(null),3000) }

  const buscarArticulo = useCallback((q:string) => {
    if (!q||q.length<2) { setResultados([]); return }
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async()=>{
      setBuscando(true)
      try { setResultados(await (await fetch(`/api/deposito/picking?q=${encodeURIComponent(q)}`)).json()) }
      finally { setBuscando(false) }
    }, 300)
  }, [])

  const patchItem = async (articulo_id:string, cantidad_fisica:number) => {
    if (!recepcion) return
    await fetch("/api/deposito/recepciones", {
      method:"PATCH", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ recepcion_id: recepcion.id, articulo_id, cantidad_fisica }),
    })
  }

  const seleccionarDeBusqueda = (art:ArticuloFound) => {
    const item = items.find(i=>i.articulo_id===art.id)
    setArticuloSel(art); setItemActivo(item||null)
    setCantidadInput(item?String(item.cantidad_oc):"")
    setBusqueda(""); setResultados([]); setScannerOpen(false)
  }

  // Escaneo con el botón físico de la colectora (keyboard-wedge).
  const onScanCodigo = useCallback(async (code:string) => {
    try {
      const arr = await (await fetch(`/api/deposito/picking?q=${encodeURIComponent(code)}`)).json()
      const art: ArticuloFound | null = Array.isArray(arr) && arr.length > 0 ? arr[0] : null
      if (!art) { scanError(); showToast(`No se encontró el código ${code}`, "err"); return }
      const item = items.find(i=>i.articulo_id===art.id)
      scanOk()
      setArticuloSel(art); setItemActivo(item||null)
      setCantidadInput(item?String(item.cantidad_oc):"")
      setBusqueda(""); setResultados([]); setScannerOpen(false)
    } catch { scanError(); showToast("Error de conexión", "err") }
  }, [items])

  useBarcodeScanner({ onScan: onScanCodigo, enabled: !articuloSel && !finalizando })

  const guardarCantidad = async (esFaltante=false) => {
    if (!articuloSel||!recepcion) return
    setSaving(true)
    try {
      const cantidad = esFaltante ? 0 : parseFloat(cantidadInput)||0
      await patchItem(articuloSel.id, esFaltante ? 0 : cantidad)
      setItems(prev=>prev.map(i=>i.articulo_id===articuloSel.id
        ? {...i, cantidad_fisica: esFaltante?0:cantidad, estado_linea: esFaltante?"faltante":cantidad>0?"ok":"pendiente"} : i))
      showToast(esFaltante?"Marcado como faltante":"✓ Guardado","ok")
      setArticuloSel(null); setItemActivo(null); setCantidadInput("")
    } catch { showToast("Error al guardar","err") }
    finally { setSaving(false) }
  }

  const marcarFaltante = async (item:RecepcionItem) => {
    setSaving(true)
    try {
      await patchItem(item.articulo_id, 0)
      setItems(prev=>prev.map(i=>i.articulo_id===item.articulo_id?{...i, cantidad_fisica:0, estado_linea:"faltante"}:i))
      showToast("Marcado como faltante","ok")
    } finally { setSaving(false) }
  }

  const devolverAPendiente = async (item:RecepcionItem) => {
    setSaving(true)
    try {
      await patchItem(item.articulo_id, -1)
      setItems(prev=>prev.map(i=>i.articulo_id===item.articulo_id?{...i, cantidad_fisica:0, estado_linea:"pendiente"}:i))
      showToast("Devuelto a pendientes","ok")
    } finally { setSaving(false) }
  }

  const [verDocumentos, setVerDocumentos] = useState(false)
  const [tipoDocDeposito, setTipoDocDeposito] = useState<"remito"|"factura"|"foto">("remito")

  // ── Control de bultos / conformidad transporte ──
  const [transportes, setTransportes] = useState<any[]>([])
  const [transporteSel, setTransporteSel] = useState("")
  const [bultosDeclarados, setBultosDeclarados] = useState("")
  const [bultosRecibidos, setBultosRecibidos] = useState("")
  const [bultosObs, setBultosObs] = useState("")
  const [guardandoBultos, setGuardandoBultos] = useState(false)
  const necesitaControlBultos = recepcion && !recepcion.conformidad_transporte

  useEffect(() => {
    if (!necesitaControlBultos) return
    fetch("/api/transportes").then(r=>r.json()).then(d=>{ if (Array.isArray(d)) setTransportes(d.filter((t:any)=>t.activo!==false)) }).catch(()=>{})
  }, [necesitaControlBultos])

  const guardarConformidad = async (estado: "conforme"|"no_conforme"|"omitida") => {
    if (!recepcion) return
    const decl = parseInt(bultosDeclarados)||0
    const recib = parseInt(bultosRecibidos)||0
    if (estado !== "omitida") {
      if (decl <= 0 || recib < 0) { showToast("Cargá los bultos del remito y los contados","err"); return }
      if (estado === "no_conforme" && !bultosObs.trim()) { showToast("Si faltan bultos, la observación es obligatoria","err"); return }
    }
    setGuardandoBultos(true)
    try {
      const r = await fetch("/api/deposito/recepciones", {
        method: "PATCH", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ recepcion_id: recepcion.id, conformidad: {
          transporte_id: transporteSel || null,
          bultos_declarados: estado === "omitida" ? null : decl,
          bultos_recibidos: estado === "omitida" ? null : recib,
          estado, observaciones: bultosObs || null,
        }}),
      })
      const data = await r.json()
      if (!r.ok) { showToast(data.error||"Error al guardar","err"); return }
      setRecepcion((prev:any)=>({ ...prev, ...data }))
      showToast(estado === "omitida" ? "Control salteado (quedó registrado)" : "✓ Control de bultos registrado","ok")
    } catch { showToast("Error de conexión","err") }
    finally { setGuardandoBultos(false) }
  }

  const subirFoto = async (file:File) => {
    if (!recepcion) return; setSubiendo(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("tipo_documento", tipoDocDeposito)
      const r = await fetch(`/api/recepciones/${recepcion.id}/ocr`, {method:"POST", body:fd})
      const data = await r.json()
      if (r.ok) {
        setDocumentos(prev=>[...prev, data.document])
        const cnt = data.ocr_processing_results?.length || 0
        showToast(cnt > 0 ? `📷 OCR: ${cnt} artículo${cnt>1?"s":""} detectados` : "📷 Foto adjuntada","ok")
      } else {
        showToast(data.error || "Error al procesar","err")
      }
    } finally { setSubiendo(false) }
  }

  const eliminarDocumentoDeposito = async (docId:string) => {
    if (!recepcion) return
    const r = await fetch(`/api/recepciones/${recepcion.id}/ocr`, {
      method:"DELETE",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({document_id: docId})
    })
    if (r.ok) {
      setDocumentos(prev=>prev.filter(d=>d.id!==docId))
      showToast("Documento eliminado","ok")
    } else {
      showToast("Error al eliminar","err")
    }
  }

  const finalizarRecepcion = async () => {
    const pend = items.filter(i=>i.estado_linea==="pendiente").length
    if (pend>0) { showToast(`Faltan ${pend} artículos por escanear o marcar`,"err"); return }
    setFinalizando(true)
    try {
      const r = await fetch("/api/deposito/recepciones",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({recepcion_id:recepcion.id,finalizar:true})})
      const data = await r.json()
      if (data.ok) router.push("/deposito/recibir-mercaderia")
      else showToast(data.error||"Error al finalizar","err")
    } catch { showToast("Error","err") }
    finally { setFinalizando(false) }
  }

  const recibidos = items.filter(i=>i.estado_linea==="ok").length
  const faltantesList = items.filter(i=>i.estado_linea==="faltante")
  const pendientesList = items.filter(i=>i.estado_linea==="pendiente")
  const pct = items.length>0 ? Math.round(((recibidos+faltantesList.length)/items.length)*100) : 0
  const todosResueltos = pendientesList.length===0

  const Toast = toast ? (
    <div style={{ position:"fixed", top:72, left:"50%", transform:"translateX(-50%)", background:toast.tipo==="ok"?C.green:C.red, color:"#fff", padding:"11px 22px", borderRadius:14, fontSize:15, fontWeight:600, zIndex:300, whiteSpace:"nowrap", boxShadow:"0 4px 16px rgba(0,0,0,0.2)" }}>
      {toast.msg}
    </div>
  ) : null

  if (loading) return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh", color:C.light }}>Cargando orden...</div>

  // ── CONTROL DE BULTOS (paso previo al escaneo, opcional con aviso) ──
  if (necesitaControlBultos) {
    const decl = parseInt(bultosDeclarados)||0
    const recib = parseInt(bultosRecibidos)||0
    const difieren = decl > 0 && bultosRecibidos !== "" && decl !== recib
    return (
      <div style={{ background:C.bg, minHeight:"calc(100dvh - 64px)", padding:20, display:"flex", flexDirection:"column", gap:14 }}>
        {Toast}
        <div style={{ background:C.white, border:`1.5px solid ${C.border}`, borderRadius:20, padding:20 }}>
          <div style={{ fontSize:12, color:C.light, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:6 }}>Antes de escanear</div>
          <div style={{ fontSize:22, fontWeight:800, color:C.text }}>🚚 Control de bultos</div>
          <div style={{ fontSize:14, color:C.sub, marginTop:6, lineHeight:1.4 }}>
            Contá los bultos contra el remito del transporte antes de firmar. Si faltan, quedará registrado para reclamar al transporte.
          </div>
        </div>

        <div style={{ background:C.white, border:`1.5px solid ${C.border}`, borderRadius:20, padding:18, display:"flex", flexDirection:"column", gap:12 }}>
          <div>
            <div style={{ color:C.sub, fontSize:14, marginBottom:6 }}>Transporte</div>
            <select value={transporteSel} onChange={e=>setTransporteSel(e.target.value)}
              style={{ width:"100%", background:C.bg, border:`1.5px solid ${C.border}`, borderRadius:12, padding:"14px 12px", fontSize:16, color:C.text, fontWeight:600 }}>
              <option value="">Sin transporte / retiro propio</option>
              {transportes.map(t=>(<option key={t.id} value={t.id}>{t.nombre}</option>))}
            </select>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div>
              <div style={{ color:C.sub, fontSize:14, marginBottom:6 }}>Bultos según remito</div>
              <input type="number" inputMode="numeric" value={bultosDeclarados} onChange={e=>setBultosDeclarados(e.target.value)}
                style={{ width:"100%", background:C.bg, color:C.text, fontSize:32, fontWeight:800, textAlign:"center", borderRadius:12, padding:"12px", border:`2px solid ${C.border}`, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div>
              <div style={{ color:C.sub, fontSize:14, marginBottom:6 }}>Bultos contados</div>
              <input type="number" inputMode="numeric" value={bultosRecibidos} onChange={e=>setBultosRecibidos(e.target.value)}
                style={{ width:"100%", background:difieren?C.redL:C.bg, color:difieren?C.red:C.text, fontSize:32, fontWeight:800, textAlign:"center", borderRadius:12, padding:"12px", border:`2px solid ${difieren?C.redB:C.border}`, outline:"none", boxSizing:"border-box" }} />
            </div>
          </div>
          {difieren && (
            <div style={{ background:C.redL, border:`1.5px solid ${C.redB}`, borderRadius:12, padding:12 }}>
              <div style={{ color:C.red, fontWeight:700, fontSize:14, marginBottom:8 }}>
                ⚠ Faltan {Math.abs(decl-recib)} bulto{Math.abs(decl-recib)!==1?"s":""} — NO firmes conforme. Detallá qué pasó:
              </div>
              <textarea value={bultosObs} onChange={e=>setBultosObs(e.target.value)} rows={2}
                placeholder="Ej: llegaron 18 de 20 bultos, faltan 2 cajas de..."
                style={{ width:"100%", background:C.white, border:`1.5px solid ${C.redB}`, borderRadius:10, padding:10, fontSize:15, boxSizing:"border-box" }} />
            </div>
          )}
        </div>

        <button onClick={()=>guardarConformidad(difieren ? "no_conforme" : "conforme")} disabled={guardandoBultos}
          style={{ background: difieren?C.orange:C.green, color:"#fff", fontWeight:800, fontSize:19, padding:20, borderRadius:20, border:"none", cursor:"pointer", opacity:guardandoBultos?0.5:1 }}>
          {guardandoBultos ? "..." : difieren ? "⚠ Registrar con faltante de bultos" : "✓ Bultos OK — empezar a escanear"}
        </button>
        <button onClick={()=>guardarConformidad("omitida")} disabled={guardandoBultos}
          style={{ background:C.white, color:C.sub, fontWeight:600, padding:14, borderRadius:16, border:`1.5px solid ${C.border}`, cursor:"pointer", fontSize:15 }}>
          Saltear control (queda registrado)
        </button>
        <div style={{ color:C.light, fontSize:13, textAlign:"center" }}>
          Después sacale foto al remito firmado desde "Documentos"
        </div>
      </div>
    )
  }

  // ── MODAL CANTIDAD ──
  if (articuloSel) return (
    <div style={{ background:C.bg, minHeight:"calc(100dvh - 64px)", padding:20, display:"flex", flexDirection:"column", gap:14 }}>
      {Toast}
      <div style={{ background:C.white, border:`1.5px solid ${C.border}`, borderRadius:20, padding:20 }}>
        <div style={{ fontSize:12, color:C.light, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:6 }}>Artículo</div>
        <div style={{ fontSize:20, fontWeight:800, color:C.text, lineHeight:1.3 }}>{articuloSel.descripcion}{articuloMarcaSuffix(articuloSel)}</div>
        <div style={{ fontSize:14, color:C.sub, fontFamily:"monospace", marginTop:8 }}>{articuloInfoLine(articuloSel)}</div>
      </div>
      {itemActivo && (
        <div style={{ background:C.greenL, border:`1.5px solid ${C.greenB}`, borderRadius:16, padding:"16px 20px", textAlign:"center" }}>
          <div style={{ color:C.green, fontSize:13, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em" }}>Cantidad en OC</div>
          <div style={{ color:C.green, fontWeight:800, fontSize:52, lineHeight:1.1 }}>{itemActivo.cantidad_oc}</div>
        </div>
      )}
      <div style={{ background:C.white, border:`1.5px solid ${C.border}`, borderRadius:20, padding:18 }}>
        <div style={{ color:C.sub, fontSize:14, marginBottom:10 }}>Cantidad recibida físicamente:</div>
        <input type="number" inputMode="decimal" value={cantidadInput} onChange={e=>setCantidadInput(e.target.value)} autoFocus
          style={{ width:"100%", background:C.bg, color:C.text, fontSize:48, fontWeight:800, textAlign:"center", borderRadius:16, padding:"16px", border:`2px solid ${C.border}`, outline:"none", boxSizing:"border-box" }} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <button onClick={()=>guardarCantidad(false)} disabled={saving} style={{ background:C.green, color:"#fff", fontWeight:800, fontSize:20, padding:20, borderRadius:20, border:"none", cursor:"pointer", opacity:saving?0.5:1 }}>
          {saving?"...":"✓ Confirmar"}
        </button>
        <button onClick={()=>guardarCantidad(true)} disabled={saving} style={{ background:C.red, color:"#fff", fontWeight:800, fontSize:20, padding:20, borderRadius:20, border:"none", cursor:"pointer", opacity:saving?0.5:1 }}>
          ✕ Faltante
        </button>
      </div>
      <button onClick={()=>{setArticuloSel(null);setItemActivo(null);setScannerOpen(true)}}
        style={{ background:C.white, color:C.sub, fontWeight:600, padding:16, borderRadius:18, border:`1.5px solid ${C.border}`, cursor:"pointer", fontSize:16 }}>
        ← Volver al scanner
      </button>
    </div>
  )

  // ── PANEL DOCUMENTOS ──
  if (verDocumentos) return (
    <div style={{ background:C.bg, minHeight:"calc(100dvh - 64px)", padding:"16px 14px" }}>
      {Toast}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <div style={{ fontSize:18, fontWeight:800, color:C.text }}>Documentos ({documentos.length})</div>
        <button onClick={()=>setVerDocumentos(false)} style={{ background:C.white, border:`1.5px solid ${C.border}`, borderRadius:12, padding:"8px 16px", fontSize:14, fontWeight:600, cursor:"pointer" }}>← Volver</button>
      </div>
      <div style={{ marginBottom:14, display:"flex", gap:8 }}>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={e=>{if(e.target.files?.[0])subirFoto(e.target.files[0]); e.target.value=""}} />
        <select value={tipoDocDeposito} onChange={e=>setTipoDocDeposito(e.target.value as any)}
          style={{ background:C.white, border:`1.5px solid ${C.border}`, borderRadius:10, padding:"10px 12px", fontSize:13, color:C.text, fontWeight:600, flex:1 }}>
          <option value="remito">Remito</option>
          <option value="factura">Factura</option>
          <option value="foto">Foto</option>
        </select>
        <button onClick={()=>fileRef.current?.click()} disabled={subiendo}
          style={{ background:C.green, color:"#fff", border:"none", borderRadius:14, padding:"10px 20px", fontSize:15, fontWeight:700, cursor:"pointer", opacity:subiendo?0.6:1 }}>
          {subiendo?"⏳ OCR...":"📷 Foto"}
        </button>
      </div>
      {documentos.length===0&&(
        <div style={{ textAlign:"center", padding:"40px 0", color:C.light }}>
          <div style={{ fontSize:48 }}>📎</div>
          <div style={{ fontSize:15, marginTop:10 }}>No hay documentos adjuntos</div>
          <div style={{ fontSize:13, marginTop:6 }}>Tomá una foto de la factura, remito o comprobante</div>
        </div>
      )}
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {documentos.filter(Boolean).map((doc:any)=>{
          const nro = doc.datos_ocr?.comprobante?.numero_comprobante
          const total = doc.datos_ocr?.comprobante?.total_factura
          const isImg = doc.url_imagen && !doc.url_imagen.includes('.pdf')
          return (
            <div key={doc.id} style={{ background:C.white, border:`1.5px solid ${C.border}`, borderRadius:18, padding:"14px 16px", display:"flex", gap:12, alignItems:"center" }}>
              <div style={{ fontSize:32 }}>{isImg?"🖼️":"📄"}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:700, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {doc.nombre_archivo || doc.tipo_documento || "Documento"}
                </div>
                <div style={{ display:"flex", gap:8, marginTop:4, flexWrap:"wrap" }}>
                  <span style={{ fontSize:11, background:"#e0f2fe", color:"#0369a1", padding:"2px 8px", borderRadius:999, fontWeight:600 }}>
                    {doc.tipo_documento}
                  </span>
                  {nro&&<span style={{ fontSize:11, color:C.sub }}>{nro}</span>}
                  {total&&<span style={{ fontSize:11, color:C.sub }}>${Number(total).toFixed(2)}</span>}
                  {doc.procesado&&<span style={{ fontSize:11, background:"#dcfce7", color:"#15803d", padding:"2px 8px", borderRadius:999, fontWeight:600 }}>OCR ✓</span>}
                </div>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <a href={doc.url_imagen} target="_blank" rel="noopener noreferrer"
                  style={{ background:"#f0f9ff", border:"1.5px solid #bae6fd", borderRadius:10, padding:"8px 10px", fontSize:16, cursor:"pointer", textDecoration:"none" }}>
                  👁️
                </a>
                <button onClick={()=>eliminarDocumentoDeposito(doc.id)}
                  style={{ background:C.redL, border:`1.5px solid ${C.redB}`, borderRadius:10, padding:"8px 10px", fontSize:16, cursor:"pointer" }}>
                  🗑️
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  // ── SCANNER ──
  if (scannerOpen) return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100dvh - 64px)", background:C.bg }}>
      {Toast}
      <div style={{ background:C.white, borderBottom:`1px solid ${C.border}`, padding:"14px 16px" }}>
        <div style={{ fontSize:15, fontWeight:700, color:C.text }}>{orden?.numero_orden}</div>
        <div style={{ color:C.green, fontWeight:600, fontSize:14, marginTop:2 }}>🏭 {orden?.proveedores?.nombre}</div>
        <div style={{ display:"flex", gap:16, marginTop:6, fontSize:14 }}>
          <span style={{ color:C.yellow, fontWeight:700 }}>⏳ {pendientesList.length}</span>
          <span style={{ color:C.green, fontWeight:700 }}>✓ {recibidos}</span>
          {faltantesList.length>0&&<span style={{ color:C.red, fontWeight:700 }}>✕ {faltantesList.length}</span>}
        </div>
      </div>
      <div style={{ padding:"14px 16px" }}>
        <input ref={inputRef} type="text" inputMode="search" placeholder="Escanear EAN o buscar artículo..." value={busqueda}
          onChange={e=>{setBusqueda(e.target.value);buscarArticulo(e.target.value)}} autoFocus
          style={{ width:"100%", background:C.white, color:C.text, fontSize:17, borderRadius:16, padding:"15px 18px", border:`1.5px solid ${C.border}`, outline:"none", boxSizing:"border-box", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }} />
      </div>
      {buscando&&<div style={{ padding:"0 16px 8px", color:C.light, fontSize:14 }}>Buscando...</div>}
      <div style={{ flex:1, overflow:"auto", padding:"0 16px", display:"flex", flexDirection:"column", gap:10 }}>
        {resultados.map(art=>{
          const enOrden = items.find(i=>i.articulo_id===art.id)
          return (
            <button key={art.id} onClick={()=>seleccionarDeBusqueda(art)}
              style={{ textAlign:"left", width:"100%", background:enOrden?.estado_linea==="ok"?C.greenL:enOrden?C.orangeL:C.white, border:`1.5px solid ${enOrden?.estado_linea==="ok"?C.greenB:enOrden?C.orangeB:C.border}`, borderRadius:16, padding:18, cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.05)" }}>
              <div style={{ color:C.text, fontWeight:700, fontSize:16 }}>{art.descripcion}{articuloMarcaSuffix(art)}</div>
              <div style={{ fontSize:13, color:C.sub, fontFamily:"monospace", marginTop:5 }}>{articuloInfoLine(art)}</div>
              {enOrden&&<div style={{ fontSize:13, color:enOrden.estado_linea==="ok"?C.green:C.orange, marginTop:5, fontWeight:600 }}>
                OC: {enOrden.cantidad_oc} u · {enOrden.estado_linea.toUpperCase()}
              </div>}
            </button>
          )
        })}
        {!busqueda&&(
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", flex:1, flexDirection:"column", gap:14, color:C.light }}>
            <div style={{ fontSize:56, lineHeight:1 }}>📱</div>
            <div style={{ textAlign:"center", fontSize:15, lineHeight:1.5 }}>Escaneá el código de barras<br />o escribí para buscar</div>
          </div>
        )}
      </div>
      <div style={{ background:C.white, borderTop:`1px solid ${C.border}`, padding:"14px 16px", display:"flex", gap:10 }}>
        <button onClick={()=>{setScannerOpen(false);setBusqueda("");setResultados([])}}
          style={{ flex:1, background:C.bg, color:C.text, fontWeight:700, fontSize:16, padding:"17px 0", borderRadius:16, border:`1.5px solid ${C.border}`, cursor:"pointer" }}>
          📋 Lista
        </button>
        {todosResueltos
          ?<button onClick={finalizarRecepcion} disabled={finalizando} style={{ flex:1, background:C.green, color:"#fff", fontWeight:800, fontSize:17, padding:"17px 0", borderRadius:16, border:"none", cursor:"pointer", opacity:finalizando?0.6:1 }}>{finalizando?"...":"✅ Finalizar"}</button>
          :<button onClick={()=>showToast(`Faltan ${pendientesList.length} artículos`,"err")} style={{ flex:1, background:"#e5e7eb", color:C.light, fontWeight:700, fontSize:16, padding:"17px 0", borderRadius:16, border:"none", cursor:"not-allowed" }}>✅ Finalizar</button>
        }
      </div>
    </div>
  )

  // ── VISTA FALTANTES ──
  if (vistaFaltantes) return (
    <div style={{ background:C.bg, minHeight:"calc(100dvh - 64px)", padding:"16px 14px" }}>
      {Toast}
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:18, fontWeight:800, color:C.text }}>Artículos faltantes ({faltantesList.length})</div>
        <div style={{ fontSize:14, color:C.sub, marginTop:4 }}>Swipeá hacia la izquierda para devolver a pendientes</div>
      </div>
      {faltantesList.length===0&&<div style={{ textAlign:"center", padding:"40px 0", color:C.light, fontSize:16 }}>No hay faltantes</div>}
      <div style={{ display:"flex", flexDirection:"column" }}>
        {faltantesList.map(item=>(
          <SwipeItemOC key={item.id} item={item} saving={saving} onConfirm={devolverAPendiente}
            bgReveal={C.green} colorReveal="#fff" iconReveal="↩" labelReveal="Pendiente" />
        ))}
      </div>
      <button onClick={()=>setVistaFaltantes(false)} style={{ width:"100%", background:C.white, color:C.text, fontWeight:700, fontSize:16, padding:17, borderRadius:18, border:`1.5px solid ${C.border}`, cursor:"pointer", marginTop:12 }}>
        ← Volver a la lista
      </button>
    </div>
  )

  // ── LISTA PRINCIPAL ──
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100dvh - 64px)", background:C.bg }}>
      {Toast}
      <div style={{ background:C.white, borderBottom:`1px solid ${C.border}`, padding:"16px 18px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontSize:19, fontWeight:800, color:C.text }}>{orden?.numero_orden||"Recepción"}</div>
            <div style={{ color:C.green, fontWeight:600, fontSize:14, marginTop:3 }}>🏭 {orden?.proveedores?.nombre}</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8 }}>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={e=>{if(e.target.files?.[0])subirFoto(e.target.files[0]); e.target.value=""}} />
            <div style={{ display:"flex", gap:6 }}>
              <select value={tipoDocDeposito} onChange={e=>setTipoDocDeposito(e.target.value as any)}
                style={{ background:"#eff6ff", border:"1.5px solid #bfdbfe", borderRadius:10, padding:"6px 8px", fontSize:12, color:"#1d4ed8", fontWeight:600 }}>
                <option value="remito">Remito</option>
                <option value="factura">Factura</option>
                <option value="foto">Foto</option>
              </select>
              <button onClick={()=>fileRef.current?.click()} disabled={subiendo}
                style={{ background:"#eff6ff", border:"1.5px solid #bfdbfe", borderRadius:14, padding:"8px 14px", display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:14, fontWeight:700, color:"#1d4ed8" }}>
                {subiendo?"⏳":"📷"} {documentos.length>0?`(${documentos.length})`:""}
              </button>
              {documentos.length>0&&(
                <button onClick={()=>setVerDocumentos(true)}
                  style={{ background:"#eff6ff", border:"1.5px solid #bfdbfe", borderRadius:12, padding:"8px 12px", fontSize:12, fontWeight:700, color:"#1d4ed8", cursor:"pointer" }}>
                  📎 {documentos.length}
                </button>
              )}
            </div>
            {faltantesList.length>0&&(
              <button onClick={()=>setVistaFaltantes(true)} style={{ background:C.redL, border:`1.5px solid ${C.redB}`, borderRadius:12, padding:"7px 14px", fontSize:13, fontWeight:700, color:C.red, cursor:"pointer" }}>
                ✕ {faltantesList.length} faltante{faltantesList.length>1?"s":""}
              </button>
            )}
          </div>
        </div>
        <div style={{ marginTop:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, color:C.sub, marginBottom:6 }}>
            <span><span style={{ color:C.green, fontWeight:700 }}>{recibidos+faltantesList.length}</span> de {items.length} resueltos</span>
            <span style={{ fontWeight:800, color:pct===100?C.green:C.text, fontSize:14 }}>{pct}%</span>
          </div>
          <div style={{ background:C.border, borderRadius:999, height:8 }}>
            <div style={{ height:"100%", background:pct===100?C.green:C.orange, borderRadius:999, width:`${pct}%`, transition:"width 0.3s" }} />
          </div>
          <div style={{ display:"flex", gap:18, marginTop:7, fontSize:13 }}>
            <span style={{ color:C.yellow, fontWeight:700 }}>⏳ {pendientesList.length}</span>
            <span style={{ color:C.green, fontWeight:700 }}>✓ {recibidos}</span>
            {faltantesList.length>0&&<span style={{ color:C.red, fontWeight:700 }}>✕ {faltantesList.length}</span>}
          </div>
        </div>
      </div>

      {pendientesList.length>0&&(
        <div style={{ background:C.greenL, borderBottom:`1px solid ${C.greenB}`, padding:"10px 18px", display:"flex", gap:8, alignItems:"center" }}>
          <span style={{ fontSize:16 }}>👈</span>
          <span style={{ fontSize:13, color:C.green, fontWeight:600 }}>Swipeá para marcar faltante · Escaneá para registrar cantidad</span>
        </div>
      )}

      <div style={{ flex:1, overflow:"auto", padding:"12px 14px 0" }}>
        {pendientesList.length>0&&(
          <>
            <div style={{ fontSize:12, fontWeight:700, color:C.light, textTransform:"uppercase", letterSpacing:"0.1em", padding:"2px 2px 10px" }}>Pendientes ({pendientesList.length})</div>
            {pendientesList.map(item=>(
              <SwipeItemOC key={item.id} item={item} saving={saving} onConfirm={marcarFaltante}
                bgReveal={C.red} colorReveal="#fff" iconReveal="✕" labelReveal="Faltante" />
            ))}
          </>
        )}
        {recibidos>0&&(
          <>
            <div style={{ fontSize:12, fontWeight:700, color:C.light, textTransform:"uppercase", letterSpacing:"0.1em", padding:"8px 2px 10px" }}>Recibidos ({recibidos})</div>
            {items.filter(i=>i.estado_linea==="ok").map(item=>(
              <SwipeItemOC key={item.id} item={item} saving={saving} onConfirm={marcarFaltante}
                bgReveal={C.red} colorReveal="#fff" iconReveal="✕" labelReveal="Faltante" />
            ))}
          </>
        )}
        <div style={{ height:16 }} />
      </div>

      <div style={{ background:C.white, borderTop:`1px solid ${C.border}`, padding:"14px 16px", display:"flex", gap:12 }}>
        <button onClick={()=>setScannerOpen(true)}
          style={{ flex:2, background:C.white, color:C.text, fontWeight:700, fontSize:18, padding:"19px 0", borderRadius:18, border:`1.5px solid ${C.border}`, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
          <span style={{ fontSize:20 }}>🔍</span> Buscar artículo
        </button>
        {todosResueltos
          ?<button onClick={finalizarRecepcion} disabled={finalizando} style={{ flex:1, background:"#15803d", color:"#fff", fontWeight:800, fontSize:16, padding:"19px 0", borderRadius:18, border:"none", cursor:"pointer", opacity:finalizando?0.6:1 }}>{finalizando?"...":"✅ Finalizar"}</button>
          :<button onClick={()=>showToast(`Faltan ${pendientesList.length} artículos`,"err")} style={{ flex:1, background:"#f3f4f6", color:C.light, fontWeight:700, fontSize:16, padding:"19px 0", borderRadius:18, border:`1.5px solid ${C.border}`, cursor:"not-allowed" }}>✅ Finalizar</button>
        }
      </div>
    </div>
  )
}
