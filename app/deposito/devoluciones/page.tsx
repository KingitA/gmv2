"use client"

import { useState, useEffect, useRef, useCallback } from "react"

interface DetalleDevolucion {
  id: string; cantidad: number; motivo?: string; es_vendible: boolean
  articulos: { id: string; sku: string; descripcion: string; ean13?: string }
}
interface Devolucion {
  id: string; numero_devolucion?: string; estado: string; observaciones?: string; created_at: string
  clientes: { nombre: string; razon_social?: string } | null
  devoluciones_detalle: DetalleDevolucion[]
}
interface ArticuloFound { id: string; sku: string; descripcion: string; ean13?: string; stock_actual: number }

const C = {
  bg:"#f4f6f9", white:"#ffffff", border:"#e5e7eb",
  text:"#111827", sub:"#6b7280", light:"#9ca3af",
  purple:"#9333ea", purpleL:"#faf5ff", purpleB:"#e9d5ff",
  green:"#16a34a", greenL:"#f0fdf4", greenB:"#bbf7d0",
  red:"#dc2626", redL:"#fef2f2", redB:"#fecaca",
  orange:"#ea580c", orangeL:"#fff7ed", orangeB:"#fed7aa",
}

type Vista = "home" | "scanner" | "resultados" | "confirmar"

