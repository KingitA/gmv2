"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

const C = { bg:"#f4f6f9",white:"#ffffff",border:"#e5e7eb",text:"#111827",textSub:"#6b7280",textLight:"#9ca3af",green:"#16a34a",greenLight:"#f0fdf4",greenBorder:"#bbf7d0",orange:"#ea580c",orangeLight:"#fff7ed",orangeBorder:"#fed7aa" }

export default function RecibirMercaderiaPage() {
  const [ordenes, setOrdenes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [iniciando, setIniciando] = useState<string|null>(null)
  const [error, setError] = useState("")
  const router = useRouter()

  useEffect(() => {
    fetch("/api/deposito/recepciones").then(r => r.json())
      .then(data => { if (Array.isArray(data)) setOrdenes(data) })
      .catch(() => setError("Error de conexión")).finally(() => setLoading(false))
  }, [])

  const iniciar = async (orden: any) => {
    setIniciando(orden.id)
    try {
      const r = await fetch("/api/deposito/recepciones", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ orden_compra_id: orden.id }) })
      const data = await r.json()
      if (data.error) { setError(data.error); return }
      router.push(`/deposito/recibir-mercaderia/${orden.id}`)
    } catch { setError("Error de conexión") }
    finally { setIniciando(null) }
  }

  if (loading) return <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"60vh",color:C.textLight }}>Cargando órdenes...</div>

  return (
    <div style={{ padding:16, background:C.bg, minHeight:"calc(100dvh - 64px)" }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
        <div>
          <div style={{ fontSize:17,fontWeight:700,color:C.text }}>{ordenes.length} orden{ordenes.length!==1?"es":""} pendiente{ordenes.length!==1?"s":""}</div>
          <div style={{ fontSize:13,color:C.textSub }}>Seleccioná una orden para recibir</div>
        </div>
        <button onClick={() => window.location.reload()} style={{ background:C.white,border:`1px solid ${C.border}`,borderRadius:12,padding:"8px 14px",fontSize:13,color:C.textSub,cursor:"pointer" }}>↻</button>
      </div>

      {error && <div style={{ background:"#fef2f2",border:"1px solid #fecaca",borderRadius:14,padding:14,color:"#dc2626",marginBottom:12 }}>{error}</div>}

      {ordenes.length === 0 && !error && (
        <div style={{ textAlign:"center",padding:"60px 0" }}>
          <div style={{ fontSize:48,marginBottom:12 }}>🚚</div>
          <div style={{ color:C.textSub,fontSize:16,fontWeight:600 }}>No hay órdenes pendientes</div>
        </div>
      )}

      <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
        {ordenes.map(orden => {
          const enProgreso = orden.recepcion?.estado === "en_proceso"
          const items = orden.recepcion?.recepciones_items || []
          const recibidos = items.filter((i:any) => i.estado_linea === "ok").length
          const total = orden.ordenes_compra_detalle?.length || 0
          const pct = total > 0 ? Math.round((recibidos/total)*100) : 0
          return (
            <div key={orden.id} style={{ background:C.white,border:`1px solid ${enProgreso?C.orangeBorder:C.border}`,borderRadius:18,padding:16,boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10 }}>
                <div>
                  <div style={{ fontSize:17,fontWeight:700,color:C.text }}>{orden.numero_orden}</div>
                  <div style={{ color:C.green,fontWeight:600,fontSize:14,marginTop:2 }}>🏭 {orden.proveedores?.nombre}</div>
                </div>
                <span style={{ fontSize:11,fontWeight:700,padding:"5px 12px",borderRadius:999,background:enProgreso?C.orangeLight:C.bg,color:enProgreso?C.orange:C.textSub,border:`1px solid ${enProgreso?C.orangeBorder:C.border}` }}>
                  {enProgreso?"En progreso":"Pendiente"}
                </span>
              </div>
              <div style={{ display:"flex",gap:16,fontSize:13,color:C.textSub,marginBottom:enProgreso?10:14 }}>
                <span>📦 {total} artículos</span>
                <span>📅 {new Date(orden.fecha_orden).toLocaleDateString("es-AR")}</span>
              </div>
              {enProgreso && (
                <div style={{ marginBottom:12 }}>
                  <div style={{ background:C.border,borderRadius:999,height:6,overflow:"hidden" }}>
                    <div style={{ height:"100%",background:C.green,borderRadius:999,width:`${pct}%` }} />
                  </div>
                  <div style={{ fontSize:12,color:C.textSub,marginTop:4 }}>{recibidos}/{total} artículos recibidos</div>
                </div>
              )}
              <button onClick={() => iniciar(orden)} disabled={iniciando===orden.id}
                style={{ width:"100%",background:C.green,color:"#fff",fontWeight:700,fontSize:15,padding:"14px",borderRadius:14,border:"none",cursor:"pointer",opacity:iniciando===orden.id?0.6:1 }}>
                {iniciando===orden.id?"Cargando...":enProgreso?"Continuar recepción →":"Iniciar recepción →"}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
