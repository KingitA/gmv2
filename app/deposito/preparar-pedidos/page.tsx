"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"

const C = {
  bg:"#f4f6f9", white:"#ffffff", border:"#e5e7eb",
  text:"#111827", sub:"#6b7280", light:"#9ca3af",
  orange:"#ea580c", orangeL:"#fff7ed", orangeB:"#fed7aa",
  green:"#16a34a", greenL:"#f0fdf4", greenB:"#bbf7d0",
  red:"#dc2626", redL:"#fef2f2", redB:"#fecaca",
  yellow:"#d97706", yellowL:"#fffbeb", yellowB:"#fde68a",
}

const PRIORIDADES = [
  { nivel: 1, label: "Urgente", emoji: "🔴", bg: C.redL, border: C.redB, color: C.red, dot: C.red },
  { nivel: 2, label: "Alta",    emoji: "🟠", bg: C.orangeL, border: C.orangeB, color: C.orange, dot: C.orange },
  { nivel: 3, label: "Normal",  emoji: "🟢", bg: C.greenL, border: C.greenB, color: C.green, dot: C.green },
]

interface Pedido {
  id: string
  numero_pedido: string
  estado: string
  fecha: string
  prioridad: number
  clientes: { nombre: string; razon_social?: string } | null
  pedidos_detalle: any[]
  progreso: { total: number; resueltos: number }
}

interface UrgentModal {
  pedidoId: string
  numeroPedido: string
  clienteNombre: string
}