export default function DevolucionesPage() {
  const [devoluciones, setDevoluciones] = useState<Devolucion[]>([])
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState<Vista>("home")
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<ArticuloFound[]>([])
  const [buscando, setBuscando] = useState(false)
  const [devConArticulo, setDevConArticulo] = useState<{dev:Devolucion;detalle:DetalleDevolucion}[]>([])
  const [articuloBuscado, setArticuloBuscado] = useState<ArticuloFound|null>(null)
  const [devSeleccionada, setDevSeleccionada] = useState<Devolucion|null>(null)
  const [confirmados, setConfirmados] = useState<Record<string,boolean>>({})
  const [guardando, setGuardando] = useState(false)
  const [toast, setToast] = useState<{msg:string;tipo:"ok"|"err"}|null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<NodeJS.Timeout>()

  useEffect(() => { cargar() }, [])
  useEffect(() => { if (vista==="scanner") setTimeout(()=>inputRef.current?.focus(),100) }, [vista])

  const cargar = () => {
    setLoading(true)
    fetch("/api/deposito/devoluciones").then(r=>r.json())
      .then(data=>{ if(Array.isArray(data)) setDevoluciones(data) })
      .catch(()=>showToast("Error de conexión","err")).finally(()=>setLoading(false))
  }

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

  const seleccionarArticulo = (art:ArticuloFound) => {
    const coincidencias: {dev:Devolucion;detalle:DetalleDevolucion}[] = []
    devoluciones.forEach(dev => {
      dev.devoluciones_detalle.forEach(det => {
        if (det.articulos.id===art.id) coincidencias.push({dev,detalle:det})
      })
    })
    setArticuloBuscado(art)
    setDevConArticulo(coincidencias)
    setBusqueda(""); setResultados([])
    setVista("resultados")
  }

  const abrirDevolucion = (dev:Devolucion) => {
    setDevSeleccionada(dev)
    const init:Record<string,boolean> = {}
    dev.devoluciones_detalle.forEach(d=>{ init[d.id]=d.es_vendible })
    setConfirmados(init)
    setVista("confirmar")
  }

  const confirmarDevolucion = async () => {
    if (!devSeleccionada) return
    setGuardando(true)
    try {
      const items_confirmados = devSeleccionada.devoluciones_detalle.map(d=>({
        detalle_id:d.id, articulo_id:d.articulos.id,
        cantidad_recibida:d.cantidad,
        es_vendible: confirmados[d.id]??d.es_vendible,
      }))
      const r = await fetch("/api/deposito/devoluciones",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({devolucion_id:devSeleccionada.id,items_confirmados}),
      })
      const data = await r.json()
      if (data.ok) {
        showToast("✅ Devolución confirmada","ok")
        setVista("home"); setDevSeleccionada(null)
        setTimeout(()=>cargar(),1000)
      } else { showToast(data.error||"Error","err") }
    } catch { showToast("Error de conexión","err") }
    finally { setGuardando(false) }
  }

  const Toast = toast ? (
    <div style={{ position:"fixed", top:72, left:"50%", transform:"translateX(-50%)", background:toast.tipo==="ok"?C.green:C.red, color:"#fff", padding:"11px 22px", borderRadius:14, fontSize:15, fontWeight:600, zIndex:300, whiteSpace:"nowrap", boxShadow:"0 4px 16px rgba(0,0,0,0.2)" }}>
      {toast.msg}
    </div>
  ) : null

  // ── CONFIRMAR DEVOLUCIÓN ──
  if (vista==="confirmar"&&devSeleccionada) return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100dvh - 64px)", background:C.bg }}>
      {Toast}
      <div style={{ background:C.white, borderBottom:`1px solid ${C.border}`, padding:"16px 18px" }}>
        <div style={{ fontSize:19, fontWeight:800, color:C.text }}>{devSeleccionada.numero_devolucion||`DEV-${devSeleccionada.id.slice(0,6)}`}</div>
        <div style={{ color:C.purple, fontWeight:600, fontSize:14, marginTop:3 }}>{devSeleccionada.clientes?.razon_social||devSeleccionada.clientes?.nombre}</div>
        {devSeleccionada.observaciones&&<div style={{ color:C.sub, fontSize:13, marginTop:4, fontStyle:"italic" }}>"{devSeleccionada.observaciones}"</div>}
      </div>
      <div style={{ background:C.purpleL, borderBottom:`1px solid ${C.purpleB}`, padding:"10px 18px" }}>
        <div style={{ color:C.purple, fontSize:13, fontWeight:600 }}>⚠️ Confirmá el estado de cada artículo: ¿es vendible o no?</div>
      </div>
      <div style={{ flex:1, overflow:"auto", padding:"12px 14px 0" }}>
        <div style={{ display:"flex", flexDirection:"column", gap:10, paddingBottom:12 }}>
          {devSeleccionada.devoluciones_detalle.map(det => {
            const esVendible = confirmados[det.id]??det.es_vendible
            return (
              <div key={det.id} style={{ background:esVendible?C.greenL:C.redL, border:`1.5px solid ${esVendible?C.greenB:C.redB}`, borderRadius:18, padding:16 }}>
                <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:14 }}>
                  <span style={{ fontSize:24 }}>{esVendible?"✅":"🚫"}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ color:C.text, fontWeight:700, fontSize:15, lineHeight:1.3 }}>{det.articulos.descripcion}</div>
                    <div style={{ color:C.light, fontSize:12, fontFamily:"monospace", marginTop:3 }}>{det.articulos.sku}</div>
                    {det.motivo&&<div style={{ color:C.sub, fontSize:12, marginTop:4, fontStyle:"italic" }}>{det.motivo}</div>}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ color:C.text, fontWeight:800, fontSize:22 }}>{det.cantidad}</div>
                    <div style={{ color:C.light, fontSize:12 }}>unidades</div>
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <button onClick={()=>setConfirmados(p=>({...p,[det.id]:true}))}
                    style={{ background:esVendible?C.green:"#f3f4f6", color:esVendible?"#fff":C.light, fontWeight:700, fontSize:15, padding:"13px", borderRadius:14, border:"none", cursor:"pointer" }}>
                    ✓ Vendible
                  </button>
                  <button onClick={()=>setConfirmados(p=>({...p,[det.id]:false}))}
                    style={{ background:!esVendible?C.red:"#f3f4f6", color:!esVendible?"#fff":C.light, fontWeight:700, fontSize:15, padding:"13px", borderRadius:14, border:"none", cursor:"pointer" }}>
                    ✕ No vendible
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ background:C.white, borderTop:`1px solid ${C.border}`, padding:"14px 16px", display:"flex", gap:10 }}>
        <button onClick={()=>setVista("home")} style={{ flex:1, background:C.bg, color:C.text, fontWeight:700, fontSize:16, padding:"17px 0", borderRadius:16, border:`1.5px solid ${C.border}`, cursor:"pointer" }}>
          ← Volver
        </button>
        <button onClick={confirmarDevolucion} disabled={guardando} style={{ flex:2, background:C.purple, color:"#fff", fontWeight:800, fontSize:17, padding:"17px 0", borderRadius:16, border:"none", cursor:"pointer", opacity:guardando?0.6:1 }}>
          {guardando?"Confirmando...":"✅ Confirmar recepción"}
        </button>
      </div>
    </div>
  )

  // ── RESULTADOS POR ARTÍCULO ──
  if (vista==="resultados"&&articuloBuscado) return (
    <div style={{ background:C.bg, minHeight:"calc(100dvh - 64px)", padding:"16px 14px" }}>
      {Toast}
      <div style={{ background:C.white, border:`1.5px solid ${C.border}`, borderRadius:18, padding:16, marginBottom:18 }}>
        <div style={{ fontSize:12, color:C.light, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>Artículo buscado</div>
        <div style={{ fontSize:17, fontWeight:800, color:C.text }}>{articuloBuscado.descripcion}</div>
        <div style={{ fontSize:13, color:C.sub, fontFamily:"monospace", marginTop:4 }}>{articuloBuscado.sku}</div>
      </div>
      {devConArticulo.length===0 ? (
        <div style={{ textAlign:"center", padding:"40px 20px" }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🔍</div>
          <div style={{ fontSize:16, fontWeight:600, color:C.sub }}>Este artículo no está en ninguna devolución pendiente</div>
        </div>
      ) : (
        <>
          <div style={{ color:C.purple, fontSize:15, marginBottom:12, fontWeight:700 }}>
            {devConArticulo.length} devolución{devConArticulo.length>1?"es":""} con este artículo:
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {devConArticulo.map(({dev,detalle})=>(
              <button key={dev.id} onClick={()=>abrirDevolucion(dev)}
                style={{ textAlign:"left", background:C.white, border:`1.5px solid ${C.purpleB}`, borderRadius:18, padding:16, cursor:"pointer", width:"100%", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                  <div>
                    <div style={{ color:C.text, fontWeight:800, fontSize:17 }}>{dev.numero_devolucion||`DEV-${dev.id.slice(0,6)}`}</div>
                    <div style={{ color:C.purple, fontSize:14, marginTop:3 }}>{dev.clientes?.razon_social||dev.clientes?.nombre}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ color:C.text, fontWeight:800, fontSize:24 }}>{detalle.cantidad}</div>
                    <div style={{ color:C.light, fontSize:12 }}>unidades</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <span style={{ fontSize:13, padding:"4px 12px", borderRadius:999, background:detalle.es_vendible?C.greenL:C.redL, color:detalle.es_vendible?C.green:C.red, fontWeight:600, border:`1px solid ${detalle.es_vendible?C.greenB:C.redB}` }}>
                    {detalle.es_vendible?"Vendible":"No vendible"}
                  </span>
                  {detalle.motivo&&<span style={{ fontSize:13, color:C.sub, fontStyle:"italic" }}>{detalle.motivo}</span>}
                </div>
                <div style={{ color:C.purple, fontSize:14, marginTop:10, fontWeight:700 }}>Confirmar esta devolución →</div>
              </button>
            ))}
          </div>
        </>
      )}
      <button onClick={()=>{ setVista("scanner"); setArticuloBuscado(null); setDevConArticulo([]) }}
        style={{ width:"100%", background:C.white, color:C.text, fontWeight:700, fontSize:16, padding:17, borderRadius:18, border:`1.5px solid ${C.border}`, cursor:"pointer", marginTop:16 }}>
        ← Buscar otro artículo
      </button>
    </div>
  )

  // ── SCANNER ──
  if (vista==="scanner") return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100dvh - 64px)", background:C.bg }}>
      {Toast}
      <div style={{ padding:"14px 16px" }}>
        <input ref={inputRef} type="text" inputMode="search" placeholder="Escanear EAN o buscar artículo del camión..." value={busqueda}
          onChange={e=>{setBusqueda(e.target.value);buscarArticulo(e.target.value)}} autoFocus
          style={{ width:"100%", background:C.white, color:C.text, fontSize:17, borderRadius:16, padding:"15px 18px", border:`1.5px solid ${C.border}`, outline:"none", boxSizing:"border-box", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }} />
      </div>
      {buscando&&<div style={{ padding:"0 16px 8px", color:C.light, fontSize:14 }}>Buscando...</div>}
      <div style={{ flex:1, overflow:"auto", padding:"0 16px", display:"flex", flexDirection:"column", gap:10 }}>
        {resultados.map(art=>(
          <button key={art.id} onClick={()=>seleccionarArticulo(art)}
            style={{ textAlign:"left", background:C.white, border:`1.5px solid ${C.border}`, borderRadius:16, padding:18, cursor:"pointer", boxShadow:"0 1px 4px rgba(0,0,0,0.05)" }}>
            <div style={{ color:C.text, fontWeight:700, fontSize:16 }}>{art.descripcion}</div>
            <div style={{ fontSize:13, color:C.sub, fontFamily:"monospace", marginTop:5 }}>{art.sku}{art.ean13&&` · ${art.ean13}`}</div>
          </button>
        ))}
        {!busqueda&&(
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", flex:1, flexDirection:"column", gap:14, color:C.light }}>
            <div style={{ fontSize:56, lineHeight:1 }}>📦</div>
            <div style={{ textAlign:"center", fontSize:15, lineHeight:1.5 }}>Escaneá un artículo del camión<br />para ver a qué devolución pertenece</div>
          </div>
        )}
      </div>
      <div style={{ background:C.white, borderTop:`1px solid ${C.border}`, padding:"14px 16px" }}>
        <button onClick={()=>setVista("home")} style={{ width:"100%", background:C.bg, color:C.text, fontWeight:700, fontSize:16, padding:"17px 0", borderRadius:16, border:`1.5px solid ${C.border}`, cursor:"pointer" }}>
          📋 Ver listado de devoluciones
        </button>
      </div>
    </div>
  )

  // ── HOME ──
  return (
    <div style={{ background:C.bg, minHeight:"calc(100dvh - 64px)", display:"flex", flexDirection:"column" }}>
      {Toast}
      <div style={{ padding:"16px 16px 0" }}>
        {/* Botón principal escanear */}
        <button onClick={()=>setVista("scanner")}
          style={{ width:"100%", background:C.purple, color:"#fff", fontWeight:800, fontSize:18, padding:"22px 0", borderRadius:20, border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:12, boxShadow:"0 4px 20px rgba(147,51,234,0.35)", marginBottom:20 }}>
          <span style={{ fontSize:26 }}>📦</span> Escanear artículo del camión
        </button>

        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:18 }}>
          <div style={{ flex:1, height:1, background:C.border }} />
          <div style={{ color:C.light, fontSize:13, fontWeight:600 }}>o ver listado</div>
          <div style={{ flex:1, height:1, background:C.border }} />
        </div>
      </div>

      <div style={{ flex:1, overflow:"auto", padding:"0 16px 20px" }}>
        {loading&&<div style={{ textAlign:"center", padding:40, color:C.light }}>Cargando...</div>}
        {!loading&&devoluciones.length===0&&(
          <div style={{ textAlign:"center", padding:"40px 20px" }}>
            <div style={{ fontSize:48, marginBottom:12 }}>↩️</div>
            <div style={{ color:C.sub, fontSize:16, fontWeight:600 }}>No hay devoluciones pendientes</div>
          </div>
        )}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {devoluciones.map(dev=>{
            const items = dev.devoluciones_detalle||[]
            const vendibles = items.filter(i=>i.es_vendible).length
            const noVendibles = items.filter(i=>!i.es_vendible).length
            return (
              <button key={dev.id} onClick={()=>abrirDevolucion(dev)}
                style={{ textAlign:"left", background:C.white, border:`1.5px solid ${C.purpleB}`, borderRadius:20, padding:18, cursor:"pointer", width:"100%", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                  <div>
                    <div style={{ color:C.text, fontWeight:800, fontSize:17 }}>{dev.numero_devolucion||`DEV-${dev.id.slice(0,6)}`}</div>
                    <div style={{ color:C.purple, fontSize:14, marginTop:3 }}>{dev.clientes?.razon_social||dev.clientes?.nombre}</div>
                  </div>
                  <span style={{ fontSize:12, fontWeight:700, padding:"5px 12px", borderRadius:999, background:C.purpleL, color:C.purple, border:`1px solid ${C.purpleB}` }}>
                    Pendiente
                  </span>
                </div>
                <div style={{ display:"flex", gap:14, fontSize:14, marginBottom:10 }}>
                  <span style={{ color:C.sub }}>📦 {items.length} artículo{items.length!==1?"s":""}</span>
                  {vendibles>0&&<span style={{ color:C.green, fontWeight:600 }}>✓ {vendibles} vendible{vendibles!==1?"s":""}</span>}
                  {noVendibles>0&&<span style={{ color:C.red, fontWeight:600 }}>✕ {noVendibles} no vendible{noVendibles!==1?"s":""}</span>}
                </div>
                <div style={{ color:C.purple, fontSize:14, fontWeight:700 }}>Confirmar recepción →</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
