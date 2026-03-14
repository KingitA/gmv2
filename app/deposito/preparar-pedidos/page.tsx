"use client"

import { useState, useEffect } from "react"
import Link from "next/link"

const C = { bg:"#f4f6f9",white:"#ffffff",border:"#e5e7eb",text:"#111827",textSub:"#6b7280",textLight:"#9ca3af",orange:"#ea580c",orangeLight:"#fff7ed",orangeBorder:"#fed7aa",green:"#16a34a",greenLight:"#f0fdf4",greenBorder:"#bbf7d0",yellow:"#d97706",yellowLight:"#fffbeb" }

export default function PrepararPedidosPage() {
  const [pedidos, setPedidos] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/deposito/pedidos").then(r => r.json())
      .then(data => { if (Array.isArray(data)) setPedidos(data); else setError("Error al cargar") })
      .catch(() => setError("Error de conexión")).finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"60vh",color:C.textLight }}>Cargando pedidos...</div>

  return (
    <div style={{ padding: 16, background: C.bg, minHeight: "calc(100dvh - 64px)" }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
        <div>
          <div style={{ fontSize:17,fontWeight:700,color:C.text }}>{pedidos.length} pedido{pedidos.length!==1?"s":""} pendiente{pedidos.length!==1?"s":""}</div>
          <div style={{ fontSize:13,color:C.textSub }}>Tocá un pedido para empezar</div>
        </div>
        <button onClick={() => window.location.reload()} style={{ background:C.white,border:`1px solid ${C.border}`,borderRadius:12,padding:"8px 14px",fontSize:13,color:C.textSub,cursor:"pointer" }}>↻</button>
      </div>

      {error && <div style={{ background:"#fef2f2",border:"1px solid #fecaca",borderRadius:14,padding:14,color:"#dc2626",marginBottom:12 }}>{error}</div>}

      {pedidos.length === 0 && !error && (
        <div style={{ textAlign:"center",padding:"60px 0" }}>
          <div style={{ fontSize:48,marginBottom:12 }}>✅</div>
          <div style={{ color:C.textSub,fontSize:16,fontWeight:600 }}>No hay pedidos pendientes</div>
        </div>
      )}

      <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
        {pedidos.map(pedido => {
          const { total=0, resueltos=0 } = pedido.progreso || {}
          const pct = total > 0 ? Math.round((resueltos/total)*100) : 0
          const enProgreso = resueltos > 0 && resueltos < total
          const listo = total > 0 && resueltos === total
          return (
            <Link key={pedido.id} href={`/deposito/preparar-pedidos/${pedido.id}`} style={{ textDecoration:"none", background:C.white, border:`1px solid ${listo ? C.greenBorder : enProgreso ? C.orangeBorder : C.border}`, borderRadius:18, padding:16, display:"block", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10 }}>
                <div>
                  <div style={{ fontSize:17,fontWeight:700,color:C.text }}>{pedido.numero_pedido}</div>
                  <div style={{ color:C.textSub,fontSize:13,marginTop:2 }}>{pedido.clientes?.razon_social||pedido.clientes?.nombre}</div>
                </div>
                <span style={{ fontSize:11,fontWeight:700,padding:"5px 12px",borderRadius:999,background:listo?C.greenLight:enProgreso?C.orangeLight:C.bg,color:listo?C.green:enProgreso?C.orange:C.textSub,border:`1px solid ${listo?C.greenBorder:enProgreso?C.orangeBorder:C.border}` }}>
                  {listo?"Listo":enProgreso?"En progreso":"Pendiente"}
                </span>
              </div>
              <div style={{ display:"flex",gap:16,fontSize:13,color:C.textSub,marginBottom:enProgreso||listo?10:0 }}>
                <span>📦 {total} artículos</span>
                <span>📅 {new Date(pedido.fecha).toLocaleDateString("es-AR")}</span>
              </div>
              {(enProgreso||listo) && (
                <div>
                  <div style={{ background:C.border,borderRadius:999,height:6,overflow:"hidden" }}>
                    <div style={{ height:"100%",background:listo?C.green:C.orange,borderRadius:999,width:`${pct}%`,transition:"width 0.3s" }} />
                  </div>
                  <div style={{ fontSize:12,color:listo?C.green:C.orange,fontWeight:600,marginTop:4 }}>{pct}% completado</div>
                </div>
              )}
              <div style={{ textAlign:"right",marginTop:8,fontSize:13,color:C.orange,fontWeight:700 }}>{enProgreso?"Continuar →":"Empezar →"}</div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