export default function PrepararPedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [openGroups, setOpenGroups] = useState<Set<number>>(new Set([1, 2, 3]))
  const [urgentModal, setUrgentModal] = useState<UrgentModal | null>(null)
  // Track which urgent notifications were already accepted/dismissed
  const [dismissedUrgents, setDismissedUrgents] = useState<Set<string>>(new Set())
  const prevPedidosRef = useRef<Pedido[]>([])
  const supabase = createClient()

  const cargar = async () => {
    try {
      const r = await fetch("/api/deposito/pedidos")
      const data = await r.json()
      if (Array.isArray(data)) {
        // Check for newly urgent pedidos
        const prev = prevPedidosRef.current
        if (prev.length > 0) {
          data.forEach((p: Pedido) => {
            const prevP = prev.find(pp => pp.id === p.id)
            const isNewlyUrgent = p.prioridad === 1 && (!prevP || prevP.prioridad !== 1)
            if (isNewlyUrgent && !dismissedUrgents.has(p.id)) {
              setUrgentModal({
                pedidoId: p.id,
                numeroPedido: p.numero_pedido,
                clienteNombre: p.clientes?.razon_social || p.clientes?.nombre || "Sin cliente",
              })
            }
          })
        }
        prevPedidosRef.current = data
        setPedidos(data)
      }
    } catch { setError("Error de conexión") }
    finally { setLoading(false) }
  }

  useEffect(() => {
    cargar()

    // Realtime subscription — listen for prioridad changes on pedidos
    const channel = supabase
      .channel("deposito-pedidos-prioridad")
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "pedidos",
        filter: "estado=in.(pendiente,en_preparacion)",
      }, (payload: any) => {
        const updated = payload.new
        if (!updated) return

        // If changed to urgente and not dismissed, show modal
        if (updated.prioridad === 1 && !dismissedUrgents.has(updated.id)) {
          // Fetch client name
          supabase.from("clientes").select("nombre, razon_social").eq("id", updated.cliente_id).single()
            .then(({ data: cli }) => {
              setUrgentModal({
                pedidoId: updated.id,
                numeroPedido: updated.numero_pedido,
                clienteNombre: cli?.razon_social || cli?.nombre || "Sin cliente",
              })
            })
        }

        // Update local state
        setPedidos(prev => {
          const exists = prev.find(p => p.id === updated.id)
          if (exists) {
            return prev.map(p => p.id === updated.id ? { ...p, prioridad: updated.prioridad } : p)
          }
          return prev
        })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const toggleGroup = (nivel: number) => {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(nivel)) next.delete(nivel)
      else next.add(nivel)
      return next
    })
  }

  const aceptarUrgente = () => {
    if (urgentModal) {
      setDismissedUrgents(prev => new Set([...prev, urgentModal.pedidoId]))
    }
    setUrgentModal(null)
  }

  const cerrarUrgente = () => {
    if (urgentModal) {
      setDismissedUrgents(prev => new Set([...prev, urgentModal.pedidoId]))
    }
    setUrgentModal(null)
  }

  const getPedidosByPrioridad = (nivel: number) =>
    pedidos.filter(p => (p.prioridad || 3) === nivel)

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh", color:C.light }}>
      Cargando pedidos...
    </div>
  )

  return (
    <div style={{ background:C.bg, minHeight:"calc(100dvh - 64px)", paddingBottom:24 }}>

      {/* ── MODAL URGENTE ── */}
      {urgentModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:500, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:C.white, borderRadius:24, padding:28, width:"100%", maxWidth:380, boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>
            {/* Pulsing icon */}
            <div style={{ display:"flex", justifyContent:"center", marginBottom:20 }}>
              <div style={{ width:72, height:72, borderRadius:"50%", background:C.redL, border:`3px solid ${C.red}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:36 }}>
                🚨
              </div>
            </div>
            <div style={{ textAlign:"center", marginBottom:24 }}>
              <div style={{ fontSize:13, fontWeight:700, color:C.red, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8 }}>
                Pedido Urgente
              </div>
              <div style={{ fontSize:22, fontWeight:800, color:C.text, lineHeight:1.2 }}>
                {urgentModal.clienteNombre}
              </div>
              <div style={{ fontSize:14, color:C.sub, marginTop:6, fontFamily:"monospace" }}>
                {urgentModal.numeroPedido}
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <button
                onClick={cerrarUrgente}
                style={{ background:C.bg, color:C.text, fontWeight:700, fontSize:16, padding:"14px 0", borderRadius:16, border:`1.5px solid ${C.border}`, cursor:"pointer" }}
              >
                Cerrar
              </button>
              <Link
                href={`/deposito/preparar-pedidos/${urgentModal.pedidoId}`}
                onClick={aceptarUrgente}
                style={{ background:C.red, color:"#fff", fontWeight:700, fontSize:16, padding:"14px 0", borderRadius:16, border:"none", cursor:"pointer", textDecoration:"none", display:"flex", alignItems:"center", justifyContent:"center" }}
              >
                Aceptar →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ padding:"16px 16px 0", display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div>
          <div style={{ fontSize:17, fontWeight:700, color:C.text }}>{pedidos.length} pedido{pedidos.length!==1?"s":""} pendiente{pedidos.length!==1?"s":""}</div>
          <div style={{ fontSize:13, color:C.sub, marginTop:2 }}>Agrupados por prioridad</div>
        </div>
        <button onClick={cargar} style={{ background:C.white, border:`1px solid ${C.border}`, borderRadius:12, padding:"8px 14px", fontSize:13, color:C.sub, cursor:"pointer" }}>
          ↻
        </button>
      </div>

      {error && (
        <div style={{ margin:"0 16px 12px", background:C.redL, border:`1px solid ${C.redB}`, borderRadius:14, padding:14, color:C.red }}>
          {error}
        </div>
      )}

      {/* Groups */}
      <div style={{ display:"flex", flexDirection:"column", gap:10, padding:"0 16px" }}>
        {PRIORIDADES.map(prio => {
          const grupo = getPedidosByPrioridad(prio.nivel)
          const isOpen = openGroups.has(prio.nivel)
          return (
            <div key={prio.nivel}>
              {/* Group header */}
              <button
                onClick={() => toggleGroup(prio.nivel)}
                style={{ width:"100%", background:prio.bg, border:`1.5px solid ${prio.border}`, borderRadius: isOpen && grupo.length > 0 ? "16px 16px 0 0" : 16, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer" }}
              >
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:12, height:12, borderRadius:"50%", background:prio.dot }} />
                  <span style={{ fontSize:16, fontWeight:800, color:prio.color }}>{prio.label}</span>
                  <span style={{ fontSize:14, fontWeight:600, color:prio.color, background:C.white, borderRadius:999, padding:"2px 10px", minWidth:28, textAlign:"center" }}>
                    {grupo.length}
                  </span>
                </div>
                <span style={{ color:prio.color, fontSize:18, fontWeight:700, transform: isOpen ? "rotate(180deg)" : "none", transition:"transform 0.2s" }}>
                  ▾
                </span>
              </button>

              {/* Group items */}
              {isOpen && grupo.length > 0 && (
                <div style={{ border:`1.5px solid ${prio.border}`, borderTop:"none", borderRadius:"0 0 16px 16px", overflow:"hidden" }}>
                  {grupo.map((pedido, idx) => {
                    const { total=0, resueltos=0 } = pedido.progreso || {}
                    const pct = total > 0 ? Math.round((resueltos/total)*100) : 0
                    const enProgreso = resueltos > 0 && resueltos < total
                    const listo = total > 0 && resueltos === total
                    const isLast = idx === grupo.length - 1

                    return (
                      <Link
                        key={pedido.id}
                        href={`/deposito/preparar-pedidos/${pedido.id}`}
                        style={{ textDecoration:"none", background:C.white, borderBottom: isLast ? "none" : `1px solid ${C.border}`, padding:"14px 16px", display:"block" }}
                      >
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                          <div style={{ flex:1, minWidth:0, marginRight:10 }}>
                            <div style={{ fontSize:16, fontWeight:700, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {pedido.clientes?.razon_social || pedido.clientes?.nombre}
                            </div>
                            <div style={{ fontSize:12, color:C.light, fontFamily:"monospace", marginTop:2 }}>
                              {pedido.numero_pedido} · {new Date(pedido.fecha).toLocaleDateString("es-AR")}
                            </div>
                          </div>
                          <span style={{ fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:999, whiteSpace:"nowrap", flexShrink:0,
                            background: listo ? C.greenL : enProgreso ? C.orangeL : C.bg,
                            color: listo ? C.green : enProgreso ? C.orange : C.sub,
                            border: `1px solid ${listo ? C.greenB : enProgreso ? C.orangeB : C.border}`
                          }}>
                            {listo ? "Listo" : enProgreso ? "En progreso" : "Pendiente"}
                          </span>
                        </div>

                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <div style={{ flex:1, background:C.border, borderRadius:999, height:5, overflow:"hidden" }}>
                            <div style={{ height:"100%", background: listo ? C.green : C.orange, borderRadius:999, width:`${pct}%`, transition:"width 0.3s" }} />
                          </div>
                          <span style={{ fontSize:12, color:listo?C.green:enProgreso?C.orange:C.sub, fontWeight:700, minWidth:40, textAlign:"right" }}>
                            {total} art.
                          </span>
                          <span style={{ fontSize:13, color:prio.color, fontWeight:700 }}>›</span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}

              {isOpen && grupo.length === 0 && (
                <div style={{ border:`1.5px solid ${prio.border}`, borderTop:"none", borderRadius:"0 0 16px 16px", padding:"14px 18px", background:C.white, textAlign:"center", color:C.light, fontSize:14 }}>
                  Sin pedidos
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
