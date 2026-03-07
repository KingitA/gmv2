"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { useRouter } from 'next/navigation'
import { useToast } from "@/hooks/use-toast"
import { ArrowLeft, Scan, CheckCircle2, AlertCircle, Package, MapPin } from 'lucide-react'
import { EscaneoDialog } from "./escaneo-dialog"
import { ItemPedidoCard } from "./item-pedido-card"
import { finalizarPreparacion } from "@/lib/actions/deposito"

interface PedidoDetalle {
  id: string
  numero_pedido: string
  fecha: string
  prioridad: number
  cliente: {
    nombre: string
    localidad: string
  }
}

interface ItemPedido {
  id: string
  cantidad: number
  cantidad_preparada: number
  estado_item: string
  articulo: {
    id: string
    sku: string
    descripcion: string
    ean13: string
  }
}

interface PreparacionPedidoProps {
  pedidoId: string
  initialPedido: PedidoDetalle
  initialItems: ItemPedido[]
  userId: string
  userEmail: string
}

export function PreparacionPedido({ pedidoId, initialPedido, initialItems, userId, userEmail }: PreparacionPedidoProps) {
  const [pedido] = useState<PedidoDetalle>(initialPedido)
  const [items, setItems] = useState<ItemPedido[]>(initialItems)
  const [isEscaneoOpen, setIsEscaneoOpen] = useState(false)
  const [sesionId, setSesionId] = useState<string | null>(null)
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    const initSesion = async () => {
      const supabase = createClient()

      const { data: existingSesion } = await supabase
        .from("picking_sesiones")
        .select("id")
        .eq("pedido_id", pedidoId)
        .eq("usuario_id", userId)
        .eq("estado", "EN_PROGRESO")
        .maybeSingle()

      if (existingSesion) {
        setSesionId(existingSesion.id)
      }
    }

    initSesion()
  }, [pedidoId, userId])

  const fetchPedidoDetalle = async () => {
    const supabase = createClient()

    const { data: itemsData, error: itemsError } = await supabase
      .from("pedidos_detalle")
      .select(`
        id,
        cantidad,
        cantidad_preparada,
        estado_item,
        articulo:articulos(id, sku, descripcion, ean13)
      `)
      .eq("pedido_id", pedidoId)

    if (itemsError) {
      console.error("[v0] Error cargando items:", itemsError)
      toast({
        title: "Error",
        description: "No se pudieron cargar los artículos",
        variant: "destructive",
      })
    } else {
      console.log("[v0] Items actualizados:", itemsData?.length)
      setItems(itemsData || [])
    }
  }

  const handleMarcarFaltante = async (itemId: string) => {
    const supabase = createClient()
    const { error } = await supabase.from("pedidos_detalle").update({ estado_item: "FALTANTE" }).eq("id", itemId)

    if (error) {
      console.error("[v0] Error marcando faltante:", error)
      toast({
        title: "Error",
        description: "No se pudo marcar como faltante",
        variant: "destructive",
      })
    } else {
      toast({
        title: "Marcado como faltante",
        description: "El artículo fue marcado como faltante",
      })
      fetchPedidoDetalle()
    }
  }

  const handleCerrarParcial = async (itemId: string) => {
    const item = items.find((i) => i.id === itemId)
    if (!item) return

    const supabase = createClient()
    const nuevoEstado = item.cantidad_preparada >= item.cantidad ? "COMPLETO" : "PARCIAL"

    const { error } = await supabase.from("pedidos_detalle").update({ estado_item: nuevoEstado }).eq("id", itemId)

    if (error) {
      console.error("[v0] Error cerrando parcial:", error)
      toast({
        title: "Error",
        description: "No se pudo actualizar el estado",
        variant: "destructive",
      })
    } else {
      toast({
        title: "Estado actualizado",
        description: `Artículo marcado como ${nuevoEstado}`,
      })
      fetchPedidoDetalle()
    }
  }

  const handleFinalizarPreparacion = async () => {
    const itemsPendientes = items.filter((i) => !i.estado_item || i.estado_item === "PENDIENTE")

    if (itemsPendientes.length > 0) {
      toast({
        title: "No se puede finalizar",
        description: `Hay ${itemsPendientes.length} artículo(s) pendiente(s). Todos deben estar COMPLETO, PARCIAL o FALTANTE.`,
        variant: "destructive",
      })
      return
    }

    try {
      const result = await finalizarPreparacion(pedidoId, sesionId, userId)

      if (!result.success) {
        throw new Error(result.error)
      }

      toast({
        title: "Preparación finalizada",
        description: "El pedido está listo para despacho",
      })

      router.push("/deposito")
    } catch (error) {
      console.error("[v0] Error finalizando:", error)
      toast({
        title: "Error",
        description: "No se pudo finalizar la preparación",
        variant: "destructive",
      })
    }
  }

  const contarEstados = () => {
    const pendientes = items.filter((i) => !i.estado_item || i.estado_item === "PENDIENTE").length
    const completos = items.filter((i) => i.estado_item === "COMPLETO").length
    const parciales = items.filter((i) => i.estado_item === "PARCIAL").length
    const faltantes = items.filter((i) => i.estado_item === "FALTANTE").length
    return { pendientes, completos, parciales, faltantes, total: items.length }
  }

  if (!pedido) return null

  const estados = contarEstados()
  const puedeFinalizar = estados.pendientes === 0

  return (
    <>
      {/* Header fijo */}
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="container mx-auto p-4">
          <div className="flex items-center gap-4 mb-3">
            <Button variant="ghost" size="icon" onClick={() => router.push("/deposito")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-xl font-bold">Pedido #{pedido.numero_pedido}</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Package className="h-4 w-4" />
                <span>{pedido.cliente?.nombre}</span>
                {pedido.cliente?.localidad && (
                  <>
                    <span>•</span>
                    <MapPin className="h-3 w-3" />
                    <span>{pedido.cliente.localidad}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Resumen de progreso */}
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="bg-green-500/10 rounded-lg p-2">
              <div className="text-2xl font-bold text-green-700 dark:text-green-400">{estados.completos}</div>
              <div className="text-xs text-muted-foreground">Completos</div>
            </div>
            <div className="bg-yellow-500/10 rounded-lg p-2">
              <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{estados.pendientes}</div>
              <div className="text-xs text-muted-foreground">Pendientes</div>
            </div>
            <div className="bg-orange-500/10 rounded-lg p-2">
              <div className="text-2xl font-bold text-orange-700 dark:text-orange-400">{estados.parciales}</div>
              <div className="text-xs text-muted-foreground">Parciales</div>
            </div>
            <div className="bg-red-500/10 rounded-lg p-2">
              <div className="text-2xl font-bold text-red-700 dark:text-red-400">{estados.faltantes}</div>
              <div className="text-xs text-muted-foreground">Faltantes</div>
            </div>
          </div>
        </div>
      </header>

      {/* Lista de items */}
      <div className="container mx-auto p-4 pb-24 space-y-3">
        {items.map((item) => (
          <ItemPedidoCard
            key={item.id}
            item={item}
            onMarcarFaltante={handleMarcarFaltante}
            onCerrarParcial={handleCerrarParcial}
          />
        ))}
      </div>

      {/* Footer fijo con botones */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 space-y-2">
        <Button size="lg" className="w-full" onClick={() => setIsEscaneoOpen(true)}>
          <Scan className="mr-2 h-5 w-5" />
          ESCANEAR ARTÍCULO
        </Button>
        <Button
          size="lg"
          variant={puedeFinalizar ? "default" : "outline"}
          className="w-full"
          onClick={handleFinalizarPreparacion}
          disabled={!puedeFinalizar}
        >
          {puedeFinalizar ? (
            <>
              <CheckCircle2 className="mr-2 h-5 w-5" />
              FINALIZAR PREPARACIÓN
            </>
          ) : (
            <>
              <AlertCircle className="mr-2 h-5 w-5" />
              HAY {estados.pendientes} ARTÍCULO(S) PENDIENTE(S)
            </>
          )}
        </Button>
      </div>

      <EscaneoDialog
        open={isEscaneoOpen}
        onOpenChange={setIsEscaneoOpen}
        pedidoId={pedidoId}
        items={items}
        sesionId={sesionId}
        onSuccess={fetchPedidoDetalle}
      />
    </>
  )
}
