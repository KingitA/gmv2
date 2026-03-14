"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

interface UrgentOrder {
  id: string
  numero_pedido: string
  cliente_nombre: string
  fecha: string
  items_count: number
}

export function UrgentOrderNotification() {
  const [urgentOrder, setUrgentOrder] = useState<UrgentOrder | null>(null)
  const [accepting, setAccepting] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  // Verificar si el pedido urgente sigue disponible (no fue tomado por otro)
  const checkStillAvailable = useCallback(async (pedidoId: string) => {
    const { data } = await supabase
      .from("picking_sesiones")
      .select("id")
      .eq("pedido_id", pedidoId)
      .in("estado", ["EN_PROGRESO", "en_progreso"])
      .maybeSingle()

    // Si alguien ya lo tomó, cerrar el modal
    if (data) {
      setUrgentOrder(null)
    }
  }, [supabase])

  useEffect(() => {
    // Escuchar cambios en la tabla pedidos cuando prioridad cambia a 1 (urgente)
    const channel = supabase
      .channel("urgent-orders")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pedidos",
          filter: "prioridad=eq.1",
        },
        async (payload: any) => {
          const pedido = payload.new
          if (!pedido || pedido.prioridad !== 1) return

          // Solo mostrar si está en estado pendiente o en_preparacion
          if (!["pendiente", "en_preparacion"].includes(pedido.estado)) return

          // Verificar que no haya alguien ya preparándolo
          const { data: sesionExistente } = await supabase
            .from("picking_sesiones")
            .select("id")
            .eq("pedido_id", pedido.id)
            .in("estado", ["EN_PROGRESO", "en_progreso"])
            .maybeSingle()

          if (sesionExistente) return // Ya lo tomó alguien

          // Obtener nombre del cliente y cantidad de items
          const { data: pedidoFull } = await supabase
            .from("pedidos")
            .select("id, numero_pedido, fecha, clientes(nombre_razon_social, nombre), pedidos_detalle(id)")
            .eq("id", pedido.id)
            .single()

          if (!pedidoFull) return

          const clienteNombre = (pedidoFull as any).clientes?.nombre_razon_social
            || (pedidoFull as any).clientes?.nombre
            || "Sin cliente"

          setUrgentOrder({
            id: pedidoFull.id,
            numero_pedido: pedidoFull.numero_pedido || "?",
            cliente_nombre: clienteNombre,
            fecha: pedidoFull.fecha,
            items_count: ((pedidoFull as any).pedidos_detalle || []).length,
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  // Mientras el modal está abierto, verificar cada 3s si alguien más lo tomó
  useEffect(() => {
    if (!urgentOrder) return
    const interval = setInterval(() => {
      checkStillAvailable(urgentOrder.id)
    }, 3000)
    return () => clearInterval(interval)
  }, [urgentOrder, checkStillAvailable])

  const handleAccept = async () => {
    if (!urgentOrder) return
    setAccepting(true)

    try {
      // Verificar una vez más que nadie lo tomó
      const { data: sesionExistente } = await supabase
        .from("picking_sesiones")
        .select("id")
        .eq("pedido_id", urgentOrder.id)
        .in("estado", ["EN_PROGRESO", "en_progreso"])
        .maybeSingle()

      if (sesionExistente) {
        setUrgentOrder(null)
        return
      }

      // Ir al pedido — el picking/route.ts ya crea la sesión automáticamente
      setUrgentOrder(null)
      router.push(`/deposito/preparar-pedidos/${urgentOrder.id}`)
    } catch (e) {
      console.error("Error aceptando pedido urgente:", e)
    } finally {
      setAccepting(false)
    }
  }

  const handleReject = () => {
    setUrgentOrder(null)
  }

  if (!urgentOrder) return null

  return (
    <>
      {/* Overlay */}
      <div
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
          zIndex: 9998, backdropFilter: "blur(4px)",
        }}
      />
      {/* Modal */}
      <div
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          zIndex: 9999, width: "min(420px, 90vw)",
          background: "#fff", borderRadius: 24, overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0,0,0,0.3)",
          animation: "urgentBounce 0.4s cubic-bezier(.34,1.56,.64,1)",
        }}
      >
        {/* Header rojo */}
        <div style={{
          background: "linear-gradient(135deg, #dc2626, #b91c1c)",
          padding: "28px 24px 20px", textAlign: "center", color: "#fff",
        }}>
          <div style={{ fontSize: 48, marginBottom: 8, animation: "urgentPulse 1s infinite" }}>🚨</div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px" }}>PEDIDO URGENTE</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>Requiere preparación inmediata</div>
        </div>

        {/* Contenido */}
        <div style={{ padding: "20px 24px" }}>
          <div style={{
            background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 16,
            padding: "16px 18px", marginBottom: 16,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 4 }}>Pedido</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#111827" }}>#{urgentOrder.numero_pedido}</div>
              </div>
              <div style={{ textAlign: "right" as const }}>
                <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 4 }}>Artículos</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#dc2626" }}>{urgentOrder.items_count}</div>
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 16, fontWeight: 700, color: "#111827" }}>
              {urgentOrder.cliente_nombre}
            </div>
          </div>

          {/* Botones */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <button
              onClick={handleReject}
              style={{
                padding: "16px", borderRadius: 16,
                background: "#f3f4f6", border: "1.5px solid #e5e7eb",
                fontSize: 16, fontWeight: 700, color: "#6b7280", cursor: "pointer",
              }}
            >
              Rechazar
            </button>
            <button
              onClick={handleAccept}
              disabled={accepting}
              style={{
                padding: "16px", borderRadius: 16,
                background: accepting ? "#9ca3af" : "#dc2626", border: "none",
                fontSize: 16, fontWeight: 800, color: "#fff", cursor: accepting ? "wait" : "pointer",
              }}
            >
              {accepting ? "..." : "¡Preparar!"}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes urgentBounce {
          0% { transform: translate(-50%, -50%) scale(0.7); opacity: 0; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
        @keyframes urgentPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
      `}</style>
    </>
  )
}
